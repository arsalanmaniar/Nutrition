import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { MIN_MSF_RESPONSES, MSF_DOMAINS, MSF_LINK_DAYS } from '../../config/msf'
import { MSF_TOKEN_PATTERN } from '../../validation/msf'
import { countsTowardRound, inviteAuditSnapshot, inviteStatus, msfAggregate, msfExpiry, msfRound, roundPoint } from '../msf-core'
import { hashMsfToken, newMsfToken } from '../msf-token'

// The pure MSF rules (Step 6c): tokens, rounds, link states, aggregates.

const answers = (value: number) => Object.fromEntries(MSF_DOMAINS.map((domain) => [domain.key, value]))

describe('tokens: 32 random bytes, only the sha256 hash is kept', () => {
  it('a new token is 43 base64url characters and its hash is its sha256', () => {
    const { token, tokenHash } = newMsfToken()
    expect(token).toMatch(MSF_TOKEN_PATTERN)
    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
    expect(tokenHash).toBe(createHash('sha256').update(token).digest('hex'))
    expect(hashMsfToken(token)).toBe(tokenHash)
    expect(tokenHash).not.toContain(token)
  })

  it('tokens do not repeat', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => newMsfToken().token))
    expect(tokens.size).toBe(50)
  })
})

describe('rounds: training months 4, 8 and 12 only', () => {
  const start = new Date('2026-01-01T00:00:00Z')
  it.each([
    ['2026-03-31T12:00:00Z', null],
    ['2026-04-01T05:00:00Z', 4],
    ['2026-04-30T12:00:00Z', 4],
    ['2026-05-01T05:00:00Z', null],
    ['2026-08-15T05:00:00Z', 8],
    ['2026-12-10T05:00:00Z', 12],
    ['2027-01-02T05:00:00Z', null],
  ])('created %s -> round %j', (at, round) => {
    expect(msfRound(start, new Date(at))).toBe(round)
  })

  it('no start date, no round; points are M04, M08, M12', () => {
    expect(msfRound(null, new Date('2026-04-15T05:00:00Z'))).toBeNull()
    expect([4, 8, 12].map(roundPoint)).toEqual(['M04', 'M08', 'M12'])
  })
})

describe('link states', () => {
  const createdAt = new Date('2026-04-02T05:00:00Z')
  const now = new Date('2026-04-10T05:00:00Z')
  it('open, used, revoked (expiry set back to creation) and expired', () => {
    expect(msfExpiry(createdAt).getTime() - createdAt.getTime()).toBe(MSF_LINK_DAYS * 86_400_000)
    expect(inviteStatus({ createdAt, expiresAt: msfExpiry(createdAt), usedAt: null }, now)).toBe('OPEN')
    expect(inviteStatus({ createdAt, expiresAt: msfExpiry(createdAt), usedAt: now }, now)).toBe('USED')
    expect(inviteStatus({ createdAt, expiresAt: createdAt, usedAt: null }, now)).toBe('REVOKED')
    expect(inviteStatus({ createdAt, expiresAt: new Date('2026-04-09T05:00:00Z'), usedAt: null }, now)).toBe('EXPIRED')
    expect(['OPEN', 'USED', 'REVOKED', 'EXPIRED'].filter((status) => countsTowardRound(status as never))).toEqual(['OPEN', 'USED'])
  })
})

describe(`aggregates: hidden below MIN_MSF_RESPONSES (${MIN_MSF_RESPONSES})`, () => {
  it.each([0, 1, 2])('%i responses: only the count, nothing else', (count) => {
    const result = msfAggregate(Array.from({ length: count }, () => answers(5)))
    expect(result).toEqual({ count, hidden: true })
    expect(Object.keys(result).sort()).toEqual(['count', 'hidden'])
  })

  it('3 responses: per-domain averages to one decimal, exact keys', () => {
    const result = msfAggregate([answers(5), answers(4), { ...answers(4), teamwork: 2 }])
    expect(result).toEqual({
      count: 3,
      hidden: false,
      domains: [
        { key: 'communication', label: 'Communication', average: 4.3 },
        { key: 'teamwork', label: 'Teamwork', average: 3.7 },
        { key: 'professionalism', label: 'Professionalism', average: 4.3 },
        { key: 'interpersonal_skills', label: 'Interpersonal skills', average: 4.3 },
      ],
    })
  })
})

describe('the invite audit snapshot', () => {
  it('has ids, the round and the state: never the token hash, the name or the profession', () => {
    const createdAt = new Date('2026-04-02T05:00:00Z')
    const snapshot = inviteAuditSnapshot(
      { id: 'i1', traineeId: 't1', usedAt: null, expiresAt: msfExpiry(createdAt), createdAt, tokenHash: 'h', assessorName: 'Nurse X', assessorRole: 'NURSE' } as never,
      4,
      new Date('2026-04-03T05:00:00Z'),
    )
    expect(snapshot).toEqual({ id: 'i1', traineeId: 't1', round: 'M04', status: 'OPEN' })
  })
})
