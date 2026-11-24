import type { DueStatus } from '@/features/nutrition/lib/scheduler'
import { parseAssessmentPoint } from '@/features/nutrition/lib/assessment-point'

// Words for the evaluation-form pages. A plain module: server and client code alike.

/** "W07" -> "Week 7", "M04" -> "Month 4". */
export function pointLabel(point: string): string {
  const period = parseAssessmentPoint(point)
  if (!period) return point
  return `${period.kind === 'WEEK' ? 'Week' : 'Month'} ${period.number}`
}

export const DUE_STATUS: Readonly<Record<DueStatus, { label: string; className: string }>> = {
  NOT_STARTED: { label: 'Not started', className: 'bg-gray-100 text-gray-700' },
  DRAFT: { label: 'Draft', className: 'bg-amber-100 text-amber-800' },
  SUBMITTED: { label: 'Submitted', className: 'bg-green-100 text-green-700' },
}
