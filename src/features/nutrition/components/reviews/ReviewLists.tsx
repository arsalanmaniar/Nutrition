import Link from 'next/link'
import type { ReactNode } from 'react'
import { CASE_LOG_FORMS } from '@/features/nutrition/config/case-log-forms'
import type { ReviewHistoryRow, ReviewQueueRow } from '@/features/nutrition/server/queries/case-log-reviews'
import { CARD } from '../admin/styles'
import { StatusBadge } from '../logbook/StatusBadge'

// The preceptor's two lists: logs waiting for review, oldest first, and logs
// already reviewed. Each entry opens the log. Rendered on the server.

const REVIEWS_HREF = '/nutrition/preceptor/reviews'

export function ReviewQueue({ rows }: { rows: ReviewQueueRow[] }) {
  if (rows.length === 0) {
    return (
      <section className={CARD}>
        <p className="font-medium text-gray-800">Nothing is waiting for your review.</p>
        <p className="mt-1 text-sm text-gray-500">Logs your trainees submit appear here, oldest first.</p>
      </section>
    )
  }
  return (
    <List label="Waiting for review">
      {rows.map((row) => (
        <Entry key={row.id} id={row.id} caseCode={row.caseCode} formType={row.formType} traineeName={row.traineeName}>
          <span dir="auto">{row.rotationName ?? 'No rotation'}</span>
          {' · '}EPA {row.epaLevel ?? '—'}
          {' · '}submitted {row.submittedOn ?? '—'}
        </Entry>
      ))}
    </List>
  )
}

export function ReviewHistory({ rows }: { rows: ReviewHistoryRow[] }) {
  if (rows.length === 0) {
    return (
      <section className={CARD}>
        <p className="text-sm text-gray-500">No reviewed logs yet.</p>
      </section>
    )
  }
  return (
    <List label="Reviewed">
      {rows.map((row) => (
        <Entry key={row.id} id={row.id} caseCode={row.caseCode} formType={row.formType} traineeName={row.traineeName} status={row.status}>
          reviewed {row.reviewedOn ?? '—'}
          {row.reviewerName && (
            <>
              {' by '}
              <span dir="auto">{row.reviewerName}</span>
            </>
          )}
        </Entry>
      ))}
    </List>
  )
}

function List({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className={`${CARD} !p-0 overflow-hidden`} aria-label={label}>
      <ul className="divide-y divide-gray-100">{children}</ul>
    </section>
  )
}

function Entry({
  id,
  caseCode,
  formType,
  traineeName,
  status,
  children,
}: Pick<ReviewQueueRow, 'id' | 'caseCode' | 'formType' | 'traineeName'> & {
  status?: ReviewHistoryRow['status']
  children: ReactNode
}) {
  return (
    <li>
      <Link href={`${REVIEWS_HREF}/${id}`} className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-gray-50">
        <span className="min-w-0">
          <span className="font-semibold text-gray-900">{caseCode}</span>
          <span className="ml-2 text-sm text-gray-500">{CASE_LOG_FORMS[formType].title}</span>
          <span dir="auto" className="block text-sm text-gray-700">
            {traineeName}
          </span>
          <span className="mt-0.5 block truncate text-xs text-gray-500">{children}</span>
        </span>
        {status && <StatusBadge status={status} />}
      </Link>
    </li>
  )
}
