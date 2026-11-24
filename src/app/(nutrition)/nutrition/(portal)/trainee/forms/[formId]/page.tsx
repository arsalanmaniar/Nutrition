import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { EvaluationFormEditor } from '@/features/nutrition/components/forms/EvaluationFormEditor'
import { EvaluationFormView } from '@/features/nutrition/components/forms/EvaluationFormView'
import { pointLabel } from '@/features/nutrition/components/forms/labels'
import { StatusBadge } from '@/features/nutrition/components/logbook/StatusBadge'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { EVALUATION_FORMS } from '@/features/nutrition/config/forms'
import { getMyEvaluationForm } from '@/features/nutrition/server/queries/evaluation-forms'

// One of the trainee's own weekly check-ins or Forms 1.1 (editable while a
// DRAFT), or a 1.2 or 3.1 their preceptor submitted about them (read only).
// Under Forms: same roles as that page. Never a Form 1.3: getMyEvaluationForm
// leaves it out, and the 1.3 has its own page under confidential/.
const FORMS_HREF = '/nutrition/trainee/forms'

export default async function TraineeFormPage({ params }: { params: Promise<{ formId: string }> }) {
  await requireNutritionRole(pageRoles(FORMS_HREF))
  const { formId } = await params
  if (!z.uuid().safeParse(formId).success) notFound()
  const form = await getMyEvaluationForm(formId)
  if (!form) notFound()

  return (
    <section className="max-w-3xl space-y-6">
      <div>
        <Link href={FORMS_HREF} className="text-sm font-medium text-red-600 hover:text-red-700">
          ← Forms
        </Link>
        <h1 className="mt-2 flex flex-wrap items-center gap-3 text-2xl font-bold text-gray-900">
          {EVALUATION_FORMS[form.formType].title}
          <StatusBadge status={form.status} />
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          {pointLabel(form.assessmentPoint)}
          {form.authorName && (
            <>
              {' '}
              · by <span dir="auto">{form.authorName}</span>
            </>
          )}
          {form.submittedOn && ` · submitted ${form.submittedOn}`}
        </p>
      </div>

      {form.reviewComment && (
        <div role="note" className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800">
          <p className="font-medium">
            Your preceptor&apos;s comment{form.reviewerName ? ` (${form.reviewerName})` : ''}
            {form.reviewedOn ? `, ${form.reviewedOn}` : ''}:
          </p>
          <p dir="auto" className="mt-1 whitespace-pre-wrap break-words">
            {form.reviewComment}
          </p>
        </div>
      )}

      {form.editable ? (
        <EvaluationFormEditor formType={form.formType} formId={form.id} kind="trainee" answers={form.answers} />
      ) : (
        <EvaluationFormView formType={form.formType} answers={form.answers} totalScore={form.totalScore} maxScore={form.maxScore} />
      )}
    </section>
  )
}
