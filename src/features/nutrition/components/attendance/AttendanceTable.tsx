import type { AttendanceDay, ScheduleView, VoidableRecord } from '@/features/nutrition/server/queries/attendance'
import { RecordEditForm } from './RecordEditForm'
import { VoidRecordForm } from './VoidRecordForm'
import { ATTENDANCE_STATUS_LABELS, dayLabel, weekdaysText } from './attendance-display'

// Read-only tables for the attendance screens (Step 8 UI). Server components;
// the loaders in server/queries/attendance.ts have already decided what the
// caller may see. Times are Karachi time, as the loaders return them.

function StatusBadge({ status }: { status: AttendanceDay['status'] }) {
  const staff = status === 'OUT_OF_WINDOW_RECORDED_BY_STAFF'
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${staff ? 'bg-blue-50 text-blue-800' : 'bg-green-50 text-green-800'}`}>
      {ATTENDANCE_STATUS_LABELS[status]}
    </span>
  )
}

/**
 * A month's live records, oldest first. With editable (the trainee's primary
 * preceptor), each row has an edit form; the server action checks the
 * caller again.
 */
export function AttendanceTable({ days, editable = false, empty }: { days: readonly AttendanceDay[]; editable?: boolean; empty: string }) {
  if (days.length === 0) return <p className="text-sm text-gray-500">{empty}</p>
  return (
    <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
      {days.map((day) => (
        <li key={day.id} className="p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium text-gray-900">{dayLabel(day.workDate)}</span>
            <span className="text-gray-700">
              In {day.checkIn ?? '—'} · Out {day.checkOut ?? '—'}
            </span>
            <StatusBadge status={day.status} />
          </div>
          {editable && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-red-700">Edit…</summary>
              <RecordEditForm record={day} />
            </details>
          )}
        </li>
      ))}
    </ul>
  )
}

/** Schedules, newest first: working days, hours and the first day each applies. */
export function ScheduleTable({ schedules, empty }: { schedules: readonly ScheduleView[]; empty: string }) {
  if (schedules.length === 0) return <p className="text-sm text-gray-500">{empty}</p>
  return (
    <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white text-sm">
      {schedules.map((row) => (
        <li key={row.id} className="flex flex-wrap justify-between gap-2 p-3">
          <span className="font-medium text-gray-900">From {dayLabel(row.effectiveFrom)}</span>
          <span className="text-gray-700">
            {weekdaysText(row.weekdays)}, {row.startTime}–{row.endTime}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * The super_admin's record list for the month (Step 8 UI): every record,
 * deleted ones greyed and flagged, live ones with a delete form. Rendered
 * only for a super_admin; the loader and the action refuse anyone else.
 */
export function VoidableRecordsTable({ records }: { records: readonly VoidableRecord[] }) {
  if (records.length === 0) return <p className="text-sm text-gray-500">No attendance records this month.</p>
  return (
    <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
      {records.map((record) => (
        <li key={record.id} className={`p-3 text-sm ${record.voided ? 'bg-gray-50 text-gray-400' : ''}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{dayLabel(record.workDate)}</span>
            <span dir="auto">{record.traineeName}</span>
            {record.voided ? (
              <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600">Deleted</span>
            ) : (
              <StatusBadge status={record.status} />
            )}
          </div>
          {!record.voided && (
            <div className="mt-1">
              <VoidRecordForm recordId={record.id} />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
