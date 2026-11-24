import { MIN_MSF_RESPONSES, MSF_ASSESSORS_PER_ROUND, MSF_ROUND_MONTHS } from '@/features/nutrition/config/msf'

// Display helpers for the MSF screens (Step 6c UI). Pure data and functions,
// safe in client and server components. They decide nothing: the server
// actions and loaders apply every rule, and their answer is the one shown.

export type MsfStatus = 'OPEN' | 'USED' | 'REVOKED' | 'EXPIRED'

export const MSF_STATUS_LABELS: Readonly<Record<MsfStatus, string>> = {
  OPEN: 'Open',
  USED: 'Answered',
  EXPIRED: 'Expired',
  REVOKED: 'Revoked',
}

/** "M04" -> "Month 4". */
export function roundLabel(point: string): string {
  const month = /^M(\d{2})$/.exec(point)
  return month ? `Month ${Number(month[1])}` : point
}

/** What a link created today joins, from the loader's currentRound. */
export function currentRoundText(currentRound: string | null): string {
  if (!currentRound) return `No MSF round this month: links can be created in training months ${MSF_ROUND_MONTHS.join(', ')}.`
  return `${roundLabel(currentRound)} round: links you create now join this round.`
}

/** Open and answered links count towards the round's limit; revoked and expired ones free their place. */
export function remainingInvites(invites: readonly { status: MsfStatus }[]): number {
  const taken = invites.filter((invite) => invite.status === 'OPEN' || invite.status === 'USED').length
  return Math.max(0, MSF_ASSESSORS_PER_ROUND - taken)
}

/** Under the averages, or instead of them while the server hides them. */
export function responsesText(aggregate: { count: number; hidden: boolean }): string {
  const responses = `${aggregate.count} ${aggregate.count === 1 ? 'response' : 'responses'}`
  return aggregate.hidden ? `${responses}: not enough responses yet (averages show from ${MIN_MSF_RESPONSES}).` : `${responses}.`
}

/** The full link for a raw token, to copy and send. */
export function msfLinkUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/nutrition/msf/${token}`
}

/**
 * The public page's one message for a link it cannot use, whatever the reason
 * (unknown, used, expired or revoked). A test keeps it equal to the server's.
 */
export const MSF_DEAD_LINK_TEXT = 'This feedback link is not valid any more. Ask the person who sent it for a new one.'

export const MSF_SINGLE_USE_NOTE = 'This link works once. After you submit, it cannot be used again, and your answers cannot be changed.'

export const MSF_LINK_SHOWN_ONCE = 'Copy this link now and send it to the assessor. It is shown only once and cannot be shown again.'
