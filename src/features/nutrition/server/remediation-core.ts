import 'server-only'
import type { EpaLevel, Prisma } from '@prisma/client'
import type { Snapshot } from './audit'

// Remediation rules shared by its actions and loaders (Step 6c). Nothing here
// checks roles: every caller has already run requireNutritionRole.

const iso = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null)

/** The trainee's newest EPA level for one EPA, or null. Read only; remediation never writes an EPA row. */
export async function latestEpaLevel(db: Prisma.TransactionClient, traineeId: string, epaName: string): Promise<EpaLevel | null> {
  const row = await db.nutritionEpaAssessment.findFirst({
    where: { traineeId, epaName },
    orderBy: [{ assessedOn: 'desc' }, { createdAt: 'desc' }],
    select: { level: true },
  })
  return row?.level ?? null
}

/** The audit snapshot of a plan: ids, whether it is closed, and its step count. */
export function planAuditSnapshot(plan: { id: string; traineeId: string; closedAt: Date | null }, stepCount: number): Snapshot {
  return { id: plan.id, traineeId: plan.traineeId, closed: plan.closedAt !== null, steps: stepCount }
}

/** The audit snapshot of a step: ids, dates and controlled values. Never the deficiency or activity text. */
export function stepAuditSnapshot(step: {
  id: string
  planId: string
  position: number
  activity: string | null
  reassessmentDate: Date | null
  linkedWpbaId: string | null
  outcome: string | null
  epaName: string | null
  epaBefore: EpaLevel | null
  epaAfter: EpaLevel | null
}): Snapshot {
  return {
    id: step.id,
    planId: step.planId,
    position: step.position,
    hasActivity: step.activity !== null,
    reassessmentDate: iso(step.reassessmentDate),
    linkedWpbaId: step.linkedWpbaId,
    outcome: step.outcome,
    epaName: step.epaName,
    epaBefore: step.epaBefore,
    epaAfter: step.epaAfter,
  }
}
