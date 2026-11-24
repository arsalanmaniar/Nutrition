import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { PageHeader } from '@/features/nutrition/components/admin/PageHeader'
import { FeedbackAggregates } from '@/features/nutrition/components/forms/FeedbackAggregates'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { MIN_FORM_1_3_RESPONSES } from '@/features/nutrition/config/evaluation-forms'
import { listAllFormOneThreeFeedback } from '@/features/nutrition/server/queries/evaluation-forms'

const HREF = '/nutrition/admin/feedback'

export default async function AdminFeedbackPage() {
  await requireNutritionRole(pageRoles(HREF))
  const preceptors = await listAllFormOneThreeFeedback()

  return (
    <section className="max-w-3xl space-y-6">
      <PageHeader
        href={HREF}
        description={`Form 1.3 results for every preceptor, as averages only (admins never see an individual form). Results appear once at least ${MIN_FORM_1_3_RESPONSES} trainees have responded.`}
      />
      {preceptors.length === 0 && <p className="text-sm text-gray-500">No preceptors yet.</p>}
      {preceptors.map((preceptor, i) => (
        <section key={i} className="space-y-3" aria-label={preceptor.preceptorName}>
          <h2 dir="auto" className="text-lg font-semibold text-gray-900">
            {preceptor.preceptorName}
          </h2>
          <FeedbackAggregates checkpoints={preceptor.checkpoints} />
        </section>
      ))}
    </section>
  )
}
