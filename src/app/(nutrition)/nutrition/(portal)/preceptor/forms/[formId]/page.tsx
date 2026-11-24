import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { CARD } from '@/features/nutrition/components/admin/styles'
import { EvaluationFormEditor } from '@/features/nutrition/components/forms/EvaluationFormEditor'
import { EvaluationFormView } from '@/features/nutrition/components/forms/EvaluationFormView'
import { ReopenFormButton, WeeklyCommentForm } from '@/features/nutrition/components/forms/FormControls'
import { pointLabel } from '@/features/nutrition/components/forms/labels'
import { StatusBadge } from '@/features/nutrition/components/logbook/StatusBadge'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { EVALUATION_FORMS } from '@/features/nutrition/config/forms'
import { getTraineeEvaluationForm } from '@/features/nutrition/server/queries/evaluation-forms'

// One form about a trainee the caller is the active primary preceptor of,
// under Forms: same roles as that page. The caller's own Form 1.2 or 3.1 is
// editable while a DRAFT; a submitted form can be reopened (logged), and a
// submitted weekly check-in commented on. getTraineeEvaluationForm returns
// nothing for anything else, including any Form 1.3, so those are a 404.
const FORMS_HREF = '/nutrition/preceptor/forms'

export default async function PreceptorFormPage({ params }: { params: Promise<{ formId: string }> }) {
  await requireNutritionRole(pageRoles(FORMS_HREF))
  const { formId } = await params
  if (!z.uuid().safeParse(formId).success) notFound()
  const form = await getTraineeEvaluationForm(formId)
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
          <span dir="auto">{form.traineeName}</span> · {pointLabel(form.assessmentPoint)}
          {form.authorName && (
            <>
              {' '}
              · by <span dir="auto">{form.authorName}</span>
            </>
          )}
          {form.submittedOn && ` · submitted ${form.submittedOn}`}
        </p>
      </div>

      {form.editable ? (
        <EvaluationFormEditor formType={form.formType} formId={form.id} kind="preceptor" answers={form.answers} />
      ) : (
        <EvaluationFormView formType={form.formType} answers={form.answers} totalScore={form.totalScore} maxScore={form.maxScore} />
      )}

      {form.canComment && (
        <section className={CARD} aria-label="Comment">
          <WeeklyCommentForm formId={form.id} comment={form.reviewComment} />
        </section>
      )}

      {form.canReopen && (
        <section className={CARD} aria-label="Reopen">
          <p className="mb-3 text-sm text-gray-600">Reopening sends this form back to its author as a draft. It is logged.</p>
          <ReopenFormButton formId={form.id} />
        </section>
      )}
    </section>
  )
}
