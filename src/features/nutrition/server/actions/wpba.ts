'use server'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { WPBA_FORMS } from '@/features/nutrition/config/forms'
import { karachiDay, storedDay } from '@/features/nutrition/lib/assessment-point'
import { fail, ok, type ActionResult } from '@/features/nutrition/lib/action-result'
import { ratingFieldErrors, ratingsFromFields, wpbaInputSchema, type WpbaInput } from '@/features/nutrition/validation/wpba'
import { ActionFailure, formFields, invalid } from '../action-helpers'
import { writeAudit } from '../audit'
import { activePrimaryPreceptorId } from '../evaluation-forms-core'
import { lockTraineeRow } from '../lock-trainee-row'
import { ownAssessorId } from '../own-assessor'
import { scoreWpba, wpbaAuditSnapshot, type WpbaScore } from '../wpba-core'

// Server action for filing a workplace-based assessment (Step 5a): Mini-CEX,
// DOPS, CbD or OSCE. Starts with requireNutritionRole(['PRECEPTOR',
// 'ASSESSOR']) (portal-guard-coverage.test.ts checks it).
//
// WHO MAY ASSESS a trainee:
//  - their ACTIVE primary preceptor; or
//  - a preceptor or assessor holding a NutritionRotationEntry for the trainee
//    (rotationPreceptorId) whose dates cover the day assessed. The WPBA then
//    records that placement (rotationEntryId). The primary supervisor mapping
//    never changes (plan, Step 5).
// Anyone else gets the same "not found" as for no such trainee.
//
// Scores, the total, maxScore, an OSCE's pass and the Miller level all come
// from server/wpba-core.ts; client values are never read. A CbD must discuss
// one of the trainee's SUBMITTED or APPROVED case logs, checked inside the
// transaction. The day assessed may not be in the future (Karachi) nor before
// the trainee's training start date. Several WPBAs of one kind are normal (a
// Mini-CEX is repeated over the year), so there is no uniqueness, but the
// identical assessment filed again within 60 seconds by the same assessor is
// refused as a double submit.
//
// A WPBA is final once filed: there is no edit, and NutritionWpba has no
// column for a correction note. The audit row (actorId = the caller's
// Supabase user id) has ids, type, totals and the result, never the feedback
// text, a per-item rating or a DOPS "other" description.

const NOT_ASSESSABLE = 'This trainee was not found among the trainees you may assess.'
const CASE_LOG_NOT_FOUND = 'This case log was not found.'
const DOUBLE_SUBMIT = 'This assessment was submitted a moment ago. It has not been filed twice.'
const DOUBLE_SUBMIT_MS = 60_000

const WPBA_FIELDS = {
  id: true,
  type: true,
  formVersion: true,
  traineeId: true,
  assessorId: true,
  rotationEntryId: true,
  caseLogId: true,
  procedure: true,
  assessedOn: true,
  total: true,
  maxScore: true,
  passed: true,
  criticalError: true,
  millerLevel: true,
} as const

/** Files one WPBA. A correction is a new WPBA; nothing is ever changed afterwards. */
export async function submitWpba(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['PRECEPTOR', 'ASSESSOR'])
  const assessorId = ownAssessorId(access)
  const fields = formFields(formData)
  const parsed = wpbaInputSchema.safeParse(fields)
  if (!parsed.success) return invalid(parsed.error)
  const input = parsed.data
  const scored = scoreWpba(input.type, ratingsFromFields(fields), input.criticalError)
  if (!scored.ok) return fail('Check the highlighted fields.', ratingFieldErrors(scored.errors))
  if (input.assessedOn > karachiDay(new Date())) {
    return fail('The assessment date cannot be in the future.', { assessedOn: 'The assessment date cannot be in the future.' })
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Every write for a trainee takes this lock first (lock-trainee-row.ts).
      if (!(await lockTraineeRow(tx, input.traineeId))) throw new ActionFailure(NOT_ASSESSABLE)
      const trainee = await tx.nutritionProfile.findUnique({
        where: { id: input.traineeId },
        select: { role: true, isActive: true, trainingStartDate: true },
      })
      if (trainee?.role !== 'TRAINEE' || !trainee.isActive) throw new ActionFailure(NOT_ASSESSABLE)
      const authority = await assessingAs(tx, assessorId, input.traineeId, input.assessedOn)
      if (!authority) throw new ActionFailure(NOT_ASSESSABLE)

      if (!trainee.trainingStartDate) throw new ActionFailure("This trainee's training start date is not set yet.")
      if (input.assessedOn < storedDay(trainee.trainingStartDate)) {
        throw new ActionFailure('The assessment date is before the trainee started training.', {
          assessedOn: 'Before the training start date.',
        })
      }

      if (input.type === 'CBD') {
        // Only this trainee's SUBMITTED or APPROVED log; a draft, a returned
        // log or someone else's gets the same "not found".
        const log = await tx.nutritionCaseLog.findFirst({
          where: { id: input.caseLogId ?? '', traineeId: input.traineeId, status: { in: ['SUBMITTED', 'APPROVED'] } },
          select: { id: true },
        })
        if (!log) throw new ActionFailure(CASE_LOG_NOT_FOUND, { caseLogId: CASE_LOG_NOT_FOUND })
      }

      if (await isDoubleSubmit(tx, assessorId, input, scored.score)) throw new ActionFailure(DOUBLE_SUBMIT)

      const row = await tx.nutritionWpba.create({
        data: {
          type: input.type,
          formVersion: WPBA_FORMS[input.type].version,
          traineeId: input.traineeId,
          assessorId,
          rotationEntryId: authority.rotationEntryId,
          caseLogId: input.caseLogId,
          procedure: input.procedure,
          scores: storedScores(scored.score),
          total: scored.score.total,
          maxScore: scored.score.maxScore,
          passed: scored.score.passed,
          criticalError: scored.score.criticalError,
          millerLevel: scored.score.millerLevel,
          feedback: input.feedback,
          assessedOn: new Date(`${input.assessedOn}T00:00:00Z`),
          createdBy: access.userId,
        },
        select: WPBA_FIELDS,
      })
      await writeAudit(tx, {
        entity: 'NutritionWpba',
        entityId: row.id,
        action: 'create',
        actorId: access.userId,
        before: null,
        after: wpbaAuditSnapshot(row),
      })
    })
  } catch (error) {
    if (error instanceof ActionFailure) return fail(error.message, error.fieldErrors)
    throw error
  }

  return ok(`${WPBA_FORMS[input.type].title} submitted.`)
}

/**
 * Whether this assessor may assess this trainee on that day, and the
 * placement it is filed under: a rotation entry of theirs for the trainee that
 * covers the day (startDate to endDate, open-ended if no endDate), or else
 * being the trainee's ACTIVE primary preceptor. Null: neither.
 */
async function assessingAs(
  tx: Prisma.TransactionClient,
  assessorId: string,
  traineeId: string,
  assessedOn: string,
): Promise<{ rotationEntryId: string | null } | null> {
  const entries = await tx.nutritionRotationEntry.findMany({
    where: { traineeId, rotationPreceptorId: assessorId },
    select: { id: true, startDate: true, endDate: true },
  })
  const covering = entries.find(
    (entry) => storedDay(entry.startDate) <= assessedOn && (entry.endDate === null || assessedOn <= storedDay(entry.endDate)),
  )
  if (covering) return { rotationEntryId: covering.id }
  if ((await activePrimaryPreceptorId(tx, traineeId)) === assessorId) return { rotationEntryId: null }
  return null
}

/** What NutritionWpba.scores holds: the ratings, and for an OSCE the reasons it failed (empty when it passed). */
function storedScores(score: WpbaScore) {
  return score.passed === null ? { ratings: score.ratings } : { ratings: score.ratings, failReasons: score.failReasons }
}

/** JSON with every object's keys sorted: Postgres jsonb does not keep key order, so a plain stringify would never match. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/** The same assessor filed the identical assessment of this trainee within the last 60 seconds. */
async function isDoubleSubmit(tx: Prisma.TransactionClient, assessorId: string, input: WpbaInput, score: WpbaScore): Promise<boolean> {
  const recent = await tx.nutritionWpba.findMany({
    where: { traineeId: input.traineeId, assessorId, type: input.type },
    select: { createdAt: true, assessedOn: true, caseLogId: true, procedure: true, scores: true, criticalError: true, feedback: true },
  })
  const fingerprint = (value: { assessedOn: string; caseLogId: string | null; procedure: string | null; scores: unknown; criticalError: boolean | null; feedback: string | null }) =>
    canonical([value.assessedOn, value.caseLogId, value.procedure, value.scores, value.criticalError, value.feedback])
  const incoming = fingerprint({ ...input, scores: storedScores(score), criticalError: score.criticalError })
  const since = Date.now() - DOUBLE_SUBMIT_MS
  return recent.some(
    (row) => row.createdAt.getTime() >= since && fingerprint({ ...row, assessedOn: storedDay(row.assessedOn) }) === incoming,
  )
}
