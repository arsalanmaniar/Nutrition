import type { Metadata } from 'next'
import { VERIFY_NOT_FOUND_TEXT, VERIFY_REVOKED_TEXT } from '@/features/nutrition/components/portfolio/portfolio-display'
import { getCredentialVerification } from '@/features/nutrition/server/public/verify'

// The PUBLIC certificate check (Step 7): /nutrition/verify/<verification id>,
// the link on the certificate's QR code. Unguarded and outside (portal); it
// loads only from server/public/verify.ts (portal-guard-coverage.test.ts
// checks this). It shows only the holder's name, the program, the issue date
// and valid/revoked; an unknown id gets one generic message.

export const metadata: Metadata = {
  title: 'Certificate check — MyLearningSphere',
  robots: { index: false, follow: false },
}

export default async function VerifyCredentialPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await getCredentialVerification(id)

  return (
    <main className="mx-auto max-w-xl space-y-6 px-4 py-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">MyLearningSphere · Clinical Dietetics & Nutrition</p>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Certificate check</h1>
      </header>
      {!result ? (
        <p role="alert" className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-800">
          {VERIFY_NOT_FOUND_TEXT}
        </p>
      ) : (
        <dl className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 text-sm">
          <div>
            <dt className="text-xs text-gray-500">Name</dt>
            <dd className="text-base font-semibold text-gray-900" dir="auto">
              {result.name}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Program</dt>
            <dd className="text-gray-900">{result.program}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Issued on</dt>
            <dd className="text-gray-900">{result.issuedOn}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Status</dt>
            <dd className={result.status === 'VALID' ? 'font-semibold text-green-700' : 'font-semibold text-red-700'}>
              {result.status === 'VALID' ? 'Valid' : VERIFY_REVOKED_TEXT}
            </dd>
          </div>
        </dl>
      )}
    </main>
  )
}
