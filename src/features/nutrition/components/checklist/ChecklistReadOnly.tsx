import type { StandardView } from '@/features/nutrition/server/queries/standards-checklist'
import { CARD } from '../admin/styles'
import { evidenceOptionLabel, ratingLabel } from '../epa/epa-display'

/** A submitted Month 9 checklist, read-only: it can never be changed. Server component. */
export function ChecklistReadOnly({ standards, submittedAt }: { standards: readonly StandardView[]; submittedAt: string | null }) {
  const groups = [...new Set(standards.map((standard) => standard.group))]
  return (
    <div className="space-y-4">
      <p role="note" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">
        Submitted{submittedAt ? ` on ${submittedAt.slice(0, 10)}` : ''}. A submitted checklist cannot be changed.
      </p>
      {groups.map((group) => (
        <section key={group} className={CARD} aria-label={group}>
          <h3 className="text-base font-semibold text-gray-900">{group}</h3>
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-xs text-gray-500">
              <tr>
                <th className="py-1 pr-3 font-medium">Standard</th>
                <th className="py-1 pr-3 font-medium">Rating</th>
                <th className="py-1 pr-3 font-medium">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {standards
                .filter((standard) => standard.group === group)
                .map((standard) => (
                  <tr key={standard.key} className="border-t border-gray-100">
                    <td className="py-1 pr-3">{standard.label}</td>
                    <td className="py-1 pr-3">{ratingLabel(standard.rating)}</td>
                    <td className="py-1 pr-3">{standard.evidence ? evidenceOptionLabel(standard.evidence) : 'None'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  )
}
