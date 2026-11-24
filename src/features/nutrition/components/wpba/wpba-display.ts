import { WPBA_FORMS } from '@/features/nutrition/config/forms'
import type { WpbaFailReason } from '@/features/nutrition/server/wpba-core'

// Pure display helpers for the WPBA screens (Step 5b). Nothing here decides
// anything: the server scores every WPBA and decides an OSCE's result
// (server/wpba-core.ts), and that result is the one stored and shown. These
// only format it, and preview it while a form is being filled in.

/** The longest DOPS "other" description, as validation/wpba.ts allows (a test keeps them equal). */
export const PROCEDURE_TEXT_MAX = 200

const OSCE_MIN_PERCENT = WPBA_FORMS.OSCE.passRule?.minPercent ?? 70

/** A score as a percentage of its maximum, at most one decimal place: "72%". Null when there is no score. */
export function percentLabel(total: number | null, maxScore: number | null): string | null {
  if (total === null || maxScore === null || maxScore <= 0) return null
  return `${Math.round((total * 1000) / maxScore) / 10}%`
}

/** The fewest whole points that reach a pass mark: 70% of 25 is 17.5, so 18. */
export function passMarkPoints(minPercent: number, maxScore: number): number {
  return Math.ceil((minPercent * maxScore) / 100)
}

export interface OscePreview {
  rated: number
  total: number
  complete: boolean
  percentage: string | null
  /** total * 100 >= minPercent * maxScore, as the server counts it; null until every criterion is rated. */
  reachesPassMark: boolean | null
  /** Null until every criterion is rated. A critical error always means false. */
  wouldPass: boolean | null
}

/**
 * A live OSCE preview, for DISPLAY ONLY while the form is filled in. The
 * server recomputes the total and the result on submit; only that is stored.
 */
export function osceLivePreview(
  ratings: Readonly<Record<string, number>>,
  itemCount: number,
  maxScore: number,
  minPercent: number,
  criticalError: boolean,
): OscePreview {
  const values = Object.values(ratings)
  const total = values.reduce((sum, value) => sum + value, 0)
  const complete = values.length === itemCount
  const reachesPassMark = complete ? total * 100 >= minPercent * maxScore : null
  return {
    rated: values.length,
    total,
    complete,
    percentage: complete ? percentLabel(total, maxScore) : null,
    reachesPassMark,
    wouldPass: complete ? Boolean(reachesPassMark) && !criticalError : null,
  }
}

/**
 * The assessed-on date's bounds: from the training start date to today in
 * Karachi. Null when no day is possible (no start date yet, or training not
 * started). The server enforces both bounds again.
 */
export function assessedOnBounds(trainingStartDate: string | null, today: string): { min: string; max: string } | null {
  if (!trainingStartDate || trainingStartDate > today) return null
  return { min: trainingStartDate, max: today }
}

export const FAIL_REASON_LABELS: Readonly<Record<WpbaFailReason, string>> = {
  BELOW_PASS_MARK: `below the ${OSCE_MIN_PERCENT}% pass mark`,
  CRITICAL_ERROR: 'a critical error',
}

/** "Pass", "Fail: below the 70% pass mark and a critical error", or null for a type with no pass or fail. */
export function resultLabel(passed: boolean | null, failReasons: readonly WpbaFailReason[]): string | null {
  if (passed === null) return null
  if (passed) return 'Pass'
  const reasons = failReasons.map((reason) => FAIL_REASON_LABELS[reason])
  return reasons.length > 0 ? `Fail: ${reasons.join(' and ')}` : 'Fail'
}
