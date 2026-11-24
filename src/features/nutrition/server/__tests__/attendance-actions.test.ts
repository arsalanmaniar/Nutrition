import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('../../auth/__tests__/fakes')).headersModule)
vi.mock('next/navigation', async () => (await import('../../auth/__tests__/fakes')).navigationModule)
vi.mock('@supabase/supabase-js', async () => (await import('../../auth/__tests__/fakes')).supabaseModule)
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./fake-prisma')).fakePrisma }))

import { fakePrisma as fakeDb } from './fake-prisma'
import { resetState } from '../../auth/__tests__/fakes'
import { checkIn, checkOut, createMissedRecord, editRecord, setHoliday, setSchedule, voidHoliday, voidRecord } from '../actions/attendance'
import { IDLE, NON_TRAINEE_CALLERS, form, seedAssignment, seedProfile, signIn, signInAdmin, signInSuperAdmin } from './actors'
import { NOW, TODAY, audit, holidays, karachi, records, schedules, seedHoliday, seedRecord, seedSchedule } from './attendance-fixtures'
import { pair, refusal, seedTrainee, signInAs } from './evaluation-fixtures'

// The attendance actions (Step A4): TRAINEE check-in and check-out under the
// trainee row lock; schedules and holidays by PRECEPTOR (own scope) and ADMIN
// (program); edits by a super_admin or the ACTIVE primary preceptor; voids by
// a super_admin only, never a delete. Every write is audited without free text.

const LOCK_SQL = 'SELECT id FROM nutr_profile WHERE id = ? FOR UPDATE'
const at = (instant: Date) => vi.setSystemTime(instant)

const OUTSIDE = { status: 'error', message: 'Check-in is open from 08:00 until 16:00, Karachi time.' }
const HOLIDAY = { status: 'error', message: 'Today is a holiday, so attendance is not recorded.' }
const WEEKEND = { status: 'error', message: 'Today is not a working day, so attendance is not recorded.' }
const ALREADY_IN = { status: 'error', message: 'You have already checked in today.' }
const ALREADY_OUT = { status: 'error', message: 'You have already checked out today.' }
const NOT_IN = { status: 'error', message: 'You have not checked in today.' }
const BEFORE_IN = { status: 'error', message: 'Check-out cannot be earlier than check-in.' }
const RECORD_NOT_FOUND = { status: 'error', message: 'This attendance record was not found among the records you may change.' }
const RECORD_VOIDED = { status: 'error', message: 'This attendance record has been deleted and can no longer be changed.' }

/** Callers the schedule and holiday actions refuse at the guard: neither PRECEPTOR nor ADMIN. */
const NON_EDITOR_CALLERS: { label: string; signIn: () => void }[] = [
  ...(['TRAINEE', 'UNIT_LEAD', 'ASSESSOR'] as const).map((role) => ({
    label: role,
    signIn: () => {
      const p = seedProfile(role, { authUserId: `auth-caller-${role}`, email: `caller.${role.toLowerCase()}@cdnep.test` })
      signIn(p.authUserId as string, p.email)
    },
  })),
  {
    label: 'deactivated PRECEPTOR',
    signIn: () => {
      seedProfile('PRECEPTOR', { authUserId: 'auth-former-preceptor', email: 'former.preceptor@cdnep.test', isActive: false })
      signIn('auth-former-preceptor', 'former.preceptor@cdnep.test')
    },
  },
  {
    label: 'signed-in account with no profile, not on the super admin allowlist',
    signIn: () => {
      signIn('auth-outsider', 'outsider@cdnep.test')
    },
  },
]

const attendanceCalls = () => fakeDb.calls.filter((call) => call.op.startsWith('nutritionAttendance'))

beforeEach(() => {
  resetState()
  fakeDb.reset()
  vi.useFakeTimers({ toFake: ['Date'] })
  at(NOW)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
})

afterEach(() => {
  // Nothing is ever physically deleted, and no audit row is changed.
  expect(
    fakeDb.calls.filter((call) => /^nutritionAttendance\w+\.(delete|deleteMany)$/.test(call.op) || /^nutritionAuditLog\.(update|delete)/.test(call.op)),
  ).toEqual([])
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('checkIn: TRAINEE only, for themselves', () => {
  it('records today (Karachi) with the server time, under the trainee row lock, audited with ids, times and status', async () => {
    const { trainee } = pair('2026-01-01')
    signInAs(trainee)
    expect(await checkIn()).toEqual({ status: 'ok', message: 'Checked in at 10:00.' })

    expect(records()).toHaveLength(1)
    const row = records()[0]
    expect(row).toMatchObject({
      traineeId: trainee.id,
      workDate: new Date(`${TODAY}T00:00:00Z`),
      checkInAt: NOW,
      checkOutAt: null,
      status: 'PRESENT',
      voidedAt: null,
      createdBy: trainee.authUserId,
    })
    expect(fakeDb.calls.filter((call) => call.inTransaction)[0]).toEqual({ op: '$queryRaw', args: { sql: LOCK_SQL, values: [trainee.id] }, inTransaction: true })
    expect(audit()).toHaveLength(1)
    expect(audit()[0]).toMatchObject({ entity: 'NutritionAttendanceRecord', entityId: row.id, action: 'check-in', actorId: trainee.authUserId, before: null })
    expect(audit()[0].after).toEqual({
      id: row.id,
      traineeId: trainee.id,
      workDate: TODAY,
      checkInAt: NOW.toISOString(),
      checkOutAt: null,
      status: 'PRESENT',
      voidedAt: null,
      voidedById: null,
    })
  })

  it.each(NON_TRAINEE_CALLERS)('$label is refused by the guard, before any attendance read', async ({ signIn: callerSignIn }) => {
    callerSignIn()
    expect(await refusal(checkIn())).toMatch(/^\/nutrition\//)
    expect(await refusal(checkOut())).toMatch(/^\/nutrition\//)
    expect(attendanceCalls()).toEqual([])
    expect(records()).toEqual([])
  })

  it.each([
    ['07:59:59, one second before the window', '2026-11-03T02:59:59Z', OUTSIDE],
    ['16:00:00, the end is excluded', '2026-11-03T11:00:00Z', OUTSIDE],
    ['Saturday', '2026-11-07T05:00:00Z', WEEKEND],
    ['UTC Friday 19:30 = Karachi Saturday 00:30', '2026-11-06T19:30:00Z', WEEKEND],
  ])('%s is refused', async (_name, instant, expected) => {
    const { trainee } = pair('2026-01-01')
    at(new Date(instant)) // before signing in: the test token expires an hour after it is issued
    signInAs(trainee)
    expect(await checkIn()).toEqual(expected)
    expect(records()).toEqual([])
    expect(audit()).toEqual([])
  })

  it('08:00:00 exactly is allowed (the start is included)', async () => {
    const { trainee } = pair('2026-01-01')
    signInAs(trainee)
    at(new Date('2026-11-03T03:00:00Z'))
    expect((await checkIn()).status).toBe('ok')
  })

  it('holidays are a UNION: a program holiday and the primary preceptor\'s holiday both refuse; another preceptor\'s does not', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    const other = seedProfile('PRECEPTOR')
    seedHoliday(null, '2026-11-03', 'Program day off')
    seedHoliday(preceptor.id, '2026-11-04', 'Unit day off')
    seedHoliday(other.id, '2026-11-05', 'Other unit day off')
    signInAs(trainee)
    expect(await checkIn()).toEqual(HOLIDAY) // program holiday on a working Tuesday
    at(karachi('2026-11-04', '10:00'))
    signInAs(trainee)
    expect(await checkIn()).toEqual(HOLIDAY) // the primary preceptor's holiday
    at(karachi('2026-11-05', '10:00'))
    signInAs(trainee)
    expect((await checkIn()).status).toBe('ok') // another preceptor's holiday does not apply
    expect(records()).toHaveLength(1)
  })

  it('a program holiday applies to a trainee with no primary preceptor', async () => {
    const trainee = seedTrainee('2026-01-01')
    seedHoliday(null, TODAY)
    signInAs(trainee)
    expect(await checkIn()).toEqual(HOLIDAY)
  })

  it("the window: the preceptor's schedule when it exists, otherwise the program default", async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    const loner = seedTrainee('2026-01-01')
    seedSchedule(null, { startTime: '09:30', endTime: '17:00' })
    seedSchedule(preceptor.id, { startTime: '10:30', endTime: '18:00' })
    at(karachi(TODAY, '10:00'))
    signInAs(trainee)
    expect(await checkIn()).toEqual({ status: 'error', message: 'Check-in is open from 10:30 until 18:00, Karachi time.' })
    signInAs(loner)
    expect((await checkIn()).status).toBe('ok') // program default 09:30–17:00
    at(karachi(TODAY, '09:00'))
    const another = seedTrainee('2026-01-01')
    signInAs(another)
    expect(await checkIn()).toEqual({ status: 'error', message: 'Check-in is open from 09:30 until 17:00, Karachi time.' })
  })

  it('a second check-in the same day is refused', async () => {
    const { trainee } = pair('2026-01-01')
    signInAs(trainee)
    expect((await checkIn()).status).toBe('ok')
    expect(await checkIn()).toEqual(ALREADY_IN)
    seedRecord(seedTrainee('2026-01-01').id, TODAY) // someone else's record does not block
    expect(records()).toHaveLength(2)
    expect(audit()).toHaveLength(1)
  })

  it('after a check-out, check-in is refused as already checked out', async () => {
    const { trainee } = pair('2026-01-01')
    seedRecord(trainee.id, TODAY, { checkIn: '08:30', checkOut: '09:30' })
    signInAs(trainee)
    expect(await checkIn()).toEqual(ALREADY_OUT)
  })

  it('two check-ins at the same instant: the row lock lets exactly one through', async () => {
    const { trainee } = pair('2026-01-01')
    signInAs(trainee)
    const results = await Promise.all([checkIn(), checkIn()])
    expect(results.map((r) => r.status).sort()).toEqual(['error', 'ok'])
    expect(records()).toHaveLength(1)
  })
})

describe('checkOut', () => {
  it("closes today's record, audited with before and after", async () => {
    const { trainee } = pair('2026-01-01')
    signInAs(trainee)
    await checkIn()
    at(karachi(TODAY, '19:45')) // after the window: check-out is not window-bound
    signInAs(trainee)
    expect(await checkOut()).toEqual({ status: 'ok', message: 'Checked out at 19:45.' })
    expect(records()[0]).toMatchObject({ checkInAt: NOW, checkOutAt: karachi(TODAY, '19:45') })
    const entry = audit()[1]
    expect(entry).toMatchObject({ entity: 'NutritionAttendanceRecord', action: 'check-out', actorId: trainee.authUserId })
    expect(entry.before).toMatchObject({ checkOutAt: null })
    expect(entry.after).toMatchObject({ checkOutAt: karachi(TODAY, '19:45').toISOString() })
  })

  it('without a check-in today, after a check-out, or before the check-in, it is refused', async () => {
    const { trainee } = pair('2026-01-01')
    signInAs(trainee)
    seedRecord(trainee.id, '2026-11-02') // yesterday's open record is not today's
    expect(await checkOut()).toEqual(NOT_IN)

    const later = seedTrainee('2026-01-01')
    seedRecord(later.id, TODAY, { checkIn: '11:00' }) // check-in after "now" (10:00), e.g. set by an editor
    signInAs(later)
    expect(await checkOut()).toEqual(BEFORE_IN)

    const done = seedTrainee('2026-01-01')
    seedRecord(done.id, TODAY, { checkIn: '08:00', checkOut: '09:00' })
    signInAs(done)
    expect(await checkOut()).toEqual(ALREADY_OUT)

    const voided = seedTrainee('2026-01-01')
    seedRecord(voided.id, TODAY, { voided: true })
    signInAs(voided)
    expect(await checkOut()).toEqual(NOT_IN)
    expect(audit()).toEqual([])
  })
})

describe('setSchedule and setHoliday', () => {
  const scheduleForm = (extra: Record<string, string> = {}) =>
    form({ scope: 'MINE', weekdays: '1,2,3,4,5,6', startTime: '07:30', endTime: '15:30', effectiveFrom: '2026-11-10', ...extra })

  it("a preceptor sets their own trainees' schedule; the audit row has the values", async () => {
    const preceptor = seedProfile('PRECEPTOR')
    signInAs(preceptor)
    expect((await setSchedule(IDLE, scheduleForm({ scopeProfileId: 'other' }))).status).toBe('ok')
    expect(schedules()).toHaveLength(1)
    expect(schedules()[0]).toMatchObject({ scopeProfileId: preceptor.id, weekdays: [1, 2, 3, 4, 5, 6], startTime: '07:30', endTime: '15:30' })
    expect(audit()[0]).toMatchObject({ entity: 'NutritionAttendanceSchedule', action: 'create', actorId: preceptor.authUserId, before: null })
    expect(audit()[0].after).toMatchObject({ scopeProfileId: preceptor.id, weekdays: '1,2,3,4,5,6', effectiveFrom: '2026-11-10' })
  })

  it('an ADMIN and a super_admin set the program default (scope NULL)', async () => {
    signInAdmin()
    expect((await setSchedule(IDLE, scheduleForm({ scope: 'PROGRAM' }))).status).toBe('ok')
    expect(schedules()[0].scopeProfileId).toBeNull()
    signInSuperAdmin()
    expect((await setSchedule(IDLE, scheduleForm({ scope: 'PROGRAM', effectiveFrom: '2026-12-01' }))).status).toBe('ok')
    expect(schedules().map((row) => row.scopeProfileId)).toEqual([null, null])
  })

  it('an ADMIN and a super_admin may start the program default in the past; the audit row records it', async () => {
    signInAdmin()
    expect(await setSchedule(IDLE, scheduleForm({ scope: 'PROGRAM', startTime: '08:00', endTime: '16:00', effectiveFrom: '2026-08-03' }))).toEqual({
      status: 'ok',
      message: 'Working hours 08:00 to 16:00 saved from 2026-08-03.',
    })
    expect(schedules()[0]).toMatchObject({ scopeProfileId: null, weekdays: [1, 2, 3, 4, 5, 6], startTime: '08:00', endTime: '16:00' })
    expect(audit()).toHaveLength(1)
    expect(audit()[0]).toMatchObject({ entity: 'NutritionAttendanceSchedule', action: 'create', before: null })
    expect(audit()[0].after).toMatchObject({ scopeProfileId: null, startTime: '08:00', endTime: '16:00', effectiveFrom: '2026-08-03' })
    signInSuperAdmin()
    expect((await setSchedule(IDLE, scheduleForm({ scope: 'PROGRAM', effectiveFrom: '2026-11-02' }))).status).toBe('ok') // yesterday
    expect(schedules()).toHaveLength(2)
    // Every other check still applies to a past program date.
    for (const extra of [{ effectiveFrom: '2026-02-30' }, { startTime: '16:00', endTime: '08:00' }] as Record<string, string>[]) {
      expect((await setSchedule(IDLE, scheduleForm({ scope: 'PROGRAM', effectiveFrom: '2026-08-03', ...extra }))).status).toBe('error')
    }
    expect(schedules()).toHaveLength(2)
  })

  it('a preceptor still cannot start their own schedule in the past, nor reach the program scope', async () => {
    signInAs(seedProfile('PRECEPTOR'))
    expect(await setSchedule(IDLE, scheduleForm({ effectiveFrom: '2026-08-03' }))).toMatchObject({ status: 'error', message: 'A schedule can start today or later, not in the past.' })
    expect((await setSchedule(IDLE, scheduleForm({ scope: 'PROGRAM', effectiveFrom: '2026-08-03' }))).status).toBe('error')
    expect(schedules()).toEqual([])
    expect(audit()).toEqual([])
  })

  it('a preceptor cannot set the program default; an ADMIN without a preceptor profile cannot set MINE', async () => {
    signInAs(seedProfile('PRECEPTOR'))
    expect((await setSchedule(IDLE, scheduleForm({ scope: 'PROGRAM' }))).status).toBe('error')
    expect((await setHoliday(IDLE, form({ scope: 'PROGRAM', workDate: TODAY, name: 'Eid' }))).status).toBe('error')
    signInAdmin()
    expect((await setSchedule(IDLE, scheduleForm())).status).toBe('error')
    expect((await setHoliday(IDLE, form({ scope: 'MINE', workDate: TODAY, name: 'Eid' }))).status).toBe('error')
    expect(schedules()).toEqual([])
    expect(holidays()).toEqual([])
    expect(audit()).toEqual([])
  })

  it.each([
    [{ startTime: '17:00', endTime: '08:00' }, 'endTime'],
    [{ startTime: '08:00', endTime: '08:00' }, 'endTime'],
    [{ startTime: '8:00' }, 'startTime'],
    [{ weekdays: '7' }, 'weekdays'],
    [{ weekdays: '' }, 'weekdays'],
    [{ effectiveFrom: '2026-11-02' }, 'effectiveFrom'], // yesterday: a preceptor's own schedule cannot start in the past
    [{ effectiveFrom: '2026-02-30' }, 'effectiveFrom'],
  ])('%j is refused on %s', async (extra, field) => {
    signInAs(seedProfile('PRECEPTOR'))
    const result = await setSchedule(IDLE, scheduleForm(extra))
    expect(result.status).toBe('error')
    expect(Object.keys((result as { fieldErrors?: Record<string, string> }).fieldErrors ?? {})).toContain(field)
    expect(schedules()).toEqual([])
  })

  it('a second save for the same scope and day updates that row (audited as update)', async () => {
    const preceptor = seedProfile('PRECEPTOR')
    signInAs(preceptor)
    await setSchedule(IDLE, scheduleForm())
    await setSchedule(IDLE, scheduleForm({ startTime: '09:00' }))
    expect(schedules()).toHaveLength(1)
    expect(schedules()[0].startTime).toBe('09:00')
    expect(audit().map((row) => row.action)).toEqual(['create', 'update'])
    expect(audit()[1].before).toMatchObject({ startTime: '07:30' })
  })

  it('holidays: preceptor (own) and admin (program); the name never reaches the audit log; a repeat renames', async () => {
    const preceptor = seedProfile('PRECEPTOR')
    signInAs(preceptor)
    expect((await setHoliday(IDLE, form({ scope: 'MINE', workDate: '2026-11-09', name: 'Unit audit day' }))).status).toBe('ok')
    expect((await setHoliday(IDLE, form({ scope: 'MINE', workDate: '2026-11-09', name: 'Unit training day' }))).status).toBe('ok')
    signInAdmin()
    expect((await setHoliday(IDLE, form({ scope: 'PROGRAM', workDate: '2026-11-09', name: 'Iqbal Day' }))).status).toBe('ok')
    expect(holidays().map((row) => [row.scopeProfileId, row.name])).toEqual([
      [preceptor.id, 'Unit training day'],
      [null, 'Iqbal Day'],
    ])
    expect(audit().map((row) => [row.entity, row.action])).toEqual([
      ['NutritionAttendanceHoliday', 'create'],
      ['NutritionAttendanceHoliday', 'update'],
      ['NutritionAttendanceHoliday', 'create'],
    ])
    expect(JSON.stringify(audit())).not.toMatch(/audit day|training day|Iqbal/)
  })

  it.each(NON_EDITOR_CALLERS)('$label is refused by the guard', async ({ signIn: callerSignIn }) => {
    callerSignIn()
    expect(await refusal(setSchedule(IDLE, scheduleForm()))).toMatch(/^\/nutrition\//)
    expect(await refusal(setHoliday(IDLE, form({ scope: 'MINE', workDate: TODAY, name: 'Eid' })))).toMatch(/^\/nutrition\//)
    expect(attendanceCalls()).toEqual([])
  })
})

describe('editRecord: any nutrition ADMIN, or the ACTIVE primary preceptor of that trainee', () => {
  const editForm = (recordId: string, extra: Record<string, string> = {}) =>
    form({ recordId, checkInTime: '09:15', checkOutTime: '17:30', status: 'OUT_OF_WINDOW_RECORDED_BY_STAFF', ...extra })

  it('the primary preceptor edits times (Karachi, on the record\'s day) and status, under the lock, audited before and after', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    const record = seedRecord(trainee.id, '2026-11-02')
    signInAs(preceptor)
    expect(await editRecord(IDLE, editForm(record.id as string))).toEqual({ status: 'ok', message: 'Attendance record updated.' })
    expect(records()[0]).toMatchObject({
      checkInAt: new Date('2026-11-02T04:15:00Z'),
      checkOutAt: new Date('2026-11-02T12:30:00Z'),
      status: 'OUT_OF_WINDOW_RECORDED_BY_STAFF',
      workDate: new Date('2026-11-02T00:00:00Z'),
    })
    expect(fakeDb.calls).toContainEqual({ op: '$queryRaw', args: { sql: LOCK_SQL, values: [trainee.id] }, inTransaction: true })
    expect(audit()[0]).toMatchObject({ entity: 'NutritionAttendanceRecord', action: 'edit', actorId: preceptor.authUserId })
    expect(audit()[0].before).toMatchObject({ checkInAt: '2026-11-02T04:00:00.000Z', status: 'PRESENT' })
    expect(audit()[0].after).toMatchObject({ checkInAt: '2026-11-02T04:15:00.000Z', status: 'OUT_OF_WINDOW_RECORDED_BY_STAFF' })
  })

  it('another preceptor, a former primary preceptor and a rotation-only preceptor get "not found"; nothing changes', async () => {
    const { trainee } = pair('2026-01-01')
    const record = seedRecord(trainee.id, '2026-11-02')
    const stranger = seedProfile('PRECEPTOR')
    const former = seedProfile('PRECEPTOR')
    seedAssignment(trainee.id, former.id, false)
    for (const caller of [stranger, former]) {
      signInAs(caller)
      expect(await editRecord(IDLE, editForm(record.id as string))).toEqual(RECORD_NOT_FOUND)
    }
    expect(records()[0]).toEqual(record)
    expect(audit()).toEqual([])
  })

  it('a nutrition ADMIN (not a super_admin) may edit any record: under the lock, audited before and after', async () => {
    const { trainee } = pair('2026-01-01')
    const record = seedRecord(trainee.id, '2026-11-02')
    signInAdmin()
    expect(await editRecord(IDLE, editForm(record.id as string))).toEqual({ status: 'ok', message: 'Attendance record updated.' })
    expect(records()[0]).toMatchObject({ checkInAt: new Date('2026-11-02T04:15:00Z'), checkOutAt: new Date('2026-11-02T12:30:00Z') })
    expect(fakeDb.calls).toContainEqual({ op: '$queryRaw', args: { sql: LOCK_SQL, values: [trainee.id] }, inTransaction: true })
    expect(audit()).toHaveLength(1)
    expect(audit()[0]).toMatchObject({ entity: 'NutritionAttendanceRecord', action: 'edit', actorId: 'auth-admin' })
    expect(audit()[0].before).toMatchObject({ checkInAt: '2026-11-02T04:00:00.000Z' })
    expect(audit()[0].after).toMatchObject({ checkInAt: '2026-11-02T04:15:00.000Z' })
  })

  it('a nutrition ADMIN gets the same refusals: check-out before check-in and a voided record', async () => {
    const trainee = seedTrainee('2026-01-01')
    const record = seedRecord(trainee.id, '2026-11-02')
    const voided = seedRecord(trainee.id, '2026-10-30', { voided: true })
    signInAdmin()
    expect((await editRecord(IDLE, editForm(record.id as string, { checkInTime: '12:00', checkOutTime: '11:59' }))).status).toBe('error')
    expect(await editRecord(IDLE, editForm(voided.id as string))).toEqual(RECORD_VOIDED)
    expect(records()[0]).toEqual(record)
    expect(audit()).toEqual([])
  })

  it('a super_admin may edit any record', async () => {
    const trainee = seedTrainee('2026-01-01')
    const record = seedRecord(trainee.id, '2026-11-02')
    signInSuperAdmin()
    expect((await editRecord(IDLE, editForm(record.id as string, { checkOutTime: '' }))).status).toBe('ok')
    expect(records()[0]).toMatchObject({ checkOutAt: null })
    expect(audit()[0].actorId).toBe('auth-boss')
  })

  it('check-out before check-in, a voided record and an unknown id are refused', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    const record = seedRecord(trainee.id, '2026-11-02')
    const voided = seedRecord(trainee.id, '2026-10-30', { voided: true })
    signInAs(preceptor)
    const backwards = await editRecord(IDLE, editForm(record.id as string, { checkInTime: '12:00', checkOutTime: '11:59' }))
    expect(backwards).toEqual({ status: 'error', message: 'Check-out cannot be earlier than check-in.', fieldErrors: { checkOutTime: 'Check-out cannot be earlier than check-in.' } })
    expect(await editRecord(IDLE, editForm(voided.id as string))).toEqual(RECORD_VOIDED)
    expect(await editRecord(IDLE, editForm('0b0c3e1e-6c1b-4c39-9a37-3f5c2f1f9a11'))).toEqual(RECORD_NOT_FOUND)
    expect(audit()).toEqual([])
  })

  it.each(NON_EDITOR_CALLERS)('$label is refused by the guard', async ({ signIn: callerSignIn }) => {
    const record = seedRecord(seedTrainee('2026-01-01').id, '2026-11-02')
    callerSignIn()
    expect(await refusal(editRecord(IDLE, editForm(record.id as string)))).toMatch(/^\/nutrition\//)
    expect(attendanceCalls()).toEqual([])
  })
})

describe('voidRecord: any nutrition ADMIN, with a required reason; the row is kept', () => {
  it('sets voidedAt, voidedById and the reason; the row stays; the audit row has no reason text', async () => {
    const trainee = seedTrainee('2026-01-01')
    const record = seedRecord(trainee.id, '2026-11-02')
    signInSuperAdmin()
    expect((await voidRecord(IDLE, form({ recordId: record.id as string, reason: 'Duplicate entry from a test.' }))).status).toBe('ok')
    expect(records()).toHaveLength(1)
    expect(records()[0]).toMatchObject({ id: record.id, voidedAt: NOW, voidedById: 'auth-boss', voidReason: 'Duplicate entry from a test.' })
    expect(fakeDb.writes().map((call) => call.op)).toEqual(['nutritionAttendanceRecord.update', 'nutritionAuditLog.create'])
    expect(audit()[0]).toMatchObject({ entity: 'NutritionAttendanceRecord', action: 'void', actorId: 'auth-boss' })
    expect(audit()[0].after).toMatchObject({ voidedAt: NOW.toISOString(), voidedById: 'auth-boss' })
    expect(JSON.stringify(audit())).not.toContain('Duplicate entry')
  })

  it('after a void the trainee may check in again that day; the voided row is still there', async () => {
    const trainee = seedTrainee('2026-01-01')
    seedRecord(trainee.id, TODAY, { voided: true })
    signInAs(trainee)
    expect((await checkIn()).status).toBe('ok')
    expect(records()).toHaveLength(2)
    expect(records().filter((row) => row.voidedAt === null)).toHaveLength(1)
  })

  it('a preceptor (even the primary one) and a trainee are refused by the guard', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    const record = seedRecord(trainee.id, '2026-11-02')
    const fields = form({ recordId: record.id as string, reason: 'Wrong day.' })
    signInAs(preceptor)
    expect(await refusal(voidRecord(IDLE, fields))).toMatch(/^\/nutrition\//)
    signInAs(trainee)
    expect(await refusal(voidRecord(IDLE, fields))).toMatch(/^\/nutrition\//)
    expect(records()[0]).toEqual(record)
    expect(audit()).toEqual([])
  })

  it('a nutrition ADMIN (not a super_admin) voids any record: reason stored, audited without it; a missing reason is refused', async () => {
    const { trainee } = pair('2026-01-01')
    const record = seedRecord(trainee.id, '2026-11-02')
    signInAdmin()
    expect((await voidRecord(IDLE, form({ recordId: record.id as string, reason: '  ' }))).status).toBe('error')
    expect(audit()).toEqual([])
    expect((await voidRecord(IDLE, form({ recordId: record.id as string, reason: 'Entered for the wrong trainee.' }))).status).toBe('ok')
    expect(records()).toHaveLength(1)
    expect(records()[0]).toMatchObject({ voidedAt: NOW, voidedById: 'auth-admin', voidReason: 'Entered for the wrong trainee.' })
    expect(audit()).toHaveLength(1)
    expect(audit()[0]).toMatchObject({ entity: 'NutritionAttendanceRecord', action: 'void', actorId: 'auth-admin' })
    expect(JSON.stringify(audit())).not.toContain('wrong trainee')
  })

  it('an already voided record, a missing reason and a reason with a patient identifier are refused', async () => {
    const trainee = seedTrainee('2026-01-01')
    const voided = seedRecord(trainee.id, '2026-11-02', { voided: true })
    const live = seedRecord(trainee.id, '2026-11-03')
    signInSuperAdmin()
    expect(await voidRecord(IDLE, form({ recordId: voided.id as string, reason: 'Again.' }))).toEqual(RECORD_VOIDED)
    expect((await voidRecord(IDLE, form({ recordId: live.id as string, reason: '  ' }))).status).toBe('error')
    const identifier = await voidRecord(IDLE, form({ recordId: live.id as string, reason: 'Patient MRN 1234567 was seen.' }))
    expect(Object.keys((identifier as { fieldErrors?: Record<string, string> }).fieldErrors ?? {})).toEqual(['reason'])
    expect(records().find((row) => row.id === live.id)?.voidedAt).toBeNull()
    expect(audit()).toEqual([])
  })
})

describe('createMissedRecord: an editor records a missed day, with a required reason', () => {
  const TRAINEE_NOT_FOUND = { status: 'error', message: 'This trainee was not found among your trainees.' }
  const missedForm = (traineeId: string, extra: Record<string, string> = {}) =>
    form({ traineeId, workDate: '2026-11-02', checkInTime: '09:00', checkOutTime: '17:00', reason: 'Badge reader was down.', ...extra })

  it('the primary preceptor creates it: staff status, Karachi times, reason stored, under the lock, audited without the reason', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    signInAs(preceptor)
    expect(await createMissedRecord(IDLE, missedForm(trainee.id))).toEqual({ status: 'ok', message: 'Attendance recorded for 2026-11-02.' })
    const row = records()[0]
    expect(row).toMatchObject({
      traineeId: trainee.id,
      checkInAt: karachi('2026-11-02', '09:00'),
      checkOutAt: karachi('2026-11-02', '17:00'),
      status: 'OUT_OF_WINDOW_RECORDED_BY_STAFF',
      staffReason: 'Badge reader was down.',
      createdBy: preceptor.authUserId,
    })
    expect(fakeDb.calls.filter((call) => call.inTransaction)[0]).toEqual({ op: '$queryRaw', args: { sql: LOCK_SQL, values: [trainee.id] }, inTransaction: true })
    expect(audit()[0]).toMatchObject({ entity: 'NutritionAttendanceRecord', action: 'staff-create', actorId: preceptor.authUserId, before: null })
    expect(JSON.stringify(audit())).not.toContain('Badge reader')
  })

  it('a super_admin may create one for any trainee; a voided record that day does not block it', async () => {
    const trainee = seedTrainee('2026-01-01')
    seedRecord(trainee.id, '2026-11-02', { voided: true })
    signInSuperAdmin()
    expect((await createMissedRecord(IDLE, missedForm(trainee.id, { checkOutTime: '' }))).status).toBe('ok')
    expect(records().filter((row) => row.voidedAt === null)).toHaveLength(1)
  })

  it('future day, Sunday, holiday, before training start and an existing live record are refused', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    seedHoliday(null, '2026-10-30')
    seedRecord(trainee.id, '2026-10-29')
    const late = seedTrainee('2026-11-03')
    seedAssignment(late.id, preceptor.id)
    signInAs(preceptor)
    const cases: [string, Record<string, string>, string][] = [
      [trainee.id, { workDate: '2026-11-04' }, 'A missed day cannot be in the future.'],
      [trainee.id, { workDate: '2026-11-01' }, 'This day is not a working day.'],
      [trainee.id, { workDate: '2026-10-30' }, 'This day is a holiday.'],
      [late.id, { workDate: '2026-11-02' }, "This day is before the trainee's training start date."],
      [trainee.id, { workDate: '2026-10-29' }, 'This day already has a record. Edit that record instead.'],
    ]
    for (const [id, extra, message] of cases) expect(await createMissedRecord(IDLE, missedForm(id, extra))).toMatchObject({ status: 'error', message })
    expect(records()).toHaveLength(1)
    expect(audit()).toEqual([])
  })

  it('a missing reason or one with a patient identifier is refused', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    signInAs(preceptor)
    for (const reason of ['', 'Saw patient MRN 1234567 instead.']) {
      const result = await createMissedRecord(IDLE, missedForm(trainee.id, { reason }))
      expect(Object.keys((result as { fieldErrors?: Record<string, string> }).fieldErrors ?? {})).toEqual(['reason'])
    }
    expect(records()).toEqual([])
  })

  it('another preceptor gets "not found"; other roles are refused by the guard', async () => {
    const { trainee } = pair('2026-01-01')
    signInAs(seedProfile('PRECEPTOR'))
    expect(await createMissedRecord(IDLE, missedForm(trainee.id))).toEqual(TRAINEE_NOT_FOUND)
    signInAs(trainee)
    expect(await refusal(createMissedRecord(IDLE, missedForm(trainee.id)))).toMatch(/^\/nutrition\//)
    expect(records()).toEqual([])
  })

  it('a nutrition ADMIN (not a super_admin) adds one for any trainee: under the lock, reason stored, audited without it; the day rules still apply', async () => {
    const { trainee } = pair('2026-01-01')
    const unassigned = seedTrainee('2026-01-01')
    seedHoliday(null, '2026-10-30')
    signInAdmin()
    expect(await createMissedRecord(IDLE, missedForm(unassigned.id))).toEqual({ status: 'ok', message: 'Attendance recorded for 2026-11-02.' })
    expect(fakeDb.calls).toContainEqual({ op: '$queryRaw', args: { sql: LOCK_SQL, values: [unassigned.id] }, inTransaction: true })
    expect(records()[0]).toMatchObject({ traineeId: unassigned.id, status: 'OUT_OF_WINDOW_RECORDED_BY_STAFF', staffReason: 'Badge reader was down.', createdBy: 'auth-admin' })
    expect(audit()[0]).toMatchObject({ entity: 'NutritionAttendanceRecord', action: 'staff-create', actorId: 'auth-admin', before: null })
    expect(JSON.stringify(audit())).not.toContain('Badge reader')
    const refused: [Record<string, string>, string][] = [
      [{ workDate: '2026-11-04' }, 'A missed day cannot be in the future.'],
      [{ workDate: '2026-11-01' }, 'This day is not a working day.'],
      [{ workDate: '2026-10-30' }, 'This day is a holiday.'],
      [{ workDate: '2026-11-02' }, 'This day already has a record. Edit that record instead.'],
    ]
    for (const [extra, message] of refused) expect(await createMissedRecord(IDLE, missedForm(unassigned.id, extra))).toMatchObject({ status: 'error', message })
    const noReason = await createMissedRecord(IDLE, missedForm(trainee.id, { reason: '' }))
    expect(Object.keys((noReason as { fieldErrors?: Record<string, string> }).fieldErrors ?? {})).toEqual(['reason'])
    expect(records()).toHaveLength(1)
    expect(audit()).toHaveLength(1)
  })
})

describe('voidHoliday: the row is kept and stops counting', () => {
  const HOLIDAY_NOT_FOUND = { status: 'error', message: 'This holiday was not found among the holidays you may change.' }
  const voidForm = (holidayId: string, reason = 'Unit decided to stay open.') => form({ holidayId, reason })

  it('a preceptor voids their own holiday: row kept, audited without name or reason, and check-in then works', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    const holiday = seedHoliday(preceptor.id, TODAY, 'Unit away day')
    signInAs(preceptor)
    expect((await voidHoliday(IDLE, voidForm(holiday.id as string))).status).toBe('ok')
    expect(holidays()).toHaveLength(1)
    expect(holidays()[0]).toMatchObject({ voidedAt: NOW, voidedById: preceptor.authUserId, voidReason: 'Unit decided to stay open.' })
    expect(audit()[0]).toMatchObject({ entity: 'NutritionAttendanceHoliday', action: 'void' })
    expect(JSON.stringify(audit())).not.toMatch(/away day|stay open/)
    signInAs(trainee)
    expect((await checkIn()).status).toBe('ok')
  })

  it('an ADMIN voids a program holiday AND a preceptor one, with a reason, audited; a preceptor cannot void others', async () => {
    const preceptor = seedProfile('PRECEPTOR')
    const program = seedHoliday(null, '2026-11-09')
    const unit = seedHoliday(seedProfile('PRECEPTOR').id, '2026-11-10')
    signInAs(preceptor)
    expect(await voidHoliday(IDLE, voidForm(program.id as string))).toEqual(HOLIDAY_NOT_FOUND)
    expect(await voidHoliday(IDLE, voidForm(unit.id as string))).toEqual(HOLIDAY_NOT_FOUND)
    signInAdmin()
    expect((await voidHoliday(IDLE, voidForm(unit.id as string, ''))).status).toBe('error')
    expect((await voidHoliday(IDLE, voidForm(unit.id as string))).status).toBe('ok')
    expect((await voidHoliday(IDLE, voidForm(program.id as string))).status).toBe('ok')
    expect(holidays().map((row) => row.voidedById)).toEqual(['auth-admin', 'auth-admin'])
    expect(audit().map((row) => [row.entity, row.action, row.actorId])).toEqual([
      ['NutritionAttendanceHoliday', 'void', 'auth-admin'],
      ['NutritionAttendanceHoliday', 'void', 'auth-admin'],
    ])
    expect(await voidHoliday(IDLE, voidForm(unit.id as string))).toEqual({ status: 'error', message: 'This holiday has already been removed.' })
  })

  it('a super_admin still voids any holiday', async () => {
    const unit = seedHoliday(seedProfile('PRECEPTOR').id, '2026-11-10')
    signInSuperAdmin()
    expect((await voidHoliday(IDLE, voidForm(unit.id as string))).status).toBe('ok')
  })

  it('a voided day can be set again as a new row; a trainee is refused by the guard', async () => {
    const preceptor = seedProfile('PRECEPTOR')
    seedHoliday(preceptor.id, '2026-11-09', 'Old', true)
    signInAs(preceptor)
    expect((await setHoliday(IDLE, form({ scope: 'MINE', workDate: '2026-11-09', name: 'New' }))).status).toBe('ok')
    expect(holidays()).toHaveLength(2)
    const trainee = seedTrainee('2026-01-01')
    signInAs(trainee)
    expect(await refusal(voidHoliday(IDLE, voidForm(holidays()[1].id as string)))).toMatch(/^\/nutrition\//)
  })
})
