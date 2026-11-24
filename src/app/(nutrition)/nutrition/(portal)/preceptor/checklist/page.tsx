import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { PageHeader } from '@/features/nutrition/components/admin/PageHeader'
import { ChecklistReadOnly } from '@/features/nutrition/components/checklist/ChecklistReadOnly'
import { StandardsChecklistForm, StartChecklistButton } from '@/features/nutrition/components/checklist/StandardsChecklistForm'
import { checklistOpensText } from '@/features/nutrition/components/epa/epa-display'
import { TraineePicker } from '@/features/nutrition/components/epa/EpaViews'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { STANDARDS_CHECKLIST } from '@/features/nutrition/config/forms'
import { karachiDay } from '@/features/nutrition/lib/assessment-point'
import { listMyTraineesEpa } from '@/features/nutrition/server/queries/epa'
import { getTraineeStandardsChecklist } from '@/features/nutrition/server/queries/standards-checklist'

const HREF = '/nutrition/preceptor/checklist'

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

// The Month 9 standards checklist (Step 6b) for the trainees the caller is
// ACTIVE primary preceptor of: pick a trainee, start the checklist once
// training month 9 has begun, rate each SOP step and SOPP domain with
// evidence, save drafts, then submit. Submitted means read-only. The loader
// returns nothing for a trainee who is not the caller's, and every action
// checks the rules again.
export default async function PreceptorChecklistPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await requireNutritionRole(pageRoles(HREF))
  const params = await searchParams
  // The caller's primary trainees, from the EPA loader (names and ids only are used here).
  const trainees = (await listMyTraineesEpa()).map(({ traineeId, traineeName }) => ({ traineeId, traineeName }))
  const traineeId = trainees.find((trainee) => trainee.traineeId === first(params.trainee))?.traineeId ?? null
  const view = traineeId ? await getTraineeStandardsChecklist(traineeId) : null
  const opensText = view ? checklistOpensText(view.opensOn, karachiDay(new Date())) : null

  return (
    <section className="max-w-4xl space-y-6">
      <PageHeader
        href={HREF}
        description={`Month ${STANDARDS_CHECKLIST.monthNumber}: the ${STANDARDS_CHECKLIST.groups.map((group) => `${group.standards.length} ${group.title}`).join(' and ')} standards, each rated Developing, Meets or Exceeds with a case log or WPBA as evidence.`}
      />

      <TraineePicker href={HREF} trainees={trainees} traineeId={traineeId} empty="You are not the primary preceptor of any trainee." />

      {traineeId && !view && <p className="text-sm text-gray-500">This trainee was not found among your trainees.</p>}

      {view && (
        <section aria-labelledby="checklist-title" className="space-y-3">
          <h2 id="checklist-title" className="text-lg font-semibold text-gray-900">
            Month {STANDARDS_CHECKLIST.monthNumber} checklist for <span dir="auto">{view.traineeName}</span>
          </h2>
          {!view.checklist &&
            (opensText ? (
              <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                {opensText}
              </p>
            ) : (
              <StartChecklistButton traineeId={view.traineeId} />
            ))}
          {view.checklist?.status === 'DRAFT' && (
            <StandardsChecklistForm
              key={view.traineeId}
              traineeId={view.traineeId}
              standards={view.checklist.standards}
              evidenceOptions={view.evidenceOptions}
            />
          )}
          {view.checklist && view.checklist.status !== 'DRAFT' && (
            <ChecklistReadOnly standards={view.checklist.standards} submittedAt={view.checklist.submittedAt} />
          )}
        </section>
      )}
    </section>
  )
}
