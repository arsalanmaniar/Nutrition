'use server'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { STANDARDS_CHECKLIST } from '@/features/nutrition/config/forms'
import { karachiDay, periodDays, storedDay } from '@/features/nutrition/lib/assessment-point'
import { fail, ok, type ActionResult } from '@/features/nutrition/lib/action-result'
import { traineeIdSchema } from '@/features/nutrition/validation/epa'
import { ActionFailure, formFields, invalid, isUniqueViolation } from '../action-helpers'
import { writeAudit } from '../audit'
import { checklistAuditSnapshot, checklistFromFields, evidenceField, evidenceIds, type ChecklistItems } from '../epa-core'
import { ownPreceptorId } from '../own-preceptor'
import { lockPrimaryTrainee } from '../primary-trainee'

// Server actions for the Month 9 standards checklist (Step 6a): SOP (4 steps)
// and SOPP (6 domains) from STANDARDS_CHECKLIST, each rated Developing /
// Meets / Exceeds with an evidence reference. Each starts with
// requireNutritionRole(['PRECEPTOR']) (portal-guard-coverage.test.ts checks
// it).
//
// Only the trainee's ACTIVE primary preceptor, under the trainee row lock
// (server/primary-trainee.ts). One checklist per trainee and month
// (nutr_standards_checklist unique traineeId + monthNumber). It opens on the
// first day of training month 9, counted from trainingStartDate (plan,
// Decisions (Step 3d outcome) item 3).
//
// Evidence is the id of one of THIS trainee's WPBAs, or of one of their case
// logs that is SUBMITTED or APPROVED (the CbD rule). It is checked inside the
// transaction on every save and on submit; anything else, another trainee's
// record included, gets the same "not found".
//
// A draft can be saved any number of times; submit needs every standard rated
// with evidence. A SUBMITTED checklist is never changed again. Audit rows
// (actorId = the caller's Supabase user id) carry ids, status and counts
// only: no rating names, no evidence ids, no text.

const TRAINEE_NOT_FOUND = 'This trainee was not found among your trainees.'
const NOT_FOUND = 'This checklist was not found. Start it first.'
const ALREADY_EXISTS = 'This checklist already exists. Reload the page to continue it.'
const ALREADY_SUBMITTED = 'This checklist has already been submitted and can no longer be changed.'
const EVIDENCE_NOT_FOUND = "This case log or WPBA was not found among the trainee's records."

const CHECKLIST_FIELDS = {
  id: true,
  traineeId: true,
  monthNumber: true,
  formVersion: true,
  status: true,
  items: true,
} as const

/** Opens the trainee's Month 9 checklist as a draft. */
export async function startStandardsChecklist(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const preceptorId = ownPreceptorId(access)
  const parsed = traineeIdSchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)
  const { traineeId } = parsed.data
  const today = karachiDay(new Date())

  try {
    await prisma.$transaction(async (tx) => {
      const trainee = await lockPrimaryTrainee(tx, preceptorId, traineeId)
      if (!trainee) throw new ActionFailure(TRAINEE_NOT_FOUND)
      if (!trainee.trainingStartDate) throw new ActionFailure("This trainee's training start date is not set yet.")
      const opensOn = periodDays(storedDay(trainee.trainingStartDate), { kind: 'MONTH', number: STANDARDS_CHECKLIST.monthNumber }).first
      if (today < opensOn) throw new ActionFailure(`The Month ${STANDARDS_CHECKLIST.monthNumber} standards checklist opens on ${opensOn}.`)

      const existing = await tx.nutritionStandardsChecklist.findFirst({
        where: { traineeId, monthNumber: STANDARDS_CHECKLIST.monthNumber },
        select: { id: true },
      })
      if (existing) throw new ActionFailure(ALREADY_EXISTS)
      const row = await tx.nutritionStandardsChecklist.create({
        data: {
          traineeId,
          monthNumber: STANDARDS_CHECKLIST.monthNumber,
          formVersion: STANDARDS_CHECKLIST.version,
          items: {},
          status: 'DRAFT',
          createdBy: access.userId,
        },
        select: CHECKLIST_FIELDS,
      })
      await writeAudit(tx, {
        entity: 'NutritionStandardsChecklist',
        entityId: row.id,
        action: 'create',
        actorId: access.userId,
        before: null,
        after: checklistAuditSnapshot(row),
      })
    })
  } catch (error) {
    if (error instanceof ActionFailure) return fail(error.message, error.fieldErrors)
    if (isUniqueViolation(error)) return fail(ALREADY_EXISTS)
    throw error
  }

  return ok('Month 9 standards checklist started.')
}

/** Saves the draft: ratings and evidence given so far. */
export async function saveStandardsChecklist(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  return writeChecklist(ownPreceptorId(access), access.userId, formFields(formData), false)
}

/** Submits the checklist: every standard rated with evidence. It can never be changed afterwards. */
export async function submitStandardsChecklist(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  return writeChecklist(ownPreceptorId(access), access.userId, formFields(formData), true)
}

async function writeChecklist(preceptorId: string, actorId: string, fields: Record<string, string>, submit: boolean): Promise<ActionResult> {
  const parsedId = traineeIdSchema.safeParse(fields)
  if (!parsedId.success) return invalid(parsedId.error)
  const { traineeId } = parsedId.data
  const parsed = checklistFromFields(fields, { requireAll: submit })
  if (!parsed.ok) return fail('Check the highlighted fields.', parsed.errors)

  try {
    await prisma.$transaction(async (tx) => {
      if (!(await lockPrimaryTrainee(tx, preceptorId, traineeId))) throw new ActionFailure(TRAINEE_NOT_FOUND)
      const before = await tx.nutritionStandardsChecklist.findFirst({
        where: { traineeId, monthNumber: STANDARDS_CHECKLIST.monthNumber },
        select: CHECKLIST_FIELDS,
      })
      if (!before) throw new ActionFailure(NOT_FOUND)
      if (before.status !== 'DRAFT') throw new ActionFailure(ALREADY_SUBMITTED)

      const problems = await evidenceProblems(tx, traineeId, parsed.items)
      if (Object.keys(problems).length > 0) throw new ActionFailure('Check the highlighted fields.', problems)

      const after = await tx.nutritionStandardsChecklist.update({
        where: { id: before.id },
        data: submit
          ? { items: storedJson(parsed.items), status: 'SUBMITTED', submittedAt: new Date() }
          : { items: storedJson(parsed.items) },
        select: CHECKLIST_FIELDS,
      })
      await writeAudit(tx, {
        entity: 'NutritionStandardsChecklist',
        entityId: after.id,
        action: submit ? 'submit' : 'update',
        actorId,
        before: checklistAuditSnapshot(before),
        after: checklistAuditSnapshot(after),
      })
    })
  } catch (error) {
    if (error instanceof ActionFailure) return fail(error.message, error.fieldErrors)
    throw error
  }

  return ok(submit ? 'Month 9 standards checklist submitted.' : 'Draft saved.')
}

/** Evidence that is not one of this trainee's WPBAs or SUBMITTED/APPROVED case logs, by form field. */
async function evidenceProblems(tx: Prisma.TransactionClient, traineeId: string, items: ChecklistItems): Promise<Record<string, string>> {
  const { caseLogIds, wpbaIds } = evidenceIds(items)
  const logs =
    caseLogIds.length > 0
      ? await tx.nutritionCaseLog.findMany({
          where: { id: { in: caseLogIds }, traineeId, status: { in: ['SUBMITTED', 'APPROVED'] } },
          select: { id: true },
        })
      : []
  const wpbas = wpbaIds.length > 0 ? await tx.nutritionWpba.findMany({ where: { id: { in: wpbaIds }, traineeId }, select: { id: true } }) : []
  const found = { CASE_LOG: new Set(logs.map((log) => log.id)), WPBA: new Set(wpbas.map((wpba) => wpba.id)) }
  const problems: Record<string, string> = {}
  for (const [key, entry] of Object.entries(items)) {
    if (entry.evidence && !found[entry.evidence.kind].has(entry.evidence.id)) problems[evidenceField(key)] = EVIDENCE_NOT_FOUND
  }
  return problems
}

/** Items as plain JSON for the Json column. */
function storedJson(items: ChecklistItems): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(items)) as Prisma.InputJsonObject
}
