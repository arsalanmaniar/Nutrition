import type { AttendanceStatus } from '@prisma/client'
import { ATTENDANCE_TIMEZONE, MIN_ATTENDANCE_GROUP, WEEKDAY_LABELS } from '@/features/nutrition/config/attendance'
import type { AttendanceGroup, AttendancePercentage } from '@/features/nutrition/server/attendance-core'
import type { CalendarKind } from '@/features/nutrition/server/queries/attendance'

// Display helpers for the attendance screens (Step 8 UI). Pure data and
// functions, safe in client and server components. They decide nothing: the
// loaders and server actions apply every rule, and their answer is the one
// stored. Types are imported as types only, so no server code reaches the
// browser.

/** Shown wherever a time appears: every time on these screens is Karachi time. */
export const KARACHI_TIME_NOTE = `All times are Karachi time (${ATTENDANCE_TIMEZONE}).`

/** A record's status as the screens show it. The trainee sees "Recorded by staff", never why. */
export const ATTENDANCE_STATUS_LABELS: Readonly<Record<AttendanceStatus, string>> = {
  PRESENT: 'Present',
  OUT_OF_WINDOW_RECORDED_BY_STAFF: 'Recorded by staff',
}

export const CALENDAR_KIND_LABELS: Readonly<Record<CalendarKind, string>> = {
  PRESENT: 'Present',
  STAFF: 'Recorded by staff',
  ABSENT: 'Absent',
  PENDING: 'Today, not recorded yet',
  HOLIDAY: 'Holiday',
  OFF: 'Not a working day',
  FUTURE: 'Upcoming',
  NOT_STARTED: 'Before training started',
  VOIDED: 'Deleted record',
}

/** Strip colours (hex, for the chart). VOIDED is grey, as decided for the preceptor view. */
export const CALENDAR_KIND_COLOURS: Readonly<Record<CalendarKind, string>> = {
  PRESENT: '#16a34a',
  STAFF: '#2563eb',
  ABSENT: '#dc2626',
  PENDING: '#f59e0b',
  HOLIDAY: '#a855f7',
  OFF: '#e5e7eb',
  FUTURE: '#f3f4f6',
  NOT_STARTED: '#f3f4f6',
  VOIDED: '#9ca3af',
}

/** The legend entries a strip needs: only the kinds that occur, in a fixed order. */
export function legendFor(kinds: readonly CalendarKind[]): CalendarKind[] {
  const order = Object.keys(CALENDAR_KIND_LABELS) as CalendarKind[]
  return order.filter((kind) => kinds.includes(kind))
}

const SHORT = WEEKDAY_LABELS.map((label) => label.slice(0, 3))

/** Working weekdays as text: "Mon–Fri" for a run of 3 or more days, otherwise a list ("Mon, Wed, Sat"). */
export function weekdaysText(weekdays: readonly number[]): string {
  const days = [...new Set(weekdays)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b)
  if (days.length === 0) return 'No working days'
  if (days.length === 7) return 'Every day'
  const consecutive = days.every((day, i) => i === 0 || day === days[i - 1] + 1)
  if (consecutive && days.length >= 3) return `${SHORT[days[0]]}–${SHORT[days[days.length - 1]]}`
  return days.map((day) => SHORT[day]).join(', ')
}

/** "08:00 to 17:00" with the end-exclusive rule spelled out. */
export function windowText(window: { startTime: string; endTime: string }): string {
  return `${window.startTime} to ${window.endTime} (check-in closes at ${window.endTime})`
}

/** "12 of 20 working days (60%)", or a note when there are no working days yet. */
export function percentageText(p: AttendancePercentage): string {
  if (p.percent === null) return 'No working days counted yet.'
  return `${p.presentDays} of ${p.workingDays} working day${p.workingDays === 1 ? '' : 's'} (${p.percent}%)`
}

/** A group average as text, or "Not enough data" when the server hid it (fewer than MIN_ATTENDANCE_GROUP trainees). */
export function groupText(group: AttendanceGroup): string {
  return group.hidden ? 'Not enough data' : `${group.percent}% average over ${group.n} trainees`
}

/** Under a hidden group: why it is hidden. */
export function groupNote(group: AttendanceGroup): string | null {
  return group.hidden ? `Shown from ${MIN_ATTENDANCE_GROUP} trainees; this group has ${group.n}.` : null
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/

/** "2026-11" → "November 2026"; anything else is returned unchanged. */
export function monthLabel(month: string): string {
  const match = MONTH.exec(month)
  if (!match) return month
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** The month `delta` months away, "YYYY-MM"; null for a malformed month. */
export function shiftMonth(month: string, delta: number): string | null {
  const match = MONTH.exec(month)
  if (!match) return null
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + delta, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

/** "2026-11-03" → "Tue 3 Nov". */
export function dayLabel(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return day
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/** The weekdays value the schedule action expects: sorted, comma-separated day numbers ("1,2,3,4,5"). */
export function weekdaysValue(selected: readonly number[]): string {
  return [...new Set(selected)].sort((a, b) => a - b).join(',')
}

/** Where the window in force comes from, for the settings pages. */
export const WINDOW_SOURCE_LABELS: Readonly<Record<'MINE' | 'PROGRAM' | 'DEFAULT', string>> = {
  MINE: 'your schedule',
  PROGRAM: 'the program default',
  DEFAULT: 'the built-in default (to be replaced by the program values)',
}
