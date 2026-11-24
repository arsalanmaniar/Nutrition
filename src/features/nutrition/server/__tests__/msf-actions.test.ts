import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('../../auth/__tests__/fakes')).headersModule)
vi.mock('next/navigation', async () => (await import('../../auth/__tests__/fakes')).navigationModule)
vi.mock('@supabase/supabase-js', async () => (await import('../../auth/__tests__/fakes')).supabaseModule)
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./fake-prisma')).fakePrisma }))

import { resetState } from '../../auth/__tests__/fakes'
import { createMsfInvite, revokeMsfInvite } from '../actions/msf'
import { getPublicMsfForm, submitMsfResponse } from '../public/msf'
import { IDLE, NON_PRECEPTOR_CALLERS, form, seedAssignment, seedProfile } from './actors'
import { NOW, audit, pair, refusal, seedTrainee, signInAs } from './evaluation-fixtures'
import { fakePrisma } from './fake-prisma'
import { DEAD_LINK, MONTH_3_START, MONTH_4_START, hashMsfToken, invites, responseFields, responses, seedInvite } from './msf-fixtures'
import { seedPlacement } from './wpba-fixtures'

// MSF link actions (Step 6c): create and revoke, by the ACTIVE primary
// preceptor only, under the trainee row lock; only the token's hash is
// stored; the raw token is returned once; months 4/8/12 only; 5 per round.

const LOCK_SQL = 'SELECT id FROM nutr_profile WHERE id = ? FOR UPDATE'
const TRAINEE_NOT_FOUND = { status: 'error', message: 'This trainee was not found among your trainees.' }
const create = (traineeId: string, extra: Record<string, string> = {}) =>
  createMsfInvite(IDLE, form({ traineeId, assessorName: 'Sister Amina', assessorRole: 'NURSE', ...extra }))
const revoke = (inviteId: string) => revokeMsfInvite(IDLE, form({ inviteId }))

beforeEach(() => {
  resetState()
  fakePrisma.reset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW) // 15 April 2026
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
})

afterEach(() => {
  expect(fakePrisma.calls.filter((call) => /^nutritionAuditLog\.(update|delete)/.test(call.op))).toEqual([])
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('creating a link', () => {
  it('stores only the hash, returns the raw token once, expires in 14 days, under the trainee row lock, audited without names', async () => {
    const { trainee, preceptor } = pair(MONTH_4_START)
    signInAs(preceptor)
    const result = await create(trainee.id)
    // The token in the result works on the public form: it is the one whose hash was stored.
    expect(await getPublicMsfForm((result as { token: string }).token)).not.toBeNull()
    expect(result).toMatchObject({ status: 'ok', message: 'MSF link created for round M04. Copy it now: it is shown only once.' })
    const token = (result as { token: string }).token
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)

    const [row] = invites()
    expect(row).toMatchObject({
      traineeId: trainee.id,
      tokenHash: hashMsfToken(token),
      assessorName: 'Sister Amina',
      assessorRole: 'NURSE',
      usedAt: null,
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 14 * 86_400_000),
      createdBy: preceptor.authUserId,
    })
    // The raw token is nowhere in the database: not in the invite, not in the audit log.
    expect(JSON.stringify(fakePrisma.tables)).not.toContain(token)
    expect(fakePrisma.calls.filter((call) => call.inTransaction)[0]).toEqual({ op: '$queryRaw', args: { sql: LOCK_SQL, values: [trainee.id] }, inTransaction: true })

    expect(audit()).toHaveLength(1)
    expect(audit()[0]).toMatchObject({ entity: 'NutritionMsfInvite', entityId: row.id, action: 'create', actorId: preceptor.authUserId, before: null })
    expect(audit()[0].after).toEqual({ id: row.id, traineeId: trainee.id, round: 'M04', status: 'OPEN' })
    const text = JSON.stringify(audit())
    for (const secret of ['Sister Amina', 'NURSE', row.tokenHash as string]) expect(text).not.toContain(secret)
  })

  it('outside training months 4, 8 and 12 it is refused', async () => {
    const { trainee, preceptor } = pair(MONTH_3_START)
    signInAs(preceptor)
    expect(await create(trainee.id)).toEqual({ status: 'error', message: 'MSF links can be created in training months 4, 8, 12; this trainee is in month 3.' })
    expect(invites()).toEqual([])
  })

  it('at most 5 open or answered links per round; revoked and expired links free their place', async () => {
    const { trainee, preceptor } = pair(MONTH_4_START)
    for (const state of ['OPEN', 'OPEN', 'USED', 'USED', 'OPEN'] as const) seedInvite(trainee.id, { state })
    signInAs(preceptor)
    expect(await create(trainee.id)).toEqual({
      status: 'error',
      message: 'This round already has 5 open or answered links. Revoke an open one to invite someone else.',
    })
    fakePrisma.reset()
    resetState()
    const again = pair(MONTH_4_START)
    for (const state of ['OPEN', 'USED', 'USED', 'REVOKED', 'EXPIRED', 'OPEN'] as const) seedInvite(again.trainee.id, { state })
    signInAs(again.preceptor)
    expect((await create(again.trainee.id)).status).toBe('ok')
  })

  it('an assessor name with a patient identifier is refused', async () => {
    const { trainee, preceptor } = pair(MONTH_4_START)
    signInAs(preceptor)
    const result = await create(trainee.id, { assessorName: 'MRN 1234567' })
    expect(result.status).toBe('error')
    expect(Object.keys((result as { fieldErrors?: object }).fieldErrors ?? {})).toEqual(['assessorName'])
    expect(invites()).toEqual([])
  })

  it('another, a former and a rotation preceptor get "not found"', async () => {
    const { trainee } = pair(MONTH_4_START)
    const stranger = seedProfile('PRECEPTOR')
    const former = seedProfile('PRECEPTOR')
    seedAssignment(trainee.id, former.id, false)
    const rotation = seedProfile('PRECEPTOR')
    seedPlacement(trainee.id, rotation.id, '2026-04-01')
    for (const caller of [stranger, former, rotation]) {
      signInAs(caller)
      expect(await create(trainee.id)).toEqual(TRAINEE_NOT_FOUND)
    }
    expect(invites()).toEqual([])
  })

  it.each(NON_PRECEPTOR_CALLERS)('$label is refused by the guard (trainee, unit lead and admin included)', async ({ signIn }) => {
    const { trainee } = pair(MONTH_4_START)
    signIn()
    expect(await refusal(create(trainee.id))).toMatch(/^\/nutrition\//)
    expect(fakePrisma.calls.filter((call) => call.op.startsWith('nutritionMsf'))).toEqual([])
  })
})

describe('revoking a link', () => {
  it('an open link: expiry set back to creation, audited as revoke', async () => {
    const { trainee, preceptor } = pair(MONTH_4_START)
    const { invite, token } = seedInvite(trainee.id)
    signInAs(preceptor)
    expect(await revoke(invite.id as string)).toEqual({ status: 'ok', message: 'Link revoked. You can invite someone else for this round.' })
    expect(invites()[0].expiresAt).toEqual(invite.createdAt)
    // A revoked link is dead on the public side: no form, and no submit.
    expect(await getPublicMsfForm(token)).toBeNull()
    expect(await submitMsfResponse(IDLE, form(responseFields(token)))).toEqual(DEAD_LINK)
    expect(responses()).toEqual([])
    expect(audit()[0]).toMatchObject({ action: 'revoke', before: { status: 'OPEN' }, after: { status: 'REVOKED' } })
  })

  it.each(['USED', 'REVOKED', 'EXPIRED'] as const)('a %s link cannot be revoked', async (state) => {
    const { trainee, preceptor } = pair(MONTH_4_START)
    const { invite } = seedInvite(trainee.id, { state })
    signInAs(preceptor)
    expect(await revoke(invite.id as string)).toEqual({ status: 'error', message: 'This link is no longer open, so there is nothing to revoke.' })
    expect(fakePrisma.writes().filter((call) => call.op.startsWith('nutritionMsfInvite.'))).toEqual([])
  })

  it("another preceptor's trainee's link and an unknown id get \"not found\"", async () => {
    const { trainee } = pair(MONTH_4_START)
    const { invite } = seedInvite(trainee.id)
    signInAs(seedProfile('PRECEPTOR'))
    expect(await revoke(invite.id as string)).toEqual({ status: 'error', message: 'This link was not found.' })
    expect(await revoke('0b0c3e1e-6c1b-4c39-9a37-3f5c2f1f9a11')).toEqual({ status: 'error', message: 'This link was not found.' })
    expect(invites()[0]).toEqual(invite)
  })

  it.each(NON_PRECEPTOR_CALLERS)('$label is refused by the guard', async ({ signIn }) => {
    const trainee = seedTrainee(MONTH_4_START)
    const { invite } = seedInvite(trainee.id)
    signIn()
    expect(await refusal(revoke(invite.id as string))).toMatch(/^\/nutrition\//)
  })
})
