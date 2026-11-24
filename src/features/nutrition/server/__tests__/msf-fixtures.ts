// Shared setup for the Step 6c MSF tests (not itself a test file).

import { MSF_DOMAINS, msfRatingField } from '../../config/msf'
import { hashMsfToken, newMsfToken } from '../msf-token'
import { fakePrisma } from './fake-prisma'

type Row = Record<string, unknown>

export const DEAD_LINK = { status: 'error', message: 'This feedback link is not valid any more. Ask the person who sent it for a new one.' }

/** Training started so that today (15 April 2026) is in training month 4, an MSF month. */
export const MONTH_4_START = '2026-01-01'
/** Today is in training month 3: no MSF round. */
export const MONTH_3_START = '2026-01-20'

const DAY = 24 * 60 * 60 * 1000

export const invites = () => fakePrisma.tables.nutritionMsfInvite as Row[]
export const responses = () => fakePrisma.tables.nutritionMsfResponse as Row[]

/** An invite with a known raw token. `state` shapes it; createdAt defaults to 2 April 2026 (month 4 for MONTH_4_START). */
export function seedInvite(
  traineeId: string,
  fields: Partial<{ createdAt: Date; state: 'OPEN' | 'USED' | 'REVOKED' | 'EXPIRED'; assessorName: string }> = {},
): { invite: Row; token: string } {
  const { token, tokenHash } = newMsfToken()
  const createdAt = fields.createdAt ?? new Date('2026-04-02T05:00:00Z')
  const state = fields.state ?? 'OPEN'
  const invite = fakePrisma.seed('nutritionMsfInvite', {
    traineeId,
    tokenHash,
    assessorName: fields.assessorName ?? 'Nurse Example',
    assessorRole: 'NURSE',
    createdAt,
    expiresAt: state === 'REVOKED' ? createdAt : state === 'EXPIRED' ? new Date(createdAt.getTime() + 1 * DAY) : new Date(createdAt.getTime() + 14 * DAY),
    usedAt: state === 'USED' ? new Date(createdAt.getTime() + DAY) : null,
    createdBy: 'auth-seed',
  })
  return { invite, token }
}

/** A response to an invite (marking it used), with every domain rated `rating`. */
export function seedResponse(inviteId: string, rating: number | Record<string, number> = 4, comments: string | null = null): Row {
  const answers = typeof rating === 'number' ? Object.fromEntries(MSF_DOMAINS.map((domain) => [domain.key, rating])) : rating
  const invite = invites().find((row) => row.id === inviteId) as Row
  invite.usedAt = invite.usedAt ?? new Date('2026-04-05T05:00:00Z')
  return fakePrisma.seed('nutritionMsfResponse', { inviteId, formVersion: 1, answers, comments, createdBy: null })
}

/** The public form's fields: the token and every domain rated `rating`. */
export function responseFields(token: string, rating = 4, extra: Record<string, string> = {}): Record<string, string> {
  return { token, ...Object.fromEntries(MSF_DOMAINS.map((domain) => [msfRatingField(domain.key), String(rating)])), ...extra }
}

export { hashMsfToken }
