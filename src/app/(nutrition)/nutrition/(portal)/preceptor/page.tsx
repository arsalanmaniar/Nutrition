import Link from 'next/link'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { PageHeader } from '@/features/nutrition/components/admin/PageHeader'
import { CARD } from '@/features/nutrition/components/admin/styles'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { listReviewQueue } from '@/features/nutrition/server/queries/case-log-reviews'

const HREF = '/nutrition/preceptor'

export default async function PreceptorPage() {
  const access = await requireNutritionRole(pageRoles(HREF))
  // This page is open to ASSESSORs too, who review no case logs, and the
  // review loader admits PRECEPTORs only: so only a preceptor gets the count.
  const waiting = access.roles.includes('PRECEPTOR') ? (await listReviewQueue()).length : null

  return (
    <section className="max-w-2xl space-y-6">
      <PageHeader href={HREF} description={`Welcome, ${access.profile?.fullName ?? access.email}.`} />
      {waiting !== null && (
        <Link href="/nutrition/preceptor/reviews" className={`${CARD} block transition-colors hover:border-red-300`}>
          <p className="text-3xl font-bold text-gray-900">{waiting}</p>
          <p className="mt-1 text-sm text-gray-600">
            {waiting === 1 ? 'case log is' : 'case logs are'} waiting for your review
          </p>
        </Link>
      )}
    </section>
  )
}
