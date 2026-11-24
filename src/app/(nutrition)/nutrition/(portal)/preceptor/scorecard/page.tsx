import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { PageHeader } from '@/features/nutrition/components/admin/PageHeader'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { ScorecardView } from '@/features/nutrition/components/wpba/WpbaViews'
import { listPrimaryTraineeScorecards } from '@/features/nutrition/server/queries/wpba-picker'

const HREF = '/nutrition/preceptor/scorecard'

// WPBA scorecards for the trainees the caller is ACTIVE primary preceptor of:
// aggregates only (count and latest score per type, highest Miller level). No
// individual WPBA is shown here.
export default async function PreceptorScorecardPage() {
  await requireNutritionRole(pageRoles(HREF))
  const scorecards = await listPrimaryTraineeScorecards()

  return (
    <section className="max-w-3xl space-y-6">
      <PageHeader href={HREF} description="For each trainee you are primary preceptor of: how many of each WPBA, the latest score, and the highest Miller level reached." />
      {scorecards.length === 0 && <p className="text-sm text-gray-500">You are not the primary preceptor of any trainee.</p>}
      {scorecards.map((card, i) => (
        <ScorecardView key={i} traineeName={card.traineeName} scorecard={card.scorecard} />
      ))}
    </section>
  )
}
