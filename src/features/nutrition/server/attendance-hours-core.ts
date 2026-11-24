import 'server-only'
import { MIN_ATTENDANCE_GROUP } from '@/features/nutrition/config/attendance'
import { dayKeyOf, daysOfMonth, isValidWindow, karachiInstant, type AttendanceRecordLike, type AttendanceWindow, type DayKey } from './attendance-core'

// Late arrival, early leaving and hours worked, for the attendance graphs.
// Pure: no database, no roles; every caller has already run
// requireNutritionRole and loaded the rows. Nothing here changes a rule in
// attendance-core.ts; it only reads records against the window in force.
//
//  - Late minutes  = max(0, check-in − window start), on the record's own day.
//  - Early minutes = max(0, window end − check-out), on the record's own day.
//  - Hours worked  = check-out − check-in.
// Times are compared as instants: the window's start and end are turned into
// instants on the record's Karachi day (karachiInstant), so the result does
// not depend on the server's time zone. Minutes are whole minutes, rounded
// down: a check-in at 08:00:59 against a start of 08:00 is 0 minutes late.
//
// Voided records are ignored. A day counts towards the late, early and hours
// figures only when its live record has BOTH a check-in and a check-out (a
// "complete day"); a day with only a check-in still counts as a present day.

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000

/** How many months the monthly bars show, ending with the chosen month. */
export const HOURS_CHART_MONTHS = 6

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places

/** Minutes after the window's start that `checkInAt` came on `day`; 0 when on time or early. Null with no check-in or an unusable window. */
export function lateMinutes(day: DayKey, checkInAt: Date | null, window: AttendanceWindow): number | null {
  if (checkInAt === null || !isValidWindow(window)) return null
  return Math.max(0, Math.floor((checkInAt.getTime() - karachiInstant(day, window.startTime).getTime()) / MINUTE_MS))
}

/** Minutes before the window's end that `checkOutAt` came on `day`; 0 when at or after the end. Null with no check-out or an unusable window. */
export function earlyMinutes(day: DayKey, checkOutAt: Date | null, window: AttendanceWindow): number | null {
  if (checkOutAt === null || !isValidWindow(window)) return null
  return Math.max(0, Math.floor((karachiInstant(day, window.endTime).getTime() - checkOutAt.getTime()) / MINUTE_MS))
}

/** Hours from check-in to check-out, two decimals. Null when either is missing or the check-out is earlier. */
export function hoursWorked(checkInAt: Date | null, checkOutAt: Date | null): number | null {
  if (checkInAt === null || checkOutAt === null) return null
  const ms = checkOutAt.getTime() - checkInAt.getTime()
  return ms < 0 ? null : round(ms / HOUR_MS, 2)
}

/** One day of the hours line. All three values are null unless the day is complete (check-in and check-out). */
export interface DailyHours {
  readonly day: DayKey
  readonly lateMinutes: number | null
  readonly earlyMinutes: number | null
  readonly hoursWorked: number | null
}

const isLive = (record: AttendanceRecordLike) => record.voidedAt === null

/** Each of `days` with its late, early and hours figures from the day's live record, under the window in force that day. */
export function dailyHours(records: readonly AttendanceRecordLike[], days: readonly DayKey[], scheduleOn: (day: DayKey) => AttendanceWindow): DailyHours[] {
  const byDay = new Map<DayKey, AttendanceRecordLike>()
  for (const record of records) {
    const day = dayKeyOf(record.workDate)
    if (isLive(record) && !byDay.has(day)) byDay.set(day, record)
  }
  return days.map((day) => {
    const record = byDay.get(day)
    const hours = record ? hoursWorked(record.checkInAt, record.checkOutAt) : null
    if (!record || hours === null) return { day, lateMinutes: null, earlyMinutes: null, hoursWorked: null }
    const window = scheduleOn(day)
    return {
      day,
      lateMinutes: lateMinutes(day, record.checkInAt, window),
      earlyMinutes: earlyMinutes(day, record.checkOutAt, window),
      hoursWorked: hours,
    }
  })
}

/** A month's totals for one trainee. */
export interface HoursSummary {
  /** Days with a live record that has a check-in or was recorded by staff. */
  readonly presentDays: number
  /** Present days with both a check-in and a check-out: the only days the figures below measure. */
  readonly completeDays: number
  readonly lateMinutes: number
  readonly earlyMinutes: number
  /** Total hours worked, two decimals. */
  readonly hoursWorked: number
  /** Per complete day, one decimal (hours: two); null when there is no complete day. */
  readonly averageLateMinutes: number | null
  readonly averageEarlyMinutes: number | null
  readonly averageHoursWorked: number | null
}

/**
 * The month's totals from its live records: present days, complete days, the
 * sums of late minutes, early-leave minutes and hours worked, and their
 * averages per complete day. Records outside `days` are left out.
 */
export function monthlyHoursSummary(
  records: readonly AttendanceRecordLike[],
  days: readonly DayKey[],
  scheduleOn: (day: DayKey) => AttendanceWindow,
): HoursSummary {
  const inMonth = new Set(days)
  const present = new Set<DayKey>()
  for (const record of records) {
    const day = dayKeyOf(record.workDate)
    if (!isLive(record) || !inMonth.has(day)) continue
    if (record.checkInAt !== null || record.status === 'OUT_OF_WINDOW_RECORDED_BY_STAFF') present.add(day)
  }
  const complete = dailyHours(records, days, scheduleOn).filter((d) => d.hoursWorked !== null)
  const sum = (pick: (d: DailyHours) => number | null) => complete.reduce((total, d) => total + (pick(d) ?? 0), 0)
  const late = sum((d) => d.lateMinutes)
  const early = sum((d) => d.earlyMinutes)
  const hours = round(sum((d) => d.hoursWorked), 2)
  const n = complete.length
  return {
    presentDays: present.size,
    completeDays: n,
    lateMinutes: late,
    earlyMinutes: early,
    hoursWorked: hours,
    averageLateMinutes: n === 0 ? null : round(late / n, 1),
    averageEarlyMinutes: n === 0 ? null : round(early / n, 1),
    averageHoursWorked: n === 0 ? null : round(hours / n, 2),
  }
}

/** A program-wide month: averages over trainees, or only the group's size when it has fewer than `min`. */
export type HoursGroup =
  | { readonly n: number; readonly hidden: true }
  | {
      readonly n: number
      readonly hidden: false
      /** The average trainee's monthly total, one decimal. */
      readonly lateMinutes: number
      readonly earlyMinutes: number
      /** The average of the trainees' hours per complete day, two decimals. */
      readonly averageHoursWorked: number
    }

/**
 * The program's averages for a month, over the trainees with at least one
 * complete day. Below `min` (MIN_ATTENDANCE_GROUP) only the size is given: a
 * group that small could identify a trainee.
 */
export function groupHours(summaries: readonly HoursSummary[], min = MIN_ATTENDANCE_GROUP): HoursGroup {
  const counted = summaries.filter((s) => s.completeDays > 0)
  if (counted.length < min) return { n: counted.length, hidden: true }
  const mean = (pick: (s: HoursSummary) => number) => counted.reduce((total, s) => total + pick(s), 0) / counted.length
  return {
    n: counted.length,
    hidden: false,
    lateMinutes: round(mean((s) => s.lateMinutes), 1),
    earlyMinutes: round(mean((s) => s.earlyMinutes), 1),
    averageHoursWorked: round(mean((s) => s.averageHoursWorked ?? 0), 2),
  }
}

/** One day of the program's daily graphs: averages over trainees with a complete day, all null below `min`. */
export interface GroupDailyHours {
  readonly day: DayKey
  readonly n: number
  readonly hoursWorked: number | null
  readonly lateMinutes: number | null
  readonly earlyMinutes: number | null
}

/** Per day, the average hours worked, late minutes and early-leave minutes over the trainees who have a complete day; null (hidden) when fewer than `min` do. */
export function groupDailyHours(perTrainee: readonly (readonly DailyHours[])[], days: readonly DayKey[], min = MIN_ATTENDANCE_GROUP): GroupDailyHours[] {
  return days.map((day) => {
    const complete: DailyHours[] = []
    for (const list of perTrainee) {
      const entry = list.find((d) => d.day === day)
      if (entry && entry.hoursWorked !== null) complete.push(entry)
    }
    const n = complete.length
    if (n < min) return { day, n, hoursWorked: null, lateMinutes: null, earlyMinutes: null }
    const mean = (pick: (d: DailyHours) => number | null, places: number) => round(complete.reduce((total, d) => total + (pick(d) ?? 0), 0) / n, places)
    return { day, n, hoursWorked: mean((d) => d.hoursWorked, 2), lateMinutes: mean((d) => d.lateMinutes, 1), earlyMinutes: mean((d) => d.earlyMinutes, 1) }
  })
}

// ── Weeks: Monday to Sunday, on Karachi calendar days ───────────────────────
//
// A DayKey is already a Karachi calendar day (a record's workDate), so weeks
// are built from day keys only: a check-in at 00:10 on a Monday in Karachi
// (19:10 UTC on the Sunday) belongs to the Monday's week, because its record
// day is that Monday.

/** One Monday-to-Sunday week: its first and last day and all seven days. */
export interface Week {
  readonly weekStart: DayKey
  readonly weekEnd: DayKey
  readonly days: readonly DayKey[]
}

const addDays = (day: DayKey, n: number): DayKey => new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)

/** The Monday of the week `day` is in (Monday itself for a Monday; the Monday before for a Sunday). */
export function weekStartOf(day: DayKey): DayKey {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay() // 0 = Sunday
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(weekday)) throw new RangeError(`Not a calendar day: ${day}`)
  return addDays(day, -((weekday + 6) % 7))
}

/** The Monday-to-Sunday weeks that touch `month` ("YYYY-MM"), oldest first, each a full seven days (so the first and last may reach into the next or previous month); null for a malformed month. */
export function weeksCovering(month: string): Week[] | null {
  const match = MONTH_PATTERN.exec(month)
  if (!match) return null
  const first = `${month}-01`
  const last = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).toISOString().slice(0, 10)
  const weeks: Week[] = []
  for (let start = weekStartOf(first); start <= last; start = addDays(start, 7)) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
    weeks.push({ weekStart: start, weekEnd: days[6], days })
  }
  return weeks
}

/** One week's totals for one trainee. */
export interface WeekHours {
  readonly weekStart: DayKey
  readonly weekEnd: DayKey
  readonly summary: HoursSummary
}

/** Each week's totals from the live records, with the same rules as a month (monthlyHoursSummary over the week's seven days). */
export function weeklyHours(records: readonly AttendanceRecordLike[], weeks: readonly Week[], scheduleOn: (day: DayKey) => AttendanceWindow): WeekHours[] {
  return weeks.map((week) => ({ weekStart: week.weekStart, weekEnd: week.weekEnd, summary: monthlyHoursSummary(records, week.days, scheduleOn) }))
}

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/

/** `count` months ending with `month` ("YYYY-MM"), oldest first; null for a malformed month or count. */
export function monthsEnding(month: string, count: number): string[] | null {
  const match = MONTH_PATTERN.exec(month)
  if (!match || !Number.isInteger(count) || count < 1) return null
  const year = Number(match[1])
  const index = Number(match[2]) - 1
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(Date.UTC(year, index - (count - 1 - i), 1))
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
  })
}

// ── The three ranges of the late / early chart ──────────────────────────────
//
// One chart, three ranges, all from the helpers above:
//  - Monthly: the HOURS_CHART_MONTHS months ending with the chosen month;
//  - Weekly:  the Monday-to-Sunday weeks touching the chosen month (Karachi
//             days, so the edge weeks reach into the neighbouring months);
//  - Daily:   each day of the chosen month.

/** One month's totals. */
export interface MonthHours {
  readonly month: string
  readonly summary: HoursSummary
}

/** One trainee's three ranges. */
export interface HoursRanges {
  readonly months: MonthHours[]
  readonly weeks: WeekHours[]
  readonly days: DailyHours[]
}

/** The program's three ranges: averages over trainees, hidden below MIN_ATTENDANCE_GROUP. */
export interface GroupRanges {
  readonly months: { readonly month: string; readonly group: HoursGroup }[]
  readonly weeks: { readonly weekStart: DayKey; readonly weekEnd: DayKey; readonly group: HoursGroup }[]
  readonly days: GroupDailyHours[]
}

/** Every day the three ranges of `month` read, sorted: the months of the Monthly range and the days of the edge weeks. Null for a malformed month. */
export function rangeDays(month: string): DayKey[] | null {
  const months = monthsEnding(month, HOURS_CHART_MONTHS)
  const weeks = weeksCovering(month)
  if (!months || !weeks) return null
  const days = new Set<DayKey>()
  for (const m of months) for (const day of daysOfMonth(m) ?? []) days.add(day)
  for (const week of weeks) for (const day of week.days) days.add(day)
  return [...days].sort()
}

/** One trainee's Monthly, Weekly and Daily ranges for `month`, from their live records. Null for a malformed month. */
export function hoursRanges(records: readonly AttendanceRecordLike[], month: string, scheduleOn: (day: DayKey) => AttendanceWindow): HoursRanges | null {
  const months = monthsEnding(month, HOURS_CHART_MONTHS)
  const weeks = weeksCovering(month)
  const days = daysOfMonth(month)
  if (!months || !weeks || !days) return null
  return {
    months: months.map((m) => ({ month: m, summary: monthlyHoursSummary(records, daysOfMonth(m) ?? [], scheduleOn) })),
    weeks: weeklyHours(records, weeks, scheduleOn),
    days: dailyHours(records, days, scheduleOn),
  }
}

/** The program's ranges from every trainee's ranges for the same `month`: per bucket, the averages over trainees with a complete day, hidden below `min`. */
export function groupRanges(perTrainee: readonly HoursRanges[], month: string, min = MIN_ATTENDANCE_GROUP): GroupRanges | null {
  const months = monthsEnding(month, HOURS_CHART_MONTHS)
  const weeks = weeksCovering(month)
  const days = daysOfMonth(month)
  if (!months || !weeks || !days) return null
  return {
    months: months.map((m, i) => ({ month: m, group: groupHours(perTrainee.map((t) => t.months[i].summary), min) })),
    weeks: weeks.map((w, i) => ({ weekStart: w.weekStart, weekEnd: w.weekEnd, group: groupHours(perTrainee.map((t) => t.weeks[i].summary), min) })),
    days: groupDailyHours(
      perTrainee.map((t) => t.days),
      days,
      min,
    ),
  }
}

// ── Late arrival and extra time ─────────────────────────────────────────────
//
// A second pair of measures, for the late / extra-time bar chart. Each stands
// alone, unlike the late / early figures above (which need a complete day):
//  - Late minutes  = max(0, check-in − window start): every live day WITH a
//    check-in counts, with or without a check-out;
//  - Extra minutes = max(0, check-out − window end): every live day WITH a
//    check-out counts.
// A day without a check-in has no late figure (null), a day without a
// check-out no extra figure. Whole minutes, rounded down. Voided records are
// ignored.

/** Minutes after the window's end that `checkOutAt` came on `day`; 0 when at or before the end. Null with no check-out or an unusable window. */
export function extraMinutes(day: DayKey, checkOutAt: Date | null, window: AttendanceWindow): number | null {
  if (checkOutAt === null || !isValidWindow(window)) return null
  return Math.max(0, Math.floor((checkOutAt.getTime() - karachiInstant(day, window.endTime).getTime()) / MINUTE_MS))
}

/** One day's late and extra minutes; each null when the day has no live record with that time. */
export interface DailyLateExtra {
  readonly day: DayKey
  readonly lateMinutes: number | null
  readonly extraMinutes: number | null
}

/** Each of `days` with the late and extra minutes of its live record, under the window in force that day. */
export function dailyLateExtra(records: readonly AttendanceRecordLike[], days: readonly DayKey[], scheduleOn: (day: DayKey) => AttendanceWindow): DailyLateExtra[] {
  const byDay = new Map<DayKey, AttendanceRecordLike>()
  for (const record of records) {
    const day = dayKeyOf(record.workDate)
    if (isLive(record) && !byDay.has(day)) byDay.set(day, record)
  }
  return days.map((day) => {
    const record = byDay.get(day)
    if (!record) return { day, lateMinutes: null, extraMinutes: null }
    const window = scheduleOn(day)
    return { day, lateMinutes: lateMinutes(day, record.checkInAt, window), extraMinutes: extraMinutes(day, record.checkOutAt, window) }
  })
}

/** A bucket's (week's or month's) totals for one trainee, with the number of days each measure counted. */
export interface LateExtraTotals {
  readonly lateDays: number
  readonly lateMinutes: number
  readonly extraDays: number
  readonly extraMinutes: number
}

/** The sums of the days' late and extra minutes, each over the days that have that figure. */
export function lateExtraTotals(daily: readonly DailyLateExtra[]): LateExtraTotals {
  let lateDays = 0
  let late = 0
  let extraDays = 0
  let extra = 0
  for (const d of daily) {
    if (d.lateMinutes !== null) {
      lateDays++
      late += d.lateMinutes
    }
    if (d.extraMinutes !== null) {
      extraDays++
      extra += d.extraMinutes
    }
  }
  return { lateDays, lateMinutes: late, extraDays, extraMinutes: extra }
}

/** One trainee's Monthly, Weekly and Daily late / extra figures. */
export interface LateExtraRanges {
  readonly months: { readonly month: string; readonly totals: LateExtraTotals }[]
  readonly weeks: { readonly weekStart: DayKey; readonly weekEnd: DayKey; readonly totals: LateExtraTotals }[]
  readonly days: DailyLateExtra[]
}

/** One trainee's three late / extra ranges for `month` (the same buckets as hoursRanges). Null for a malformed month. */
export function lateExtraRanges(records: readonly AttendanceRecordLike[], month: string, scheduleOn: (day: DayKey) => AttendanceWindow): LateExtraRanges | null {
  const months = monthsEnding(month, HOURS_CHART_MONTHS)
  const weeks = weeksCovering(month)
  const days = daysOfMonth(month)
  if (!months || !weeks || !days) return null
  return {
    months: months.map((m) => ({ month: m, totals: lateExtraTotals(dailyLateExtra(records, daysOfMonth(m) ?? [], scheduleOn)) })),
    weeks: weeks.map((w) => ({ weekStart: w.weekStart, weekEnd: w.weekEnd, totals: lateExtraTotals(dailyLateExtra(records, w.days, scheduleOn)) })),
    days: dailyLateExtra(records, days, scheduleOn),
  }
}

/** A group's average for one measure in one bucket, over the `n` trainees measured in it; null (hidden) when n is under the minimum. */
export interface GroupMeasure {
  readonly n: number
  readonly value: number | null
}

/** A group's late and extra averages for one bucket. Each measure is hidden on its own below the minimum. */
export interface GroupLateExtra {
  readonly late: GroupMeasure
  readonly extra: GroupMeasure
}

function groupMeasure(values: readonly number[], min: number): GroupMeasure {
  const n = values.length
  return { n, value: n < min ? null : round(values.reduce((total, v) => total + v, 0) / n, 1) }
}

/** A week or month: the average trainee's total, over the trainees with at least one day of that measure in it. */
export function groupLateExtraTotals(totals: readonly LateExtraTotals[], min = MIN_ATTENDANCE_GROUP): GroupLateExtra {
  return {
    late: groupMeasure(totals.filter((t) => t.lateDays > 0).map((t) => t.lateMinutes), min),
    extra: groupMeasure(totals.filter((t) => t.extraDays > 0).map((t) => t.extraMinutes), min),
  }
}

/** A day: the average minutes over the trainees with that figure on the day. */
export function groupLateExtraDay(entries: readonly DailyLateExtra[], min = MIN_ATTENDANCE_GROUP): GroupLateExtra {
  const present = (pick: (d: DailyLateExtra) => number | null) => entries.map(pick).filter((v): v is number => v !== null)
  return { late: groupMeasure(present((d) => d.lateMinutes), min), extra: groupMeasure(present((d) => d.extraMinutes), min) }
}

/** A group's three late / extra ranges: averages over trainees, each measure of each bucket hidden below MIN_ATTENDANCE_GROUP. */
export interface GroupLateExtraRanges {
  readonly months: { readonly month: string; readonly group: GroupLateExtra }[]
  readonly weeks: { readonly weekStart: DayKey; readonly weekEnd: DayKey; readonly group: GroupLateExtra }[]
  readonly days: { readonly day: DayKey; readonly group: GroupLateExtra }[]
}

/** The group's ranges from each trainee's late / extra ranges for the same `month`. Null for a malformed month. */
export function groupLateExtraRanges(perTrainee: readonly LateExtraRanges[], month: string, min = MIN_ATTENDANCE_GROUP): GroupLateExtraRanges | null {
  const months = monthsEnding(month, HOURS_CHART_MONTHS)
  const weeks = weeksCovering(month)
  const days = daysOfMonth(month)
  if (!months || !weeks || !days) return null
  return {
    months: months.map((m, i) => ({ month: m, group: groupLateExtraTotals(perTrainee.map((t) => t.months[i].totals), min) })),
    weeks: weeks.map((w, i) => ({ weekStart: w.weekStart, weekEnd: w.weekEnd, group: groupLateExtraTotals(perTrainee.map((t) => t.weeks[i].totals), min) })),
    days: days.map((day, i) => ({ day, group: groupLateExtraDay(perTrainee.map((t) => t.days[i]), min) })),
  }
}
