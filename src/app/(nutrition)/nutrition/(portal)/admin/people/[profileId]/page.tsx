import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { PreceptorTrainees, TraineeAssignments } from '@/features/nutrition/components/admin/AssignmentPanel'
import { ProfileEditForm } from '@/features/nutrition/components/admin/ProfileEditForm'
import { ROLE_LABELS } from '@/features/nutrition/components/admin/role-labels'
import { StartDateForm } from '@/features/nutrition/components/admin/StartDateForm'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { getPersonDetail } from '@/features/nutrition/server/queries/people'

// One person's page, under People & assignments: same roles as that page.
const PEOPLE_HREF = '/nutrition/admin/people'

export default async function AdminPersonPage({ params }: { params: Promise<{ profileId: string }> }) {
  await requireNutritionRole(pageRoles(PEOPLE_HREF))
  const { profileId } = await params
  if (!z.uuid().safeParse(profileId).success) notFound()
  const person = await getPersonDetail(profileId)
  if (!person) notFound()

  const isTrainee = person.role === 'TRAINEE'

  return (
    <section className="max-w-3xl space-y-6">
      <div>
        <Link href={PEOPLE_HREF} className="text-sm font-medium text-red-600 hover:text-red-700">
          ← People &amp; assignments
        </Link>
        <h1 dir="auto" className="mt-2 text-2xl font-bold text-gray-900">
          {person.fullName}
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-600">
          <span>{ROLE_LABELS[person.role]}</span>
          {!person.isActive && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">Inactive</span>
          )}
          {person.isSelf && <span className="text-gray-400">(you)</span>}
        </p>
      </div>

      <ProfileEditForm
        profile={{
          id: person.id,
          email: person.email,
          fullName: person.fullName,
          role: person.role,
          institution: person.institution,
          isActive: person.isActive,
        }}
        isSelf={person.isSelf}
      />

      {isTrainee && person.startDateUnchecked && (
        <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Form 1.3 records cannot be checked right now (the server is missing its author-hash key), so the start date is
          shown as locked.
        </p>
      )}
      {isTrainee && <StartDateForm profileId={person.id} value={person.trainingStartDate} locked={person.startDateLocked} />}

      {(isTrainee || person.preceptors.length > 0) && (
        <TraineeAssignments
          traineeId={person.id}
          traineeActive={isTrainee && person.isActive}
          assignments={person.preceptors}
          preceptorOptions={person.preceptorOptions}
        />
      )}

      {(person.role === 'PRECEPTOR' || person.trainees.length > 0) && <PreceptorTrainees assignments={person.trainees} />}
    </section>
  )
}
