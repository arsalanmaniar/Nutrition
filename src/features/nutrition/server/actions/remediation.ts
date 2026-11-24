'use server'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { karachiDay } from '@/features/nutrition/lib/assessment-point'
import { fail, ok, type ActionResult } from '@/features/nutrition/lib/action-result'
import {
  activitySchema,
  closePlanSchema,
  createPlanSchema,
  flagDeficiencySchema,
  linkWpbaSchema,
  outcomeSchema,
  scheduleSchema,
} from '@/features/nutrition/validation/remediation'
import { ActionFailure, formFields, invalid } from '../action-helpers'
import { writeAudit } from '../audit'
import { ownPreceptorId } from '../own-preceptor'
import { lockPrimaryTrainee } from '../primary-trainee'
import { latestEpaLevel, planAuditSnapshot, stepAuditSnapshot } from '../remediation-core'

// Server actions for the 4-step remediation module (Step 6c):
//  (1) flag a deficiency or unmet milestone: createRemediationPlan opens a
//      plan with its first step, flagDeficiency adds a step to the open plan;
//  (2) setRemediationActivity: the targeted learning activity (free text);
//  (3) scheduleReassessment, then linkReassessmentWpba once that WPBA is filed;
//  (4) setRemediationOutcome: MET, NOT_MET or IN_PROGRESS; closeRemediationPlan.
// Each starts with requireNutritionRole(['PRECEPTOR'])
// (portal-guard-coverage.test.ts checks it). Only the trainee's ACTIVE
// primary preceptor, under the trainee row lock (server/primary-trainee.ts);
// anyone else gets the same "not found".
//
// A step names an EPA optionally. Its epaBefore is the trainee's newest level
// for that EPA when the step is flagged, and its epaAfter the newest level
// when an outcome of MET or NOT_MET is set. Remediation NEVER writes an EPA
// row: the preceptor records a new level with the EPA action (Step 6a).
//
// The reassessment WPBA must be one of the same trainee's, filed after the
// step was created. A trainee has at most one open plan; a closed plan can
// no longer be changed. Audit rows (actorId = the caller's Supabase user id)
// carry ids, dates and controlled values, never the deficiency or activity text.

const TRAINEE_NOT_FOUND = 'This trainee was not found among your trainees.'
const PLAN_NOT_FOUND = 'This remediation plan was not found.'
const STEP_NOT_FOUND = 'This remediation step was not found.'
const PLAN_CLOSED = 'This remediation plan is closed and can no longer be changed.'
const WPBA_NOT_FOUND = "This WPBA was not found among the trainee's assessments filed after the step was created."

const PLAN_FIELDS = { id: true, traineeId: true, closedAt: true } as const
const STEP_FIELDS = {
  id: true,
  planId: true,
  position: true,
  activity: true,
  reassessmentDate: true,
  linkedWpbaId: true,
  outcome: true,
  epaName: true,
  epaBefore: true,
  epaAfter: true,
  createdAt: true,
} as const

type Tx = Prisma.TransactionClient

async function run(work: () => Promise<void>, message: string): Promise<ActionResult> {
  try {
    await work()
  } catch (error) {
    if (error instanceof ActionFailure) return fail(error.message, error.fieldErrors)
    throw error
  }
  return ok(message)
}

/** The plan, locked through its trainee, for its active primary preceptor only; refused once closed. */
async function openPlanFor(tx: Tx, preceptorId: string, planId: string) {
  const found = await tx.nutritionRemediationPlan.findUnique({ where: { id: planId }, select: { traineeId: true } })
  if (!found || !(await lockPrimaryTrainee(tx, preceptorId, found.traineeId))) throw new ActionFailure(PLAN_NOT_FOUND)
  const plan = await tx.nutritionRemediationPlan.findUnique({ where: { id: planId }, select: PLAN_FIELDS })
  if (!plan) throw new ActionFailure(PLAN_NOT_FOUND)
  if (plan.closedAt) throw new ActionFailure(PLAN_CLOSED)
  return plan
}

/** The step and its open plan, locked through the trainee, for the plan's active primary preceptor only. */
async function openStepFor(tx: Tx, preceptorId: string, stepId: string) {
  const found = await tx.nutritionRemediationStep.findUnique({ where: { id: stepId }, select: { planId: true } })
  if (!found) throw new ActionFailure(STEP_NOT_FOUND)
  const plan = await openPlanFor(tx, preceptorId, found.planId).catch((error: unknown) => {
    throw error instanceof ActionFailure && error.message === PLAN_NOT_FOUND ? new ActionFailure(STEP_NOT_FOUND) : error
  })
  const step = await tx.nutritionRemediationStep.findUnique({ where: { id: stepId }, select: STEP_FIELDS })
  if (!step) throw new ActionFailure(STEP_NOT_FOUND)
  return { plan, step }
}

async function addStep(tx: Tx, actorId: string, plan: { id: string; traineeId: string }, deficiency: string, epaKey: string | null) {
  const steps = await tx.nutritionRemediationStep.findMany({ where: { planId: plan.id }, select: { position: true } })
  const position = steps.reduce((max, step) => Math.max(max, step.position), 0) + 1
  const step = await tx.nutritionRemediationStep.create({
    data: {
      planId: plan.id,
      position,
      deficiency,
      outcome: 'IN_PROGRESS',
      epaName: epaKey,
      epaBefore: epaKey ? await latestEpaLevel(tx, plan.traineeId, epaKey) : null,
      createdBy: actorId,
    },
    select: STEP_FIELDS,
  })
  await writeAudit(tx, { entity: 'NutritionRemediationStep', entityId: step.id, action: 'create', actorId, before: null, after: stepAuditSnapshot(step) })
}

async function changeStep(tx: Tx, actorId: string, before: Parameters<typeof stepAuditSnapshot>[0], data: Prisma.NutritionRemediationStepUncheckedUpdateInput, action: string) {
  const after = await tx.nutritionRemediationStep.update({ where: { id: before.id }, data, select: STEP_FIELDS })
  await writeAudit(tx, {
    entity: 'NutritionRemediationStep',
    entityId: after.id,
    action,
    actorId,
    before: stepAuditSnapshot(before),
    after: stepAuditSnapshot(after),
  })
}

/** Step 1: opens a remediation plan for a trainee with its first deficiency. */
export async function createRemediationPlan(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const preceptorId = ownPreceptorId(access)
  const parsed = createPlanSchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)
  const input = parsed.data
  return run(
    () =>
      prisma.$transaction(async (tx) => {
        const trainee = await lockPrimaryTrainee(tx, preceptorId, input.traineeId)
        if (!trainee) throw new ActionFailure(TRAINEE_NOT_FOUND)
        const open = await tx.nutritionRemediationPlan.findFirst({ where: { traineeId: trainee.id, closedAt: null }, select: { id: true } })
        if (open) throw new ActionFailure('This trainee already has an open remediation plan. Add the deficiency to it instead.')
        const plan = await tx.nutritionRemediationPlan.create({ data: { traineeId: trainee.id, createdBy: access.userId }, select: PLAN_FIELDS })
        await writeAudit(tx, { entity: 'NutritionRemediationPlan', entityId: plan.id, action: 'create', actorId: access.userId, before: null, after: planAuditSnapshot(plan, 1) })
        await addStep(tx, access.userId, plan, input.deficiency, input.epaKey)
      }),
    'Remediation plan opened.',
  )
}

/** Step 1: adds another deficiency to the trainee's open plan. */
export async function flagDeficiency(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const preceptorId = ownPreceptorId(access)
  const parsed = flagDeficiencySchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)
  const input = parsed.data
  return run(
    () =>
      prisma.$transaction(async (tx) => {
        const plan = await openPlanFor(tx, preceptorId, input.planId)
        await addStep(tx, access.userId, plan, input.deficiency, input.epaKey)
      }),
    'Deficiency added to the plan.',
  )
}

/** Step 2: the targeted learning activity for one step. */
export async function setRemediationActivity(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const preceptorId = ownPreceptorId(access)
  const parsed = activitySchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)
  const input = parsed.data
  return run(
    () =>
      prisma.$transaction(async (tx) => {
        const { step } = await openStepFor(tx, preceptorId, input.stepId)
        await changeStep(tx, access.userId, step, { activity: input.activity }, 'activity')
      }),
    'Learning activity saved.',
  )
}

/** Step 3: when the deficiency will be reassessed (today or later, Karachi). */
export async function scheduleReassessment(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const preceptorId = ownPreceptorId(access)
  const parsed = scheduleSchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)
  const input = parsed.data
  if (input.reassessmentDate < karachiDay(new Date())) {
    return fail('The reassessment date cannot be in the past.', { reassessmentDate: 'The reassessment date cannot be in the past.' })
  }
  return run(
    () =>
      prisma.$transaction(async (tx) => {
        const { step } = await openStepFor(tx, preceptorId, input.stepId)
        await changeStep(tx, access.userId, step, { reassessmentDate: new Date(`${input.reassessmentDate}T00:00:00Z`) }, 'schedule')
      }),
    'Reassessment scheduled.',
  )
}

/** Step 3: links the WPBA that reassessed the deficiency: the same trainee's, filed after the step was created. */
export async function linkReassessmentWpba(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const preceptorId = ownPreceptorId(access)
  const parsed = linkWpbaSchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)
  const input = parsed.data
  return run(
    () =>
      prisma.$transaction(async (tx) => {
        const { plan, step } = await openStepFor(tx, preceptorId, input.stepId)
        const wpba = await tx.nutritionWpba.findFirst({ where: { id: input.wpbaId, traineeId: plan.traineeId }, select: { id: true, createdAt: true } })
        if (!wpba || wpba.createdAt.getTime() <= step.createdAt.getTime()) throw new ActionFailure(WPBA_NOT_FOUND, { wpbaId: WPBA_NOT_FOUND })
        await changeStep(tx, access.userId, step, { linkedWpbaId: wpba.id }, 'link_wpba')
      }),
    'Reassessment WPBA linked.',
  )
}

/** Step 4: the step's outcome. MET or NOT_MET also records the EPA level after; no EPA row is written. */
export async function setRemediationOutcome(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const preceptorId = ownPreceptorId(access)
  const parsed = outcomeSchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)
  const input = parsed.data
  return run(
    () =>
      prisma.$transaction(async (tx) => {
        const { plan, step } = await openStepFor(tx, preceptorId, input.stepId)
        const done = input.outcome !== 'IN_PROGRESS'
        const epaAfter = done && step.epaName ? await latestEpaLevel(tx, plan.traineeId, step.epaName) : null
        await changeStep(tx, access.userId, step, { outcome: input.outcome, epaAfter }, 'outcome')
      }),
    'Outcome saved.',
  )
}

/** Closes the plan; it can no longer be changed. */
export async function closeRemediationPlan(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const preceptorId = ownPreceptorId(access)
  const parsed = closePlanSchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)
  return run(
    () =>
      prisma.$transaction(async (tx) => {
        const before = await openPlanFor(tx, preceptorId, parsed.data.planId)
        const steps = await tx.nutritionRemediationStep.findMany({ where: { planId: before.id }, select: { id: true } })
        const after = await tx.nutritionRemediationPlan.update({ where: { id: before.id }, data: { closedAt: new Date() }, select: PLAN_FIELDS })
        await writeAudit(tx, {
          entity: 'NutritionRemediationPlan',
          entityId: after.id,
          action: 'close',
          actorId: access.userId,
          before: planAuditSnapshot(before, steps.length),
          after: planAuditSnapshot(after, steps.length),
        })
      }),
    'Remediation plan closed.',
  )
}
