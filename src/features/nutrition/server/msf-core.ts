import 'server-only'
import { MIN_MSF_RESPONSES, MSF_DOMAINS, MSF_LINK_DAYS, MSF_ROUND_MONTHS } from '@/features/nutrition/config/msf'
import { assessmentPoint, karachiDay, storedDay, trainingPosition } from '@/features/nutrition/lib/assessment-point'
import type { Snapshot } from './audit'

// MSF rules shared by the preceptor actions, the loaders and the public form
// (Step 6c). Pure: nothing here reads the database or checks roles.

const DAY_MS = 24 * 60 * 60 * 1000

/** When a link created at `createdAt` stops working. */
export function msfExpiry(createdAt: Date): Date {
  return new Date(createdAt.getTime() + MSF_LINK_DAYS * DAY_MS)
}

/**
 * The MSF round (training month 4, 8 or 12) an invite created at `at` belongs
 * to: the trainee's training month that Karachi day, or null outside those
 * months, before training or without a start date.
 */
export function msfRound(trainingStartDate: Date | null, at: Date): number | null {
  if (!trainingStartDate) return null
  const position = trainingPosition(storedDay(trainingStartDate), karachiDay(at))
  return position && MSF_ROUND_MONTHS.includes(position.month) ? position.month : null
}

/** "M04", "M08" or "M12". */
export const roundPoint = (month: number) => assessmentPoint('MONTH', month)

export type InviteStatus = 'OPEN' | 'USED' | 'REVOKED' | 'EXPIRED'

/**
 * A revoked link has expiresAt set back to its createdAt (there is no
 * revokedAt column), so revoked and expired are told apart by that.
 */
export function inviteStatus(invite: { usedAt: Date | null; expiresAt: Date; createdAt: Date }, now: Date): InviteStatus {
  if (invite.usedAt) return 'USED'
  if (invite.expiresAt.getTime() <= invite.createdAt.getTime()) return 'REVOKED'
  if (invite.expiresAt.getTime() <= now.getTime()) return 'EXPIRED'
  return 'OPEN'
}

/** Whether a link can still be answered. The public form refuses every other state with one generic message. */
export const isOpen = (invite: { usedAt: Date | null; expiresAt: Date; createdAt: Date }, now: Date) => inviteStatus(invite, now) === 'OPEN'

/** Used and open links count towards a round's assessor limit; revoked and expired ones free their place. */
export const countsTowardRound = (status: InviteStatus) => status === 'OPEN' || status === 'USED'

export interface DomainAverage {
  key: string
  label: string
  /** One decimal place. */
  average: number
}

/** A round's aggregates: only the count below MIN_MSF_RESPONSES, never fewer responses' averages. */
export type MsfAggregate = { count: number; hidden: true } | { count: number; hidden: false; domains: DomainAverage[] }

/** Per-domain averages over these responses' answers, or just the count while there are too few. */
export function msfAggregate(answers: readonly unknown[]): MsfAggregate {
  const count = answers.length
  if (count < MIN_MSF_RESPONSES) return { count, hidden: true }
  const domains = MSF_DOMAINS.map((domain) => {
    const values = answers
      .map((entry) => (entry !== null && typeof entry === 'object' ? (entry as Record<string, unknown>)[domain.key] : undefined))
      .filter((value): value is number => typeof value === 'number')
    const average = values.length > 0 ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : 0
    return { key: domain.key, label: domain.label, average }
  })
  return { count, hidden: false, domains }
}

/** The audit snapshot of an invite: ids, round and state. Never the token hash, the name or the profession. */
export function inviteAuditSnapshot(invite: { id: string; traineeId: string; usedAt: Date | null; expiresAt: Date; createdAt: Date }, round: number | null, now: Date): Snapshot {
  return {
    id: invite.id,
    traineeId: invite.traineeId,
    round: round === null ? null : roundPoint(round),
    status: inviteStatus(invite, now),
  }
}
