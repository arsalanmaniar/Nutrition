// Shared set-up for the attendance tests, Step A4 (not itself a test file).
// Like actors.ts, it works on the in-memory Prisma fake; the real guard runs.

import type { AttendanceStatus } from '@prisma/client'
import { fakePrisma } from './fake-prisma'

type Row = Record<string, unknown>

/** 10:00 in Karachi on Tuesday 3 November 2026 (Karachi is UTC+5). */
export const NOW = new Date('2026-11-03T05:00:00Z')
export const TODAY = '2026-11-03'

/** A Karachi wall-clock time on a day, as an instant (UTC+5). */
export const karachi = (day: string, time: string) => new Date(new Date(`${day}T${time}:00Z`).getTime() - 5 * 3600 * 1000)

export const records = () => fakePrisma.tables.nutritionAttendanceRecord as Row[]
export const schedules = () => fakePrisma.tables.nutritionAttendanceSchedule as Row[]
export const holidays = () => fakePrisma.tables.nutritionAttendanceHoliday as Row[]
export const audit = () => fakePrisma.tables.nutritionAuditLog as Row[]

export function seedRecord(
  traineeId: string,
  day: string,
  fields: Partial<{ checkIn: string | null; checkOut: string | null; status: AttendanceStatus; voided: boolean }> = {},
): Row {
  const checkIn = fields.checkIn === undefined ? '09:00' : fields.checkIn
  return fakePrisma.seed('nutritionAttendanceRecord', {
    traineeId,
    workDate: new Date(`${day}T00:00:00Z`),
    checkInAt: checkIn ? karachi(day, checkIn) : null,
    checkOutAt: fields.checkOut ? karachi(day, fields.checkOut) : null,
    status: fields.status ?? 'PRESENT',
    ...(fields.voided ? { voidedAt: karachi(day, '18:00'), voidedById: 'auth-boss', voidReason: 'Entered by mistake.' } : {}),
    createdBy: 'auth-seed',
  })
}

export function seedSchedule(
  scopeProfileId: string | null,
  fields: Partial<{ weekdays: number[]; startTime: string; endTime: string; effectiveFrom: string }> = {},
): Row {
  return fakePrisma.seed('nutritionAttendanceSchedule', {
    scopeProfileId,
    weekdays: fields.weekdays ?? [1, 2, 3, 4, 5],
    startTime: fields.startTime ?? '08:00',
    endTime: fields.endTime ?? '17:00',
    effectiveFrom: new Date(`${fields.effectiveFrom ?? '2026-01-01'}T00:00:00Z`),
    createdBy: 'auth-seed',
  })
}

export function seedHoliday(scopeProfileId: string | null, day: string, name = 'Holiday', voided = false): Row {
  return fakePrisma.seed('nutritionAttendanceHoliday', {
    scopeProfileId,
    workDate: new Date(`${day}T00:00:00Z`),
    name,
    ...(voided ? { voidedAt: new Date('2026-10-01T00:00:00Z'), voidedById: 'auth-boss', voidReason: 'Set by mistake.' } : {}),
    createdBy: 'auth-seed',
  })
}
