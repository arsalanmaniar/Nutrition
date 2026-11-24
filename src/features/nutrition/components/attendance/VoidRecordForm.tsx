'use client'

import { useId } from 'react'
import { useRouter } from 'next/navigation'
import { voidRecord } from '@/features/nutrition/server/actions/attendance'
import { FormMessage, describedBy, fieldError, useServerForm } from '../admin/form-ui'
import { INPUT, SECONDARY_BUTTON } from '../admin/styles'

/**
 * Deletes (voids) one attendance record, super_admin only (Step 8 UI). The row
 * stays in the database, marked deleted, and drops out of every count. The
 * server action refuses anyone who is not a super_admin.
 */
export function VoidRecordForm({ recordId }: { recordId: string }) {
  const router = useRouter()
  const { formRef, state, pending, onSubmit } = useServerForm(voidRecord, { resetOnSuccess: true, onSuccess: () => router.refresh() })
  const id = useId()
  const error = fieldError(state, 'reason')

  return (
    <details>
      <summary className="cursor-pointer text-xs text-red-700">Delete…</summary>
      <form ref={formRef} onSubmit={onSubmit} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="recordId" value={recordId} />
        <label htmlFor={`${id}-reason`} className="sr-only">
          Reason for deleting
        </label>
        <input {...describedBy(`${id}-reason`, error)} name="reason" required maxLength={500} dir="auto" placeholder="Reason (required)" className={INPUT} />
        {error && (
          <p id={`${id}-reason-error`} className="text-xs text-red-600">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending} className={SECONDARY_BUTTON}>
          {pending ? 'Deleting…' : 'Delete record'}
        </button>
        <FormMessage state={state} />
      </form>
    </details>
  )
}
