'use client'

import { useRouter } from 'next/navigation'
import { checkIn, checkOut } from '@/features/nutrition/server/actions/attendance'
import type { CheckInStatus } from '@/features/nutrition/server/queries/attendance'
import { FormMessage, useServerForm } from '../admin/form-ui'
import { CARD, PRIMARY_BUTTON, SECONDARY_BUTTON } from '../admin/styles'
import { ATTENDANCE_STATUS_LABELS, KARACHI_TIME_NOTE, dayLabel, weekdaysText, windowText } from './attendance-display'

/**
 * Today's check-in and check-out for the trainee (Step 8 UI). The buttons
 * reflect what the server said when the page loaded; the actions
 * (server/actions/attendance.ts) check every rule again with the server's own
 * clock, and their answer is shown as it is.
 */
export function CheckInPanel({ status }: { status: CheckInStatus }) {
  const router = useRouter()
  const refresh = { onSuccess: () => router.refresh() }
  const inForm = useServerForm(checkIn, refresh)
  const outForm = useServerForm(checkOut, refresh)
  const record = status.record

  return (
    <section aria-labelledby="today-title" className={`${CARD} space-y-4`}>
      <div>
        <h2 id="today-title" className="text-lg font-semibold text-gray-900">
          Today, {dayLabel(status.today)}
        </h2>
        <p className="text-sm text-gray-600">
          {status.holiday
            ? 'Today is a holiday.'
            : status.workingDay
              ? `Working hours: ${windowText(status.window)}.`
              : `Today is not a working day (working days: ${weekdaysText(status.window.weekdays)}).`}
        </p>
        <p className="text-xs text-gray-500">
          Page loaded at {status.now}. {KARACHI_TIME_NOTE}
        </p>
      </div>

      {record && (
        <dl className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-xs text-gray-500">Checked in</dt>
            <dd className="font-medium text-gray-900">{record.checkIn ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Checked out</dt>
            <dd className="font-medium text-gray-900">{record.checkOut ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Status</dt>
            <dd className="font-medium text-gray-900">{ATTENDANCE_STATUS_LABELS[record.status]}</dd>
          </div>
        </dl>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <form onSubmit={inForm.onSubmit} className="flex-1 space-y-2">
          <button type="submit" disabled={!status.checkIn.allowed || inForm.pending} className={`${PRIMARY_BUTTON} w-full py-3 text-base`}>
            {inForm.pending ? 'Checking in…' : 'Check in'}
          </button>
          {!status.checkIn.allowed && status.checkIn.message && <p className="text-xs text-gray-500">{status.checkIn.message}</p>}
          <FormMessage state={inForm.state} />
        </form>
        <form onSubmit={outForm.onSubmit} className="flex-1 space-y-2">
          <button type="submit" disabled={!status.checkOut.allowed || outForm.pending} className={`${SECONDARY_BUTTON} w-full py-3 text-base`}>
            {outForm.pending ? 'Checking out…' : 'Check out'}
          </button>
          {!status.checkOut.allowed && status.checkOut.message && <p className="text-xs text-gray-500">{status.checkOut.message}</p>}
          <FormMessage state={outForm.state} />
        </form>
      </div>
    </section>
  )
}
