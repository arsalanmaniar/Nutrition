import 'server-only'
import { prisma } from '@/lib/prisma'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { MSF_ROUND_MONTHS, assessorRoleLabel } from '@/features/nutrition/config/msf'
import { activeTraineeIds } from '../evaluation-forms-core'
import { inviteStatus, msfAggregate, msfRound, roundPoint, type InviteStatus, type MsfAggregate } from '../msf-core'
import { ownPreceptorId } from '../own-preceptor'
import { ownTraineeId } from '../own-trainee'

// Read models for MSF (Step 6c). Each loader checks its role itself, with an
// exact role list (portal-guard-coverage.test.ts):
//  - the preceptor sees, for the trainees they are ACTIVE primary preceptor
//    of, the links they may manage (who was asked and each link's state) and
//    each round's aggregates;
//  - the trainee sees only the domain averages of their own rounds.
// Aggregates (the four domain averages) appear only from MIN_MSF_RESPONSES
// responses; below that, only the count. No loader returns an individual
// response or a comment, and none links a response to its assessor. Unit leads and admins have no MSF loader.

export interface MsfInviteView {
  id: string
  assessorName: string
  assessorRole: string
  status: InviteStatus
  createdOn: string
  expiresOn: string
}

export interface MsfRoundView {
  point: string
  invites: MsfInviteView[]
  aggregate: MsfAggregate
}

export interface TraineeMsfView {
  traineeId: string
  traineeName: string
  /** The round a link created today would join, or null outside months 4, 8 and 12. */
  currentRound: string | null
  rounds: MsfRoundView[]
}

export interface MyMsfRound {
  point: string
  aggregate: MsfAggregate
}

const iso = (date: Date) => date.toISOString().slice(0, 10)

/** Each invite's round, and each round's response answers. No loader reads the comments. */
async function roundsFor<T extends { id: string; createdAt: Date }>(trainingStartDate: Date | null, invites: readonly T[]) {
  const roundOf = new Map(invites.map((invite) => [invite.id, msfRound(trainingStartDate, invite.createdAt)]))
  const responses =
    invites.length > 0
      ? await prisma.nutritionMsfResponse.findMany({
          where: { inviteId: { in: invites.map((invite) => invite.id) } },
          select: { inviteId: true, answers: true },
        })
      : []
  return MSF_ROUND_MONTHS.map((month) => ({
    month,
    invites: invites.filter((invite) => roundOf.get(invite.id) === month),
    responses: responses.filter((response) => roundOf.get(response.inviteId) === month),
  }))
}

/** For each of the caller's ACTIVE primary trainees: their MSF links per round and each round's aggregates. */
export async function listMyTraineesMsf(): Promise<TraineeMsfView[]> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const traineeIds = await activeTraineeIds(prisma, ownPreceptorId(access))
  if (traineeIds.length === 0) return []
  const trainees = await prisma.nutritionProfile.findMany({
    where: { id: { in: traineeIds }, role: 'TRAINEE', isActive: true },
    orderBy: [{ fullName: 'asc' }],
    select: { id: true, fullName: true, trainingStartDate: true },
  })
  const now = new Date()
  const views: TraineeMsfView[] = []
  for (const trainee of trainees) {
    const invites = await prisma.nutritionMsfInvite.findMany({
      where: { traineeId: trainee.id },
      orderBy: [{ createdAt: 'asc' }],
      select: { id: true, traineeId: true, assessorName: true, assessorRole: true, usedAt: true, expiresAt: true, createdAt: true },
    })
    const rounds = await roundsFor(trainee.trainingStartDate, invites)
    const current = msfRound(trainee.trainingStartDate, now)
    views.push({
      traineeId: trainee.id,
      traineeName: trainee.fullName,
      currentRound: current === null ? null : roundPoint(current),
      rounds: rounds.map((round) => ({
        point: roundPoint(round.month),
        invites: round.invites.map((invite) => ({
          id: invite.id,
          assessorName: invite.assessorName,
          assessorRole: assessorRoleLabel(invite.assessorRole),
          status: inviteStatus(invite, now),
          createdOn: iso(invite.createdAt),
          expiresOn: iso(invite.expiresAt),
        })),
        aggregate: msfAggregate(round.responses.map((response) => response.answers)),
      })),
    })
  }
  return views
}

/** The trainee's own MSF rounds: the four domain averages, from MIN_MSF_RESPONSES responses. No comments, no assessors. */
export async function getMyMsfSummary(): Promise<MyMsfRound[]> {
  const access = await requireNutritionRole(['TRAINEE'])
  const traineeId = ownTraineeId(access)
  const trainee = await prisma.nutritionProfile.findUnique({ where: { id: traineeId }, select: { trainingStartDate: true } })
  // Ids and creation times only: the trainee's loader never reads who was asked.
  const invites = await prisma.nutritionMsfInvite.findMany({ where: { traineeId }, select: { id: true, createdAt: true } })
  const rounds = await roundsFor(trainee?.trainingStartDate ?? null, invites)
  return rounds.map((round) => ({ point: roundPoint(round.month), aggregate: msfAggregate(round.responses.map((response) => response.answers)) }))
}
