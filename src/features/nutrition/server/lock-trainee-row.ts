import 'server-only'
import type { Prisma } from '@prisma/client'

/**
 * Row-locks a trainee's nutr_profile row until the transaction ends (plan,
 * Decisions (Step 3d outcome) item 1). setTrainingStartDate takes this lock
 * before it checks whether forms exist, and Step 4b must take it, in the same
 * transaction, before it reads the start date to create any form for the
 * trainee (for Form 1.3, the trainee who writes it). So no form can appear
 * between the start-date lock check and a change of the start date.
 *
 * Returns false when no such profile exists (nothing is locked).
 */
export async function lockTraineeRow(tx: Prisma.TransactionClient, traineeId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM nutr_profile WHERE id = ${traineeId} FOR UPDATE`
  return rows.length > 0
}
