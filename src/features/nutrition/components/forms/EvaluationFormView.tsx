import type { EvaluationFormType } from '@prisma/client'
import { EVALUATION_FORMS } from '@/features/nutrition/config/forms'
import type { EvaluationAnswers } from '@/features/nutrition/validation/evaluation-forms'
import { CARD } from '../admin/styles'

/**
 * A submitted (or read-only) evaluation form: each item's rating with its
 * anchor, the section totals and the total the SERVER stored, and the free
 * text. No directive: a server component.
 */
export function EvaluationFormView({
  formType,
  answers,
  totalScore,
  maxScore,
}: {
  formType: EvaluationFormType
  answers: EvaluationAnswers
  totalScore: number | null
  maxScore: number | null
}) {
  const definition = EVALUATION_FORMS[formType]
  return (
    <div className="space-y-6">
      {totalScore !== null && maxScore !== null && maxScore > 0 && (
        <p className={`${CARD} text-sm text-gray-800`}>
          <span className="text-2xl font-bold text-gray-900">
            {totalScore} / {maxScore}
          </span>{' '}
          ({Math.round((totalScore * 1000) / maxScore) / 10}%)
        </p>
      )}

      {definition.sections.map((section) => {
        const rated = section.items.map((item) => answers.ratings[item.key]).filter((v): v is number => typeof v === 'number')
        return (
          <section key={section.key} className={CARD} aria-label={section.title}>
            <h2 className="flex flex-wrap items-baseline justify-between gap-2 text-base font-semibold text-gray-900">
              {section.title}
              {rated.length === section.items.length && (
                <span className="text-sm font-normal text-gray-600">
                  {rated.reduce((sum, v) => sum + v, 0)} / {section.maxScore}
                </span>
              )}
            </h2>
            <dl className="mt-3 divide-y divide-gray-100">
              {section.items.map((item) => {
                const value = answers.ratings[item.key]
                return (
                  <div key={item.key} className="flex flex-col gap-1 py-2 sm:flex-row sm:justify-between sm:gap-4">
                    <dt className="text-sm text-gray-700">{item.label}</dt>
                    <dd className="text-sm font-medium text-gray-900 sm:text-right">
                      {value === undefined ? 'Not rated' : `${value}${section.scale.anchors?.[value] ? ` · ${section.scale.anchors[value]}` : ''}`}
                    </dd>
                  </div>
                )
              })}
            </dl>
          </section>
        )
      })}

      {definition.freeText.length > 0 && (
        <section className={CARD} aria-label="Comments">
          <dl className="space-y-4">
            {definition.freeText.map((field) => (
              <div key={field.key}>
                <dt className="text-sm font-medium text-gray-800">{field.label}</dt>
                <dd dir="auto" className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-700">
                  {answers.text[field.key] || <span className="text-gray-400">—</span>}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  )
}
