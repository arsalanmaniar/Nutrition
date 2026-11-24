import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { PageHeader } from '@/features/nutrition/components/admin/PageHeader'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { ReviewHistory, ReviewQueue } from '@/features/nutrition/components/reviews/ReviewLists'
import { listReviewHistory, listReviewQueue } from '@/features/nutrition/server/queries/case-log-reviews'

const HREF = '/nutrition/preceptor/reviews'

export default async function PreceptorReviewsPage() {
  await requireNutritionRole(pageRoles(HREF))
  const [queue, history] = await Promise.all([listReviewQueue(), listReviewHistory()])

  return (
    <section className="max-w-3xl space-y-6">
      <PageHeader
        href={HREF}
        description="Case logs submitted by the trainees you are primary preceptor for. Approving is final; returning a log sends it back to the trainee with your comment."
      />
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-gray-900">Waiting for review ({queue.length})</h2>
        <ReviewQueue rows={queue} />
      </div>
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-gray-900">Reviewed</h2>
        <ReviewHistory rows={history} />
      </div>
    </section>
  )
}
