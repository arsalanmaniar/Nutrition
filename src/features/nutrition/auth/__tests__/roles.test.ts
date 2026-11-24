import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NutritionRole } from '@prisma/client'

vi.mock('@supabase/supabase-js', async () => (await import('./fakes')).supabaseModule)
vi.mock('@/lib/prisma', async () => (await import('./fakes')).prismaModule)

import { canSeeIndividualForm13, resolveNutritionAccess, type NutritionAccess } from '../roles'
import type { NutritionSession } from '../session'
import { fakeJwt, resetState, state } from './fakes'

/** A session whose token the fake Supabase server accepts (as session.ts would have verified). */
function session(userId: string, email: string, emailConfirmed = true): NutritionSession {
  const accessToken = fakeJwt(userId)
  state.validTokens.set(accessToken, { id: userId, email, emailConfirmed })
  return { userId, email, emailConfirmed, accessToken }
}

function addProfile(authUserId: string | null, role: NutritionRole, isActive = true, email = `${authUserId}@example.test`): void {
  state.profiles.push({ id: `profile-${authUserId}`, authUserId, email, fullName: String(authUserId), role, isActive })
}

function access(overrides: Partial<NutritionAccess>): NutritionAccess {
  return { userId: 'u', email: 'u@example.test', profile: null, roles: [], isSuperAdmin: false, ...overrides }
}

beforeEach(() => {
  resetState()
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('resolveNutritionAccess', () => {
  it('correct role: an active profile gives its role', async () => {
    addProfile('trainee-1', 'TRAINEE')
    const result = await resolveNutritionAccess(session('trainee-1', 'trainee-1@example.test'))
    expect(result).toMatchObject({ roles: ['TRAINEE'], isSuperAdmin: false, profile: { role: 'TRAINEE' } })
  })

  it('inactive profile: no roles', async () => {
    addProfile('trainee-1', 'TRAINEE', false)
    const result = await resolveNutritionAccess(session('trainee-1', 'trainee-1@example.test'))
    expect(result).toMatchObject({ roles: [], profile: null })
  })

  it('looks profiles up by Supabase user id, not by email', async () => {
    addProfile('someone-else', 'PRECEPTOR', true, 'shared@example.test')
    const result = await resolveNutritionAccess(session('me', 'shared@example.test'))
    expect(result.roles).toEqual([])
  })

  it('allowlisted super admin without a profile: ADMIN', async () => {
    const result = await resolveNutritionAccess(session('boss', 'boss@example.test'))
    expect(result).toMatchObject({ roles: ['ADMIN'], isSuperAdmin: true, profile: null })
  })

  it('allowlisted super admin who also has a TRAINEE profile: both roles', async () => {
    addProfile('boss', 'TRAINEE')
    const result = await resolveNutritionAccess(session('boss', 'boss@example.test'))
    expect(result.roles).toEqual(['TRAINEE', 'ADMIN'])
  })

  it('allowlist match ignores case and surrounding spaces', async () => {
    const result = await resolveNutritionAccess(session('boss', '  BOSS@Example.test '))
    expect(result).toMatchObject({ roles: ['ADMIN'], isSuperAdmin: true })
  })

  it('an allowlisted email that is not confirmed is not ADMIN', async () => {
    const result = await resolveNutritionAccess(session('boss', 'boss@example.test', false))
    expect(result).toMatchObject({ roles: [], isSuperAdmin: false })
  })

  it('an email not on the allowlist is not ADMIN', async () => {
    const result = await resolveNutritionAccess(session('person', 'person@example.test'))
    expect(result).toMatchObject({ roles: [], isSuperAdmin: false })
  })

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['only separators', ' , ,'],
  ])('allowlist %s: nobody is a super admin', async (_label, value) => {
    if (value === undefined) vi.stubEnv('NUTRITION_SUPER_ADMIN_EMAILS', undefined as unknown as string)
    else vi.stubEnv('NUTRITION_SUPER_ADMIN_EMAILS', value)
    const result = await resolveNutritionAccess(session('boss', 'boss@example.test'))
    expect(result).toMatchObject({ roles: [], isSuperAdmin: false })
  })

  it('a super admin who also has a profile keeps it when the allowlist is changed', async () => {
    addProfile('boss', 'PRECEPTOR')
    vi.stubEnv('NUTRITION_SUPER_ADMIN_EMAILS', 'someone.else@example.test')
    const result = await resolveNutritionAccess(session('boss', 'boss@example.test'))
    expect(result).toMatchObject({ roles: ['PRECEPTOR'], isSuperAdmin: false })
  })
})

describe('canSeeIndividualForm13', () => {
  const profile = (role: NutritionRole) => ({ id: 'p', email: 'p@example.test', fullName: 'P', role })

  it('super_admin: never, even with a TRAINEE profile', () => {
    expect(canSeeIndividualForm13(access({ isSuperAdmin: true, roles: ['ADMIN'] }))).toBe(false)
    expect(canSeeIndividualForm13(access({ isSuperAdmin: true, roles: ['TRAINEE', 'ADMIN'], profile: profile('TRAINEE') }))).toBe(false)
  })

  it.each(['ADMIN', 'PRECEPTOR', 'UNIT_LEAD', 'ASSESSOR'] as const)('%s profile: never', (role) => {
    expect(canSeeIndividualForm13(access({ roles: [role], profile: profile(role) }))).toBe(false)
  })

  it('no profile: never', () => {
    expect(canSeeIndividualForm13(access({}))).toBe(false)
  })

  it('TRAINEE: yes (their own rows only; Step 4 matches authorHash)', () => {
    expect(canSeeIndividualForm13(access({ roles: ['TRAINEE'], profile: profile('TRAINEE') }))).toBe(true)
  })
})
