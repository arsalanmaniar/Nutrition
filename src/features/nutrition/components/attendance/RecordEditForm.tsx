'use client'

import { useId } from 'react'
import { useRouter } from 'next/navigation'
import { editRecord } from '@/features/nutrition/server/actions/attendance'
import type { AttendanceDay } from '@/features/nutrition/server/queries/attendance'
import { Field, FormMessage, describedBy, fieldError, useServerForm } from '../admin/form-ui'
import { INPUT, PRIMARY_BUTTON } from '../admin/styles'
import { ATTENDANCE_STATUS_LABELS } from './attendance-display'

/**
 * Edits one record's times (Karachi, on the record's own day) and status
 * (Step 8 UI). Only a super_admin or the trainee's active primary preceptor
 * may save; the server action checks that and the times again.
 */
export function RecordEditForm({ record }: { record: AttendanceDay }) {
  const router = useRouter()
  const { formRef, state, pending, onSubmit } = useServerForm(editRecord, { onSuccess: () => router.refresh() })
  const id = useId()
  const error = (name: string) => fieldError(state, name)

  return (
    <form ref={formRef} onSubmit={onSubmit} className="mt-2 space-y-3">
      <input type="hidden" name="recordId" value={record.id} />
      <fieldset disabled={pending} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field id={`${id}-in`} label="Check-in (Karachi)" error={error('checkInTime')}>
          <input {...describedBy(`${id}-in`, error('checkInTime'))} type="time" name="checkInTime" required defaultValue={record.checkIn ?? ''} className={INPUT} />
        </Field>
        <Field id={`${id}-out`} label="Check-out (Karachi)" error={error('checkOutTime')} hint="Leave empty for none.">
          <input {...describedBy(`${id}-out`, error('checkOutTime'))} type="time" name="checkOutTime" defaultValue={record.checkOut ?? ''} className={INPUT} />
        </Field>
        <Field id={`${id}-status`} label="Status" error={error('status')}>
          <select {...describedBy(`${id}-status`, error('status'))} name="status" defaultValue={record.status} className={INPUT}>
            {Object.entries(ATTENDANCE_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
          <button type="submit" className={PRIMARY_BUTTON}>
            {pending ? 'Saving…' : 'Save changes'}
          </button>
          <FormMessage state={state} />
        </div>
      </fieldset>
    </form>
  )
}
