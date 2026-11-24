import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { ComingSoon } from '@/features/nutrition/components/ComingSoon'
import { pageRoles } from '@/features/nutrition/components/navigation'

const HREF = '/nutrition/unit-lead'

export default async function UnitLeadPage() {
  const access = await requireNutritionRole(pageRoles(HREF))
  return <ComingSoon href={HREF} greeting={access.profile?.fullName ?? access.email} />
}
