'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useChartAnimation } from '@/lib/chart-animation'
import { issueCompletionCredential } from '@/features/nutrition/server/actions/credentials'
import type { EpaTimelinePoint } from '@/features/nutrition/server/portfolio-core'
import { FormMessage, fieldError, useServerForm } from '../admin/form-ui'
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../admin/styles'
import { epaChartRows } from './portfolio-display'

// The Step 7 client pieces: charts over aggregate or own values, the print
// and download buttons, and the preceptor's sign-off form. No data is
// fetched here; the server pages pass it in.

const COLOURS = ['#dc2626', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2']

/** The trainee's own EPA levels over time, one line per EPA (1 = E1 … 5 = E5). */
export function EpaLevelChart({ points }: { points: readonly EpaTimelinePoint[] }) {
  const animation = useChartAnimation()
  const { rows, epas } = epaChartRows(points)
  if (rows.length === 0) return <p className="text-sm text-gray-500">No EPA level recorded yet.</p>
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="assessedOn" fontSize={12} />
          <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tickFormatter={(value: number) => `E${value}`} fontSize={12} />
          <Tooltip formatter={(value) => `E${value}`} />
          <Legend />
          {epas.map((epa, i) => (
            <Line key={epa.key} type="stepAfter" dataKey={epa.key} name={epa.label} stroke={COLOURS[i % COLOURS.length]} connectNulls {...animation.line(COLOURS[i % COLOURS.length])} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Program WPBA average percentage per type; types the server hid are left out. */
export function WpbaPercentChart({ bars }: { bars: readonly { title: string; percent: number }[] }) {
  const animation = useChartAnimation()
  if (bars.length === 0) return <p className="text-sm text-gray-500">Not enough data for any WPBA type yet.</p>
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart data={[...bars]} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="title" fontSize={12} />
          <YAxis domain={[0, 100]} unit="%" fontSize={12} />
          <Tooltip formatter={(value) => `${value}%`} />
          <Bar dataKey="percent" name="Average score" fill="#dc2626" {...animation.bar()} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Opens the browser's print dialog; hidden when printing. */
export function PrintButton({ label = 'Print' }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={`${SECONDARY_BUTTON} print:hidden`}>
      {label}
    </button>
  )
}

/** Downloads text the server already built (aggregate CSV) as a file. */
export function CsvDownloadButton({ csv, fileName }: { csv: string; fileName: string }) {
  function download() {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
    URL.revokeObjectURL(url)
  }
  return (
    <button type="button" onClick={download} className={PRIMARY_BUTTON}>
      Download CSV
    </button>
  )
}

/** The preceptor's summative sign-off: confirm, then the server checks every rule and issues the credential. */
export function IssueCertificateForm({ traineeId }: { traineeId: string }) {
  const router = useRouter()
  const [confirmed, setConfirmed] = useState(false)
  const { state, pending, onSubmit } = useServerForm(issueCompletionCredential, { onSuccess: () => router.refresh() })
  const id = useId()
  return (
    <form onSubmit={onSubmit} className="space-y-3 print:hidden">
      <input type="hidden" name="traineeId" value={traineeId} />
      <label htmlFor={`${id}-confirm`} className="flex items-start gap-2 text-sm text-gray-800">
        <input id={`${id}-confirm`} type="checkbox" name="confirm" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />
        <span>I confirm the summative sign-off: the trainee has met the program&apos;s requirements and every EPA is at E4 or E5.</span>
      </label>
      {fieldError(state, 'confirm') && <p className="text-sm text-red-700">{fieldError(state, 'confirm')}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || !confirmed} className={PRIMARY_BUTTON}>
          {pending ? 'Issuing…' : 'Issue certificate of completion'}
        </button>
        <FormMessage state={state} />
      </div>
    </form>
  )
}
