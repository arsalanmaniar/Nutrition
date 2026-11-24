'use client'

import { useId } from 'react'
import { setTrainingStartDate } from '@/features/nutrition/server/actions/people'
import { Field, FormMessage, describedBy, fieldError, useServerForm } from './form-ui'
import { CARD, INPUT, PRIMARY_BUTTON } from './styles'

/**
 * A trainee's training start date: day one of the 12-month program, from
 * which every due form is counted. Locked once an evaluation form exists (plan
 * decision); the server enforces that, this only stops offering the form.
 */
export function StartDateForm({ profileId, value, locked }: { profileId: string; value: string | null; locked: boolean }) {
  const { formRef, state, pending, onSubmit } = useServerForm(setTrainingStartDate)
  const id = useId()
  const inputId = `${id}-start`
  const error = fieldError(state, 'trainingStartDate')

  return (
    <section className={CARD} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-base font-semibold text-gray-900">
        Training start date
      </h2>
      {locked ? (
        <div className="mt-2 text-sm">
          <p className="text-gray-800">{value ?? 'Not set'}</p>
          <p className="mt-1 text-gray-500">
            Locked: this trainee already has evaluation forms, so the start date can no longer change.
          </p>
        </div>
      ) : (
        <form ref={formRef} onSubmit={onSubmit} className="mt-4 space-y-4">
          <input type="hidden" name="profileId" value={profileId} />
          <Field
            id={inputId}
            label="Day one of the 12-month program"
            error={error}
            hint="Every due form is counted from this date, so it locks once the first evaluation form exists."
            className="max-w-xs"
          >
            <input
              {...describedBy(inputId, error)}
              name="trainingStartDate"
              type="date"
              required
              defaultValue={value ?? ''}
              className={INPUT}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
              {pending ? 'Saving…' : 'Save date'}
            </button>
            <FormMessage state={state} />
          </div>
        </form>
      )}
    </section>
  )
}
