import 'server-only'
import type { AttendanceStatus } from '@prisma/client'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { NUTRITION_NO_ACCESS_PATH, requireNutritionRole } from '@/features/nutrition/auth/guard'
import { attendanceMonthSchema } from '@/features/nutrition/validation/attendance'
import { traineeIdSchema } from '@/features/nutrition/validation/epa'
import {
  checkInDecision,
  checkOutDecision,
  effectiveSchedule,
  type AttendanceWindow,
  type ScheduleRow,
} from '../attendance-core'
import {
  countedRange,
  daysOfMonth,
  dayKeyOf,
  groupPercent,
  karachiTime,
  localDateKarachi,
  monthOf,
  monthlyPercentage,
  workDateOf,
  workingDays,
  type AttendanceGroup,
  type AttendancePercentage,
  type DayKey,
} from '../attendance-core'
import { loadAttendanceRules, type AttendanceRules } from '../attendance-rules'
import { activePrimaryPreceptorId, activeTraineeIds } from '../evaluation-forms-core'
import { ownPreceptorId } from '../own-preceptor'
import { ownTraineeId } from '../own-trainee'

// Read models for trainee attendance (Attendance Step A4). Each loader checks
// its role itself, with an exact role list (portal-guard-coverage.test.ts):
//  - a TRAINEE reads only their own records and percentage;
//  - a PRECEPTOR reads the records and percentages of the trainees they are
//    ACTIVE primary preceptor of, plus the group average (hidden below
//    MIN_ATTENDANCE_GROUP);
//  - an ADMIN reads the program average only: no name, id or record, and
//    hidden below MIN_ATTENDANCE_GROUP;
//  - a super_admin ONLY (not every ADMIN) lists the month's records, voided
//    ones flagged, to choose what to void (listAttendanceRecordsForVoid).
// Apart from that list, voided rows are never returned and never counted.
//
// A month's percentage counts the working days from the later of the month's
// first day and the training start date, to the earlier of its last day and
// today. Working days use the trainee's CURRENT primary preceptor's schedule
// and holidays (with the program's), so a mid-month change of preceptor is
// not reflected for the earlier days.

export interface AttendanceDay {
  id: string
  workDate: DayKey
  /** Karachi "HH:MM", or null. */
  checkIn: string | null
  checkOut: string | null
  status: AttendanceStatus
}

export interface MyAttendance {
  month: string
  /** Today's live record, or null when the trainee has not checked in today. */
  today: AttendanceDay | null
  /** The month's live records, oldest first. */
  days: AttendanceDay[]
  percentage: AttendancePercentage
}

export interface TraineeAttendance {
  traineeId: string
  traineeName: string
  days: AttendanceDay[]
  percentage: AttendancePercentage
}

export interface PreceptorAttendance {
  month: string
  trainees: TraineeAttendance[]
  /** The average of the trainees' percentages; hidden below MIN_ATTENDANCE_GROUP. */
  group: AttendanceGroup
}

export interface ProgramAttendance {
  month: string
  /** The average over every active trainee with working days; hidden below MIN_ATTENDANCE_GROUP. */
  average: AttendanceGroup
}

/** One row of the super_admin's void list. */
export interface VoidableRecord {
  id: string
  traineeId: string
  traineeName: string
  workDate: DayKey
  status: AttendanceStatus
  voided: boolean
}

const RECORD_FIELDS = { id: true, traineeId: true, workDate: true, checkInAt: true, checkOutAt: true, status: true, voidedAt: true } as const

type RecordRow = {
  id: string
  traineeId: string
  workDate: Date
  checkInAt: Date | null
  checkOutAt: Date | null
  status: AttendanceStatus
  voidedAt: Date | null
}

function attendanceDay(row: RecordRow): AttendanceDay {
  return {
    id: row.id,
    workDate: dayKeyOf(row.workDate),
    checkIn: row.checkInAt ? karachiTime(row.checkInAt) : null,
    checkOut: row.checkOutAt ? karachiTime(row.checkOutAt) : null,
    status: row.status,
  }
}

/** The requested month, or the current Karachi month when none is given; null for a malformed one. */
function monthArgument(month: string | undefined, today: DayKey): string | null {
  if (month === undefined) return monthOf(today)
  return attendanceMonthSchema.safeParse(month).success ? month : null
}

/** One trainee's percentage for the month under `rules`. */
function percentageFor(rows: readonly RecordRow[], month: string, today: DayKey, trainingStart: Date | null, rules: AttendanceRules): AttendancePercentage {
  const range = countedRange(month, today, trainingStart ? dayKeyOf(trainingStart) : null)
  const days = range ? workingDays(range.from, range.to, rules.scheduleOn, rules.holidays) : []
  return monthlyPercentage(rows, days)
}

/** The live records of these trainees on these days, oldest first. */
async function liveRecords(traineeIds: readonly string[], days: readonly DayKey[]): Promise<RecordRow[]> {
  if (traineeIds.length === 0) return []
  return prisma.nutritionAttendanceRecord.findMany({
    where: { traineeId: { in: [...traineeIds] }, workDate: { in: days.map(workDateOf) }, voidedAt: null },
    orderBy: [{ workDate: 'asc' }],
    select: RECORD_FIELDS,
  })
}

/** The trainee's own month: today's record, the month's records and the percentage. Null for a malformed month. */
export async function getMyAttendance(month?: string): Promise<MyAttendance | null> {
  const access = await requireNutritionRole(['TRAINEE'])
  const traineeId = ownTraineeId(access)
  const today = localDateKarachi(new Date())
  const chosen = monthArgument(month, today)
  const days = chosen ? daysOfMonth(chosen) : null
  if (!chosen || !days) return null

  const [profile, preceptorId, rows, todayRow] = await Promise.all([
    prisma.nutritionProfile.findUnique({ where: { id: traineeId }, select: { trainingStartDate: true } }),
    activePrimaryPreceptorId(prisma, traineeId),
    liveRecords([traineeId], days),
    prisma.nutritionAttendanceRecord.findFirst({ where: { traineeId, workDate: workDateOf(today), voidedAt: null }, select: RECORD_FIELDS }),
  ])
  const rules = (await loadAttendanceRules(prisma, [preceptorId], days))(preceptorId)
  return {
    month: chosen,
    today: todayRow ? attendanceDay(todayRow) : null,
    days: rows.map(attendanceDay),
    percentage: percentageFor(rows, chosen, today, profile?.trainingStartDate ?? null, rules),
  }
}

/** The caller's ACTIVE primary trainees' month, each with records and percentage, plus the group average. Null for a malformed month. */
export async function listMyTraineesAttendance(month?: string): Promise<PreceptorAttendance | null> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const preceptorId = ownPreceptorId(access)
  const today = localDateKarachi(new Date())
  const chosen = monthArgument(month, today)
  const days = chosen ? daysOfMonth(chosen) : null
  if (!chosen || !days) return null

  const ids = await activeTraineeIds(prisma, preceptorId)
  const trainees =
    ids.length === 0
      ? []
      : await prisma.nutritionProfile.findMany({
          where: { id: { in: ids }, role: 'TRAINEE', isActive: true },
          orderBy: [{ fullName: 'asc' }],
          select: { id: true, fullName: true, trainingStartDate: true },
        })
  const rows = await liveRecords(
    trainees.map((trainee) => trainee.id),
    days,
  )
  const rules = (await loadAttendanceRules(prisma, [preceptorId], days))(preceptorId)
  const list = trainees.map((trainee) => {
    const own = rows.filter((row) => row.traineeId === trainee.id)
    return {
      traineeId: trainee.id,
      traineeName: trainee.fullName,
      days: own.map(attendanceDay),
      percentage: percentageFor(own, chosen, today, trainee.trainingStartDate, rules),
    }
  })
  return { month: chosen, trainees: list, group: groupPercent(list.map((trainee) => trainee.percentage.percent)) }
}

/** The program's average attendance for the month, for ADMIN: one aggregate, nothing per trainee. Null for a malformed month. */
export async function getProgramAttendanceSummary(month?: string): Promise<ProgramAttendance | null> {
  await requireNutritionRole(['ADMIN'])
  const today = localDateKarachi(new Date())
  const chosen = monthArgument(month, today)
  const days = chosen ? daysOfMonth(chosen) : null
  if (!chosen || !days) return null

  const trainees = await prisma.nutritionProfile.findMany({
    where: { role: 'TRAINEE', isActive: true },
    select: { id: true, trainingStartDate: true },
  })
  const ids = trainees.map((trainee) => trainee.id)
  const assignments =
    ids.length === 0
      ? []
      : await prisma.nutritionPreceptorAssignment.findMany({ where: { traineeId: { in: ids }, active: true }, select: { traineeId: true, preceptorId: true } })
  const preceptorOf = new Map(assignments.map((assignment) => [assignment.traineeId, assignment.preceptorId]))
  const [rows, rulesFor] = await Promise.all([
    liveRecords(ids, days),
    loadAttendanceRules(prisma, [null, ...preceptorOf.values()], days),
  ])
  const percents = trainees.map((trainee) => {
    const own = rows.filter((row) => row.traineeId === trainee.id)
    return percentageFor(own, chosen, today, trainee.trainingStartDate, rulesFor(preceptorOf.get(trainee.id) ?? null)).percent
  })
  return { month: chosen, average: groupPercent(percents) }
}

/**
 * super_admin ONLY: every record of the month (the current Karachi month when
 * none is given), voided ones included and flagged, oldest first, for
 * choosing what to void. A nutrition ADMIN who is not a super_admin is sent
 * to /nutrition/no-access. Null for a malformed month.
 */
export async function listAttendanceRecordsForVoid(month?: string): Promise<{ month: string; records: VoidableRecord[] } | null> {
  const access = await requireNutritionRole(['ADMIN'])
  if (!access.isSuperAdmin) redirect(NUTRITION_NO_ACCESS_PATH)
  const chosen = monthArgument(month, localDateKarachi(new Date()))
  const days = chosen ? daysOfMonth(chosen) : null
  if (!chosen || !days) return null

  const rows = await prisma.nutritionAttendanceRecord.findMany({
    where: { workDate: { in: days.map(workDateOf) } },
    orderBy: [{ workDate: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, traineeId: true, workDate: true, status: true, voidedAt: true, trainee: { select: { fullName: true } } },
  })
  return {
    month: chosen,
    records: rows.map((row) => ({
      id: row.id,
      traineeId: row.traineeId,
      traineeName: row.trainee.fullName,
      workDate: dayKeyOf(row.workDate),
      status: row.status,
      voided: row.voidedAt !== null,
    })),
  }
}

// ── Step 8 UI loaders ────────────────────────────────────────────────────────
//
// Added for the attendance screens. Same rules as above: each checks its role
// first, a trainee reads only their own data, a preceptor only their ACTIVE
// primary trainees', an ADMIN only program-wide settings. None of them ever
// returns a void reason or a staff reason.

/** One day of a month strip. VOIDED appears only in the preceptor's strip. */
export type CalendarKind = 'PRESENT' | 'STAFF' | 'ABSENT' | 'PENDING' | 'HOLIDAY' | 'OFF' | 'FUTURE' | 'NOT_STARTED' | 'VOIDED'

export interface CalendarDay {
  day: DayKey
  kind: CalendarKind
}

export interface AttendanceCalendar {
  month: string
  traineeId: string
  days: CalendarDay[]
}

/** What the trainee's check-in panel shows: today's window and record, and whether each button would be accepted now. */
export interface CheckInStatus {
  today: DayKey
  /** Karachi "HH:MM" when the page was loaded. */
  now: string
  window: AttendanceWindow
  holiday: boolean
  workingDay: boolean
  record: AttendanceDay | null
  checkIn: { allowed: boolean; message: string | null }
  checkOut: { allowed: boolean; message: string | null }
}

export interface ScheduleView {
  id: string
  weekdays: number[]
  startTime: string
  endTime: string
  effectiveFrom: DayKey
}

export interface HolidayView {
  id: string
  workDate: DayKey
  /** Free text set by its author. */
  name: string
}

export interface AttendanceSettings {
  today: DayKey
  /** The window in force today, and where it comes from. */
  inForce: { window: AttendanceWindow; source: 'MINE' | 'PROGRAM' | 'DEFAULT' }
  /** The caller's own rows (preceptor) or the program's (admin). Newest first. */
  schedules: ScheduleView[]
  /** Live holidays the caller may remove, oldest first. */
  holidays: HolidayView[]
  /** For a preceptor: the program's live holidays, which apply too (read only). Empty for the admin view. */
  programHolidays: HolidayView[]
}

const SCHEDULE_VIEW_FIELDS = { id: true, scopeProfileId: true, weekdays: true, startTime: true, endTime: true, effectiveFrom: true } as const
const HOLIDAY_VIEW_FIELDS = { id: true, scopeProfileId: true, workDate: true, name: true } as const

const scheduleView = (row: ScheduleRow & { id: string }): ScheduleView => ({
  id: row.id,
  weekdays: [...row.weekdays],
  startTime: row.startTime,
  endTime: row.endTime,
  effectiveFrom: dayKeyOf(row.effectiveFrom),
})

const holidayView = (row: { id: string; workDate: Date; name: string }): HolidayView => ({ id: row.id, workDate: dayKeyOf(row.workDate), name: row.name })

const startsBy = (day: DayKey, rows: readonly ScheduleRow[]) => rows.some((row) => dayKeyOf(row.effectiveFrom) <= day)

const weekdayNumber = (day: DayKey) => new Date(`${day}T00:00:00Z`).getUTCDay()

/**
 * Each day of the month, classified. A live record wins; then (preceptor only)
 * a day whose only rows are voided; then before the training start date, a
 * holiday (program AND preceptor), a non-working day, a future day, today
 * without a record (PENDING), and finally ABSENT.
 */
function calendarDays(
  days: readonly DayKey[],
  today: DayKey,
  trainingStart: DayKey | null,
  rules: AttendanceRules,
  live: readonly RecordRow[],
  voided: readonly RecordRow[] | null,
): CalendarDay[] {
  return days.map((day): CalendarDay => {
    const row = live.find((r) => dayKeyOf(r.workDate) === day)
    if (row) return { day, kind: row.status === 'OUT_OF_WINDOW_RECORDED_BY_STAFF' ? 'STAFF' : 'PRESENT' }
    if (voided?.some((r) => dayKeyOf(r.workDate) === day)) return { day, kind: 'VOIDED' }
    if (trainingStart && day < trainingStart) return { day, kind: 'NOT_STARTED' }
    if (rules.holidays.includes(day)) return { day, kind: 'HOLIDAY' }
    if (!rules.scheduleOn(day).weekdays.includes(weekdayNumber(day))) return { day, kind: 'OFF' }
    if (day > today) return { day, kind: 'FUTURE' }
    return { day, kind: day === today ? 'PENDING' : 'ABSENT' }
  })
}

const windowCopy = (window: AttendanceWindow): AttendanceWindow => ({ weekdays: [...window.weekdays], startTime: window.startTime, endTime: window.endTime })

/** The trainee's check-in panel: today's window, holiday or not, today's record, and whether check-in or check-out is open now. */
export async function getMyCheckInStatus(): Promise<CheckInStatus> {
  const access = await requireNutritionRole(['TRAINEE'])
  const traineeId = ownTraineeId(access)
  const now = new Date()
  const today = localDateKarachi(now)
  const [preceptorId, record] = await Promise.all([
    activePrimaryPreceptorId(prisma, traineeId),
    prisma.nutritionAttendanceRecord.findFirst({ where: { traineeId, workDate: workDateOf(today), voidedAt: null }, select: RECORD_FIELDS }),
  ])
  const rules = (await loadAttendanceRules(prisma, [preceptorId], [today]))(preceptorId)
  const window = rules.scheduleOn(today)
  const inDecision = checkInDecision(now, window, rules.holidays, record)
  const outDecision = checkOutDecision(now, record)
  return {
    today,
    now: karachiTime(now),
    window: windowCopy(window),
    holiday: rules.holidays.includes(today),
    workingDay: window.weekdays.includes(weekdayNumber(today)),
    record: record ? attendanceDay(record) : null,
    checkIn: { allowed: inDecision.allowed, message: inDecision.allowed ? null : inDecision.message },
    checkOut: { allowed: outDecision.allowed, message: outDecision.allowed ? null : outDecision.message },
  }
}

/** The trainee's own month strip (no voided days). Null for a malformed month. */
export async function getMyAttendanceCalendar(month?: string): Promise<AttendanceCalendar | null> {
  const access = await requireNutritionRole(['TRAINEE'])
  const traineeId = ownTraineeId(access)
  const today = localDateKarachi(new Date())
  const chosen = monthArgument(month, today)
  const days = chosen ? daysOfMonth(chosen) : null
  if (!chosen || !days) return null
  const [profile, preceptorId, rows] = await Promise.all([
    prisma.nutritionProfile.findUnique({ where: { id: traineeId }, select: { trainingStartDate: true } }),
    activePrimaryPreceptorId(prisma, traineeId),
    liveRecords([traineeId], days),
  ])
  const rules = (await loadAttendanceRules(prisma, [preceptorId], days))(preceptorId)
  const start = profile?.trainingStartDate ? dayKeyOf(profile.trainingStartDate) : null
  return { month: chosen, traineeId, days: calendarDays(days, today, start, rules, rows, null) }
}

/**
 * One of the caller's ACTIVE primary trainees' month strip, voided days shown
 * as VOIDED (greyed). Null for anyone else, a deactivated trainee, or a
 * malformed id or month.
 */
export async function getTraineeAttendanceCalendar(traineeId: string, month?: string): Promise<AttendanceCalendar | null> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const preceptorId = ownPreceptorId(access)
  const parsed = traineeIdSchema.safeParse({ traineeId })
  if (!parsed.success) return null
  const today = localDateKarachi(new Date())
  const chosen = monthArgument(month, today)
  const days = chosen ? daysOfMonth(chosen) : null
  if (!chosen || !days) return null
  if ((await activePrimaryPreceptorId(prisma, parsed.data.traineeId)) !== preceptorId) return null
  const trainee = await prisma.nutritionProfile.findUnique({
    where: { id: parsed.data.traineeId },
    select: { role: true, isActive: true, trainingStartDate: true },
  })
  if (trainee?.role !== 'TRAINEE' || !trainee.isActive) return null
  const rows = await prisma.nutritionAttendanceRecord.findMany({
    where: { traineeId: parsed.data.traineeId, workDate: { in: days.map(workDateOf) } },
    orderBy: [{ workDate: 'asc' }],
    select: RECORD_FIELDS,
  })
  const rules = (await loadAttendanceRules(prisma, [preceptorId], days))(preceptorId)
  const start = trainee.trainingStartDate ? dayKeyOf(trainee.trainingStartDate) : null
  const live = rows.filter((row) => row.voidedAt === null)
  const voided = rows.filter((row) => row.voidedAt !== null)
  return { month: chosen, traineeId: parsed.data.traineeId, days: calendarDays(days, today, start, rules, live, voided) }
}

/** The calling preceptor's own schedules and holidays, plus the program's holidays (which apply too). */
export async function listMyAttendanceSettings(): Promise<AttendanceSettings> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const preceptorId = ownPreceptorId(access)
  const today = localDateKarachi(new Date())
  const scope = { OR: [{ scopeProfileId: null }, { scopeProfileId: preceptorId }] }
  const [schedules, holidays] = await Promise.all([
    prisma.nutritionAttendanceSchedule.findMany({ where: scope, orderBy: [{ effectiveFrom: 'desc' }], select: SCHEDULE_VIEW_FIELDS }),
    prisma.nutritionAttendanceHoliday.findMany({ where: { ...scope, voidedAt: null }, orderBy: [{ workDate: 'asc' }], select: HOLIDAY_VIEW_FIELDS }),
  ])
  const own = schedules.filter((row) => row.scopeProfileId === preceptorId)
  const program = schedules.filter((row) => row.scopeProfileId === null)
  return {
    today,
    inForce: {
      window: windowCopy(effectiveSchedule(today, own, program)),
      source: startsBy(today, own) ? 'MINE' : startsBy(today, program) ? 'PROGRAM' : 'DEFAULT',
    },
    schedules: own.map(scheduleView),
    holidays: holidays.filter((row) => row.scopeProfileId === preceptorId).map(holidayView),
    programHolidays: holidays.filter((row) => row.scopeProfileId === null).map(holidayView),
  }
}

/** The program default schedules and the program's live holidays, for ADMIN. */
export async function getProgramAttendanceSettings(): Promise<AttendanceSettings> {
  await requireNutritionRole(['ADMIN'])
  const today = localDateKarachi(new Date())
  const [schedules, holidays] = await Promise.all([
    prisma.nutritionAttendanceSchedule.findMany({ where: { scopeProfileId: null }, orderBy: [{ effectiveFrom: 'desc' }], select: SCHEDULE_VIEW_FIELDS }),
    prisma.nutritionAttendanceHoliday.findMany({ where: { scopeProfileId: null, voidedAt: null }, orderBy: [{ workDate: 'asc' }], select: HOLIDAY_VIEW_FIELDS }),
  ])
  return {
    today,
    inForce: {
      window: windowCopy(effectiveSchedule(today, [], schedules)),
      source: startsBy(today, schedules) ? 'PROGRAM' : 'DEFAULT',
    },
    schedules: schedules.map(scheduleView),
    holidays: holidays.map(holidayView),
    programHolidays: [],
  }
}
