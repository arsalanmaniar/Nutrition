import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { EvaluationFormEditor } from '@/features/nutrition/components/forms/EvaluationFormEditor'
import { EvaluationFormView } from '@/features/nutrition/components/forms/EvaluationFormView'
import { pointLabel } from '@/features/nutrition/components/forms/labels'
import { StatusBadge } from '@/features/nutrition/components/logbook/StatusBadge'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { FORM_1_3_CONFIDENTIAL_NOTICE } from '@/features/nutrition/config/evaluation-forms'
import { EVALUATION_FORMS } from '@/features/nutrition/config/forms'
import { getMyFormOneThree } from '@/features/nutrition/server/queries/evaluation-forms'

// The trainee's own Form 1.3 at one checkpoint (M04, M08 or M12), under
// Forms: same roles as that page. Found only by recomputing the trainee's own
// authorHash; the URL carries the checkpoint, never the row's id. Nobody else
// has a page or a loader for an individual Form 1.3.
const FORMS_HREF = '/nutrition/trainee/forms'

export default async function FormOneThreePage({ params }: { params: Promise<{ point: string }> }) {
  await requireNutritionRole(pageRoles(FORMS_HREF))
  const { point } = await params
  const found = await getMyFormOneThree(point)
  if (found.status === 'none') notFound()

  return (
    <section className="max-w-3xl space-y-6">
      <div>
        <Link href={FORMS_HREF} className="text-sm font-medium text-red-600 hover:text-red-700">
          ← Forms
        </Link>
        <h1 className="mt-2 flex flex-wrap items-center gap-3 text-2xl font-bold text-gray-900">
          {EVALUATION_FORMS.FORM_1_3.title}
          {found.status === 'found' && <StatusBadge status={found.form.status} />}
        </h1>
        {found.status === 'found' && (
          <p className="mt-1 text-sm text-gray-600">
            {pointLabel(found.form.assessmentPoint)}
            {found.form.preceptorName && (
              <>
                {' '}
                · about <span dir="auto">{found.form.preceptorName}</span>
              </>
            )}
          </p>
        )}
      </div>

      {found.status === 'unavailable' ? (
        <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Form 1.3 is not available right now.
        </p>
      ) : found.form.editable ? (
        <EvaluationFormEditor formType="FORM_1_3" formId={found.form.id} kind="form13" answers={found.form.answers} />
      ) : (
        <>
          <p role="note" className="rounded-lg border border-blue-300 bg-blue-50 p-3 text-sm font-medium text-blue-900">
            {FORM_1_3_CONFIDENTIAL_NOTICE}
          </p>
          <EvaluationFormView formType="FORM_1_3" answers={found.form.answers} totalScore={found.form.totalScore} maxScore={found.form.maxScore} />
        </>
      )}
    </section>
  )
}
