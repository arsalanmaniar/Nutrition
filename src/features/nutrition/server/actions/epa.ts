'use server'

import { prisma } from '@/lib/prisma'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { epaLabel } from '@/features/nutrition/config/epas'
import { karachiDay, storedDay } from '@/features/nutrition/lib/assessment-point'
import { fail, ok, type ActionResult } from '@/features/nutrition/lib/action-result'
import { epaInputSchema } from '@/features/nutrition/validation/epa'
import { ActionFailure, formFields, invalid } from '../action-helpers'
import { writeAudit } from '../audit'
import { epaAuditSnapshot, epaRangeProblem } from '../epa-core'
import { ownPreceptorId } from '../own-preceptor'
import { lockPrimaryTrainee } from '../primary-trainee'

// Server action for the EPA entrustment dashboard (Step 6a). Starts with
// requireNutritionRole(['PRECEPTOR']) (portal-guard-coverage.test.ts checks
// it).
//
// Only the trainee's ACTIVE primary preceptor may set an EPA level, under the
// trainee row lock (server/primary-trainee.ts). The level must fit the Miller
// level it was assessed at (MILLER_EPA_TARGETS, server/epa-core.ts), or the
// action refuses and says the allowed range. The EPA is one of the configured
// keys (config/epas.ts); the day is today in Karachi, set by the server.
//
// A change is a NEW row: NutritionEpaAssessment rows are never updated or
// deleted, so the history is kept. The audit row (actorId = the caller's
// Supabase user id) has ids, the EPA key, the levels and the day, never the
// notes.

const TRAINEE_NOT_FOUND = 'This trainee was not found among your trainees.'

const EPA_FIELDS = {
  id: true,
  traineeId: true,
  assessorId: true,
  epaName: true,
  level: true,
  millerLevel: true,
  assessedOn: true,
} as const

/** Records an EPA entrustment level for one of the caller's primary trainees, as a new row. */
export async function assignEpaLevel(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const preceptorId = ownPreceptorId(access)
  const parsed = epaInputSchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)
  const input = parsed.data
  const rangeProblem = epaRangeProblem(input.level, input.millerLevel)
  if (rangeProblem) return fail(rangeProblem, { level: rangeProblem })
  const today = karachiDay(new Date())

  try {
    await prisma.$transaction(async (tx) => {
      const trainee = await lockPrimaryTrainee(tx, preceptorId, input.traineeId)
      if (!trainee) throw new ActionFailure(TRAINEE_NOT_FOUND)
      if (!trainee.trainingStartDate) throw new ActionFailure("This trainee's training start date is not set yet.")
      if (today < storedDay(trainee.trainingStartDate)) throw new ActionFailure("This trainee's training has not started yet.")

      const row = await tx.nutritionEpaAssessment.create({
        data: {
          traineeId: trainee.id,
          epaName: input.epaKey,
          level: input.level,
          millerLevel: input.millerLevel,
          assessorId: preceptorId,
          assessedOn: new Date(`${today}T00:00:00Z`),
          notes: input.notes,
          createdBy: access.userId,
        },
        select: EPA_FIELDS,
      })
      await writeAudit(tx, {
        entity: 'NutritionEpaAssessment',
        entityId: row.id,
        action: 'create',
        actorId: access.userId,
        before: null,
        after: epaAuditSnapshot(row),
      })
    })
  } catch (error) {
    if (error instanceof ActionFailure) return fail(error.message, error.fieldErrors)
    throw error
  }

  return ok(`${epaLabel(input.epaKey)}: ${input.level} recorded.`)
}
