import 'server-only'
import type { MillerLevel, WpbaType } from '@prisma/client'
import {
  DOPS_OTHER_PROCEDURE,
  DOPS_PROCEDURES,
  MILLER_EPA_TARGETS,
  MILLER_LEVEL_LABELS,
  WPBA_FORMS,
  type EpaRange,
  type RatingScale,
} from '@/features/nutrition/config/forms'
import type { Snapshot } from './audit'

// Server-side scoring of the workplace-based assessments (Step 5) against
// WPBA_FORMS in config/forms.ts. Pure: no database.
//
// The only inputs are the ratings, keyed by item key, and for an OSCE the
// critical-error flag. Nothing else a client sends is read. The total and
// maxScore come from the ratings and the definition; millerLevel and the
// suggested EPA range come from config (MILLER_EPA_TARGETS); and an OSCE's
// result comes from its passRule:
//
//   passed = total * 100 >= minPercent * maxScore  AND  no critical error
//
// in whole numbers, so 70% of 25 (17.5) is never met by a half point: 17
// fails and 18 passes. A critical error fails the OSCE whatever the score.
// Every reason is recorded: below the pass mark, a critical error, or both.
// The other types have no pass or fail: passed and criticalError are null.

export type WpbaFailReason = 'BELOW_PASS_MARK' | 'CRITICAL_ERROR'

export type WpbaRatingProblem = 'NOT_AN_OBJECT' | 'UNKNOWN_ITEM' | 'NOT_A_WHOLE_NUMBER' | 'OUT_OF_RANGE' | 'MISSING'

export interface WpbaRatingError {
  /** The item key; empty for NOT_AN_OBJECT. */
  key: string
  problem: WpbaRatingProblem
}

export interface WpbaScore {
  ratings: Record<string, number>
  total: number
  maxScore: number
  /** OSCE only; null for the other types. */
  passed: boolean | null
  /** OSCE only; null for the other types. */
  criticalError: boolean | null
  /** Why an OSCE failed; empty when it passed and for the other types. */
  failReasons: WpbaFailReason[]
  millerLevel: MillerLevel
  suggestedEpa: EpaRange
}

export type WpbaScoreResult = { ok: true; score: WpbaScore } | { ok: false; errors: WpbaRatingError[] }

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value))

/** An OSCE's result under its pass rule, in whole numbers. */
export function osceOutcome(
  total: number,
  maxScore: number,
  criticalError: boolean,
  rule: { minPercent: number; noCriticalError: boolean },
): { passed: boolean; failReasons: WpbaFailReason[] } {
  const failReasons: WpbaFailReason[] = []
  if (total * 100 < rule.minPercent * maxScore) failReasons.push('BELOW_PASS_MARK')
  if (rule.noCriticalError && criticalError) failReasons.push('CRITICAL_ERROR')
  return { passed: failReasons.length === 0, failReasons }
}

/**
 * Validates and scores one WPBA: every item of the type rated with a whole
 * number on its section's scale, no other key. criticalError counts for an
 * OSCE only and is ignored (null) for the other types.
 */
export function scoreWpba(type: WpbaType, ratings: unknown, criticalError: boolean): WpbaScoreResult {
  if (!isPlainObject(ratings)) return { ok: false, errors: [{ key: '', problem: 'NOT_AN_OBJECT' }] }
  const definition = WPBA_FORMS[type]
  const scales = new Map<string, RatingScale>()
  for (const section of definition.sections) for (const item of section.items) scales.set(item.key, section.scale)

  const errors: WpbaRatingError[] = []
  for (const key of Object.keys(ratings)) if (!scales.has(key)) errors.push({ key, problem: 'UNKNOWN_ITEM' })
  for (const [key, scale] of scales) {
    if (!Object.hasOwn(ratings, key)) {
      errors.push({ key, problem: 'MISSING' })
      continue
    }
    const value = ratings[key]
    if (typeof value !== 'number' || !Number.isInteger(value)) errors.push({ key, problem: 'NOT_A_WHOLE_NUMBER' })
    else if (value < scale.min || value > scale.max) errors.push({ key, problem: 'OUT_OF_RANGE' })
  }
  if (errors.length > 0) return { ok: false, errors }

  const values = ratings as Record<string, number>
  const kept = Object.fromEntries([...scales.keys()].map((key) => [key, values[key]]))
  const total = Object.values(kept).reduce((sum, value) => sum + value, 0)
  const outcome = definition.passRule ? osceOutcome(total, definition.maxScore, criticalError, definition.passRule) : null
  return {
    ok: true,
    score: {
      ratings: kept,
      total,
      maxScore: definition.maxScore,
      passed: outcome ? outcome.passed : null,
      criticalError: definition.passRule ? criticalError : null,
      failReasons: outcome ? outcome.failReasons : [],
      millerLevel: definition.millerLevel,
      suggestedEpa: MILLER_EPA_TARGETS[definition.millerLevel],
    },
  }
}

// ── DOPS procedure ───────────────────────────────────────────────────────────

const PROCEDURE_KEYS: readonly string[] = DOPS_PROCEDURES.map((procedure) => procedure.key)

/** What NutritionWpba.procedure holds, as shown: a listed procedure's label, or "Other: <description>". */
export function procedureLabel(stored: string | null): string | null {
  if (stored === null) return null
  return DOPS_PROCEDURES.find((procedure) => procedure.key === stored)?.label ?? `Other: ${stored}`
}

/** The procedure for the audit log: a listed key, or "other", never the free-text description. */
export function procedureForAudit(stored: string | null): string | null {
  if (stored === null) return null
  return PROCEDURE_KEYS.includes(stored) ? stored : DOPS_OTHER_PROCEDURE.key
}

// ── Audit and scorecard ──────────────────────────────────────────────────────

/**
 * A WPBA for the audit log: ids, type, date, total, maxScore and the result.
 * No feedback text, no per-item rating and no DOPS "other" description.
 */
export function wpbaAuditSnapshot(row: {
  id: string
  type: WpbaType
  formVersion: number
  traineeId: string
  assessorId: string
  rotationEntryId: string | null
  caseLogId: string | null
  procedure: string | null
  assessedOn: Date
  total: number | null
  maxScore: number | null
  passed: boolean | null
  criticalError: boolean | null
  millerLevel: MillerLevel
}): Snapshot {
  return {
    id: row.id,
    type: row.type,
    formVersion: row.formVersion,
    traineeId: row.traineeId,
    assessorId: row.assessorId,
    rotationEntryId: row.rotationEntryId,
    caseLogId: row.caseLogId,
    procedure: procedureForAudit(row.procedure),
    assessedOn: row.assessedOn.toISOString().slice(0, 10),
    total: row.total,
    maxScore: row.maxScore,
    passed: row.passed,
    criticalError: row.criticalError,
    millerLevel: row.millerLevel,
  }
}

const MILLER_ORDER: readonly MillerLevel[] = ['KNOWS', 'KNOWS_HOW', 'SHOWS_HOW', 'DOES']
const WPBA_TYPES = Object.keys(WPBA_FORMS) as WpbaType[]

export interface WpbaScorecardEntry {
  type: WpbaType
  title: string
  count: number
  /** The most recent assessment of this type (by date assessed, then by when it was filed). */
  latest: { assessedOn: string; total: number | null; maxScore: number | null; passed: boolean | null } | null
}

export interface WpbaScorecard {
  types: WpbaScorecardEntry[]
  /** The highest Miller level any of the trainee's WPBAs was recorded at. */
  highestMillerLevel: MillerLevel | null
  highestMillerLabel: string | null
}

/** One trainee's WPBA scorecard (Step 7 builds on it): count and latest score per type, and the highest Miller level reached. */
export function wpbaScorecard(
  rows: readonly {
    type: WpbaType
    assessedOn: Date
    createdAt: Date
    total: number | null
    maxScore: number | null
    passed: boolean | null
    millerLevel: MillerLevel
  }[],
): WpbaScorecard {
  const newestFirst = [...rows].sort(
    (a, b) => b.assessedOn.getTime() - a.assessedOn.getTime() || b.createdAt.getTime() - a.createdAt.getTime(),
  )
  const highest = rows.reduce<MillerLevel | null>(
    (best, row) => (best === null || MILLER_ORDER.indexOf(row.millerLevel) > MILLER_ORDER.indexOf(best) ? row.millerLevel : best),
    null,
  )
  return {
    types: WPBA_TYPES.map((type) => {
      const ofType = newestFirst.filter((row) => row.type === type)
      const latest = ofType[0]
      return {
        type,
        title: WPBA_FORMS[type].title,
        count: ofType.length,
        latest: latest
          ? { assessedOn: latest.assessedOn.toISOString().slice(0, 10), total: latest.total, maxScore: latest.maxScore, passed: latest.passed }
          : null,
      }
    }),
    highestMillerLevel: highest,
    highestMillerLabel: highest ? MILLER_LEVEL_LABELS[highest] : null,
  }
}
