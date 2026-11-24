import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { PageHeader } from '@/features/nutrition/components/admin/PageHeader'
import { EpaStatusList } from '@/features/nutrition/components/epa/EpaViews'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { getMyEpaHistory } from '@/features/nutrition/server/queries/epa'

const HREF = '/nutrition/trainee/epa'

// The trainee's own EPA entrustment levels (Step 6b), read-only: each EPA's
// current level and its history. The loader reads only the caller's own rows.
export default async function TraineeEpaPage() {
  await requireNutritionRole(pageRoles(HREF))
  const epas = await getMyEpaHistory()

  return (
    <section className="max-w-3xl space-y-6">
      <PageHeader href={HREF} description="Your entrustment level (E1 to E5) for each EPA, set by your primary preceptor, with every earlier level kept as history." />
      <EpaStatusList epas={epas} />
    </section>
  )
}
