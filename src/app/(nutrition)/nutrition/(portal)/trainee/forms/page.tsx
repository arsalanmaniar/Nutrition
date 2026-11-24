import Link from 'next/link'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { PageHeader } from '@/features/nutrition/components/admin/PageHeader'
import { CARD } from '@/features/nutrition/components/admin/styles'
import { DuePanel } from '@/features/nutrition/components/forms/DuePanel'
import { pointLabel } from '@/features/nutrition/components/forms/labels'
import { StatusBadge } from '@/features/nutrition/components/logbook/StatusBadge'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { getMyFormsOverview } from '@/features/nutrition/server/queries/evaluation-forms'

const HREF = '/nutrition/trainee/forms'

export default async function TraineeFormsPage() {
  await requireNutritionRole(pageRoles(HREF))
  const overview = await getMyFormsOverview()

  return (
    <section className="max-w-3xl space-y-6">
      <PageHeader
        href={HREF}
        description="Your weekly check-ins, Form 1.1 each month and Form 1.3 at Months 4, 8 and 12. Forms are filled oldest first; a submitted form is locked unless your primary preceptor reopens it."
      />

      {overview.state === 'START_DATE_NOT_SET' && (
        <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Your training start date is not set yet, so no form is due. An admin sets it.
        </p>
      )}
      {overview.state === 'NOT_STARTED' && (
        <p role="note" className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
          Your training starts on {overview.startsOn}. Forms become due from then.
        </p>
      )}
      {overview.formOneThreeUnavailable && (
        <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Form 1.3 is not available right now.
        </p>
      )}
      {!overview.hasPreceptor && !overview.formOneThreeUnavailable && (
        <p role="note" className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
          You have no primary preceptor assigned yet, so Form 1.3 cannot be started.
        </p>
      )}

      <section aria-labelledby="due-title" className="space-y-3">
        <h2 id="due-title" className="text-lg font-semibold text-gray-900">
          Due
          {overview.week !== null && overview.month !== null && (
            <span className="ml-2 text-sm font-normal text-gray-500">
              week {overview.week}, month {overview.month}
            </span>
          )}
        </h2>
        <DuePanel rows={overview.due} empty="Nothing is due right now." />
      </section>

      {overview.formOneThree.length > 0 && (
        <section aria-labelledby="form13-title" className="space-y-3">
          <h2 id="form13-title" className="text-lg font-semibold text-gray-900">
            Your Form 1.3 (confidential)
          </h2>
          <ul className={`${CARD} divide-y divide-gray-100`}>
            {overview.formOneThree.map((row) => (
              <li key={row.assessmentPoint} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-sm text-gray-800">
                  {pointLabel(row.assessmentPoint)}
                  {row.preceptorName && (
                    <>
                      {' '}
                      · about <span dir="auto">{row.preceptorName}</span>
                    </>
                  )}
                </span>
                <span className="flex items-center gap-3">
                  <StatusBadge status={row.status} />
                  <Link href={row.href} className="text-sm font-medium text-red-600 hover:text-red-700">
                    {row.status === 'DRAFT' ? 'Continue' : 'View'}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="forms-title" className="space-y-3">
        <h2 id="forms-title" className="text-lg font-semibold text-gray-900">
          Your forms and evaluations
        </h2>
        {overview.forms.length === 0 ? (
          <p className="text-sm text-gray-500">None yet.</p>
        ) : (
          <ul className={`${CARD} divide-y divide-gray-100`}>
            {overview.forms.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-sm text-gray-800">
                  {row.title} · {pointLabel(row.assessmentPoint)}
                  {row.submittedOn && <span className="text-gray-500"> · submitted {row.submittedOn}</span>}
                </span>
                <span className="flex items-center gap-3">
                  <StatusBadge status={row.status} />
                  <Link href={row.href} className="text-sm font-medium text-red-600 hover:text-red-700">
                    {row.status === 'DRAFT' ? 'Continue' : 'View'}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  )
}
