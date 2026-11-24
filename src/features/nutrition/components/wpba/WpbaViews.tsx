import Link from 'next/link'
import type { WpbaType } from '@prisma/client'
import { WPBA_FORMS } from '@/features/nutrition/config/forms'
import type { WpbaFailReason, WpbaScorecard } from '@/features/nutrition/server/wpba-core'
import type { AssessableTrainee, FiledAssessment } from '@/features/nutrition/server/queries/wpba-picker'
import { CARD, INPUT, SECONDARY_BUTTON } from '../admin/styles'
import { percentLabel, resultLabel } from './wpba-display'

// The read-only pieces of the WPBA screens (Step 5b). Server components: they
// show what the loaders return, as the server stored it, and add nothing.

const TYPES = Object.keys(WPBA_FORMS) as WpbaType[]

/** One WPBA row, as both the assessor's and the trainee's list show it. */
export interface WpbaListRow {
  id: string
  title: string
  assessedOn: string
  total: number | null
  maxScore: number | null
  passed: boolean | null
  failReasons: WpbaFailReason[]
  procedure: string | null
  caseCode: string | null
  feedback: string | null
  /** The other person's display name: the trainee for an assessor, the assessor for a trainee. */
  person: string
}

function Score({ total, maxScore }: { total: number | null; maxScore: number | null }) {
  if (total === null || maxScore === null) return null
  return (
    <span>
      {total} / {maxScore} ({percentLabel(total, maxScore)})
    </span>
  )
}

function Result({ passed, failReasons }: { passed: boolean | null; failReasons: WpbaFailReason[] }) {
  const label = resultLabel(passed, failReasons)
  if (!label) return null
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
      {label}
    </span>
  )
}

/** WPBAs, newest first: type, date, procedure or case code, score, OSCE result with its reason, feedback, and the other person's name. */
export function WpbaList({ rows, personLabel, empty }: { rows: WpbaListRow[]; personLabel: string; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-gray-500">{empty}</p>
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.id} className={CARD}>
          <p className="flex flex-wrap items-center gap-2 font-medium text-gray-900">
            {row.title}
            <span className="text-sm font-normal text-gray-600">· {row.assessedOn}</span>
            <Result passed={row.passed} failReasons={row.failReasons} />
          </p>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-600">
            <span>
              {personLabel}: <span dir="auto">{row.person}</span>
            </span>
            {row.procedure && <span dir="auto">Procedure: {row.procedure}</span>}
            {row.caseCode && <span>Case log: {row.caseCode}</span>}
            <Score total={row.total} maxScore={row.maxScore} />
          </p>
          {row.feedback && (
            <p dir="auto" className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-800">
              {row.feedback}
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}

/** The "New assessment" picker: a plain GET form, so the server renders the chosen trainee's form from the URL. */
export function WpbaPicker({
  href,
  trainees,
  traineeId,
  type,
}: {
  href: string
  trainees: AssessableTrainee[]
  traineeId: string | null
  type: WpbaType | null
}) {
  if (trainees.length === 0) {
    return <p className="text-sm text-gray-500">You have no trainee to assess today: no primary trainee and no placement covering today.</p>
  }
  return (
    <form method="get" action={href} className={`${CARD} grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end`}>
      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium text-gray-600">Trainee</span>
        <select name="trainee" required defaultValue={traineeId ?? ''} className={INPUT}>
          <option value="">Choose a trainee…</option>
          {trainees.map((trainee) => (
            <option key={trainee.traineeId} value={trainee.traineeId}>
              {trainee.traineeName}
              {trainee.via === 'PLACEMENT' ? ' (rotation placement)' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium text-gray-600">Assessment</span>
        <select name="type" required defaultValue={type ?? ''} className={INPUT}>
          <option value="">Choose a type…</option>
          {TYPES.map((value) => (
            <option key={value} value={value}>
              {WPBA_FORMS[value].title}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className={SECONDARY_BUTTON}>
        Open form
      </button>
    </form>
  )
}

/** What the server stored for the WPBA just filed, including an OSCE's result and its reasons. */
export function FiledResult({ filed, href }: { filed: FiledAssessment | null; href: string }) {
  return (
    <section className={`${CARD} space-y-2`} aria-label="Submitted">
      {filed ? (
        <>
          <p className="font-medium text-gray-900">
            {filed.title} for <span dir="auto">{filed.traineeName}</span>, assessed {filed.assessedOn}: submitted.
          </p>
          <p className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
            Server result: <Score total={filed.total} maxScore={filed.maxScore} />
            <Result passed={filed.passed} failReasons={filed.failReasons} />
          </p>
          <p className="text-sm text-gray-500">A WPBA is final: it cannot be edited. A mistake needs a new assessment.</p>
        </>
      ) : (
        <p className="text-sm text-gray-600">No assessment filed yet.</p>
      )}
      <Link href={href} className="inline-block text-sm font-medium text-red-600 hover:text-red-700">
        File another assessment
      </Link>
    </section>
  )
}

/** One trainee's WPBA scorecard: count and latest score per type, and the highest Miller level reached. */
export function ScorecardView({ traineeName, scorecard }: { traineeName: string; scorecard: WpbaScorecard }) {
  return (
    <section className={CARD} aria-label={traineeName}>
      <h2 dir="auto" className="flex flex-wrap items-baseline justify-between gap-2 text-base font-semibold text-gray-900">
        {traineeName}
        <span className="text-sm font-normal text-gray-600">Highest Miller level: {scorecard.highestMillerLabel ?? 'none yet'}</span>
      </h2>
      <dl className="mt-3 divide-y divide-gray-100">
        {scorecard.types.map((entry) => (
          <div key={entry.type} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
            <dt className="font-medium text-gray-800">
              {entry.title} <span className="font-normal text-gray-500">({entry.count})</span>
            </dt>
            <dd className="flex flex-wrap items-center gap-2 text-gray-700">
              {entry.latest ? (
                <>
                  <span>Latest {entry.latest.assessedOn}:</span>
                  <Score total={entry.latest.total} maxScore={entry.latest.maxScore} />
                  <Result passed={entry.latest.passed} failReasons={[]} />
                </>
              ) : (
                <span className="text-gray-400">none yet</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
