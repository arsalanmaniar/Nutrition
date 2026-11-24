'use client'

import { useId, useState, type FormEvent } from 'react'
import type { EvaluationFormType } from '@prisma/client'
import ConfirmModal from '@/components/ui/ConfirmModal'
import {
  FORM_1_3_CONFIDENTIAL_NOTICE,
  MAX_FORM_TEXT,
  ratingFieldName,
  textFieldName,
} from '@/features/nutrition/config/evaluation-forms'
import { EVALUATION_FORMS, type RatedItem, type RatingScale } from '@/features/nutrition/config/forms'
import {
  saveMyEvaluationForm,
  saveMyFormOneThree,
  saveTraineeEvaluation,
  submitMyEvaluationForm,
  submitMyFormOneThree,
  submitTraineeEvaluation,
} from '@/features/nutrition/server/actions/evaluation-forms'
import type { EvaluationAnswers } from '@/features/nutrition/validation/evaluation-forms'
import { PRIVACY_HINT } from '@/features/nutrition/validation/privacy'
import { FieldError, FormMessage, fieldError, useServerForm } from '../admin/form-ui'
import { CARD, INPUT, PRIMARY_BUTTON, SECONDARY_BUTTON } from '../admin/styles'

/** Whose form this is, which decides the server actions it posts to. */
export type EditorKind = 'trainee' | 'preceptor' | 'form13'

const ACTIONS = {
  trainee: { save: saveMyEvaluationForm, submit: submitMyEvaluationForm },
  preceptor: { save: saveTraineeEvaluation, submit: submitTraineeEvaluation },
  form13: { save: saveMyFormOneThree, submit: submitMyFormOneThree },
} as const

/**
 * An evaluation form, rendered from config/forms.ts: the header note, any
 * pending note, each section's items as a rating scale (with its anchors, and
 * MDGRS descriptors), then the free-text fields. Mobile-first: the ratings
 * wrap. "Save draft" keeps a half-filled form; "Submit" asks first, because a
 * submitted form is locked. The server checks and scores everything again;
 * this only shows what it reports. Only the ratings and texts are posted,
 * with the form's id: no assessment point, no total.
 */
export function EvaluationFormEditor({
  formType,
  formId,
  kind,
  answers,
}: {
  formType: EvaluationFormType
  formId: string
  kind: EditorKind
  answers: EvaluationAnswers
}) {
  const definition = EVALUATION_FORMS[formType]
  const actions = ACTIONS[kind]
  const { state: saveState, pending: saving, submit: save } = useServerForm(actions.save)
  const { state: submitState, pending: submitting, submit: send } = useServerForm(actions.submit)
  const [last, setLast] = useState<'save' | 'submit'>('save')
  const [confirming, setConfirming] = useState<FormData | null>(null)
  const state = last === 'submit' ? submitState : saveState
  const pending = saving || submitting
  const id = useId()
  const confidential = formType === 'FORM_1_3'

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const submitter = (event.nativeEvent as SubmitEvent).submitter
    if (submitter?.getAttribute('value') === 'submit') {
      setConfirming(formData)
    } else {
      setLast('save')
      save(formData)
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-6">
        <input type="hidden" name="formId" value={formId} />

        {confidential && (
          <p role="note" className="rounded-lg border border-blue-300 bg-blue-50 p-3 text-sm font-medium text-blue-900">
            {FORM_1_3_CONFIDENTIAL_NOTICE}
          </p>
        )}
        {definition.headerNote && (
          <p role="note" className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
            {definition.headerNote}
          </p>
        )}
        {definition.pending && (
          <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Still to come from the program: {definition.pending}.
          </p>
        )}

        {definition.sections.map((section) => (
          <section key={section.key} className={CARD} aria-label={section.title}>
            <h2 className="text-base font-semibold text-gray-900">{section.title}</h2>
            <div className="mt-4 space-y-5">
              {section.items.map((item) => (
                <RatingField
                  key={item.key}
                  id={`${id}-${item.key}`}
                  item={item}
                  scale={section.scale}
                  value={answers.ratings[item.key]}
                  error={fieldError(state, ratingFieldName(item.key))}
                />
              ))}
            </div>
          </section>
        ))}

        {definition.freeText.length > 0 && (
          <section className={CARD} aria-label="Comments">
            <p role="note" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">
              {PRIVACY_HINT}
            </p>
            <div className="mt-4 space-y-4">
              {definition.freeText.map((field) => {
                const fieldId = `${id}-${field.key}`
                const error = fieldError(state, textFieldName(field.key))
                return (
                  <div key={field.key}>
                    <label htmlFor={fieldId} className="block text-sm font-medium text-gray-800">
                      {field.optional ? `${field.label} (optional)` : field.label}
                    </label>
                    <textarea
                      id={fieldId}
                      name={textFieldName(field.key)}
                      dir="auto"
                      rows={4}
                      maxLength={MAX_FORM_TEXT}
                      defaultValue={answers.text[field.key] ?? ''}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? `${fieldId}-error` : undefined}
                      className={`${INPUT} mt-1`}
                    />
                    <FieldError id={`${fieldId}-error`} message={error} />
                  </div>
                )
              })}
            </div>
          </section>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" value="save" disabled={pending} className={SECONDARY_BUTTON}>
            {saving ? 'Saving…' : 'Save draft'}
          </button>
          <button type="submit" value="submit" disabled={pending} className={PRIMARY_BUTTON}>
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
          <FormMessage state={state} />
        </div>
      </form>

      {confirming && (
        <ConfirmModal
          title={`Submit ${definition.title}?`}
          message={
            confidential
              ? 'After submitting, this form can never be changed or withdrawn. Your name is not stored with it.'
              : 'After submitting you cannot change it, unless your primary preceptor reopens it.'
          }
          confirmLabel="Submit"
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

/** One rated item: a radio group over the scale, each point with its anchor, and the item's descriptors. */
function RatingField({ id, item, scale, value, error }: { id: string; item: RatedItem; scale: RatingScale; value?: number; error?: string }) {
  const points = Array.from({ length: scale.max - scale.min + 1 }, (_, i) => scale.min + i)
  const descriptors = Object.entries(item.descriptors ?? {})
  return (
    <fieldset aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="text-sm font-medium text-gray-800">{item.label}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {points.map((point) => (
          <label
            key={point}
            className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm has-[:checked]:border-red-500 has-[:checked]:bg-red-50"
          >
            <input type="radio" name={ratingFieldName(item.key)} value={point} defaultChecked={value === point} />
            <span>
              {point}
              {scale.anchors?.[point] ? ` · ${scale.anchors[point]}` : ''}
            </span>
          </label>
        ))}
      </div>
      {descriptors.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-gray-500">
          {descriptors.map(([point, text]) => (
            <li key={point}>
              <span className="font-semibold">{point}:</span> {text}
            </li>
          ))}
        </ul>
      )}
      <FieldError id={`${id}-error`} message={error} />
    </fieldset>
  )
}
