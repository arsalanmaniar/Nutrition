import { MIN_ATTENDANCE_GROUP } from '@/features/nutrition/config/attendance'
import type {
  GroupLateExtra,
  GroupLateExtraRanges,
  GroupRanges,
  HoursGroup,
  HoursRanges,
  HoursSummary,
  LateExtraRanges,
  LateExtraTotals,
} from '@/features/nutrition/server/attendance-hours-core'
import { dayLabel, monthLabel } from './attendance-display'

// Display helpers for the late / early / hours-worked graphs. Pure data and
// functions, safe in client and server components; types are imported as
// types only. They decide nothing: the loaders computed every figure.

export const LATE_COLOUR = '#dc2626'
export const EARLY_COLOUR = '#f59e0b'
export const HOURS_COLOUR = '#2563eb'
export const EXTRA_COLOUR = '#16a34a'

/** Under a hidden program group. */
export const GROUP_HIDDEN_TEXT = `Shown from ${MIN_ATTENDANCE_GROUP} trainees`

/** "45 min", or "2 h 05 min" from an hour up. Decimals are rounded to the minute. */
export function minutesText(minutes: number): string {
  const whole = Math.round(minutes)
  if (whole < 60) return `${whole} min`
  return `${Math.floor(whole / 60)} h ${String(whole % 60).padStart(2, '0')} min`
}

/** "2026-11" → "Nov 26", for chart axes; anything else is returned unchanged. */
export function shortMonthLabel(month: string): string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month)
  if (!match) return month
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })
}

/** "7.92 h". */
export function hoursText(hours: number): string {
  return `${hours} h`
}

/** A trainee's month as sentences: present days, then the totals and averages over the complete days. */
export function summaryLines(summary: HoursSummary): string[] {
  const present = `${summary.presentDays} present day${summary.presentDays === 1 ? '' : 's'}`
  if (summary.completeDays === 0) return [`${present}; none with both a check-in and a check-out yet.`]
  return [
    `${present}, ${summary.completeDays} with both a check-in and a check-out (only these are measured).`,
    `Late: ${minutesText(summary.lateMinutes)} in total, ${minutesText(summary.averageLateMinutes ?? 0)} per day on average.`,
    `Left early: ${minutesText(summary.earlyMinutes)} in total, ${minutesText(summary.averageEarlyMinutes ?? 0)} per day on average.`,
    `Hours worked: ${hoursText(summary.hoursWorked)} in total, ${hoursText(summary.averageHoursWorked ?? 0)} per day on average.`,
  ]
}

/** The program's month as sentences, or the hidden note. */
export function groupLines(group: HoursGroup): string[] {
  if (group.hidden) return [`${GROUP_HIDDEN_TEXT}; this month has ${group.n}.`]
  return [
    `Averages over ${group.n} trainees with at least one complete day.`,
    `Late: ${minutesText(group.lateMinutes)} per trainee this month.`,
    `Left early: ${minutesText(group.earlyMinutes)} per trainee this month.`,
    `Hours worked: ${hoursText(group.averageHoursWorked)} per day on average.`,
  ]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "28 Sep–4 Oct" for a Monday-to-Sunday week. Fixed month names, so the label does not depend on the runtime's locale data. */
export function weekLabel(weekStart: string, weekEnd: string): string {
  const short = (day: string) => {
    const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(day)
    const month = match ? MONTHS[Number(match[1]) - 1] : undefined
    return match && month ? `${Number(match[2])} ${month}` : day
  }
  return `${short(weekStart)}–${short(weekEnd)}`
}

/** The three ranges of the single late / early chart. */
export type RangeKey = 'DAILY' | 'WEEKLY' | 'MONTHLY'

export const RANGE_KEYS: readonly RangeKey[] = ['DAILY', 'WEEKLY', 'MONTHLY']

export const RANGE_LABELS: Readonly<Record<RangeKey, string>> = { DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly' }

/**
 * One bucket of the chart: a day, a week or a month. late and early are the
 * bucket's minutes (a trainee's total; the program's average per trainee),
 * hours the hours worked per complete day. Null = no complete day in the
 * bucket, or (hidden) a program bucket under MIN_ATTENDANCE_GROUP trainees.
 */
export interface RangeRow {
  key: string
  /** Short, for the axis. */
  label: string
  /** Long, for the tooltip and screen readers. */
  full: string
  late: number | null
  early: number | null
  hours: number | null
  hidden: boolean
}

export type ChartRanges = Readonly<Record<RangeKey, RangeRow[]>>

const measured = (summary: HoursSummary) => summary.completeDays > 0

/** A trainee's three ranges as chart rows. */
export function traineeRangeRows(ranges: HoursRanges): ChartRanges {
  return {
    DAILY: ranges.days.map((d) => ({ key: d.day, label: String(Number(d.day.slice(8))), full: dayLabel(d.day), late: d.lateMinutes, early: d.earlyMinutes, hours: d.hoursWorked, hidden: false })),
    WEEKLY: ranges.weeks.map((w) => ({
      key: w.weekStart,
      label: weekLabel(w.weekStart, w.weekEnd),
      full: `Week of ${weekLabel(w.weekStart, w.weekEnd)}`,
      late: measured(w.summary) ? w.summary.lateMinutes : null,
      early: measured(w.summary) ? w.summary.earlyMinutes : null,
      hours: w.summary.averageHoursWorked,
      hidden: false,
    })),
    MONTHLY: ranges.months.map((m) => ({
      key: m.month,
      label: shortMonthLabel(m.month),
      full: monthLabel(m.month),
      late: measured(m.summary) ? m.summary.lateMinutes : null,
      early: measured(m.summary) ? m.summary.earlyMinutes : null,
      hours: m.summary.averageHoursWorked,
      hidden: false,
    })),
  }
}

const groupValues = (group: HoursGroup) =>
  group.hidden
    ? { late: null, early: null, hours: null, hidden: true }
    : { late: group.lateMinutes, early: group.earlyMinutes, hours: group.averageHoursWorked, hidden: false }

/** The program's three ranges as chart rows: averages only; a bucket under MIN_ATTENDANCE_GROUP trainees is hidden. */
export function programRangeRows(ranges: GroupRanges): ChartRanges {
  return {
    DAILY: ranges.days.map((d) => ({
      key: d.day,
      label: String(Number(d.day.slice(8))),
      full: dayLabel(d.day),
      late: d.lateMinutes,
      early: d.earlyMinutes,
      hours: d.hoursWorked,
      hidden: d.hoursWorked === null,
    })),
    WEEKLY: ranges.weeks.map((w) => ({ key: w.weekStart, label: weekLabel(w.weekStart, w.weekEnd), full: `Week of ${weekLabel(w.weekStart, w.weekEnd)}`, ...groupValues(w.group) })),
    MONTHLY: ranges.months.map((m) => ({ key: m.month, label: shortMonthLabel(m.month), full: monthLabel(m.month), ...groupValues(m.group) })),
  }
}

/** A row in words, for the tooltip's empty case and the screen-reader list. */
export function rangeRowText(row: RangeRow): string {
  if (row.hidden) return `${row.full}: ${GROUP_HIDDEN_TEXT}`
  if (row.late === null || row.early === null) return `${row.full}: no day with both a check-in and a check-out`
  return `${row.full}: late ${minutesText(row.late)}, left early ${minutesText(row.early)}, ${row.hours === null ? 'no hours' : `${hoursText(row.hours)} per day`}`
}

// ── The late / extra-time bar chart ─────────────────────────────────────────

/** "134 min (2 h 14)": the minutes, then the same as hours and minutes (h mm). Decimals are rounded to the minute. */
export function minutesHoursText(minutes: number): string {
  const whole = Math.round(minutes)
  return `${whole} min (${Math.floor(whole / 60)} h ${String(whole % 60).padStart(2, '0')})`
}

/**
 * One bucket of the late / extra chart: a day, a week or a month. late and
 * extra are minutes (a trainee's total; a group's average per trainee). Null
 * = nothing measured, or (lateHidden / extraHidden) a group measure under
 * MIN_ATTENDANCE_GROUP trainees.
 */
export interface LateExtraRow {
  key: string
  /** Short, for the axis. */
  label: string
  /** Long, for the tooltip and screen readers. */
  full: string
  late: number | null
  extra: number | null
  lateHidden: boolean
  extraHidden: boolean
}

export type LateExtraChartRanges = Readonly<Record<RangeKey, LateExtraRow[]>>

const dayParts = (day: string) => ({ key: day, label: String(Number(day.slice(8))), full: dayLabel(day) })
const weekParts = (w: { weekStart: string; weekEnd: string }) => ({ key: w.weekStart, label: weekLabel(w.weekStart, w.weekEnd), full: `Week of ${weekLabel(w.weekStart, w.weekEnd)}` })
const monthParts = (month: string) => ({ key: month, label: shortMonthLabel(month), full: monthLabel(month) })

const totalsValues = (t: LateExtraTotals) => ({
  late: t.lateDays > 0 ? t.lateMinutes : null,
  extra: t.extraDays > 0 ? t.extraMinutes : null,
  lateHidden: false,
  extraHidden: false,
})

const groupLateExtraValues = (g: GroupLateExtra) => ({ late: g.late.value, extra: g.extra.value, lateHidden: g.late.value === null, extraHidden: g.extra.value === null })

/** A trainee's three ranges as chart rows: minutes per day; a week's or month's totals. */
export function traineeLateExtraRows(ranges: LateExtraRanges): LateExtraChartRanges {
  return {
    DAILY: ranges.days.map((d) => ({ ...dayParts(d.day), late: d.lateMinutes, extra: d.extraMinutes, lateHidden: false, extraHidden: false })),
    WEEKLY: ranges.weeks.map((w) => ({ ...weekParts(w), ...totalsValues(w.totals) })),
    MONTHLY: ranges.months.map((m) => ({ ...monthParts(m.month), ...totalsValues(m.totals) })),
  }
}

/** A group's three ranges as chart rows: averages per trainee; each measure under MIN_ATTENDANCE_GROUP trainees hidden. */
export function groupLateExtraRows(ranges: GroupLateExtraRanges): LateExtraChartRanges {
  return {
    DAILY: ranges.days.map((d) => ({ ...dayParts(d.day), ...groupLateExtraValues(d.group) })),
    WEEKLY: ranges.weeks.map((w) => ({ ...weekParts(w), ...groupLateExtraValues(w.group) })),
    MONTHLY: ranges.months.map((m) => ({ ...monthParts(m.month), ...groupLateExtraValues(m.group) })),
  }
}

/** A late / extra row in words, for the screen-reader list. */
export function lateExtraRowText(row: LateExtraRow): string {
  if (row.lateHidden && row.extraHidden) return `${row.full}: ${GROUP_HIDDEN_TEXT}`
  const part = (name: string, value: number | null, hidden: boolean, missing: string) =>
    hidden ? `${name}: ${GROUP_HIDDEN_TEXT}` : value === null ? `${name}: ${missing}` : `${name} ${minutesHoursText(value)}`
  return `${row.full}: ${part('late', row.late, row.lateHidden, 'no check-in')}, ${part('extra time', row.extra, row.extraHidden, 'no check-out')}`
}
