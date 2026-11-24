'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DEFAULT_ATTENDANCE_WINDOW, DEFAULT_WORKING_WEEKDAYS, WEEKDAY_LABELS } from '@/features/nutrition/config/attendance'
import { setSchedule } from '@/features/nutrition/server/actions/attendance'
import type { AttendanceWindow } from '@/features/nutrition/server/attendance-core'
import { Field, FormMessage, describedBy, fieldError, useServerForm } from '../admin/form-ui'
import { CARD, INPUT, LABEL, PRIMARY_BUTTON } from '../admin/styles'
import { KARACHI_TIME_NOTE, weekdaysValue } from './attendance-display'

/**
 * Sets the working days and hours from a start date (Step 8 UI). scope MINE
 * is the preceptor's own trainees, from today on; PROGRAM is the admin's
 * program default, which may also start in the past (a warning shows above
 * Save). The server action checks the scope against the caller, the times and
 * the date again.
 */
export function ScheduleForm({ scope, current, today }: { scope: 'MINE' | 'PROGRAM'; current: AttendanceWindow | null; today: string }) {
  const router = useRouter()
  const initial = current ?? { weekdays: DEFAULT_WORKING_WEEKDAYS, ...DEFAULT_ATTENDANCE_WINDOW }
  const [days, setDays] = useState<number[]>([...initial.weekdays])
  const [from, setFrom] = useState(today)
  // Only the program default may start in the past; both are YYYY-MM-DD.
  const backdated = scope === 'PROGRAM' && from !== '' && from < today
  const { formRef, state, pending, onSubmit } = useServerForm(setSchedule, { onSuccess: () => router.refresh() })
  const id = useId()
  const error = (name: string) => fieldError(state, name)
  const toggle = (day: number) => setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]))

  return (
    <form ref={formRef} onSubmit={onSubmit} className={`${CARD} space-y-4`}>
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="weekdays" value={weekdaysValue(days)} />
      <fieldset disabled={pending} className="space-y-4">
        <div>
          <span className={LABEL}>Working days</span>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_LABELS.map((label, day) => (
              <label key={label} className="flex items-center gap-1 rounded-lg border border-gray-300 px-2 py-1 text-sm">
                <input type="checkbox" checked={days.includes(day)} onChange={() => toggle(day)} />
                {label.slice(0, 3)}
              </label>
            ))}
          </div>
          {error('weekdays') && <p className="mt-1 text-xs text-red-600">{error('weekdays')}</p>}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field id={`${id}-start`} label="Check-in opens" error={error('startTime')}>
            <input {...describedBy(`${id}-start`, error('startTime'))} type="time" name="startTime" required defaultValue={initial.startTime} className={INPUT} />
          </Field>
          <Field id={`${id}-end`} label="Check-in closes" error={error('endTime')} hint="Not included: at this time check-in is closed.">
            <input {...describedBy(`${id}-end`, error('endTime'))} type="time" name="endTime" required defaultValue={initial.endTime} className={INPUT} />
          </Field>
          <Field id={`${id}-from`} label="Applies from" error={error('effectiveFrom')}>
            <input
              {...describedBy(`${id}-from`, error('effectiveFrom'))}
              type="date"
              name="effectiveFrom"
              required
              min={scope === 'MINE' ? today : undefined}
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className={INPUT}
            />
          </Field>
        </div>
        {backdated && <p className="text-sm font-medium text-amber-700">This changes how attendance before today is measured.</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={PRIMARY_BUTTON}>
            {pending ? 'Saving…' : 'Save working hours'}
          </button>
          <p className="text-xs text-gray-500">{KARACHI_TIME_NOTE}</p>
          <FormMessage state={state} />
        </div>
      </fieldset>
    </form>
  )
}
