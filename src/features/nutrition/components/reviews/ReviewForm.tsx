'use client'

import { useId, useState, type FormEvent } from 'react'
import ConfirmModal from '@/components/ui/ConfirmModal'
import { approveCaseLog, rejectCaseLog } from '@/features/nutrition/server/actions/case-log-reviews'
import { PRIVACY_HINT } from '@/features/nutrition/validation/privacy'
import { Field, FormMessage, describedBy, fieldError, useServerForm } from '../admin/form-ui'
import { CARD, INPUT, PRIMARY_BUTTON, SECONDARY_BUTTON } from '../admin/styles'

/**
 * Approve or return a SUBMITTED case log. Returning it needs a comment saying
 * what to change; approving asks first, because an approval is final. The
 * server checks everything again (the assignment, the status, the comment) and
 * the form only shows what it reports, keeping the comment if it reports a
 * problem.
 */
export function ReviewForm({ logId, caseCode }: { logId: string; caseCode: string }) {
  const { state: approveState, pending: approving, submit: approve } = useServerForm(approveCaseLog)
  const { state: rejectState, pending: rejecting, submit: reject } = useServerForm(rejectCaseLog)
  const [last, setLast] = useState<'approve' | 'reject'>('approve')
  const [confirming, setConfirming] = useState<FormData | null>(null)
  const state = last === 'reject' ? rejectState : approveState
  const pending = approving || rejecting
  const id = useId()
  const commentId = `${id}-comment`
  const error = fieldError(state, 'comment')

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const submitter = (event.nativeEvent as SubmitEvent).submitter
    if (submitter?.getAttribute('value') === 'approve') {
      setConfirming(formData)
    } else {
      setLast('reject')
      reject(formData)
    }
  }

  return (
    <>
      <section className={CARD} aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`} className="text-base font-semibold text-gray-900">
          Your review
        </h2>
        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <input type="hidden" name="logId" value={logId} />
          <Field
            id={commentId}
            label="Comment"
            error={error}
            hint={`Needed to return the log: say what to change. Optional when approving. ${PRIVACY_HINT}`}
          >
            <textarea {...describedBy(commentId, error)} name="comment" rows={4} maxLength={2000} dir="auto" className={INPUT} />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" value="reject" disabled={pending} className={SECONDARY_BUTTON}>
              {rejecting ? 'Returning…' : 'Return to trainee'}
            </button>
            <button type="submit" value="approve" disabled={pending} className={PRIMARY_BUTTON}>
              {approving ? 'Approving…' : 'Approve'}
            </button>
            <FormMessage state={state} />
          </div>
        </form>
      </section>

      {confirming && (
        <ConfirmModal
          title={`Approve ${caseCode}?`}
          message="An approval is final: neither you nor the trainee can change this log afterwards."
          confirmLabel="Approve"
          danger={false}
          onConfirm={() => {
            const formData = confirming
            setConfirming(null)
            setLast('approve')
            approve(formData)
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </>
  )
}
