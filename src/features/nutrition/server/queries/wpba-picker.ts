import 'server-only'
import type { CaseFormType, Prisma, WpbaType } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { WPBA_FORMS } from '@/features/nutrition/config/forms'
import { karachiDay, storedDay } from '@/features/nutrition/lib/assessment-point'
import { activeTraineeIds } from '../evaluation-forms-core'
import { ownAssessorId } from '../own-assessor'
import { ownPreceptorId } from '../own-preceptor'
import { wpbaScorecard, type WpbaFailReason, type WpbaScorecard } from '../wpba-core'

// Read models for the WPBA screens (Step 5b). Read-only, each guarded with
// its exact role list (portal-guard-coverage.test.ts); every rule stays in the
// 5a action (server/actions/wpba.ts), which checks everything again on submit.
//
// WHO THE CALLER MAY ASSESS mirrors the action's rule for today: the trainees
// they are the ACTIVE primary preceptor of, and those on a placement of theirs
// (NutritionRotationEntry.rotationPreceptorId) whose dates cover today.
// wpba-picker.test.ts checks that this list and the action agree.

export interface AssessableTrainee {
  traineeId: string
  traineeName: string
  /** For the assessed-on date's lower bound; null if not set (the action then refuses). */
  trainingStartDate: string | null
  /** How the caller may assess them. */
  via: 'PRIMARY' | 'PLACEMENT'
}

export interface CbdCaseLogOption {
  id: string
  caseCode: string
  formType: CaseFormType
}

export interface TraineeScorecard {
  traineeName: string
  scorecard: WpbaScorecard
}

export interface FiledAssessment {
  type: WpbaType
  title: string
  traineeName: string
  assessedOn: string
  total: number | null
  maxScore: number | null
  /** OSCE only; null for the other types. */
  passed: boolean | null
  criticalError: boolean | null
  failReasons: WpbaFailReason[]
}

/** A placement covers a day from its start to its end, or open-ended without an end (as in the action). */
const coversDay = (entry: { startDate: Date; endDate: Date | null }, day: string) =>
  storedDay(entry.startDate) <= day && (entry.endDate === null || day <= storedDay(entry.endDate))

/** The trainees this assessor may assess today, by primary assignment or a placement covering today. */
async function assessableToday(assessorId: string): Promise<Map<string, AssessableTrainee['via']>> {
  const today = karachiDay(new Date())
  const [primary, entries] = await Promise.all([
    activeTraineeIds(prisma, assessorId),
    prisma.nutritionRotationEntry.findMany({ where: { rotationPreceptorId: assessorId }, select: { traineeId: true, startDate: true, endDate: true } }),
  ])
  const via = new Map<string, AssessableTrainee['via']>()
  for (const entry of entries) if (coversDay(entry, today)) via.set(entry.traineeId, 'PLACEMENT')
  for (const traineeId of primary) via.set(traineeId, 'PRIMARY')
  return via
}

/** The "New assessment" picker: active trainees the caller may assess today, with their start dates. */
export async function listAssessableTrainees(): Promise<AssessableTrainee[]> {
  const access = await requireNutritionRole(['PRECEPTOR', 'ASSESSOR'])
  const via = await assessableToday(ownAssessorId(access))
  if (via.size === 0) return []
  const trainees = await prisma.nutritionProfile.findMany({
    where: { id: { in: [...via.keys()] }, role: 'TRAINEE', isActive: true },
    orderBy: [{ fullName: 'asc' }],
    select: { id: true, fullName: true, trainingStartDate: true },
  })
  return trainees.map((trainee) => ({
    traineeId: trainee.id,
    traineeName: trainee.fullName,
    trainingStartDate: trainee.trainingStartDate ? storedDay(trainee.trainingStartDate) : null,
    via: via.get(trainee.id) ?? 'PLACEMENT',
  }))
}

/**
 * The CbD case-log picker: the trainee's SUBMITTED or APPROVED logs, as id,
 * case code and form type only (never the log's text), and only for a trainee
 * the caller may assess today. Anything else: an empty list.
 */
export async function listCbdCaseLogs(traineeId: string): Promise<CbdCaseLogOption[]> {
  const access = await requireNutritionRole(['PRECEPTOR', 'ASSESSOR'])
  const assessorId = ownAssessorId(access)
  if (!z.uuid().safeParse(traineeId).success) return []
  if (!(await assessableToday(assessorId)).has(traineeId)) return []
  return prisma.nutritionCaseLog.findMany({
    where: { traineeId, status: { in: ['SUBMITTED', 'APPROVED'] } },
    orderBy: [{ caseCode: 'desc' }],
    select: { id: true, caseCode: true, formType: true },
  })
}

/** The preceptor's scorecard page: one WPBA scorecard (aggregates only, no WPBA row) per trainee they are the ACTIVE primary preceptor of. */
export async function listPrimaryTraineeScorecards(): Promise<TraineeScorecard[]> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const traineeIds = await activeTraineeIds(prisma, ownPreceptorId(access))
  if (traineeIds.length === 0) return []
  const [trainees, rows] = await Promise.all([
    prisma.nutritionProfile.findMany({ where: { id: { in: traineeIds } }, orderBy: [{ fullName: 'asc' }], select: { id: true, fullName: true } }),
    prisma.nutritionWpba.findMany({
      where: { traineeId: { in: traineeIds } },
      select: { traineeId: true, type: true, assessedOn: true, createdAt: true, total: true, maxScore: true, passed: true, millerLevel: true },
    }),
  ])
  return trainees.map((trainee) => ({
    traineeName: trainee.fullName,
    scorecard: wpbaScorecard(rows.filter((row) => row.traineeId === trainee.id)),
  }))
}

const failReasonsOf = (scores: Prisma.JsonValue): WpbaFailReason[] => {
  const object = scores !== null && typeof scores === 'object' && !Array.isArray(scores) ? scores : {}
  const reasons = Array.isArray(object.failReasons) ? object.failReasons : []
  return (['BELOW_PASS_MARK', 'CRITICAL_ERROR'] as const).filter((reason) => reasons.includes(reason))
}

/**
 * The WPBA the caller filed most recently (by filing time), as the server
 * stored it: what the screen shows after Submit, including an OSCE's result and
 * its reasons. Only the caller's own; null if they have filed none.
 */
export async function getMyLatestAssessment(): Promise<FiledAssessment | null> {
  const access = await requireNutritionRole(['PRECEPTOR', 'ASSESSOR'])
  const row = await prisma.nutritionWpba.findFirst({
    where: { assessorId: ownAssessorId(access) },
    orderBy: [{ createdAt: 'desc' }],
    select: {
      type: true,
      assessedOn: true,
      total: true,
      maxScore: true,
      passed: true,
      criticalError: true,
      scores: true,
      trainee: { select: { fullName: true } },
    },
  })
  if (!row) return null
  return {
    type: row.type,
    title: WPBA_FORMS[row.type].title,
    traineeName: row.trainee.fullName,
    assessedOn: storedDay(row.assessedOn),
    total: row.total,
    maxScore: row.maxScore,
    passed: row.passed,
    criticalError: row.criticalError,
    failReasons: failReasonsOf(row.scores),
  }
}
