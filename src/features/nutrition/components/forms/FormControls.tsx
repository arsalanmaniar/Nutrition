'use client'

import { useId, useState } from 'react'
import type { EvaluationFormType } from '@prisma/client'
import ConfirmModal from '@/components/ui/ConfirmModal'
import { MAX_FORM_TEXT } from '@/features/nutrition/config/evaluation-forms'
import {
  commentOnWeeklyCheckIn,
  reopenEvaluationForm,
  startMyEvaluationForm,
  startMyFormOneThree,
  startTraineeEvaluation,
} from '@/features/nutrition/server/actions/evaluation-forms'
import { PRIVACY_HINT } from '@/features/nutrition/validation/privacy'
import { Field, FormMessage, describedBy, fieldError, useServerForm } from '../admin/form-ui'
import { INPUT, PRIMARY_BUTTON, SECONDARY_BUTTON } from '../admin/styles'

// The small client controls of the evaluation-form pages. Each posts only an
// id or a form type; the server decides everything else.

function startAction(formType: EvaluationFormType) {
  if (formType === 'FORM_1_3') return startMyFormOneThree
  if (formType === 'FORM_1_2' || formType === 'FORM_3_1') return startTraineeEvaluation
  return startMyEvaluationForm
}

/** "Start": the server opens the next due form of this type (for a preceptor, for this trainee) and goes to it. */
export function StartFormButton({ formType, traineeId }: { formType: EvaluationFormType; traineeId?: string }) {
  const { state, pending, onSubmit } = useServerForm(startAction(formType))
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="formType" value={formType} />
      {traineeId && <input type="hidden" name="traineeId" value={traineeId} />}
      <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
        {pending ? 'Opening…' : 'Start'}
      </button>
      <FormMessage state={state} />
    </form>
  )
}

/** The primary preceptor reopens a submitted form, after a confirmation. The server logs it. */
export function ReopenFormButton({ formId }: { formId: string }) {
  const { state, pending, submit } = useServerForm(reopenEvaluationForm)
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={pending} onClick={() => setConfirming(true)} className={SECONDARY_BUTTON}>
        {pending ? 'Reopening…' : 'Reopen'}
      </button>
      <FormMessage state={state} />
      {confirming && (
        <ConfirmModal
          title="Reopen this form?"
          message="It goes back to its author as a draft, its scores are cleared until it is submitted again, and the reopen is logged."
          confirmLabel="Reopen"
          danger={false}
          onConfirm={() => {
            setConfirming(false)
            const formData = new FormData()
            formData.set('formId', formId)
            submit(formData)
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  )
}

/** The primary preceptor's comment on a submitted weekly check-in. */
export function WeeklyCommentForm({ formId, comment }: { formId: string; comment: string | null }) {
  const { state, pending, onSubmit } = useServerForm(commentOnWeeklyCheckIn)
  const id = useId()
  const inputId = `${id}-comment`
  const error = fieldError(state, 'comment')
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="formId" value={formId} />
      <Field id={inputId} label="Your comment for the trainee" error={error} hint={PRIVACY_HINT}>
        <textarea
          {...describedBy(inputId, error)}
          name="comment"
          dir="auto"
          rows={4}
          maxLength={MAX_FORM_TEXT}
          required
          defaultValue={comment ?? ''}
          className={INPUT}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
          {pending ? 'Saving…' : comment ? 'Update comment' : 'Save comment'}
        </button>
        <FormMessage state={state} />
      </div>
    </form>
  )
}
