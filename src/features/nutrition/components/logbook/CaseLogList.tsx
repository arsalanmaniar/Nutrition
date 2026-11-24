import Link from 'next/link'
import { CASE_LOG_FORMS } from '@/features/nutrition/config/case-log-forms'
import type { CaseLogRow } from '@/features/nutrition/server/queries/case-logs'
import { CARD } from '../admin/styles'
import { StatusBadge } from './StatusBadge'

// The trainee's case logs, newest first, as a list that reads well on a phone.
// Each entry opens the log. Rendered on the server.

export function CaseLogList({ logs }: { logs: CaseLogRow[] }) {
  if (logs.length === 0) {
    return (
      <section className={CARD}>
        <p className="font-medium text-gray-800">No case logs yet.</p>
        <p className="mt-1 text-sm text-gray-500">Start one with “New case log”. It stays a draft until you submit it.</p>
      </section>
    )
  }

  return (
    <section className={`${CARD} !p-0 overflow-hidden`} aria-label="Case logs">
      <ul className="divide-y divide-gray-100">
        {logs.map((log) => (
          <li key={log.id}>
            <Link
              href={`/nutrition/trainee/logbook/${log.id}`}
              className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-gray-50"
            >
              <span className="min-w-0">
                <span className="font-semibold text-gray-900">{log.caseCode}</span>
                <span className="ml-2 text-sm text-gray-500">{CASE_LOG_FORMS[log.formType].title}</span>
                <span className="mt-0.5 block truncate text-xs text-gray-500">
                  <span dir="auto">{log.rotationName ?? 'No rotation yet'}</span>
                  {' · '}EPA {log.epaLevel ?? '—'}
                  {' · '}updated {log.updatedOn}
                </span>
              </span>
              <StatusBadge status={log.status} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
