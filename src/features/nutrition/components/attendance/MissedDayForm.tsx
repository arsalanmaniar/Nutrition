'use client'

import { useId } from 'react'
import { useRouter } from 'next/navigation'
import { createMissedRecord } from '@/features/nutrition/server/actions/attendance'
import { PRIVACY_HINT } from '@/features/nutrition/validation/privacy'
import { Field, FormMessage, describedBy, fieldError, useServerForm } from '../admin/form-ui'
import { CARD, INPUT, PRIMARY_BUTTON } from '../admin/styles'

/**
 * Records a day the trainee missed (Step 8 UI), with a required reason. The
 * record is saved as "Recorded by staff"; the trainee sees that badge, never
 * the reason. The server action checks the day (past or today, a working
 * day, no live record, on or after the start date) and the caller again.
 */
export function MissedDayForm({ traineeId, today }: { traineeId: string; today: string }) {
  const router = useRouter()
  const { formRef, state, pending, onSubmit } = useServerForm(createMissedRecord, { resetOnSuccess: true, onSuccess: () => router.refresh() })
  const id = useId()
  const error = (name: string) => fieldError(state, name)

  return (
    <form ref={formRef} onSubmit={onSubmit} className={`${CARD} space-y-4`}>
      <input type="hidden" name="traineeId" value={traineeId} />
      <fieldset disabled={pending} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field id={`${id}-date`} label="Day" error={error('workDate')}>
          <input {...describedBy(`${id}-date`, error('workDate'))} type="date" name="workDate" required max={today} className={INPUT} />
        </Field>
        <Field id={`${id}-in`} label="Check-in (Karachi)" error={error('checkInTime')}>
          <input {...describedBy(`${id}-in`, error('checkInTime'))} type="time" name="checkInTime" required className={INPUT} />
        </Field>
        <Field id={`${id}-out`} label="Check-out (Karachi)" error={error('checkOutTime')} hint="Optional.">
          <input {...describedBy(`${id}-out`, error('checkOutTime'))} type="time" name="checkOutTime" className={INPUT} />
        </Field>
        <div className="sm:col-span-3">
          <Field id={`${id}-reason`} label="Reason (required, not shown to the trainee)" error={error('reason')} hint={PRIVACY_HINT}>
            <textarea {...describedBy(`${id}-reason`, error('reason'))} name="reason" required rows={2} maxLength={500} dir="auto" className={INPUT} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
          <button type="submit" className={PRIMARY_BUTTON}>
            {pending ? 'Saving…' : 'Record missed day'}
          </button>
          <FormMessage state={state} />
        </div>
      </fieldset>
    </form>
  )
}
