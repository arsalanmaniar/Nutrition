import type { NutritionRole } from '@prisma/client'
import { NUTRITION_ROLES } from '../navigation'

// How the admin pages name each role. Pure data, safe in client components.

export const ROLE_LABELS: Record<NutritionRole, string> = {
  TRAINEE: 'Trainee',
  PRECEPTOR: 'Preceptor',
  UNIT_LEAD: 'Rotation unit lead',
  ASSESSOR: 'Interprofessional assessor',
  ADMIN: 'Admin',
}

export const ROLE_OPTIONS = NUTRITION_ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }))
