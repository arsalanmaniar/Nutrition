import Link from 'next/link'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { PageHeader } from '@/features/nutrition/components/admin/PageHeader'
import { EpaRecordForm } from '@/features/nutrition/components/epa/EpaRecordForm'
import { EpaStatusList, TraineePicker } from '@/features/nutrition/components/epa/EpaViews'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { EPA_LIST } from '@/features/nutrition/config/epas'
import { listMyTraineesEpa } from '@/features/nutrition/server/queries/epa'

const HREF = '/nutrition/preceptor/epa'

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

// EPA entrustment for the trainees the caller is ACTIVE primary preceptor of
// (Step 6b): pick a trainee, see each EPA's current level and history, and
// record a new level. The picker is a plain GET form; a trainee not in the
// loader's list gets nothing. The server action checks every rule again.
export default async function PreceptorEpaPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await requireNutritionRole(pageRoles(HREF))
  const params = await searchParams
  const dashboards = await listMyTraineesEpa()
  const selected = dashboards.find((dashboard) => dashboard.traineeId === first(params.trainee)) ?? null

  return (
    <section className="max-w-3xl space-y-6">
      <PageHeader
        href={HREF}
        description="Entrustment levels (E1 to E5) per EPA for the trainees you are primary preceptor of. Each Miller level allows certain EPA levels; the form only offers those. Every change is kept as history."
      />
      <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        The EPA names below are provisional and will be updated.
      </p>

      <TraineePicker href={HREF} trainees={dashboards} traineeId={selected?.traineeId ?? null} empty="You are not the primary preceptor of any trainee." />

      {selected && (
        <>
          <section aria-labelledby="record-title" className="space-y-3">
            <h2 id="record-title" className="text-lg font-semibold text-gray-900">
              Record a level for <span dir="auto">{selected.traineeName}</span>
            </h2>
            <EpaRecordForm key={selected.traineeId} traineeId={selected.traineeId} epas={EPA_LIST} />
          </section>
          <p>
            <Link href={`/nutrition/preceptor/summary/${selected.traineeId}`} className="text-sm font-medium text-red-600 hover:text-red-700">
              Month 12 performance summary and sign-off →
            </Link>
          </p>
          <section aria-labelledby="levels-title" className="space-y-3">
            <h2 id="levels-title" className="text-lg font-semibold text-gray-900">
              Current levels and history
            </h2>
            <EpaStatusList epas={selected.epas} />
          </section>
        </>
      )}
    </section>
  )
}
