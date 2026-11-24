import Link from 'next/link'
import type { PersonRow } from '@/features/nutrition/server/queries/people'
import { CARD } from './styles'
import { ROLE_LABELS } from './role-labels'

// Everyone with a nutrition profile, active first. Each row opens the person's
// page, where they are edited and assigned. Rendered on the server.

export function PeopleTable({ people }: { people: PersonRow[] }) {
  if (people.length === 0) {
    return (
      <section className={CARD}>
        <p className="font-medium text-gray-800">No one has been added yet.</p>
        <p className="mt-1 text-sm text-gray-500">People you add above appear here.</p>
      </section>
    )
  }

  return (
    <section className={`${CARD} !p-0 overflow-hidden`} aria-label="People">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left">
              <th scope="col" className="px-4 py-3 font-semibold text-gray-600">Name</th>
              <th scope="col" className="px-4 py-3 font-semibold text-gray-600">Role</th>
              <th scope="col" className="px-4 py-3 font-semibold text-gray-600">Supervision</th>
              <th scope="col" className="px-4 py-3 font-semibold text-gray-600">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {people.map((person) => (
              <tr key={person.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <Link
                    href={`/nutrition/admin/people/${person.id}`}
                    dir="auto"
                    className="font-semibold text-gray-800 hover:text-red-600"
                  >
                    {person.fullName}
                  </Link>
                  <p className="text-xs text-gray-500 break-all">{person.email}</p>
                  {person.institution && (
                    <p dir="auto" className="text-xs text-gray-400">
                      {person.institution}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{ROLE_LABELS[person.role]}</td>
                <td className="px-4 py-3 text-gray-600">{supervision(person)}</td>
                <td className="px-4 py-3">
                  {person.isActive ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">Active</span>
                  ) : (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">Inactive</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function supervision(person: PersonRow): string {
  if (person.role === 'TRAINEE') return person.primaryPreceptor ? `Preceptor: ${person.primaryPreceptor}` : 'No preceptor yet'
  if (person.activeTrainees > 0) return `${person.activeTrainees} trainee${person.activeTrainees === 1 ? '' : 's'}`
  return '—'
}
