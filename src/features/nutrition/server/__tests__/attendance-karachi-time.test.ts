import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('../../auth/__tests__/fakes')).headersModule)
vi.mock('next/navigation', async () => (await import('../../auth/__tests__/fakes')).navigationModule)
vi.mock('@supabase/supabase-js', async () => (await import('../../auth/__tests__/fakes')).supabaseModule)
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./fake-prisma')).fakePrisma }))

import { resetState } from '../../auth/__tests__/fakes'
import { karachiInstant, karachiTime } from '../attendance-core'
import { getMyAttendance, getMyCheckInStatus } from '../queries/attendance'
import { getTraineeRecordsForAdmin } from '../queries/attendance-admin'
import { signInAdmin } from './actors'
import { NOW } from './attendance-fixtures'
import { pair, signInAs } from './evaluation-fixtures'
import { fakePrisma } from './fake-prisma'

// Every time on the attendance pages is Karachi wall-clock time, "HH:MM",
// 24-hour (Asia/Karachi is UTC+5 all year). The loaders convert stored
// instants with karachiTime; nothing formats a time in UTC or in the server's
// own zone. These cases sit around midnight UTC (05:00 Karachi) and Karachi
// midnight (19:00 UTC the day before), where a wrong zone shows a wrong day
// or hour.

describe('karachiTime: an instant as Karachi "HH:MM", 24-hour', () => {
  const cases: [string, string, string][] = [
    ['2026-11-02T18:59:59Z', '23:59', 'one second before Karachi midnight'],
    ['2026-11-02T19:00:00Z', '00:00', 'Karachi midnight is 00:00, never 24:00'],
    ['2026-11-02T19:30:00Z', '00:30', 'just after Karachi midnight'],
    ['2026-11-02T23:59:59Z', '04:59', 'one second before midnight UTC'],
    ['2026-11-03T00:00:00Z', '05:00', 'midnight UTC'],
    ['2026-11-03T00:05:00Z', '05:05', 'just after midnight UTC'],
    ['2026-11-03T03:21:00Z', '08:21', 'a morning check-in'],
    ['2026-11-03T13:14:00Z', '18:14', 'an evening check-out, 24-hour'],
  ]
  for (const [iso, expected, why] of cases) it(`${iso} → ${expected} (${why})`, () => expect(karachiTime(new Date(iso))).toBe(expected))

  it('does not depend on the machine\'s time zone', () => {
    const saved = process.env.TZ
    try {
      for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo', 'Asia/Karachi']) {
        process.env.TZ = zone
        expect({ zone, times: cases.map(([iso]) => karachiTime(new Date(iso))) }).toEqual({ zone, times: cases.map(([, expected]) => expected) })
      }
    } finally {
      if (saved === undefined) delete process.env.TZ
      else process.env.TZ = saved
    }
  })

  it('round trip: a Karachi time on a day back to the same "HH:MM"', () => {
    expect(karachiInstant('2026-11-03', '00:30').toISOString()).toBe('2026-11-02T19:30:00.000Z')
    expect(karachiInstant('2026-11-03', '05:05').toISOString()).toBe('2026-11-03T00:05:00.000Z')
    for (const time of ['00:00', '00:30', '04:59', '05:00', '08:21', '16:09', '18:14', '23:59']) expect(karachiTime(karachiInstant('2026-11-03', time))).toBe(time)
  })
})

describe('the loaders show stored instants as Karachi times', () => {
  beforeEach(() => {
    resetState()
    fakePrisma.reset()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  /** A record on 3 Nov (Karachi) from 00:30 to 05:05 Karachi: both instants are on 2 or 3 Nov in UTC. */
  function seedNearMidnight(traineeId: string) {
    fakePrisma.seed('nutritionAttendanceRecord', {
      traineeId,
      workDate: new Date('2026-11-03T00:00:00Z'),
      checkInAt: new Date('2026-11-02T19:30:00Z'),
      checkOutAt: new Date('2026-11-03T00:05:00Z'),
      status: 'OUT_OF_WINDOW_RECORDED_BY_STAFF',
      createdBy: 'auth-seed',
    })
  }

  it('the admin record list (any nutrition ADMIN)', async () => {
    const { trainee } = pair('2026-01-01')
    seedNearMidnight(trainee.id)
    signInAdmin()
    const records = await getTraineeRecordsForAdmin(trainee.id)
    expect(records?.days.map((d) => [d.workDate, d.checkIn, d.checkOut])).toEqual([['2026-11-03', '00:30', '05:05']])
  })

  it("the trainee's own records", async () => {
    const { trainee } = pair('2026-01-01')
    seedNearMidnight(trainee.id)
    signInAs(trainee)
    const mine = await getMyAttendance()
    expect(mine?.days.map((d) => [d.workDate, d.checkIn, d.checkOut])).toEqual([['2026-11-03', '00:30', '05:05']])
  })

  it("the check-in panel's clock just after Karachi midnight is 00:00 on the new Karachi day", async () => {
    const { trainee } = pair('2026-01-01')
    vi.setSystemTime(new Date('2026-11-02T19:00:30Z'))
    signInAs(trainee)
    const status = await getMyCheckInStatus()
    expect([status.today, status.now]).toEqual(['2026-11-03', '00:00'])
  })
})
