import type { NutritionAccess } from '@/features/nutrition/auth/roles'

// The caller's own preceptor profile, for the case-log review's actions and
// loaders. They look up the caller's active assignments by this id, so a
// preceptor only ever reaches their own trainees' records, whatever ids a form
// or a URL carries.

/**
 * The caller's preceptor profile id. Call it right after
 * requireNutritionRole(['PRECEPTOR']), which only lets in someone whose active
 * profile is a preceptor's. Anything else here is a bug, so it throws.
 */
export function ownPreceptorId(access: NutritionAccess): string {
  if (access.profile?.role !== 'PRECEPTOR') throw new Error('nutrition: the caller has no active preceptor profile')
  return access.profile.id
}
