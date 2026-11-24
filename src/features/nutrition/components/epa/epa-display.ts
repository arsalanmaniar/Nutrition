import type { EpaLevel, MillerLevel, StandardRating } from '@prisma/client'
import { EPA_LEVEL_LABELS, MILLER_EPA_TARGETS, MILLER_LEVEL_LABELS, STANDARD_RATING_LABELS } from '@/features/nutrition/config/forms'

// Display helpers for the Step 6b screens (EPA entrustment and the Month 9
// standards checklist). Pure data and functions, safe in client and server
// components. They decide nothing: the server actions check every rule again
// and their answer is the one stored.

const EPA_ORDER: readonly EpaLevel[] = ['E1', 'E2', 'E3', 'E4', 'E5']

export const MILLER_LEVELS = Object.keys(MILLER_LEVEL_LABELS) as MillerLevel[]

/** The entrustment levels the form offers for a Miller level: MILLER_EPA_TARGETS, both ends included. */
export function allowedEpaLevels(millerLevel: MillerLevel): EpaLevel[] {
  const { min, max } = MILLER_EPA_TARGETS[millerLevel]
  return EPA_ORDER.slice(EPA_ORDER.indexOf(min), EPA_ORDER.indexOf(max) + 1)
}

/** "E2 to E3", or "E1" when the range is a single level. */
export function millerRangeLabel(millerLevel: MillerLevel): string {
  const { min, max } = MILLER_EPA_TARGETS[millerLevel]
  return min === max ? min : `${min} to ${max}`
}

/** "Shows How (E2 to E3)", for the Miller select. */
export function millerOptionLabel(millerLevel: MillerLevel): string {
  return `${MILLER_LEVEL_LABELS[millerLevel]} (${millerRangeLabel(millerLevel)})`
}

/** "E3 · Indirect supervision". */
export function epaLevelLabel(level: EpaLevel): string {
  return `${level} · ${EPA_LEVEL_LABELS[level]}`
}

/** "Meets", or "Not rated" for a standard without a rating yet. */
export function ratingLabel(rating: StandardRating | null): string {
  return rating ? STANDARD_RATING_LABELS[rating] : 'Not rated'
}

export const STANDARD_RATINGS = Object.keys(STANDARD_RATING_LABELS) as StandardRating[]

/**
 * Why the Month 9 checklist cannot be started today, or null when it can.
 * `opensOn` is the first day of training month 9 from the loader (null while
 * the start date is not set); `today` is the Karachi day.
 */
export function checklistOpensText(opensOn: string | null, today: string): string | null {
  if (!opensOn) return "The trainee's training start date is not set yet, so the checklist cannot open."
  if (today < opensOn) return `The checklist opens on ${opensOn}, the first day of training month 9.`
  return null
}

// The form fields the checklist actions read (server/epa-core.ts: ratingField,
// evidenceField, evidenceValue). A test keeps these equal to the server's.
export const checklistRatingField = (key: string) => `rating.${key}`
export const checklistEvidenceField = (key: string) => `evidence.${key}`
export const evidenceOptionValue = (option: { kind: 'CASE_LOG' | 'WPBA'; id: string }) => `${option.kind}:${option.id}`

/** "Case log C-2026-012" or "WPBA Mini-CEX, 2026-04-10", for the evidence picker. */
export function evidenceOptionLabel(option: { kind: 'CASE_LOG' | 'WPBA'; label: string }): string {
  return `${option.kind === 'CASE_LOG' ? 'Case log' : 'WPBA'} ${option.label}`
}
