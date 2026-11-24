import Link from 'next/link'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { PrintButton } from '@/features/nutrition/components/portfolio/PortfolioClient'
import { PerformanceSummaryView } from '@/features/nutrition/components/portfolio/PortfolioViews'
import { getMyPortfolio } from '@/features/nutrition/server/queries/portfolio'

const PORTFOLIO_HREF = '/nutrition/trainee/portfolio'

// The trainee's own Month 12 final performance summary (Step 7): a printable
// page (window.print(), no PDF library), from the same loader as the
// portfolio, so it shows only the caller's own records.
export default async function TraineeSummaryPage() {
  await requireNutritionRole(pageRoles(PORTFOLIO_HREF))
  const summary = await getMyPortfolio()

  return (
    <section className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={PORTFOLIO_HREF} className="text-sm font-medium text-red-600 hover:text-red-700">
          ← Portfolio
        </Link>
        <PrintButton label="Print summary" />
      </div>
      <h1 className="text-2xl font-bold text-gray-900">Month 12 final performance summary</h1>
      {summary ? <PerformanceSummaryView summary={summary} /> : <p className="text-sm text-gray-500">Your summary is not available.</p>}
    </section>
  )
}
