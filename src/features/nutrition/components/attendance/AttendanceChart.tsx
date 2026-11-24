'use client'

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useChartAnimation } from '@/lib/chart-animation'
import type { CalendarDay } from '@/features/nutrition/server/queries/attendance'
import { CALENDAR_KIND_COLOURS, CALENDAR_KIND_LABELS, dayLabel, legendFor } from './attendance-display'

/**
 * A month as a daily strip (Step 8 UI): one equal bar per day, coloured by
 * what the server said about that day. The legend and a screen-reader list
 * carry the same information as the colours. Nothing is computed here.
 */
export function AttendanceChart({ days, label }: { days: readonly CalendarDay[]; label: string }) {
  const animation = useChartAnimation()
  const rows = days.map((d) => ({ day: d.day.slice(8), full: d.day, kind: d.kind, value: 1 }))
  const legend = legendFor(days.map((d) => d.kind))

  return (
    <figure className="space-y-3">
      <div className="h-24 w-full" aria-hidden="true">
        <ResponsiveContainer>
          <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 4, left: 4 }} barCategoryGap={1}>
            <XAxis dataKey="day" fontSize={10} interval="preserveStartEnd" tickLine={false} />
            <YAxis hide domain={[0, 1]} />
            <Tooltip
              cursor={false}
              formatter={(_value, _name, item) => [CALENDAR_KIND_LABELS[(item.payload as { kind: keyof typeof CALENDAR_KIND_LABELS }).kind], '']}
              labelFormatter={(_label, payload) => (payload?.[0] ? dayLabel((payload[0].payload as { full: string }).full) : '')}
            />
            <Bar dataKey="value" {...animation.bar()}>
              {rows.map((row) => (
                <Cell key={row.full} fill={CALENDAR_KIND_COLOURS[row.kind]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
          {legend.map((kind) => (
            <li key={kind} className="flex items-center gap-1">
              <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm border border-gray-300" style={{ backgroundColor: CALENDAR_KIND_COLOURS[kind] }} />
              {CALENDAR_KIND_LABELS[kind]}
            </li>
          ))}
        </ul>
        <ul className="sr-only" aria-label={label}>
          {days.map((d) => (
            <li key={d.day}>
              {dayLabel(d.day)}: {CALENDAR_KIND_LABELS[d.kind]}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  )
}
