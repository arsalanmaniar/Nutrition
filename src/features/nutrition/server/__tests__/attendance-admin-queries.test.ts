import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('../../auth/__tests__/fakes')).headersModule)
vi.mock('next/navigation', async () => (await import('../../auth/__tests__/fakes')).navigationModule)
vi.mock('@supabase/supabase-js', async () => (await import('../../auth/__tests__/fakes')).supabaseModule)
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./fake-prisma')).fakePrisma }))

import { resetState } from '../../auth/__tests__/fakes'
import { getTraineeRecordsForAdmin, listPreceptorAttendanceHolidays } from '../queries/attendance-admin'
import { NON_ADMIN_CALLERS, seedProfile, signInAdmin, signInSuperAdmin } from './actors'
import { NOW, TODAY, seedHoliday, seedRecord } from './attendance-fixtures'
import { pair, refusal, seedTrainee } from './evaluation-fixtures'
import { fakePrisma } from './fake-prisma'

// The nutrition ADMIN's attendance loaders: one trainee's records and every
// preceptor's holidays. Today is Tuesday 3 November 2026, 10:00 Karachi.
// Read only, never a voided row, a void reason or a staff reason.

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

describe('getTraineeRecordsForAdmin: any trainee, for a nutrition ADMIN', () => {
  it('the month\'s live records with Karachi times, for a trainee the admin is not assigned to; voided rows left out', async () => {
    const { trainee } = pair('2026-01-01')
    seedRecord(trainee.id, '2026-11-02', { checkIn: '08:30', checkOut: '16:45' })
    seedRecord(trainee.id, TODAY, { checkIn: '09:05' })
    seedRecord(trainee.id, '2026-11-01', { voided: true })
    seedRecord(trainee.id, '2026-10-30') // last month
    signInAdmin()
    expect(await getTraineeRecordsForAdmin(trainee.id)).toEqual({
      month: '2026-11',
      traineeId: trainee.id,
      traineeName: 'Ayesha Trainee',
      days: [
        { id: expect.any(String), workDate: '2026-11-02', checkIn: '08:30', checkOut: '16:45', status: 'PRESENT' },
        { id: expect.any(String), workDate: TODAY, checkIn: '09:05', checkOut: null, status: 'PRESENT' },
      ],
    })
    expect((await getTraineeRecordsForAdmin(trainee.id, '2026-10'))?.days.map((d) => d.workDate)).toEqual(['2026-10-30'])
  })

  it('never returns a staff reason or a void reason', async () => {
    const trainee = seedTrainee('2026-01-01')
    seedRecord(trainee.id, '2026-11-02', { status: 'OUT_OF_WINDOW_RECORDED_BY_STAFF' })
    seedRecord(trainee.id, TODAY, { voided: true })
    signInSuperAdmin()
    const text = JSON.stringify(await getTraineeRecordsForAdmin(trainee.id))
    expect(text).not.toMatch(/staffReason|voidReason|Entered by mistake/)
  })

  it('null for a preceptor id, an unknown or malformed id, and a malformed month', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    signInAdmin()
    expect(await getTraineeRecordsForAdmin(preceptor.id)).toBeNull()
    expect(await getTraineeRecordsForAdmin('0b0c3e1e-6c1b-4c39-9a37-3f5c2f1f9a11')).toBeNull()
    expect(await getTraineeRecordsForAdmin('not-an-id')).toBeNull()
    expect(await getTraineeRecordsForAdmin(trainee.id, '2026-13')).toBeNull()
  })

  it.each(NON_ADMIN_CALLERS)('$label is refused by the guard', async ({ signIn }) => {
    const trainee = seedTrainee('2026-01-01')
    signIn()
    expect(await refusal(getTraineeRecordsForAdmin(trainee.id))).toMatch(/^\/nutrition\//)
  })
})

describe('listPreceptorAttendanceHolidays: every preceptor\'s live holidays', () => {
  it('grouped by preceptor name; program holidays and voided ones left out', async () => {
    const zara = seedProfile('PRECEPTOR', { fullName: 'Dr Zara' })
    const ali = seedProfile('PRECEPTOR', { fullName: 'Dr Ali' })
    seedHoliday(zara.id, '2026-11-12', 'Unit day')
    seedHoliday(ali.id, '2026-11-20', 'Audit day')
    seedHoliday(ali.id, '2026-11-10', 'Away day')
    seedHoliday(ali.id, '2026-11-11', 'Cancelled', true)
    seedHoliday(null, '2026-11-09', 'Program day')
    signInAdmin()
    expect(await listPreceptorAttendanceHolidays()).toEqual([
      {
        preceptorId: ali.id,
        preceptorName: 'Dr Ali',
        holidays: [
          { id: expect.any(String), workDate: '2026-11-10', name: 'Away day' },
          { id: expect.any(String), workDate: '2026-11-20', name: 'Audit day' },
        ],
      },
      { preceptorId: zara.id, preceptorName: 'Dr Zara', holidays: [{ id: expect.any(String), workDate: '2026-11-12', name: 'Unit day' }] },
    ])
  })

  it('an empty list when there are none', async () => {
    seedHoliday(null, '2026-11-09')
    signInAdmin()
    expect(await listPreceptorAttendanceHolidays()).toEqual([])
  })

  it.each(NON_ADMIN_CALLERS)('$label is refused by the guard', async ({ signIn }) => {
    signIn()
    expect(await refusal(listPreceptorAttendanceHolidays())).toMatch(/^\/nutrition\//)
  })
})
