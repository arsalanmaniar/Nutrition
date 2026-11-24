// Trainee attendance settings (Attendance module, Step A). Pure data, safe in
// client and server code.
//
// Rules (CDN-EP-PLAN.md, attendance decisions):
//  - Every day and time rule runs on ATTENDANCE_TIMEZONE, never the server's
//    or the browser's clock zone.
//  - Only a TRAINEE records attendance, for themselves: a check-in and a
//    check-out each working day.
//  - Holidays follow the UNION rule: the program's holidays (set by ADMIN) AND
//    the holidays of the trainee's active primary preceptor both apply. A
//    preceptor's holidays never replace the program's.
//  - The working window and working days come from the primary preceptor's
//    schedule when one exists; otherwise from the program default schedule
//    (set by ADMIN). The values below apply only when neither exists.
//
// TODO (STOP AND ASK before adding): rotation and hospital fields on attendance
// records are NOT part of Step A. Do not add them to this file, the schema or
// the server code without the user's explicit go-ahead.

/** The IANA zone every attendance day and time is computed in. */
export const ATTENDANCE_TIMEZONE = 'Asia/Karachi'

/** "HH:MM", 24-hour, zero-padded: 00:00 to 23:59. */
export const HH_MM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Days of the week as JavaScript numbers them (Date#getUTCDay on a calendar
 * day): 0 = Sunday, 1 = Monday, … 6 = Saturday. The schedule table's
 * `weekdays` column uses the same numbers.
 */
export const WEEKDAY_LABELS: readonly string[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * The program's working hours, 08:00 to 16:00 Karachi: the window used when
 * neither the preceptor nor the admin has set one. Start included, end
 * excluded (see isWithinWindow in server/attendance-core.ts).
 */
export const DEFAULT_ATTENDANCE_WINDOW = { startTime: '08:00', endTime: '16:00' } as const

/**
 * DEFAULT, to be replaced by the program's real values: Saturday and Sunday
 * are not working days unless a schedule says otherwise.
 */
export const DEFAULT_WEEKEND_DAYS: readonly number[] = [0, 6]

/** The working days implied by DEFAULT_WEEKEND_DAYS: Monday to Friday. */
export const DEFAULT_WORKING_WEEKDAYS: readonly number[] = [0, 1, 2, 3, 4, 5, 6].filter((day) => !DEFAULT_WEEKEND_DAYS.includes(day))

/** Attendance graphs and group percentages hide any group with fewer trainees than this. */
export const MIN_ATTENDANCE_GROUP = 3
