import 'server-only'
import type { Prisma } from '@prisma/client'
import { effectiveSchedule, workDateOf, type AttendanceWindow, type DayKey, type ScheduleRow } from './attendance-core'

// Loads the schedules and holidays that decide a trainee's attendance days
// (Attendance Step A4). Shared by the attendance actions and loaders, so the
// rules are applied the same way everywhere:
//  - WINDOW: the trainee's active primary preceptor's schedule when one is in
//    force on the day; otherwise the program default (scope NULL); otherwise
//    the config default (effectiveSchedule in attendance-core.ts).
//  - HOLIDAYS: the UNION of the program's holidays and the primary
//    preceptor's holidays (CDN-EP-PLAN.md, Decisions (Attendance Step A)
//    item 1). A preceptor's holidays never replace the program's. Voided
//    holidays do not count.
// No role checks here: every caller has already run requireNutritionRole.

type Db = Prisma.TransactionClient

export interface AttendanceRules {
  /** The window and working weekdays in force on `day`. */
  scheduleOn(day: DayKey): AttendanceWindow
  /** The holiday days that apply: program AND preceptor, among the days loaded. */
  readonly holidays: readonly DayKey[]
}

/** Builds the rules for trainees whose active primary preceptor is `preceptorId` (null = none). */
export type RulesFor = (preceptorId: string | null) => AttendanceRules

const SCHEDULE_FIELDS = { scopeProfileId: true, weekdays: true, startTime: true, endTime: true, effectiveFrom: true } as const

/**
 * Loads every schedule and the holidays on `days` for the program and the
 * given preceptors, in two queries, and returns the rules for any of those
 * preceptors (or for a trainee with none).
 */
export async function loadAttendanceRules(db: Db, preceptorIds: readonly (string | null)[], days: readonly DayKey[]): Promise<RulesFor> {
  const ids = [...new Set(preceptorIds.filter((id): id is string => id !== null))]
  const scope = ids.length > 0 ? { OR: [{ scopeProfileId: null }, { scopeProfileId: { in: ids } }] } : { scopeProfileId: null }
  const [schedules, holidays] = await Promise.all([
    db.nutritionAttendanceSchedule.findMany({ where: scope, select: SCHEDULE_FIELDS }),
    days.length === 0
      ? Promise.resolve([])
      : db.nutritionAttendanceHoliday.findMany({
          // Voided holidays are ignored by every check and count.
          where: { AND: [scope, { workDate: { in: days.map(workDateOf) }, voidedAt: null }] },
          select: { scopeProfileId: true, workDate: true },
        }),
  ])

  const program: ScheduleRow[] = schedules.filter((row) => row.scopeProfileId === null)
  const programHolidays = holidays.filter((row) => row.scopeProfileId === null).map((row) => row.workDate.toISOString().slice(0, 10))

  return (preceptorId) => {
    const own: ScheduleRow[] = preceptorId === null ? [] : schedules.filter((row) => row.scopeProfileId === preceptorId)
    const ownHolidays =
      preceptorId === null ? [] : holidays.filter((row) => row.scopeProfileId === preceptorId).map((row) => row.workDate.toISOString().slice(0, 10))
    return {
      scheduleOn: (day) => effectiveSchedule(day, own, program),
      holidays: [...new Set([...programHolidays, ...ownHolidays])],
    }
  }
}
