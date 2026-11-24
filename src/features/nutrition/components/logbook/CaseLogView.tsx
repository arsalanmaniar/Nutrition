import { AGE_BANDS, CASE_LOG_FORMS, DIAGNOSIS_CATEGORIES, optionLabel } from '@/features/nutrition/config/case-log-forms'
import { EPA_LEVEL_LABELS } from '@/features/nutrition/config/forms'
import type { CaseLogDetail } from '@/features/nutrition/server/queries/case-logs'
import { CARD, LABEL } from '../admin/styles'

// A case log, read only: for the trainee once they can no longer change it
// (SUBMITTED or APPROVED), and for the reviewing preceptor. Rendered on the
// server.

/** What the view shows: the case details and the form's text, nothing about the trainee. */
export type CaseLogContent = Pick<
  CaseLogDetail,
  'formType' | 'rotationName' | 'ageBand' | 'diagnosisCategory' | 'epaLevel' | 'submittedOn' | 'data'
>

export function CaseLogView({ log }: { log: CaseLogContent }) {
  const definition = CASE_LOG_FORMS[log.formType]
  const known = new Set(definition.sections.flatMap((section) => section.fields.map((field) => field.key)))
  // Text kept under keys the current version of the form no longer has.
  const older = Object.keys(log.data).filter((key) => !known.has(key))

  return (
    <div className="space-y-6">
      <section className={CARD} aria-labelledby="case-details">
        <h2 id="case-details" className="text-base font-semibold text-gray-900">
          Case details
        </h2>
        <dl className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <Detail term="Form" value={definition.title} />
          <Detail term="Rotation" value={log.rotationName ?? 'Not chosen'} />
          <Detail term="Age band" value={optionLabel(AGE_BANDS, log.ageBand)} />
          <Detail term="Diagnosis category" value={optionLabel(DIAGNOSIS_CATEGORIES, log.diagnosisCategory)} />
          <Detail term="EPA level" value={log.epaLevel ? `${log.epaLevel} · ${EPA_LEVEL_LABELS[log.epaLevel]}` : 'Not chosen'} />
          <Detail term="Submitted" value={log.submittedOn ?? '—'} />
        </dl>
      </section>

      {definition.sections.map((section) => (
        <section key={section.key} className={CARD} aria-label={section.title}>
          <h2 className="text-base font-semibold text-gray-900">{section.title}</h2>
          <div className="mt-4 space-y-4">
            {section.fields.map((field) => (
              <Text key={field.key} label={field.label} value={log.data[field.key]} />
            ))}
          </div>
        </section>
      ))}

      {older.length > 0 && (
        <section className={CARD} aria-label="Fields from an earlier version of this form">
          <h2 className="text-base font-semibold text-gray-900">Fields from an earlier version of this form</h2>
          <div className="mt-4 space-y-4">
            {older.map((key) => (
              <Text key={key} label={key} value={log.data[key]} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className={LABEL}>{term}</dt>
      <dd dir="auto" className="text-gray-800">
        {value}
      </dd>
    </div>
  )
}

function Text({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div>
      <p className={LABEL}>{label}</p>
      <p dir="auto" className="whitespace-pre-wrap break-words text-sm text-gray-800">
        {value || '—'}
      </p>
    </div>
  )
}
