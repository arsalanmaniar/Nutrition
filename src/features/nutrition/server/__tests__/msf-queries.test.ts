import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('../../auth/__tests__/fakes')).headersModule)
vi.mock('next/navigation', async () => (await import('../../auth/__tests__/fakes')).navigationModule)
vi.mock('@supabase/supabase-js', async () => (await import('../../auth/__tests__/fakes')).supabaseModule)
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./fake-prisma')).fakePrisma }))

import { resetState } from '../../auth/__tests__/fakes'
import { getMyMsfSummary, listMyTraineesMsf } from '../queries/msf'
import { NON_PRECEPTOR_CALLERS, NON_TRAINEE_CALLERS, seedAssignment } from './actors'
import { NOW, pair, refusal, seedTrainee, signInAs } from './evaluation-fixtures'
import { fakePrisma } from './fake-prisma'
import { MONTH_4_START, seedInvite, seedResponse } from './msf-fixtures'

// The MSF loaders (Step 6c): aggregates only, never below 3 responses, no
// response ever tied to its assessor; preceptor for their active primary
// trainees, trainee for their own averages; nobody else.

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

/** n answered links in round M04, each with a comment. */
function answered(traineeId: string, n: number) {
  for (let i = 0; i < n; i++) {
    const { invite } = seedInvite(traineeId, { assessorName: `Assessor ${i + 1}` })
    seedResponse(invite.id as string, 3 + (i % 3), `Comment number ${i + 1}`)
  }
}

describe('listMyTraineesMsf (preceptor)', () => {
  it('below 3 responses: only the count, and no comments', async () => {
    const { trainee, preceptor } = pair(MONTH_4_START)
    answered(trainee.id, 2)
    signInAs(preceptor)
    const [view] = await listMyTraineesMsf()
    const m04 = view.rounds.find((round) => round.point === 'M04')!
    expect(m04.aggregate).toEqual({ count: 2, hidden: true })
    expect(JSON.stringify(view)).not.toContain('Comment number')
  })

  it('at 3 responses: domain averages only; exact payload keys; no response tied to an assessor', async () => {
    const { trainee, preceptor } = pair(MONTH_4_START)
    answered(trainee.id, 3)
    seedInvite(trainee.id, { assessorName: 'Still waiting' })
    signInAs(preceptor)
    const [view] = await listMyTraineesMsf()
    expect(Object.keys(view).sort()).toEqual(['currentRound', 'rounds', 'traineeId', 'traineeName'])
    expect(view.currentRound).toBe('M04')
    expect(view.rounds.map((round) => round.point)).toEqual(['M04', 'M08', 'M12'])
    const m04 = view.rounds[0]
    expect(Object.keys(m04).sort()).toEqual(['aggregate', 'invites', 'point'])
    expect(m04.aggregate).toEqual({
      count: 3,
      hidden: false,
      domains: ['communication', 'teamwork', 'professionalism', 'interpersonal_skills'].map((key) => ({ key, label: expect.any(String), average: 4 })),
    })
    for (const invite of m04.invites) {
      expect(Object.keys(invite).sort()).toEqual(['assessorName', 'assessorRole', 'createdOn', 'expiresOn', 'id', 'status'])
    }
    expect(m04.invites.map((invite) => invite.status)).toEqual(['USED', 'USED', 'USED', 'OPEN'])
    // Nothing in the payload carries a response id, an answer per assessor, or a link hash.
    const text = JSON.stringify(view)
    for (const response of fakePrisma.tables.nutritionMsfResponse as { id: string }[]) expect(text).not.toContain(response.id)
    for (const invite of fakePrisma.tables.nutritionMsfInvite as { tokenHash: string }[]) expect(text).not.toContain(invite.tokenHash)
  })

  it('the preceptor aggregate has exactly the domain-average keys and no comment anywhere', async () => {
    const { trainee, preceptor } = pair(MONTH_4_START)
    answered(trainee.id, 3)
    signInAs(preceptor)
    const [view] = await listMyTraineesMsf()
    const aggregate = view.rounds[0].aggregate
    expect(Object.keys(aggregate).sort()).toEqual(['count', 'domains', 'hidden'])
    if (aggregate.hidden) throw new Error('expected visible aggregates')
    expect(aggregate.domains.map((domain) => Object.keys(domain).sort())).toEqual(Array(4).fill(['average', 'key', 'label']))
    expect(aggregate.domains.map((domain) => domain.key)).toEqual(['communication', 'teamwork', 'professionalism', 'interpersonal_skills'])
    const text = JSON.stringify(view)
    expect(text).not.toMatch(/comment/i)
    // The loader does not even read the comments column.
    const read = fakePrisma.calls.find((call) => call.op === 'nutritionMsfResponse.findMany')!
    expect(Object.keys((read.args as { select: object }).select).sort()).toEqual(['answers', 'inviteId'])
  })

  it("another preceptor's trainee and a former trainee are not listed", async () => {
    const { trainee: mine, preceptor } = pair(MONTH_4_START)
    const { trainee: theirs } = pair(MONTH_4_START)
    answered(theirs.id, 3)
    const former = seedTrainee(MONTH_4_START)
    seedAssignment(former.id, preceptor.id, false)
    answered(former.id, 3)
    signInAs(preceptor)
    expect((await listMyTraineesMsf()).map((view) => view.traineeId)).toEqual([mine.id])
  })

  it.each(NON_PRECEPTOR_CALLERS)('$label is refused by the guard (unit lead and admin included)', async ({ signIn }) => {
    signIn()
    expect(await refusal(listMyTraineesMsf())).toMatch(/^\/nutrition\//)
  })
})

describe('getMyMsfSummary (trainee)', () => {
  it('own rounds only; averages from 3 responses; no comments, no assessors, exact keys', async () => {
    const { trainee } = pair(MONTH_4_START)
    answered(trainee.id, 3)
    const other = seedTrainee(MONTH_4_START)
    answered(other.id, 3)
    signInAs(trainee)
    const rounds = await getMyMsfSummary()
    expect(rounds.map((round) => round.point)).toEqual(['M04', 'M08', 'M12'])
    for (const round of rounds) expect(Object.keys(round).sort()).toEqual(['aggregate', 'point'])
    expect(rounds[0].aggregate).toMatchObject({ count: 3, hidden: false })
    expect(rounds[1].aggregate).toEqual({ count: 0, hidden: true })
    const text = JSON.stringify(rounds)
    expect(text).not.toMatch(/Comment number|Assessor \d|NURSE/)
    const reads = fakePrisma.calls.filter((call) => call.op === 'nutritionMsfInvite.findMany')
    expect(reads.map((call) => (call.args as { where: unknown; select: object }).where)).toEqual([{ traineeId: trainee.id }])
    expect(Object.keys((reads[0].args as { select: object }).select).sort()).toEqual(['createdAt', 'id'])
  })

  it('below 3 responses the trainee sees only the count', async () => {
    const { trainee } = pair(MONTH_4_START)
    answered(trainee.id, 2)
    signInAs(trainee)
    expect((await getMyMsfSummary())[0].aggregate).toEqual({ count: 2, hidden: true })
  })

  it.each(NON_TRAINEE_CALLERS)('$label is refused by the guard', async ({ signIn }) => {
    signIn()
    expect(await refusal(getMyMsfSummary())).toMatch(/^\/nutrition\//)
  })
})
