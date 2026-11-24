import { type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('../../auth/__tests__/fakes')).headersModule)
vi.mock('next/navigation', async () => ({
  ...(await import('../../auth/__tests__/fakes')).navigationModule,
  // The client forms on the page need a router; nothing navigates here.
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}))
vi.mock('@supabase/supabase-js', async () => (await import('../../auth/__tests__/fakes')).supabaseModule)
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('../../server/__tests__/fake-prisma')).fakePrisma }))

import PreceptorAttendancePage from '@/app/(nutrition)/nutrition/(portal)/preceptor/attendance/page'
import { resetState } from '../../auth/__tests__/fakes'
import { seedAssignment, seedProfile } from '../../server/__tests__/actors'
import { NOW, seedRecord } from '../../server/__tests__/attendance-fixtures'
import { pair, seedTrainee, signInAs } from '../../server/__tests__/evaluation-fixtures'
import { fakePrisma } from '../../server/__tests__/fake-prisma'

// The preceptor attendance page renders the single late / early / hours chart
// for the selected trainee (the first one until another is chosen), and a
// late / early summary line under every trainee in the list. Before the fix,
// the chart showed only after clicking a trainee's name.

beforeEach(() => {
  resetState()
  fakePrisma.reset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW) // Tuesday 3 November 2026, 10:00 Karachi
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
})

afterEach(() => {
  expect(fakePrisma.writes()).toEqual([])
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

async function render(params: Record<string, string> = {}): Promise<string> {
  const page = PreceptorAttendancePage as unknown as (props: { searchParams: Promise<Record<string, string>> }) => Promise<ReactElement>
  return renderToStaticMarkup(await page({ searchParams: Promise.resolve(params) }))
}

describe('the preceptor attendance page', () => {
  it('shows the chart for the first trainee with no trainee chosen, and a summary line for every trainee', async () => {
    const { trainee, preceptor } = pair('2026-01-01') // "Ayesha Trainee"
    const second = seedTrainee('2026-01-01', { fullName: 'Zainab Trainee' })
    seedAssignment(second.id, preceptor.id)
    seedRecord(trainee.id, '2026-11-02', { checkIn: '08:30', checkOut: '15:00' }) // 30 late, 60 early
    signInAs(preceptor)
    const html = await render()

    // The single chart with its three range buttons.
    for (const label of ['Daily', 'Weekly', 'Monthly']) expect(html).toMatch(new RegExp(`<button type="button" aria-pressed="(true|false)"[^>]*>${label}</button>`))
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('Late arrival, early leaving and hours, November 2026')
    expect(html).toContain('Late and early-leave minutes and hours, Ayesha Trainee')
    // The screen-reader list of the Daily range carries the measured day.
    expect(html).toContain('Mon 2 Nov: late 30 min, left early 1 h 00 min, 6.5 h per day')
    // A summary line for each trainee, also the one with no measured day.
    expect(html).toContain('Late 30 min, left early 1 h 00 min this month, over 1 measured day')
    expect(html).toContain('Late 0 min, left early 0 min this month (no day with both a check-in and a check-out yet)')
    // The late / extra-time bar chart: group averages over the 2 trainees, so every bucket is hidden.
    expect(html).toContain('Your trainees&#x27; late arrival and extra time, November 2026')
    expect(html).toContain('Mon 2 Nov: Shown from 3 trainees')
    expect(html).not.toContain('extra time 0 min')
  })

  it("shows the chosen trainee's chart when one is chosen", async () => {
    const { preceptor } = pair('2026-01-01')
    const second = seedTrainee('2026-01-01', { fullName: 'Zainab Trainee' })
    seedAssignment(second.id, preceptor.id)
    seedRecord(second.id, '2026-11-02', { checkIn: '08:10', checkOut: '16:00' })
    signInAs(preceptor)
    const html = await render({ trainee: second.id })
    expect(html).toContain('Late and early-leave minutes and hours, Zainab Trainee')
    expect(html).toContain('Mon 2 Nov: late 10 min, left early 0 min')
  })

  it('a preceptor with no trainees sees the empty state and no chart', async () => {
    const preceptor = seedProfile('PRECEPTOR')
    signInAs(preceptor)
    const html = await render()
    expect(html).toContain('You are not the primary preceptor of any trainee.')
    expect(html).not.toContain('aria-pressed')
  })
})
