import Link from 'next/link'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { PageHeader } from '@/features/nutrition/components/admin/PageHeader'
import { CARD } from '@/features/nutrition/components/admin/styles'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { getMyDueNow } from '@/features/nutrition/server/queries/evaluation-forms'

const HREF = '/nutrition/trainee'

export default async function TraineePage() {
  const access = await requireNutritionRole(pageRoles(HREF))
  const due = await getMyDueNow()

  return (
    <section className="max-w-2xl space-y-6">
      <PageHeader href={HREF} description={`Welcome, ${access.profile?.fullName ?? access.email}.`} />
      <Link href="/nutrition/trainee/forms" className={`${CARD} block transition-colors hover:border-red-300`}>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Due now</p>
        {due.state === 'START_DATE_NOT_SET' ? (
          <p className="mt-1 text-sm text-gray-600">Your training start date is not set yet, so no form is due.</p>
        ) : due.state === 'NOT_STARTED' ? (
          <p className="mt-1 text-sm text-gray-600">Your training starts on {due.startsOn}.</p>
        ) : (
          <>
            <p className="mt-1 text-3xl font-bold text-gray-900">{due.dueNow}</p>
            <p className="text-sm text-gray-600">
              {due.dueNow === 1 ? 'form is' : 'forms are'} due
              {due.week !== null && due.month !== null ? ` (week ${due.week}, month ${due.month})` : ''}
              {due.overdue > 0 && <span className="font-medium text-red-700"> · {due.overdue} overdue</span>}
            </p>
          </>
        )}
      </Link>
    </section>
  )
}
