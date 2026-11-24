import 'server-only'
import { prisma } from '@/lib/prisma'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { attendanceMonthSchema } from '@/features/nutrition/validation/attendance'
import { traineeIdSchema } from '@/features/nutrition/validation/epa'
import { dayKeyOf, daysOfMonth, karachiTime, localDateKarachi, monthOf, workDateOf } from '../attendance-core'
import type { AttendanceDay, HolidayView } from './attendance'

// Read models for the nutrition ADMIN's attendance screens: one trainee's
// records (to edit them or add a missed day) and every preceptor's holidays
// (to remove one). Read only. Each loader checks ['ADMIN'] first; a
// super_admin counts as ADMIN. The edit, missed-day and void actions check the
// caller again. Voided rows, void reasons and staff reasons are never returned.

export interface AdminTraineeRecords {
  month: string
  traineeId: string
  traineeName: string
  /** The month's live records, oldest first, with Karachi times. */
  days: AttendanceDay[]
}

export interface PreceptorHolidays {
  preceptorId: string
  preceptorName: string
  /** Live holidays, oldest first. */
  holidays: HolidayView[]
}

/** One trainee's live records for the month (the current Karachi month when none is given). Null for a non-trainee or a malformed id or month. */
export async function getTraineeRecordsForAdmin(traineeId: string, month?: string): Promise<AdminTraineeRecords | null> {
  await requireNutritionRole(['ADMIN'])
  const parsed = traineeIdSchema.safeParse({ traineeId })
  if (!parsed.success) return null
  const chosen = month ?? monthOf(localDateKarachi(new Date()))
  if (!attendanceMonthSchema.safeParse(chosen).success) return null
  const days = daysOfMonth(chosen)
  if (!days) return null
  const trainee = await prisma.nutritionProfile.findUnique({ where: { id: parsed.data.traineeId }, select: { role: true, fullName: true } })
  if (trainee?.role !== 'TRAINEE') return null
  const rows = await prisma.nutritionAttendanceRecord.findMany({
    where: { traineeId: parsed.data.traineeId, workDate: { in: days.map(workDateOf) }, voidedAt: null },
    orderBy: [{ workDate: 'asc' }],
    select: { id: true, workDate: true, checkInAt: true, checkOutAt: true, status: true },
  })
  return {
    month: chosen,
    traineeId: parsed.data.traineeId,
    traineeName: trainee.fullName,
    days: rows.map((row) => ({
      id: row.id,
      workDate: dayKeyOf(row.workDate),
      checkIn: row.checkInAt ? karachiTime(row.checkInAt) : null,
      checkOut: row.checkOutAt ? karachiTime(row.checkOutAt) : null,
      status: row.status,
    })),
  }
}

/** Every preceptor's live holidays, grouped by preceptor (by name). The program's own holidays are not included. */
export async function listPreceptorAttendanceHolidays(): Promise<PreceptorHolidays[]> {
  await requireNutritionRole(['ADMIN'])
  const rows = await prisma.nutritionAttendanceHoliday.findMany({
    where: { scopeProfileId: { not: null }, voidedAt: null },
    orderBy: [{ workDate: 'asc' }],
    select: { id: true, scopeProfileId: true, workDate: true, name: true },
  })
  const ids = [...new Set(rows.map((row) => row.scopeProfileId as string))]
  const people = ids.length === 0 ? [] : await prisma.nutritionProfile.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })
  const nameOf = new Map(people.map((person) => [person.id, person.fullName]))
  return ids
    .map((id) => ({
      preceptorId: id,
      preceptorName: nameOf.get(id) ?? 'Unknown preceptor',
      holidays: rows.filter((row) => row.scopeProfileId === id).map((row) => ({ id: row.id, workDate: dayKeyOf(row.workDate), name: row.name })),
    }))
    .sort((a, b) => a.preceptorName.localeCompare(b.preceptorName))
}
