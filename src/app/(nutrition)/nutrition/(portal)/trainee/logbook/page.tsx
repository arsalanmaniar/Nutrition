import Link from 'next/link'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { PageHeader } from '@/features/nutrition/components/admin/PageHeader'
import { PRIMARY_BUTTON } from '@/features/nutrition/components/admin/styles'
import { CaseLogList } from '@/features/nutrition/components/logbook/CaseLogList'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { listMyCaseLogs } from '@/features/nutrition/server/queries/case-logs'

const HREF = '/nutrition/trainee/logbook'

export default async function TraineeLogbookPage() {
  await requireNutritionRole(pageRoles(HREF))
  const logs = await listMyCaseLogs()

  return (
    <section className="max-w-3xl space-y-6">
      <PageHeader
        href={HREF}
        description="Your clinical case logs. Save a draft, then submit it for your preceptor's review. A submitted log can no longer be changed; a rejected one comes back to you to edit and resubmit."
      />
      <Link href={`${HREF}/new`} className={`${PRIMARY_BUTTON} inline-block`}>
        New case log
      </Link>
      <CaseLogList logs={logs} />
    </section>
  )
}
