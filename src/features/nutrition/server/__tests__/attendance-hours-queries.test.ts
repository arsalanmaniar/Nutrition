import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('../../auth/__tests__/fakes')).headersModule)
vi.mock('next/navigation', async () => (await import('../../auth/__tests__/fakes')).navigationModule)
vi.mock('@supabase/supabase-js', async () => (await import('../../auth/__tests__/fakes')).supabaseModule)
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./fake-prisma')).fakePrisma }))

import { resetState } from '../../auth/__tests__/fakes'
import { getMyAttendanceHours, getProgramAttendanceHours, listMyTraineesAttendanceHours } from '../queries/attendance-hours'
import { NON_ADMIN_CALLERS, NON_PRECEPTOR_CALLERS, NON_TRAINEE_CALLERS, seedAssignment, seedProfile, signInAdmin } from './actors'
import { NOW, TODAY, seedRecord, seedSchedule } from './attendance-fixtures'
import { pair, refusal, seedTrainee, signInAs } from './evaluation-fixtures'
import { fakePrisma } from './fake-prisma'

// The late / early / hours loaders. Today is Tuesday 3 November 2026, 10:00
// Karachi; the bars cover June to November 2026. Read only: no loader writes.

beforeEach(() => {
  resetState()
  fakePrisma.reset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
})

afterEach(() => {
  expect(fakePrisma.writes()).toEqual([])
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('getMyAttendanceHours: the trainee\'s own figures', () => {
  it('six months of totals and the month\'s days, own live records only', async () => {
    const { trainee } = pair('2026-01-01')
    const other = seedTrainee('2026-01-01')
    seedRecord(trainee.id, '2026-11-02', { checkIn: '08:30', checkOut: '16:00' }) // 30 late, 0 early (window ends 16:00), 7.5 h
    seedRecord(trainee.id, TODAY, { checkIn: '08:00' }) // no check-out yet: present, not measured
    seedRecord(trainee.id, '2026-10-30', { checkIn: '08:10', checkOut: '17:00' }) // October: 10 late
    seedRecord(trainee.id, '2026-10-29', { checkIn: '11:00', checkOut: '12:00', voided: true }) // voided: ignored
    seedRecord(other.id, '2026-11-02', { checkIn: '12:00', checkOut: '13:00' })
    signInAs(trainee)
    const mine = await getMyAttendanceHours()
    expect(mine?.month).toBe('2026-11')
    expect(mine?.months.map((m) => m.month)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'])
    expect(mine?.months[5].summary).toEqual({
      presentDays: 2,
      completeDays: 1,
      lateMinutes: 30,
      earlyMinutes: 0,
      hoursWorked: 7.5,
      averageLateMinutes: 30,
      averageEarlyMinutes: 0,
      averageHoursWorked: 7.5,
    })
    expect(mine?.months[4].summary).toMatchObject({ presentDays: 1, completeDays: 1, lateMinutes: 10, earlyMinutes: 0, hoursWorked: 8.83 })
    expect(mine?.days).toHaveLength(30)
    expect(mine?.days[1]).toEqual({ day: '2026-11-02', lateMinutes: 30, earlyMinutes: 0, hoursWorked: 7.5 })
    expect(mine?.days[2]).toEqual({ day: TODAY, lateMinutes: null, earlyMinutes: null, hoursWorked: null })
    // Weeks touching November, Monday to Sunday: the first one (26 Oct – 1 Nov) reaches into
    // October, so the 30 Oct record is counted there; voided 29 Oct is not.
    expect(mine?.weeks.map((w) => [w.weekStart, w.weekEnd])).toEqual([
      ['2026-10-26', '2026-11-01'],
      ['2026-11-02', '2026-11-08'],
      ['2026-11-09', '2026-11-15'],
      ['2026-11-16', '2026-11-22'],
      ['2026-11-23', '2026-11-29'],
      ['2026-11-30', '2026-12-06'],
    ])
    expect(mine?.weeks[0].summary).toMatchObject({ presentDays: 1, completeDays: 1, lateMinutes: 10, earlyMinutes: 0 })
    expect(mine?.weeks[1].summary).toMatchObject({ presentDays: 2, completeDays: 1, lateMinutes: 30, earlyMinutes: 0, averageHoursWorked: 7.5 })
    expect(mine?.weeks[2].summary).toMatchObject({ presentDays: 0, completeDays: 0, averageHoursWorked: null })
  })

  it('measures against the primary preceptor\'s schedule when there is one', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    seedSchedule(preceptor.id, { startTime: '09:00', endTime: '16:00' })
    seedRecord(trainee.id, '2026-11-02', { checkIn: '08:50', checkOut: '15:30' })
    signInAs(trainee)
    expect((await getMyAttendanceHours())?.days[1]).toEqual({ day: '2026-11-02', lateMinutes: 0, earlyMinutes: 30, hoursWorked: 6.67 })
  })

  it('a chosen month; a malformed month gives null', async () => {
    const { trainee } = pair('2026-01-01')
    signInAs(trainee)
    expect((await getMyAttendanceHours('2026-02'))?.months.map((m) => m.month)).toEqual(['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02'])
    expect(await getMyAttendanceHours('2026-13')).toBeNull()
  })

  it.each(NON_TRAINEE_CALLERS)('$label is refused by the guard', async ({ signIn }) => {
    signIn()
    expect(await refusal(getMyAttendanceHours())).toMatch(/^\/nutrition\//)
  })
})

describe('listMyTraineesAttendanceHours: the preceptor\'s ACTIVE primary trainees only', () => {
  it('own active trainees, each with their figures; not other preceptors\' or inactive ones', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    const otherPair = pair('2026-01-01')
    const inactive = seedTrainee('2026-01-01', { isActive: false })
    seedAssignment(inactive.id, preceptor.id)
    seedRecord(trainee.id, '2026-11-02', { checkIn: '08:15', checkOut: '17:00' })
    seedRecord(otherPair.trainee.id, '2026-11-02', { checkIn: '08:45', checkOut: '17:00' })
    signInAs(preceptor)
    const list = await listMyTraineesAttendanceHours()
    expect(list?.trainees.map((t) => t.traineeId)).toEqual([trainee.id])
    expect(list?.trainees[0].months[5].summary).toMatchObject({ completeDays: 1, lateMinutes: 15, earlyMinutes: 0 })
  })

  it.each(NON_PRECEPTOR_CALLERS)('$label is refused by the guard', async ({ signIn }) => {
    signIn()
    expect(await refusal(listMyTraineesAttendanceHours())).toMatch(/^\/nutrition\//)
  })
})

describe('getProgramAttendanceHours: ADMIN, averages only, hidden below 3', () => {
  it('2 trainees with complete days → every month and day hidden', async () => {
    const a = seedTrainee('2026-01-01')
    const b = seedTrainee('2026-01-01')
    seedRecord(a.id, '2026-11-02', { checkIn: '08:30', checkOut: '17:00' })
    seedRecord(b.id, '2026-11-02', { checkIn: '08:10', checkOut: '17:00' })
    signInAdmin()
    const program = await getProgramAttendanceHours()
    expect(program?.months[5]).toEqual({ month: '2026-11', group: { n: 2, hidden: true } })
    expect(program?.days[1]).toEqual({ day: '2026-11-02', n: 2, hoursWorked: null, lateMinutes: null, earlyMinutes: null })
    expect(program?.weeks[1]).toEqual({ weekStart: '2026-11-02', weekEnd: '2026-11-08', group: { n: 2, hidden: true } })
    expect(JSON.stringify(program)).not.toContain(a.id)
  })

  it('3 trainees → averages, using each trainee\'s own preceptor schedule; voided rows ignored', async () => {
    const preceptor = seedProfile('PRECEPTOR')
    const trainees = [seedTrainee('2026-01-01'), seedTrainee('2026-01-01'), seedTrainee('2026-01-01')]
    seedAssignment(trainees[0].id, preceptor.id)
    seedSchedule(preceptor.id, { startTime: '09:00', endTime: '17:00' })
    seedRecord(trainees[0].id, '2026-11-02', { checkIn: '09:30', checkOut: '17:00' }) // 30 late against 09:00
    seedRecord(trainees[1].id, '2026-11-02', { checkIn: '08:00', checkOut: '16:00' }) // on time: the window ends at 16:00
    seedRecord(trainees[2].id, '2026-11-02', { checkIn: '08:00', checkOut: '17:00' })
    seedRecord(trainees[2].id, '2026-11-03', { checkIn: '06:00', checkOut: '07:00', voided: true })
    signInAdmin()
    const program = await getProgramAttendanceHours()
    expect(program?.months[5]).toEqual({ month: '2026-11', group: { n: 3, hidden: false, lateMinutes: 10, earlyMinutes: 0, averageHoursWorked: 8.17 } })
    expect(program?.days[1]).toEqual({ day: '2026-11-02', n: 3, hoursWorked: 8.17, lateMinutes: 10, earlyMinutes: 0 })
    expect(program?.days[2]).toEqual({ day: TODAY, n: 0, hoursWorked: null, lateMinutes: null, earlyMinutes: null })
    expect(program?.weeks[1]).toEqual({
      weekStart: '2026-11-02',
      weekEnd: '2026-11-08',
      group: { n: 3, hidden: false, lateMinutes: 10, earlyMinutes: 0, averageHoursWorked: 8.17 },
    })
    expect(program?.weeks[0].group).toEqual({ n: 0, hidden: true })
    const text = JSON.stringify(program)
    for (const t of trainees) expect(text).not.toContain(t.id)
  })

  it.each(NON_ADMIN_CALLERS)('$label is refused by the guard', async ({ signIn }) => {
    signIn()
    expect(await refusal(getProgramAttendanceHours())).toMatch(/^\/nutrition\//)
  })
})
