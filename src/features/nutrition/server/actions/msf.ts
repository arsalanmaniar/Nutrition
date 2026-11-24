'use server'

import { prisma } from '@/lib/prisma'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { MSF_ASSESSORS_PER_ROUND, MSF_ROUND_MONTHS } from '@/features/nutrition/config/msf'
import { karachiDay, storedDay, trainingPosition } from '@/features/nutrition/lib/assessment-point'
import { fail, type ActionResult } from '@/features/nutrition/lib/action-result'
import { msfInviteSchema, msfRevokeSchema } from '@/features/nutrition/validation/msf'
import { ActionFailure, formFields, invalid } from '../action-helpers'
import { writeAudit } from '../audit'
import { countsTowardRound, inviteAuditSnapshot, inviteStatus, msfExpiry, msfRound, roundPoint } from '../msf-core'
import { newMsfToken } from '../msf-token'
import { ownPreceptorId } from '../own-preceptor'
import { lockPrimaryTrainee } from '../primary-trainee'

// Server actions for MSF links (Step 6c). Each starts with
// requireNutritionRole(['PRECEPTOR']) (portal-guard-coverage.test.ts checks
// it). Only the trainee's ACTIVE primary preceptor, under the trainee row lock
// (server/primary-trainee.ts).
//
// A link is created only in training months 4, 8 and 12 (the round is that
// month), for at most MSF_ASSESSORS_PER_ROUND assessors per round: open and
// used links count, revoked and expired ones free their place. The link's
// token (32 random bytes) is returned ONCE, in the result, and never stored:
// the invite keeps only its sha256 hash. Revoking an open link sets its
// expiry back to its creation time (there is no revokedAt column), so the
// public form refuses it like any dead link.
//
// Audit rows (actorId = the caller's Supabase user id) carry ids, the round
// and the link's state: never the token or its hash, the assessor's name or
// their profession.

const TRAINEE_NOT_FOUND = 'This trainee was not found among your trainees.'
const INVITE_NOT_FOUND = 'This link was not found.'

/** The result of creating a link: on success it carries the raw token, which is never shown again. */
export type MsfInviteResult = ActionResult | { status: 'ok'; message: string; token: string }

const INVITE_FIELDS = { id: true, traineeId: true, usedAt: true, expiresAt: true, createdAt: true } as const

/** Creates a single-use MSF link for one assessor. The raw token is in the result, once. */
export async function createMsfInvite(_previous: ActionResult, formData: FormData): Promise<MsfInviteResult> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const preceptorId = ownPreceptorId(access)
  const parsed = msfInviteSchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)
  const input = parsed.data
  const now = new Date()
  const { token, tokenHash } = newMsfToken()

  let round: number
  try {
    round = await prisma.$transaction(async (tx) => {
      const trainee = await lockPrimaryTrainee(tx, preceptorId, input.traineeId)
      if (!trainee) throw new ActionFailure(TRAINEE_NOT_FOUND)
      if (!trainee.trainingStartDate) throw new ActionFailure("This trainee's training start date is not set yet.")
      const current = msfRound(trainee.trainingStartDate, now)
      if (current === null) {
        const month = trainingPosition(storedDay(trainee.trainingStartDate), karachiDay(now))?.month
        throw new ActionFailure(
          `MSF links can be created in training months ${MSF_ROUND_MONTHS.join(', ')}${month ? `; this trainee is in month ${month}` : ''}.`,
        )
      }

      const existing = await tx.nutritionMsfInvite.findMany({ where: { traineeId: trainee.id }, select: INVITE_FIELDS })
      const taken = existing.filter(
        (invite) => msfRound(trainee.trainingStartDate, invite.createdAt) === current && countsTowardRound(inviteStatus(invite, now)),
      ).length
      if (taken >= MSF_ASSESSORS_PER_ROUND) {
        throw new ActionFailure(`This round already has ${MSF_ASSESSORS_PER_ROUND} open or answered links. Revoke an open one to invite someone else.`)
      }

      const invite = await tx.nutritionMsfInvite.create({
        data: {
          traineeId: trainee.id,
          tokenHash,
          assessorName: input.assessorName,
          assessorRole: input.assessorRole,
          expiresAt: msfExpiry(now),
          createdAt: now,
          createdBy: access.userId,
        },
        select: INVITE_FIELDS,
      })
      await writeAudit(tx, {
        entity: 'NutritionMsfInvite',
        entityId: invite.id,
        action: 'create',
        actorId: access.userId,
        before: null,
        after: inviteAuditSnapshot(invite, current, now),
      })
      return current
    })
  } catch (error) {
    if (error instanceof ActionFailure) return fail(error.message, error.fieldErrors)
    throw error
  }

  return { status: 'ok', message: `MSF link created for round ${roundPoint(round)}. Copy it now: it is shown only once.`, token }
}

/** Revokes an open link: it can no longer be answered, and its place in the round is freed. */
export async function revokeMsfInvite(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const preceptorId = ownPreceptorId(access)
  const parsed = msfRevokeSchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)
  const now = new Date()

  try {
    await prisma.$transaction(async (tx) => {
      const found = await tx.nutritionMsfInvite.findUnique({ where: { id: parsed.data.inviteId }, select: { traineeId: true } })
      if (!found) throw new ActionFailure(INVITE_NOT_FOUND)
      const trainee = await lockPrimaryTrainee(tx, preceptorId, found.traineeId)
      if (!trainee) throw new ActionFailure(INVITE_NOT_FOUND)
      const before = await tx.nutritionMsfInvite.findUnique({ where: { id: parsed.data.inviteId }, select: INVITE_FIELDS })
      if (!before) throw new ActionFailure(INVITE_NOT_FOUND)
      if (inviteStatus(before, now) !== 'OPEN') throw new ActionFailure('This link is no longer open, so there is nothing to revoke.')

      const after = await tx.nutritionMsfInvite.update({
        where: { id: before.id },
        data: { expiresAt: before.createdAt },
        select: INVITE_FIELDS,
      })
      const round = msfRound(trainee.trainingStartDate, before.createdAt)
      await writeAudit(tx, {
        entity: 'NutritionMsfInvite',
        entityId: after.id,
        action: 'revoke',
        actorId: access.userId,
        before: inviteAuditSnapshot(before, round, now),
        after: inviteAuditSnapshot(after, round, now),
      })
    })
  } catch (error) {
    if (error instanceof ActionFailure) return fail(error.message, error.fieldErrors)
    throw error
  }

  return { status: 'ok', message: 'Link revoked. You can invite someone else for this round.' }
}
