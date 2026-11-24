import type { Metadata } from 'next'
import { MSF_DEAD_LINK_TEXT, MSF_SINGLE_USE_NOTE } from '@/features/nutrition/components/msf/msf-display'
import { PublicMsfForm } from '@/features/nutrition/components/msf/PublicMsfForm'
import { getPublicMsfForm, submitMsfResponse } from '@/features/nutrition/server/public/msf'

// The PUBLIC MSF form (Step 6c UI): /nutrition/msf/<token>, for an assessor
// with no login. Deliberately unguarded and outside (portal), so there is no
// portal layout or sidebar. It loads only from server/public
// (portal-guard-coverage.test.ts checks this). A link that is unknown, used,
// expired or revoked gets one generic message, never the reason; the page
// never names the trainee or the assessor.

export const metadata: Metadata = {
  title: 'Feedback — MyLearningSphere',
  robots: { index: false, follow: false },
}

export default async function PublicMsfPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const form = await getPublicMsfForm(token)

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">MyLearningSphere · Clinical Dietetics & Nutrition</p>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">360° feedback</h1>
      </header>

      {form ? (
        <>
          <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            {MSF_SINGLE_USE_NOTE}
          </p>
          <p className="text-sm text-gray-700">
            Rate the trainee you were asked about on each of the four areas below, from {form.scale.min} to {form.scale.max}. Your answers are combined
            with other colleagues&apos; answers; the trainee never sees who said what. This link works until {form.expiresOn}.
          </p>
          <PublicMsfForm token={token} domains={form.domains} scale={form.scale} action={submitMsfResponse} />
        </>
      ) : (
        <p role="alert" className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-800">
          {MSF_DEAD_LINK_TEXT}
        </p>
      )}
    </main>
  )
}
