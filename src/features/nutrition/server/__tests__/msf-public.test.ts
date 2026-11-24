import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./fake-prisma')).fakePrisma }))

import { IDLE, form } from './actors'
import { NOW, audit, seedTrainee } from './evaluation-fixtures'
import { fakePrisma } from './fake-prisma'
import { DEAD_LINK, MONTH_4_START, invites, responseFields, responses, seedInvite } from './msf-fixtures'
import { getPublicMsfForm, submitMsfResponse } from '../public/msf'

// The public MSF form (Step 6c), with no login: lookup by the token's hash
// only; unknown, used, expired and revoked links all get the same message;
// single use; the response row has no assessor identity; the comment is
// checked for patient identifiers; only the MSF tables are touched.

const submit = (fields: Record<string, string>) => submitMsfResponse(IDLE, form(fields))

beforeEach(() => {
  fakePrisma.reset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  // Only the MSF tables, ever; and no audit row from the public side.
  expect(fakePrisma.calls.filter((call) => !/^(nutritionMsfInvite|nutritionMsfResponse)\./.test(call.op) && call.op !== '$transaction')).toEqual([])
  expect(audit()).toEqual([])
  vi.useRealTimers()
})

describe('the public form loader', () => {
  it('a working link shows the form and nothing about the trainee or the assessor', async () => {
    const trainee = seedTrainee(MONTH_4_START)
    const { token } = seedInvite(trainee.id)
    const view = await getPublicMsfForm(token)
    expect(Object.keys(view!).sort()).toEqual(['domains', 'expiresOn', 'formVersion', 'scale'])
    expect(view!.domains.map((domain) => domain.key)).toEqual(['communication', 'teamwork', 'professionalism', 'interpersonal_skills'])
    expect(view!.expiresOn).toBe('2026-04-16')
    expect(JSON.stringify(view)).not.toMatch(/Nurse Example|NURSE|Trainee/)
    const lookup = fakePrisma.calls.find((call) => call.op === 'nutritionMsfInvite.findUnique')!
    expect(Object.keys((lookup.args as { where: object }).where)).toEqual(['tokenHash'])
    expect(JSON.stringify(lookup.args)).not.toContain(token)
  })

  it.each(['USED', 'REVOKED', 'EXPIRED'] as const)('a %s link gets null, like an unknown or malformed one', async (state) => {
    const trainee = seedTrainee(MONTH_4_START)
    const { token } = seedInvite(trainee.id, { state })
    expect(await getPublicMsfForm(token)).toBeNull()
    expect(await getPublicMsfForm('A'.repeat(43))).toBeNull()
    expect(await getPublicMsfForm('not a token')).toBeNull()
  })
})

describe('submitting a response', () => {
  it('stores one row with the answers only, marks the link used, and has no assessor identity', async () => {
    const trainee = seedTrainee(MONTH_4_START)
    const { invite, token } = seedInvite(trainee.id)
    expect(await submit(responseFields(token, 4, { comments: 'Calm and clear with the ward team.' }))).toEqual({
      status: 'ok',
      message: 'Thank you. Your feedback has been recorded.',
    })
    const [row] = responses()
    expect(Object.keys(row).sort()).toEqual(['answers', 'comments', 'createdAt', 'createdBy', 'formVersion', 'id', 'inviteId', 'updatedAt'])
    expect(row).toMatchObject({
      inviteId: invite.id,
      formVersion: 1,
      answers: { communication: 4, teamwork: 4, professionalism: 4, interpersonal_skills: 4 },
      comments: 'Calm and clear with the ward team.',
      createdBy: null,
    })
    expect(JSON.stringify(row)).not.toMatch(/Nurse Example|NURSE/)
    expect(invites()[0].usedAt).toEqual(NOW)
  })

  it('single use: a second submit with the same link is refused with the generic message', async () => {
    const trainee = seedTrainee(MONTH_4_START)
    const { token } = seedInvite(trainee.id)
    expect((await submit(responseFields(token))).status).toBe('ok')
    expect(await getPublicMsfForm(token)).toBeNull()
    expect(await submit(responseFields(token, 2))).toEqual(DEAD_LINK)
    expect(responses()).toHaveLength(1)
    expect((responses()[0].answers as Record<string, number>).teamwork).toBe(4)
  })

  it.each(['USED', 'REVOKED', 'EXPIRED'] as const)('a %s link is refused with the same generic message, and nothing is written', async (state) => {
    const trainee = seedTrainee(MONTH_4_START)
    const { invite, token } = seedInvite(trainee.id, { state })
    expect(await submit(responseFields(token))).toEqual(DEAD_LINK)
    expect(responses()).toEqual([])
    expect(invites()[0]).toEqual(invite)
  })

  it('an unknown or malformed token gets the same message', async () => {
    expect(await submit(responseFields('A'.repeat(43)))).toEqual(DEAD_LINK)
    expect(await submit(responseFields('short'))).toEqual(DEAD_LINK)
    expect(await submit({ comments: 'x' })).toEqual(DEAD_LINK)
  })

  it('a comment with a patient identifier is refused at write time; the link stays open', async () => {
    const trainee = seedTrainee(MONTH_4_START)
    const { token } = seedInvite(trainee.id)
    const result = await submit(responseFields(token, 4, { comments: 'Saw her with patient MRN 1234567.' }))
    expect(result.status).toBe('error')
    expect(Object.keys((result as { fieldErrors?: object }).fieldErrors ?? {})).toEqual(['comments'])
    expect(responses()).toEqual([])
    expect(invites()[0].usedAt).toBeNull()
  })

  it.each([
    ['0', 'rating.teamwork'],
    ['6', 'rating.communication'],
    ['', 'rating.professionalism'],
  ])('rating %j on %s is refused', async (value, field) => {
    const trainee = seedTrainee(MONTH_4_START)
    const { token } = seedInvite(trainee.id)
    const result = await submit({ ...responseFields(token), [field]: value })
    expect(result.status).toBe('error')
    expect(Object.keys((result as { fieldErrors?: object }).fieldErrors ?? {})).toContain(field)
    expect(responses()).toEqual([])
  })

  it('a racing second claim (usedAt already set inside the transaction) is refused and writes no response', async () => {
    const trainee = seedTrainee(MONTH_4_START)
    const { token } = seedInvite(trainee.id)
    fakePrisma.failNext('nutritionMsfResponse.create', Object.assign(new Error('dup'), { code: 'P2002' }))
    expect(await submit(responseFields(token))).toEqual(DEAD_LINK)
    expect(responses()).toEqual([])
    // The transaction rolled back, so the link is still open.
    expect(invites()[0].usedAt).toBeNull()
  })
})
