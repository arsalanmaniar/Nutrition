import { redirect } from 'next/navigation'
import { NUTRITION_NO_ACCESS_PATH, requireNutritionRole } from '@/features/nutrition/auth/guard'
import { NUTRITION_ROLES, dashboardPathFor } from '@/features/nutrition/components/navigation'

// /nutrition sends each person to their dashboard, by role priority:
// ADMIN, PRECEPTOR, UNIT_LEAD, ASSESSOR (the preceptor dashboard), then TRAINEE.
export default async function NutritionHomePage() {
  const access = await requireNutritionRole(NUTRITION_ROLES)
  redirect(dashboardPathFor(access.roles) ?? NUTRITION_NO_ACCESS_PATH)
}
