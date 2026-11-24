import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { AddPerson } from '@/features/nutrition/components/admin/AddPerson'
import { PageHeader } from '@/features/nutrition/components/admin/PageHeader'
import { PeopleTable } from '@/features/nutrition/components/admin/PeopleTable'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { listPeople } from '@/features/nutrition/server/queries/people'
import { canCreateAccounts } from '@/features/nutrition/server/service-role'

const HREF = '/nutrition/admin/people'

export default async function AdminPeoplePage() {
  await requireNutritionRole(pageRoles(HREF))
  const people = await listPeople()

  return (
    <section className="max-w-5xl space-y-6">
      <PageHeader
        href={HREF}
        description="Who can use the nutrition portal, in which role, and which preceptor supervises each trainee. People are deactivated, never deleted."
      />
      <AddPerson canCreateAccounts={canCreateAccounts()} />
      <PeopleTable people={people} />
    </section>
  )
}
