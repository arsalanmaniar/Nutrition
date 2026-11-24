'use server'

import type { Prisma, SubmissionStatus } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { fail, ok, type ActionResult } from '@/features/nutrition/lib/action-result'
import { approveCaseLogSchema, rejectCaseLogSchema } from '@/features/nutrition/validation/case-log-reviews'
import { ActionFailure, formFields, invalid } from '../action-helpers'
import { reviewSnapshot, writeAudit } from '../audit'
import { ownPreceptorId } from '../own-preceptor'

// Server actions for the preceptor's case-log review (/nutrition/preceptor/reviews).
//
// Every exported function starts with requireNutritionRole(['PRECEPTOR'])
// (portal-guard-coverage.test.ts checks it), then parses its form with zod,
// then decides inside a transaction that also writes the audit row.
//
// ACCESS: a preceptor reviews only the logs of trainees for whom they hold an
// ACTIVE primary assignment, looked up by their own profile id, never by a
// trainee id from the form. Another trainee's log, a DRAFT and a missing log
// all get the same "not found". When the assignment ends, so does access.
//
// Only a SUBMITTED log can be reviewed. APPROVED is final. REJECTED goes back
// to the trainee, who edits and resubmits it (case-logs.ts); the comment stays
// on the log, visible to the trainee, until the next review overwrites it.
//
// reviewedById is the preceptor's profile id; the audit actorId is their auth
// user id (access.userId), as everywhere in the module. The audit rows record
// the status before and after and the comment's length, never the comment or
// the case content (see reviewSnapshot).

const REVIEWS_PATH = '/nutrition/preceptor/reviews'
const DASHBOARD_PATH = '/nutrition/preceptor'

const NOT_FOUND = 'This case log was not found.'

/** Every status but DRAFT: a preceptor never sees a draft. */
const VISIBLE: SubmissionStatus[] = ['SUBMITTED', 'APPROVED', 'REJECTED']

const REVIEW_FIELDS = {
  id: true,
  traineeId: true,
  caseCode: true,
  status: true,
  reviewedById: true,
  reviewedAt: true,
  reviewComment: true,
} as const

/** Approves a SUBMITTED log of one of the caller's trainees, with an optional comment. Final. */
export async function approveCaseLog(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const preceptorId = ownPreceptorId(access)
  const parsed = approveCaseLogSchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)
  return review(access.userId, preceptorId, parsed.data.logId, 'APPROVED', parsed.data.comment)
}

/** Returns a SUBMITTED log of one of the caller's trainees, with a comment saying what to change. */
export async function rejectCaseLog(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const preceptorId = ownPreceptorId(access)
  const parsed = rejectCaseLogSchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)
  return review(access.userId, preceptorId, parsed.data.logId, 'REJECTED', parsed.data.comment)
}

async function review(
  actorId: string,
  preceptorId: string,
  logId: string,
  decision: 'APPROVED' | 'REJECTED',
  comment: string | null,
): Promise<ActionResult> {
  try {
    await prisma.$transaction(async (tx) => {
      // The same row lock the trainee's save and submit take (case-logs.ts).
      // A second review of the log (another tab, another preceptor) waits
      // here, and both the status and the assignment are read only after it.
      await tx.$queryRaw`SELECT id FROM nutr_case_log WHERE id = ${logId} FOR UPDATE`
      const before = await tx.nutritionCaseLog.findFirst({
        where: { id: logId, status: { in: VISIBLE } },
        select: REVIEW_FIELDS,
      })
      if (!before || !(await holdsActiveAssignment(tx, preceptorId, before.traineeId))) {
        throw new ActionFailure(NOT_FOUND)
      }
      if (before.status !== 'SUBMITTED') {
        throw new ActionFailure(
          before.status === 'APPROVED'
            ? 'This case log has already been approved.'
            : 'This case log has already been reviewed and returned to the trainee.',
        )
      }

      const after = await tx.nutritionCaseLog.update({
        where: { id: before.id },
        data: { status: decision, reviewedById: preceptorId, reviewedAt: new Date(), reviewComment: comment },
        select: REVIEW_FIELDS,
      })
      await writeAudit(tx, {
        entity: 'NutritionCaseLog',
        entityId: before.id,
        action: decision === 'APPROVED' ? 'approve' : 'reject',
        actorId,
        before: reviewSnapshot(before),
        after: reviewSnapshot(after),
      })
    })
  } catch (error) {
    if (error instanceof ActionFailure) return fail(error.message, error.fieldErrors)
    throw error
  }

  revalidatePath(REVIEWS_PATH)
  revalidatePath(`${REVIEWS_PATH}/${logId}`)
  revalidatePath(DASHBOARD_PATH)
  return ok(decision === 'APPROVED' ? 'Approved.' : 'Returned to the trainee.')
}

/** Does this preceptor hold the trainee's active primary assignment right now? */
async function holdsActiveAssignment(tx: Prisma.TransactionClient, preceptorId: string, traineeId: string): Promise<boolean> {
  const assignment = await tx.nutritionPreceptorAssignment.findFirst({
    where: { traineeId, preceptorId, active: true },
    select: { id: true },
  })
  return assignment !== null
}
