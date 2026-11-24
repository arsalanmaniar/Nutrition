import { z } from 'zod'
import { MAX_ASSESSOR_NAME, MAX_MSF_COMMENT, MSF_ASSESSOR_ROLES, MSF_DOMAINS, MSF_SCALE, msfRatingField } from '@/features/nutrition/config/msf'
import { findPatientIdentifier } from './privacy'

// Input rules for MSF (Step 6c): the preceptor's invite and the assessor's
// public response. Only the fields named here are read; anything else a client
// sends is dropped. Free text (the assessor's name and the comment) is checked
// for patient identifiers, like every free text in the module.

const id = z.uuid({ error: 'Invalid id.' })

function noPatientIdentifiers(value: string, ctx: z.RefinementCtx) {
  const identifier = findPatientIdentifier(value)
  if (identifier) ctx.addIssue({ code: 'custom', message: identifier.message })
}

const ROLE_KEYS = MSF_ASSESSOR_ROLES.map((role) => role.key)

export const msfInviteSchema = z.object({
  traineeId: id,
  assessorName: z
    .string({ error: "Enter the assessor's name." })
    .trim()
    .min(1, "Enter the assessor's name.")
    .max(MAX_ASSESSOR_NAME, `Keep the name under ${MAX_ASSESSOR_NAME} characters.`)
    .superRefine(noPatientIdentifiers),
  assessorRole: z.string({ error: 'Pick a profession.' }).refine((value) => ROLE_KEYS.includes(value), 'Pick a profession from the list.'),
})

export const msfRevokeSchema = z.object({ inviteId: id })

/** A raw link token: 32 random bytes as base64url (43 characters). Anything else is no token. */
export const MSF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

const rating = z.coerce
  .number({ error: 'Pick a rating from 1 to 5.' })
  .int('Pick a rating from 1 to 5.')
  .min(MSF_SCALE.min, 'Pick a rating from 1 to 5.')
  .max(MSF_SCALE.max, 'Pick a rating from 1 to 5.')

export const msfResponseSchema = z.object({
  token: z.string().regex(MSF_TOKEN_PATTERN, 'This link is not valid.'),
  ...Object.fromEntries(MSF_DOMAINS.map((domain) => [msfRatingField(domain.key), rating])),
  comments: z
    .string()
    .trim()
    .superRefine(noPatientIdentifiers)
    .max(MAX_MSF_COMMENT, `Keep the comment under ${MAX_MSF_COMMENT} characters.`)
    .optional()
    .transform((value) => value || null),
}) as unknown as z.ZodType<{ token: string; comments: string | null } & Record<string, number>>

/** The answers as stored in NutritionMsfResponse.answers: { <domain key>: 1..5 }. */
export function msfAnswers(parsed: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(MSF_DOMAINS.map((domain) => [domain.key, parsed[msfRatingField(domain.key)] as number]))
}
