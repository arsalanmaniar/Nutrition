'use client'

import { useId } from 'react'
import { useRouter } from 'next/navigation'
import { setHoliday } from '@/features/nutrition/server/actions/attendance'
import { PRIVACY_HINT } from '@/features/nutrition/validation/privacy'
import { Field, FormMessage, describedBy, fieldError, useServerForm } from '../admin/form-ui'
import { CARD, INPUT, PRIMARY_BUTTON } from '../admin/styles'

/**
 * Adds a holiday (Step 8 UI). scope MINE: for the preceptor's own trainees,
 * on top of the program's holidays; PROGRAM: for every trainee (admin). The
 * server action checks the scope against the caller again.
 */
export function HolidayForm({ scope, today }: { scope: 'MINE' | 'PROGRAM'; today: string }) {
  const router = useRouter()
  const { formRef, state, pending, onSubmit } = useServerForm(setHoliday, { resetOnSuccess: true, onSuccess: () => router.refresh() })
  const id = useId()
  const error = (name: string) => fieldError(state, name)

  return (
    <form ref={formRef} onSubmit={onSubmit} className={`${CARD} space-y-4`}>
      <input type="hidden" name="scope" value={scope} />
      <fieldset disabled={pending} className="grid grid-cols-1 gap-4 sm:grid-cols-[auto_1fr]">
        <Field id={`${id}-date`} label="Date" error={error('workDate')}>
          <input {...describedBy(`${id}-date`, error('workDate'))} type="date" name="workDate" required defaultValue={today} className={INPUT} />
        </Field>
        <Field id={`${id}-name`} label="Name" error={error('name')} hint={PRIVACY_HINT}>
          <input {...describedBy(`${id}-name`, error('name'))} type="text" name="name" required maxLength={100} dir="auto" className={INPUT} />
        </Field>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button type="submit" className={PRIMARY_BUTTON}>
            {pending ? 'Saving…' : 'Add holiday'}
          </button>
          <FormMessage state={state} />
        </div>
      </fieldset>
    </form>
  )
}
