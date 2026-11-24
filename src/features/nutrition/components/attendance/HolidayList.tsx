'use client'

import { useId } from 'react'
import { useRouter } from 'next/navigation'
import { voidHoliday } from '@/features/nutrition/server/actions/attendance'
import type { HolidayView } from '@/features/nutrition/server/queries/attendance'
import { FormMessage, describedBy, fieldError, useServerForm } from '../admin/form-ui'
import { INPUT, SECONDARY_BUTTON } from '../admin/styles'
import { dayLabel } from './attendance-display'

/** One holiday's remove form: a required reason, then the server action (the row is kept, marked removed). */
function RemoveHoliday({ holiday }: { holiday: HolidayView }) {
  const router = useRouter()
  const { formRef, state, pending, onSubmit } = useServerForm(voidHoliday, { resetOnSuccess: true, onSuccess: () => router.refresh() })
  const id = useId()
  const error = fieldError(state, 'reason')
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-red-700">Remove…</summary>
      <form ref={formRef} onSubmit={onSubmit} className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
        <input type="hidden" name="holidayId" value={holiday.id} />
        <label htmlFor={`${id}-reason`} className="sr-only">
          Reason for removing
        </label>
        <input {...describedBy(`${id}-reason`, error)} name="reason" required maxLength={500} dir="auto" placeholder="Reason (required)" className={INPUT} />
        <button type="submit" disabled={pending} className={SECONDARY_BUTTON}>
          {pending ? 'Removing…' : 'Remove'}
        </button>
        {error && (
          <p id={`${id}-reason-error`} className="text-xs text-red-600">
            {error}
          </p>
        )}
        <FormMessage state={state} />
      </form>
    </details>
  )
}

/**
 * Live holidays (Step 8 UI). With removable, each row gets a remove form; the
 * server action decides again who may remove which holiday.
 */
export function HolidayList({ holidays, removable, empty }: { holidays: readonly HolidayView[]; removable: boolean; empty: string }) {
  if (holidays.length === 0) return <p className="text-sm text-gray-500">{empty}</p>
  return (
    <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
      {holidays.map((holiday) => (
        <li key={holiday.id} className="p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-medium text-gray-900">{dayLabel(holiday.workDate)}</span>
            <span dir="auto" className="text-gray-700">
              {holiday.name}
            </span>
          </div>
          {removable && <RemoveHoliday holiday={holiday} />}
        </li>
      ))}
    </ul>
  )
}
