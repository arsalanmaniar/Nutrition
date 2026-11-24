import Link from 'next/link'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { CARD } from '@/features/nutrition/components/admin/styles'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { IssueCertificateForm, PrintButton } from '@/features/nutrition/components/portfolio/PortfolioClient'
import { PerformanceSummaryView } from '@/features/nutrition/components/portfolio/PortfolioViews'
import { getTraineeSummary } from '@/features/nutrition/server/queries/portfolio'

const EPA_HREF = '/nutrition/preceptor/epa'

// The Month 12 final performance summary of one trainee, for their ACTIVE
// primary preceptor (Step 7), with the summative sign-off that issues the
// certificate of completion. Same loader rules as the trainee's own summary;
// the loader returns null for a trainee who is not the caller's, and the
// sign-off action checks every rule again.
export default async function PreceptorSummaryPage({ params }: { params: Promise<{ traineeId: string }> }) {
  await requireNutritionRole(pageRoles(EPA_HREF))
  const { traineeId } = await params
  const summary = await getTraineeSummary(traineeId)

  return (
    <section className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`${EPA_HREF}?trainee=${encodeURIComponent(traineeId)}`} className="text-sm font-medium text-red-600 hover:text-red-700">
          ← EPA & standards
        </Link>
        {summary && <PrintButton label="Print summary" />}
      </div>
      <h1 className="text-2xl font-bold text-gray-900">Month 12 final performance summary</h1>
      {!summary ? (
        <p className="text-sm text-gray-500">This trainee was not found among your trainees.</p>
      ) : (
        <>
          <PerformanceSummaryView summary={summary} />
          {summary.summative.met && summary.reachedMonth12 && !(summary.credential && !summary.credential.revoked) && (
            <section className={`${CARD} print:hidden`} aria-label="Summative sign-off">
              <h2 className="mb-2 text-base font-semibold text-gray-900">Summative sign-off</h2>
              <IssueCertificateForm traineeId={summary.traineeId} />
            </section>
          )}
        </>
      )}
    </section>
  )
}
