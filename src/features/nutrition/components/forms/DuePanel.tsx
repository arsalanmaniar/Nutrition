import Link from 'next/link'
import type { DueRow } from '@/features/nutrition/server/queries/evaluation-forms'
import { CARD } from '../admin/styles'
import { StartFormButton } from './FormControls'
import { DUE_STATUS, pointLabel } from './labels'

/**
 * The "Due" panel: the forms the scheduler says are due (current and
 * overdue), oldest first. Only the next form of each type can be started:
 * forms are filled in order, and the server picks the period.
 */
export function DuePanel({ rows, traineeId, empty }: { rows: DueRow[]; traineeId?: string; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-gray-500">{empty}</p>
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={`${row.formType}-${row.assessmentPoint}`} className={`${CARD} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}>
          <div>
            <p className="font-medium text-gray-900">{row.title}</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-600">
              <span>{pointLabel(row.assessmentPoint)}</span>
              <span>· due by {row.dueBy}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${DUE_STATUS[row.status].className}`}>
                {DUE_STATUS[row.status].label}
              </span>
              {row.overdue && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">Overdue</span>}
            </p>
          </div>
          <div className="shrink-0">
            {row.canStart ? (
              <StartFormButton formType={row.formType} traineeId={traineeId} />
            ) : row.href ? (
              <Link href={row.href} className="text-sm font-medium text-red-600 hover:text-red-700">
                {row.status === 'SUBMITTED' ? 'View' : 'Continue'}
              </Link>
            ) : (
              <span className="text-sm text-gray-500">{row.status === 'NOT_STARTED' ? 'After the earlier one' : ''}</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
