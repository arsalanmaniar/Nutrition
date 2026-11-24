import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('../../auth/__tests__/fakes')).headersModule)
vi.mock('next/navigation', async () => (await import('../../auth/__tests__/fakes')).navigationModule)
vi.mock('@supabase/supabase-js', async () => (await import('../../auth/__tests__/fakes')).supabaseModule)
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./fake-prisma')).fakePrisma }))

import { resetState } from '../../auth/__tests__/fakes'
import { getMyCertificate, getMyPortfolio, getProgramAnalytics, getProgramMetricsCsv, getTraineeSummary } from '../queries/portfolio'
import { NON_ADMIN_CALLERS, NON_PRECEPTOR_CALLERS, NON_TRAINEE_CALLERS, seedAssignment, seedProfile, signInAdmin } from './actors'
import { NOW, pair, refusal, seedTrainee, signInAs } from './evaluation-fixtures'
import { fakePrisma } from './fake-prisma'
import { MONTH_12_START, seedAllEpas, seedCredential, seedScoredForm } from './portfolio-fixtures'
import { seedCaseLog, seedPlacement, seedWpba } from './wpba-fixtures'

// The Step 7 loaders: own data only for the trainee, active primary only for
// the preceptor, aggregates only (min 3) for ADMIN, and a CSV with no names
// or ids.

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

describe('getMyPortfolio (trainee, own data only)', () => {
  it('own submitted MDGRS, case log counts, checklist, EPA timeline and summative status; nothing of another trainee', async () => {
    const { trainee, preceptor } = pair(MONTH_12_START)
    seedScoredForm('FORM_3_1', trainee.id, 24, 30, 'M02')
    seedScoredForm('FORM_3_1', trainee.id, 26, 30, 'M03')
    seedScoredForm('FORM_3_1', trainee.id, 10, 30, 'M04', 'DRAFT')
    seedCaseLog(trainee.id, 'APPROVED', 'C-1')
    seedCaseLog(trainee.id, 'DRAFT', 'C-2')
    seedAllEpas(trainee.id, preceptor.id, 'E4')
    const { trainee: other, preceptor: otherPreceptor } = pair(MONTH_12_START)
    seedScoredForm('FORM_3_1', other.id, 5, 30, 'M02')
    seedCaseLog(other.id, 'APPROVED', 'C-9')
    seedWpba('MINI_CEX', other.id, otherPreceptor.id)
    signInAs(trainee)

    const portfolio = (await getMyPortfolio())!
    expect(portfolio.traineeId).toBe(trainee.id)
    expect(portfolio.mdgrs).toEqual([
      { point: 'M02', total: 24, maxScore: 30 },
      { point: 'M03', total: 26, maxScore: 30 },
    ])
    expect(portfolio.caseLogs).toEqual({ DRAFT: 1, SUBMITTED: 0, APPROVED: 1, REJECTED: 0 })
    expect(portfolio.checklist).toBeNull()
    expect(portfolio.epaTimeline).toHaveLength(5)
    expect(portfolio.summative.met).toBe(true)
    expect(portfolio.reachedMonth12).toBe(true)
    expect(portfolio.wpba.types.every((type) => type.count === 0)).toBe(true)
    expect(JSON.stringify(portfolio)).not.toContain(other.id)
  })

  it.each(NON_TRAINEE_CALLERS)('$label is refused by the guard', async ({ signIn }) => {
    signIn()
    expect(await refusal(getMyPortfolio())).toMatch(/^\/nutrition\//)
  })
})

describe('getTraineeSummary (preceptor, active primary only)', () => {
  it('the primary preceptor gets the summary; another, a former and a rotation preceptor get null', async () => {
    const { trainee, preceptor } = pair(MONTH_12_START)
    signInAs(preceptor)
    expect((await getTraineeSummary(trainee.id))?.traineeId).toBe(trainee.id)
    const former = seedProfile('PRECEPTOR')
    seedAssignment(trainee.id, former.id, false)
    const rotation = seedProfile('PRECEPTOR')
    seedPlacement(trainee.id, rotation.id, '2026-04-01')
    for (const caller of [seedProfile('PRECEPTOR'), former, rotation]) {
      signInAs(caller)
      expect(await getTraineeSummary(trainee.id)).toBeNull()
    }
    expect(await getTraineeSummary('not-an-id')).toBeNull()
  })

  it.each(NON_PRECEPTOR_CALLERS)('$label is refused by the guard', async ({ signIn }) => {
    const { trainee } = pair(MONTH_12_START)
    signIn()
    expect(await refusal(getTraineeSummary(trainee.id))).toMatch(/^\/nutrition\//)
  })
})

describe('getMyCertificate (trainee, own only)', () => {
  it('own newest credential; nothing for a trainee without one', async () => {
    const { trainee } = pair(MONTH_12_START)
    const { trainee: other } = pair(MONTH_12_START)
    seedCredential(other.id, { verificationId: 'O'.repeat(43) })
    signInAs(trainee)
    expect(await getMyCertificate()).toBeNull()
    seedCredential(trainee.id, { verificationId: 'M'.repeat(43) })
    expect(await getMyCertificate()).toMatchObject({ traineeName: 'Ayesha Trainee', verificationId: 'M'.repeat(43), revoked: false })
  })

  it.each(NON_TRAINEE_CALLERS)('$label is refused by the guard', async ({ signIn }) => {
    signIn()
    expect(await refusal(getMyCertificate())).toMatch(/^\/nutrition\//)
  })
})

describe('getProgramAnalytics and the CSV (ADMIN, aggregates only, min 3)', () => {
  function trainees(n: number) {
    const preceptor = seedProfile('PRECEPTOR')
    return Array.from({ length: n }, (_, i) => {
      const trainee = seedTrainee(MONTH_12_START, { fullName: `Named Trainee ${i + 1}` })
      seedScoredForm('FORM_1_1', trainee.id, 30 + i * 3, 60)
      seedScoredForm('FORM_3_1', trainee.id, 20 + i, 30)
      seedWpba('MINI_CEX', trainee.id, preceptor.id, { total: 30 + i })
      seedAllEpas(trainee.id, preceptor.id, i === 0 ? 'E3' : 'E4')
      return trainee
    })
  }

  it('2 trainees: every group shows "not enough data" (only its size)', async () => {
    trainees(2)
    signInAdmin()
    const analytics = await getProgramAnalytics()
    expect(analytics.traineesByStatus.find((entry) => entry.status === 'IN_TRAINING')!.count).toEqual({ n: 2, hidden: true })
    expect(analytics.level1.form11Percent).toEqual({ n: 2, hidden: true })
    expect(analytics.level3.mdgrsAverage).toEqual({ n: 2, hidden: true })
    expect(analytics.level2.find((entry) => entry.type === 'MINI_CEX')!.averageTotal).toEqual({ n: 2, hidden: true })
    expect(analytics.level4.summativeReached).toEqual({ n: 2, hidden: true })
    for (const entry of analytics.level4.epaLevels) expect(entry.count.hidden).toBe(true)
  })

  it('3 trainees: averages and counts appear; no name or id anywhere', async () => {
    const seeded = trainees(3)
    signInAdmin()
    const analytics = await getProgramAnalytics()
    expect(analytics.traineesByStatus.find((entry) => entry.status === 'IN_TRAINING')!.count).toEqual({ n: 3, hidden: false, value: 3 })
    expect(analytics.level1.form11Percent).toEqual({ n: 3, hidden: false, value: 55 })
    expect(analytics.level3.mdgrsAverage).toEqual({ n: 3, hidden: false, value: 21 })
    expect(analytics.level3.miniCexAverage).toEqual({ n: 3, hidden: false, value: 31 })
    expect(analytics.level4.summativeReached).toEqual({ n: 3, hidden: false, value: 2 })
    const text = JSON.stringify(analytics)
    expect(text).not.toMatch(/Named Trainee|cdnep\.test/)
    for (const trainee of seeded) expect(text).not.toContain(trainee.id)
  })

  it('the Form 1.3 average needs 3 responses', async () => {
    const preceptor = seedProfile('PRECEPTOR')
    seedScoredForm('FORM_1_3', preceptor.id, 100, 132)
    seedScoredForm('FORM_1_3', preceptor.id, 110, 132)
    signInAdmin()
    expect((await getProgramAnalytics()).level1.form13Percent).toEqual({ n: 2, hidden: true })
    seedScoredForm('FORM_1_3', preceptor.id, 120, 132)
    expect((await getProgramAnalytics()).level1.form13Percent).toMatchObject({ n: 3, hidden: false })
  })

  it('the CSV has metric, group and value columns only, and no names or ids', async () => {
    const seeded = trainees(3)
    signInAdmin()
    const csv = await getProgramMetricsCsv()
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('metric,group,value')
    for (const line of lines) expect(line.split(',')).toHaveLength(3)
    expect(csv).not.toMatch(/Named Trainee|cdnep\.test|name|email|traineeId/i)
    for (const trainee of seeded) expect(csv).not.toContain(trainee.id)
  })

  it.each(NON_ADMIN_CALLERS)('$label is refused by both admin loaders', async ({ signIn }) => {
    signIn()
    expect(await refusal(getProgramAnalytics())).toMatch(/^\/nutrition\//)
    expect(await refusal(getProgramMetricsCsv())).toMatch(/^\/nutrition\//)
  })
})
