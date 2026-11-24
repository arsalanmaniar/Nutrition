'use server'

import type { EvaluationFormType } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { canSeeIndividualForm13 } from '@/features/nutrition/auth/roles'
import { EVALUATION_FORMS } from '@/features/nutrition/config/forms'
import { fail, ok, type ActionResult } from '@/features/nutrition/lib/action-result'
import {
  formRefSchema,
  parseAnswers,
  startOwnFormSchema,
  startTraineeFormSchema,
  storedAnswers,
  weeklyCommentSchema,
  type AnswersLevel,
} from '@/features/nutrition/validation/evaluation-forms'
import type { z } from 'zod'
import { ActionFailure, formFields, invalid, isUniqueViolation } from '../action-helpers'
import { writeAudit } from '../audit'
import { AuthorHashKeyError, authorHash } from '../author-hash'
import {
  EVALUATION_FORM_FIELDS,
  SUBMITTED_STATUSES,
  activePrimaryPreceptorId,
  evaluationFormSnapshot,
  formsAboutTrainee,
  nextDue,
  notDueMessage,
  scheduleFor,
  type Db,
} from '../evaluation-forms-core'
import { formOneThreeAuditSnapshot, ownFormOneThreeRows, writeFormOneThreeAudit } from '../form-1-3'
import { lockTraineeRow } from '../lock-trainee-row'
import { ownPreceptorId } from '../own-preceptor'
import { ownTraineeId } from '../own-trainee'

// Server actions for the evaluation forms (Step 4b).
//
// Who files what (config/forms.ts filledBy / about, plan decisions):
//  - WEEKLY and FORM_1_1: the trainee, about themselves. The trainee's ACTIVE
//    primary preceptor may comment on a submitted weekly check-in.
//  - FORM_1_2 and FORM_3_1: the trainee's ACTIVE PRIMARY preceptor only.
//    Rotation preceptors assess through WPBAs (Step 5) and have no assignment.
//  - FORM_1_3: the trainee, about their primary preceptor, at Months 4/8/12,
//    CONFIDENTIAL (form-1-3.ts has the rules).
//
// Every action: first requireNutritionRole with its exact role list
// (portal-guard-coverage.test.ts checks it); the form definition comes from
// config/forms.ts only; the assessment point comes from the scheduler and the
// trainee's stored start date, never from the client; scores come from
// scoring.ts only, so a client total is never read; a form is started only
// when the scheduler says it is due, oldest first; and lockTraineeRow is
// taken before any form row is created or changed, so writes for one trainee
// take turns and the start date cannot change underneath them. A row is one
// per type, subject, author and point (nutr_evaluation_form_period_key; for
// Form 1.3, the authorHash unique index), so a duplicate is refused cleanly.
//
// DRAFT -> SUBMITTED. A submitted form is locked except for a logged reopen
// by the trainee's active primary preceptor. Form 1.3 can never be reopened,
// and no form is ever deleted.

const TRAINEE_FORMS_PATH = '/nutrition/trainee/forms'
const PRECEPTOR_FORMS_PATH = '/nutrition/preceptor/forms'
const ENTITY = 'NutritionEvaluationForm'

const NOT_FOUND = 'This form was not found.'
const TRAINEE_NOT_FOUND = 'This trainee was not found among your trainees.'
const ALREADY_SUBMITTED = 'This form has already been submitted and can no longer be changed.'
const ALREADY_EXISTS = 'This form already exists. Reload the page to continue it.'
const FORM_1_3_UNAVAILABLE = 'Form 1.3 is not available right now. Nothing was saved.'
const NO_PRECEPTOR = 'You have no primary preceptor assigned yet, so there is no one to evaluate.'

const EMPTY_ANSWERS = { ratings: {}, text: {} }

/** An answers problem found inside a transaction, reported like any zod failure. */
class InvalidAnswers extends Error {
  constructor(readonly zodError: z.ZodError) {
    super('invalid answers')
  }
}

/** The ActionResult for an expected failure; anything else is rethrown. */
function failure(error: unknown): ActionResult {
  if (error instanceof ActionFailure) return fail(error.message, error.fieldErrors)
  if (error instanceof InvalidAnswers) return invalid(error.zodError)
  if (isUniqueViolation(error)) return fail(ALREADY_EXISTS)
  // Fail closed: without the hash key no Form 1.3 can be written or found.
  if (error instanceof AuthorHashKeyError) return fail(FORM_1_3_UNAVAILABLE)
  throw error
}

function parsedAnswers(fields: Record<string, string>, formType: EvaluationFormType, level: AnswersLevel) {
  const parsed = parseAnswers(fields, formType, level)
  if (!parsed.success) throw new InvalidAnswers(parsed.error)
  return parsed
}

const sameAnswers = (stored: unknown, next: unknown) => JSON.stringify(storedAnswers(stored)) === JSON.stringify(storedAnswers(next))

/** The columns a save (draft) or a submit changes. Scores only on submit, and only from scoring.ts. */
function answerUpdate(formType: EvaluationFormType, parsed: ReturnType<typeof parsedAnswers>, level: AnswersLevel) {
  return {
    answers: parsed.answers,
    formVersion: EVALUATION_FORMS[formType].version,
    ...(level === 'submit'
      ? { status: 'SUBMITTED' as const, submittedAt: new Date(), totalScore: parsed.score?.total ?? null, maxScore: parsed.score?.maxScore ?? null }
      : {}),
  }
}

// ── Trainee: weekly check-in and Form 1.1 ────────────────────────────────────

/** Opens the trainee's next due weekly check-in or Form 1.1 (the oldest not yet submitted), creating its DRAFT if needed. */
export async function startMyEvaluationForm(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['TRAINEE'])
  const traineeId = ownTraineeId(access)
  const parsed = startOwnFormSchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)
  const { formType } = parsed.data

  let formId: string
  try {
    formId = await prisma.$transaction(async (tx) => {
      await lockTraineeRow(tx, traineeId)
      const trainee = await tx.nutritionProfile.findUnique({ where: { id: traineeId }, select: { trainingStartDate: true } })
      if (!trainee) throw new ActionFailure(NOT_FOUND)
      const schedule = scheduleFor(trainee, await formsAboutTrainee(tx, traineeId))
      const due = nextDue(schedule, formType)
      if (!due) throw new ActionFailure(notDueMessage(schedule))

      // A draft for that period already exists (a double click, a second tab): open it.
      const existing = await tx.nutritionEvaluationForm.findFirst({
        where: { formType, subjectId: traineeId, authorId: traineeId, assessmentPoint: due.assessmentPoint },
        select: { id: true },
      })
      if (existing) return existing.id

      const row = await tx.nutritionEvaluationForm.create({
        data: {
          formType,
          formVersion: EVALUATION_FORMS[formType].version,
          subjectId: traineeId,
          authorId: traineeId,
          monthNumber: due.monthNumber,
          assessmentPoint: due.assessmentPoint,
          answers: EMPTY_ANSWERS,
          createdBy: access.userId,
        },
        select: EVALUATION_FORM_FIELDS,
      })
      await writeAudit(tx, { entity: ENTITY, entityId: row.id, action: 'create', actorId: access.userId, before: null, after: evaluationFormSnapshot(row) })
      return row.id
    })
  } catch (error) {
    return failure(error)
  }

  revalidatePath(TRAINEE_FORMS_PATH)
  redirect(`${TRAINEE_FORMS_PATH}/${formId}`)
}

/** Saves the trainee's own weekly check-in or Form 1.1 while it is a DRAFT. */
export async function saveMyEvaluationForm(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['TRAINEE'])
  return writeOwnForm(ownTraineeId(access), access.userId, formFields(formData), 'draft')
}

/** Submits the trainee's own weekly check-in or Form 1.1. From then on it is locked, unless the primary preceptor reopens it. */
export async function submitMyEvaluationForm(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['TRAINEE'])
  return writeOwnForm(ownTraineeId(access), access.userId, formFields(formData), 'submit')
}

async function writeOwnForm(traineeId: string, actorId: string, fields: Record<string, string>, level: AnswersLevel): Promise<ActionResult> {
  const ref = formRefSchema.safeParse(fields)
  if (!ref.success) return invalid(ref.error)

  let changed: boolean
  try {
    changed = await prisma.$transaction(async (tx) => {
      await lockTraineeRow(tx, traineeId)
      // Found by id AND as the trainee's own form: anyone else's is "not found".
      const before = await tx.nutritionEvaluationForm.findFirst({
        where: { id: ref.data.formId, subjectId: traineeId, authorId: traineeId, formType: { in: ['WEEKLY', 'FORM_1_1'] } },
        select: EVALUATION_FORM_FIELDS,
      })
      if (!before) throw new ActionFailure(NOT_FOUND)
      if (before.status !== 'DRAFT') throw new ActionFailure(ALREADY_SUBMITTED)
      const parsed = parsedAnswers(fields, before.formType, level)
      if (level === 'draft' && sameAnswers(before.answers, parsed.answers)) return false

      const after = await tx.nutritionEvaluationForm.update({
        where: { id: before.id },
        data: answerUpdate(before.formType, parsed, level),
        select: EVALUATION_FORM_FIELDS,
      })
      await writeAudit(tx, {
        entity: ENTITY,
        entityId: before.id,
        action: level === 'submit' ? 'submit' : 'update',
        actorId,
        before: evaluationFormSnapshot(before),
        after: evaluationFormSnapshot(after),
      })
      return true
    })
  } catch (error) {
    return failure(error)
  }

  revalidatePath(TRAINEE_FORMS_PATH)
  revalidatePath(`${TRAINEE_FORMS_PATH}/${ref.data.formId}`)
  if (!changed) return ok('No changes to save.')
  return ok(level === 'submit' ? 'Submitted.' : 'Saved.')
}

// ── Preceptor: Forms 1.2 and 3.1, reopen, weekly comments ───────────────────

/** The primary preceptor opens a trainee's next due Form 1.2 or 3.1 (oldest first), creating their DRAFT if needed. */
export async function startTraineeEvaluation(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const preceptorId = ownPreceptorId(access)
  const parsed = startTraineeFormSchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)
  const { formType, traineeId } = parsed.data

  let formId: string
  try {
    formId = await prisma.$transaction(async (tx) => {
      await lockTraineeRow(tx, traineeId)
      // Only the ACTIVE primary preceptor; a rotation preceptor, a former
      // primary and anyone else get the same answer as for no trainee at all.
      if ((await activePrimaryPreceptorId(tx, traineeId)) !== preceptorId) throw new ActionFailure(TRAINEE_NOT_FOUND)
      const trainee = await tx.nutritionProfile.findUnique({ where: { id: traineeId }, select: { trainingStartDate: true, role: true } })
      if (trainee?.role !== 'TRAINEE') throw new ActionFailure(TRAINEE_NOT_FOUND)
      const schedule = scheduleFor(trainee, await formsAboutTrainee(tx, traineeId))
      const due = nextDue(schedule, formType)
      if (!due) throw new ActionFailure(notDueMessage(schedule))

      const existing = await tx.nutritionEvaluationForm.findFirst({
        where: { formType, subjectId: traineeId, authorId: preceptorId, assessmentPoint: due.assessmentPoint },
        select: { id: true },
      })
      if (existing) return existing.id

      const row = await tx.nutritionEvaluationForm.create({
        data: {
          formType,
          formVersion: EVALUATION_FORMS[formType].version,
          subjectId: traineeId,
          authorId: preceptorId,
          monthNumber: due.monthNumber,
          assessmentPoint: due.assessmentPoint,
          answers: EMPTY_ANSWERS,
          createdBy: access.userId,
        },
        select: EVALUATION_FORM_FIELDS,
      })
      await writeAudit(tx, { entity: ENTITY, entityId: row.id, action: 'create', actorId: access.userId, before: null, after: evaluationFormSnapshot(row) })
      return row.id
    })
  } catch (error) {
    return failure(error)
  }

  revalidatePath(PRECEPTOR_FORMS_PATH)
  redirect(`${PRECEPTOR_FORMS_PATH}/${formId}`)
}

/** Saves the preceptor's own DRAFT Form 1.2 or 3.1, while they are still the trainee's active primary preceptor. */
export async function saveTraineeEvaluation(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  return writePreceptorForm(ownPreceptorId(access), access.userId, formFields(formData), 'draft')
}

/** Submits the preceptor's own Form 1.2 or 3.1. */
export async function submitTraineeEvaluation(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  return writePreceptorForm(ownPreceptorId(access), access.userId, formFields(formData), 'submit')
}

/**
 * Locks the row's trainee, then reads the row again: every write to a
 * trainee's forms holds that lock, so the row cannot change between the read
 * and the write.
 */
async function lockFormForWrite(tx: Db, where: { id: string; formType: { in: EvaluationFormType[] } | EvaluationFormType; authorId?: string }) {
  const found = await tx.nutritionEvaluationForm.findFirst({ where, select: { subjectId: true } })
  if (!found) throw new ActionFailure(NOT_FOUND)
  await lockTraineeRow(tx, found.subjectId)
  const row = await tx.nutritionEvaluationForm.findFirst({ where, select: EVALUATION_FORM_FIELDS })
  if (!row) throw new ActionFailure(NOT_FOUND)
  return row
}

async function writePreceptorForm(preceptorId: string, actorId: string, fields: Record<string, string>, level: AnswersLevel): Promise<ActionResult> {
  const ref = formRefSchema.safeParse(fields)
  if (!ref.success) return invalid(ref.error)

  let changed: boolean
  try {
    changed = await prisma.$transaction(async (tx) => {
      const before = await lockFormForWrite(tx, { id: ref.data.formId, authorId: preceptorId, formType: { in: ['FORM_1_2', 'FORM_3_1'] } })
      if ((await activePrimaryPreceptorId(tx, before.subjectId)) !== preceptorId) {
        throw new ActionFailure("You are no longer this trainee's primary preceptor, so this form can no longer be changed.")
      }
      if (before.status !== 'DRAFT') throw new ActionFailure(ALREADY_SUBMITTED)
      const parsed = parsedAnswers(fields, before.formType, level)
      if (level === 'draft' && sameAnswers(before.answers, parsed.answers)) return false

      const after = await tx.nutritionEvaluationForm.update({
        where: { id: before.id },
        data: answerUpdate(before.formType, parsed, level),
        select: EVALUATION_FORM_FIELDS,
      })
      await writeAudit(tx, {
        entity: ENTITY,
        entityId: before.id,
        action: level === 'submit' ? 'submit' : 'update',
        actorId,
        before: evaluationFormSnapshot(before),
        after: evaluationFormSnapshot(after),
      })
      return true
    })
  } catch (error) {
    return failure(error)
  }

  revalidatePath(PRECEPTOR_FORMS_PATH)
  revalidatePath(`${PRECEPTOR_FORMS_PATH}/${ref.data.formId}`)
  if (!changed) return ok('No changes to save.')
  return ok(level === 'submit' ? 'Submitted.' : 'Saved.')
}

/**
 * The trainee's active primary preceptor reopens a submitted weekly check-in,
 * Form 1.1, 1.2 or 3.1: back to DRAFT for its author, scores cleared until it
 * is submitted again, and logged. Form 1.3 can never be reopened: it is
 * "not found" here like any form the caller may not touch.
 */
export async function reopenEvaluationForm(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const preceptorId = ownPreceptorId(access)
  const ref = formRefSchema.safeParse(formFields(formData))
  if (!ref.success) return invalid(ref.error)

  try {
    await prisma.$transaction(async (tx) => {
      const before = await lockFormForWrite(tx, { id: ref.data.formId, formType: { in: ['WEEKLY', 'FORM_1_1', 'FORM_1_2', 'FORM_3_1'] } })
      if ((await activePrimaryPreceptorId(tx, before.subjectId)) !== preceptorId) throw new ActionFailure(NOT_FOUND)
      if (!SUBMITTED_STATUSES.includes(before.status)) throw new ActionFailure('Only a submitted form can be reopened.')

      const after = await tx.nutritionEvaluationForm.update({
        where: { id: before.id },
        data: { status: 'DRAFT', submittedAt: null, totalScore: null, maxScore: null },
        select: EVALUATION_FORM_FIELDS,
      })
      await writeAudit(tx, {
        entity: ENTITY,
        entityId: before.id,
        action: 'reopen',
        actorId: access.userId,
        before: evaluationFormSnapshot(before),
        after: evaluationFormSnapshot(after),
      })
    })
  } catch (error) {
    return failure(error)
  }

  revalidatePath(PRECEPTOR_FORMS_PATH)
  revalidatePath(`${PRECEPTOR_FORMS_PATH}/${ref.data.formId}`)
  return ok('Reopened. Its author can change it and submit it again.')
}

/** The trainee's active primary preceptor comments on a submitted weekly check-in (or changes the comment). */
export async function commentOnWeeklyCheckIn(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const preceptorId = ownPreceptorId(access)
  const parsed = weeklyCommentSchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)

  try {
    await prisma.$transaction(async (tx) => {
      const before = await lockFormForWrite(tx, { id: parsed.data.formId, formType: 'WEEKLY' })
      if ((await activePrimaryPreceptorId(tx, before.subjectId)) !== preceptorId) throw new ActionFailure(NOT_FOUND)
      if (before.status !== 'SUBMITTED') throw new ActionFailure('Only a submitted check-in can be commented on.')

      const after = await tx.nutritionEvaluationForm.update({
        where: { id: before.id },
        data: { reviewedById: preceptorId, reviewedAt: new Date(), reviewComment: parsed.data.comment },
        select: EVALUATION_FORM_FIELDS,
      })
      await writeAudit(tx, {
        entity: ENTITY,
        entityId: before.id,
        action: 'comment',
        actorId: access.userId,
        before: evaluationFormSnapshot(before),
        after: evaluationFormSnapshot(after),
      })
    })
  } catch (error) {
    return failure(error)
  }

  revalidatePath(PRECEPTOR_FORMS_PATH)
  revalidatePath(`${PRECEPTOR_FORMS_PATH}/${parsed.data.formId}`)
  return ok('Comment saved.')
}

// ── Trainee: Form 1.3 (CONFIDENTIAL) ─────────────────────────────────────────
//
// The row stores authorId NULL, createdBy NULL and the trainee's authorHash;
// its audit rows have actorId NULL and only formOneThreeAuditSnapshot's four
// fields. The trainee's own rows are found only by recomputing their hashes
// (ownFormOneThreeRows). A super_admin who also holds a trainee profile may
// not see an individual 1.3, so they cannot write one either. Nothing here
// logs or returns who the author is.

/** Opens the trainee's next due Form 1.3 (oldest checkpoint first), about their active primary preceptor. */
export async function startMyFormOneThree(): Promise<ActionResult> {
  const access = await requireNutritionRole(['TRAINEE'])
  const traineeId = ownTraineeId(access)
  if (!canSeeIndividualForm13(access)) return fail(FORM_1_3_UNAVAILABLE)

  let point: string
  try {
    point = await prisma.$transaction(async (tx) => {
      await lockTraineeRow(tx, traineeId)
      const trainee = await tx.nutritionProfile.findUnique({ where: { id: traineeId }, select: { trainingStartDate: true } })
      if (!trainee) throw new ActionFailure(NOT_FOUND)
      const preceptorId = await activePrimaryPreceptorId(tx, traineeId)
      if (!preceptorId) throw new ActionFailure(NO_PRECEPTOR)

      const own = await ownFormOneThreeRows(tx, traineeId)
      const schedule = scheduleFor(trainee, own.map((row) => ({ formType: 'FORM_1_3' as const, assessmentPoint: row.assessmentPoint, status: row.status })))
      const due = nextDue(schedule, 'FORM_1_3')
      if (!due) throw new ActionFailure(notDueMessage(schedule))

      // A draft about this preceptor at this checkpoint already exists: open it.
      const existing = own.find((row) => row.subjectId === preceptorId && row.assessmentPoint === due.assessmentPoint)
      if (existing) return existing.assessmentPoint

      const row = await tx.nutritionEvaluationForm.create({
        data: {
          formType: 'FORM_1_3',
          formVersion: EVALUATION_FORMS.FORM_1_3.version,
          subjectId: preceptorId,
          authorId: null,
          authorHash: authorHash(traineeId, preceptorId, due.assessmentPoint),
          monthNumber: due.monthNumber,
          assessmentPoint: due.assessmentPoint,
          answers: EMPTY_ANSWERS,
          createdBy: null,
        },
        select: { id: true, formVersion: true, assessmentPoint: true, subjectId: true },
      })
      await writeFormOneThreeAudit(tx, { entityId: row.id, action: 'create', before: null, after: formOneThreeAuditSnapshot(row) })
      return row.assessmentPoint
    })
  } catch (error) {
    return failure(error)
  }

  revalidatePath(TRAINEE_FORMS_PATH)
  redirect(`${TRAINEE_FORMS_PATH}/confidential/${point}`)
}

/** Saves the trainee's own Form 1.3 while it is a DRAFT. */
export async function saveMyFormOneThree(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['TRAINEE'])
  if (!canSeeIndividualForm13(access)) return fail(FORM_1_3_UNAVAILABLE)
  return writeMyFormOneThree(ownTraineeId(access), formFields(formData), 'draft')
}

/** Submits the trainee's own Form 1.3. It can never be reopened or deleted afterwards. */
export async function submitMyFormOneThree(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['TRAINEE'])
  if (!canSeeIndividualForm13(access)) return fail(FORM_1_3_UNAVAILABLE)
  return writeMyFormOneThree(ownTraineeId(access), formFields(formData), 'submit')
}

async function writeMyFormOneThree(traineeId: string, fields: Record<string, string>, level: AnswersLevel): Promise<ActionResult> {
  const ref = formRefSchema.safeParse(fields)
  if (!ref.success) return invalid(ref.error)

  let result: { changed: boolean; point: string }
  try {
    result = await prisma.$transaction(async (tx) => {
      await lockTraineeRow(tx, traineeId)
      // Only a row whose authorHash is one of this trainee's own: never by an author id.
      const before = (await ownFormOneThreeRows(tx, traineeId)).find((row) => row.id === ref.data.formId)
      if (!before) throw new ActionFailure(NOT_FOUND)
      if (before.status !== 'DRAFT') throw new ActionFailure(ALREADY_SUBMITTED)
      const parsed = parsedAnswers(fields, 'FORM_1_3', level)
      if (level === 'draft' && sameAnswers(before.answers, parsed.answers)) return { changed: false, point: before.assessmentPoint }

      const after = await tx.nutritionEvaluationForm.update({
        where: { id: before.id },
        data: answerUpdate('FORM_1_3', parsed, level),
        select: { formVersion: true, assessmentPoint: true, subjectId: true },
      })
      await writeFormOneThreeAudit(tx, {
        entityId: before.id,
        action: level === 'submit' ? 'submit' : 'update',
        before: formOneThreeAuditSnapshot(before),
        after: formOneThreeAuditSnapshot(after),
      })
      return { changed: true, point: before.assessmentPoint }
    })
  } catch (error) {
    return failure(error)
  }

  revalidatePath(TRAINEE_FORMS_PATH)
  revalidatePath(`${TRAINEE_FORMS_PATH}/confidential/${result.point}`)
  if (!result.changed) return ok('No changes to save.')
  return ok(level === 'submit' ? 'Submitted. Thank you: your name is not stored with it.' : 'Saved.')
}
