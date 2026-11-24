import { AttendanceStatus } from '@prisma/client'
import { z } from 'zod'
import { HH_MM_PATTERN } from '@/features/nutrition/config/attendance'
import { findPatientIdentifier } from './privacy'

// Input rules for the attendance actions (Attendance Step A4). Only these
// fields are read: a client-sent traineeId, scope id, author, day or time the
// server sets is dropped. Day-dependent rules (a real calendar day, not in
// the past, start before end) are the action's checks, so the refusal can
// name the field.

const id = z.uuid({ error: 'Invalid id.' })
const time = (label: string) => z.string({ error: `Enter the ${label} as HH:MM.` }).trim().regex(HH_MM_PATTERN, `Enter the ${label} as HH:MM (24-hour).`)
const day = z.string({ error: 'Enter a date.' }).trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date as YYYY-MM-DD.')

function noPatientIdentifiers(value: string, ctx: z.RefinementCtx) {
  const identifier = findPatientIdentifier(value)
  if (identifier) ctx.addIssue({ code: 'custom', message: identifier.message })
}

/** PROGRAM: the program default (ADMIN). MINE: the caller's own trainees (PRECEPTOR). */
export const attendanceScopeSchema = z.enum(['PROGRAM', 'MINE'], { error: 'Choose program default or your own trainees.' })

export const attendanceScheduleSchema = z.object({
  scope: attendanceScopeSchema,
  // Comma-separated day numbers, 0 = Sunday … 6 = Saturday, e.g. "1,2,3,4,5".
  weekdays: z
    .string({ error: 'Pick at least one working day.' })
    .trim()
    .regex(/^[0-6](,[0-6])*$/, 'Pick at least one working day.')
    .transform((value) => [...new Set(value.split(',').map(Number))].sort((a, b) => a - b)),
  startTime: time('start time'),
  endTime: time('end time'),
  effectiveFrom: day,
})

export const attendanceHolidaySchema = z.object({
  scope: attendanceScopeSchema,
  workDate: day,
  name: z
    .string({ error: 'Name the holiday.' })
    .trim()
    .min(1, 'Name the holiday.')
    .max(100, 'Keep the name under 100 characters.')
    .superRefine(noPatientIdentifiers),
})

export const attendanceEditSchema = z.object({
  recordId: id,
  checkInTime: time('check-in time'),
  // Empty = no check-out.
  checkOutTime: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || null)
    .refine((value) => value === null || HH_MM_PATTERN.test(value), 'Enter the check-out time as HH:MM (24-hour).'),
  status: z.enum(AttendanceStatus, { error: 'Pick a status.' }),
})

export const attendanceVoidSchema = z.object({
  recordId: id,
  reason: z
    .string({ error: 'Give a reason.' })
    .trim()
    .min(1, 'Give a reason.')
    .max(500, 'Keep the reason under 500 characters.')
    .superRefine(noPatientIdentifiers),
})

const reason = z
  .string({ error: 'Give a reason.' })
  .trim()
  .min(1, 'Give a reason.')
  .max(500, 'Keep the reason under 500 characters.')
  .superRefine(noPatientIdentifiers)

/** An editor creates a record for a day the trainee did not record. */
export const attendanceMissedDaySchema = z.object({
  traineeId: id,
  workDate: day,
  checkInTime: time('check-in time'),
  // Empty = no check-out.
  checkOutTime: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || null)
    .refine((value) => value === null || HH_MM_PATTERN.test(value), 'Enter the check-out time as HH:MM (24-hour).'),
  reason,
})

export const attendanceHolidayVoidSchema = z.object({
  holidayId: id,
  reason,
})

/** "YYYY-MM", for the loaders' month argument. */
export const attendanceMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
