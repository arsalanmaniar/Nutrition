import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./fake-prisma')).fakePrisma }))

import { PROGRAM_NAME } from '../../config/portfolio'
import { getCredentialVerification } from '../public/verify'
import { NOW, seedTrainee } from './evaluation-fixtures'
import { fakePrisma } from './fake-prisma'
import { seedCredential } from './portfolio-fixtures'

// The public certificate check (Step 7): exactly four fields; unknown or
// malformed ids get null; only NutritionCredential is read, by verificationId.

const ID = 'A'.repeat(20) + 'b'.repeat(23)

beforeEach(() => {
  fakePrisma.reset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  expect(fakePrisma.calls.map((call) => call.op).filter((op) => op !== 'nutritionCredential.findUnique')).toEqual([])
  expect(fakePrisma.writes()).toEqual([])
  vi.useRealTimers()
})

describe('getCredentialVerification', () => {
  it('a valid credential: exactly name, program, issue date and status', async () => {
    const trainee = seedTrainee('2025-04-20', { fullName: 'Ayesha Trainee' })
    seedCredential(trainee.id, { verificationId: ID })
    const result = await getCredentialVerification(ID)
    expect(result).toEqual({ name: 'Ayesha Trainee', program: PROGRAM_NAME, issuedOn: '2026-04-10', status: 'VALID' })
    expect(Object.keys(result!).sort()).toEqual(['issuedOn', 'name', 'program', 'status'])
    const lookup = fakePrisma.calls[0]
    expect((lookup.args as { where: object }).where).toEqual({ verificationId: ID })
    expect(JSON.stringify(result)).not.toMatch(new RegExp(`${trainee.id}|${ID}|email|cdnep\\.test`))
  })

  it('a revoked credential says so, with the same four fields', async () => {
    const trainee = seedTrainee('2025-04-20')
    seedCredential(trainee.id, { verificationId: ID, revoked: true })
    const result = await getCredentialVerification(ID)
    expect(result?.status).toBe('REVOKED')
    expect(Object.keys(result!).sort()).toEqual(['issuedOn', 'name', 'program', 'status'])
  })

  it('an unknown id gets null; a malformed one is not even looked up', async () => {
    expect(await getCredentialVerification('B'.repeat(43))).toBeNull()
    expect(fakePrisma.calls).toHaveLength(1)
    for (const bad of ['', 'short', 'x'.repeat(44), `${'A'.repeat(42)}!`]) expect(await getCredentialVerification(bad)).toBeNull()
    expect(fakePrisma.calls).toHaveLength(1)
  })
})
