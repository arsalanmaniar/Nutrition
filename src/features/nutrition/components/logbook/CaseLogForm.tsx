'use client'

import { useId, useState, type FormEvent } from 'react'
import type { CaseFormType, EpaLevel, SubmissionStatus } from '@prisma/client'
import ConfirmModal from '@/components/ui/ConfirmModal'
import {
  AGE_BANDS,
  CASE_LOG_FORMS,
  DIAGNOSIS_CATEGORIES,
  dataFieldName,
  type CaseLogField,
} from '@/features/nutrition/config/case-log-forms'
import { EPA_LEVEL_LABELS } from '@/features/nutrition/config/forms'
import { createCaseLog, submitCaseLog, updateCaseLog } from '@/features/nutrition/server/actions/case-logs'
import type { RotationOption } from '@/features/nutrition/server/queries/case-logs'
import { PRIVACY_HINT } from '@/features/nutrition/validation/privacy'
import { Field, FormMessage, describedBy, fieldError, useServerForm } from '../admin/form-ui'
import { CARD, INPUT, PRIMARY_BUTTON, SECONDARY_BUTTON } from '../admin/styles'

/** What the form needs of an existing log; absent for a new one. */
export interface EditableCaseLog {
  id: string
  status: SubmissionStatus
  rotationId: string | null
  ageBand: string
  diagnosisCategory: string
  epaLevel: EpaLevel | null
  data: Record<string, string>
}

const EPA_LEVELS = Object.keys(EPA_LEVEL_LABELS) as EpaLevel[]

/**
 * The case-log form for Forms A–D, rendered from config/case-log-forms.ts.
 * A new log has one button, "Save draft"; the server gives it its case code.
 * A DRAFT or REJECTED log has "Save" and "Submit for review", which asks first
 * because the trainee cannot change the log afterwards. The server checks
 * everything again, including the patient-identifier rule; the form only shows
 * what the server reports, and keeps what was typed when it reports a problem.
 */
export function CaseLogForm({
  formType,
  rotations,
  log,
}: {
  formType: CaseFormType
  rotations: RotationOption[]
  log?: EditableCaseLog
}) {
  const definition = CASE_LOG_FORMS[formType]
  const { state: saveState, pending: saving, submit: save } = useServerForm(log ? updateCaseLog : createCaseLog)
  const { state: submitState, pending: submitting, submit: send } = useServerForm(submitCaseLog)
  const [last, setLast] = useState<'save' | 'submit'>('save')
  const [confirming, setConfirming] = useState<FormData | null>(null)
  const state = last === 'submit' ? submitState : saveState
  const pending = saving || submitting
  const id = useId()
  const error = (name: string) => fieldError(state, name)
  const resubmit = log?.status === 'REJECTED'

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const submitter = (event.nativeEvent as SubmitEvent).submitter
    if (log && submitter?.getAttribute('value') === 'submit') {
      setConfirming(formData)
    } else {
      setLast('save')
      save(formData)
    }
  }

  const ids = {
    rotationId: `${id}-rotation`,
    ageBand: `${id}-age`,
    diagnosisCategory: `${id}-diagnosis`,
    epaLevel: `${id}-epa`,
  }

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-6">
        <input type="hidden" name="formType" value={formType} />
        {log && <input type="hidden" name="logId" value={log.id} />}

        {definition.placeholder && (
          <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Placeholder fields: the real {definition.title} fields have not been supplied yet, so this form shows the four
            Nutrition Care Process steps.
          </p>
        )}

        <section className={CARD} aria-labelledby={`${id}-details`}>
          <h2 id={`${id}-details`} className="text-base font-semibold text-gray-900">
            Case details
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id={ids.rotationId} label="Rotation" error={error('rotationId')} hint="Needed to submit.">
              <select {...describedBy(ids.rotationId, error('rotationId'))} name="rotationId" defaultValue={log?.rotationId ?? ''} className={INPUT}>
                <option value="">Not chosen yet</option>
                {rotations.map((rotation) => (
                  <option key={rotation.id} value={rotation.id}>
                    {rotation.isActive ? rotation.name : `${rotation.name} (retired)`}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={ids.ageBand} label="Age band" error={error('ageBand')}>
              <select {...describedBy(ids.ageBand, error('ageBand'))} name="ageBand" required defaultValue={log?.ageBand ?? ''} className={INPUT}>
                <option value="">Choose an age band…</option>
                {AGE_BANDS.map((band) => (
                  <option key={band.key} value={band.key}>
                    {band.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={ids.diagnosisCategory} label="Diagnosis category" error={error('diagnosisCategory')}>
              <select
                {...describedBy(ids.diagnosisCategory, error('diagnosisCategory'))}
                name="diagnosisCategory"
                required
                defaultValue={log?.diagnosisCategory ?? ''}
                className={INPUT}
              >
                <option value="">Choose a category…</option>
                {DIAGNOSIS_CATEGORIES.map((category) => (
                  <option key={category.key} value={category.key}>
                    {category.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={ids.epaLevel} label="EPA level" error={error('epaLevel')} hint="Needed to submit.">
              <select {...describedBy(ids.epaLevel, error('epaLevel'))} name="epaLevel" defaultValue={log?.epaLevel ?? ''} className={INPUT}>
                <option value="">Not chosen yet</option>
                {EPA_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level} · {EPA_LEVEL_LABELS[level]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </section>

        <p role="note" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">
          {PRIVACY_HINT} The case is identified only by its case code, age band and diagnosis category.
        </p>

        {definition.sections.map((section) => (
          <section key={section.key} className={CARD} aria-label={section.title}>
            <h2 className="text-base font-semibold text-gray-900">{section.title}</h2>
            <div className="mt-4 space-y-4">
              {section.fields.map((field) => (
                <TextField key={field.key} id={`${id}-${field.key}`} field={field} value={log?.data[field.key]} error={error(dataFieldName(field.key))} />
              ))}
            </div>
          </section>
        ))}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" value="save" disabled={pending} className={log ? SECONDARY_BUTTON : PRIMARY_BUTTON}>
            {saving ? 'Saving…' : log ? 'Save' : 'Save draft'}
          </button>
          {log && (
            <button type="submit" value="submit" disabled={pending} className={PRIMARY_BUTTON}>
              {submitting ? 'Submitting…' : resubmit ? 'Resubmit for review' : 'Submit for review'}
            </button>
          )}
          <FormMessage state={state} />
        </div>
      </form>

      {confirming && (
        <ConfirmModal
          title={resubmit ? 'Resubmit this case log?' : 'Submit this case log?'}
          message="Your preceptor will review it. You cannot change it after submitting, unless it is returned to you."
          confirmLabel={resubmit ? 'Resubmit' : 'Submit'}
          danger={false}
          onConfirm={() => {
            const formData = confirming
            setConfirming(null)
            setLast('submit')
            send(formData)
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </>
  )
}

function TextField({ id, field, value, error }: { id: string; field: CaseLogField; value?: string; error?: string }) {
  const props = {
    ...describedBy(id, error),
    name: dataFieldName(field.key),
    maxLength: field.maxLength,
    defaultValue: value ?? '',
    dir: 'auto' as const,
    autoComplete: 'off',
    className: INPUT,
  }
  return (
    <Field id={id} label={field.required ? field.label : `${field.label} (optional)`} error={error} hint={field.hint}>
      {field.kind === 'textarea' ? <textarea {...props} rows={5} /> : <input {...props} />}
    </Field>
  )
}
