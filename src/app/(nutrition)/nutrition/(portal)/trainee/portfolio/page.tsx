import Link from 'next/link'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { PageHeader } from '@/features/nutrition/components/admin/PageHeader'
import { CARD } from '@/features/nutrition/components/admin/styles'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { EpaLevelChart } from '@/features/nutrition/components/portfolio/PortfolioClient'
import { CaseLogCounts, MdgrsTable, SummativeView } from '@/features/nutrition/components/portfolio/PortfolioViews'
import { NOT_RECORDED, checklistText } from '@/features/nutrition/components/portfolio/portfolio-display'
import { ScorecardView } from '@/features/nutrition/components/wpba/WpbaViews'
import { LEARNING_GOALS, RESEARCH_MILESTONES } from '@/features/nutrition/config/portfolio'
import { getMyPortfolio } from '@/features/nutrition/server/queries/portfolio'
import { getMyWpbaScorecard } from '@/features/nutrition/server/queries/wpba'

const HREF = '/nutrition/trainee/portfolio'

// The trainee's own e-portfolio (Step 7), read-only: monthly MDGRS, the Month
// 9 checklist, case log counts, the WPBA scorecard, EPA levels over time,
// learning goals and research milestones. Every loader reads only the
// caller's own records.
export default async function TraineePortfolioPage() {
  await requireNutritionRole(pageRoles(HREF))
  const [portfolio, scorecard] = await Promise.all([getMyPortfolio(), getMyWpbaScorecard()])

  return (
    <section className="max-w-4xl space-y-6">
      <PageHeader href={HREF} description="Your training record in one place. Read-only." />
      {!portfolio ? (
        <p className="text-sm text-gray-500">Your portfolio can&apos;t be shown right now. If this continues, contact the program office.</p>
      ) : (
        <>
          <p>
            <Link href={`${HREF}/summary`} className="text-sm font-medium text-red-600 hover:text-red-700">
              Month 12 performance summary (printable) →
            </Link>
          </p>

          <section className={CARD} aria-labelledby="epa-title">
            <h2 id="epa-title" className="mb-2 text-base font-semibold text-gray-900">
              EPA levels over time
            </h2>
            <EpaLevelChart points={portfolio.epaTimeline} />
            <div className="mt-3">
              <SummativeView summary={portfolio} />
            </div>
          </section>

          <section className={CARD} aria-labelledby="mdgrs-title">
            <h2 id="mdgrs-title" className="mb-2 text-base font-semibold text-gray-900">
              Monthly MDGRS (Form 3.1)
            </h2>
            <MdgrsTable mdgrs={portfolio.mdgrs} />
          </section>

          <ScorecardView traineeName="Your WPBA scorecard" scorecard={scorecard} />

          <section className={CARD} aria-labelledby="logs-title">
            <h2 id="logs-title" className="mb-2 text-base font-semibold text-gray-900">
              Case logs
            </h2>
            <CaseLogCounts counts={portfolio.caseLogs} />
            <p className="mt-3 text-sm text-gray-700">Competency checklist (Month 9 SOP/SOPP): {checklistText(portfolio.checklist)}</p>
          </section>

          <section className={CARD} aria-labelledby="goals-title">
            <h2 id="goals-title" className="mb-2 text-base font-semibold text-gray-900">
              Module learning goals
            </h2>
            <ul className="list-disc space-y-1 ps-5 text-sm text-gray-700">
              {LEARNING_GOALS.map((goal) => (
                <li key={goal}>{goal}</li>
              ))}
            </ul>
          </section>

          <section className={CARD} aria-labelledby="research-title">
            <h2 id="research-title" className="mb-2 text-base font-semibold text-gray-900">
              Research milestones
            </h2>
            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              {RESEARCH_MILESTONES.map((milestone) => (
                <div key={milestone.key}>
                  <dt className="text-gray-500">{milestone.label}</dt>
                  <dd className="text-gray-900">{NOT_RECORDED}</dd>
                </div>
              ))}
            </dl>
          </section>
        </>
      )}
    </section>
  )
}
