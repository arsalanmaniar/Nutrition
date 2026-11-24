import 'server-only'
import { randomBytes } from 'node:crypto'
import type { EpaLevel, Prisma, SubmissionStatus, WpbaType } from '@prisma/client'
import { MIN_FORM_1_3_RESPONSES } from '@/features/nutrition/config/evaluation-forms'
import { EPA_LIST, epaLabel } from '@/features/nutrition/config/epas'
import { SUMMATIVE_EPA_TARGET, WPBA_FORMS } from '@/features/nutrition/config/forms'
import { MIN_GROUP_SIZE } from '@/features/nutrition/config/portfolio'
import { karachiDay, storedDay, trainingPosition } from '@/features/nutrition/lib/assessment-point'
import type { Snapshot } from './audit'
import { wpbaScorecard, type WpbaScorecard } from './wpba-core'

// Shared by the portfolio, summary, certificate and analytics loaders and the
// credential action (Step 7). Nothing here checks roles: every caller has
// already run requireNutritionRole and, for a preceptor, checked the trainee
// is theirs.

type Db = Prisma.TransactionClient

const EPA_ORDER: readonly EpaLevel[] = ['E1', 'E2', 'E3', 'E4', 'E5']
const iso = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null)

// ── Summative EPA target ────────────────────────────────────────────────────

export interface SummativeEpa {
  key: string
  label: string
  latest: EpaLevel | null
  meets: boolean
}

export interface SummativeStatus {
  /** Every configured EPA's newest level is inside SUMMATIVE_EPA_TARGET (E4–E5). */
  met: boolean
  epas: SummativeEpa[]
}

/** The summative target over a trainee's EPA rows: every EPA in config/epas.ts at E4 or E5 by its newest entry. */
export function summativeStatus(rows: readonly { epaName: string; level: EpaLevel; assessedOn: Date; createdAt: Date }[]): SummativeStatus {
  const min = EPA_ORDER.indexOf(SUMMATIVE_EPA_TARGET.min)
  const max = EPA_ORDER.indexOf(SUMMATIVE_EPA_TARGET.max)
  const epas = EPA_LIST.map((epa) => {
    const newest = rows
      .filter((row) => row.epaName === epa.key)
      .sort((a, b) => b.assessedOn.getTime() - a.assessedOn.getTime() || b.createdAt.getTime() - a.createdAt.getTime())[0]
    const at = newest ? EPA_ORDER.indexOf(newest.level) : -1
    return { key: epa.key, label: epa.label, latest: newest?.level ?? null, meets: at >= min && at <= max }
  })
  return { met: epas.length > 0 && epas.every((epa) => epa.meets), epas }
}

/** The trainee has reached training month 12, or finished the training year (Karachi day). */
export function reachedMonth12(trainingStartDate: Date | null, now: Date): boolean {
  if (!trainingStartDate) return false
  const start = storedDay(trainingStartDate)
  const today = karachiDay(now)
  if (today < start) return false
  const position = trainingPosition(start, today)
  return position === null || position.month >= 12
}

// ── Credentials ─────────────────────────────────────────────────────────────

/** A new verification id: 32 random bytes as base64url. Public by design (it is on the certificate), so it is stored as is. */
export function newVerificationId(): string {
  return randomBytes(32).toString('base64url')
}

/** The audit snapshot of a credential: ids, type and dates. Never the verification id. */
export function credentialAuditSnapshot(row: { id: string; traineeId: string; type: string; issuedAt: Date; revokedAt: Date | null }): Snapshot {
  return { id: row.id, traineeId: row.traineeId, type: row.type, issuedOn: iso(row.issuedAt), revoked: row.revokedAt !== null }
}

// ── The trainee's performance summary (portfolio, Month 12 summary) ─────────

export interface MdgrsEntry {
  point: string
  total: number | null
  maxScore: number | null
}

export interface EpaTimelinePoint {
  assessedOn: string
  epaKey: string
  epaLabel: string
  level: EpaLevel
  /** 1 for E1 … 5 for E5, for the chart. */
  value: number
}

export interface PerformanceSummary {
  traineeId: string
  traineeName: string
  trainingStartDate: string | null
  mdgrs: MdgrsEntry[]
  wpba: WpbaScorecard
  epaTimeline: EpaTimelinePoint[]
  summative: SummativeStatus
  reachedMonth12: boolean
  checklist: { status: SubmissionStatus; submittedOn: string | null } | null
  caseLogs: Record<SubmissionStatus, number>
  credential: { issuedOn: string; revoked: boolean } | null
}

/** One trainee's own records, summarised. Callers have already checked who may see them. */
export async function performanceSummary(db: Db, traineeId: string, now: Date): Promise<PerformanceSummary | null> {
  const trainee = await db.nutritionProfile.findUnique({ where: { id: traineeId }, select: { id: true, fullName: true, role: true, trainingStartDate: true } })
  if (trainee?.role !== 'TRAINEE') return null
  const [forms, wpbas, epas, checklist, logs, credential] = await Promise.all([
    db.nutritionEvaluationForm.findMany({
      where: { subjectId: traineeId, formType: 'FORM_3_1', status: 'SUBMITTED' },
      orderBy: [{ assessmentPoint: 'asc' }],
      select: { assessmentPoint: true, totalScore: true, maxScore: true },
    }),
    db.nutritionWpba.findMany({
      where: { traineeId },
      select: { type: true, assessedOn: true, createdAt: true, total: true, maxScore: true, passed: true, millerLevel: true },
    }),
    db.nutritionEpaAssessment.findMany({
      where: { traineeId },
      orderBy: [{ assessedOn: 'asc' }, { createdAt: 'asc' }],
      select: { epaName: true, level: true, assessedOn: true, createdAt: true },
    }),
    db.nutritionStandardsChecklist.findFirst({ where: { traineeId, monthNumber: 9 }, select: { status: true, submittedAt: true } }),
    db.nutritionCaseLog.findMany({ where: { traineeId }, select: { status: true } }),
    db.nutritionCredential.findFirst({
      where: { traineeId, type: 'COMPLETION' },
      orderBy: [{ issuedAt: 'desc' }],
      select: { issuedAt: true, revokedAt: true },
    }),
  ])
  const caseLogs: Record<SubmissionStatus, number> = { DRAFT: 0, SUBMITTED: 0, APPROVED: 0, REJECTED: 0 }
  for (const log of logs) caseLogs[log.status]++
  return {
    traineeId: trainee.id,
    traineeName: trainee.fullName,
    trainingStartDate: iso(trainee.trainingStartDate),
    mdgrs: forms.map((form) => ({ point: form.assessmentPoint, total: form.totalScore, maxScore: form.maxScore })),
    wpba: wpbaScorecard(wpbas),
    epaTimeline: epas.map((row) => ({
      assessedOn: iso(row.assessedOn) as string,
      epaKey: row.epaName,
      epaLabel: epaLabel(row.epaName),
      level: row.level,
      value: EPA_ORDER.indexOf(row.level) + 1,
    })),
    summative: summativeStatus(epas),
    reachedMonth12: reachedMonth12(trainee.trainingStartDate, now),
    checklist: checklist ? { status: checklist.status, submittedOn: iso(checklist.submittedAt) } : null,
    caseLogs,
    credential: credential ? { issuedOn: iso(credential.issuedAt) as string, revoked: credential.revokedAt !== null } : null,
  }
}

// ── Program analytics (aggregate only) ──────────────────────────────────────

/** A group's value, or only its size when it is too small to show. Never a value for fewer than `min`. */
export type GroupValue = { n: number; hidden: true } | { n: number; hidden: false; value: number }

/** `value` for a group of `n` people (or responses), hidden below `min`. */
export function groupValue(n: number, value: number, min = MIN_GROUP_SIZE): GroupValue {
  return n < min ? { n, hidden: true } : { n, hidden: false, value: Math.round(value * 10) / 10 }
}

const mean = (values: readonly number[]) => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0)
const pct = (total: number | null, max: number | null) => (total !== null && max ? (total * 100) / max : null)

export type TraineeStatus = 'START_DATE_NOT_SET' | 'NOT_STARTED' | 'IN_TRAINING' | 'FINISHED'

export interface ProgramAnalytics {
  traineesByStatus: { status: TraineeStatus; count: GroupValue }[]
  level1: { form11Percent: GroupValue; form13Percent: GroupValue }
  level2: { type: WpbaType; title: string; averageTotal: GroupValue; averagePercent: GroupValue }[]
  level3: { mdgrsAverage: GroupValue; miniCexAverage: GroupValue }
  level4: { epaLevels: { level: EpaLevel; count: GroupValue }[]; summativeReached: GroupValue }
}

function statusOf(trainingStartDate: Date | null, now: Date): TraineeStatus {
  if (!trainingStartDate) return 'START_DATE_NOT_SET'
  const start = storedDay(trainingStartDate)
  const today = karachiDay(now)
  if (today < start) return 'NOT_STARTED'
  return trainingPosition(start, today) ? 'IN_TRAINING' : 'FINISHED'
}

/** One average over rows grouped by person: hidden unless at least `min` distinct people contributed. */
function personAverage(rows: readonly { person: string; value: number | null }[], min = MIN_GROUP_SIZE): GroupValue {
  const valid = rows.filter((row): row is { person: string; value: number } => row.value !== null)
  return groupValue(new Set(valid.map((row) => row.person)).size, mean(valid.map((row) => row.value)), min)
}

/**
 * Kirkpatrick-style program aggregates over ACTIVE trainees only. No row in
 * the result names or identifies a trainee, and every group of fewer than
 * MIN_GROUP_SIZE people (Form 1.3: responses) shows only its size.
 */
export async function programAnalytics(db: Db, now: Date): Promise<ProgramAnalytics> {
  const trainees = await db.nutritionProfile.findMany({ where: { role: 'TRAINEE', isActive: true }, select: { id: true, trainingStartDate: true } })
  const ids = trainees.map((trainee) => trainee.id)
  const [forms, wpbas, epas] = await Promise.all([
    db.nutritionEvaluationForm.findMany({
      where: { formType: { in: ['FORM_1_1', 'FORM_1_3', 'FORM_3_1'] }, status: 'SUBMITTED' },
      select: { formType: true, subjectId: true, totalScore: true, maxScore: true },
    }),
    db.nutritionWpba.findMany({ where: { traineeId: { in: ids } }, select: { type: true, traineeId: true, total: true, maxScore: true } }),
    db.nutritionEpaAssessment.findMany({ where: { traineeId: { in: ids } }, select: { traineeId: true, epaName: true, level: true, assessedOn: true, createdAt: true } }),
  ])
  const active = new Set(ids)

  const statuses: TraineeStatus[] = ['START_DATE_NOT_SET', 'NOT_STARTED', 'IN_TRAINING', 'FINISHED']
  const statusCounts = new Map<TraineeStatus, number>(statuses.map((status) => [status, 0]))
  for (const trainee of trainees) {
    const status = statusOf(trainee.trainingStartDate, now)
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1)
  }

  const form11 = forms.filter((form) => form.formType === 'FORM_1_1' && active.has(form.subjectId))
  const form13 = forms.filter((form) => form.formType === 'FORM_1_3')
  const form31 = forms.filter((form) => form.formType === 'FORM_3_1' && active.has(form.subjectId))
  const form13Values = form13.map((form) => pct(form.totalScore, form.maxScore)).filter((value): value is number => value !== null)

  // Level 4: each trainee's newest level per EPA.
  const newest = new Map<string, { traineeId: string; level: EpaLevel; at: number; created: number }>()
  for (const row of epas) {
    const key = `${row.traineeId}|${row.epaName}`
    const current = newest.get(key)
    const at = row.assessedOn.getTime()
    if (!current || at > current.at || (at === current.at && row.createdAt.getTime() > current.created)) {
      newest.set(key, { traineeId: row.traineeId, level: row.level, at, created: row.createdAt.getTime() })
    }
  }
  const latest = [...newest.values()]
  const peopleWithEpa = new Set(latest.map((entry) => entry.traineeId)).size
  const reached = trainees.filter((trainee) => summativeStatus(epas.filter((row) => row.traineeId === trainee.id)).met).length

  return {
    traineesByStatus: statuses.map((status) => ({ status, count: groupValue(statusCounts.get(status) ?? 0, statusCounts.get(status) ?? 0) })),
    level1: {
      form11Percent: personAverage(form11.map((form) => ({ person: form.subjectId, value: pct(form.totalScore, form.maxScore) }))),
      // Form 1.3 authors are anonymous: the group is its responses.
      form13Percent: groupValue(form13Values.length, mean(form13Values), MIN_FORM_1_3_RESPONSES),
    },
    level2: (Object.keys(WPBA_FORMS) as WpbaType[]).map((type) => {
      const rows = wpbas.filter((wpba) => wpba.type === type)
      return {
        type,
        title: WPBA_FORMS[type].title,
        averageTotal: personAverage(rows.map((row) => ({ person: row.traineeId, value: row.total }))),
        averagePercent: personAverage(rows.map((row) => ({ person: row.traineeId, value: pct(row.total, row.maxScore) }))),
      }
    }),
    level3: {
      mdgrsAverage: personAverage(form31.map((form) => ({ person: form.subjectId, value: form.totalScore }))),
      miniCexAverage: personAverage(wpbas.filter((wpba) => wpba.type === 'MINI_CEX').map((row) => ({ person: row.traineeId, value: row.total }))),
    },
    level4: {
      epaLevels: EPA_ORDER.map((level) => {
        const count = latest.filter((entry) => entry.level === level).length
        return { level, count: peopleWithEpa < MIN_GROUP_SIZE ? { n: peopleWithEpa, hidden: true as const } : groupValue(count, count) }
      }),
      summativeReached: trainees.length < MIN_GROUP_SIZE ? { n: trainees.length, hidden: true } : groupValue(trainees.length, reached),
    },
  }
}

const cell = (group: GroupValue) => (group.hidden ? 'not enough data' : String(group.value))

/** The analytics as CSV: metric, group, value. No names, no ids. */
export function analyticsCsv(analytics: ProgramAnalytics): string {
  const rows: [string, string, string][] = [['metric', 'group', 'value']]
  for (const entry of analytics.traineesByStatus) rows.push(['trainees_by_status', entry.status, cell(entry.count)])
  rows.push(['level1_form_1_1_average_percent', 'all', cell(analytics.level1.form11Percent)])
  rows.push(['level1_form_1_3_average_percent', 'all', cell(analytics.level1.form13Percent)])
  for (const entry of analytics.level2) {
    rows.push(['level2_wpba_average_total', entry.type, cell(entry.averageTotal)])
    rows.push(['level2_wpba_average_percent', entry.type, cell(entry.averagePercent)])
  }
  rows.push(['level3_mdgrs_average_total', 'all', cell(analytics.level3.mdgrsAverage)])
  rows.push(['level3_mini_cex_average_total', 'all', cell(analytics.level3.miniCexAverage)])
  for (const entry of analytics.level4.epaLevels) rows.push(['level4_latest_epa_level_count', entry.level, cell(entry.count)])
  rows.push(['level4_summative_target_reached', 'all', cell(analytics.level4.summativeReached)])
  return rows.map((row) => row.map((value) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)).join(',')).join('\n') + '\n'
}
