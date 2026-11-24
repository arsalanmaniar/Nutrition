'use client'

import { useId, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useChartAnimation } from '@/lib/chart-animation'
import {
  EARLY_COLOUR,
  EXTRA_COLOUR,
  GROUP_HIDDEN_TEXT,
  HOURS_COLOUR,
  LATE_COLOUR,
  RANGE_KEYS,
  RANGE_LABELS,
  hoursText,
  lateExtraRowText,
  minutesHoursText,
  minutesText,
  rangeRowText,
  type ChartRanges,
  type LateExtraChartRanges,
  type LateExtraRow,
  type RangeKey,
  type RangeRow,
} from './attendance-hours-display'

// The charts of the attendance pages, each with the same range selector:
// Daily (each day of the chosen month), Weekly (Monday-to-Sunday weeks
// touching it) or Monthly (the 6 months ending with it).
//  - AttendanceRangeChart: late and early-leave minutes as grouped bars, hours
//    worked per day as a line on its own axis.
//  - LateExtraChart: late and extra-time minutes as separate bars; the
//    tooltip gives minutes and hours (h mm).
// Nothing is computed here: the server pages pass in the rows the loaders
// built. A screen-reader list carries the same figures.

/** The Daily / Weekly / Monthly buttons. */
function RangeButtons({ range, onChange, controls }: { range: RangeKey; onChange: (key: RangeKey) => void; controls: string }) {
  return (
    <div role="group" aria-label="Range" className="inline-flex overflow-hidden rounded-lg border border-gray-300">
      {RANGE_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          aria-pressed={range === key}
          aria-controls={controls}
          onClick={() => onChange(key)}
          className={`px-3 py-1.5 text-sm font-medium ${range === key ? 'bg-red-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
        >
          {RANGE_LABELS[key]}
        </button>
      ))}
    </div>
  )
}

/** The late / early / hours chart with Daily, Weekly and Monthly buttons. */
export function AttendanceRangeChart({ ranges, label, note }: { ranges: ChartRanges; label: string; note: string }) {
  const animation = useChartAnimation()
  const [range, setRange] = useState<RangeKey>('DAILY')
  const id = useId()
  const rows = ranges[range]
  const byKey = new Map<string, RangeRow>(rows.map((row) => [row.key, row]))

  return (
    <figure className="space-y-3">
      <RangeButtons range={range} onChange={setRange} controls={`${id}-list`} />
      <div className="h-64 w-full" aria-hidden="true">
        <ResponsiveContainer>
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="key" tickFormatter={(key: string) => byKey.get(key)?.label ?? key} fontSize={10} interval="preserveStartEnd" />
            <YAxis yAxisId="min" allowDecimals={false} fontSize={11} unit=" min" width={64} />
            <YAxis yAxisId="h" orientation="right" domain={[0, 'auto']} fontSize={11} unit=" h" width={44} />
            <Tooltip
              labelFormatter={(key) => byKey.get(String(key))?.full ?? String(key)}
              formatter={(value, name, item) => {
                if ((item.payload as RangeRow).hidden) return [GROUP_HIDDEN_TEXT, name]
                if (typeof value !== 'number') return ['–', name]
                return [name === 'Hours per day' ? hoursText(value) : minutesText(value), name]
              }}
            />
            <Legend />
            <Bar yAxisId="min" dataKey="late" name="Late" fill={LATE_COLOUR} {...animation.bar(0)} />
            <Bar yAxisId="min" dataKey="early" name="Left early" fill={EARLY_COLOUR} {...animation.bar(1)} />
            <Line yAxisId="h" type="monotone" dataKey="hours" name="Hours per day" stroke={HOURS_COLOUR} connectNulls={false} {...animation.line(HOURS_COLOUR)} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="text-xs text-gray-500">
        {note}
        <ul id={`${id}-list`} className="sr-only" aria-label={`${label}, ${RANGE_LABELS[range].toLowerCase()}`}>
          {rows.map((row) => (
            <li key={row.key}>{rangeRowText(row)}</li>
          ))}
        </ul>
      </figcaption>
    </figure>
  )
}

/** The late / extra-time bar chart with Daily, Weekly and Monthly buttons. */
export function LateExtraChart({ ranges, label, note }: { ranges: LateExtraChartRanges; label: string; note: string }) {
  const animation = useChartAnimation()
  const [range, setRange] = useState<RangeKey>('DAILY')
  const id = useId()
  const rows = ranges[range]
  const byKey = new Map<string, LateExtraRow>(rows.map((row) => [row.key, row]))

  return (
    <figure className="space-y-3">
      <RangeButtons range={range} onChange={setRange} controls={`${id}-list`} />
      <div className="h-64 w-full" aria-hidden="true">
        <ResponsiveContainer>
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="key" tickFormatter={(key: string) => byKey.get(key)?.label ?? key} fontSize={10} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} fontSize={11} unit=" min" width={64} />
            <Tooltip
              labelFormatter={(key) => byKey.get(String(key))?.full ?? String(key)}
              formatter={(value, name, item) => {
                const row = item.payload as LateExtraRow
                if (item.dataKey === 'late' ? row.lateHidden : row.extraHidden) return [GROUP_HIDDEN_TEXT, name]
                if (typeof value !== 'number') return ['–', name]
                return [minutesHoursText(value), name]
              }}
            />
            <Legend />
            <Bar dataKey="late" name="Late" fill={LATE_COLOUR} {...animation.bar(0)} />
            <Bar dataKey="extra" name="Extra time" fill={EXTRA_COLOUR} {...animation.bar(1)} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="text-xs text-gray-500">
        {note}
        <ul id={`${id}-list`} className="sr-only" aria-label={`${label}, ${RANGE_LABELS[range].toLowerCase()}`}>
          {rows.map((row) => (
            <li key={row.key}>{lateExtraRowText(row)}</li>
          ))}
        </ul>
      </figcaption>
    </figure>
  )
}
