import 'server-only'
import { createHash } from 'node:crypto'
import type { EvaluationFormType, Prisma, SubmissionStatus } from '@prisma/client'
import { dueForms, type DueForm, type ExistingForm, type Schedule } from '@/features/nutrition/lib/scheduler'
import type { Snapshot } from './audit'

// Shared by the evaluation-form actions and loaders (Step 4b). Nothing here
// checks roles: every caller has already run requireNutritionRole.

export type Db = Prisma.TransactionClient

/** The trainee's ACTIVE primary preceptor, or null. 3d keeps at most one active assignment per trainee. */
export async function activePrimaryPreceptorId(db: Db, traineeId: string): Promise<string | null> {
  const assignment = await db.nutritionPreceptorAssignment.findFirst({ where: { traineeId, active: true }, select: { preceptorId: true } })
  return assignment?.preceptorId ?? null
}

/** The trainees for whom this preceptor holds an ACTIVE primary assignment. Rotation preceptors have none. */
export async function activeTraineeIds(db: Db, preceptorId: string): Promise<string[]> {
  const assignments = await db.nutritionPreceptorAssignment.findMany({ where: { preceptorId, active: true }, select: { traineeId: true } })
  return assignments.map((assignment) => assignment.traineeId)
}

/**
 * The forms ABOUT a trainee, for the scheduler: weekly check-ins, 1.1, 1.2 and
 * 3.1. Never Form 1.3, whose subject is a preceptor; the trainee's own 1.3 rows
 * come only from form-1-3.ts, by hash.
 */
export async function formsAboutTrainee(db: Db, traineeId: string): Promise<ExistingForm[]> {
  return db.nutritionEvaluationForm.findMany({
    where: { subjectId: traineeId, formType: { not: 'FORM_1_3' } },
    select: { formType: true, assessmentPoint: true, status: true },
  })
}

/** The trainee's schedule from their stored start date, at the server's current time. */
export function scheduleFor(trainee: { trainingStartDate: Date | null }, existing: readonly ExistingForm[]): Schedule {
  return dueForms(trainee, new Date(), existing)
}

/**
 * The form of this type the server will open next: the OLDEST one not yet
 * submitted, current or overdue. Forms are filled in order, and the
 * assessment point always comes from here, never from the client.
 */
export function nextDue(schedule: Schedule, formType: EvaluationFormType): DueForm | null {
  if (schedule.state !== 'IN_TRAINING' && schedule.state !== 'FINISHED') return null
  return schedule.forms.find((form) => form.formType === formType && form.status !== 'SUBMITTED') ?? null
}

/** Why nothing of this type can be started now, for the person asking. */
export function notDueMessage(schedule: Schedule): string {
  if (schedule.state === 'START_DATE_NOT_SET') return 'The training start date is not set yet, so no form is due.'
  if (schedule.state === 'NOT_STARTED') return `Training starts on ${schedule.startsOn}, so no form is due yet.`
  return 'This form is not due now.'
}

/** The fields of an evaluation form row the actions read and audit. */
export const EVALUATION_FORM_FIELDS = {
  id: true,
  formType: true,
  formVersion: true,
  subjectId: true,
  authorId: true,
  monthNumber: true,
  assessmentPoint: true,
  answers: true,
  totalScore: true,
  maxScore: true,
  status: true,
  submittedAt: true,
  reviewedById: true,
  reviewedAt: true,
  reviewComment: true,
} as const

export type EvaluationFormRow = Prisma.NutritionEvaluationFormGetPayload<{ select: typeof EVALUATION_FORM_FIELDS }>

/** Statuses after which a form is locked for its author, until a reopen. */
export const SUBMITTED_STATUSES: readonly SubmissionStatus[] = ['SUBMITTED', 'APPROVED']

/**
 * An evaluation form (never Form 1.3) for the audit log WITHOUT its free text,
 * like caseLogSnapshot: the answered rating and text keys, and a SHA-256 of
 * the answers, which shows whether they changed without repeating them. The
 * review comment appears only as its length.
 */
export function evaluationFormSnapshot(row: EvaluationFormRow): Snapshot {
  const answers = row.answers !== null && typeof row.answers === 'object' && !Array.isArray(row.answers) ? row.answers : {}
  const ratings = answers.ratings !== null && typeof answers.ratings === 'object' && !Array.isArray(answers.ratings) ? answers.ratings : {}
  const text = answers.text !== null && typeof answers.text === 'object' && !Array.isArray(answers.text) ? answers.text : {}
  return {
    id: row.id,
    formType: row.formType,
    formVersion: row.formVersion,
    subjectId: row.subjectId,
    authorId: row.authorId,
    monthNumber: row.monthNumber,
    assessmentPoint: row.assessmentPoint,
    status: row.status,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    totalScore: row.totalScore,
    maxScore: row.maxScore,
    ratingKeys: Object.keys(ratings).sort().join(','),
    textKeys: Object.keys(text).sort().join(','),
    answersSha256: createHash('sha256').update(JSON.stringify(row.answers)).digest('hex'),
    reviewedById: row.reviewedById,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewCommentLength: row.reviewComment?.length ?? 0,
  }
}

/** A calendar day in Karachi time, e.g. 2026-10-11. */
export const karachiDate = (date: Date | null) => (date ? date.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }) : null)
