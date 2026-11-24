import type { MsfRoundView } from '@/features/nutrition/server/queries/msf'
import { CARD } from '../admin/styles'
import { MSF_STATUS_LABELS, responsesText, roundLabel } from './msf-display'
import { RevokeInviteButton } from './MsfInviteForms'

// Read-only MSF views (Step 6c UI). Server components; the data comes from
// server/queries/msf.ts, which returns averages only from 3 responses.

/** The four domain averages when the server returns them, otherwise the count. */
export function MsfAggregateView({ aggregate }: { aggregate: MsfRoundView['aggregate'] }) {
  return (
    <div className="space-y-2">
      {!aggregate.hidden && (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {aggregate.domains.map((domain) => (
            <div key={domain.key} className="rounded-lg border border-gray-200 p-3">
              <dt className="text-xs text-gray-500">{domain.label}</dt>
              <dd className="text-lg font-semibold text-gray-900">{domain.average.toFixed(1)}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="text-sm text-gray-600">{responsesText(aggregate)}</p>
    </div>
  )
}

/** One round: its links (with Revoke on open ones) and its aggregates. */
export function MsfRoundCard({ round }: { round: MsfRoundView }) {
  return (
    <section className={CARD} aria-label={`${roundLabel(round.point)} round`}>
      <h3 className="text-base font-semibold text-gray-900">{roundLabel(round.point)} round</h3>
      {round.invites.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">No links in this round.</p>
      ) : (
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-xs text-gray-500">
            <tr>
              <th className="py-1 pr-3 font-medium">Assessor</th>
              <th className="py-1 pr-3 font-medium">Profession</th>
              <th className="py-1 pr-3 font-medium">Created</th>
              <th className="py-1 pr-3 font-medium">Status</th>
              <th className="py-1 font-medium" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {round.invites.map((invite) => (
              <tr key={invite.id} className="border-t border-gray-100 align-middle">
                <td className="py-1 pr-3" dir="auto">
                  {invite.assessorName}
                </td>
                <td className="py-1 pr-3">{invite.assessorRole}</td>
                <td className="py-1 pr-3 whitespace-nowrap">{invite.createdOn}</td>
                <td className="py-1 pr-3">
                  {MSF_STATUS_LABELS[invite.status]}
                  {invite.status === 'OPEN' && <span className="text-xs text-gray-500"> · until {invite.expiresOn}</span>}
                </td>
                <td className="py-1">{invite.status === 'OPEN' && <RevokeInviteButton inviteId={invite.id} assessorName={invite.assessorName} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-4">
        <MsfAggregateView aggregate={round.aggregate} />
      </div>
    </section>
  )
}
