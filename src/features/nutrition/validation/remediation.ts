import { z } from 'zod'
import { MAX_FORM_TEXT } from '@/features/nutrition/config/evaluation-forms'
import { EPA_KEYS } from '@/features/nutrition/config/epas'
import { findPatientIdentifier } from './privacy'

// Input rules for the 4-step remediation module (Step 6c). Only the fields
// named here are read. Free text (the deficiency and the activity) is checked
// for patient identifiers.

export const REMEDIATION_OUTCOMES = ['IN_PROGRESS', 'MET', 'NOT_MET'] as const
export type RemediationOutcome = (typeof REMEDIATION_OUTCOMES)[number]

const id = z.uuid({ error: 'Invalid id.' })

function noPatientIdentifiers(value: string, ctx: z.RefinementCtx) {
  const identifier = findPatientIdentifier(value)
  if (identifier) ctx.addIssue({ code: 'custom', message: identifier.message })
}

const text = (empty: string) =>
  z
    .string({ error: empty })
    .trim()
    .min(1, empty)
    .max(MAX_FORM_TEXT, `Keep it under ${MAX_FORM_TEXT} characters.`)
    .superRefine(noPatientIdentifiers)

const optionalEpa = z
  .union([z.literal(''), z.string().refine((value) => EPA_KEYS.includes(value), 'Pick an EPA from the list.')])
  .optional()
  .transform((value) => value || null)

/** A real calendar day, "YYYY-MM-DD". */
const day = z.string({ error: 'Use a date like 2026-10-11.' }).refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const time = Date.parse(`${value}T00:00:00Z`)
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value
}, 'Use a date like 2026-10-11.')

/** Step 1: flag a deficiency, opening a plan (createPlan) or adding to the open one (flagDeficiency). */
export const createPlanSchema = z.object({ traineeId: id, deficiency: text('Describe the deficiency or unmet milestone.'), epaKey: optionalEpa })
export const flagDeficiencySchema = z.object({ planId: id, deficiency: text('Describe the deficiency or unmet milestone.'), epaKey: optionalEpa })
/** Step 2: the targeted learning activity (free text). */
export const activitySchema = z.object({ stepId: id, activity: text('Describe the learning activity.') })
/** Step 3: the reassessment date, and later the WPBA that reassessed it. */
export const scheduleSchema = z.object({ stepId: id, reassessmentDate: day })
export const linkWpbaSchema = z.object({ stepId: id, wpbaId: id })
/** Step 4: the outcome. */
export const outcomeSchema = z.object({ stepId: id, outcome: z.enum(REMEDIATION_OUTCOMES, { error: 'Pick Met, Not met or In progress.' }) })
export const closePlanSchema = z.object({ planId: id })
