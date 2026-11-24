// Shared set-up for the Step 4b evaluation-form tests (not itself a test file).
// Like actors.ts, it works on the in-memory Prisma fake; the real guard runs.

import type { EvaluationFormType, SubmissionStatus } from '@prisma/client'
import { ratingFieldName, textFieldName } from '@/features/nutrition/config/evaluation-forms'
import { EVALUATION_FORMS } from '@/features/nutrition/config/forms'
import type { ActionResult } from '@/features/nutrition/lib/action-result'
import { RedirectSignal } from '../../auth/__tests__/fakes'
import { authorHash } from '../author-hash'
import { seedAssignment, seedProfile, signIn, type SeededProfile } from './actors'
import { fakePrisma } from './fake-prisma'

/** A fake hash key for the tests, exactly 32 characters. Never a real one. */
export const KEY = 'cdn-ep-test-key-0123456789abcdef'

/** Noon in Karachi on 15 April 2026. */
export const NOW = new Date('2026-04-15T07:00:00Z')

export const NOT_FOUND = { status: 'error', message: 'This form was not found.' }
export const TRAINEE_NOT_FOUND = { status: 'error', message: 'This trainee was not found among your trainees.' }
export const ALREADY_SUBMITTED = { status: 'error', message: 'This form has already been submitted and can no longer be changed.' }
export const ALREADY_EXISTS = { status: 'error', message: 'This form already exists. Reload the page to continue it.' }
export const FORM_1_3_UNAVAILABLE = { status: 'error', message: 'Form 1.3 is not available right now. Nothing was saved.' }
export const NOT_DUE = { status: 'error', message: 'This form is not due now.' }

type Row = Record<string, unknown>
export const forms = () => fakePrisma.tables.nutritionEvaluationForm as Row[]
export const formById = (id: string) => forms().find((row) => row.id === id) as Row
export const audit = () => fakePrisma.tables.nutritionAuditLog as Row[]

/** A trainee whose training started on `start` (a Karachi day), or with no start date. */
export function seedTrainee(start: string | null, fields: Partial<{ fullName: string; isActive: boolean }> = {}): SeededProfile {
  return seedProfile('TRAINEE', { trainingStartDate: start ? new Date(`${start}T00:00:00Z`) : null, ...fields })
}

export function signInAs(profile: SeededProfile): SeededProfile {
  signIn(profile.authUserId as string, profile.email)
  return profile
}

/** A trainee with an active primary preceptor. */
export function pair(start: string | null = '2026-01-01') {
  const trainee = seedTrainee(start, { fullName: 'Ayesha Trainee' })
  const preceptor = seedProfile('PRECEPTOR', { fullName: 'Dr Primary' })
  const assignment = seedAssignment(trainee.id, preceptor.id)
  return { trainee, preceptor, assignment }
}

/** Every item of a form rated: one value for all, or a function of the item's position. */
export function ratingFields(formType: EvaluationFormType, value: number | ((index: number) => number) = 3): Record<string, string> {
  const keys = EVALUATION_FORMS[formType].sections.flatMap((section) => section.items.map((item) => item.key))
  return Object.fromEntries(keys.map((key, i) => [ratingFieldName(key), String(typeof value === 'number' ? value : value(i))]))
}

/** Every free-text field filled in. */
export function textFields(formType: EvaluationFormType, text = 'Steady progress this period.'): Record<string, string> {
  return Object.fromEntries(EVALUATION_FORMS[formType].freeText.map((field) => [textFieldName(field.key), text]))
}

/** What a complete form posts. */
export const complete = (formType: EvaluationFormType, value: number | ((index: number) => number) = 3) => ({
  ...ratingFields(formType, value),
  ...textFields(formType),
})

const monthOf = (point: string) => (point.startsWith('M') ? Number(point.slice(1)) : 1)

/** An evaluation form as the actions store it (SUBMITTED unless told otherwise). Not Form 1.3: see seedFormOneThree. */
export function seedForm(
  formType: Exclude<EvaluationFormType, 'FORM_1_3'>,
  subjectId: string,
  authorId: string,
  assessmentPoint: string,
  fields: Partial<{ status: SubmissionStatus; monthNumber: number; answers: unknown; reviewComment: string }> = {},
): Row {
  const status = fields.status ?? 'SUBMITTED'
  return fakePrisma.seed('nutritionEvaluationForm', {
    formType,
    formVersion: 1,
    subjectId,
    authorId,
    monthNumber: fields.monthNumber ?? monthOf(assessmentPoint),
    assessmentPoint,
    answers: fields.answers ?? { ratings: {}, text: {} },
    status,
    submittedAt: status === 'SUBMITTED' ? new Date('2026-04-01T08:00:00Z') : null,
    createdBy: 'auth-seed',
    ...(fields.reviewComment ? { reviewComment: fields.reviewComment } : {}),
  })
}

/** Every form of weeks 1..weeks and months 1..months, submitted (Form 1.2 at the checkpoints by `preceptorId`). */
export function seedHistory(traineeId: string, preceptorId: string, weeks: number, months: number): void {
  for (let w = 1; w <= weeks; w++) seedForm('WEEKLY', traineeId, traineeId, `W${String(w).padStart(2, '0')}`)
  for (let m = 1; m <= months; m++) {
    const point = `M${String(m).padStart(2, '0')}`
    seedForm('FORM_1_1', traineeId, traineeId, point)
    seedForm('FORM_3_1', traineeId, preceptorId, point)
    if ([4, 8, 12].includes(m)) seedForm('FORM_1_2', traineeId, preceptorId, point)
  }
}

/** A Form 1.3 exactly as the actions store it: no author, only the author's hash. */
export function seedFormOneThree(
  authorId: string,
  preceptorId: string,
  point: 'M04' | 'M08' | 'M12' = 'M04',
  fields: Partial<{ status: SubmissionStatus; rating: number; comments: Partial<Record<'preceptor_comments' | 'program_comments', string>> }> = {},
): Row {
  const keys = EVALUATION_FORMS.FORM_1_3.sections.flatMap((section) => section.items.map((item) => item.key))
  const rating = fields.rating ?? 3
  const status = fields.status ?? 'SUBMITTED'
  return fakePrisma.seed('nutritionEvaluationForm', {
    formType: 'FORM_1_3',
    formVersion: 1,
    subjectId: preceptorId,
    authorId: null,
    authorHash: authorHash(authorId, preceptorId, point),
    monthNumber: Number(point.slice(1)),
    assessmentPoint: point,
    answers: { ratings: Object.fromEntries(keys.map((key) => [key, rating])), text: { ...(fields.comments ?? {}) } },
    totalScore: status === 'SUBMITTED' ? rating * keys.length : null,
    maxScore: status === 'SUBMITTED' ? 132 : null,
    status,
    submittedAt: status === 'SUBMITTED' ? new Date('2026-04-10T08:00:00Z') : null,
    createdBy: null,
  })
}

/** An action that redirects on success: the redirect path, or the result it returned instead. */
export async function outcome(attempt: Promise<ActionResult>): Promise<{ redirect: string } | ActionResult> {
  try {
    return await attempt
  } catch (error) {
    if (error instanceof RedirectSignal) return { redirect: error.path }
    throw error
  }
}

/** Where the guard sent the caller; fails the test if the call went through. */
export async function refusal(attempt: Promise<unknown>): Promise<string> {
  try {
    await attempt
  } catch (error) {
    if (error instanceof RedirectSignal) return error.path
    throw error
  }
  throw new Error('expected the guard to refuse, but the call went through')
}
