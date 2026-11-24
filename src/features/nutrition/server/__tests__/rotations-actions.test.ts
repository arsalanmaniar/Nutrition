import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('../../auth/__tests__/fakes')).headersModule)
vi.mock('next/navigation', async () => (await import('../../auth/__tests__/fakes')).navigationModule)
vi.mock('@supabase/supabase-js', async () => (await import('../../auth/__tests__/fakes')).supabaseModule)
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./fake-prisma')).fakePrisma }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { revalidatePath } from 'next/cache'
import { RedirectSignal, resetState } from '../../auth/__tests__/fakes'
import { createRotation, renameRotation, setRotationActive } from '../actions/rotations'
import { IDLE, NON_ADMIN_CALLERS, form, isGuardRead, signInAdmin, signInSuperAdmin } from './actors'
import { fakePrisma, uniqueViolation } from './fake-prisma'

const ROTATIONS = '/nutrition/admin/rotations'
const rotations = () => fakePrisma.tables.nutritionRotation
const audit = () => fakePrisma.tables.nutritionAuditLog
const seedRotation = (name: string, isActive = true) =>
  fakePrisma.seed('nutritionRotation', { name, isActive, createdBy: 'auth-seed' }) as { id: string; name: string }

const create = (name: string) => createRotation(IDLE, form({ name }))
const rename = (rotationId: string, name: string) => renameRotation(IDLE, form({ rotationId, name }))
const setActive = (rotationId: string, isActive: string) => setRotationActive(IDLE, form({ rotationId, isActive }))
const DUPLICATE = { status: 'error', message: 'A rotation with this name already exists.', fieldErrors: { name: 'Already exists.' } }

async function refusal(attempt: Promise<unknown>): Promise<string> {
  try {
    await attempt
  } catch (error) {
    if (error instanceof RedirectSignal) return error.path
    throw error
  }
  throw new Error('expected the guard to refuse, but the action ran')
}

beforeEach(() => {
  resetState()
  fakePrisma.reset()
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
  vi.mocked(revalidatePath).mockReset()
})

afterEach(() => {
  expect(fakePrisma.calls.filter((call) => /\.delete(Many)?$/.test(call.op))).toEqual([])
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('createRotation', () => {
  it('creates a trimmed rotation, audited, createdBy the acting admin', async () => {
    signInAdmin()
    expect(await create('  Trauma ICU  ')).toEqual({ status: 'ok', message: 'Rotation "Trauma ICU" added.' })
    expect(rotations()).toEqual([expect.objectContaining({ name: 'Trauma ICU', isActive: true, createdBy: 'auth-admin' })])
    expect(audit()).toEqual([
      expect.objectContaining({
        entity: 'NutritionRotation',
        entityId: rotations()[0].id,
        action: 'create',
        actorId: 'auth-admin',
        before: null,
        after: { id: rotations()[0].id, name: 'Trauma ICU', isActive: true },
      }),
    ])
    expect(fakePrisma.writes().every((write) => write.inTransaction)).toBe(true)
    expect(revalidatePath).toHaveBeenCalledWith(ROTATIONS)
  })

  it('refuses a duplicate name in any case, nothing written', async () => {
    signInAdmin()
    seedRotation('Nephrology')
    expect(await create('NEPHROLOGY')).toEqual(DUPLICATE)
    expect(rotations()).toHaveLength(1)
    expect(fakePrisma.writes()).toEqual([])
  })

  it('the duplicate check compares lower(trim(name)), inside the transaction, before anything is written', async () => {
    signInAdmin()
    // A stored name with stray spaces (saved some other way) still counts.
    seedRotation('  Trauma ICU ')
    expect(await create('trauma icu')).toEqual(DUPLICATE)
    expect(fakePrisma.writes()).toEqual([])
    expect(fakePrisma.calls.find((call) => call.op === '$queryRaw')).toEqual({
      op: '$queryRaw',
      args: { sql: 'SELECT id FROM nutr_rotation WHERE lower(trim(name)) = lower(trim(?)) LIMIT 1', values: ['trauma icu'] },
      inTransaction: true,
    })
  })

  it('a name that only contains or resembles another is not a duplicate', async () => {
    signInAdmin()
    seedRotation('Nephrology')
    seedRotation('ICU_A')
    expect(await create('Nephrology Clinic')).toMatchObject({ status: 'ok' })
    expect(await create('ICUXA')).toMatchObject({ status: 'ok' })
  })

  it('a P2002 from the unique index becomes the same plain error, audit rolled back', async () => {
    signInAdmin()
    fakePrisma.failNext('nutritionRotation.create', uniqueViolation('name'))
    expect(await create('Diabetes Clinic')).toEqual(DUPLICATE)
    expect(rotations()).toEqual([])
    expect(audit()).toEqual([])
  })

  it.each([
    ['', 'Enter a rotation name.'],
    [' x ', 'Enter a rotation name.'],
    ['x'.repeat(81), 'Keep the name under 80 characters.'],
  ])('rejects the name %j with a field error', async (name, message) => {
    signInAdmin()
    expect(await create(name)).toMatchObject({ status: 'error', fieldErrors: { name: message } })
    expect(fakePrisma.writes()).toEqual([])
  })
})

describe('renameRotation', () => {
  it('renames, auditing the old and new name', async () => {
    signInAdmin()
    const rotation = seedRotation('Paeds Cardiology')
    expect(await rename(rotation.id, 'Pediatric Cardiology')).toEqual({ status: 'ok', message: 'Renamed.' })
    expect(rotations()[0]).toMatchObject({ name: 'Pediatric Cardiology' })
    expect(audit()).toEqual([
      expect.objectContaining({
        action: 'rename',
        entityId: rotation.id,
        actorId: 'auth-admin',
        before: { id: rotation.id, name: 'Paeds Cardiology', isActive: true },
        after: { id: rotation.id, name: 'Pediatric Cardiology', isActive: true },
      }),
    ])
  })

  it("refuses another rotation's name in any case, but allows re-casing its own", async () => {
    signInAdmin()
    seedRotation('Nephrology')
    const icu = seedRotation('Trauma ICU')
    expect(await rename(icu.id, 'nephrology')).toEqual(DUPLICATE)
    expect(fakePrisma.writes()).toEqual([])
    expect(await rename(icu.id, 'TRAUMA ICU')).toMatchObject({ status: 'ok' })
  })

  it("the rename check skips the rotation's own row and catches another's name despite case and spaces", async () => {
    signInAdmin()
    seedRotation(' Nephrology  ')
    const icu = seedRotation('Trauma ICU')
    expect(await rename(icu.id, 'NEPHROLOGY')).toEqual(DUPLICATE)
    expect(fakePrisma.writes()).toEqual([])
    expect(fakePrisma.calls.find((call) => call.op === '$queryRaw')).toEqual({
      op: '$queryRaw',
      args: {
        sql: 'SELECT id FROM nutr_rotation WHERE lower(trim(name)) = lower(trim(?)) AND id <> ? LIMIT 1',
        values: ['NEPHROLOGY', icu.id],
      },
      inTransaction: true,
    })
  })

  it('an unknown or malformed id is refused', async () => {
    signInAdmin()
    expect(await rename('6f1c2b8e-4a3d-4f5e-9b7a-1c2d3e4f5a6b', 'Anything')).toEqual({ status: 'error', message: 'This rotation no longer exists.' })
    expect(await rename('42', 'Anything')).toMatchObject({ status: 'error', fieldErrors: { rotationId: 'Invalid id.' } })
  })
})

describe('setRotationActive', () => {
  it('deactivates (never deletes) and reactivates, auditing each', async () => {
    signInAdmin()
    const rotation = seedRotation('Diabetes Clinic')

    expect(await setActive(rotation.id, 'false')).toEqual({ status: 'ok', message: 'Deactivated.' })
    expect(rotations()).toEqual([expect.objectContaining({ id: rotation.id, isActive: false })])
    expect(await setActive(rotation.id, 'true')).toEqual({ status: 'ok', message: 'Reactivated.' })

    expect(audit().map((row) => [row.action, (row.before as { isActive: boolean }).isActive, (row.after as { isActive: boolean }).isActive])).toEqual([
      ['deactivate', true, false],
      ['reactivate', false, true],
    ])
  })

  it('no change: refused, nothing written', async () => {
    signInAdmin()
    const rotation = seedRotation('Diabetes Clinic', false)
    expect(await setActive(rotation.id, 'false')).toEqual({ status: 'error', message: 'Already inactive.' })
    expect(fakePrisma.writes()).toEqual([])
  })

  it('a value other than true/false is a field error', async () => {
    signInAdmin()
    const rotation = seedRotation('Diabetes Clinic')
    expect(await setActive(rotation.id, 'maybe')).toMatchObject({ status: 'error', fieldErrors: { isActive: 'Pick active or inactive.' } })
  })
})

describe('only ADMIN may change rotations', () => {
  function validCalls(): { name: string; run: () => Promise<unknown> }[] {
    const toRename = seedRotation('Old Name')
    const toRetire = seedRotation('To Retire')
    return [
      { name: 'createRotation', run: () => create('New Rotation') },
      { name: 'renameRotation', run: () => rename(toRename.id, 'New Name') },
      { name: 'setRotationActive', run: () => setActive(toRetire.id, 'false') },
    ]
  }

  it.each(NON_ADMIN_CALLERS)('$label: every action is refused (/nutrition/no-access) before it reads or writes anything', async (caller) => {
    const calls = validCalls()
    caller.signIn()
    for (const call of calls) {
      expect(await refusal(call.run()), call.name).toBe('/nutrition/no-access')
    }
    expect(fakePrisma.calls.filter((call) => !isGuardRead(call))).toEqual([])
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('not signed in: refused (/nutrition/login)', async () => {
    for (const call of validCalls()) expect(await refusal(call.run()), call.name).toBe('/nutrition/login')
    expect(fakePrisma.writes()).toEqual([])
  })

  it('a super_admin without a profile: allowed, createdBy and actorId are their auth user id', async () => {
    signInSuperAdmin()
    for (const call of validCalls()) expect(await call.run(), call.name).toMatchObject({ status: 'ok' })
    expect(rotations().find((r) => r.name === 'New Rotation')).toMatchObject({ createdBy: 'auth-boss' })
    expect(audit().map((row) => row.actorId)).toEqual(['auth-boss', 'auth-boss', 'auth-boss'])
  })
})
