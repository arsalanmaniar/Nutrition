import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('../../auth/__tests__/fakes')).headersModule)
vi.mock('next/navigation', async () => (await import('../../auth/__tests__/fakes')).navigationModule)
vi.mock('@supabase/supabase-js', async () => (await import('../../auth/__tests__/fakes')).supabaseModule)
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./fake-prisma')).fakePrisma }))

import { resetState } from '../../auth/__tests__/fakes'
import { getMyWpbaScorecard, listMyAssessments, listMyWpbas } from '../queries/wpba'
import { seedProfile, signInAdmin, signInSuperAdmin } from './actors'
import { NOW, pair, refusal, seedTrainee, signInAs } from './evaluation-fixtures'
import { fakePrisma } from './fake-prisma'
import { TODAY, seedCaseLog, seedWpba } from './wpba-fixtures'

// The WPBA loaders: a trainee reads only their own WPBAs and scorecard; a
// preceptor or assessor reads only the WPBAs they filed. Nobody else reads an
// individual WPBA.

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

function scene() {
  const { trainee: a, preceptor } = pair('2026-01-01')
  const b = seedTrainee('2026-01-01', { fullName: 'Bilal Trainee' })
  const assessor = seedProfile('ASSESSOR', { fullName: 'Nurse Assessor' })
  const log = seedCaseLog(a.id, 'APPROVED', 'C-2026-007')
  const mine = [
    seedWpba('MINI_CEX', a.id, preceptor.id, { assessedOn: '2026-03-01', feedback: 'A: first Mini-CEX.' }),
    seedWpba('OSCE', a.id, preceptor.id, { assessedOn: '2026-04-10', total: 17, passed: false, feedback: 'A: OSCE.' }),
    seedWpba('CBD', a.id, assessor.id, { assessedOn: '2026-04-12', caseLogId: log.id as string, feedback: 'A: CbD.' }),
    seedWpba('DOPS', a.id, assessor.id, { assessedOn: TODAY, procedure: 'Nasogastric tube check', feedback: 'A: DOPS.' }),
  ]
  const theirs = seedWpba('MINI_CEX', b.id, preceptor.id, { feedback: 'B: private to Bilal.' })
  return { a, b, preceptor, assessor, mine, theirs }
}

describe('trainee: listMyWpbas and getMyWpbaScorecard', () => {
  it("trainee A reads only A's WPBAs, newest first, with scores, feedback, the assessor and the result", async () => {
    const { a, mine, theirs } = scene()
    signInAs(a)
    const rows = await listMyWpbas()
    expect(rows.map((row) => row.id)).toEqual([mine[3].id, mine[2].id, mine[1].id, mine[0].id])
    expect(JSON.stringify(rows)).not.toContain(theirs.id as string)
    expect(JSON.stringify(rows)).not.toContain('private to Bilal')
    expect(rows[0]).toMatchObject({ type: 'DOPS', procedure: 'Other: Nasogastric tube check', assessorName: 'Nurse Assessor', millerLevel: 'DOES', suggestedEpa: { min: 'E3', max: 'E5' } })
    expect(rows[1]).toMatchObject({ type: 'CBD', caseCode: 'C-2026-007', feedback: 'A: CbD.', total: 20, maxScore: 25 })
    expect(rows[2]).toMatchObject({ type: 'OSCE', total: 17, passed: false, assessorName: 'Dr Primary' })
    expect(rows[3].ratings).toMatchObject({ medical_interviewing: 8 })
  })

  it("trainee B reads only B's", async () => {
    const { b, theirs, mine } = scene()
    signInAs(b)
    const rows = await listMyWpbas()
    expect(rows.map((row) => row.id)).toEqual([theirs.id])
    for (const row of mine) expect(JSON.stringify(rows)).not.toContain(row.id as string)
  })

  it('the scorecard: count and latest per type, and the highest Miller level reached', async () => {
    const { a } = scene()
    seedWpba('MINI_CEX', a.id, seedProfile('PRECEPTOR').id, { assessedOn: '2026-04-02', total: 30 })
    signInAs(a)
    expect(await getMyWpbaScorecard()).toEqual({
      types: [
        { type: 'MINI_CEX', title: 'Mini-CEX', count: 2, latest: { assessedOn: '2026-04-02', total: 30, maxScore: 45, passed: null } },
        { type: 'DOPS', title: 'DOPS', count: 1, latest: { assessedOn: TODAY, total: 4, maxScore: 5, passed: null } },
        { type: 'CBD', title: 'CbD', count: 1, latest: { assessedOn: '2026-04-12', total: 20, maxScore: 25, passed: null } },
        { type: 'OSCE', title: 'OSCE', count: 1, latest: { assessedOn: '2026-04-10', total: 17, maxScore: 25, passed: false } },
      ],
      highestMillerLevel: 'DOES',
      highestMillerLabel: 'Does',
    })
  })

  it('a trainee with no WPBA gets empty counts and no Miller level', async () => {
    signInAs(seedTrainee('2026-01-01'))
    const card = await getMyWpbaScorecard()
    expect(card.types.map((t) => [t.type, t.count, t.latest])).toEqual([
      ['MINI_CEX', 0, null],
      ['DOPS', 0, null],
      ['CBD', 0, null],
      ['OSCE', 0, null],
    ])
    expect(card.highestMillerLevel).toBeNull()
  })
})

describe('assessor: listMyAssessments', () => {
  it("a preceptor reads only the WPBAs they filed, not a colleague's about the same trainee", async () => {
    const { preceptor, mine, theirs } = scene()
    signInAs(preceptor)
    const rows = await listMyAssessments()
    expect(rows.map((row) => row.id).sort()).toEqual([mine[0].id, mine[1].id, theirs.id].sort() as string[])
    expect(rows.find((row) => row.id === mine[0].id)).toMatchObject({ traineeName: 'Ayesha Trainee', feedback: 'A: first Mini-CEX.' })
  })

  it('an assessor reads only their own two WPBAs: nothing else of the trainee', async () => {
    const { assessor, mine } = scene()
    signInAs(assessor)
    const rows = await listMyAssessments()
    expect(rows.map((row) => row.id)).toEqual([mine[3].id, mine[2].id])
    expect(Object.keys(rows[0]).sort()).toEqual(
      ['assessedOn', 'caseCode', 'criticalError', 'failReasons', 'feedback', 'id', 'maxScore', 'millerLevel', 'passed', 'procedure', 'ratings', 'suggestedEpa', 'title', 'total', 'traineeName', 'type'].sort(),
    )
  })
})

describe('no other role reads an individual WPBA', () => {
  it.each([
    ['a TRAINEE', () => void signInAs(seedTrainee('2026-01-01'))],
    ['a UNIT_LEAD', () => void signInAs(seedProfile('UNIT_LEAD'))],
    ['an ADMIN', () => void signInAdmin()],
    ['a super_admin', () => void signInSuperAdmin()],
  ])('%s cannot call listMyAssessments', async (_label, signInCaller) => {
    scene()
    signInCaller()
    expect(await refusal(listMyAssessments())).toBe('/nutrition/no-access')
  })

  it.each([
    ['a PRECEPTOR', () => void signInAs(seedProfile('PRECEPTOR'))],
    ['an ASSESSOR', () => void signInAs(seedProfile('ASSESSOR'))],
    ['a UNIT_LEAD', () => void signInAs(seedProfile('UNIT_LEAD'))],
    ['an ADMIN', () => void signInAdmin()],
    ['a super_admin', () => void signInSuperAdmin()],
  ])('%s cannot call the trainee loaders', async (_label, signInCaller) => {
    scene()
    signInCaller()
    expect(await refusal(listMyWpbas())).toBe('/nutrition/no-access')
    expect(await refusal(getMyWpbaScorecard())).toBe('/nutrition/no-access')
  })
})
