import { headers } from 'next/headers'
import QRCode from 'qrcode'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { PageHeader } from '@/features/nutrition/components/admin/PageHeader'
import { CARD } from '@/features/nutrition/components/admin/styles'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { PrintButton } from '@/features/nutrition/components/portfolio/PortfolioClient'
import { verifyUrl } from '@/features/nutrition/components/portfolio/portfolio-display'
import { getMyCertificate } from '@/features/nutrition/server/queries/portfolio'

const HREF = '/nutrition/trainee/certificate'

// The trainee's own certificate of completion (Step 7): a printable page with
// a QR code pointing to the public /nutrition/verify/<id> page. No PDF is
// stored (NutritionCredential.pdfPath stays NULL).
export default async function TraineeCertificatePage() {
  await requireNutritionRole(pageRoles(HREF))
  const certificate = await getMyCertificate()
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  const link = certificate ? verifyUrl(`${proto}://${host}`, certificate.verificationId) : null
  const qr = link ? await QRCode.toDataURL(link, { margin: 1, width: 180 }) : null

  return (
    <section className="max-w-3xl space-y-6">
      <div className="print:hidden">
        <PageHeader href={HREF} description="Your certificate of completion, once your primary preceptor has signed off your summative assessment." />
      </div>
      {!certificate ? (
        <p className="text-sm text-gray-500">No certificate has been issued yet.</p>
      ) : (
        <>
          <div className="print:hidden">
            <PrintButton label="Print certificate" />
          </div>
          <article className={`${CARD} space-y-4 text-center`}>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">Certificate of completion</p>
            <h2 className="text-2xl font-bold text-gray-900" dir="auto">
              {certificate.traineeName}
            </h2>
            <p className="text-sm text-gray-700">has completed the {certificate.program}.</p>
            <p className="text-sm text-gray-700">Issued on {certificate.issuedOn}</p>
            {certificate.revoked && <p className="text-sm font-semibold text-red-700">This certificate has been revoked.</p>}
            {qr && link && (
              <div className="flex flex-col items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URL, not a remote image */}
                <img src={qr} alt="QR code linking to this certificate's verification page" width={180} height={180} />
                <p className="break-all font-mono text-xs text-gray-500">{link}</p>
              </div>
            )}
          </article>
        </>
      )}
    </section>
  )
}
