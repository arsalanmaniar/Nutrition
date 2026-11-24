import 'server-only'
import type { AttendanceStatus } from '@prisma/client'
import {
  ATTENDANCE_TIMEZONE,
  DEFAULT_ATTENDANCE_WINDOW,
  DEFAULT_WORKING_WEEKDAYS,
  HH_MM_PATTERN,
  MIN_ATTENDANCE_GROUP,
} from '@/features/nutrition/config/attendance'
import type { Snapshot } from './audit'

// Pure attendance rules (Attendance module, Step A3). No database, no roles:
// every caller has already run requireNutritionRole and loaded the rows.
//
// Days are Karachi calendar days written "YYYY-MM-DD" (DayKey). A @db.Date
// column comes back from Prisma as midnight UTC of that day, so dayKeyOf reads
// it with toISOString and workDateOf builds one the same way. Instants (now,
// checkInAt, checkOutAt) are converted to Karachi wall-clock time only through
// ATTENDANCE_TIMEZONE, never through the server's own zone.

/** A Karachi calendar day, "YYYY-MM-DD". */
export type DayKey = string

/** Working days and the daily window: what a schedule row holds. */
export interface AttendanceWindow {
  /** 0 = Sunday … 6 = Saturday. */
  readonly weekdays: readonly number[]
  /** Karachi "HH:MM". */
  readonly startTime: string
  readonly endTime: string
}

/** A schedule row as loaded: a window plus the day it applies from. */
export interface ScheduleRow extends AttendanceWindow {
  readonly effectiveFrom: Date
}

/** The fields of an attendance row these rules read. */
export interface AttendanceRecordLike {
  readonly workDate: Date
  readonly checkInAt: Date | null
  readonly checkOutAt: Date | null
  readonly status: AttendanceStatus
  readonly voidedAt: Date | null
}

/** The program's default window from config, used when no schedule row applies. */
export const CONFIG_DEFAULT_WINDOW: AttendanceWindow = {
  weekdays: DEFAULT_WORKING_WEEKDAYS,
  startTime: DEFAULT_ATTENDANCE_WINDOW.startTime,
  endTime: DEFAULT_ATTENDANCE_WINDOW.endTime,
}

// ── Days and times in Karachi ────────────────────────────────────────────────

// hourCycle h23: midnight is "00", never "24".
const KARACHI_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: ATTENDANCE_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

function karachiParts(now: Date): { day: DayKey; secondOfDay: number } {
  if (Number.isNaN(now.getTime())) throw new RangeError('Invalid date')
  const parts: Record<string, string> = {}
  for (const part of KARACHI_PARTS.formatToParts(now)) parts[part.type] = part.value
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    secondOfDay: Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second),
  }
}

/** The Karachi calendar day `now` falls on. */
export function localDateKarachi(now: Date): DayKey {
  return karachiParts(now).day
}

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** A real "YYYY-MM-DD" day as a @db.Date value (midnight UTC); throws on anything else. */
export function workDateOf(day: DayKey): Date {
  const date = new Date(`${day}T00:00:00.000Z`)
  if (!DAY_KEY_PATTERN.test(day) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) {
    throw new RangeError(`Not a calendar day: ${day}`)
  }
  return date
}

/** A @db.Date value (midnight UTC) as its day. */
export function dayKeyOf(date: Date): DayKey {
  return date.toISOString().slice(0, 10)
}

/** The day of the week of a calendar day: 0 = Sunday … 6 = Saturday. */
export function weekdayOf(day: DayKey): number {
  return workDateOf(day).getUTCDay()
}

/** Minutes after midnight for a valid "HH:MM"; null for anything else. */
export function parseHhMm(value: string): number | null {
  if (!HH_MM_PATTERN.test(value)) return null
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5))
}

/**
 * Whether a window is usable: at least one weekday, each a whole number 0–6,
 * both times valid "HH:MM", and start before end (the window lies within one
 * day). The database CHECKs in nutrition-step8.sql enforce the same rules.
 */
export function isValidWindow(window: AttendanceWindow): boolean {
  const start = parseHhMm(window.startTime)
  const end = parseHhMm(window.endTime)
  return (
    window.weekdays.length > 0 &&
    window.weekdays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) &&
    start !== null &&
    end !== null &&
    start < end
  )
}

/**
 * Whether `now`, in Karachi wall-clock time, is inside the window.
 *
 * BOUNDARY RULE: start included, end excluded, to the second. With 08:00 to
 * 17:00, 08:00:00 is inside, 16:59:59 is inside and 17:00:00 is outside. An
 * invalid window contains no time at all, so it refuses rather than allows.
 * Only the time is compared: whether the day itself is a working day is
 * checked separately (checkInDecision).
 */
export function isWithinWindow(now: Date, schedule: AttendanceWindow): boolean {
  if (!isValidWindow(schedule)) return false
  const second = karachiParts(now).secondOfDay
  const start = parseHhMm(schedule.startTime)! * 60
  const end = parseHhMm(schedule.endTime)! * 60
  return second >= start && second < end
}

// ── Which schedule applies ───────────────────────────────────────────────────

function latestOnOrBefore(day: DayKey, rows: readonly ScheduleRow[]): ScheduleRow | null {
  let best: ScheduleRow | null = null
  for (const row of rows) {
    const from = dayKeyOf(row.effectiveFrom)
    if (from <= day && (best === null || from > dayKeyOf(best.effectiveFrom))) best = row
  }
  return best
}

/**
 * The window in force on `day` for a trainee: the preceptor's schedule row
 * with the latest effectiveFrom on or before that day; failing that, the
 * program default row (scope NULL) chosen the same way; failing that,
 * CONFIG_DEFAULT_WINDOW. Rows starting after `day` are ignored.
 */
export function effectiveSchedule(
  day: DayKey,
  preceptorSchedules: readonly ScheduleRow[],
  programSchedules: readonly ScheduleRow[],
): AttendanceWindow {
  const row = latestOnOrBefore(day, preceptorSchedules) ?? latestOnOrBefore(day, programSchedules)
  return row ? { weekdays: row.weekdays, startTime: row.startTime, endTime: row.endTime } : CONFIG_DEFAULT_WINDOW
}

/** A working day: one of the schedule's weekdays and not a holiday. */
export function isWorkingDay(day: DayKey, schedule: AttendanceWindow, holidays: readonly DayKey[]): boolean {
  return schedule.weekdays.includes(weekdayOf(day)) && !holidays.includes(day)
}

const MAX_RANGE_DAYS = 400

/**
 * The working days from `from` to `to`, both included, in order. `scheduleOn`
 * gives the window in force on each day, so a schedule change mid-range is
 * honoured. At most MAX_RANGE_DAYS days.
 */
export function workingDays(
  from: DayKey,
  to: DayKey,
  scheduleOn: (day: DayKey) => AttendanceWindow,
  holidays: readonly DayKey[],
): DayKey[] {
  const start = workDateOf(from).getTime()
  const end = workDateOf(to).getTime()
  const days: DayKey[] = []
  for (let t = start, n = 0; t <= end; t += 86400000, n++) {
    if (n >= MAX_RANGE_DAYS) throw new RangeError(`More than ${MAX_RANGE_DAYS} days`)
    const day = dayKeyOf(new Date(t))
    if (isWorkingDay(day, scheduleOn(day), holidays)) days.push(day)
  }
  return days
}

// ── Check-in and check-out ───────────────────────────────────────────────────

export type CheckInRefusal = 'ALREADY_CHECKED_OUT' | 'ALREADY_CHECKED_IN' | 'HOLIDAY' | 'WEEKEND' | 'OUTSIDE_WINDOW'
export type CheckOutRefusal = 'NO_CHECK_IN' | 'NOT_TODAY' | 'ALREADY_CHECKED_OUT' | 'BEFORE_CHECK_IN'

export type CheckInDecision =
  | { readonly allowed: true; readonly workDate: DayKey }
  | { readonly allowed: false; readonly reason: CheckInRefusal; readonly message: string }

export type CheckOutDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: CheckOutRefusal; readonly message: string }

const isLive = (record: AttendanceRecordLike | null): record is AttendanceRecordLike => record !== null && record.voidedAt === null

/**
 * Whether the trainee may check in at `now`. Checked in this order, first
 * refusal wins:
 *  1. today's live record already has a check-out → ALREADY_CHECKED_OUT;
 *  2. today's live record already has a check-in → ALREADY_CHECKED_IN;
 *  3. today (Karachi) is a holiday → HOLIDAY;
 *  4. today's weekday is not in the schedule → WEEKEND;
 *  5. the time is outside the window (end excluded) → OUTSIDE_WINDOW.
 * "Today" is the Karachi day of `now`. A voided record, or one for another
 * day, is ignored: after a void the trainee may record the day again.
 *
 * HOLIDAY RULE (CDN-EP-PLAN.md, Decisions (Attendance Step A) item 1):
 * `holidays` is the UNION of the program-wide holidays (scope NULL) AND the
 * holidays of the trainee's active primary preceptor. Both always apply; a
 * preceptor's holidays never replace the program's. The caller builds the union.
 */
export function checkInDecision(
  now: Date,
  schedule: AttendanceWindow,
  holidays: readonly DayKey[],
  existingRecord: AttendanceRecordLike | null,
): CheckInDecision {
  const today = localDateKarachi(now)
  const record = isLive(existingRecord) && dayKeyOf(existingRecord.workDate) === today ? existingRecord : null
  if (record?.checkOutAt) return { allowed: false, reason: 'ALREADY_CHECKED_OUT', message: 'You have already checked out today.' }
  if (record?.checkInAt) return { allowed: false, reason: 'ALREADY_CHECKED_IN', message: 'You have already checked in today.' }
  if (holidays.includes(today)) return { allowed: false, reason: 'HOLIDAY', message: 'Today is a holiday, so attendance is not recorded.' }
  if (!schedule.weekdays.includes(weekdayOf(today))) {
    return { allowed: false, reason: 'WEEKEND', message: 'Today is not a working day, so attendance is not recorded.' }
  }
  if (!isWithinWindow(now, schedule)) {
    return {
      allowed: false,
      reason: 'OUTSIDE_WINDOW',
      message: `Check-in is open from ${schedule.startTime} until ${schedule.endTime}, Karachi time.`,
    }
  }
  return { allowed: true, workDate: today }
}

/**
 * Whether the trainee may check out of `record` at `now`. Refused when there is
 * no live record or it has no check-in (NO_CHECK_IN), when the record is for
 * another Karachi day (NOT_TODAY: a forgotten check-out is fixed by an editor,
 * not by checking out the next day), when it is already checked out, or when
 * `now` is before the check-in (BEFORE_CHECK_IN). Check-out is not limited to
 * the window.
 */
export function checkOutDecision(now: Date, record: AttendanceRecordLike | null): CheckOutDecision {
  if (!isLive(record) || !record.checkInAt) return { allowed: false, reason: 'NO_CHECK_IN', message: 'You have not checked in today.' }
  if (dayKeyOf(record.workDate) !== localDateKarachi(now)) {
    return { allowed: false, reason: 'NOT_TODAY', message: 'This attendance record is for another day.' }
  }
  if (record.checkOutAt) return { allowed: false, reason: 'ALREADY_CHECKED_OUT', message: 'You have already checked out today.' }
  if (now.getTime() < record.checkInAt.getTime()) {
    return { allowed: false, reason: 'BEFORE_CHECK_IN', message: 'Check-out cannot be earlier than check-in.' }
  }
  return { allowed: true }
}

// ── Percentages ──────────────────────────────────────────────────────────────

export interface AttendancePercentage {
  readonly presentDays: number
  readonly workingDays: number
  /** Present days over working days × 100, one decimal; null when there are no working days. */
  readonly percent: number | null
}

/**
 * Attendance over a period. `workingDays` are the period's working days (see
 * workingDays). A day counts as present when it is one of them and has a
 * non-voided record that has a check-in or was recorded by staff. Voided rows
 * never count; a day with two rows counts once; a record on a non-working day
 * is not counted, so the percentage cannot pass 100.
 */
export function monthlyPercentage(records: readonly AttendanceRecordLike[], workingDays: readonly DayKey[]): AttendancePercentage {
  const working = new Set(workingDays)
  const present = new Set<DayKey>()
  for (const record of records) {
    if (record.voidedAt !== null) continue
    if (record.checkInAt === null && record.status !== 'OUT_OF_WINDOW_RECORDED_BY_STAFF') continue
    const day = dayKeyOf(record.workDate)
    if (working.has(day)) present.add(day)
  }
  const total = working.size
  return {
    presentDays: present.size,
    workingDays: total,
    percent: total === 0 ? null : Math.round((present.size / total) * 1000) / 10,
  }
}

// ── Step A4 helpers: wall-clock times, periods, groups, audit snapshots ──────

/** The Karachi wall-clock time of an instant, "HH:MM". */
export function karachiTime(instant: Date): string {
  const second = karachiParts(instant).secondOfDay
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(second / 3600))}:${pad(Math.floor(second / 60) % 60)}`
}

/** Milliseconds since 1970 of Karachi wall-clock `second` on `day`, read as if it were UTC. */
function wallMs(day: DayKey, second: number): number {
  return workDateOf(day).getTime() + second * 1000
}

/** The instant at which Karachi wall-clock time is `time` ("HH:MM") on `day`. Throws on a bad day or time. */
export function karachiInstant(day: DayKey, time: string): Date {
  const minutes = parseHhMm(time)
  if (minutes === null) throw new RangeError(`Not a time: ${time}`)
  const target = wallMs(day, minutes * 60)
  // Shift by the zone's offset, then check once more (exact for any zone whose
  // offset does not change within the day; Karachi has a single offset).
  let instant = target
  for (let pass = 0; pass < 2; pass++) {
    const parts = karachiParts(new Date(instant))
    instant += target - wallMs(parts.day, parts.secondOfDay)
  }
  return new Date(instant)
}

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/

/** The month a day is in, "YYYY-MM". */
export function monthOf(day: DayKey): string {
  return day.slice(0, 7)
}

/** Every day of a month ("YYYY-MM"), in order; null for anything else. */
export function daysOfMonth(month: string): DayKey[] | null {
  const match = MONTH_PATTERN.exec(month)
  if (!match) return null
  const count = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate()
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}

/**
 * The part of a month that counts towards a percentage: from the later of the
 * month's first day and the training start date, to the earlier of the
 * month's last day and today, both included. Null when nothing is left (a
 * future month, or training starting after it).
 */
export function countedRange(month: string, today: DayKey, trainingStart: DayKey | null): { from: DayKey; to: DayKey } | null {
  const days = daysOfMonth(month)
  if (!days) return null
  const from = trainingStart && trainingStart > days[0] ? trainingStart : days[0]
  const last = days[days.length - 1]
  const to = today < last ? today : last
  return from <= to ? { from, to } : null
}

/** A group's average percentage, or only its size when it has fewer than `min` trainees. */
export type AttendanceGroup =
  | { readonly n: number; readonly hidden: true }
  | { readonly n: number; readonly hidden: false; readonly percent: number }

/**
 * The average of the trainees' percentages, counting only trainees who have
 * one (null = no working days yet). Below `min` (MIN_ATTENDANCE_GROUP) only
 * the size is shown: a group that small could identify a trainee.
 */
export function groupPercent(percents: readonly (number | null)[], min = MIN_ATTENDANCE_GROUP): AttendanceGroup {
  const values = percents.filter((value): value is number => value !== null)
  if (values.length < min) return { n: values.length, hidden: true }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  return { n: values.length, hidden: false, percent: Math.round(mean * 10) / 10 }
}

const isoOrNull = (date: Date | null) => date?.toISOString() ?? null

/** An attendance row for the audit log: ids, day, times and status. Never the void reason. */
export function attendanceRecordSnapshot(row: {
  id: string
  traineeId: string
  workDate: Date
  checkInAt: Date | null
  checkOutAt: Date | null
  status: AttendanceStatus
  voidedAt: Date | null
  voidedById: string | null
}): Snapshot {
  return {
    id: row.id,
    traineeId: row.traineeId,
    workDate: dayKeyOf(row.workDate),
    checkInAt: isoOrNull(row.checkInAt),
    checkOutAt: isoOrNull(row.checkOutAt),
    status: row.status,
    voidedAt: isoOrNull(row.voidedAt),
    voidedById: row.voidedById,
  }
}

/** A schedule row for the audit log: scope, weekdays, times and first day. */
export function attendanceScheduleSnapshot(row: {
  id: string
  scopeProfileId: string | null
  weekdays: readonly number[]
  startTime: string
  endTime: string
  effectiveFrom: Date
}): Snapshot {
  return {
    id: row.id,
    scopeProfileId: row.scopeProfileId,
    weekdays: row.weekdays.join(','),
    startTime: row.startTime,
    endTime: row.endTime,
    effectiveFrom: dayKeyOf(row.effectiveFrom),
  }
}

/** A holiday for the audit log: scope, day and void state. Never its name or void reason (free text). */
export function attendanceHolidaySnapshot(row: {
  id: string
  scopeProfileId: string | null
  workDate: Date
  voidedAt: Date | null
  voidedById: string | null
}): Snapshot {
  return {
    id: row.id,
    scopeProfileId: row.scopeProfileId,
    workDate: dayKeyOf(row.workDate),
    voidedAt: isoOrNull(row.voidedAt),
    voidedById: row.voidedById,
  }
}

// ── Missed days: a record created by an editor ───────────────────────────────

export type MissedDayRefusal = 'FUTURE' | 'BEFORE_TRAINING' | 'HOLIDAY' | 'NOT_WORKING_DAY' | 'ALREADY_RECORDED'

export type MissedDayDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: MissedDayRefusal; readonly message: string }

/**
 * Whether an editor may create a record for `day`, a day the trainee did not
 * record. Checked in this order, first refusal wins: the day is after today
 * (Karachi) → FUTURE; before the training start date → BEFORE_TRAINING; a
 * holiday that applies (program AND preceptor) → HOLIDAY; not one of the
 * schedule's weekdays → NOT_WORKING_DAY; a live record already exists →
 * ALREADY_RECORDED (edit it instead). A voided record does not block.
 */
export function missedDayDecision(
  day: DayKey,
  today: DayKey,
  trainingStart: DayKey | null,
  schedule: AttendanceWindow,
  holidays: readonly DayKey[],
  existingRecord: AttendanceRecordLike | null,
): MissedDayDecision {
  if (day > today) return { allowed: false, reason: 'FUTURE', message: 'A missed day cannot be in the future.' }
  if (trainingStart && day < trainingStart) {
    return { allowed: false, reason: 'BEFORE_TRAINING', message: "This day is before the trainee's training start date." }
  }
  if (holidays.includes(day)) return { allowed: false, reason: 'HOLIDAY', message: 'This day is a holiday.' }
  if (!schedule.weekdays.includes(weekdayOf(day))) return { allowed: false, reason: 'NOT_WORKING_DAY', message: 'This day is not a working day.' }
  if (isLive(existingRecord) && dayKeyOf(existingRecord.workDate) === day) {
    return { allowed: false, reason: 'ALREADY_RECORDED', message: 'This day already has a record. Edit that record instead.' }
  }
  return { allowed: true }
}
