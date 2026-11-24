import 'server-only'
import type { MillerLevel, WpbaType } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { MILLER_EPA_TARGETS, WPBA_FORMS, type EpaRange } from '@/features/nutrition/config/forms'
import { ownAssessorId } from '../own-assessor'
import { ownTraineeId } from '../own-trainee'
import { procedureLabel, wpbaScorecard, type WpbaFailReason, type WpbaScorecard } from '../wpba-core'

// Read models for the workplace-based assessments (Step 5a). Each loader
// checks its role itself, with an exact role list
// (portal-guard-coverage.test.ts):
//  - a preceptor or assessor reads only the WPBAs they filed themselves;
//  - a trainee reads only their own WPBAs (by their own profile id), with
//    scores and written feedback, and their own scorecard.
// No other role reads an individual WPBA: unit leads, ADMIN and super_admin
// included, for now. An assessor sees nothing of a trainee beyond the WPBAs
// they filed: no forms, no case logs (a CbD shows only its case code).

export interface WpbaView {
  id: string
  type: WpbaType
  title: string
  assessedOn: string
  ratings: Record<string, number>
  total: number | null
  maxScore: number | null
  /** OSCE only; null for the other types. */
  passed: boolean | null
  criticalError: boolean | null
  failReasons: WpbaFailReason[]
  millerLevel: MillerLevel
  suggestedEpa: EpaRange
  /** DOPS: the procedure's label, or "Other: <description>". */
  procedure: string | null
  /** CbD: the case code of the log discussed. */
  caseCode: string | null
  feedback: string | null
}

export interface AssessedWpbaRow extends WpbaView {
  traineeName: string
}

export interface MyWpbaRow extends WpbaView {
  assessorName: string
}

const VIEW_FIELDS = {
  id: true,
  type: true,
  assessedOn: true,
  scores: true,
  total: true,
  maxScore: true,
  passed: true,
  criticalError: true,
  millerLevel: true,
  procedure: true,
  feedback: true,
  caseLog: { select: { caseCode: true } },
} as const

const NEWEST_FIRST = [{ assessedOn: 'desc' as const }, { createdAt: 'desc' as const }]

const FAIL_REASONS: readonly WpbaFailReason[] = ['BELOW_PASS_MARK', 'CRITICAL_ERROR']

function view(row: {
  id: string
  type: WpbaType
  assessedOn: Date
  scores: unknown
  total: number | null
  maxScore: number | null
  passed: boolean | null
  criticalError: boolean | null
  millerLevel: MillerLevel
  procedure: string | null
  feedback: string | null
  caseLog: { caseCode: string } | null
}): WpbaView {
  const scores = row.scores !== null && typeof row.scores === 'object' && !Array.isArray(row.scores) ? (row.scores as Record<string, unknown>) : {}
  const ratingsIn = scores.ratings !== null && typeof scores.ratings === 'object' && !Array.isArray(scores.ratings) ? (scores.ratings as Record<string, unknown>) : {}
  const reasonsIn = Array.isArray(scores.failReasons) ? scores.failReasons : []
  return {
    id: row.id,
    type: row.type,
    title: WPBA_FORMS[row.type].title,
    assessedOn: row.assessedOn.toISOString().slice(0, 10),
    ratings: Object.fromEntries(Object.entries(ratingsIn).filter((entry): entry is [string, number] => typeof entry[1] === 'number')),
    total: row.total,
    maxScore: row.maxScore,
    passed: row.passed,
    criticalError: row.criticalError,
    failReasons: FAIL_REASONS.filter((reason) => reasonsIn.includes(reason)),
    millerLevel: row.millerLevel,
    suggestedEpa: MILLER_EPA_TARGETS[row.millerLevel],
    procedure: procedureLabel(row.procedure),
    caseCode: row.caseLog?.caseCode ?? null,
    feedback: row.feedback,
  }
}

/** The WPBAs the caller filed as preceptor or assessor, newest first. Nothing anyone else filed. */
export async function listMyAssessments(): Promise<AssessedWpbaRow[]> {
  const access = await requireNutritionRole(['PRECEPTOR', 'ASSESSOR'])
  const assessorId = ownAssessorId(access)
  const rows = await prisma.nutritionWpba.findMany({
    where: { assessorId },
    orderBy: NEWEST_FIRST,
    select: { ...VIEW_FIELDS, trainee: { select: { fullName: true } } },
  })
  return rows.map((row) => ({ ...view(row), traineeName: row.trainee.fullName }))
}

/** The trainee's own WPBAs, newest first, with every score and the written feedback. */
export async function listMyWpbas(): Promise<MyWpbaRow[]> {
  const access = await requireNutritionRole(['TRAINEE'])
  const traineeId = ownTraineeId(access)
  const rows = await prisma.nutritionWpba.findMany({
    where: { traineeId },
    orderBy: NEWEST_FIRST,
    select: { ...VIEW_FIELDS, assessor: { select: { fullName: true } } },
  })
  return rows.map((row) => ({ ...view(row), assessorName: row.assessor.fullName }))
}

/** The trainee's own WPBA scorecard: count and latest score per type, and the highest Miller level reached (Step 7 builds on it). */
export async function getMyWpbaScorecard(): Promise<WpbaScorecard> {
  const access = await requireNutritionRole(['TRAINEE'])
  const traineeId = ownTraineeId(access)
  const rows = await prisma.nutritionWpba.findMany({
    where: { traineeId },
    select: { type: true, assessedOn: true, createdAt: true, total: true, maxScore: true, passed: true, millerLevel: true },
  })
  return wpbaScorecard(rows)
}
