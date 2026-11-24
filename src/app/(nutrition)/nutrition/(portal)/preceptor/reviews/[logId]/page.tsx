import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { CaseLogView } from '@/features/nutrition/components/logbook/CaseLogView'
import { StatusBadge } from '@/features/nutrition/components/logbook/StatusBadge'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { ReviewForm } from '@/features/nutrition/components/reviews/ReviewForm'
import { CASE_LOG_FORMS } from '@/features/nutrition/config/case-log-forms'
import { getReviewCaseLog, type ReviewCaseLogDetail } from '@/features/nutrition/server/queries/case-log-reviews'

// One case log for review, under Case reviews: same roles as that page. Read
// only, with the approve / return form while it is SUBMITTED. getReviewCaseLog
// returns nothing for a log the caller may not see (another trainee's, a
// DRAFT, a missing one), so all of those are the same 404 here.
const REVIEWS_HREF = '/nutrition/preceptor/reviews'

export default async function ReviewCaseLogPage({ params }: { params: Promise<{ logId: string }> }) {
  await requireNutritionRole(pageRoles(REVIEWS_HREF))
  const { logId } = await params
  const log = await getReviewCaseLog(logId)
  if (!log) notFound()
  const note = reviewNote(log)

  return (
    <section className="max-w-3xl space-y-6">
      <div>
        <Link href={REVIEWS_HREF} className="text-sm font-medium text-red-600 hover:text-red-700">
          ← Case reviews
        </Link>
        <h1 className="mt-2 flex flex-wrap items-center gap-3 text-2xl font-bold text-gray-900">
          {log.caseCode}
          <StatusBadge status={log.status} />
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          <span dir="auto">{log.traineeName}</span> · {CASE_LOG_FORMS[log.formType].title}
          {log.submittedOn && ` · submitted ${log.submittedOn}`}
        </p>
      </div>

      {note && (
        <div role="note" className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800">
          <p className="font-medium">{note}</p>
          {log.reviewComment && (
            <p dir="auto" className="mt-1 whitespace-pre-wrap break-words">
              {log.reviewComment}
            </p>
          )}
        </div>
      )}

      <CaseLogView log={log} />

      {log.status === 'SUBMITTED' && <ReviewForm logId={log.id} caseCode={log.caseCode} />}
    </section>
  )
}

/** What the page says about the review so far, if anything. */
function reviewNote(log: ReviewCaseLogDetail): string | null {
  if (log.status === 'SUBMITTED') return log.reviewComment ? 'Resubmitted. It was returned with this comment:' : null
  const by = `${log.reviewedOn ? ` on ${log.reviewedOn}` : ''}${log.reviewerName ? ` by ${log.reviewerName}` : ''}`
  return log.status === 'APPROVED' ? `Approved${by}.` : `Returned to the trainee${by}. They may be editing it now.`
}
