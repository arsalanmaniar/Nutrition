import type { NutritionAccess } from '@/features/nutrition/auth/roles'

// The caller's own assessor profile, for the WPBA actions and loaders. A
// preceptor or an assessor files a WPBA under this id, and reads back only the
// WPBAs filed under it, whatever ids a form or a URL carries.

/**
 * The caller's PRECEPTOR or ASSESSOR profile id. Call it right after
 * requireNutritionRole(['PRECEPTOR', 'ASSESSOR']), which only lets in someone
 * whose active profile has one of those roles. Anything else here is a bug, so
 * it throws.
 */
export function ownAssessorId(access: NutritionAccess): string {
  const role = access.profile?.role
  if (!access.profile || (role !== 'PRECEPTOR' && role !== 'ASSESSOR')) {
    throw new Error('nutrition: the caller has no active preceptor or assessor profile')
  }
  return access.profile.id
}
