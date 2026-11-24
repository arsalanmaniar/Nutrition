import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { PageHeader } from '@/features/nutrition/components/admin/PageHeader'
import { FeedbackAggregates } from '@/features/nutrition/components/forms/FeedbackAggregates'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { MIN_FORM_1_3_RESPONSES } from '@/features/nutrition/config/evaluation-forms'
import { listMyFormOneThreeFeedback } from '@/features/nutrition/server/queries/evaluation-forms'

const HREF = '/nutrition/preceptor/feedback'

export default async function PreceptorFeedbackPage() {
  await requireNutritionRole(pageRoles(HREF))
  const checkpoints = await listMyFormOneThreeFeedback()

  return (
    <section className="max-w-3xl space-y-6">
      <PageHeader
        href={HREF}
        description={`Your trainees' Form 1.3 evaluations of you, as averages only, at Months 4, 8 and 12. Results appear once at least ${MIN_FORM_1_3_RESPONSES} trainees have responded; no individual answer or author is ever shown.`}
      />
      <FeedbackAggregates checkpoints={checkpoints} />
    </section>
  )
}
