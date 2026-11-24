import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { ComingSoon } from '@/features/nutrition/components/ComingSoon'
import { pageRoles } from '@/features/nutrition/components/navigation'

const HREF = '/nutrition/admin/certificates'

export default async function AdminCertificatesPage() {
  await requireNutritionRole(pageRoles(HREF))
  return <ComingSoon href={HREF} />
}
