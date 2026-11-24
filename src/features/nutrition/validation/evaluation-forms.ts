import { z } from 'zod'
import type { EvaluationFormType } from '@prisma/client'
import { MAX_FORM_TEXT, ratingFieldName, textFieldName } from '@/features/nutrition/config/evaluation-forms'
import { EVALUATION_FORMS } from '@/features/nutrition/config/forms'
import { ratingErrors, scoreForm, type FormScore, type RatingError } from '@/features/nutrition/lib/scoring'
import { findPatientIdentifier } from './privacy'

// Input rules for the evaluation forms (Step 4b). Every evaluation-form
// action parses its form with these before touching the database.
//
// A form posts each rating as rating.<item key> and each free-text answer as
// text.<field key>. Anything else is ignored: the server sets the assessment
// point, the subject, the author, the status and every score itself, so a
// client-sent assessmentPoint or total never reaches the database. A
// rating.* or text.* name that is not in the form's definition is refused.
//
// Two levels:
//  - draft: any rating may be missing and every text may be empty, but what is
//    there must be valid;
//  - submit: every item rated and every required text filled in; scoring.ts
//    then computes the totals.
// At both levels every free text is checked for patient identifiers
// (privacy.ts), because a draft is stored too.

export type AnswersLevel = 'draft' | 'submit'

/** What an evaluation form row stores in `answers`. */
export type EvaluationAnswers = {
  ratings: Record<string, number>
  text: Record<string, string>
}

export type AnswersParse =
  | { success: true; answers: EvaluationAnswers; score: FormScore | null }
  | { success: false; error: z.ZodError }

const WHOLE_NUMBER = /^-?\d+$/

const RATING_MESSAGES: Record<RatingError['problem'], string> = {
  NOT_AN_OBJECT: 'Invalid ratings.',
  UNKNOWN_ITEM: 'This is not an item of this form.',
  NOT_A_WHOLE_NUMBER: 'Pick a rating from the scale.',
  OUT_OF_RANGE: 'Pick a rating from the scale.',
  MISSING: 'Rate this to submit.',
}

/** Reads the answers of a posted evaluation form against the definition of `formType`, at `level`. */
export function parseAnswers(fields: Record<string, string>, formType: EvaluationFormType, level: AnswersLevel): AnswersParse {
  const definition = EVALUATION_FORMS[formType]
  const issues: z.core.$ZodIssue[] = []
  const issue = (path: string, message: string) => issues.push({ code: 'custom', path: [path], message, input: undefined })

  // Ratings: a number for each answered item; anything that is not a whole
  // number is passed on as text, so the scoring check refuses it.
  const ratings: Record<string, unknown> = {}
  for (const [name, raw] of Object.entries(fields)) {
    if (!name.startsWith('rating.')) continue
    const value = raw.trim()
    if (value === '') continue
    ratings[name.slice('rating.'.length)] = WHOLE_NUMBER.test(value) ? Number(value) : value
  }
  const ratingProblems = level === 'submit' ? scoreForm(formType, ratings) : null
  const errors = ratingProblems ? (ratingProblems.ok ? [] : ratingProblems.errors) : ratingErrors(formType, ratings, { requireAll: false })
  for (const error of errors) issue(error.key ? ratingFieldName(error.key) : 'ratings', RATING_MESSAGES[error.problem])

  // Free text: known fields only, trimmed, identifier-checked, limited, and filled in to submit unless optional.
  const known = new Map(definition.freeText.map((field) => [field.key, field]))
  for (const name of Object.keys(fields)) {
    if (name.startsWith('text.') && !known.has(name.slice('text.'.length))) issue(name, 'This is not a field of this form.')
  }
  const text: Record<string, string> = {}
  for (const field of definition.freeText) {
    const value = (fields[textFieldName(field.key)] ?? '').trim()
    const identifier = findPatientIdentifier(value)
    if (identifier) issue(textFieldName(field.key), identifier.message)
    else if (value.length > MAX_FORM_TEXT) issue(textFieldName(field.key), `Keep this under ${MAX_FORM_TEXT} characters.`)
    else if (level === 'submit' && !field.optional && value === '') issue(textFieldName(field.key), 'Fill this in to submit.')
    if (value) text[field.key] = value
  }

  if (issues.length > 0) return { success: false, error: new z.ZodError(issues) }
  return {
    success: true,
    answers: { ratings: ratings as Record<string, number>, text },
    score: ratingProblems?.ok ? ratingProblems.score : null,
  }
}

/** The stored answers, read defensively: anything malformed counts as unanswered. */
export function storedAnswers(value: unknown): EvaluationAnswers {
  const object = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
  const answers = object(value)
  const ratings = Object.fromEntries(Object.entries(object(answers.ratings)).filter((e): e is [string, number] => typeof e[1] === 'number'))
  const text = Object.fromEntries(Object.entries(object(answers.text)).filter((e): e is [string, string] => typeof e[1] === 'string'))
  return { ratings, text }
}

const id = z.uuid({ error: 'Invalid id.' })

/** The trainee starts their own weekly check-in or Form 1.1. Form 1.3 has its own action. */
export const startOwnFormSchema = z.object({
  formType: z.enum(['WEEKLY', 'FORM_1_1'], { error: 'Pick a form to start.' }),
})

/** The primary preceptor starts Form 1.2 or 3.1 for one of their trainees. */
export const startTraineeFormSchema = z.object({
  formType: z.enum(['FORM_1_2', 'FORM_3_1'], { error: 'Pick a form to start.' }),
  traineeId: id,
})

/** Any action on one existing form. */
export const formRefSchema = z.object({ formId: id })

/** The primary preceptor's comment on a weekly check-in: free text like any other, so identifier-checked. */
export const weeklyCommentSchema = z.object({
  formId: id,
  comment: z
    .string({ error: 'Write a comment.' })
    .trim()
    .superRefine((value, ctx) => {
      const identifier = findPatientIdentifier(value)
      if (identifier) ctx.addIssue({ code: 'custom', message: identifier.message })
    })
    .min(1, 'Write a comment.')
    .max(MAX_FORM_TEXT, `Keep the comment under ${MAX_FORM_TEXT} characters.`),
})
