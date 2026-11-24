import type { EpaStatus } from '@/features/nutrition/server/queries/epa'
import { CARD, INPUT, SECONDARY_BUTTON } from '../admin/styles'
import { epaLevelLabel } from './epa-display'

// Read-only views for the EPA screens (Step 6b). Server components; the data
// comes from server/queries/epa.ts, which has already checked who may see it.

/** A GET form choosing one of the caller's trainees; the page renders the choice from the URL. */
export function TraineePicker({
  href,
  trainees,
  traineeId,
  empty,
}: {
  href: string
  trainees: readonly { traineeId: string; traineeName: string }[]
  traineeId: string | null
  empty: string
}) {
  if (trainees.length === 0) return <p className="text-sm text-gray-500">{empty}</p>
  return (
    <form method="get" action={href} className={`${CARD} grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto] sm:items-end`}>
      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium text-gray-600">Trainee</span>
        <select name="trainee" required defaultValue={traineeId ?? ''} className={INPUT}>
          <option value="">Choose a trainee…</option>
          {trainees.map((trainee) => (
            <option key={trainee.traineeId} value={trainee.traineeId}>
              {trainee.traineeName}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className={SECONDARY_BUTTON}>
        Show trainee
      </button>
    </form>
  )
}

/** Every EPA with its current level and the full history, newest first. */
export function EpaStatusList({ epas }: { epas: readonly EpaStatus[] }) {
  return (
    <ul className="space-y-3">
      {epas.map((epa) => (
        <li key={epa.key} className={CARD}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-base font-semibold text-gray-900">{epa.label}</h3>
            <p className="text-sm text-gray-700">
              {epa.current ? (
                <>
                  Current: <span className="font-semibold">{epaLevelLabel(epa.current.level)}</span>
                </>
              ) : (
                'No level recorded yet'
              )}
            </p>
          </div>
          {epa.history.length > 0 && (
            <details className="mt-3" open={epa.history.length === 1}>
              <summary className="cursor-pointer text-sm text-gray-600">History ({epa.history.length})</summary>
              <table className="mt-2 w-full text-left text-sm">
                <thead className="text-xs text-gray-500">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Date</th>
                    <th className="py-1 pr-3 font-medium">Level</th>
                    <th className="py-1 pr-3 font-medium">Miller level</th>
                    <th className="py-1 pr-3 font-medium">By</th>
                  </tr>
                </thead>
                <tbody>
                  {epa.history.map((entry) => (
                    <tr key={entry.id} className="border-t border-gray-100 align-top">
                      <td className="py-1 pr-3 whitespace-nowrap">{entry.assessedOn}</td>
                      <td className="py-1 pr-3">{epaLevelLabel(entry.level)}</td>
                      <td className="py-1 pr-3">{entry.millerLabel}</td>
                      <td className="py-1 pr-3">
                        <span dir="auto">{entry.assessorName}</span>
                        {entry.notes && (
                          <p dir="auto" className="mt-1 text-gray-600">
                            {entry.notes}
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </li>
      ))}
    </ul>
  )
}
