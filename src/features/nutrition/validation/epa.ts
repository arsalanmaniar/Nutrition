import { EpaLevel, MillerLevel } from '@prisma/client'
import { z } from 'zod'
import { MAX_FORM_TEXT } from '@/features/nutrition/config/evaluation-forms'
import { EPA_KEYS } from '@/features/nutrition/config/epas'
import { findPatientIdentifier } from './privacy'

// Input rules for the EPA entrustment dashboard (Step 6a). The action parses
// its form with this. Only these fields are read: a client-sent assessorId,
// assessedOn, createdBy or anything else is dropped, because the server sets
// those. Whether the level fits the Miller level is the server's check
// (server/epa-core.ts), not the schema's, so the refusal can say why.

const id = z.uuid({ error: 'Invalid id.' })

function noPatientIdentifiers(value: string, ctx: z.RefinementCtx) {
  const identifier = findPatientIdentifier(value)
  if (identifier) ctx.addIssue({ code: 'custom', message: identifier.message })
}

export const epaInputSchema = z.object({
  traineeId: id,
  epaKey: z.string({ error: 'Pick an EPA.' }).refine((value) => EPA_KEYS.includes(value), 'Pick an EPA from the list.'),
  level: z.enum(EpaLevel, { error: 'Pick an entrustment level (E1 to E5).' }),
  millerLevel: z.enum(MillerLevel, { error: "Pick a Miller level." }),
  notes: z
    .string()
    .trim()
    .superRefine(noPatientIdentifiers)
    .max(MAX_FORM_TEXT, `Keep the notes under ${MAX_FORM_TEXT} characters.`)
    .optional()
    .transform((value) => value || null),
})

export type EpaInput = z.infer<typeof epaInputSchema>

export const traineeIdSchema = z.object({ traineeId: id })
