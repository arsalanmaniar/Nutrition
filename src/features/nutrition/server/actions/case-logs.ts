'use server'

import type { Prisma, SubmissionStatus } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { CASE_LOG_FORMS } from '@/features/nutrition/config/case-log-forms'
import { fail, ok, type ActionResult } from '@/features/nutrition/lib/action-result'
import {
  caseLogRefSchema,
  newCaseLogSchema,
  parseCaseLog,
  type CaseLogInput,
} from '@/features/nutrition/validation/case-logs'
import { ActionFailure, formFields, invalid } from '../action-helpers'
import { caseLogSnapshot, writeAudit } from '../audit'
import { ownTraineeId } from '../own-trainee'

// Server actions for the trainee's e-logbook (/nutrition/trainee/logbook).
//
// Every exported function starts with requireNutritionRole(['TRAINEE'])
// (portal-guard-coverage.test.ts checks it), then parses its form with zod,
// then changes the database inside a transaction that also writes the audit
// row.
//
// OWNERSHIP: a trainee reaches only their own case logs. Every query is
// filtered by the caller's own profile id (ownTraineeId), never by an id from
// the form alone, and someone else's log gets the same answer as a log that
// does not exist.
//
// Workflow: DRAFT (the trainee edits) → SUBMITTED (locked for the trainee) →
// APPROVED or REJECTED by the preceptor (Step 3f). A REJECTED log is the
// trainee's again, to edit and resubmit. There is no delete: SubmissionStatus
// has no cancelled state, and this step makes no schema change.
//
// createdBy and the audit actorId are the caller's Supabase auth user id
// (access.userId), as everywhere in the module. The audit rows leave out the
// free text: see caseLogSnapshot.

const LOGBOOK_PATH = '/nutrition/trainee/logbook'

const NOT_FOUND = 'This case log was not found.'

/** The statuses in which the trainee may still change a log. */
const EDITABLE: readonly SubmissionStatus[] = ['DRAFT', 'REJECTED']

const CASE_LOG_FIELDS = {
  id: true,
  traineeId: true,
  caseCode: true,
  formType: true,
  formVersion: true,
  rotationId: true,
  ageBand: true,
  diagnosisCategory: true,
  epaLevel: true,
  data: true,
  status: true,
  submittedAt: true,
  reviewedById: true,
  reviewedAt: true,
} as const

type CaseLogRow = Prisma.NutritionCaseLogGetPayload<{ select: typeof CASE_LOG_FIELDS }>

/** Starts a case log as a DRAFT, with a case code from the server, then opens the new log's page. */
export async function createCaseLog(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['TRAINEE'])
  const traineeId = ownTraineeId(access)
  const fields = formFields(formData)
  const form = newCaseLogSchema.safeParse(fields)
  if (!form.success) return invalid(form.error)
  const parsed = parseCaseLog(fields, form.data.formType, 'draft')
  if (!parsed.success) return invalid(parsed.error)
  const input = parsed.data

  let created: { id: string }
  try {
    created = await prisma.$transaction(async (tx) => {
      // Locks the trainee's own profile row: two creates at once (a double
      // click, a second tab) take turns here, so the second one sees the first
      // one's case code and takes the next number.
      await tx.$queryRaw`SELECT id FROM nutr_profile WHERE id = ${traineeId} FOR UPDATE`
      await checkRotation(tx, input.rotationId, null)
      const log = await tx.nutritionCaseLog.create({
        data: {
          traineeId,
          caseCode: await nextCaseCode(tx, traineeId),
          formType: input.formType,
          formVersion: CASE_LOG_FORMS[input.formType].version,
          ...details(input),
          createdBy: access.userId,
        },
        select: CASE_LOG_FIELDS,
      })
      await writeAudit(tx, {
        entity: 'NutritionCaseLog',
        entityId: log.id,
        action: 'create',
        actorId: access.userId,
        before: null,
        after: caseLogSnapshot(log),
      })
      return { id: log.id }
    })
  } catch (error) {
    if (error instanceof ActionFailure) return fail(error.message, error.fieldErrors)
    throw error
  }

  revalidatePath(LOGBOOK_PATH)
  redirect(`${LOGBOOK_PATH}/${created.id}`)
}

/** Saves changes to one of the caller's own logs while it is a DRAFT or REJECTED. */
export async function updateCaseLog(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['TRAINEE'])
  const traineeId = ownTraineeId(access)
  const fields = formFields(formData)
  const ref = caseLogRefSchema.safeParse(fields)
  if (!ref.success) return invalid(ref.error)
  const parsed = parseCaseLog(fields, ref.data.formType, 'draft')
  if (!parsed.success) return invalid(parsed.error)
  const input = parsed.data
  const { logId } = ref.data

  let changed: boolean
  try {
    changed = await prisma.$transaction(async (tx) => {
      const before = await lockOwnEditableLog(tx, logId, traineeId, input)
      await checkRotation(tx, input.rotationId, before.rotationId)
      if (unchanged(before, input)) return false

      const after = await tx.nutritionCaseLog.update({
        where: { id: before.id, traineeId },
        data: { ...details(input), formVersion: CASE_LOG_FORMS[input.formType].version },
        select: CASE_LOG_FIELDS,
      })
      await writeAudit(tx, {
        entity: 'NutritionCaseLog',
        entityId: before.id,
        action: 'update',
        actorId: access.userId,
        before: caseLogSnapshot(before),
        after: caseLogSnapshot(after),
      })
      return true
    })
  } catch (error) {
    if (error instanceof ActionFailure) return fail(error.message, error.fieldErrors)
    throw error
  }

  if (!changed) return ok('No changes to save.')
  revalidatePath(LOGBOOK_PATH)
  revalidatePath(`${LOGBOOK_PATH}/${logId}`)
  return ok('Saved.')
}

/**
 * Submits one of the caller's own DRAFT logs for review, or resubmits a
 * REJECTED one, together with the changes in the form. From then on the
 * trainee can no longer change it.
 */
export async function submitCaseLog(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['TRAINEE'])
  const traineeId = ownTraineeId(access)
  const fields = formFields(formData)
  const ref = caseLogRefSchema.safeParse(fields)
  if (!ref.success) return invalid(ref.error)
  const parsed = parseCaseLog(fields, ref.data.formType, 'submit')
  if (!parsed.success) return invalid(parsed.error)
  const input = parsed.data
  const { logId } = ref.data

  let action: 'submit' | 'resubmit'
  try {
    action = await prisma.$transaction(async (tx) => {
      const before = await lockOwnEditableLog(tx, logId, traineeId, input)
      await checkRotation(tx, input.rotationId, before.rotationId)

      const after = await tx.nutritionCaseLog.update({
        where: { id: before.id, traineeId },
        data: {
          ...details(input),
          formVersion: CASE_LOG_FORMS[input.formType].version,
          status: 'SUBMITTED',
          submittedAt: new Date(),
        },
        select: CASE_LOG_FIELDS,
      })
      const action = before.status === 'REJECTED' ? 'resubmit' : 'submit'
      await writeAudit(tx, {
        entity: 'NutritionCaseLog',
        entityId: before.id,
        action,
        actorId: access.userId,
        before: caseLogSnapshot(before),
        after: caseLogSnapshot(after),
      })
      return action
    })
  } catch (error) {
    if (error instanceof ActionFailure) return fail(error.message, error.fieldErrors)
    throw error
  }

  revalidatePath(LOGBOOK_PATH)
  revalidatePath(`${LOGBOOK_PATH}/${logId}`)
  return ok(action === 'resubmit' ? 'Resubmitted for review.' : 'Submitted for review.')
}

/**
 * Locks one of the caller's own logs until the transaction ends and returns
 * it, if the trainee may still change it. It is found by id AND trainee, so
 * another trainee's log is "not found", exactly like a log that does not
 * exist. The lock makes a save and a submit from two tabs take turns, so a log
 * cannot change after it was submitted. The preceptor's review (Step 3f) must
 * take the same lock.
 */
async function lockOwnEditableLog(
  tx: Prisma.TransactionClient,
  logId: string,
  traineeId: string,
  input: CaseLogInput,
): Promise<CaseLogRow> {
  await tx.$queryRaw`SELECT id FROM nutr_case_log WHERE id = ${logId} AND "traineeId" = ${traineeId} FOR UPDATE`
  const log = await tx.nutritionCaseLog.findFirst({ where: { id: logId, traineeId }, select: CASE_LOG_FIELDS })
  if (!log) throw new ActionFailure(NOT_FOUND)
  if (!EDITABLE.includes(log.status)) {
    throw new ActionFailure(
      log.status === 'APPROVED'
        ? 'This case log has been approved and can no longer be changed.'
        : 'This case log has been submitted and can no longer be changed.',
    )
  }
  if (log.formType !== input.formType) throw new ActionFailure('This case log uses a different form. Reload the page and try again.')
  return log
}

/** A rotation must be active, unless the log already has it (it may have been retired since). */
async function checkRotation(tx: Prisma.TransactionClient, rotationId: string | null, current: string | null): Promise<void> {
  if (rotationId === null || rotationId === current) return
  const rotation = await tx.nutritionRotation.findUnique({ where: { id: rotationId }, select: { isActive: true } })
  if (!rotation?.isActive) throw new ActionFailure('Pick an active rotation.', { rotationId: 'Not an active rotation.' })
}

const CASE_CODE = /^C-\d{4}-(\d+)$/

/**
 * The trainee's next case code, C-<year>-<number>, e.g. C-2026-007: the year
 * of creation in Karachi, and the trainee's own running number, which carries
 * on across years (C-2026-041 can be followed by C-2027-042). Called only
 * while the trainee's row is locked.
 */
async function nextCaseCode(tx: Prisma.TransactionClient, traineeId: string): Promise<string> {
  const year = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric' })
  const logs = await tx.nutritionCaseLog.findMany({ where: { traineeId }, select: { caseCode: true } })
  const highest = logs.reduce((max, log) => Math.max(max, Number(CASE_CODE.exec(log.caseCode)?.[1] ?? 0)), 0)
  return `C-${year}-${String(highest + 1).padStart(3, '0')}`
}

/** The columns a trainee's form sets. */
function details(input: CaseLogInput) {
  return {
    rotationId: input.rotationId,
    ageBand: input.ageBand,
    diagnosisCategory: input.diagnosisCategory,
    epaLevel: input.epaLevel,
    data: input.data,
  }
}

function unchanged(log: CaseLogRow, input: CaseLogInput): boolean {
  const stored: Prisma.JsonObject = log.data !== null && typeof log.data === 'object' && !Array.isArray(log.data) ? log.data : {}
  const keys = Object.keys(input.data)
  return (
    log.formVersion === CASE_LOG_FORMS[input.formType].version &&
    log.rotationId === input.rotationId &&
    log.ageBand === input.ageBand &&
    log.diagnosisCategory === input.diagnosisCategory &&
    log.epaLevel === input.epaLevel &&
    Object.keys(stored).length === keys.length &&
    keys.every((key) => stored[key] === input.data[key])
  )
}
