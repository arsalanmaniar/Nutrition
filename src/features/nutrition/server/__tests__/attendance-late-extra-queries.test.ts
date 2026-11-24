import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('../../auth/__tests__/fakes')).headersModule)
vi.mock('next/navigation', async () => (await import('../../auth/__tests__/fakes')).navigationModule)
vi.mock('@supabase/supabase-js', async () => (await import('../../auth/__tests__/fakes')).supabaseModule)
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./fake-prisma')).fakePrisma }))

import { resetState } from '../../auth/__tests__/fakes'
import { getMyAttendanceHours, getProgramAttendanceHours, listMyTraineesAttendanceHours } from '../queries/attendance-hours'
import { seedAssignment, signInAdmin } from './actors'
import { NOW, TODAY, seedRecord } from './attendance-fixtures'
import { pair, seedTrainee, signInAs } from './evaluation-fixtures'
import { fakePrisma } from './fake-prisma'

// The late / extra-time figures the three hours loaders return. Today is
// Tuesday 3 November 2026, 10:00 Karachi; the working hours are the config
// default, 08:00 to 16:00. Read only.

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

describe('late / extra time in the hours loaders', () => {
  it("a trainee: their own minutes per day; no check-out yet → no extra; voided ignored", async () => {
    const { trainee } = pair('2026-01-01')
    seedRecord(trainee.id, '2026-11-02', { checkIn: '08:06', checkOut: '18:14' })
    seedRecord(trainee.id, TODAY, { checkIn: '08:30' })
    seedRecord(trainee.id, '2026-10-30', { checkIn: '07:00', checkOut: '20:00', voided: true })
    signInAs(trainee)
    const mine = await getMyAttendanceHours()
    expect(mine?.lateExtra.days.slice(1, 3)).toEqual([
      { day: '2026-11-02', lateMinutes: 6, extraMinutes: 134 },
      { day: TODAY, lateMinutes: 30, extraMinutes: null },
    ])
    expect(mine?.lateExtra.months[5].totals).toEqual({ lateDays: 2, lateMinutes: 36, extraDays: 1, extraMinutes: 134 })
    expect(mine?.lateExtra.months[4].totals).toEqual({ lateDays: 0, lateMinutes: 0, extraDays: 0, extraMinutes: 0 })
  })

  it("a preceptor: group averages over their trainees only, hidden below 3", async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    const second = seedTrainee('2026-01-01')
    seedAssignment(second.id, preceptor.id)
    seedRecord(trainee.id, '2026-11-02', { checkIn: '08:10', checkOut: '18:14' })
    seedRecord(second.id, '2026-11-02', { checkIn: '08:20', checkOut: '16:10' })
    signInAs(preceptor)
    const two = await listMyTraineesAttendanceHours()
    expect(two?.lateExtraGroup.days[1].group).toEqual({ late: { n: 2, value: null }, extra: { n: 2, value: null } })
    expect(two?.lateExtraGroup.months[5].group).toEqual({ late: { n: 2, value: null }, extra: { n: 2, value: null } })

    const third = seedTrainee('2026-01-01')
    seedAssignment(third.id, preceptor.id)
    seedRecord(third.id, '2026-11-02', { checkIn: '08:00', checkOut: '17:00' })
    const outsider = pair('2026-01-01').trainee // another preceptor's trainee: not counted
    seedRecord(outsider.id, '2026-11-02', { checkIn: '11:00', checkOut: '23:00' })
    const three = await listMyTraineesAttendanceHours()
    expect(three?.lateExtraGroup.days[1].group).toEqual({ late: { n: 3, value: 10 }, extra: { n: 3, value: 68 } })
    expect(JSON.stringify(three?.lateExtraGroup)).not.toContain(trainee.id)
  })

  it('an ADMIN: program averages, hidden below 3, no ids', async () => {
    const trainees = [seedTrainee('2026-01-01'), seedTrainee('2026-01-01'), seedTrainee('2026-01-01')]
    seedRecord(trainees[0].id, '2026-11-02', { checkIn: '08:10', checkOut: '18:14' })
    seedRecord(trainees[1].id, '2026-11-02', { checkIn: '08:20', checkOut: '16:10' })
    seedRecord(trainees[2].id, '2026-11-02', { checkIn: '08:00' }) // no check-out: late only
    signInAdmin()
    const program = await getProgramAttendanceHours()
    expect(program?.lateExtra.days[1]).toEqual({ day: '2026-11-02', group: { late: { n: 3, value: 10 }, extra: { n: 2, value: null } } })
    expect(program?.lateExtra.weeks[1].group).toEqual({ late: { n: 3, value: 10 }, extra: { n: 2, value: null } })
    expect(JSON.stringify(program?.lateExtra)).not.toMatch(new RegExp(trainees.map((t) => t.id).join('|')))
  })
})
