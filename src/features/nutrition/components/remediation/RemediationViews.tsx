import type { RemediationPlanView, RemediationStepView } from '@/features/nutrition/server/queries/remediation'
import { CARD } from '../admin/styles'
import { epaChangeText, outcomeLabel } from './remediation-display'

// Read-only remediation views (Step 6c UI), for the trainee and for closed
// plans. Server components; the data comes from server/queries/remediation.ts.

/** One step's recorded facts, in the plan's four-step order. */
export function StepSummary({ step }: { step: RemediationStepView }) {
  const epa = epaChangeText(step.epa)
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
      <dt className="text-gray-500">1. Deficiency</dt>
      <dd dir="auto">{step.deficiency}</dd>
      <dt className="text-gray-500">2. Activity</dt>
      <dd dir="auto">{step.activity ?? 'Not set yet'}</dd>
      <dt className="text-gray-500">3. Reassessment</dt>
      <dd>
        {step.reassessmentDate ?? 'No date yet'}
        {step.linkedWpba ? ` · ${step.linkedWpba.title}, ${step.linkedWpba.assessedOn}` : ''}
      </dd>
      <dt className="text-gray-500">4. Outcome</dt>
      <dd>{outcomeLabel(step.outcome)}</dd>
      {epa && (
        <>
          <dt className="text-gray-500">EPA before → after</dt>
          <dd>{epa}</dd>
        </>
      )}
    </dl>
  )
}

/** A plan with its steps in position order, read-only. */
export function PlanReadOnly({ plan }: { plan: RemediationPlanView }) {
  return (
    <section className={CARD} aria-label={`Remediation plan opened ${plan.createdOn}`}>
      <h3 className="text-base font-semibold text-gray-900">
        Plan opened {plan.createdOn}
        {plan.closedOn ? ` · closed ${plan.closedOn}` : ' · open'}
      </h3>
      <ol className="mt-3 space-y-4">
        {[...plan.steps]
          .sort((a, b) => a.position - b.position)
          .map((step) => (
            <li key={step.id} className="border-t border-gray-100 pt-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Step {step.position}</p>
              <StepSummary step={step} />
            </li>
          ))}
      </ol>
    </section>
  )
}
