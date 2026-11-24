import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { PageHeader } from '@/features/nutrition/components/admin/PageHeader'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { PlanReadOnly } from '@/features/nutrition/components/remediation/RemediationViews'
import { getMyRemediation } from '@/features/nutrition/server/queries/remediation'

const HREF = '/nutrition/trainee/remediation'

// The trainee's own remediation plans (Step 6c UI), read-only: each step's
// deficiency, learning activity, reassessment and outcome. The loader reads
// only the caller's own plans.
export default async function TraineeRemediationPage() {
  await requireNutritionRole(pageRoles(HREF))
  const plans = await getMyRemediation()

  return (
    <section className="max-w-3xl space-y-6">
      <PageHeader href={HREF} description="Your remediation plans, set by your primary preceptor: what needs work, the learning activity, the reassessment and the outcome." />
      {plans.length === 0 ? <p className="text-sm text-gray-500">You have no remediation plan.</p> : plans.map((plan) => <PlanReadOnly key={plan.id} plan={plan} />)}
    </section>
  )
}
