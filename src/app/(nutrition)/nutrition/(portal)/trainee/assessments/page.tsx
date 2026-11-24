import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { PageHeader } from '@/features/nutrition/components/admin/PageHeader'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { WpbaList } from '@/features/nutrition/components/wpba/WpbaViews'
import { listMyWpbas } from '@/features/nutrition/server/queries/wpba'

const HREF = '/nutrition/trainee/assessments'

// The trainee's own WPBAs (listMyWpbas filters by their own profile), newest
// first, as the server stored them. Of the assessor, only the display name the
// loader returns is shown.
export default async function TraineeAssessmentsPage() {
  await requireNutritionRole(pageRoles(HREF))
  const rows = await listMyWpbas()

  return (
    <section className="max-w-3xl space-y-6">
      <PageHeader href={HREF} description="Your workplace-based assessments (Mini-CEX, DOPS, CbD, OSCE), newest first, with scores and written feedback." />
      <p role="note" className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
        WPBAs are final: once submitted they are not edited. If something needs correcting, your assessor files a new assessment.
      </p>
      <WpbaList
        rows={rows.map((row) => ({ ...row, person: row.assessorName }))}
        personLabel="Assessor"
        empty="No assessments yet."
      />
    </section>
  )
}
