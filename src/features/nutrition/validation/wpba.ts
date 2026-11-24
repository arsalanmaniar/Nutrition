import { WpbaType } from '@prisma/client'
import { z } from 'zod'
import { MAX_FORM_TEXT, ratingFieldName } from '@/features/nutrition/config/evaluation-forms'
import { DOPS_OTHER_PROCEDURE, DOPS_PROCEDURES } from '@/features/nutrition/config/forms'
import { findPatientIdentifier } from './privacy'

// Input rules for filing a WPBA (Step 5a). The action parses its form with
// these, then scores the ratings with server/wpba-core.ts.
//
// Ratings post as rating.<item key>, as on the evaluation forms. Every other
// field is read only if named here: a client-sent total, passed, maxScore,
// millerLevel or anything else is dropped, because the server sets those.
// Free text (the feedback and a DOPS "other" description) is checked for
// patient identifiers, like every free text in the module.

export const MAX_PROCEDURE_TEXT = 200

const id = z.uuid({ error: 'Invalid id.' })

function noPatientIdentifiers(value: string, ctx: z.RefinementCtx) {
  const identifier = findPatientIdentifier(value)
  if (identifier) ctx.addIssue({ code: 'custom', message: identifier.message })
}

/** A real calendar day, "YYYY-MM-DD". */
const day = z.string({ error: 'Use a date like 2026-10-11.' }).refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const time = Date.parse(`${value}T00:00:00Z`)
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value
}, 'Use a date like 2026-10-11.')

const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .superRefine(noPatientIdentifiers)
    .max(max, tooLong)
    .optional()
    .transform((value) => value || null)

export const wpbaInputSchema = z
  .object({
    type: z.enum(WpbaType, { error: 'Pick an assessment type.' }),
    traineeId: id,
    assessedOn: day,
    caseLogId: z
      .union([z.literal(''), id])
      .optional()
      .transform((value) => value || null),
    procedure: z
      .string()
      .trim()
      .optional()
      .transform((value) => value || null),
    procedureOther: optionalText(MAX_PROCEDURE_TEXT, `Keep the description under ${MAX_PROCEDURE_TEXT} characters.`),
    // A checkbox: present ("on" or "true") means a critical error. OSCE only.
    criticalError: z
      .enum(['on', 'true', 'false'], { error: 'Invalid value.' })
      .optional()
      .transform((value) => value === 'on' || value === 'true'),
    feedback: z
      .string({ error: 'Write your feedback.' })
      .trim()
      .superRefine(noPatientIdentifiers)
      .min(1, 'Write your feedback.')
      .max(MAX_FORM_TEXT, `Keep the feedback under ${MAX_FORM_TEXT} characters.`),
  })
  .superRefine((input, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
    if (input.type === 'CBD' && !input.caseLogId) issue('caseLogId', 'Pick the submitted case log under discussion.')
    if (input.type !== 'CBD' && input.caseLogId) issue('caseLogId', 'Only a CbD links a case log.')
    if (input.type === 'DOPS') {
      const known = DOPS_PROCEDURES.some((procedure) => procedure.key === input.procedure)
      if (input.procedure === DOPS_OTHER_PROCEDURE.key) {
        if (!input.procedureOther) issue('procedureOther', 'Describe the procedure.')
      } else if (!known) {
        issue('procedure', 'Pick the procedure observed.')
      }
    } else if (input.procedure || input.procedureOther) {
      issue('procedure', 'Only a DOPS records a procedure.')
    }
  })
  .transform((input) => ({
    type: input.type,
    traineeId: input.traineeId,
    assessedOn: input.assessedOn,
    caseLogId: input.caseLogId,
    // What NutritionWpba.procedure stores: a listed key, or the "other" description.
    procedure: input.type !== 'DOPS' ? null : input.procedure === DOPS_OTHER_PROCEDURE.key ? input.procedureOther : input.procedure,
    criticalError: input.type === 'OSCE' ? input.criticalError : false,
    feedback: input.feedback,
  }))

export type WpbaInput = z.infer<typeof wpbaInputSchema>

const WHOLE_NUMBER = /^-?\d+$/

/** The posted ratings: a number for each whole-number answer; anything else stays text, so scoring refuses it. */
export function ratingsFromFields(fields: Record<string, string>): Record<string, unknown> {
  const ratings: Record<string, unknown> = {}
  for (const [name, raw] of Object.entries(fields)) {
    if (!name.startsWith('rating.')) continue
    const value = raw.trim()
    if (value === '') continue
    ratings[name.slice('rating.'.length)] = WHOLE_NUMBER.test(value) ? Number(value) : value
  }
  return ratings
}

const RATING_MESSAGES: Record<string, string> = {
  NOT_AN_OBJECT: 'Invalid ratings.',
  UNKNOWN_ITEM: 'This is not an item of this assessment.',
  NOT_A_WHOLE_NUMBER: 'Pick a rating from the scale.',
  OUT_OF_RANGE: 'Pick a rating from the scale.',
  MISSING: 'Rate this item.',
}

/** Scoring problems as field errors under the names the form posts. */
export function ratingFieldErrors(errors: readonly { key: string; problem: string }[]): Record<string, string> {
  const fieldErrors: Record<string, string> = {}
  for (const error of errors) {
    const name = error.key ? ratingFieldName(error.key) : 'ratings'
    fieldErrors[name] ??= RATING_MESSAGES[error.problem] ?? 'Invalid rating.'
  }
  return fieldErrors
}
