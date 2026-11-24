import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { PageHeader } from '@/features/nutrition/components/admin/PageHeader'
import { CARD } from '@/features/nutrition/components/admin/styles'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { WpbaPercentChart } from '@/features/nutrition/components/portfolio/PortfolioClient'
import { AnalyticsView } from '@/features/nutrition/components/portfolio/PortfolioViews'
import { MIN_GROUP_SIZE } from '@/features/nutrition/config/portfolio'
import { getProgramAnalytics } from '@/features/nutrition/server/queries/portfolio'

const HREF = '/nutrition/admin/analytics'

// Program analytics (Step 7), Kirkpatrick levels 1–4: aggregates only, over
// active trainees. No row names or identifies a trainee, and any group under
// MIN_GROUP_SIZE shows "Not enough data" (the loader hides it, not the page).
export default async function AdminAnalyticsPage() {
  await requireNutritionRole(pageRoles(HREF))
  const analytics = await getProgramAnalytics()
  const bars = analytics.level2.flatMap((entry) => (entry.averagePercent.hidden ? [] : [{ title: entry.title, percent: entry.averagePercent.value }]))

  return (
    <section className="max-w-5xl space-y-6">
      <PageHeader href={HREF} description={`Program-level aggregates only. Groups with fewer than ${MIN_GROUP_SIZE} trainees (or Form 1.3 responses) are not shown.`} />
      <section className={CARD} aria-labelledby="wpba-chart-title">
        <h2 id="wpba-chart-title" className="mb-2 text-base font-semibold text-gray-900">
          WPBA average score by type
        </h2>
        <WpbaPercentChart bars={bars} />
      </section>
      <AnalyticsView analytics={analytics} />
    </section>
  )
}
