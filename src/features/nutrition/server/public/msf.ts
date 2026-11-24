'use server'

import 'server-only'
import { prisma } from '@/lib/prisma'
import { MSF_DOMAINS, MSF_FORM_VERSION, MSF_SCALE } from '@/features/nutrition/config/msf'
import { fail, ok, type ActionResult } from '@/features/nutrition/lib/action-result'
import { MSF_TOKEN_PATTERN, msfAnswers, msfResponseSchema } from '@/features/nutrition/validation/msf'
import { invalid } from '../action-helpers'
import { isOpen } from '../msf-core'
import { hashMsfToken } from '../msf-token'

// The PUBLIC side of MSF (Step 6c): the form behind /nutrition/msf/[token],
// for an assessor with no login. Deliberately unguarded, and kept apart from
// server/actions and server/queries (portal-guard-coverage.test.ts checks
// that this folder never imports the guard and touches only the nutr_msf_*
// models). Rate limiting is done by a Vercel Firewall rule, outside the code.
//
// A token is looked up by its sha256 hash only. A link that is unknown, used,
// expired or revoked gets ONE generic message, so a caller learns nothing
// about which. A link works once: the invite is claimed (usedAt set) by a
// conditional update inside the transaction, and the response's unique
// inviteId stops a second row even if two submits race.
//
// The response row holds the answers and the optional comment only: no name,
// no account, no IP, no time beyond the row's own. The comment is checked
// for patient identifiers before anything is written. No audit row is
// written here (this module touches only nutr_msf_*); the invite's usedAt is
// the record that the link was answered.

const DEAD_LINK = 'This feedback link is not valid any more. Ask the person who sent it for a new one.'

export interface PublicMsfForm {
  formVersion: number
  domains: { key: string; label: string }[]
  scale: { min: number; max: number; anchors: Record<number, string> }
  /** The last day the link works (UTC date). */
  expiresOn: string
}

const INVITE_FIELDS = { id: true, usedAt: true, expiresAt: true, createdAt: true } as const

/** The form for a working link, or null for any other token: no reason is given. */
export async function getPublicMsfForm(token: string): Promise<PublicMsfForm | null> {
  if (!MSF_TOKEN_PATTERN.test(token)) return null
  const invite = await prisma.nutritionMsfInvite.findUnique({ where: { tokenHash: hashMsfToken(token) }, select: INVITE_FIELDS })
  if (!invite || !isOpen(invite, new Date())) return null
  return {
    formVersion: MSF_FORM_VERSION,
    domains: MSF_DOMAINS.map(({ key, label }) => ({ key, label })),
    scale: { min: MSF_SCALE.min, max: MSF_SCALE.max, anchors: { ...MSF_SCALE.anchors } },
    expiresOn: invite.expiresAt.toISOString().slice(0, 10),
  }
}

/** Stores one assessor's answers for a working link, and closes the link. */
export async function submitMsfResponse(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const fields: Record<string, string> = {}
  for (const [key, value] of formData.entries()) if (typeof value === 'string') fields[key] = value
  if (!MSF_TOKEN_PATTERN.test(fields.token ?? '')) return fail(DEAD_LINK)
  const parsed = msfResponseSchema.safeParse(fields)
  if (!parsed.success) return invalid(parsed.error)
  const now = new Date()

  const stored = await prisma.$transaction(async (tx) => {
    const invite = await tx.nutritionMsfInvite.findUnique({ where: { tokenHash: hashMsfToken(parsed.data.token) }, select: INVITE_FIELDS })
    if (!invite || !isOpen(invite, now)) return false
    // Claim the link: only one submit can turn usedAt from NULL to a time.
    const claimed = await tx.nutritionMsfInvite.updateMany({ where: { id: invite.id, usedAt: null }, data: { usedAt: now } })
    if (claimed.count !== 1) return false
    await tx.nutritionMsfResponse.create({
      data: {
        inviteId: invite.id,
        formVersion: MSF_FORM_VERSION,
        answers: msfAnswers(parsed.data),
        comments: parsed.data.comments,
        createdBy: null,
      },
      select: { id: true },
    })
    return true
  }).catch((error: unknown) => {
    // A unique violation means a racing submit already answered this link.
    if (error instanceof Error && 'code' in error && (error as { code?: string }).code === 'P2002') return false
    throw error
  })

  return stored ? ok('Thank you. Your feedback has been recorded.') : fail(DEAD_LINK)
}
