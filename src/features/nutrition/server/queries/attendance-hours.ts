import 'server-only'
import type { AttendanceStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { attendanceMonthSchema } from '@/features/nutrition/validation/attendance'
import { localDateKarachi, monthOf, workDateOf, type DayKey } from '../attendance-core'
import {
  groupLateExtraRanges,
  groupRanges,
  hoursRanges,
  lateExtraRanges,
  rangeDays,
  type GroupLateExtraRanges,
  type GroupRanges,
  type HoursRanges,
  type LateExtraRanges,
} from '../attendance-hours-core'
import { loadAttendanceRules, type AttendanceRules } from '../attendance-rules'
import { activePrimaryPreceptorId, activeTraineeIds } from '../evaluation-forms-core'
import { ownPreceptorId } from '../own-preceptor'
import { ownTraineeId } from '../own-trainee'

// Read models for the late / early / hours-worked graphs and the late /
// extra-time bar chart. Read only: they
// never write. Each loader checks its role itself, with an exact role list
// (portal-guard-coverage.test.ts), and follows the same visibility as the
// attendance loaders in ./attendance.ts:
//  - a TRAINEE reads only their own figures;
//  - a PRECEPTOR reads the figures of the trainees they are ACTIVE primary
//    preceptor of;
//  - an ADMIN reads program averages only: no name, id or record, and each
//    bucket (a month, a week or a day) under MIN_ATTENDANCE_GROUP trainees
//    is hidden.
// The window is the one the attendance rules use (attendance-rules.ts): the
// trainee's active primary preceptor's schedule, else the program default,
// else the config default. As in ./attendance.ts, the CURRENT preceptor's
// schedule is applied to earlier months too. Voided records are never read.
// The late / extra figures of a PRECEPTOR's trainees and of the program are
// group averages only, each measure of each bucket hidden below
// MIN_ATTENDANCE_GROUP.

/** One trainee's charts: the Monthly, Weekly and Daily ranges for the chosen month (hoursRanges), and their late / extra minutes (lateExtraRanges). */
export interface HoursCharts extends HoursRanges {
  month: string
  lateExtra: LateExtraRanges
}

export interface TraineeHoursCharts extends HoursCharts {
  traineeId: string
  traineeName: string
}

export interface PreceptorAttendanceHours {
  month: string
  trainees: TraineeHoursCharts[]
  /** Late / extra averages over these trainees, hidden below MIN_ATTENDANCE_GROUP. */
  lateExtraGroup: GroupLateExtraRanges
}

/** The program's chart: the three ranges as averages over trainees, each bucket hidden below MIN_ATTENDANCE_GROUP (groupRanges). */
export interface ProgramAttendanceHours extends GroupRanges {
  month: string
  /** Late / extra averages over the program's trainees, hidden below MIN_ATTENDANCE_GROUP. */
  lateExtra: GroupLateExtraRanges
}

type RecordRow = {
  traineeId: string
  workDate: Date
  checkInAt: Date | null
  checkOutAt: Date | null
  status: AttendanceStatus
  voidedAt: Date | null
}

const RECORD_FIELDS = { traineeId: true, workDate: true, checkInAt: true, checkOutAt: true, status: true, voidedAt: true } as const

type Period = { month: string; days: DayKey[] }

/** The chosen month (the current Karachi month when none is given) and every day its three ranges read; null for a malformed month. */
function period(month: string | undefined): Period | null {
  const chosen = month === undefined ? monthOf(localDateKarachi(new Date())) : month
  if (!attendanceMonthSchema.safeParse(chosen).success) return null
  const days = rangeDays(chosen)
  return days ? { month: chosen, days } : null
}

/** The live records of these trainees on the period's days, oldest first. */
async function liveRecords(traineeIds: readonly string[], p: Period): Promise<RecordRow[]> {
  if (traineeIds.length === 0) return []
  return prisma.nutritionAttendanceRecord.findMany({
    where: { traineeId: { in: [...traineeIds] }, workDate: { in: p.days.map(workDateOf) }, voidedAt: null },
    orderBy: [{ workDate: 'asc' }],
    select: RECORD_FIELDS,
  })
}

/** One trainee's three ranges under their rules. */
function chartsFor(rows: readonly RecordRow[], p: Period, rules: AttendanceRules): HoursCharts {
  const ranges = hoursRanges(rows, p.month, rules.scheduleOn)
  const lateExtra = lateExtraRanges(rows, p.month, rules.scheduleOn)
  if (!ranges || !lateExtra) throw new RangeError(`Not a month: ${p.month}`) // unreachable: period() checked the month
  return { month: p.month, ...ranges, lateExtra }
}

/** The group late / extra ranges over these trainees' charts. */
function lateExtraGroupOf(charts: readonly HoursCharts[], month: string): GroupLateExtraRanges {
  const group = groupLateExtraRanges(
    charts.map((c) => c.lateExtra),
    month,
  )
  if (!group) throw new RangeError(`Not a month: ${month}`) // unreachable: period() checked the month
  return group
}

/** The trainee's own graphs. Null for a malformed month. */
export async function getMyAttendanceHours(month?: string): Promise<HoursCharts | null> {
  const access = await requireNutritionRole(['TRAINEE'])
  const traineeId = ownTraineeId(access)
  const p = period(month)
  if (!p) return null
  const [preceptorId, rows] = await Promise.all([activePrimaryPreceptorId(prisma, traineeId), liveRecords([traineeId], p)])
  // Holidays are not needed here, so no days are passed: only schedules load.
  const rules = (await loadAttendanceRules(prisma, [preceptorId], []))(preceptorId)
  return chartsFor(rows, p, rules)
}

/** The graphs of each of the caller's ACTIVE primary trainees. Null for a malformed month. */
export async function listMyTraineesAttendanceHours(month?: string): Promise<PreceptorAttendanceHours | null> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const preceptorId = ownPreceptorId(access)
  const p = period(month)
  if (!p) return null
  const ids = await activeTraineeIds(prisma, preceptorId)
  const trainees =
    ids.length === 0
      ? []
      : await prisma.nutritionProfile.findMany({
          where: { id: { in: ids }, role: 'TRAINEE', isActive: true },
          orderBy: [{ fullName: 'asc' }],
          select: { id: true, fullName: true },
        })
  const rows = await liveRecords(
    trainees.map((trainee) => trainee.id),
    p,
  )
  const rules = (await loadAttendanceRules(prisma, [preceptorId], []))(preceptorId)
  const charts: TraineeHoursCharts[] = trainees.map((trainee) => ({
      traineeId: trainee.id,
      traineeName: trainee.fullName,
    ...chartsFor(
      rows.filter((row) => row.traineeId === trainee.id),
      p,
      rules,
    ),
  }))
  return { month: p.month, trainees: charts, lateExtraGroup: lateExtraGroupOf(charts, p.month) }
}

/** The program's averages for ADMIN: per month, week and day, nothing per trainee, each bucket hidden below MIN_ATTENDANCE_GROUP. Null for a malformed month. */
export async function getProgramAttendanceHours(month?: string): Promise<ProgramAttendanceHours | null> {
  await requireNutritionRole(['ADMIN'])
  const p = period(month)
  if (!p) return null
  const trainees = await prisma.nutritionProfile.findMany({ where: { role: 'TRAINEE', isActive: true }, select: { id: true } })
  const ids = trainees.map((trainee) => trainee.id)
  const assignments =
    ids.length === 0
      ? []
      : await prisma.nutritionPreceptorAssignment.findMany({ where: { traineeId: { in: ids }, active: true }, select: { traineeId: true, preceptorId: true } })
  const preceptorOf = new Map(assignments.map((assignment) => [assignment.traineeId, assignment.preceptorId]))
  const [rows, rulesFor] = await Promise.all([liveRecords(ids, p), loadAttendanceRules(prisma, [null, ...preceptorOf.values()], [])])
  const charts = ids.map((id) =>
    chartsFor(
      rows.filter((row) => row.traineeId === id),
      p,
      rulesFor(preceptorOf.get(id) ?? null),
    ),
  )
  const ranges = groupRanges(charts, p.month)
  if (!ranges) return null
  return { month: p.month, ...ranges, lateExtra: lateExtraGroupOf(charts, p.month) }
}
