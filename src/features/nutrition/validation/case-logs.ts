import { CaseFormType, EpaLevel } from '@prisma/client'
import { z } from 'zod'
import {
  AGE_BANDS,
  DIAGNOSIS_CATEGORIES,
  caseLogFields,
  dataFieldName,
  type CaseLogField,
  type ListOption,
} from '@/features/nutrition/config/case-log-forms'
import { findPatientIdentifier } from './privacy'

// Input rules for the e-logbook. Every case-log action parses its form with
// these before touching the database.
//
// Two levels:
//  - draft: the rotation, the EPA level and every Form A–D field may be empty.
//    Only the age band and the diagnosis category are needed, because the
//    table requires them;
//  - submit: the rotation, the EPA level and every required field must also be
//    filled in.
// At both levels every free-text value is checked for patient identifiers
// (validation/privacy.ts), because a draft is stored too.
//
// Input names are the ones the case-log form posts: the case details by column
// name, and each Form A–D field as data.<key>. Field errors come back under the
// same names. Anything else in the form, such as a caseCode, a traineeId or a
// status, is dropped: the server sets those itself.

export type CaseLogLevel = 'draft' | 'submit'

export interface CaseLogInput {
  formType: CaseFormType
  rotationId: string | null
  ageBand: string
  diagnosisCategory: string
  epaLevel: EpaLevel | null
  /** Only the fields with text in them, trimmed, keyed by field key. */
  data: Record<string, string>
}

const id = z.uuid({ error: 'Invalid id.' })

const formType = z.enum(CaseFormType, { error: 'Pick a form: A, B, C or D.' })

/** For a new log: read first, because it decides which fields the rest is checked against. */
export const newCaseLogSchema = z.object({ formType })

/** For an existing log. The action checks formType against the stored log. */
export const caseLogRefSchema = z.object({ logId: id, formType })

const keys = (options: readonly ListOption[]) => options.map((option) => option.key) as [string, ...string[]]

const ageBand = z.enum(keys(AGE_BANDS), { error: 'Pick an age band.' })
const diagnosisCategory = z.enum(keys(DIAGNOSIS_CATEGORIES), { error: 'Pick a diagnosis category.' })

const draftDetails = z.object({
  rotationId: z
    .union([z.literal(''), z.uuid({ error: 'Pick a rotation from the list.' })])
    .optional()
    .transform((value) => value || null),
  ageBand,
  diagnosisCategory,
  epaLevel: z
    .union([z.literal(''), z.enum(EpaLevel, { error: 'Pick an EPA level from the list.' })])
    .optional()
    .transform((value) => value || null),
})

const submitDetails = z.object({
  rotationId: z.uuid({ error: 'Pick a rotation to submit.' }),
  ageBand,
  diagnosisCategory,
  epaLevel: z.enum(EpaLevel, { error: 'Pick an EPA level to submit.' }),
})

/** One free-text field: trimmed, checked for patient identifiers first, then length, then (to submit) presence. */
function freeText(field: CaseLogField, required: boolean) {
  return z
    .string({ error: 'Invalid text.' })
    .trim()
    .superRefine((value, ctx) => {
      const identifier = findPatientIdentifier(value)
      if (identifier) ctx.addIssue({ code: 'custom', message: identifier.message })
    })
    .max(field.maxLength, `Keep this under ${field.maxLength} characters.`)
    .refine((value) => !required || value.length > 0, 'Fill this in to submit.')
}

function fieldsSchema(type: CaseFormType, level: CaseLogLevel) {
  const shape: Record<string, z.ZodType<string>> = {}
  for (const field of caseLogFields(type)) shape[dataFieldName(field.key)] = freeText(field, level === 'submit' && field.required)
  return z.object(shape)
}

export type CaseLogParse = { success: true; data: CaseLogInput } | { success: false; error: z.ZodError }

/**
 * Checks a submitted case-log form against form `type` at `level`. All
 * problems are reported at once: the case details and every field.
 */
export function parseCaseLog(fields: Record<string, string>, type: CaseFormType, level: CaseLogLevel): CaseLogParse {
  // A field the browser did not send counts as empty.
  const input: Record<string, string> = {}
  for (const field of caseLogFields(type)) input[dataFieldName(field.key)] = ''
  Object.assign(input, fields)

  const details = level === 'submit' ? submitDetails.safeParse(input) : draftDetails.safeParse(input)
  const text = fieldsSchema(type, level).safeParse(input)
  if (!details.success || !text.success) {
    return { success: false, error: new z.ZodError([...(details.error?.issues ?? []), ...(text.error?.issues ?? [])]) }
  }

  const data: Record<string, string> = {}
  for (const field of caseLogFields(type)) {
    const value = text.data[dataFieldName(field.key)]
    if (value) data[field.key] = value
  }
  return { success: true, data: { formType: type, ...details.data, data } }
}
