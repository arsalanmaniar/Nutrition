// Assessment points: the period an evaluation form covers, counted from the
// trainee's training start date, never from the calendar (plan, Decisions
// (Step 2 outcome) item 1). "W01"–"W53" for weekly check-ins, "M01"–"M12" for
// the monthly and Month 4/8/12 forms. The database CHECK
// nutr_evaluation_form_period_format_check holds stored rows to the same
// format. Everything here is pure: the caller passes every date in.
//
// The rule, on calendar days in Karachi time:
//  - Day 0 is NutritionProfile.trainingStartDate.
//  - Training week n is days 7(n-1) to 7n-1: week 1 is days 0-6, and week 2
//    starts on day 7.
//  - Training month n starts on the start date's day of the month, n-1
//    calendar months later. When that month is too short for that day, it
//    starts on the month's last day instead: from 31 January, month 2 starts on
//    28 February (the 29th in a leap year) and month 3 on 31 March. Every start
//    is counted from the start date itself, so a short month never shifts the
//    later ones.
//  - Training ends when month 13 would start (the same rule, 12 months on).
//    Before day 0, and from that day on, there is no training week or month:
//    null. A training year is 365 or 366 days, so week 53 is its last one or
//    two days.

export type PeriodKind = 'WEEK' | 'MONTH'

/** A training week (1–53) or a training month (1–12). */
export interface TrainingPeriod {
  readonly kind: PeriodKind
  readonly number: number
}

export const LAST_TRAINING_WEEK = 53
export const LAST_TRAINING_MONTH = 12

const LAST: Readonly<Record<PeriodKind, number>> = { WEEK: LAST_TRAINING_WEEK, MONTH: LAST_TRAINING_MONTH }
const PREFIX: Readonly<Record<PeriodKind, string>> = { WEEK: 'W', MONTH: 'M' }

function checkPeriod(kind: PeriodKind, number: number): void {
  if (!Number.isInteger(number) || number < 1 || number > LAST[kind]) {
    throw new RangeError(`There is no training ${kind.toLowerCase()} ${number} (1-${LAST[kind]}).`)
  }
}

/**
 * The one builder of assessment points, from TRAINING-relative numbers:
 * training week 7 is "W07", training month 4 is "M04". Throws outside weeks
 * 1–53 and months 1–12.
 */
export function assessmentPoint(kind: PeriodKind, number: number): string {
  checkPeriod(kind, number)
  return `${PREFIX[kind]}${String(number).padStart(2, '0')}`
}

/** The inverse of assessmentPoint: "W07" is week 7. Anything it would not build, such as "W7", "w07" or "M13", is null. */
export function parseAssessmentPoint(point: string): TrainingPeriod | null {
  const match = /^([WM])(\d\d)$/.exec(point)
  if (!match) return null
  const kind: PeriodKind = match[1] === 'W' ? 'WEEK' : 'MONTH'
  const number = Number(match[2])
  return number >= 1 && number <= LAST[kind] ? { kind, number } : null
}

// ── Calendar days ────────────────────────────────────────────────────────────

/** A calendar day, "YYYY-MM-DD". */
export type CalendarDay = string

const DAY_MS = 86400000

/** The Karachi calendar day an instant falls on: the program runs on Karachi time. */
export function karachiDay(instant: Date): CalendarDay {
  return instant.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
}

/** A @db.Date value as Prisma returns it (midnight UTC), as its calendar day. */
export function storedDay(date: Date): CalendarDay {
  return date.toISOString().slice(0, 10)
}

/** Days since 1970-01-01. Throws unless `day` is a real "YYYY-MM-DD" date. */
function dayNumber(day: CalendarDay): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  const time = match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : NaN
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== day) {
    throw new RangeError(`Not a calendar day: ${JSON.stringify(day)}`)
  }
  return time / DAY_MS
}

const calendarDay = (number: number): CalendarDay => new Date(number * DAY_MS).toISOString().slice(0, 10)

/** The day number on which training month n starts; n = 13 is the day training ends. */
function monthStart(startDate: CalendarDay, n: number): number {
  const start = new Date(dayNumber(startDate) * DAY_MS)
  const year = start.getUTCFullYear()
  const month = start.getUTCMonth() + n - 1
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return Date.UTC(year, month, Math.min(start.getUTCDate(), daysInMonth)) / DAY_MS
}

/** Where a day falls in the training year. */
export interface TrainingPosition {
  /** Days since the start date: 0 on the start date itself. */
  readonly day: number
  readonly week: number
  readonly month: number
}

/** The training day, week and month of `today`; null before the start date and once month 12 is over. */
export function trainingPosition(startDate: CalendarDay, today: CalendarDay): TrainingPosition | null {
  const start = dayNumber(startDate)
  const now = dayNumber(today)
  if (now < start || now >= monthStart(startDate, LAST_TRAINING_MONTH + 1)) return null
  let month = 1
  while (month < LAST_TRAINING_MONTH && monthStart(startDate, month + 1) <= now) month++
  return { day: now - start, week: Math.floor((now - start) / 7) + 1, month }
}

/** The first and last day of a training week or month. Week 53 ends with training, after one or two days. */
export function periodDays(startDate: CalendarDay, period: TrainingPeriod): { first: CalendarDay; last: CalendarDay } {
  checkPeriod(period.kind, period.number)
  if (period.kind === 'MONTH') {
    return {
      first: calendarDay(monthStart(startDate, period.number)),
      last: calendarDay(monthStart(startDate, period.number + 1) - 1),
    }
  }
  const first = dayNumber(startDate) + 7 * (period.number - 1)
  const trainingEnd = monthStart(startDate, LAST_TRAINING_MONTH + 1)
  return { first: calendarDay(first), last: calendarDay(Math.min(first + 6, trainingEnd - 1)) }
}
