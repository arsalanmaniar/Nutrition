import type { WpbaType } from '@prisma/client'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { PageHeader } from '@/features/nutrition/components/admin/PageHeader'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { WpbaForm } from '@/features/nutrition/components/wpba/WpbaForm'
import { FiledResult, WpbaList, WpbaPicker } from '@/features/nutrition/components/wpba/WpbaViews'
import { WPBA_FORMS } from '@/features/nutrition/config/forms'
import { karachiDay } from '@/features/nutrition/lib/assessment-point'
import { listMyAssessments } from '@/features/nutrition/server/queries/wpba'
import { getMyLatestAssessment, listAssessableTrainees, listCbdCaseLogs } from '@/features/nutrition/server/queries/wpba-picker'

const HREF = '/nutrition/preceptor/wpba'

const TYPES = Object.keys(WPBA_FORMS) as WpbaType[]
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

// The assessor's WPBAs: "New assessment" (pick a trainee and a type, then fill
// in that type's form) and the list of the WPBAs they filed. The picker is a
// plain GET form, so the server renders the chosen form from the URL; a trainee
// not in the caller's assessable list gets no form. Every rule is enforced
// again by the server action on submit.
export default async function PreceptorWpbaPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await requireNutritionRole(pageRoles(HREF))
  const params = await searchParams
  const [trainees, mine] = await Promise.all([listAssessableTrainees(), listMyAssessments()])
  const filed = first(params.filed) === 'latest'
  const latest = filed ? await getMyLatestAssessment() : null
  const trainee = trainees.find((t) => t.traineeId === first(params.trainee)) ?? null
  const type = TYPES.find((t) => t === first(params.type)) ?? null
  const caseLogs = trainee && type === 'CBD' ? await listCbdCaseLogs(trainee.traineeId) : []

  return (
    <section className="max-w-3xl space-y-6">
      <PageHeader
        href={HREF}
        description="Mini-CEX, DOPS, CbD and OSCE for the trainees you are primary preceptor of, or supervise on a placement today. Scores and the OSCE result are calculated automatically. A WPBA is final once submitted."
      />

      <section aria-labelledby="new-title" className="space-y-3">
        <h2 id="new-title" className="text-lg font-semibold text-gray-900">
          New assessment
        </h2>
        {filed ? (
          <FiledResult filed={latest} href={HREF} />
        ) : (
          <>
            <WpbaPicker href={HREF} trainees={trainees} traineeId={trainee?.traineeId ?? null} type={type} />
            {trainee && type && (
              <>
                <h3 className="text-base font-semibold text-gray-900">
                  {WPBA_FORMS[type].title} for <span dir="auto">{trainee.traineeName}</span>
                </h3>
                <WpbaForm key={`${trainee.traineeId}-${type}`} type={type} trainee={trainee} caseLogs={caseLogs} today={karachiDay(new Date())} />
              </>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="mine-title" className="space-y-3">
        <h2 id="mine-title" className="text-lg font-semibold text-gray-900">
          Your assessments
        </h2>
        <WpbaList
          rows={mine.map((row) => ({ ...row, person: row.traineeName }))}
          personLabel="Trainee"
          empty="You have not filed any assessment yet."
        />
      </section>
    </section>
  )
}
