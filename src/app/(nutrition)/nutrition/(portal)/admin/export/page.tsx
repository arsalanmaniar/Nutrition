import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { PageHeader } from '@/features/nutrition/components/admin/PageHeader'
import { CARD } from '@/features/nutrition/components/admin/styles'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { CsvDownloadButton } from '@/features/nutrition/components/portfolio/PortfolioClient'
import { METRICS_CSV_FILE } from '@/features/nutrition/components/portfolio/portfolio-display'
import { getProgramMetricsCsv } from '@/features/nutrition/server/queries/portfolio'

const HREF = '/nutrition/admin/export'

// Export (Step 7): the program aggregates as CSV, the same numbers as the
// analytics page. No names and no ids; hidden groups say "not enough data".
// The server builds the file; the button only saves it.
export default async function AdminExportPage() {
  await requireNutritionRole(pageRoles(HREF))
  const csv = await getProgramMetricsCsv()
  const rows = csv.trim().split('\n').slice(1).map((line) => line.split(','))

  return (
    <section className="max-w-3xl space-y-6">
      <PageHeader href={HREF} description="Aggregate program metrics as a CSV file: metric, group and value. No names or ids." />
      <CsvDownloadButton csv={csv} fileName={METRICS_CSV_FILE} />
      <section className={CARD} aria-label="Preview">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-gray-500">
            <tr>
              <th className="py-1 pr-3 font-medium">Metric</th>
              <th className="py-1 pr-3 font-medium">Group</th>
              <th className="py-1 pr-3 font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-gray-100">
                {row.map((value, j) => (
                  <td key={j} className="py-1 pr-3">
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </section>
  )
}
