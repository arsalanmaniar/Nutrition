import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { PageHeader } from '@/features/nutrition/components/admin/PageHeader'
import { TraineePicker } from '@/features/nutrition/components/epa/EpaViews'
import { currentRoundText, remainingInvites } from '@/features/nutrition/components/msf/msf-display'
import { MsfInviteForm } from '@/features/nutrition/components/msf/MsfInviteForms'
import { MsfRoundCard } from '@/features/nutrition/components/msf/MsfViews'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { listMyTraineesMsf } from '@/features/nutrition/server/queries/msf'

const HREF = '/nutrition/preceptor/msf'

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

// 360° feedback (MSF) for the trainees the caller is ACTIVE primary preceptor
// of (Step 6c UI): pick a trainee, create single-use links for up to 5
// assessors in the current round (training month 4, 8 or 12, decided by the
// server), revoke open links, and see each round's domain averages once it has
// 3 responses. Individual answers and comments are never shown.
export default async function PreceptorMsfPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await requireNutritionRole(pageRoles(HREF))
  const params = await searchParams
  const views = await listMyTraineesMsf()
  const selected = views.find((view) => view.traineeId === first(params.trainee)) ?? null
  const current = selected?.rounds.find((round) => round.point === selected.currentRound) ?? null

  return (
    <section className="max-w-4xl space-y-6">
      <PageHeader
        href={HREF}
        description="Single-use links for nurses, physicians and allied staff, with no login. Up to 5 per round, in training months 4, 8 and 12. You see the four domain averages once a round has 3 responses; never who said what."
      />

      <TraineePicker href={HREF} trainees={views} traineeId={selected?.traineeId ?? null} empty="You are not the primary preceptor of any trainee." />

      {selected && (
        <>
          <section aria-labelledby="new-title" className="space-y-3">
            <h2 id="new-title" className="text-lg font-semibold text-gray-900">
              New link for <span dir="auto">{selected.traineeName}</span>
            </h2>
            <p className="text-sm text-gray-700">{currentRoundText(selected.currentRound)}</p>
            {current && <MsfInviteForm key={selected.traineeId} traineeId={selected.traineeId} remaining={remainingInvites(current.invites)} />}
          </section>

          <section aria-labelledby="rounds-title" className="space-y-3">
            <h2 id="rounds-title" className="text-lg font-semibold text-gray-900">
              Rounds
            </h2>
            {selected.rounds.map((round) => (
              <MsfRoundCard key={round.point} round={round} />
            ))}
          </section>
        </>
      )}
    </section>
  )
}
