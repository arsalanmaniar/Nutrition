import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NutritionRole } from '@prisma/client'

vi.mock('next/headers', async () => (await import('./fakes')).headersModule)
vi.mock('next/navigation', async () => (await import('./fakes')).navigationModule)
vi.mock('@supabase/supabase-js', async () => (await import('./fakes')).supabaseModule)
vi.mock('@/lib/prisma', async () => (await import('./fakes')).prismaModule)

import { AUTH_TOKEN_COOKIE } from '@/lib/auth-cookie'
import { NUTRITION_LOGIN_PATH, NUTRITION_NO_ACCESS_PATH, requireNutritionRole } from '../guard'
import { RedirectSignal, fakeJwt, resetState, state } from './fakes'

/** Puts a token the fake Supabase server accepts into the request cookie. */
function signIn(userId: string, email: string): string {
  const token = fakeJwt(userId)
  state.validTokens.set(token, { id: userId, email })
  state.cookies.set(AUTH_TOKEN_COOKIE, token)
  return token
}

function addProfile(authUserId: string, role: NutritionRole, isActive = true): void {
  state.profiles.push({ id: `profile-${authUserId}`, authUserId, email: `${authUserId}@example.test`, fullName: authUserId, role, isActive })
}

/** Where the guard redirected to. Fails the test if it granted access instead. */
async function redirectTarget(attempt: Promise<unknown>): Promise<string> {
  try {
    await attempt
  } catch (e) {
    if (e instanceof RedirectSignal) return e.path
    throw e
  }
  throw new Error('expected a redirect, but access was granted')
}

beforeEach(() => {
  resetState()
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('requireNutritionRole: not signed in → /nutrition/login', () => {
  it('no cookie, without calling Supabase', async () => {
    expect(await redirectTarget(requireNutritionRole(['TRAINEE']))).toBe(NUTRITION_LOGIN_PATH)
    expect(state.getUserCalls).toBe(0)
  })

  it('invalid token: well-formed and unexpired, but Supabase rejects it', async () => {
    state.cookies.set(AUTH_TOKEN_COOKIE, fakeJwt('someone'))
    expect(await redirectTarget(requireNutritionRole(['TRAINEE']))).toBe(NUTRITION_LOGIN_PATH)
    expect(state.getUserCalls).toBe(1)
  })

  it('expired token, without calling Supabase', async () => {
    const token = fakeJwt('trainee-1', -60)
    state.validTokens.set(token, { id: 'trainee-1', email: 'trainee-1@example.test' })
    state.cookies.set(AUTH_TOKEN_COOKIE, token)
    addProfile('trainee-1', 'TRAINEE')
    expect(await redirectTarget(requireNutritionRole(['TRAINEE']))).toBe(NUTRITION_LOGIN_PATH)
    expect(state.getUserCalls).toBe(0)
  })

  it('malformed token (not a JWT), without calling Supabase', async () => {
    state.cookies.set(AUTH_TOKEN_COOKIE, 'not-a-jwt')
    expect(await redirectTarget(requireNutritionRole(['TRAINEE']))).toBe(NUTRITION_LOGIN_PATH)
    expect(state.getUserCalls).toBe(0)
  })

  it('missing Supabase env vars: fails closed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    signIn('trainee-1', 'trainee-1@example.test')
    addProfile('trainee-1', 'TRAINEE')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    expect(await redirectTarget(requireNutritionRole(['TRAINEE']))).toBe(NUTRITION_LOGIN_PATH)
  })
})

describe('requireNutritionRole: signed in without an allowed role → /nutrition/no-access', () => {
  it('inactive profile', async () => {
    signIn('trainee-1', 'trainee-1@example.test')
    addProfile('trainee-1', 'TRAINEE', false)
    expect(await redirectTarget(requireNutritionRole(['TRAINEE']))).toBe(NUTRITION_NO_ACCESS_PATH)
  })

  it('no profile at all', async () => {
    signIn('stranger', 'stranger@example.test')
    expect(await redirectTarget(requireNutritionRole(['TRAINEE']))).toBe(NUTRITION_NO_ACCESS_PATH)
  })

  it('wrong role', async () => {
    signIn('trainee-1', 'trainee-1@example.test')
    addProfile('trainee-1', 'TRAINEE')
    expect(await redirectTarget(requireNutritionRole(['PRECEPTOR', 'ADMIN']))).toBe(NUTRITION_NO_ACCESS_PATH)
  })

  it('super_admin on a page that does not allow ADMIN', async () => {
    signIn('boss', 'boss@example.test')
    expect(await redirectTarget(requireNutritionRole(['TRAINEE', 'PRECEPTOR']))).toBe(NUTRITION_NO_ACCESS_PATH)
  })

  it('an allowlisted email that Supabase has not confirmed is not ADMIN', async () => {
    const token = signIn('boss', 'boss@example.test')
    state.validTokens.set(token, { id: 'boss', email: 'boss@example.test', emailConfirmed: false })
    expect(await redirectTarget(requireNutritionRole(['ADMIN']))).toBe(NUTRITION_NO_ACCESS_PATH)
  })

  it('a signed-in account that is not on the allowlist is not ADMIN', async () => {
    signIn('mgr', 'mgr@example.test')
    expect(await redirectTarget(requireNutritionRole(['ADMIN']))).toBe(NUTRITION_NO_ACCESS_PATH)
  })
})

describe('requireNutritionRole: access granted', () => {
  it('correct role: returns the access, with no token in it', async () => {
    const token = signIn('prec-1', 'prec-1@example.test')
    addProfile('prec-1', 'PRECEPTOR')
    const access = await requireNutritionRole(['PRECEPTOR'])
    expect(access).toEqual({
      userId: 'prec-1',
      email: 'prec-1@example.test',
      profile: { id: 'profile-prec-1', email: 'prec-1@example.test', fullName: 'prec-1', role: 'PRECEPTOR' },
      roles: ['PRECEPTOR'],
      isSuperAdmin: false,
    })
    expect(JSON.stringify(access)).not.toContain(token)
  })

  it('any one of several allowed roles is enough', async () => {
    signIn('lead-1', 'lead-1@example.test')
    addProfile('lead-1', 'UNIT_LEAD')
    const access = await requireNutritionRole(['PRECEPTOR', 'UNIT_LEAD'])
    expect(access.roles).toEqual(['UNIT_LEAD'])
  })

  it('super_admin without a profile counts as ADMIN', async () => {
    signIn('boss', 'boss@example.test')
    const access = await requireNutritionRole(['ADMIN'])
    expect(access).toMatchObject({ profile: null, roles: ['ADMIN'], isSuperAdmin: true })
  })
})

describe('requireNutritionRole: failures and isolation', () => {
  it('Prisma profile lookup throws: denied (/nutrition/no-access), never granted, even for a super_admin', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    state.profileLookupFails = true

    signIn('trainee-1', 'trainee-1@example.test')
    addProfile('trainee-1', 'TRAINEE')
    expect(await redirectTarget(requireNutritionRole(['TRAINEE']))).toBe(NUTRITION_NO_ACCESS_PATH)

    signIn('boss', 'boss@example.test')
    expect(await redirectTarget(requireNutritionRole(['ADMIN']))).toBe(NUTRITION_NO_ACCESS_PATH)
  })

  it('two sequential calls with different users never share roles', async () => {
    addProfile('trainee-1', 'TRAINEE')
    addProfile('prec-1', 'PRECEPTOR')

    signIn('trainee-1', 'trainee-1@example.test')
    const first = await requireNutritionRole(['TRAINEE'])
    signIn('prec-1', 'prec-1@example.test')
    const second = await requireNutritionRole(['PRECEPTOR'])
    expect(first).toMatchObject({ userId: 'trainee-1', roles: ['TRAINEE'], isSuperAdmin: false })
    expect(second).toMatchObject({ userId: 'prec-1', roles: ['PRECEPTOR'], isSuperAdmin: false })
    // The second user cannot use the first user's role.
    expect(await redirectTarget(requireNutritionRole(['TRAINEE']))).toBe(NUTRITION_NO_ACCESS_PATH)

    // A super_admin's ADMIN does not carry over to whoever calls next.
    signIn('boss', 'boss@example.test')
    expect(await requireNutritionRole(['ADMIN'])).toMatchObject({ userId: 'boss', isSuperAdmin: true })
    signIn('trainee-1', 'trainee-1@example.test')
    expect(await redirectTarget(requireNutritionRole(['ADMIN']))).toBe(NUTRITION_NO_ACCESS_PATH)
  })
})

it('an empty role list is a programming error, not a silent deny', async () => {
  await expect(requireNutritionRole([])).rejects.toThrow('pass at least one role')
})
