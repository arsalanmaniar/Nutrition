import { MIN_FORM_1_3_RESPONSES } from '@/features/nutrition/config/evaluation-forms'
import { EVALUATION_FORMS } from '@/features/nutrition/config/forms'
import type { CheckpointFeedback } from '@/features/nutrition/server/form-1-3'
import { CARD } from '../admin/styles'
import { pointLabel } from './labels'

const FORM_1_3 = EVALUATION_FORMS.FORM_1_3
const ITEM_LABELS = new Map(FORM_1_3.sections.flatMap((section) => section.items.map((item) => [item.key, item.label] as const)))
const SECTION_TITLES = new Map(FORM_1_3.sections.map((section) => [section.key, section.title] as const))
const COMMENT_LABELS = new Map(FORM_1_3.freeText.map((field) => [field.key, field.label] as const))

/**
 * Form 1.3 results, aggregates only: per checkpoint, the averages and the
 * comments (shuffled), once at least MIN_FORM_1_3_RESPONSES trainees have
 * responded; below that, the count alone. Nothing here can show who wrote what
 * or when: the loader never returns it.
 */
export function FeedbackAggregates({ checkpoints }: { checkpoints: CheckpointFeedback[] }) {
  return (
    <div className="space-y-4">
      {checkpoints.map(({ assessmentPoint, result }) => (
        <section key={assessmentPoint} className={CARD} aria-label={pointLabel(assessmentPoint)}>
          <h3 className="flex flex-wrap items-baseline justify-between gap-2 font-semibold text-gray-900">
            {pointLabel(assessmentPoint)}
            <span className="text-sm font-normal text-gray-600">
              {result.count} {result.count === 1 ? 'response' : 'responses'}
            </span>
          </h3>
          {result.hidden ? (
            <p className="mt-2 text-sm text-gray-500">
              Results are shown once at least {MIN_FORM_1_3_RESPONSES} trainees have responded, so no one&apos;s answers can be told apart.
            </p>
          ) : (
            <div className="mt-3 space-y-4">
              <p className="text-sm text-gray-800">
                Average total{' '}
                <span className="text-xl font-bold text-gray-900">
                  {result.total.average} / {result.total.maxScore}
                </span>
              </p>
              <dl className="divide-y divide-gray-100">
                {result.sections.map((section) => (
                  <div key={section.key} className="flex justify-between gap-4 py-1.5 text-sm">
                    <dt className="text-gray-700">{SECTION_TITLES.get(section.key) ?? section.key}</dt>
                    <dd className="font-medium text-gray-900">
                      {section.average} / {section.maxScore}
                    </dd>
                  </div>
                ))}
              </dl>
              <details>
                <summary className="cursor-pointer text-sm font-medium text-red-600">Item averages (Always 3 … Never 0)</summary>
                <dl className="mt-2 divide-y divide-gray-100">
                  {result.items.map((item) => (
                    <div key={item.key} className="flex justify-between gap-4 py-1.5 text-sm">
                      <dt className="text-gray-700">{ITEM_LABELS.get(item.key) ?? item.key}</dt>
                      <dd className="font-medium text-gray-900">{item.average}</dd>
                    </div>
                  ))}
                </dl>
              </details>
              {Object.entries(result.comments).map(([key, comments]) => (
                <div key={key}>
                  <p className="text-sm font-medium text-gray-800">{COMMENT_LABELS.get(key) ?? key}</p>
                  {comments.length === 0 ? (
                    <p className="text-sm text-gray-400">No comments.</p>
                  ) : (
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-gray-700">
                      {comments.map((comment, i) => (
                        <li key={i} dir="auto" className="whitespace-pre-wrap break-words">
                          {comment}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}
