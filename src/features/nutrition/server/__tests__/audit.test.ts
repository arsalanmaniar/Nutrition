import { describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import { profileSnapshot, writeAudit } from '../audit'

// The audit writer's own safety rules. The action tests check what each action
// logs; these check what can never be logged.

function fakeTx() {
  const create = vi.fn(async () => ({}))
  return { tx: { nutritionAuditLog: { create } } as unknown as Prisma.TransactionClient, create }
}

const entry = { entity: 'NutritionProfile', entityId: 'p1', action: 'update', actorId: 'auth-admin' }

describe('writeAudit', () => {
  it.each(['password', 'newPassword', 'accessToken', 'refresh_token', 'tokenHash', 'clientSecret', 'serviceRoleKey', 'service_role', 'apiKey', 'API_KEY'])(
    'refuses a snapshot with a %s field and writes nothing',
    async (field) => {
      const { tx, create } = fakeTx()
      await expect(writeAudit(tx, { ...entry, before: null, after: { [field]: 'x' } })).rejects.toThrow(`refusing to log the field "${field}"`)
      await expect(writeAudit(tx, { ...entry, before: { [field]: 'x' }, after: null })).rejects.toThrow('refusing to log')
      expect(create).not.toHaveBeenCalled()
    },
  )

  it('allows ordinary fields that merely look similar, e.g. a WPBA "passed" result', async () => {
    const { tx, create } = fakeTx()
    await writeAudit(tx, { ...entry, before: null, after: { passed: true, passMark: 3, bypassed: false } })
    expect(create).toHaveBeenCalledOnce()
  })

  it('writes the row with a null "before" left out, so the column stays NULL', async () => {
    const { tx, create } = fakeTx()
    await writeAudit(tx, { ...entry, action: 'create', before: null, after: { id: 'p1' } })
    expect(create).toHaveBeenCalledWith({
      data: { entity: 'NutritionProfile', entityId: 'p1', action: 'create', actorId: 'auth-admin', before: undefined, after: { id: 'p1' } },
    })
  })
})

describe('profileSnapshot', () => {
  it('copies only the listed fields, whatever else the row carries', () => {
    const row = {
      id: 'p1',
      authUserId: 'auth-1',
      email: 'a@cdnep.test',
      fullName: 'A Person',
      role: 'TRAINEE' as const,
      institution: null,
      trainingStartDate: new Date('2026-10-01T00:00:00Z'),
      isActive: true,
      password: 'should-never-appear',
      createdBy: 'auth-admin',
    }
    expect(profileSnapshot(row)).toEqual({
      id: 'p1',
      authUserId: 'auth-1',
      email: 'a@cdnep.test',
      fullName: 'A Person',
      role: 'TRAINEE',
      institution: null,
      trainingStartDate: '2026-10-01',
      isActive: true,
    })
  })
})
