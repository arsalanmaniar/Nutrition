import { cache } from 'react'
import { redirect } from 'next/navigation'
import type { NutritionRole } from '@prisma/client'
import { getNutritionSession } from './session'
import { resolveNutritionAccess, type NutritionAccess } from './roles'

// The one gate for the nutrition module.
//
// Call requireNutritionRole at the top of EVERY page and EVERY server action,
// never only in a layout: layouts do not re-render on client-side navigation,
// and a server action can be called directly, like a public API endpoint,
// whatever page rendered it. src/proxy.ts does not cover /nutrition, so nothing
// else stands in front of these routes.
//
// Not for the public pages: /nutrition/login, /nutrition/no-access, the MSF
// links (/nutrition/msf/[token]) and certificate checks (/nutrition/verify/[id]).

export const NUTRITION_LOGIN_PATH = '/nutrition/login'
export const NUTRITION_NO_ACCESS_PATH = '/nutrition/no-access'

// Session check plus role lookup, once per request render.
const getNutritionAccess = cache(async (): Promise<NutritionAccess | null> => {
  const session = await getNutritionSession()
  return session ? resolveNutritionAccess(session) : null
})

/**
 * Returns the caller's access when they hold at least one of `allowed`.
 * Not signed in: redirects to /nutrition/login. Signed in without an allowed
 * role (including an inactive profile): redirects to /nutrition/no-access.
 */
export async function requireNutritionRole(allowed: readonly NutritionRole[]): Promise<NutritionAccess> {
  if (allowed.length === 0) throw new Error('requireNutritionRole: pass at least one role')

  const access = await getNutritionAccess()
  if (!access) redirect(NUTRITION_LOGIN_PATH)
  if (!access.roles.some((role) => allowed.includes(role))) redirect(NUTRITION_NO_ACCESS_PATH)
  return access
}
