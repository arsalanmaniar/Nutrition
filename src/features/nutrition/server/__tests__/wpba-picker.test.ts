import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('../../auth/__tests__/fakes')).headersModule)
vi.mock('next/navigation', async () => (await import('../../auth/__tests__/fakes')).navigationModule)
vi.mock('@supabase/supabase-js', async () => (await import('../../auth/__tests__/fakes')).supabaseModule)
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./fake-prisma')).fakePrisma }))

import { resetState } from '../../auth/__tests__/fakes'
import { submitWpba } from '../actions/wpba'
import { getMyLatestAssessment, listAssessableTrainees, listCbdCaseLogs, listPrimaryTraineeScorecards } from '../queries/wpba-picker'
import { IDLE, form, seedAssignment, seedProfile, signInAdmin, signInSuperAdmin } from './actors'
import { NOW, refusal, seedTrainee, signInAs } from './evaluation-fixtures'
import { fakePrisma } from './fake-prisma'
import { seedCaseLog, seedPlacement, seedWpba, wpbaForm } from './wpba-fixtures'

// The read models behind the WPBA screens (Step 5b): who the caller may
// assess today, a trainee's CbD-eligible case logs, the primary preceptor's
// scorecards and the caller's latest filed WPBA. The picker must agree with the
// 5a action about who may be assessed.

beforeEach(() => {
  resetState()
  fakePrisma.reset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW) // 15 April 2026 in Karachi
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

/** A preceptor and one trainee of each kind of relationship. */
function scene() {
  const preceptor = seedProfile('PRECEPTOR', { fullName: 'Dr Picker' })
  const primary = seedTrainee('2026-01-01', { fullName: 'A Primary' })
  seedAssignment(primary.id, preceptor.id)
  const placed = seedTrainee('2026-02-01', { fullName: 'B Placed' })
  seedPlacement(placed.id, preceptor.id, '2026-04-01', '2026-04-30')
  const ended = seedTrainee('2026-01-01', { fullName: 'C Placement ended' })
  seedPlacement(ended.id, preceptor.id, '2026-02-01', '2026-04-14')
  const future = seedTrainee('2026-01-01', { fullName: 'D Placement later' })
  seedPlacement(future.id, preceptor.id, '2026-04-16')
  const former = seedTrainee('2026-01-01', { fullName: 'E Former primary' })
  seedAssignment(former.id, preceptor.id, false)
  const inactive = seedTrainee('2026-01-01', { fullName: 'F Inactive', isActive: false })
  seedAssignment(inactive.id, preceptor.id)
  const stranger = seedTrainee('2026-01-01', { fullName: 'G Stranger' })
  return { preceptor, primary, placed, ended, future, former, inactive, stranger }
}

describe('listAssessableTrainees', () => {
  it('lists the active trainees the caller may assess today: primary, or a placement covering today; with start dates', async () => {
    const { preceptor } = scene()
    signInAs(preceptor)
    expect(await listAssessableTrainees()).toEqual([
      { traineeId: expect.any(String), traineeName: 'A Primary', trainingStartDate: '2026-01-01', via: 'PRIMARY' },
      { traineeId: expect.any(String), traineeName: 'B Placed', trainingStartDate: '2026-02-01', via: 'PLACEMENT' },
    ])
  })

  it('an assessor sees only their placements; with none, nobody', async () => {
    const { placed } = scene()
    const assessor = seedProfile('ASSESSOR')
    seedPlacement(placed.id, assessor.id, '2026-04-10')
    signInAs(assessor)
    expect((await listAssessableTrainees()).map((t) => t.traineeName)).toEqual(['B Placed'])
    signInAs(seedProfile('ASSESSOR'))
    expect(await listAssessableTrainees()).toEqual([])
  })

  it('agrees with the 5a action: a trainee is listed exactly when a Mini-CEX for today would be accepted', async () => {
    const people = scene()
    signInAs(people.preceptor)
    const listed = new Set((await listAssessableTrainees()).map((t) => t.traineeId))
    for (const trainee of [people.primary, people.placed, people.ended, people.future, people.former, people.inactive, people.stranger]) {
      const accepted = (await submitWpba(IDLE, form(wpbaForm('MINI_CEX', trainee.id)))).status === 'ok'
      expect({ trainee: trainee.fullName, listed: listed.has(trainee.id) }).toEqual({ trainee: trainee.fullName, listed: accepted })
    }
  })
})

describe('listCbdCaseLogs', () => {
  it("lists the trainee's SUBMITTED and APPROVED logs as id, case code and form type only, never the text", async () => {
    const { preceptor, primary } = scene()
    const submitted = seedCaseLog(primary.id, 'SUBMITTED', 'C-2026-002')
    const approved = seedCaseLog(primary.id, 'APPROVED', 'C-2026-001')
    seedCaseLog(primary.id, 'DRAFT', 'C-2026-003')
    seedCaseLog(primary.id, 'REJECTED', 'C-2026-004')
    signInAs(preceptor)
    const logs = await listCbdCaseLogs(primary.id)
    expect(logs).toEqual([
      { id: submitted.id, caseCode: 'C-2026-002', formType: 'A' },
      { id: approved.id, caseCode: 'C-2026-001', formType: 'A' },
    ])
    expect(JSON.stringify(logs)).not.toContain('Weight 72.5')
  })

  it('a trainee the caller may not assess today, or a malformed id, gives an empty list', async () => {
    const { preceptor, ended, stranger } = scene()
    seedCaseLog(ended.id)
    seedCaseLog(stranger.id)
    signInAs(preceptor)
    expect(await listCbdCaseLogs(ended.id)).toEqual([])
    expect(await listCbdCaseLogs(stranger.id)).toEqual([])
    expect(await listCbdCaseLogs('not-a-uuid')).toEqual([])
  })
})

describe('listPrimaryTraineeScorecards', () => {
  it('one aggregate per ACTIVE primary trainee: no WPBA row, id or feedback', async () => {
    const { preceptor, primary, former, placed } = scene()
    seedWpba('MINI_CEX', primary.id, preceptor.id, { feedback: 'SECRET-FEEDBACK' })
    seedWpba('OSCE', primary.id, preceptor.id, { total: 17, passed: false })
    seedWpba('MINI_CEX', former.id, preceptor.id)
    seedWpba('DOPS', placed.id, preceptor.id)
    signInAs(preceptor)
    const cards = await listPrimaryTraineeScorecards()
    expect(cards.map((card) => card.traineeName)).toEqual(['A Primary', 'F Inactive'])
    expect(Object.keys(cards[0]).sort()).toEqual(['scorecard', 'traineeName'])
    expect(cards[0].scorecard.types.map((t) => [t.type, t.count])).toEqual([
      ['MINI_CEX', 1],
      ['DOPS', 0],
      ['CBD', 0],
      ['OSCE', 1],
    ])
    expect(cards[0].scorecard.highestMillerLevel).toBe('SHOWS_HOW')
    const text = JSON.stringify(cards)
    expect(text).not.toContain('SECRET-FEEDBACK')
    expect(text).not.toMatch(/"(id|traineeId|assessorId|feedback|ratings|scores)":/)
  })

  it('an assessor has no scorecard page', async () => {
    scene()
    signInAs(seedProfile('ASSESSOR'))
    expect(await refusal(listPrimaryTraineeScorecards())).toBe('/nutrition/no-access')
  })
})

describe('getMyLatestAssessment', () => {
  it("the caller's most recently FILED WPBA, as stored, with an OSCE's reasons; never another assessor's", async () => {
    const { preceptor, primary } = scene()
    const colleague = seedProfile('PRECEPTOR')
    seedWpba('MINI_CEX', primary.id, preceptor.id, { assessedOn: '2026-04-15', createdAt: new Date('2026-04-15T06:00:00Z') })
    const osce = seedWpba('OSCE', primary.id, preceptor.id, { assessedOn: '2026-04-02', total: 17, passed: false, createdAt: new Date('2026-04-15T06:30:00Z') })
    fakePrisma.tables.nutritionWpba.find((row) => row.id === osce.id)!.scores = { ratings: {}, failReasons: ['BELOW_PASS_MARK'] }
    seedWpba('DOPS', primary.id, colleague.id, { createdAt: new Date('2026-04-15T06:59:00Z') })
    signInAs(preceptor)
    expect(await getMyLatestAssessment()).toEqual({
      type: 'OSCE',
      title: 'OSCE',
      traineeName: 'A Primary',
      assessedOn: '2026-04-02',
      total: 17,
      maxScore: 25,
      passed: false,
      criticalError: false,
      failReasons: ['BELOW_PASS_MARK'],
    })
  })

  it('null when the caller has filed nothing', async () => {
    scene()
    signInAs(seedProfile('ASSESSOR'))
    expect(await getMyLatestAssessment()).toBeNull()
  })
})

describe('only preceptors and assessors use the picker loaders', () => {
  it.each([
    ['a TRAINEE', () => void signInAs(seedTrainee('2026-01-01'))],
    ['a UNIT_LEAD', () => void signInAs(seedProfile('UNIT_LEAD'))],
    ['an ADMIN', () => void signInAdmin()],
    ['a super_admin', () => void signInSuperAdmin()],
  ])('%s is refused by every one of them', async (_label, signInCaller) => {
    const { primary } = scene()
    signInCaller()
    for (const load of [() => listAssessableTrainees(), () => listCbdCaseLogs(primary.id), () => getMyLatestAssessment(), () => listPrimaryTraineeScorecards()]) {
      expect(await refusal(load())).toBe('/nutrition/no-access')
    }
  })
})
