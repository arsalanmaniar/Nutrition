import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { CaseLogForm } from '@/features/nutrition/components/logbook/CaseLogForm'
import { CaseLogView } from '@/features/nutrition/components/logbook/CaseLogView'
import { StatusBadge } from '@/features/nutrition/components/logbook/StatusBadge'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { CASE_LOG_FORMS } from '@/features/nutrition/config/case-log-forms'
import { getMyCaseLog, listLogbookRotations } from '@/features/nutrition/server/queries/case-logs'

// One of the trainee's own case logs, under Case log: same roles as that page.
// Editable while DRAFT or REJECTED, read-only once SUBMITTED or APPROVED.
// getMyCaseLog returns nothing for someone else's log, so it is a 404 here.
const LOGBOOK_HREF = '/nutrition/trainee/logbook'

export default async function CaseLogPage({ params }: { params: Promise<{ logId: string }> }) {
  await requireNutritionRole(pageRoles(LOGBOOK_HREF))
  const { logId } = await params
  const log = await getMyCaseLog(logId)
  if (!log) notFound()

  const editable = log.status === 'DRAFT' || log.status === 'REJECTED'
  const rotations = editable ? await listLogbookRotations(log.rotationId) : []

  return (
    <section className="max-w-3xl space-y-6">
      <div>
        <Link href={LOGBOOK_HREF} className="text-sm font-medium text-red-600 hover:text-red-700">
          ← Case log
        </Link>
        <h1 className="mt-2 flex flex-wrap items-center gap-3 text-2xl font-bold text-gray-900">
          {log.caseCode}
          <StatusBadge status={log.status} />
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          {CASE_LOG_FORMS[log.formType].title} · started {log.createdOn}
          {log.status === 'SUBMITTED' && ` · submitted ${log.submittedOn}, waiting for your preceptor's review`}
          {log.status === 'APPROVED' && ` · approved ${log.reviewedOn ?? ''}`}
        </p>
      </div>

      {/* The comment stays visible until the next review overwrites it (plan: Decisions, Step 3e outcome, item 3). */}
      {(log.status === 'REJECTED' || log.reviewComment) && (
        <div
          role="note"
          className={`rounded-lg border p-3 text-sm ${
            log.status === 'REJECTED' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-gray-200 bg-gray-50 text-gray-800'
          }`}
        >
          <p className="font-medium">
            {log.status === 'REJECTED'
              ? 'Your preceptor returned this log. Edit it and resubmit.'
              : log.status === 'APPROVED'
                ? "Your preceptor's comment:"
                : 'Your preceptor returned this log earlier with this comment:'}
          </p>
          {log.reviewComment && (
            <p dir="auto" className="mt-1 whitespace-pre-wrap break-words">
              {log.reviewComment}
            </p>
          )}
        </div>
      )}

      {editable ? (
        <CaseLogForm
          formType={log.formType}
          rotations={rotations}
          log={{
            id: log.id,
            status: log.status,
            rotationId: log.rotationId,
            ageBand: log.ageBand,
            diagnosisCategory: log.diagnosisCategory,
            epaLevel: log.epaLevel,
            data: log.data,
          }}
        />
      ) : (
        <CaseLogView log={log} />
      )}
    </section>
  )
}
