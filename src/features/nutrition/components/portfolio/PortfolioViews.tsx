import type { SubmissionStatus } from '@prisma/client'
import type { PerformanceSummary, ProgramAnalytics } from '@/features/nutrition/server/portfolio-core'
import { CARD } from '../admin/styles'
import { epaLevelLabel } from '../epa/epa-display'
import { ScorecardView } from '../wpba/WpbaViews'
import { CASE_LOG_STATUS_LABELS, TRAINEE_STATUS_LABELS, checklistText, groupNote, groupText, summativeText } from './portfolio-display'

// Read-only Step 7 views. Server components; the data comes from
// server/queries/portfolio.ts, which has already checked who may see it.

const STATUSES: SubmissionStatus[] = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED']

export function MdgrsTable({ mdgrs }: { mdgrs: PerformanceSummary['mdgrs'] }) {
  if (mdgrs.length === 0) return <p className="text-sm text-gray-500">No MDGRS (Form 3.1) submitted yet.</p>
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs text-gray-500">
        <tr>
          <th className="py-1 pr-3 font-medium">Month</th>
          <th className="py-1 pr-3 font-medium">Score</th>
        </tr>
      </thead>
      <tbody>
        {mdgrs.map((entry) => (
          <tr key={entry.point} className="border-t border-gray-100">
            <td className="py-1 pr-3">{entry.point}</td>
            <td className="py-1 pr-3">{entry.total !== null && entry.maxScore ? `${entry.total} / ${entry.maxScore}` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function CaseLogCounts({ counts }: { counts: PerformanceSummary['caseLogs'] }) {
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {STATUSES.map((status) => (
        <div key={status} className="rounded-lg border border-gray-200 p-3">
          <dt className="text-xs text-gray-500">{CASE_LOG_STATUS_LABELS[status]}</dt>
          <dd className="text-lg font-semibold text-gray-900">{counts[status]}</dd>
        </div>
      ))}
    </dl>
  )
}

export function SummativeView({ summary }: { summary: PerformanceSummary }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-gray-900">{summativeText(summary.summative, summary.reachedMonth12)}</p>
      <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
        {summary.summative.epas.map((epa) => (
          <li key={epa.key}>
            {epa.label}: {epa.latest ? epaLevelLabel(epa.latest) : 'Not assessed yet'}{epa.meets ? ' · ✓ target met' : ''}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The Month 12 final performance summary, printable. */
export function PerformanceSummaryView({ summary }: { summary: PerformanceSummary }) {
  return (
    <div className="space-y-4">
      <section className={CARD} aria-label="Trainee">
        <h2 className="text-lg font-semibold text-gray-900" dir="auto">
          {summary.traineeName}
        </h2>
        <p className="text-sm text-gray-600">Training start date: {summary.trainingStartDate ?? 'not set'}</p>
        <p className="text-sm text-gray-600">
          Certificate: {summary.credential ? `issued ${summary.credential.issuedOn}${summary.credential.revoked ? ' (revoked)' : ''}` : 'not issued'}
        </p>
      </section>
      <section className={CARD} aria-label="Summative EPA status">
        <h3 className="mb-2 text-base font-semibold text-gray-900">Summative EPA status</h3>
        <SummativeView summary={summary} />
      </section>
      <section className={CARD} aria-label="MDGRS">
        <h3 className="mb-2 text-base font-semibold text-gray-900">Monthly MDGRS (Form 3.1)</h3>
        <MdgrsTable mdgrs={summary.mdgrs} />
      </section>
      <ScorecardView traineeName="WPBA scorecard" scorecard={summary.wpba} />
      <section className={CARD} aria-label="Case logs and checklist">
        <h3 className="mb-2 text-base font-semibold text-gray-900">Case logs</h3>
        <CaseLogCounts counts={summary.caseLogs} />
        <p className="mt-3 text-sm text-gray-700">Month 9 standards checklist: {checklistText(summary.checklist)}</p>
      </section>
    </div>
  )
}

function Metric({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-lg font-semibold text-gray-900">{value}</dd>
      {note && <dd className="text-xs text-gray-500">{note}</dd>}
    </div>
  )
}

/** The Kirkpatrick-style program aggregates. Every value the server hid shows "Not enough data". */
export function AnalyticsView({ analytics }: { analytics: ProgramAnalytics }) {
  return (
    <div className="space-y-4">
      <section className={CARD} aria-label="Trainees">
        <h2 className="mb-2 text-base font-semibold text-gray-900">Active trainees by status</h2>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {analytics.traineesByStatus.map((entry) => (
            <Metric key={entry.status} label={TRAINEE_STATUS_LABELS[entry.status]} value={groupText(entry.count)} note={groupNote(entry.count)} />
          ))}
        </dl>
      </section>
      <section className={CARD} aria-label="Level 1">
        <h2 className="mb-2 text-base font-semibold text-gray-900">Level 1 · Reaction</h2>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Metric label="Form 1.1 average (trainee monthly)" value={groupText(analytics.level1.form11Percent, '%')} note={groupNote(analytics.level1.form11Percent)} />
          <Metric label="Form 1.3 average (confidential, all preceptors)" value={groupText(analytics.level1.form13Percent, '%')} note={groupNote(analytics.level1.form13Percent)} />
        </dl>
      </section>
      <section className={CARD} aria-label="Level 2">
        <h2 className="mb-2 text-base font-semibold text-gray-900">Level 2 · Learning (WPBA)</h2>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {analytics.level2.map((entry) => (
            <Metric key={entry.type} label={`${entry.title} average`} value={groupText(entry.averageTotal)} note={entry.averagePercent.hidden ? groupNote(entry.averagePercent) : `${entry.averagePercent.value}%`} />
          ))}
        </dl>
      </section>
      <section className={CARD} aria-label="Level 3">
        <h2 className="mb-2 text-base font-semibold text-gray-900">Level 3 · Behaviour</h2>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Metric label="MDGRS average (out of 30)" value={groupText(analytics.level3.mdgrsAverage)} note={groupNote(analytics.level3.mdgrsAverage)} />
          <Metric label="Mini-CEX average total" value={groupText(analytics.level3.miniCexAverage)} note={groupNote(analytics.level3.miniCexAverage)} />
        </dl>
      </section>
      <section className={CARD} aria-label="Level 4">
        <h2 className="mb-2 text-base font-semibold text-gray-900">Level 4 · Results (EPA)</h2>
        <dl className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {analytics.level4.epaLevels.map((entry) => (
            <Metric key={entry.level} label={`Latest at ${entry.level}`} value={groupText(entry.count)} />
          ))}
          <Metric label="Summative target reached" value={groupText(analytics.level4.summativeReached)} note={groupNote(analytics.level4.summativeReached)} />
        </dl>
      </section>
    </div>
  )
}
