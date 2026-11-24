import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { PageHeader } from '@/features/nutrition/components/admin/PageHeader'
import { TraineePicker } from '@/features/nutrition/components/epa/EpaViews'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { ClosePlanButton, DeficiencyForm, StepEditor } from '@/features/nutrition/components/remediation/RemediationForms'
import { REMEDIATION_EPA_NOTE } from '@/features/nutrition/components/remediation/remediation-display'
import { PlanReadOnly, StepSummary } from '@/features/nutrition/components/remediation/RemediationViews'
import { CARD } from '@/features/nutrition/components/admin/styles'
import { EPA_LIST } from '@/features/nutrition/config/epas'
import { karachiDay } from '@/features/nutrition/lib/assessment-point'
import { listMyTraineesEpa } from '@/features/nutrition/server/queries/epa'
import { getTraineeRemediation } from '@/features/nutrition/server/queries/remediation'

const HREF = '/nutrition/preceptor/remediation'

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

// The 4-step remediation module (Step 6c UI) for the trainees the caller is
// ACTIVE primary preceptor of: (1) flag a deficiency, (2) a learning activity,
// (3) a reassessment date and the WPBA that reassessed it, (4) the outcome.
// One open plan per trainee; a closed plan is read-only. The loader returns
// nothing for a trainee who is not the caller's, and every action checks the
// rules again.
export default async function PreceptorRemediationPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await requireNutritionRole(pageRoles(HREF))
  const params = await searchParams
  // The caller's primary trainees, from the EPA loader (names and ids only are used here).
  const trainees = (await listMyTraineesEpa()).map(({ traineeId, traineeName }) => ({ traineeId, traineeName }))
  const traineeId = trainees.find((trainee) => trainee.traineeId === first(params.trainee))?.traineeId ?? null
  const view = traineeId ? await getTraineeRemediation(traineeId) : null
  const open = view?.plans.find((plan) => plan.open) ?? null
  const closed = view?.plans.filter((plan) => !plan.open) ?? []
  const today = karachiDay(new Date())

  return (
    <section className="max-w-4xl space-y-6">
      <PageHeader href={HREF} description="Flag a deficiency, set a targeted learning activity, schedule and link the reassessment, then record the outcome." />
      <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        {REMEDIATION_EPA_NOTE}
      </p>

      <TraineePicker href={HREF} trainees={trainees} traineeId={traineeId} empty="You are not the primary preceptor of any trainee." />

      {traineeId && !view && <p className="text-sm text-gray-500">This trainee was not found among your trainees.</p>}

      {view && (
        <section aria-labelledby="plan-title" className="space-y-4">
          <h2 id="plan-title" className="text-lg font-semibold text-gray-900">
            Remediation for <span dir="auto">{view.traineeName}</span>
          </h2>

          {!open && <DeficiencyForm key={`new-${view.traineeId}`} traineeId={view.traineeId} epas={EPA_LIST} />}

          {open && (
            <section className={`${CARD} space-y-5`} aria-label="Open plan">
              <h3 className="text-base font-semibold text-gray-900">Open plan, since {open.createdOn}</h3>
              <ol className="space-y-6">
                {[...open.steps]
                  .sort((a, b) => a.position - b.position)
                  .map((step) => (
                    <li key={step.id} className="border-t border-gray-100 pt-4">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Step {step.position}</p>
                      <StepSummary step={step} />
                      <StepEditor key={step.id} step={step} wpbaOptions={view.wpbaOptions} today={today} />
                    </li>
                  ))}
              </ol>
              <div className="space-y-2 border-t border-gray-100 pt-4">
                <h4 className="text-sm font-semibold text-gray-900">Add another deficiency</h4>
                <DeficiencyForm key={`add-${open.id}`} planId={open.id} epas={EPA_LIST} />
              </div>
              <ClosePlanButton planId={open.id} />
            </section>
          )}

          {closed.length > 0 && (
            <section aria-labelledby="closed-title" className="space-y-3">
              <h3 id="closed-title" className="text-base font-semibold text-gray-900">
                Closed plans
              </h3>
              {closed.map((plan) => (
                <PlanReadOnly key={plan.id} plan={plan} />
              ))}
            </section>
          )}
        </section>
      )}
    </section>
  )
}
