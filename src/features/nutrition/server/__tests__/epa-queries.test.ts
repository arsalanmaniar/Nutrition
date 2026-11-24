import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('../../auth/__tests__/fakes')).headersModule)
vi.mock('next/navigation', async () => (await import('../../auth/__tests__/fakes')).navigationModule)
vi.mock('@supabase/supabase-js', async () => (await import('../../auth/__tests__/fakes')).supabaseModule)
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./fake-prisma')).fakePrisma }))

import { resetState } from '../../auth/__tests__/fakes'
import { getMyEpaHistory, listMyTraineesEpa } from '../queries/epa'
import { getTraineeStandardsChecklist } from '../queries/standards-checklist'
import { NON_PRECEPTOR_CALLERS, NON_TRAINEE_CALLERS, seedAssignment, seedProfile } from './actors'
import { MONTH_9_START, seedChecklist, seedEpa } from './epa-fixtures'
import { NOW, pair, refusal, seedTrainee, signInAs } from './evaluation-fixtures'
import { fakePrisma } from './fake-prisma'
import { seedCaseLog, seedPlacement, seedWpba } from './wpba-fixtures'

// The Step 6a loaders: the preceptor's EPA dashboard (ACTIVE primary
// trainees only), the trainee's own EPA history, and the Month 9 checklist
// for the primary preceptor with the trainee's own evidence options only.

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

describe('listMyTraineesEpa: the preceptor sees only their ACTIVE primary trainees', () => {
  it('each EPA has its newest level as current and the full history, newest first', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    seedEpa(trainee.id, preceptor.id, { level: 'E2', millerLevel: 'SHOWS_HOW', assessedOn: '2026-02-01' })
    seedEpa(trainee.id, preceptor.id, { level: 'E3', millerLevel: 'DOES', assessedOn: '2026-04-01', notes: 'Steady.' })
    seedEpa(trainee.id, preceptor.id, { epaName: 'EPA_03', level: 'E1', millerLevel: 'KNOWS', assessedOn: '2026-03-01' })
    signInAs(preceptor)

    const [dashboard, ...rest] = await listMyTraineesEpa()
    expect(rest).toEqual([])
    expect(dashboard).toMatchObject({ traineeId: trainee.id, traineeName: 'Ayesha Trainee' })
    const epa1 = dashboard.epas.find((epa) => epa.key === 'EPA_01')!
    expect(epa1.current).toMatchObject({ level: 'E3', millerLevel: 'DOES', assessedOn: '2026-04-01', notes: 'Steady.', assessorName: 'Dr Primary' })
    expect(epa1.history.map((entry) => entry.level)).toEqual(['E3', 'E2'])
    expect(dashboard.epas.find((epa) => epa.key === 'EPA_03')!.current).toMatchObject({ level: 'E1' })
    expect(dashboard.epas.find((epa) => epa.key === 'EPA_02')).toEqual({ key: 'EPA_02', label: 'EPA 2 (pending)', current: null, history: [] })
  })

  it("another preceptor's trainee, a former primary trainee and a rotation trainee are not listed", async () => {
    const { trainee: mine, preceptor } = pair('2026-01-01')
    const { trainee: theirs, preceptor: them } = pair('2026-01-01')
    seedEpa(theirs.id, them.id)
    const former = seedTrainee('2026-01-01')
    seedAssignment(former.id, preceptor.id, false)
    seedEpa(former.id, preceptor.id)
    const rotationTrainee = seedTrainee('2026-01-01')
    seedPlacement(rotationTrainee.id, preceptor.id, '2026-04-01')
    seedEpa(rotationTrainee.id, them.id)
    signInAs(preceptor)

    const result = await listMyTraineesEpa()
    expect(result.map((row) => row.traineeId)).toEqual([mine.id])
    expect(JSON.stringify(result)).not.toContain(theirs.id)
  })

  it('a preceptor with no active trainees gets an empty list', async () => {
    signInAs(seedProfile('PRECEPTOR'))
    expect(await listMyTraineesEpa()).toEqual([])
  })

  it.each(NON_PRECEPTOR_CALLERS)('$label is refused by the guard', async ({ signIn }) => {
    signIn()
    expect(await refusal(listMyTraineesEpa())).toMatch(/^\/nutrition\//)
  })
})

describe('getMyEpaHistory: the trainee reads only their own', () => {
  it("returns the caller's rows and nobody else's", async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    const { trainee: other } = pair('2026-01-01')
    seedEpa(trainee.id, preceptor.id, { level: 'E2' })
    seedEpa(other.id, preceptor.id, { epaName: 'EPA_02', level: 'E5', millerLevel: 'DOES' })
    signInAs(trainee)

    const epas = await getMyEpaHistory()
    expect(epas.flatMap((epa) => epa.history).map((entry) => entry.level)).toEqual(['E2'])
    const lookup = fakePrisma.calls.find((call) => call.op === 'nutritionEpaAssessment.findMany')!
    expect((lookup.args as { where: unknown }).where).toEqual({ traineeId: trainee.id })
  })

  it('a retired EPA key that still has rows is shown after the configured ones', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    seedEpa(trainee.id, preceptor.id, { epaName: 'OLD_EPA' })
    signInAs(trainee)
    const epas = await getMyEpaHistory()
    expect(epas.at(-1)).toMatchObject({ key: 'OLD_EPA', label: 'OLD_EPA' })
  })

  it.each(NON_TRAINEE_CALLERS)('$label is refused by the guard', async ({ signIn }) => {
    signIn()
    expect(await refusal(getMyEpaHistory())).toMatch(/^\/nutrition\//)
  })
})

describe("getTraineeStandardsChecklist: the primary preceptor only, with the trainee's own evidence", () => {
  it("shows the checklist with labels and only this trainee's eligible records as evidence options", async () => {
    const { trainee, preceptor } = pair(MONTH_9_START)
    const wpba = seedWpba('MINI_CEX', trainee.id, preceptor.id, { assessedOn: '2026-04-10' })
    const log = seedCaseLog(trainee.id, 'APPROVED', 'C-2026-021')
    seedCaseLog(trainee.id, 'DRAFT', 'C-2026-022')
    const other = seedTrainee(MONTH_9_START)
    seedAssignment(other.id, preceptor.id)
    seedWpba('DOPS', other.id, preceptor.id)
    seedCaseLog(other.id, 'APPROVED', 'C-2026-099')
    seedChecklist(trainee.id, 'DRAFT', { sop_diagnosis: { rating: 'MEETS', evidence: { kind: 'WPBA', id: wpba.id } } })
    signInAs(preceptor)

    const view = await getTraineeStandardsChecklist(trainee.id as string)
    expect(view).toMatchObject({ traineeId: trainee.id, opensOn: '2026-04-01', checklist: { status: 'DRAFT', submittedAt: null } })
    expect(view!.evidenceOptions).toEqual([
      { kind: 'CASE_LOG', id: log.id, label: 'C-2026-021' },
      { kind: 'WPBA', id: wpba.id, label: 'Mini-CEX, 2026-04-10' },
    ])
    const diagnosis = view!.checklist!.standards.find((standard) => standard.key === 'sop_diagnosis')!
    expect(diagnosis).toEqual({
      key: 'sop_diagnosis',
      label: 'Diagnosis',
      group: 'SOP',
      rating: 'MEETS',
      ratingLabel: 'Meets',
      evidence: { kind: 'WPBA', id: wpba.id, label: 'Mini-CEX, 2026-04-10' },
    })
    expect(view!.checklist!.standards).toHaveLength(10)
  })

  it('no checklist yet: checklist is null and the opening day is given', async () => {
    const { trainee, preceptor } = pair(MONTH_9_START)
    signInAs(preceptor)
    expect(await getTraineeStandardsChecklist(trainee.id as string)).toMatchObject({ checklist: null, opensOn: '2026-04-01' })
  })

  it('another, a former or a rotation preceptor gets null; so does a bad id', async () => {
    const { trainee } = pair(MONTH_9_START)
    seedChecklist(trainee.id)
    const stranger = seedProfile('PRECEPTOR')
    const former = seedProfile('PRECEPTOR')
    seedAssignment(trainee.id, former.id, false)
    const rotation = seedProfile('PRECEPTOR')
    seedPlacement(trainee.id, rotation.id, '2026-04-01')
    for (const caller of [stranger, former, rotation]) {
      signInAs(caller)
      expect(await getTraineeStandardsChecklist(trainee.id as string)).toBeNull()
    }
    expect(await getTraineeStandardsChecklist('not-an-id')).toBeNull()
  })

  it.each(NON_PRECEPTOR_CALLERS)('$label is refused by the guard', async ({ signIn }) => {
    const { trainee } = pair(MONTH_9_START)
    signIn()
    expect(await refusal(getTraineeStandardsChecklist(trainee.id as string))).toMatch(/^\/nutrition\//)
  })
})
