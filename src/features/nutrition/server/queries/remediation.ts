import 'server-only'
import type { EpaLevel } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { epaLabel } from '@/features/nutrition/config/epas'
import { WPBA_FORMS } from '@/features/nutrition/config/forms'
import { traineeIdSchema } from '@/features/nutrition/validation/epa'
import { activePrimaryPreceptorId } from '../evaluation-forms-core'
import { ownPreceptorId } from '../own-preceptor'
import { ownTraineeId } from '../own-trainee'

// Read models for remediation (Step 6c). Each loader checks its role itself,
// with an exact role list (portal-guard-coverage.test.ts):
//  - the trainee's ACTIVE primary preceptor reads the trainee's plans and the
//    WPBAs that could be linked as a reassessment; anyone else gets null;
//  - the trainee reads their own plans, read-only.
// No other role has a remediation loader.

export interface RemediationStepView {
  id: string
  position: number
  deficiency: string
  activity: string | null
  reassessmentDate: string | null
  linkedWpba: { id: string; title: string; assessedOn: string } | null
  outcome: string | null
  epa: { key: string; label: string; before: EpaLevel | null; after: EpaLevel | null } | null
  createdAt: string
}

export interface RemediationPlanView {
  id: string
  open: boolean
  createdOn: string
  closedOn: string | null
  steps: RemediationStepView[]
}

export interface TraineeRemediation {
  traineeId: string
  traineeName: string
  plans: RemediationPlanView[]
  /** The trainee's WPBAs, newest first, for linking a reassessment (the action checks it was filed after the step). */
  wpbaOptions: { id: string; title: string; assessedOn: string; filedAt: string }[]
}

const iso = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null)

async function plansOf(traineeId: string): Promise<RemediationPlanView[]> {
  const plans = await prisma.nutritionRemediationPlan.findMany({
    where: { traineeId },
    orderBy: [{ createdAt: 'desc' }],
    select: { id: true, closedAt: true, createdAt: true },
  })
  if (plans.length === 0) return []
  const steps = await prisma.nutritionRemediationStep.findMany({
    where: { planId: { in: plans.map((plan) => plan.id) } },
    orderBy: [{ position: 'asc' }],
    select: {
      id: true,
      planId: true,
      position: true,
      deficiency: true,
      activity: true,
      reassessmentDate: true,
      outcome: true,
      epaName: true,
      epaBefore: true,
      epaAfter: true,
      createdAt: true,
      linkedWpba: { select: { id: true, type: true, assessedOn: true } },
    },
  })
  return plans.map((plan) => ({
    id: plan.id,
    open: plan.closedAt === null,
    createdOn: iso(plan.createdAt) as string,
    closedOn: iso(plan.closedAt),
    steps: steps
      .filter((step) => step.planId === plan.id)
      .map((step) => ({
        id: step.id,
        position: step.position,
        deficiency: step.deficiency,
        activity: step.activity,
        reassessmentDate: iso(step.reassessmentDate),
        linkedWpba: step.linkedWpba
          ? { id: step.linkedWpba.id, title: WPBA_FORMS[step.linkedWpba.type].title, assessedOn: iso(step.linkedWpba.assessedOn) as string }
          : null,
        outcome: step.outcome,
        epa: step.epaName ? { key: step.epaName, label: epaLabel(step.epaName), before: step.epaBefore, after: step.epaAfter } : null,
        createdAt: step.createdAt.toISOString(),
      })),
  }))
}

/** A trainee's remediation plans and linkable WPBAs, for their ACTIVE primary preceptor only; null for anyone else. */
export async function getTraineeRemediation(traineeId: string): Promise<TraineeRemediation | null> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const preceptorId = ownPreceptorId(access)
  const parsed = traineeIdSchema.safeParse({ traineeId })
  if (!parsed.success) return null
  if ((await activePrimaryPreceptorId(prisma, parsed.data.traineeId)) !== preceptorId) return null
  const trainee = await prisma.nutritionProfile.findUnique({ where: { id: parsed.data.traineeId }, select: { id: true, fullName: true, role: true, isActive: true } })
  if (trainee?.role !== 'TRAINEE' || !trainee.isActive) return null
  const [plans, wpbas] = await Promise.all([
    plansOf(trainee.id),
    prisma.nutritionWpba.findMany({
      where: { traineeId: trainee.id },
      orderBy: [{ assessedOn: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, type: true, assessedOn: true, createdAt: true },
    }),
  ])
  return {
    traineeId: trainee.id,
    traineeName: trainee.fullName,
    plans,
    wpbaOptions: wpbas.map((wpba) => ({ id: wpba.id, title: WPBA_FORMS[wpba.type].title, assessedOn: iso(wpba.assessedOn) as string, filedAt: wpba.createdAt.toISOString() })),
  }
}

/** The trainee's own remediation plans, read-only. */
export async function getMyRemediation(): Promise<RemediationPlanView[]> {
  const access = await requireNutritionRole(['TRAINEE'])
  return plansOf(ownTraineeId(access))
}
