import 'server-only'
import type { Prisma } from '@prisma/client'
import { activePrimaryPreceptorId } from './evaluation-forms-core'
import { lockTraineeRow } from './lock-trainee-row'

/**
 * For a write about a trainee that only their ACTIVE primary preceptor may
 * make (Step 6a: EPA levels and the Month 9 standards checklist). Takes the
 * trainee row lock FIRST (lock-trainee-row.ts), then checks the profile is an
 * active trainee's and that this preceptor holds the trainee's active primary
 * assignment. A rotation preceptor, a former primary preceptor or anyone else
 * gets null, the same as for no such trainee.
 */
export async function lockPrimaryTrainee(
  tx: Prisma.TransactionClient,
  preceptorId: string,
  traineeId: string,
): Promise<{ id: string; trainingStartDate: Date | null } | null> {
  if (!(await lockTraineeRow(tx, traineeId))) return null
  const trainee = await tx.nutritionProfile.findUnique({
    where: { id: traineeId },
    select: { id: true, role: true, isActive: true, trainingStartDate: true },
  })
  if (trainee?.role !== 'TRAINEE' || !trainee.isActive) return null
  if ((await activePrimaryPreceptorId(tx, traineeId)) !== preceptorId) return null
  return { id: trainee.id, trainingStartDate: trainee.trainingStartDate }
}
