// Who is calling, for the server action tests (not itself a test file).
//
// The real guard runs: requireNutritionRole reads the auth cookie, the fake
// Supabase server accepts the token, and roles.ts looks the caller up in the
// fake database. Only the edges are faked (see ../../auth/__tests__/fakes.ts
// and ./fake-prisma.ts).

import type { NutritionRole } from '@prisma/client'
import { AUTH_TOKEN_COOKIE } from '@/lib/auth-cookie'
import type { ActionResult } from '@/features/nutrition/lib/action-result'
import { fakeJwt, state } from '../../auth/__tests__/fakes'
import { fakePrisma, type Call } from './fake-prisma'

export const IDLE: ActionResult = { status: 'idle' }

/** Puts a token for this Supabase user in the request cookie. Returns the token. */
export function signIn(authUserId: string, email: string): string {
  const token = fakeJwt(authUserId)
  state.validTokens.set(token, { id: authUserId, email })
  state.cookies.set(AUTH_TOKEN_COOKIE, token)
  return token
}

let counter = 0

export interface SeededProfile {
  id: string
  authUserId: string | null
  email: string
  fullName: string
  role: NutritionRole
  isActive: boolean
}

export function seedProfile(
  role: NutritionRole,
  fields: Partial<{ authUserId: string | null; email: string; fullName: string; isActive: boolean; trainingStartDate: Date | null }> = {},
): SeededProfile {
  counter++
  return fakePrisma.seed('nutritionProfile', {
    authUserId: `auth-${role.toLowerCase()}-${counter}`,
    email: `${role.toLowerCase()}.${counter}@cdnep.test`,
    fullName: `${role[0]}${role.slice(1).toLowerCase()} ${counter}`,
    role,
    createdBy: 'auth-seed',
    ...fields,
  }) as unknown as SeededProfile
}

export function seedAssignment(traineeId: string, preceptorId: string, active = true): { id: string } {
  return fakePrisma.seed('nutritionPreceptorAssignment', { traineeId, preceptorId, active, createdBy: 'auth-seed' }) as { id: string }
}

/** An active nutrition ADMIN (with a profile), signed in. */
export function signInAdmin(): { authUserId: string; profile: SeededProfile; token: string } {
  const profile = seedProfile('ADMIN', { authUserId: 'auth-admin', email: 'admin@cdnep.test', fullName: 'Admin Person' })
  return { authUserId: 'auth-admin', profile, token: signIn('auth-admin', 'admin@cdnep.test') }
}

/** A super admin (email on NUTRITION_SUPER_ADMIN_EMAILS, see vitest.config.mts) with NO nutrition profile, signed in. */
export function signInSuperAdmin(): { authUserId: string; token: string } {
  return { authUserId: 'auth-boss', token: signIn('auth-boss', 'boss@cdnep.test') }
}

/**
 * Callers who must be refused by an ADMIN-only action: every other nutrition
 * role, an ADMIN whose profile was deactivated, and a signed-in account with no profile.
 */
export const NON_ADMIN_CALLERS: { label: string; signIn: () => void }[] = [
  ...(['TRAINEE', 'PRECEPTOR', 'UNIT_LEAD', 'ASSESSOR'] as const).map((role) => ({
    label: role,
    signIn: () => {
      const p = seedProfile(role, { authUserId: `auth-caller-${role}`, email: `caller.${role.toLowerCase()}@cdnep.test` })
      signIn(p.authUserId as string, p.email)
    },
  })),
  {
    label: 'deactivated ADMIN',
    signIn: () => {
      seedProfile('ADMIN', { authUserId: 'auth-former-admin', email: 'former.admin@cdnep.test', isActive: false })
      signIn('auth-former-admin', 'former.admin@cdnep.test')
    },
  },
  {
    label: 'signed-in account with no profile, not on the super admin allowlist',
    signIn: () => {
      signIn('auth-outsider', 'outsider@cdnep.test')
    },
  },
]

/** A new active TRAINEE, signed in. */
export function signInTrainee(): SeededProfile {
  const profile = seedProfile('TRAINEE')
  signIn(profile.authUserId as string, profile.email)
  return profile
}

/**
 * Callers who must be refused by a TRAINEE-only action: every other nutrition
 * role, a super_admin without a profile (nutrition ADMIN), a TRAINEE whose
 * profile was deactivated, and a signed-in account with no profile.
 */
export const NON_TRAINEE_CALLERS: { label: string; signIn: () => void }[] = [
  ...(['PRECEPTOR', 'UNIT_LEAD', 'ASSESSOR', 'ADMIN'] as const).map((role) => ({
    label: role,
    signIn: () => {
      const p = seedProfile(role, { authUserId: `auth-caller-${role}`, email: `caller.${role.toLowerCase()}@cdnep.test` })
      signIn(p.authUserId as string, p.email)
    },
  })),
  {
    label: 'super_admin without a profile',
    signIn: () => {
      signInSuperAdmin()
    },
  },
  {
    label: 'deactivated TRAINEE',
    signIn: () => {
      seedProfile('TRAINEE', { authUserId: 'auth-former-trainee', email: 'former.trainee@cdnep.test', isActive: false })
      signIn('auth-former-trainee', 'former.trainee@cdnep.test')
    },
  },
  {
    label: 'signed-in account with no profile, not on the super admin allowlist',
    signIn: () => {
      signIn('auth-outsider', 'outsider@cdnep.test')
    },
  },
]

/** A new active PRECEPTOR, signed in. */
export function signInPreceptor(fields: Partial<{ fullName: string }> = {}): SeededProfile {
  const profile = seedProfile('PRECEPTOR', fields)
  signIn(profile.authUserId as string, profile.email)
  return profile
}

/**
 * Callers who must be refused by a PRECEPTOR-only action: every other
 * nutrition role, a super_admin without a profile (nutrition ADMIN), a
 * PRECEPTOR whose profile was deactivated, and a signed-in account with no profile.
 */
export const NON_PRECEPTOR_CALLERS: { label: string; signIn: () => void }[] = [
  ...(['TRAINEE', 'UNIT_LEAD', 'ASSESSOR', 'ADMIN'] as const).map((role) => ({
    label: role,
    signIn: () => {
      const p = seedProfile(role, { authUserId: `auth-caller-${role}`, email: `caller.${role.toLowerCase()}@cdnep.test` })
      signIn(p.authUserId as string, p.email)
    },
  })),
  {
    label: 'super_admin without a profile',
    signIn: () => {
      signInSuperAdmin()
    },
  },
  {
    label: 'deactivated PRECEPTOR',
    signIn: () => {
      seedProfile('PRECEPTOR', { authUserId: 'auth-former-preceptor', email: 'former.preceptor@cdnep.test', isActive: false })
      signIn('auth-former-preceptor', 'former.preceptor@cdnep.test')
    },
  },
  {
    label: 'signed-in account with no profile, not on the super admin allowlist',
    signIn: () => {
      signIn('auth-outsider', 'outsider@cdnep.test')
    },
  },
]

/** The guard's own lookup: the caller's active profile. */
export function isGuardRead(call: Call): boolean {
  if (call.op !== 'nutritionProfile.findFirst') return false
  const where = (call.args as { where?: Record<string, unknown> }).where ?? {}
  return Object.keys(where).sort().join(',') === 'authUserId,isActive' && where.isActive === true
}

export function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}
