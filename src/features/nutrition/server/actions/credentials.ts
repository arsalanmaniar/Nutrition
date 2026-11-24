'use server'

import { prisma } from '@/lib/prisma'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { COMPLETION_CREDENTIAL } from '@/features/nutrition/config/portfolio'
import { fail, ok, type ActionResult } from '@/features/nutrition/lib/action-result'
import { traineeIdSchema } from '@/features/nutrition/validation/epa'
import { ActionFailure, formFields, invalid } from '../action-helpers'
import { writeAudit } from '../audit'
import { ownPreceptorId } from '../own-preceptor'
import { credentialAuditSnapshot, newVerificationId, reachedMonth12, summativeStatus } from '../portfolio-core'
import { lockPrimaryTrainee } from '../primary-trainee'

// Server action for the certificate of completion (Step 7). Starts with
// requireNutritionRole(['PRECEPTOR']) (portal-guard-coverage.test.ts checks
// it). Only the trainee's ACTIVE primary preceptor, under the trainee row
// lock, and only when:
//  - the preceptor ticks the confirmation box;
//  - the trainee has reached training month 12 (or finished the year);
//  - every EPA in config/epas.ts has its newest level at E4 or E5 (the
//    summative target, server/portfolio-core.ts);
//  - the trainee has no valid (unrevoked) completion credential yet.
// The verification id is 32 random bytes (base64url), printed on the
// certificate and checked by the public /nutrition/verify/[id] page.
// NutritionCredential.pdfPath stays NULL: the certificate is a printable page,
// not a stored file. The audit row carries ids, type and dates, never the
// verification id.

const TRAINEE_NOT_FOUND = 'This trainee was not found among your trainees.'

/** Issues the trainee's completion credential once every rule above is met. */
export async function issueCompletionCredential(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const preceptorId = ownPreceptorId(access)
  const fields = formFields(formData)
  const parsed = traineeIdSchema.safeParse(fields)
  if (!parsed.success) return invalid(parsed.error)
  if (fields.confirm !== 'on' && fields.confirm !== 'true') {
    return fail('Tick the box to confirm the summative sign-off.', { confirm: 'Confirm the sign-off to issue the certificate.' })
  }
  const now = new Date()

  try {
    await prisma.$transaction(async (tx) => {
      const trainee = await lockPrimaryTrainee(tx, preceptorId, parsed.data.traineeId)
      if (!trainee) throw new ActionFailure(TRAINEE_NOT_FOUND)
      if (!reachedMonth12(trainee.trainingStartDate, now)) throw new ActionFailure('The certificate can be issued from training month 12.')
      const epas = await tx.nutritionEpaAssessment.findMany({
        where: { traineeId: trainee.id },
        select: { epaName: true, level: true, assessedOn: true, createdAt: true },
      })
      const summative = summativeStatus(epas)
      if (!summative.met) {
        const short = summative.epas.filter((epa) => !epa.meets).map((epa) => `${epa.label} (${epa.latest ?? 'no level'})`)
        throw new ActionFailure(`The summative target is not met: every EPA needs E4 or E5. Not yet: ${short.join(', ')}.`)
      }
      const existing = await tx.nutritionCredential.findFirst({
        where: { traineeId: trainee.id, type: COMPLETION_CREDENTIAL, revokedAt: null },
        select: { id: true },
      })
      if (existing) throw new ActionFailure('This trainee already has a valid certificate of completion.')

      const row = await tx.nutritionCredential.create({
        data: {
          traineeId: trainee.id,
          type: COMPLETION_CREDENTIAL,
          verificationId: newVerificationId(),
          issuedAt: now,
          pdfPath: null,
          createdBy: access.userId,
        },
        select: { id: true, traineeId: true, type: true, issuedAt: true, revokedAt: true },
      })
      await writeAudit(tx, {
        entity: 'NutritionCredential',
        entityId: row.id,
        action: 'create',
        actorId: access.userId,
        before: null,
        after: credentialAuditSnapshot(row),
      })
    })
  } catch (error) {
    if (error instanceof ActionFailure) return fail(error.message, error.fieldErrors)
    throw error
  }

  return ok('Certificate of completion issued.')
}
