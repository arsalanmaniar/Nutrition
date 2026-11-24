import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { PageHeader } from '@/features/nutrition/components/admin/PageHeader'
import { FeedbackAggregates } from '@/features/nutrition/components/forms/FeedbackAggregates'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { MIN_FORM_1_3_RESPONSES } from '@/features/nutrition/config/evaluation-forms'
import { listRotationFormOneThreeFeedback } from '@/features/nutrition/server/queries/evaluation-forms'

const HREF = '/nutrition/unit-lead/feedback'

export default async function UnitLeadFeedbackPage() {
  await requireNutritionRole(pageRoles(HREF))
  const preceptors = await listRotationFormOneThreeFeedback()

  return (
    <section className="max-w-3xl space-y-6">
      <PageHeader
        href={HREF}
        description={`Form 1.3 results, as averages only, for the preceptors linked to the rotations you lead: the rotation preceptors of placements on them, and the primary preceptors of the trainees placed there. Results appear once at least ${MIN_FORM_1_3_RESPONSES} trainees have responded.`}
      />
      {preceptors.length === 0 && <p className="text-sm text-gray-500">No preceptor is linked to a rotation you lead yet.</p>}
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
