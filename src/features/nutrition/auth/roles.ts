import type { NutritionRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { NutritionSession } from './session'

// What a signed-in person may do in the nutrition module.
//
// Roles come from NutritionProfile, looked up by Supabase user id, active rows
// only. Separately, a super admin counts as nutrition ADMIN, with or without a
// profile. A super admin is a signed-in account whose CONFIRMED email is on the
// NUTRITION_SUPER_ADMIN_EMAILS allowlist (comma-separated, case-insensitive).
// The email comes from session.ts, which had Supabase's auth server verify the
// token, so a forged cookie cannot claim an allowlisted email. An unset or
// empty allowlist means there is no super admin.

export interface ActiveNutritionProfile {
  id: string
  email: string
  fullName: string
  role: NutritionRole
}

export interface NutritionAccess {
  userId: string
  email: string
  /** The person's active NutritionProfile, if they have one. */
  profile: ActiveNutritionProfile | null
  /** Effective roles: the profile's role, plus ADMIN for a super admin. */
  roles: readonly NutritionRole[]
  isSuperAdmin: boolean
}

/** The allowlisted super admin emails, lower-cased. Read on every call so a changed env applies. */
export function superAdminEmails(): ReadonlySet<string> {
  const raw = process.env.NUTRITION_SUPER_ADMIN_EMAILS ?? ''
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0),
  )
}

export function isSuperAdminSession(session: NutritionSession): boolean {
  return session.emailConfirmed && superAdminEmails().has(session.email.trim().toLowerCase())
}

export async function resolveNutritionAccess(session: NutritionSession): Promise<NutritionAccess> {
  try {
    const profile = await prisma.nutritionProfile.findFirst({
      where: { authUserId: session.userId, isActive: true },
      select: { id: true, email: true, fullName: true, role: true },
    })

    const isSuperAdmin = isSuperAdminSession(session)
    const roles = new Set<NutritionRole>()
    if (profile) roles.add(profile.role)
    if (isSuperAdmin) roles.add('ADMIN')

    return { userId: session.userId, email: session.email, profile, roles: [...roles], isSuperAdmin }
  } catch (error) {
    // Fail closed: if the lookup fails, nobody gets any role, a super admin
    // included, so the guard sends them to /nutrition/no-access.
    console.error('nutrition roles: access lookup failed — denying access', error)
    return { userId: session.userId, email: session.email, profile: null, roles: [], isSuperAdmin: false }
  }
}

/**
 * May this person ever be shown an individual Form 1.3 row, rather than only
 * aggregates? Only a trainee, the one possible author, and Step 4 must still
 * match the row's authorHash to them. Everyone else sees aggregates only:
 * preceptors, unit leads, every ADMIN, and a super admin even if they also hold
 * a trainee profile (plan decision 5).
 */
export function canSeeIndividualForm13(access: NutritionAccess): boolean {
  return !access.isSuperAdmin && access.profile?.role === 'TRAINEE'
}
