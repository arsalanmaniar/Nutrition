import type { NutritionAccess } from '@/features/nutrition/auth/roles'

// The caller's own trainee profile, for the e-logbook's actions and loaders.
// They filter every query by this id, so a trainee only ever reaches their own
// records, whatever ids a form or a URL carries.

/**
 * The caller's trainee profile id. Call it right after
 * requireNutritionRole(['TRAINEE']), which only lets in someone whose active
 * profile is a trainee's. Anything else here is a bug, so it throws.
 */
export function ownTraineeId(access: NutritionAccess): string {
  if (access.profile?.role !== 'TRAINEE') throw new Error('nutrition: the caller has no active trainee profile')
  return access.profile.id
}
