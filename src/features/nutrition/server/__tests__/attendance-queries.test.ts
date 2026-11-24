import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('../../auth/__tests__/fakes')).headersModule)
vi.mock('next/navigation', async () => (await import('../../auth/__tests__/fakes')).navigationModule)
vi.mock('@supabase/supabase-js', async () => (await import('../../auth/__tests__/fakes')).supabaseModule)
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./fake-prisma')).fakePrisma }))

import { resetState } from '../../auth/__tests__/fakes'
import {
  getMyAttendance,
  getMyAttendanceCalendar,
  getMyCheckInStatus,
  getProgramAttendanceSettings,
  getProgramAttendanceSummary,
  getTraineeAttendanceCalendar,
  listAttendanceRecordsForVoid,
  listMyAttendanceSettings,
  listMyTraineesAttendance,
} from '../queries/attendance'
import { NON_ADMIN_CALLERS, NON_PRECEPTOR_CALLERS, NON_TRAINEE_CALLERS, seedAssignment, seedProfile, signInAdmin, signInSuperAdmin } from './actors'
import { NOW, TODAY, seedHoliday, seedRecord, seedSchedule } from './attendance-fixtures'
import { pair, refusal, seedTrainee, signInAs } from './evaluation-fixtures'
import { fakePrisma } from './fake-prisma'

// The attendance loaders (Step A4). Today is Tuesday 3 November 2026, 10:00
// Karachi, so November so far has two working days (Mon 2, Tue 3) under the
// default Monday-to-Friday schedule. Voided rows are never shown or counted;
// groups under 3 show only their size.

beforeEach(() => {
  resetState()
  fakePrisma.reset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
})

afterEach(() => {
  // Loaders never write.
  expect(fakePrisma.writes()).toEqual([])
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('getMyAttendance: the trainee\'s own month', () => {
  it('own live records only, today\'s record, and present days over working days so far', async () => {
    const { trainee } = pair('2026-01-01')
    const other = seedTrainee('2026-01-01')
    seedRecord(trainee.id, '2026-11-02', { checkIn: '08:30', checkOut: '16:45' })
    seedRecord(trainee.id, TODAY, { checkIn: '09:05' })
    seedRecord(trainee.id, '2026-10-30') // last month
    seedRecord(other.id, '2026-11-02')
    signInAs(trainee)
    const mine = await getMyAttendance()
    expect(mine).toEqual({
      month: '2026-11',
      today: { id: expect.any(String), workDate: TODAY, checkIn: '09:05', checkOut: null, status: 'PRESENT' },
      days: [
        { id: expect.any(String), workDate: '2026-11-02', checkIn: '08:30', checkOut: '16:45', status: 'PRESENT' },
        { id: expect.any(String), workDate: TODAY, checkIn: '09:05', checkOut: null, status: 'PRESENT' },
      ],
      percentage: { presentDays: 2, workingDays: 2, percent: 100 },
    })
  })

  it('a voided record is neither listed nor counted', async () => {
    const { trainee } = pair('2026-01-01')
    seedRecord(trainee.id, '2026-11-02', { voided: true })
    seedRecord(trainee.id, TODAY)
    signInAs(trainee)
    const mine = await getMyAttendance()
    expect(mine?.days.map((day) => day.workDate)).toEqual([TODAY])
    expect(mine?.percentage).toEqual({ presentDays: 1, workingDays: 2, percent: 50 })
  })

  it('holidays (program AND primary preceptor) and the training start date reduce the working days', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    seedHoliday(null, '2026-11-02')
    signInAs(trainee)
    expect((await getMyAttendance())?.percentage.workingDays).toBe(1)
    seedHoliday(preceptor.id, TODAY)
    expect((await getMyAttendance())?.percentage).toEqual({ presentDays: 0, workingDays: 0, percent: null })

    const late = seedTrainee(TODAY)
    signInAs(late)
    expect((await getMyAttendance())?.percentage.workingDays).toBe(1)
  })

  it('a past month counts all of it under the schedule then in force; a malformed month is null', async () => {
    const { trainee } = pair('2026-01-01')
    seedSchedule(null, { weekdays: [1, 2, 3, 4, 5, 6] }) // program default: Monday to Saturday
    signInAs(trainee)
    expect((await getMyAttendance('2026-10'))?.percentage.workingDays).toBe(27)
    expect(await getMyAttendance('2026-13')).toBeNull()
    expect(await getMyAttendance('October')).toBeNull()
  })

  it.each(NON_TRAINEE_CALLERS)('$label is refused by the guard', async ({ signIn }) => {
    signIn()
    expect(await refusal(getMyAttendance())).toMatch(/^\/nutrition\//)
  })
})

describe("listMyTraineesAttendance: the preceptor's ACTIVE primary trainees", () => {
  function threeTrainees(preceptorId: string) {
    const names = ['Asma', 'Bilal', 'Chand']
    return names.map((fullName) => {
      const trainee = seedTrainee('2026-01-01', { fullName })
      seedAssignment(trainee.id, preceptorId)
      return trainee
    })
  }

  it('lists only their own trainees, without voided rows; a group of 2 shows only its size', async () => {
    const preceptor = seedProfile('PRECEPTOR')
    const [a, b] = threeTrainees(preceptor.id)
    const third = fakePrisma.tables.nutritionPreceptorAssignment.find((row) => row.preceptorId === preceptor.id && row.traineeId !== a.id && row.traineeId !== b.id)
    if (third) third.active = false // now 2 active trainees
    const { trainee: stranger } = pair('2026-01-01')
    seedRecord(a.id, '2026-11-02')
    seedRecord(a.id, TODAY)
    seedRecord(b.id, TODAY, { voided: true })
    seedRecord(stranger.id, TODAY)
    signInAs(preceptor)
    const result = await listMyTraineesAttendance()
    expect(result?.trainees.map((t) => [t.traineeName, t.days.length, t.percentage.percent])).toEqual([
      ['Asma', 2, 100],
      ['Bilal', 0, 0],
    ])
    expect(result?.group).toEqual({ n: 2, hidden: true })
    expect(JSON.stringify(result)).not.toContain(stranger.id)
  })

  it('a group of 3 shows the average of their percentages', async () => {
    const preceptor = seedProfile('PRECEPTOR')
    const [a, b] = threeTrainees(preceptor.id)
    seedRecord(a.id, '2026-11-02')
    seedRecord(a.id, TODAY)
    seedRecord(b.id, TODAY)
    signInAs(preceptor)
    const result = await listMyTraineesAttendance()
    expect(result?.trainees.map((t) => t.percentage.percent)).toEqual([100, 50, 0])
    expect(result?.group).toEqual({ n: 3, hidden: false, percent: 50 })
  })

  it.each(NON_PRECEPTOR_CALLERS)('$label is refused by the guard', async ({ signIn }) => {
    signIn()
    expect(await refusal(listMyTraineesAttendance())).toMatch(/^\/nutrition\//)
  })
})

describe('getProgramAttendanceSummary: ADMIN, aggregates only', () => {
  it('two trainees: only the size; three: the average; never a name, id or record', async () => {
    const trainees = [seedTrainee('2026-01-01', { fullName: 'Asma' }), seedTrainee('2026-01-01', { fullName: 'Bilal' })]
    seedRecord(trainees[0].id, TODAY)
    signInAdmin()
    expect(await getProgramAttendanceSummary()).toEqual({ month: '2026-11', average: { n: 2, hidden: true } })

    trainees.push(seedTrainee('2026-01-01', { fullName: 'Chand' }))
    seedRecord(trainees[1].id, '2026-11-02')
    seedRecord(trainees[1].id, TODAY)
    seedRecord(trainees[2].id, TODAY, { voided: true })
    const summary = await getProgramAttendanceSummary()
    expect(summary).toEqual({ month: '2026-11', average: { n: 3, hidden: false, percent: 50 } })
    const text = JSON.stringify(summary)
    for (const trainee of trainees) {
      expect(text).not.toContain(trainee.id)
      expect(text).not.toContain(trainee.fullName)
    }
  })

  it("each trainee's working days use their own primary preceptor's holidays, plus the program's", async () => {
    const preceptor = seedProfile('PRECEPTOR')
    const trainees = [seedTrainee('2026-01-01'), seedTrainee('2026-01-01'), seedTrainee('2026-01-01')]
    seedAssignment(trainees[0].id, preceptor.id)
    seedHoliday(preceptor.id, '2026-11-02') // trainee 0 has one working day; the others two
    for (const trainee of trainees) seedRecord(trainee.id, TODAY)
    signInSuperAdmin()
    expect(await getProgramAttendanceSummary()).toEqual({ month: '2026-11', average: { n: 3, hidden: false, percent: 66.7 } })
  })

  it.each(NON_ADMIN_CALLERS)('$label is refused by the guard', async ({ signIn }) => {
    signIn()
    expect(await refusal(getProgramAttendanceSummary())).toMatch(/^\/nutrition\//)
  })
})

describe('listAttendanceRecordsForVoid: super_admin ONLY', () => {
  it('lists the month with trainee, date, status and a voided flag', async () => {
    const trainee = seedTrainee('2026-01-01', { fullName: 'Asma' })
    seedRecord(trainee.id, '2026-11-02', { voided: true })
    seedRecord(trainee.id, TODAY)
    seedRecord(trainee.id, '2026-10-30')
    signInSuperAdmin()
    expect(await listAttendanceRecordsForVoid()).toEqual({
      month: '2026-11',
      records: [
        { id: expect.any(String), traineeId: trainee.id, traineeName: 'Asma', workDate: '2026-11-02', status: 'PRESENT', voided: true },
        { id: expect.any(String), traineeId: trainee.id, traineeName: 'Asma', workDate: TODAY, status: 'PRESENT', voided: false },
      ],
    })
    expect(await listAttendanceRecordsForVoid('2026-13')).toBeNull()
  })

  it('a nutrition ADMIN (not super_admin) is sent to no-access; a preceptor and a trainee are refused', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    signInAdmin()
    expect(await refusal(listAttendanceRecordsForVoid())).toBe('/nutrition/no-access')
    signInAs(preceptor)
    expect(await refusal(listAttendanceRecordsForVoid())).toMatch(/^\/nutrition\//)
    signInAs(trainee)
    expect(await refusal(listAttendanceRecordsForVoid())).toMatch(/^\/nutrition\//)
    expect(fakePrisma.calls.filter((call) => call.op.startsWith('nutritionAttendanceRecord.'))).toEqual([])
  })
})

describe('voided holidays and missed-day records in the counts', () => {
  it('a voided holiday does not reduce working days; a staff-created record counts as present', async () => {
    const { trainee } = pair('2026-01-01')
    seedHoliday(null, '2026-11-02', 'Cancelled', true)
    seedRecord(trainee.id, '2026-11-02', { checkIn: null, status: 'OUT_OF_WINDOW_RECORDED_BY_STAFF' })
    signInAs(trainee)
    expect((await getMyAttendance())?.percentage).toEqual({ presentDays: 1, workingDays: 2, percent: 50 })
  })
})

describe('Step 8 UI loaders', () => {
  const kinds = (days: { day: string; kind: string }[] | undefined, from: string, to: string) =>
    (days ?? []).filter((d) => d.day >= from && d.day <= to).map((d) => `${d.day.slice(8)}:${d.kind}`)

  describe('getMyCheckInStatus: today, as the server will judge it', () => {
    it('no record yet at 10:00 on a working Tuesday: check-in open, check-out closed', async () => {
      const { trainee } = pair('2026-01-01')
      signInAs(trainee)
      expect(await getMyCheckInStatus()).toEqual({
        today: TODAY,
        now: '10:00',
        window: { weekdays: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '16:00' },
        holiday: false,
        workingDay: true,
        record: null,
        checkIn: { allowed: true, message: null },
        checkOut: { allowed: false, message: 'You have not checked in today.' },
      })
    })

    it('a program holiday closes check-in; a checked-in trainee may check out', async () => {
      const { trainee } = pair('2026-01-01')
      seedHoliday(null, TODAY)
      signInAs(trainee)
      const holiday = await getMyCheckInStatus()
      expect(holiday.holiday).toBe(true)
      expect(holiday.checkIn).toEqual({ allowed: false, message: 'Today is a holiday, so attendance is not recorded.' })

      const other = seedTrainee('2026-01-01')
      seedRecord(other.id, TODAY, { checkIn: '09:00' })
      signInAs(other)
      const status = await getMyCheckInStatus()
      expect(status.record).toMatchObject({ checkIn: '09:00', checkOut: null, status: 'PRESENT' })
      expect(status.checkIn.allowed).toBe(false)
      expect(status.checkOut).toEqual({ allowed: true, message: null })
    })

    it.each(NON_TRAINEE_CALLERS)('$label is refused by the guard', async ({ signIn }) => {
      signIn()
      expect(await refusal(getMyCheckInStatus())).toMatch(/^\/nutrition\//)
    })
  })

  describe('getMyAttendanceCalendar: the trainee strip never shows deleted records', () => {
    it('classifies each day: before start, off, present, staff, holiday, today pending, future', async () => {
      const { trainee } = pair('2026-11-02')
      seedRecord(trainee.id, '2026-11-02', { voided: true })
      seedRecord(trainee.id, '2026-11-02', { checkIn: '08:30' })
      seedHoliday(null, '2026-11-05')
      signInAs(trainee)
      const calendar = await getMyAttendanceCalendar()
      expect(calendar?.month).toBe('2026-11')
      expect(kinds(calendar?.days, '2026-11-01', '2026-11-08')).toEqual([
        '01:NOT_STARTED',
        '02:PRESENT',
        '03:PENDING',
        '04:FUTURE',
        '05:HOLIDAY',
        '06:FUTURE',
        '07:OFF',
        '08:OFF',
      ])
    })

    it('a day with only a deleted record is ABSENT for the trainee, never VOIDED; staff days show STAFF', async () => {
      const { trainee } = pair('2026-01-01')
      seedRecord(trainee.id, '2026-10-29', { voided: true })
      seedRecord(trainee.id, '2026-10-30', { checkIn: null, status: 'OUT_OF_WINDOW_RECORDED_BY_STAFF' })
      signInAs(trainee)
      const calendar = await getMyAttendanceCalendar('2026-10')
      expect(kinds(calendar?.days, '2026-10-29', '2026-10-30')).toEqual(['29:ABSENT', '30:STAFF'])
      expect(JSON.stringify(calendar)).not.toContain('Entered by mistake')
      expect(await getMyAttendanceCalendar('2026-13')).toBeNull()
    })
  })

  describe('getTraineeAttendanceCalendar: the primary preceptor sees deleted days greyed, never the reason', () => {
    it('VOIDED for a day with only a deleted record; null for anyone else', async () => {
      const { trainee, preceptor } = pair('2026-01-01')
      seedRecord(trainee.id, '2026-10-29', { voided: true })
      seedRecord(trainee.id, '2026-10-30')
      signInAs(preceptor)
      const calendar = await getTraineeAttendanceCalendar(trainee.id, '2026-10')
      expect(kinds(calendar?.days, '2026-10-29', '2026-10-30')).toEqual(['29:VOIDED', '30:PRESENT'])
      expect(JSON.stringify(calendar)).not.toContain('Entered by mistake')

      const stranger = seedProfile('PRECEPTOR')
      signInAs(stranger)
      expect(await getTraineeAttendanceCalendar(trainee.id, '2026-10')).toBeNull()
      signInAs(preceptor)
      expect(await getTraineeAttendanceCalendar('not-an-id', '2026-10')).toBeNull()
      const inactive = seedTrainee('2026-01-01', { isActive: false })
      seedAssignment(inactive.id, preceptor.id)
      expect(await getTraineeAttendanceCalendar(inactive.id, '2026-10')).toBeNull()
    })

    it.each(NON_PRECEPTOR_CALLERS)('$label is refused by the guard', async ({ signIn }) => {
      const trainee = seedTrainee('2026-01-01')
      signIn()
      expect(await refusal(getTraineeAttendanceCalendar(trainee.id))).toMatch(/^\/nutrition\//)
    })
  })

  describe('listMyAttendanceSettings and getProgramAttendanceSettings', () => {
    it("a preceptor gets their own schedules and live holidays, the program's holidays read-only, never another preceptor's", async () => {
      const preceptor = seedProfile('PRECEPTOR')
      const other = seedProfile('PRECEPTOR')
      seedSchedule(preceptor.id, { startTime: '09:00', endTime: '15:00', effectiveFrom: '2026-10-01' })
      seedSchedule(other.id, { startTime: '06:00', endTime: '12:00' })
      seedSchedule(null, { startTime: '07:30', endTime: '16:30' })
      seedHoliday(preceptor.id, '2026-11-09', 'Unit day')
      seedHoliday(preceptor.id, '2026-11-10', 'Removed', true)
      seedHoliday(other.id, '2026-11-11', 'Other unit')
      seedHoliday(null, '2026-11-12', 'Program day')
      signInAs(preceptor)
      const settings = await listMyAttendanceSettings()
      expect(settings.inForce).toEqual({ window: { weekdays: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '15:00' }, source: 'MINE' })
      expect(settings.schedules.map((s) => s.startTime)).toEqual(['09:00'])
      expect(settings.holidays.map((h) => h.name)).toEqual(['Unit day'])
      expect(settings.programHolidays.map((h) => h.name)).toEqual(['Program day'])
    })

    it('without their own schedule a preceptor sees the program default, then the built-in default', async () => {
      const preceptor = seedProfile('PRECEPTOR')
      signInAs(preceptor)
      expect((await listMyAttendanceSettings()).inForce.source).toBe('DEFAULT')
      seedSchedule(null, { startTime: '07:30', endTime: '16:30' })
      expect((await listMyAttendanceSettings()).inForce).toEqual({ window: { weekdays: [1, 2, 3, 4, 5], startTime: '07:30', endTime: '16:30' }, source: 'PROGRAM' })
    })

    it('the admin view has program rows only', async () => {
      const preceptor = seedProfile('PRECEPTOR')
      seedSchedule(preceptor.id, { startTime: '09:00' })
      seedSchedule(null, { startTime: '07:30' })
      seedHoliday(preceptor.id, '2026-11-09', 'Unit day')
      seedHoliday(null, '2026-11-12', 'Program day')
      seedHoliday(null, '2026-11-13', 'Removed', true)
      signInAdmin()
      const settings = await getProgramAttendanceSettings()
      expect(settings.schedules.map((s) => s.startTime)).toEqual(['07:30'])
      expect(settings.holidays.map((h) => h.name)).toEqual(['Program day'])
      expect(settings.programHolidays).toEqual([])
      expect(settings.inForce.source).toBe('PROGRAM')
    })

    it.each(NON_PRECEPTOR_CALLERS)('listMyAttendanceSettings: $label is refused by the guard', async ({ signIn }) => {
      signIn()
      expect(await refusal(listMyAttendanceSettings())).toMatch(/^\/nutrition\//)
    })

    it.each(NON_ADMIN_CALLERS)('getProgramAttendanceSettings: $label is refused by the guard', async ({ signIn }) => {
      signIn()
      expect(await refusal(getProgramAttendanceSettings())).toMatch(/^\/nutrition\//)
    })
  })
})
