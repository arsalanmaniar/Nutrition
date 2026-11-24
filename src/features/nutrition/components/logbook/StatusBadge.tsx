import type { SubmissionStatus } from '@prisma/client'

// A case log's workflow status, as the trainee sees it. No directive: usable
// from server and client components alike.

const STATUS: Readonly<Record<SubmissionStatus, { label: string; className: string }>> = {
  DRAFT: { label: 'Draft', className: 'bg-gray-100 text-gray-700' },
  SUBMITTED: { label: 'Submitted', className: 'bg-blue-100 text-blue-700' },
  APPROVED: { label: 'Approved', className: 'bg-green-100 text-green-700' },
  REJECTED: { label: 'Rejected', className: 'bg-amber-100 text-amber-800' },
}

export function StatusBadge({ status }: { status: SubmissionStatus }) {
  const { label, className } = STATUS[status]
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${className}`}>{label}</span>
}
