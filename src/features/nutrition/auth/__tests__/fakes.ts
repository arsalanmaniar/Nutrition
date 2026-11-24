// Boundary fakes for the nutrition auth tests (not itself a test file).
//
// Only the edges are faked: the Supabase auth server, the two Prisma tables the
// auth code reads, the request cookie jar and Next's redirect. Everything in
// between runs for real: session.ts, roles.ts and guard.ts, plus
// src/lib/auth-cookie.ts. Super admins come from NUTRITION_SUPER_ADMIN_EMAILS,
// which vitest.config.mts sets for every test.

import type { NutritionRole } from '@prisma/client'

/** What the fake redirect throws, standing in for Next's NEXT_REDIRECT error. */
export class RedirectSignal extends Error {
  readonly path: string
  constructor(path: string) {
    super(`redirect to ${path}`)
    this.path = path
  }
}

interface FakeProfile {
  id: string
  authUserId: string | null
  email: string
  fullName: string
  role: NutritionRole
  isActive: boolean
}

export const state = {
  cookies: new Map<string, string>(),
  /** Tokens the fake Supabase auth server accepts, and the user each belongs to. */
  validTokens: new Map<string, { id: string; email: string; emailConfirmed?: boolean }>(),
  profiles: [] as FakeProfile[],
  getUserCalls: 0,
  /** When true, the NutritionProfile lookup throws, as it would if the database were down. */
  profileLookupFails: false,
}

export function resetState(): void {
  state.cookies.clear()
  state.validTokens.clear()
  state.profiles = []
  state.getUserCalls = 0
  state.profileLookupFails = false
}

/** A JWT-shaped token expiring `secondsFromNow` from now. Its signature is fake; validTokens decides. */
export function fakeJwt(subject: string, secondsFromNow = 3600): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: subject, exp: Math.floor(Date.now() / 1000) + secondsFromNow })}.fake-signature`
}

export const supabaseModule = {
  createClient: () => ({
    auth: {
      getUser: async (token: string) => {
        state.getUserCalls++
        const user = state.validTokens.get(token)
        if (!user) return { data: { user: null }, error: new Error('invalid JWT') }
        // Confirmed unless a test says otherwise, as for every account an admin creates.
        const confirmedAt = user.emailConfirmed === false ? null : '2026-01-01T00:00:00.000Z'
        return { data: { user: { id: user.id, email: user.email, email_confirmed_at: confirmedAt } }, error: null }
      },
    },
  }),
}

export const prismaModule = {
  prisma: {
    nutritionProfile: {
      // Honours the same `where` filters as Postgres would, so a query that
      // forgets `isActive: true` returns the inactive row and the tests catch it.
      findFirst: async ({ where }: { where: { authUserId?: string; isActive?: boolean } }) => {
        if (state.profileLookupFails) throw new Error('fake: connection to the database refused')
        const row = state.profiles.find(
          (p) =>
            (where.authUserId === undefined || p.authUserId === where.authUserId) &&
            (where.isActive === undefined || p.isActive === where.isActive),
        )
        return row ? { id: row.id, email: row.email, fullName: row.fullName, role: row.role } : null
      },
    },
  },
}

export const headersModule = {
  cookies: async () => ({
    get: (name: string) => (state.cookies.has(name) ? { name, value: state.cookies.get(name) as string } : undefined),
  }),
}

export const navigationModule = {
  redirect: (path: string): never => {
    throw new RedirectSignal(path)
  },
}
