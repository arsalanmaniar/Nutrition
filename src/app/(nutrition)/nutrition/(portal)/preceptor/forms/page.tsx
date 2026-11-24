import Link from 'next/link'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { PageHeader } from '@/features/nutrition/components/admin/PageHeader'
import { CARD } from '@/features/nutrition/components/admin/styles'
import { DuePanel } from '@/features/nutrition/components/forms/DuePanel'
import { pointLabel } from '@/features/nutrition/components/forms/labels'
import { StatusBadge } from '@/features/nutrition/components/logbook/StatusBadge'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { listMyTraineesForms } from '@/features/nutrition/server/queries/evaluation-forms'

const HREF = '/nutrition/preceptor/forms'

export default async function PreceptorFormsPage() {
  await requireNutritionRole(pageRoles(HREF))
  const trainees = await listMyTraineesForms()

  return (
    <section className="max-w-3xl space-y-6">
      <PageHeader
        href={HREF}
        description="For each trainee you are the primary preceptor of: Form 3.1 (MDGRS) each month and Form 1.2 at Months 4, 8 and 12, and their weekly check-ins to comment on. Forms are filled oldest first."
      />
      {trainees.length === 0 && <p className="text-sm text-gray-500">You are not the primary preceptor of any trainee.</p>}
      {trainees.map((trainee) => (
        <section key={trainee.traineeId} className="space-y-3" aria-label={trainee.traineeName}>
          <h2 dir="auto" className="text-lg font-semibold text-gray-900">
            {trainee.traineeName}
            {trainee.week !== null && trainee.month !== null && (
              <span className="ml-2 text-sm font-normal text-gray-500">
                week {trainee.week}, month {trainee.month}
              </span>
            )}
          </h2>
          {trainee.state === 'START_DATE_NOT_SET' && <p className="text-sm text-gray-500">Training start date not set, so nothing is due.</p>}
          {trainee.state === 'NOT_STARTED' && <p className="text-sm text-gray-500">Training starts on {trainee.startsOn}.</p>}
          <DuePanel rows={trainee.due} traineeId={trainee.traineeId} empty="No form is due from you for this trainee." />

          {trainee.weekly.length > 0 && (
            <div className={CARD}>
              <h3 className="text-sm font-semibold text-gray-900">Weekly check-ins</h3>
              <ul className="mt-2 divide-y divide-gray-100">
                {trainee.weekly.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="text-gray-800">
                      {pointLabel(row.assessmentPoint)}
                      {row.submittedOn && <span className="text-gray-500"> · submitted {row.submittedOn}</span>}
                    </span>
                    <Link href={row.href} className="font-medium text-red-600 hover:text-red-700">
                      {row.commented ? 'View (commented)' : 'View and comment'}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {trainee.submitted.length > 0 && (
            <div className={CARD}>
              <h3 className="text-sm font-semibold text-gray-900">Submitted forms</h3>
              <ul className="mt-2 divide-y divide-gray-100">
                {trainee.submitted.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="text-gray-800">
                      {row.title} · {pointLabel(row.assessmentPoint)}
                    </span>
                    <span className="flex items-center gap-3">
                      <StatusBadge status={row.status} />
                      <Link href={row.href} className="font-medium text-red-600 hover:text-red-700">
                        View
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ))}
    </section>
  )
}
