'use server'

import { prisma } from '@/lib/prisma'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { fail, ok, type ActionResult } from '@/features/nutrition/lib/action-result'
import {
  attendanceEditSchema,
  attendanceHolidaySchema,
  attendanceHolidayVoidSchema,
  attendanceMissedDaySchema,
  attendanceScheduleSchema,
  attendanceVoidSchema,
} from '@/features/nutrition/validation/attendance'
import type { NutritionAccess } from '@/features/nutrition/auth/roles'
import { ActionFailure, formFields, invalid, isUniqueViolation } from '../action-helpers'
import {
  attendanceHolidaySnapshot,
  attendanceRecordSnapshot,
  attendanceScheduleSnapshot,
  checkInDecision,
  checkOutDecision,
  dayKeyOf,
  isValidWindow,
  karachiInstant,
  karachiTime,
  localDateKarachi,
  missedDayDecision,
  workDateOf,
} from '../attendance-core'
import { loadAttendanceRules } from '../attendance-rules'
import { writeAudit } from '../audit'
import { activePrimaryPreceptorId } from '../evaluation-forms-core'
import { lockTraineeRow } from '../lock-trainee-row'
import { ownTraineeId } from '../own-trainee'
import { lockPrimaryTrainee } from '../primary-trainee'

// Server actions for trainee attendance (Attendance Step A4). Each one starts
// with requireNutritionRole and an exact role list
// (portal-guard-coverage.test.ts checks it):
//  - checkIn, checkOut: TRAINEE only, for themselves, under the trainee row
//    lock. They take no input: the day is today in Karachi and the time is
//    the server's clock.
//  - setSchedule, setHoliday: a PRECEPTOR for their own active primary
//    trainees (scope MINE), an ADMIN for the program default (scope PROGRAM).
//  - editRecord: any nutrition ADMIN (a super_admin counts as one) for any
//    trainee, or the trainee's ACTIVE primary preceptor; always under the
//    trainee row lock.
//  - voidRecord: any nutrition ADMIN. A void sets voidedAt, voidedById and
//    voidReason (required); the row is never deleted, and voided rows are
//    left out of every count.
//  - createMissedRecord: the same editors as editRecord create a record for a
//    day the trainee did not record, with a required reason (staffReason),
//    status OUT_OF_WINDOW_RECORDED_BY_STAFF. The day rules are the same for
//    every editor (missedDayDecision).
//  - voidHoliday: any nutrition ADMIN (program or preceptor holidays), or a
//    preceptor their own, with a required reason. Same void columns; a voided
//    holiday no longer refuses check-ins or reduces working days.
// Every write is audited in the same transaction with ids, days, times and
// status only: never a holiday name, a void reason or a staff reason.

const RECORD_FIELDS = {
  id: true,
  traineeId: true,
  workDate: true,
  checkInAt: true,
  checkOutAt: true,
  status: true,
  voidedAt: true,
  voidedById: true,
} as const

const SCHEDULE_FIELDS = { id: true, scopeProfileId: true, weekdays: true, startTime: true, endTime: true, effectiveFrom: true } as const
const HOLIDAY_FIELDS = { id: true, scopeProfileId: true, workDate: true, voidedAt: true, voidedById: true } as const

const RECORD_NOT_FOUND = 'This attendance record was not found among the records you may change.'
const RECORD_VOIDED = 'This attendance record has been deleted and can no longer be changed.'
const TRAINEE_NOT_FOUND = 'This trainee was not found among your trainees.'
const HOLIDAY_NOT_FOUND = 'This holiday was not found among the holidays you may change.'
const HOLIDAY_VOIDED = 'This holiday has already been removed.'
const EDIT_NOT_ALLOWED = "Only an admin or the trainee's primary preceptor can edit an attendance record."
const PROGRAM_SCOPE_ADMIN_ONLY = 'Only an admin can set the program default.'
const MINE_SCOPE_PRECEPTOR_ONLY = 'Only a preceptor can set this for their own trainees.'
const SAVED_AT_ONCE = 'Someone else saved this at the same moment. Reload the page and try again.'

function errorResult(error: unknown, uniqueMessage: string): ActionResult {
  if (error instanceof ActionFailure) return fail(error.message, error.fieldErrors)
  if (isUniqueViolation(error)) return fail(uniqueMessage)
  throw error
}

/** A nutrition ADMIN: the ADMIN profile role, or an active super_admin (who is given ADMIN). */
const isNutritionAdmin = (access: NutritionAccess) => access.roles.includes('ADMIN')

/** The scope id for a schedule or holiday write, or the refusal. PROGRAM needs ADMIN; MINE needs a PRECEPTOR profile. */
function scopeFor(access: NutritionAccess, scope: 'PROGRAM' | 'MINE'): { scopeProfileId: string | null } | { refusal: string } {
  if (scope === 'PROGRAM') return access.roles.includes('ADMIN') ? { scopeProfileId: null } : { refusal: PROGRAM_SCOPE_ADMIN_ONLY }
  return access.profile?.role === 'PRECEPTOR' ? { scopeProfileId: access.profile.id } : { refusal: MINE_SCOPE_PRECEPTOR_ONLY }
}

// ── Trainee: check in and check out ──────────────────────────────────────────

/** The trainee checks in for today (Karachi), inside the working window, on a working day that is not a holiday. */
export async function checkIn(): Promise<ActionResult> {
  const access = await requireNutritionRole(['TRAINEE'])
  const traineeId = ownTraineeId(access)
  const now = new Date()
  const today = localDateKarachi(now)

  try {
    await prisma.$transaction(async (tx) => {
      if (!(await lockTraineeRow(tx, traineeId))) throw new ActionFailure('Your trainee profile was not found.')
      const preceptorId = await activePrimaryPreceptorId(tx, traineeId)
      const rules = (await loadAttendanceRules(tx, [preceptorId], [today]))(preceptorId)
      const existing = await tx.nutritionAttendanceRecord.findFirst({
        where: { traineeId, workDate: workDateOf(today), voidedAt: null },
        select: RECORD_FIELDS,
      })
      const decision = checkInDecision(now, rules.scheduleOn(today), rules.holidays, existing)
      if (!decision.allowed) throw new ActionFailure(decision.message)

      const row = await tx.nutritionAttendanceRecord.create({
        data: { traineeId, workDate: workDateOf(decision.workDate), checkInAt: now, status: 'PRESENT', createdBy: access.userId },
        select: RECORD_FIELDS,
      })
      await writeAudit(tx, {
        entity: 'NutritionAttendanceRecord',
        entityId: row.id,
        action: 'check-in',
        actorId: access.userId,
        before: null,
        after: attendanceRecordSnapshot(row),
      })
    })
  } catch (error) {
    return errorResult(error, 'You have already checked in today.')
  }
  return ok(`Checked in at ${karachiTime(now)}.`)
}

/** The trainee checks out of today's record. Not limited to the window. */
export async function checkOut(): Promise<ActionResult> {
  const access = await requireNutritionRole(['TRAINEE'])
  const traineeId = ownTraineeId(access)
  const now = new Date()
  const today = localDateKarachi(now)

  try {
    await prisma.$transaction(async (tx) => {
      if (!(await lockTraineeRow(tx, traineeId))) throw new ActionFailure('Your trainee profile was not found.')
      const record = await tx.nutritionAttendanceRecord.findFirst({
        where: { traineeId, workDate: workDateOf(today), voidedAt: null },
        select: RECORD_FIELDS,
      })
      const decision = checkOutDecision(now, record)
      if (!decision.allowed || !record) throw new ActionFailure(decision.allowed ? 'You have not checked in today.' : decision.message)

      const row = await tx.nutritionAttendanceRecord.update({ where: { id: record.id }, data: { checkOutAt: now }, select: RECORD_FIELDS })
      await writeAudit(tx, {
        entity: 'NutritionAttendanceRecord',
        entityId: row.id,
        action: 'check-out',
        actorId: access.userId,
        before: attendanceRecordSnapshot(record),
        after: attendanceRecordSnapshot(row),
      })
    })
  } catch (error) {
    return errorResult(error, SAVED_AT_ONCE)
  }
  return ok(`Checked out at ${karachiTime(now)}.`)
}

// ── Preceptor / admin: working window and holidays ───────────────────────────

/**
 * Sets the working days and window from `effectiveFrom`. Scope MINE: the
 * calling preceptor's own trainees, from today or later, so days already
 * judged keep their schedule. PROGRAM: the program default (ADMIN only), which
 * may also start in the past, so an admin can correct how earlier attendance
 * is measured; the audit row records it like any other save. A second save
 * for the same scope and first day replaces that row's values.
 */
export async function setSchedule(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['PRECEPTOR', 'ADMIN'])
  const parsed = attendanceScheduleSchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)
  const input = parsed.data
  const scope = scopeFor(access, input.scope)
  if ('refusal' in scope) return fail(scope.refusal, { scope: scope.refusal })
  if (!isValidWindow(input)) return fail('The start time must be before the end time.', { endTime: 'The start time must be before the end time.' })
  let effectiveFrom: Date
  try {
    effectiveFrom = workDateOf(input.effectiveFrom)
  } catch {
    return fail('Enter a real date.', { effectiveFrom: 'Enter a real date.' })
  }
  if (input.scope === 'MINE' && input.effectiveFrom < localDateKarachi(new Date())) {
    return fail('A schedule can start today or later, not in the past.', { effectiveFrom: 'Pick today or a later date.' })
  }

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.nutritionAttendanceSchedule.findFirst({
        where: { scopeProfileId: scope.scopeProfileId, effectiveFrom },
        select: SCHEDULE_FIELDS,
      })
      const values = { weekdays: input.weekdays, startTime: input.startTime, endTime: input.endTime }
      const row = existing
        ? await tx.nutritionAttendanceSchedule.update({ where: { id: existing.id }, data: values, select: SCHEDULE_FIELDS })
        : await tx.nutritionAttendanceSchedule.create({
            data: { ...values, scopeProfileId: scope.scopeProfileId, effectiveFrom, createdBy: access.userId },
            select: SCHEDULE_FIELDS,
          })
      await writeAudit(tx, {
        entity: 'NutritionAttendanceSchedule',
        entityId: row.id,
        action: existing ? 'update' : 'create',
        actorId: access.userId,
        before: existing ? attendanceScheduleSnapshot(existing) : null,
        after: attendanceScheduleSnapshot(row),
      })
    })
  } catch (error) {
    return errorResult(error, SAVED_AT_ONCE)
  }
  return ok(`Working hours ${input.startTime} to ${input.endTime} saved from ${input.effectiveFrom}.`)
}

/**
 * Marks a day as a holiday. Scope MINE: for the calling preceptor's own
 * trainees, ON TOP OF the program's holidays; PROGRAM: for every trainee. A
 * second save for the same scope and day renames it.
 */
export async function setHoliday(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['PRECEPTOR', 'ADMIN'])
  const parsed = attendanceHolidaySchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)
  const input = parsed.data
  const scope = scopeFor(access, input.scope)
  if ('refusal' in scope) return fail(scope.refusal, { scope: scope.refusal })
  let workDate: Date
  try {
    workDate = workDateOf(input.workDate)
  } catch {
    return fail('Enter a real date.', { workDate: 'Enter a real date.' })
  }

  try {
    await prisma.$transaction(async (tx) => {
      // A voided holiday stays as history; setting the day again adds a new row.
      const existing = await tx.nutritionAttendanceHoliday.findFirst({
        where: { scopeProfileId: scope.scopeProfileId, workDate, voidedAt: null },
        select: HOLIDAY_FIELDS,
      })
      const row = existing
        ? await tx.nutritionAttendanceHoliday.update({ where: { id: existing.id }, data: { name: input.name }, select: HOLIDAY_FIELDS })
        : await tx.nutritionAttendanceHoliday.create({
            data: { scopeProfileId: scope.scopeProfileId, workDate, name: input.name, createdBy: access.userId },
            select: HOLIDAY_FIELDS,
          })
      await writeAudit(tx, {
        entity: 'NutritionAttendanceHoliday',
        entityId: row.id,
        action: existing ? 'update' : 'create',
        actorId: access.userId,
        before: existing ? attendanceHolidaySnapshot(existing) : null,
        after: attendanceHolidaySnapshot(row),
      })
    })
  } catch (error) {
    return errorResult(error, SAVED_AT_ONCE)
  }
  return ok(`Holiday saved for ${input.workDate}.`)
}

// ── Editors: edit and void ───────────────────────────────────────────────────

/**
 * Changes a record's check-in and check-out times (Karachi, on the record's
 * own day) and its status. A nutrition ADMIN may edit any live record;
 * otherwise only the trainee's ACTIVE primary preceptor. Under the trainee row lock.
 */
export async function editRecord(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['PRECEPTOR', 'ADMIN'])
  const admin = isNutritionAdmin(access)
  if (!admin && access.profile?.role !== 'PRECEPTOR') return fail(EDIT_NOT_ALLOWED)
  const parsed = attendanceEditSchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)
  const input = parsed.data

  try {
    await prisma.$transaction(async (tx) => {
      const found = await tx.nutritionAttendanceRecord.findUnique({ where: { id: input.recordId }, select: { traineeId: true } })
      if (!found) throw new ActionFailure(RECORD_NOT_FOUND)
      if (admin) {
        await lockTraineeRow(tx, found.traineeId)
      } else if (!(await lockPrimaryTrainee(tx, (access.profile as { id: string }).id, found.traineeId))) {
        throw new ActionFailure(RECORD_NOT_FOUND)
      }
      // Read again under the lock.
      const record = await tx.nutritionAttendanceRecord.findUnique({ where: { id: input.recordId }, select: RECORD_FIELDS })
      if (!record) throw new ActionFailure(RECORD_NOT_FOUND)
      if (record.voidedAt) throw new ActionFailure(RECORD_VOIDED)

      const day = dayKeyOf(record.workDate)
      const checkInAt = karachiInstant(day, input.checkInTime)
      const checkOutAt = input.checkOutTime === null ? null : karachiInstant(day, input.checkOutTime)
      if (checkOutAt && checkOutAt < checkInAt) {
        throw new ActionFailure('Check-out cannot be earlier than check-in.', { checkOutTime: 'Check-out cannot be earlier than check-in.' })
      }
      const row = await tx.nutritionAttendanceRecord.update({
        where: { id: record.id },
        data: { checkInAt, checkOutAt, status: input.status },
        select: RECORD_FIELDS,
      })
      await writeAudit(tx, {
        entity: 'NutritionAttendanceRecord',
        entityId: row.id,
        action: 'edit',
        actorId: access.userId,
        before: attendanceRecordSnapshot(record),
        after: attendanceRecordSnapshot(row),
      })
    })
  } catch (error) {
    return errorResult(error, SAVED_AT_ONCE)
  }
  return ok('Attendance record updated.')
}

/** Voids (soft-deletes) a record, with a required reason. Any nutrition ADMIN; the row stays, marked voided, and drops out of every count. */
export async function voidRecord(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['ADMIN'])
  const parsed = attendanceVoidSchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)
  const input = parsed.data

  try {
    await prisma.$transaction(async (tx) => {
      const found = await tx.nutritionAttendanceRecord.findUnique({ where: { id: input.recordId }, select: { traineeId: true } })
      if (!found) throw new ActionFailure(RECORD_NOT_FOUND)
      await lockTraineeRow(tx, found.traineeId)
      const record = await tx.nutritionAttendanceRecord.findUnique({ where: { id: input.recordId }, select: RECORD_FIELDS })
      if (!record) throw new ActionFailure(RECORD_NOT_FOUND)
      if (record.voidedAt) throw new ActionFailure(RECORD_VOIDED)

      const row = await tx.nutritionAttendanceRecord.update({
        where: { id: record.id },
        data: { voidedAt: new Date(), voidedById: access.userId, voidReason: input.reason },
        select: RECORD_FIELDS,
      })
      await writeAudit(tx, {
        entity: 'NutritionAttendanceRecord',
        entityId: row.id,
        action: 'void',
        actorId: access.userId,
        before: attendanceRecordSnapshot(record),
        after: attendanceRecordSnapshot(row),
      })
    })
  } catch (error) {
    return errorResult(error, SAVED_AT_ONCE)
  }
  return ok('Attendance record deleted. It stays in the history, marked as deleted.')
}

/**
 * Creates a record for a day the trainee did not record (a missed day), with
 * a required reason. The same editors as editRecord: any nutrition ADMIN, or
 * the trainee's ACTIVE primary preceptor, under the trainee row lock. The day
 * must be a past or current working day of the trainee, on or after the
 * training start date, with no live record (missedDayDecision). The status is
 * OUT_OF_WINDOW_RECORDED_BY_STAFF; the reason is stored, never audited.
 */
export async function createMissedRecord(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['PRECEPTOR', 'ADMIN'])
  const admin = isNutritionAdmin(access)
  if (!admin && access.profile?.role !== 'PRECEPTOR') return fail(EDIT_NOT_ALLOWED)
  const parsed = attendanceMissedDaySchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)
  const input = parsed.data
  let workDate: Date
  try {
    workDate = workDateOf(input.workDate)
  } catch {
    return fail('Enter a real date.', { workDate: 'Enter a real date.' })
  }
  const checkInAt = karachiInstant(input.workDate, input.checkInTime)
  const checkOutAt = input.checkOutTime === null ? null : karachiInstant(input.workDate, input.checkOutTime)
  if (checkOutAt && checkOutAt < checkInAt) {
    return fail('Check-out cannot be earlier than check-in.', { checkOutTime: 'Check-out cannot be earlier than check-in.' })
  }
  const today = localDateKarachi(new Date())

  try {
    await prisma.$transaction(async (tx) => {
      if (admin) {
        if (!(await lockTraineeRow(tx, input.traineeId))) throw new ActionFailure(TRAINEE_NOT_FOUND)
      } else if (!(await lockPrimaryTrainee(tx, (access.profile as { id: string }).id, input.traineeId))) {
        throw new ActionFailure(TRAINEE_NOT_FOUND)
      }
      const trainee = await tx.nutritionProfile.findUnique({ where: { id: input.traineeId }, select: { role: true, trainingStartDate: true } })
      if (trainee?.role !== 'TRAINEE') throw new ActionFailure(TRAINEE_NOT_FOUND)
      const preceptorId = await activePrimaryPreceptorId(tx, input.traineeId)
      const rules = (await loadAttendanceRules(tx, [preceptorId], [input.workDate]))(preceptorId)
      const existing = await tx.nutritionAttendanceRecord.findFirst({
        where: { traineeId: input.traineeId, workDate, voidedAt: null },
        select: RECORD_FIELDS,
      })
      const decision = missedDayDecision(
        input.workDate,
        today,
        trainee.trainingStartDate ? dayKeyOf(trainee.trainingStartDate) : null,
        rules.scheduleOn(input.workDate),
        rules.holidays,
        existing,
      )
      if (!decision.allowed) throw new ActionFailure(decision.message, { workDate: decision.message })

      const row = await tx.nutritionAttendanceRecord.create({
        data: {
          traineeId: input.traineeId,
          workDate,
          checkInAt,
          checkOutAt,
          status: 'OUT_OF_WINDOW_RECORDED_BY_STAFF',
          staffReason: input.reason,
          createdBy: access.userId,
        },
        select: RECORD_FIELDS,
      })
      await writeAudit(tx, {
        entity: 'NutritionAttendanceRecord',
        entityId: row.id,
        action: 'staff-create',
        actorId: access.userId,
        before: null,
        after: attendanceRecordSnapshot(row),
      })
    })
  } catch (error) {
    return errorResult(error, 'This day already has a record. Edit that record instead.')
  }
  return ok(`Attendance recorded for ${input.workDate}.`)
}

/**
 * Voids (removes) a holiday: the row stays, marked voided, and no longer
 * counts. Any nutrition ADMIN may void any holiday (program or preceptor); a
 * preceptor only their own. Anyone else gets "not found".
 */
export async function voidHoliday(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['PRECEPTOR', 'ADMIN'])
  const parsed = attendanceHolidayVoidSchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)
  const input = parsed.data

  try {
    await prisma.$transaction(async (tx) => {
      const holiday = await tx.nutritionAttendanceHoliday.findUnique({ where: { id: input.holidayId }, select: HOLIDAY_FIELDS })
      if (!holiday) throw new ActionFailure(HOLIDAY_NOT_FOUND)
      const mayVoid =
        isNutritionAdmin(access) || (holiday.scopeProfileId !== null && access.profile?.role === 'PRECEPTOR' && access.profile.id === holiday.scopeProfileId)
      if (!mayVoid) throw new ActionFailure(HOLIDAY_NOT_FOUND)
      if (holiday.voidedAt) throw new ActionFailure(HOLIDAY_VOIDED)

      const row = await tx.nutritionAttendanceHoliday.update({
        where: { id: holiday.id },
        data: { voidedAt: new Date(), voidedById: access.userId, voidReason: input.reason },
        select: HOLIDAY_FIELDS,
      })
      await writeAudit(tx, {
        entity: 'NutritionAttendanceHoliday',
        entityId: row.id,
        action: 'void',
        actorId: access.userId,
        before: attendanceHolidaySnapshot(holiday),
        after: attendanceHolidaySnapshot(row),
      })
    })
  } catch (error) {
    return errorResult(error, SAVED_AT_ONCE)
  }
  return ok('Holiday removed. It stays in the history, marked as removed.')
}
