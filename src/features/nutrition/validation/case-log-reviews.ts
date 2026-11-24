import { z } from 'zod'
import { findPatientIdentifier } from './privacy'

// Input rules for the preceptor's case-log review. Returning a log (REJECTED)
// needs a comment saying what to change; an approval may have one. A comment
// is free text like any other in the module, so it is checked for patient
// identifiers too (Section 0, rule 8). Anything else in the form, such as an
// EPA level, a status or the case text, is dropped: a review changes only the
// status and the review columns.

const id = z.uuid({ error: 'Invalid id.' })

const MAX = 2000

function noPatientIdentifiers(value: string, ctx: z.RefinementCtx) {
  const identifier = findPatientIdentifier(value)
  if (identifier) ctx.addIssue({ code: 'custom', message: identifier.message })
}

export const approveCaseLogSchema = z.object({
  logId: id,
  comment: z
    .string()
    .trim()
    .superRefine(noPatientIdentifiers)
    .max(MAX, `Keep the comment under ${MAX} characters.`)
    .optional()
    .transform((value) => value || null),
})

export const rejectCaseLogSchema = z.object({
  logId: id,
  comment: z
    .string({ error: 'Say what the trainee should change.' })
    .trim()
    .superRefine(noPatientIdentifiers)
    .min(5, 'Say what the trainee should change (at least 5 characters).')
    .max(MAX, `Keep the comment under ${MAX} characters.`),
})
