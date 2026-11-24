import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { PageHeader } from '@/features/nutrition/components/admin/PageHeader'
import { RotationsAdmin } from '@/features/nutrition/components/admin/RotationsAdmin'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { listRotations } from '@/features/nutrition/server/queries/rotations'

const HREF = '/nutrition/admin/rotations'

export default async function AdminRotationsPage() {
  await requireNutritionRole(pageRoles(HREF))
  const rotations = await listRotations()

  return (
    <section className="max-w-3xl space-y-6">
      <PageHeader
        href={HREF}
        description="The clinical rotations trainees log cases against. Retire a rotation by deactivating it; it is never deleted, so old case logs keep it."
      />
      <RotationsAdmin rotations={rotations} />
    </section>
  )
}
