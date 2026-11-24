import type { SubmissionStatus } from '@prisma/client'
import { MIN_GROUP_SIZE } from '@/features/nutrition/config/portfolio'
import type { EpaTimelinePoint, GroupValue, SummativeStatus, TraineeStatus } from '@/features/nutrition/server/portfolio-core'

// Display helpers for the Step 7 screens (portfolio, summary, certificate,
// analytics, export). Pure data and functions, safe in client and server
// components. They decide nothing: the loaders and the credential action
// apply every rule.

export const NOT_ENOUGH_DATA = 'Not enough data'

/** A group's value as text, or "Not enough data" when the server hid it. */
export function groupText(group: GroupValue, suffix = ''): string {
  return group.hidden ? NOT_ENOUGH_DATA : `${group.value}${suffix}`
}

/** Under a hidden group: why it is hidden. */
export function groupNote(group: GroupValue): string | null {
  return group.hidden ? `Shown from ${MIN_GROUP_SIZE}; this group has fewer.` : null
}

export const TRAINEE_STATUS_LABELS: Readonly<Record<TraineeStatus, string>> = {
  START_DATE_NOT_SET: 'Start date not set',
  NOT_STARTED: 'Not started yet',
  IN_TRAINING: 'In training',
  FINISHED: 'Finished',
}

export const CASE_LOG_STATUS_LABELS: Readonly<Record<SubmissionStatus, string>> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  REJECTED: 'Returned',
}

/** The Month 9 checklist's state in words. */
export function checklistText(checklist: { status: SubmissionStatus; submittedOn: string | null } | null): string {
  if (!checklist) return 'Not started'
  if (checklist.status === 'DRAFT') return 'In progress (draft)'
  return `Submitted${checklist.submittedOn ? ` on ${checklist.submittedOn}` : ''}`
}

/** The summative EPA target in words, for the summary and the certificate screens. */
export function summativeText(summative: SummativeStatus, reachedMonth12: boolean): string {
  const short = summative.epas.filter((epa) => !epa.meets).length
  if (summative.met && reachedMonth12) return 'Summative target met: every EPA at E4 or E5.'
  if (summative.met) return 'Every EPA is at E4 or E5; sign-off opens in training month 12.'
  return `Summative target not met yet: ${short} of ${summative.epas.length} EPAs below E4.`
}

/** Research milestones have no storage yet. */
export const NOT_RECORDED = 'Not recorded'

/** One row per assessment day for the EPA chart: { assessedOn, <epaKey>: 1..5 } carrying each EPA's level forward. */
export function epaChartRows(points: readonly EpaTimelinePoint[]): { rows: Record<string, string | number>[]; epas: { key: string; label: string }[] } {
  const epas: { key: string; label: string }[] = []
  for (const point of points) if (!epas.some((epa) => epa.key === point.epaKey)) epas.push({ key: point.epaKey, label: point.epaLabel })
  const days = [...new Set(points.map((point) => point.assessedOn))].sort()
  const current: Record<string, number> = {}
  const rows = days.map((day) => {
    for (const point of points.filter((p) => p.assessedOn === day)) current[point.epaKey] = point.value
    return { assessedOn: day, ...current }
  })
  return { rows, epas }
}

/** The public verify link for a verification id. */
export function verifyUrl(origin: string, verificationId: string): string {
  return `${origin.replace(/\/$/, '')}/nutrition/verify/${verificationId}`
}

/** The verify page's one message for an id it cannot find (never why). */
export const VERIFY_NOT_FOUND_TEXT = 'No certificate was found for this verification code.'
export const VERIFY_REVOKED_TEXT = 'This certificate has been revoked and is no longer valid.'

export const METRICS_CSV_FILE = 'cdn-ep-program-metrics.csv'
