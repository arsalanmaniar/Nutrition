'use client'

import { useId, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import type { WpbaType } from '@prisma/client'
import ConfirmModal from '@/components/ui/ConfirmModal'
import { MAX_FORM_TEXT, ratingFieldName } from '@/features/nutrition/config/evaluation-forms'
import { DOPS_OTHER_PROCEDURE, DOPS_PROCEDURES, WPBA_FORMS, type RatedItem, type RatingScale } from '@/features/nutrition/config/forms'
import { submitWpba } from '@/features/nutrition/server/actions/wpba'
import type { AssessableTrainee, CbdCaseLogOption } from '@/features/nutrition/server/queries/wpba-picker'
import { PRIVACY_HINT } from '@/features/nutrition/validation/privacy'
import { Field, FieldError, FormMessage, describedBy, fieldError, useServerForm } from '../admin/form-ui'
import { CARD, INPUT, PRIMARY_BUTTON } from '../admin/styles'
import { PROCEDURE_TEXT_MAX, assessedOnBounds, osceLivePreview, passMarkPoints } from './wpba-display'

const WPBA_PATH = '/nutrition/preceptor/wpba'

/**
 * One WPBA form (Mini-CEX, DOPS, CbD or OSCE), rendered from config/forms.ts
 * only. It posts the ratings and the few fields the server reads; the server
 * (server/actions/wpba.ts) checks who may assess, scores everything, decides
 * an OSCE's result and stores it. A WPBA is final, so Submit asks first, and
 * after it the form is disabled and the page shows the server's result.
 */
export function WpbaForm({
  type,
  trainee,
  caseLogs,
  today,
}: {
  type: WpbaType
  trainee: AssessableTrainee
  caseLogs: CbdCaseLogOption[]
  today: string
}) {
  const definition = WPBA_FORMS[type]
  const router = useRouter()
  const [filed, setFiled] = useState(false)
  const { state, pending, submit } = useServerForm(submitWpba, {
    onSuccess: () => {
      setFiled(true)
      router.push(`${WPBA_PATH}?filed=latest`)
    },
  })
  const [confirming, setConfirming] = useState<FormData | null>(null)
  const [ratings, setRatings] = useState<Record<string, number>>({})
  const [criticalError, setCriticalError] = useState(false)
  const [procedure, setProcedure] = useState('')
  const id = useId()
  const error = (name: string) => fieldError(state, name)
  const bounds = assessedOnBounds(trainee.trainingStartDate, today)
  const noCaseLog = type === 'CBD' && caseLogs.length === 0
  const disabled = pending || filed || !bounds || noCaseLog
  const feedbackLabel = definition.freeText[0]?.label ?? 'Feedback'
  const itemCount = definition.sections.reduce((count, section) => count + section.items.length, 0)

  function onChange(event: FormEvent<HTMLFormElement>) {
    const target = event.target as HTMLInputElement | HTMLSelectElement
    if (target.name.startsWith('rating.')) {
      const key = target.name.slice('rating.'.length)
      setRatings((current) => ({ ...current, [key]: Number(target.value) }))
    } else if (target.name === 'criticalError') {
      setCriticalError((target as HTMLInputElement).checked)
    } else if (target.name === 'procedure') {
      setProcedure(target.value)
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setConfirming(new FormData(event.currentTarget))
  }

  return (
    <>
      <form onSubmit={onSubmit} onChange={onChange} className="space-y-6">
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="traineeId" value={trainee.traineeId} />

        {!bounds && (
          <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            {trainee.trainingStartDate
              ? `${trainee.traineeName}'s training starts on ${trainee.trainingStartDate}, so no assessment can be dated yet.`
              : `${trainee.traineeName}'s training start date is not set yet, so no assessment can be filed.`}
          </p>
        )}
        {definition.pending && (
          <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Some questions on this form are provisional.
          </p>
        )}

        <fieldset disabled={disabled} className="space-y-6">
          <section className={CARD} aria-label="Assessment details">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id={`${id}-date`} label="Assessed on" error={error('assessedOn')} hint="From the training start date to today (Karachi).">
                <input
                  {...describedBy(`${id}-date`, error('assessedOn'))}
                  type="date"
                  name="assessedOn"
                  required
                  min={bounds?.min}
                  max={bounds?.max}
                  defaultValue={bounds ? today : ''}
                  className={INPUT}
                />
              </Field>

              {type === 'CBD' && (
                <Field id={`${id}-log`} label="Case log discussed" error={error('caseLogId')} hint="Submitted or approved logs only.">
                  {noCaseLog ? (
                    <p className="text-sm text-gray-600">This trainee has no submitted or approved case log yet.</p>
                  ) : (
                    <select {...describedBy(`${id}-log`, error('caseLogId'))} name="caseLogId" required defaultValue="" className={INPUT}>
                      <option value="">Choose a case log…</option>
                      {caseLogs.map((log) => (
                        <option key={log.id} value={log.id}>
                          {log.caseCode} · Form {log.formType}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              )}

              {type === 'DOPS' && (
                <Field id={`${id}-procedure`} label="Procedure observed" error={error('procedure')}>
                  <select {...describedBy(`${id}-procedure`, error('procedure'))} name="procedure" required defaultValue="" className={INPUT}>
                    <option value="">Choose a procedure…</option>
                    {[...DOPS_PROCEDURES, DOPS_OTHER_PROCEDURE].map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {type === 'DOPS' && procedure === DOPS_OTHER_PROCEDURE.key && (
                <Field id={`${id}-other`} label="Describe the procedure" error={error('procedureOther')}>
                  <input
                    {...describedBy(`${id}-other`, error('procedureOther'))}
                    name="procedureOther"
                    required
                    dir="auto"
                    maxLength={PROCEDURE_TEXT_MAX}
                    autoComplete="off"
                    className={INPUT}
                  />
                </Field>
              )}
            </div>
          </section>

          {definition.sections.map((section) => (
            <section key={section.key} className={CARD} aria-label={section.title}>
              <h2 className="text-base font-semibold text-gray-900">{section.title}</h2>
              <div className="mt-4 space-y-5">
                {section.items.map((item) => (
                  <RatingField key={item.key} id={`${id}-${item.key}`} item={item} scale={section.scale} error={error(ratingFieldName(item.key))} />
                ))}
              </div>
            </section>
          ))}

          {definition.passRule && (
            <OsceResultPreview
              ratings={ratings}
              itemCount={itemCount}
              maxScore={definition.maxScore}
              minPercent={definition.passRule.minPercent}
              criticalError={criticalError}
            />
          )}

          <section className={CARD} aria-label={feedbackLabel}>
            <p role="note" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">
              {PRIVACY_HINT}
            </p>
            <label htmlFor={`${id}-feedback`} className="mt-4 block text-sm font-medium text-gray-800">
              {feedbackLabel}
            </label>
            <textarea
              id={`${id}-feedback`}
              name="feedback"
              dir="auto"
              rows={5}
              required
              maxLength={MAX_FORM_TEXT}
              aria-invalid={error('feedback') ? true : undefined}
              aria-describedby={error('feedback') ? `${id}-feedback-error` : undefined}
              className={`${INPUT} mt-1`}
            />
            <FieldError id={`${id}-feedback-error`} message={error('feedback')} />
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className={PRIMARY_BUTTON}>
              {pending ? 'Submitting…' : filed ? 'Submitted' : `Submit ${definition.title}`}
            </button>
            <FormMessage state={state} />
          </div>
        </fieldset>
      </form>

      {confirming && (
        <ConfirmModal
          title={`Submit this ${definition.title}?`}
          message="A WPBA is final: it cannot be edited or withdrawn after submitting. A mistake needs a new assessment."
          confirmLabel="Submit"
          danger={false}
          onConfirm={() => {
            const formData = confirming
            setConfirming(null)
            submit(formData)
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </>
  )
}

/** One rated item: a radio group over its scale, each point with its anchor. */
function RatingField({ id, item, scale, error }: { id: string; item: RatedItem; scale: RatingScale; error?: string }) {
  const points = Array.from({ length: scale.max - scale.min + 1 }, (_, i) => scale.min + i)
  return (
    <fieldset aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="text-sm font-medium text-gray-800">{item.label}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {points.map((point) => (
          <label
            key={point}
            className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm has-[:checked]:border-red-500 has-[:checked]:bg-red-50"
          >
            <input type="radio" name={ratingFieldName(item.key)} value={point} required />
            <span>
              {point}
              {scale.anchors?.[point] ? ` · ${scale.anchors[point]}` : ''}
            </span>
          </label>
        ))}
      </div>
      <FieldError id={`${id}-error`} message={error} />
    </fieldset>
  )
}

/**
 * The OSCE pass rule, the critical-error box, and a live preview of the total.
 * DISPLAY ONLY: the server recomputes the total and decides the result when
 * the form is submitted (server/wpba-core.ts), and only its result is stored.
 */
function OsceResultPreview({
  ratings,
  itemCount,
  maxScore,
  minPercent,
  criticalError,
}: {
  ratings: Record<string, number>
  itemCount: number
  maxScore: number
  minPercent: number
  criticalError: boolean
}) {
  const preview = osceLivePreview(ratings, itemCount, maxScore, minPercent, criticalError)
  return (
    <section className={CARD} aria-label="OSCE result">
      <p className="text-sm font-medium text-gray-900">
        Pass rule: at least {minPercent}% ({passMarkPoints(minPercent, maxScore)} of {maxScore}) AND no critical error. A critical error
        fails the OSCE whatever the score.
      </p>
      <label className="mt-3 flex min-h-11 items-center gap-2 text-sm font-medium text-red-800">
        <input type="checkbox" name="criticalError" value="on" />
        Critical error observed
      </label>
      <p className="mt-3 text-sm text-gray-700" aria-live="polite">
        {preview.complete
          ? `Total ${preview.total} of ${maxScore} (${preview.percentage}): ${preview.wouldPass ? 'would pass' : criticalError ? 'would fail (critical error)' : 'would fail (below the pass mark)'}.`
          : `${preview.rated} of ${itemCount} criteria rated.`}{' '}
        <span className="text-gray-500">Preview only: the server works out the result when you submit.</span>
      </p>
    </section>
  )
}
