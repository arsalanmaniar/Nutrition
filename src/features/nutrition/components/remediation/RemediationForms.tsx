'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import ConfirmModal from '@/components/ui/ConfirmModal'
import { MAX_FORM_TEXT } from '@/features/nutrition/config/evaluation-forms'
import {
  closeRemediationPlan,
  createRemediationPlan,
  flagDeficiency,
  linkReassessmentWpba,
  scheduleReassessment,
  setRemediationActivity,
  setRemediationOutcome,
} from '@/features/nutrition/server/actions/remediation'
import type { RemediationStepView } from '@/features/nutrition/server/queries/remediation'
import { PRIVACY_HINT } from '@/features/nutrition/validation/privacy'
import { Field, FormMessage, describedBy, fieldError, useServerForm } from '../admin/form-ui'
import { CARD, INPUT, PRIMARY_BUTTON, SECONDARY_BUTTON } from '../admin/styles'
import { OUTCOMES, OUTCOME_LABELS, linkableWpbas, outcomeLabel } from './remediation-display'

// The preceptor's remediation forms (Step 6c UI). Each posts to one server
// action (server/actions/remediation.ts), which checks the caller, the plan
// and every rule again; its message is shown as it is. After a change the
// page reloads its data.

type Epa = { key: string; label: string }
type WpbaOption = { id: string; title: string; assessedOn: string; filedAt: string }

function useRefreshForm(action: Parameters<typeof useServerForm>[0], resetOnSuccess = false) {
  const router = useRouter()
  return useServerForm(action, { resetOnSuccess, onSuccess: () => router.refresh() })
}

/** Step 1 for a trainee without an open plan: the first deficiency opens the plan. Or, with `planId`, adds one. */
export function DeficiencyForm({ traineeId, planId, epas }: { traineeId?: string; planId?: string; epas: readonly Epa[] }) {
  const { formRef, state, pending, onSubmit } = useRefreshForm(planId ? flagDeficiency : createRemediationPlan, true)
  const id = useId()
  const error = (name: string) => fieldError(state, name)
  return (
    <form ref={formRef} onSubmit={onSubmit} className={`${CARD} space-y-4`}>
      {traineeId && <input type="hidden" name="traineeId" value={traineeId} />}
      {planId && <input type="hidden" name="planId" value={planId} />}
      <fieldset disabled={pending} className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_14rem]">
        <Field id={`${id}-deficiency`} label="Deficiency or unmet milestone" error={error('deficiency')} hint={PRIVACY_HINT}>
          <textarea {...describedBy(`${id}-deficiency`, error('deficiency'))} name="deficiency" required dir="auto" rows={3} maxLength={MAX_FORM_TEXT} className={INPUT} />
        </Field>
        <Field id={`${id}-epa`} label="EPA (optional)" error={error('epaKey')}>
          <select {...describedBy(`${id}-epa`, error('epaKey'))} name="epaKey" defaultValue="" className={INPUT}>
            <option value="">No EPA</option>
            {epas.map((epa) => (
              <option key={epa.key} value={epa.key}>
                {epa.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button type="submit" className={PRIMARY_BUTTON}>
            {pending ? 'Saving…' : planId ? 'Add deficiency' : 'Open a remediation plan'}
          </button>
          <FormMessage state={state} />
        </div>
      </fieldset>
    </form>
  )
}

/** Steps 2 to 4 for one step: activity, reassessment date, the reassessment WPBA and the outcome. */
export function StepEditor({ step, wpbaOptions, today }: { step: RemediationStepView; wpbaOptions: readonly WpbaOption[]; today: string }) {
  const activity = useRefreshForm(setRemediationActivity)
  const schedule = useRefreshForm(scheduleReassessment)
  const link = useRefreshForm(linkReassessmentWpba)
  const outcome = useRefreshForm(setRemediationOutcome)
  const id = useId()
  const linkable = linkableWpbas(wpbaOptions, step.createdAt)

  return (
    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <form onSubmit={activity.onSubmit} className="space-y-2">
        <input type="hidden" name="stepId" value={step.id} />
        <Field id={`${id}-activity`} label="2. Learning activity" error={fieldError(activity.state, 'activity')}>
          <textarea
            {...describedBy(`${id}-activity`, fieldError(activity.state, 'activity'))}
            name="activity"
            required
            dir="auto"
            rows={3}
            maxLength={MAX_FORM_TEXT}
            defaultValue={step.activity ?? ''}
            className={INPUT}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={activity.pending} className={SECONDARY_BUTTON}>
            Save activity
          </button>
          <FormMessage state={activity.state} />
        </div>
      </form>

      <form onSubmit={schedule.onSubmit} className="space-y-2">
        <input type="hidden" name="stepId" value={step.id} />
        <Field id={`${id}-date`} label="3. Reassessment date" error={fieldError(schedule.state, 'reassessmentDate')}>
          <input
            {...describedBy(`${id}-date`, fieldError(schedule.state, 'reassessmentDate'))}
            type="date"
            name="reassessmentDate"
            required
            min={today}
            defaultValue={step.reassessmentDate ?? ''}
            className={INPUT}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={schedule.pending} className={SECONDARY_BUTTON}>
            Save date
          </button>
          <FormMessage state={schedule.state} />
        </div>
      </form>

      <form onSubmit={link.onSubmit} className="space-y-2">
        <input type="hidden" name="stepId" value={step.id} />
        <Field id={`${id}-wpba`} label="3. Reassessment WPBA" error={fieldError(link.state, 'wpbaId')} hint="Only this trainee's WPBAs filed after the step was added.">
          {linkable.length === 0 ? (
            <p className="text-sm text-gray-600">No WPBA filed after this step yet.</p>
          ) : (
            <select {...describedBy(`${id}-wpba`, fieldError(link.state, 'wpbaId'))} name="wpbaId" required defaultValue={step.linkedWpba?.id ?? ''} className={INPUT}>
              <option value="">Choose a WPBA…</option>
              {linkable.map((wpba) => (
                <option key={wpba.id} value={wpba.id}>
                  {wpba.title}, {wpba.assessedOn}
                </option>
              ))}
            </select>
          )}
        </Field>
        {linkable.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={link.pending} className={SECONDARY_BUTTON}>
              Link WPBA
            </button>
            <FormMessage state={link.state} />
          </div>
        )}
      </form>

      <form onSubmit={outcome.onSubmit} className="space-y-2">
        <input type="hidden" name="stepId" value={step.id} />
        <Field id={`${id}-outcome`} label="4. Outcome" error={fieldError(outcome.state, 'outcome')} hint={`Now: ${outcomeLabel(step.outcome)}.`}>
          <select {...describedBy(`${id}-outcome`, fieldError(outcome.state, 'outcome'))} name="outcome" required defaultValue={step.outcome ?? 'IN_PROGRESS'} className={INPUT}>
            {OUTCOMES.map((value) => (
              <option key={value} value={value}>
                {OUTCOME_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={outcome.pending} className={SECONDARY_BUTTON}>
            Save outcome
          </button>
          <FormMessage state={outcome.state} />
        </div>
      </form>
    </div>
  )
}

/** Closes the open plan after a confirmation; it is read-only afterwards. */
export function ClosePlanButton({ planId }: { planId: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const { state, pending, submit } = useServerForm(closeRemediationPlan, { onSuccess: () => router.refresh() })
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={pending} onClick={() => setConfirming(true)} className={SECONDARY_BUTTON}>
        {pending ? 'Closing…' : 'Close the plan'}
      </button>
      <FormMessage state={state} />
      {confirming && (
        <ConfirmModal
          title="Close this remediation plan?"
          message="A closed plan cannot be changed. A new deficiency later needs a new plan."
          confirmLabel="Close plan"
          danger={false}
          onConfirm={() => {
            setConfirming(false)
            const formData = new FormData()
            formData.set('planId', planId)
            submit(formData)
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  )
}
