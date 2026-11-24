import Link from 'next/link'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { CARD } from '@/features/nutrition/components/admin/styles'
import { CaseLogForm } from '@/features/nutrition/components/logbook/CaseLogForm'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { CASE_FORM_TYPES, CASE_LOG_FORMS } from '@/features/nutrition/config/case-log-forms'
import { listLogbookRotations } from '@/features/nutrition/server/queries/case-logs'

// A new case log, under Case log: same roles as that page. Without a valid
// ?form=A|B|C|D it shows the four forms to choose from.
const LOGBOOK_HREF = '/nutrition/trainee/logbook'

export default async function NewCaseLogPage({ searchParams }: { searchParams: Promise<{ form?: string | string[] }> }) {
  await requireNutritionRole(pageRoles(LOGBOOK_HREF))
  const { form } = await searchParams
  const formType = CASE_FORM_TYPES.find((type) => type === form)
  const rotations = formType ? await listLogbookRotations() : []

  return (
    <section className="max-w-3xl space-y-6">
      <div>
        <Link href={LOGBOOK_HREF} className="text-sm font-medium text-red-600 hover:text-red-700">
          ← Case log
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">
          {formType ? `New case log: ${CASE_LOG_FORMS[formType].title}` : 'New case log'}
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          {formType
            ? 'It is saved as a draft and gets its case code when you save it. You can submit it from its own page.'
            : 'Choose the form for this case.'}
        </p>
      </div>
      {formType ? <CaseLogForm formType={formType} rotations={rotations} /> : <FormChooser />}
    </section>
  )
}

function FormChooser() {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {CASE_FORM_TYPES.map((type) => (
        <li key={type}>
          <Link href={`${LOGBOOK_HREF}/new?form=${type}`} className={`${CARD} block transition-colors hover:border-red-300`}>
            <span className="font-semibold text-gray-900">{CASE_LOG_FORMS[type].title}</span>
            {CASE_LOG_FORMS[type].placeholder && (
              <span className="mt-1 block text-xs text-amber-700">Draft form: some fields may change.</span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  )
}
