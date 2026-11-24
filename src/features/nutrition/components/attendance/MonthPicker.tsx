import Link from 'next/link'
import { CARD, INPUT, SECONDARY_BUTTON } from '../admin/styles'
import { monthLabel, shiftMonth } from './attendance-display'

/**
 * Chooses the month a page shows (Step 8 UI): a plain GET form plus previous
 * and next links, so it works without JavaScript. `keep` carries other query
 * parameters (e.g. the chosen trainee). The loaders validate the month.
 */
export function MonthPicker({ href, month, keep = {} }: { href: string; month: string; keep?: Record<string, string> }) {
  const link = (target: string | null) => (target ? `${href}?${new URLSearchParams({ ...keep, month: target })}` : null)
  const previous = link(shiftMonth(month, -1))
  const next = link(shiftMonth(month, 1))
  return (
    <form method="get" action={href} className={`${CARD} flex flex-col gap-3 sm:flex-row sm:items-end`}>
      {Object.entries(keep).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <label className="block flex-1 text-sm">
        <span className="mb-1 block text-xs font-medium text-gray-600">Month</span>
        <input type="month" name="month" required defaultValue={month} className={INPUT} />
      </label>
      <button type="submit" className={SECONDARY_BUTTON}>
        Show {monthLabel(month)}
      </button>
      <nav aria-label="Other months" className="flex gap-3 text-sm">
        {previous && (
          <Link href={previous} className="text-red-700 underline">
            ← Previous
          </Link>
        )}
        {next && (
          <Link href={next} className="text-red-700 underline">
            Next →
          </Link>
        )}
      </nav>
    </form>
  )
}
