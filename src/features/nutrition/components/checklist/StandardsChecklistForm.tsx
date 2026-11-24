'use client'

import { useId, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import ConfirmModal from '@/components/ui/ConfirmModal'
import { saveStandardsChecklist, startStandardsChecklist, submitStandardsChecklist } from '@/features/nutrition/server/actions/standards-checklist'
import type { EvidenceView, StandardView } from '@/features/nutrition/server/queries/standards-checklist'
import { Field, FormMessage, describedBy, fieldError, useServerForm } from '../admin/form-ui'
import { CARD, INPUT, PRIMARY_BUTTON, SECONDARY_BUTTON } from '../admin/styles'
import {
  STANDARD_RATINGS,
  checklistEvidenceField,
  checklistRatingField,
  evidenceOptionLabel,
  evidenceOptionValue,
  ratingLabel,
} from '../epa/epa-display'

/** Opens the trainee's Month 9 checklist as a draft (server/actions/standards-checklist.ts). */
export function StartChecklistButton({ traineeId }: { traineeId: string }) {
  const router = useRouter()
  const { state, pending, onSubmit } = useServerForm(startStandardsChecklist, { onSuccess: () => router.refresh() })
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="traineeId" value={traineeId} />
      <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
        {pending ? 'Starting…' : 'Start the Month 9 checklist'}
      </button>
      <FormMessage state={state} />
    </form>
  )
}

/**
 * The Month 9 standards checklist while it is a DRAFT: each SOP step and SOPP
 * domain with a rating and an evidence reference. "Save draft" can be used any
 * number of times; "Submit" asks first, because a submitted checklist can
 * never be changed. The evidence picker lists only the records the loader
 * returned (this trainee's WPBAs and submitted or approved case logs); the
 * server checks every reference again, and its message is shown as it is.
 */
export function StandardsChecklistForm({
  traineeId,
  standards,
  evidenceOptions,
}: {
  traineeId: string
  standards: readonly StandardView[]
  evidenceOptions: readonly EvidenceView[]
}) {
  const router = useRouter()
  const saving = useServerForm(saveStandardsChecklist, { onSuccess: () => router.refresh() })
  const submitting = useServerForm(submitStandardsChecklist, { onSuccess: () => router.refresh() })
  const [confirming, setConfirming] = useState<FormData | null>(null)
  const [last, setLast] = useState<'save' | 'submit'>('save')
  const id = useId()
  const current = last === 'save' ? saving : submitting
  const pending = saving.pending || submitting.pending
  const error = (name: string) => fieldError(current.state, name)
  const groups = [...new Set(standards.map((standard) => standard.group))]

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const intent = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value
    if (intent === 'submit') {
      setConfirming(formData)
    } else {
      setLast('save')
      saving.submit(formData)
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-4">
        <input type="hidden" name="traineeId" value={traineeId} />
        <fieldset disabled={pending} className="space-y-4">
          {groups.map((group) => (
            <section key={group} className={CARD} aria-label={group}>
              <h3 className="text-base font-semibold text-gray-900">{group}</h3>
              <div className="mt-4 space-y-5">
                {standards
                  .filter((standard) => standard.group === group)
                  .map((standard) => (
                    <div key={standard.key} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_12rem_1fr] sm:items-start">
                      <p className="text-sm font-medium text-gray-800 sm:pt-6">{standard.label}</p>
                      <Field id={`${id}-${standard.key}-rating`} label="Rating" error={error(checklistRatingField(standard.key))}>
                        <select
                          {...describedBy(`${id}-${standard.key}-rating`, error(checklistRatingField(standard.key)))}
                          name={checklistRatingField(standard.key)}
                          defaultValue={standard.rating ?? ''}
                          className={INPUT}
                        >
                          <option value="">Not rated</option>
                          {STANDARD_RATINGS.map((rating) => (
                            <option key={rating} value={rating}>
                              {ratingLabel(rating)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field id={`${id}-${standard.key}-evidence`} label="Evidence" error={error(checklistEvidenceField(standard.key))}>
                        <select
                          {...describedBy(`${id}-${standard.key}-evidence`, error(checklistEvidenceField(standard.key)))}
                          name={checklistEvidenceField(standard.key)}
                          defaultValue={standard.evidence ? evidenceOptionValue(standard.evidence) : ''}
                          className={INPUT}
                        >
                          <option value="">No evidence linked</option>
                          {standard.evidence && !evidenceOptions.some((option) => evidenceOptionValue(option) === evidenceOptionValue(standard.evidence!)) && (
                            <option value={evidenceOptionValue(standard.evidence)}>{evidenceOptionLabel(standard.evidence)}</option>
                          )}
                          {evidenceOptions.map((option) => (
                            <option key={evidenceOptionValue(option)} value={evidenceOptionValue(option)}>
                              {evidenceOptionLabel(option)}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                  ))}
              </div>
            </section>
          ))}

          {evidenceOptions.length === 0 && (
            <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              This trainee has no WPBA and no submitted or approved case log yet, so no evidence can be linked.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" name="intent" value="save" className={SECONDARY_BUTTON}>
              {saving.pending ? 'Saving…' : 'Save draft'}
            </button>
            <button type="submit" name="intent" value="submit" className={PRIMARY_BUTTON}>
              {submitting.pending ? 'Submitting…' : 'Submit checklist'}
            </button>
            <FormMessage state={current.state} />
          </div>
        </fieldset>
      </form>

      {confirming && (
        <ConfirmModal
          title="Submit the Month 9 checklist?"
          message="A submitted checklist is final: it cannot be edited afterwards. Every standard needs a rating and evidence."
          confirmLabel="Submit"
          danger={false}
          onConfirm={() => {
            const formData = confirming
            setConfirming(null)
            setLast('submit')
            submitting.submit(formData)
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </>
  )
}
