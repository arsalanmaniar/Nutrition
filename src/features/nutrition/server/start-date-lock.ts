import 'server-only'
import type { Prisma } from '@prisma/client'
import { trainee1_3Hashes } from './author-hash'

/**
 * Whether a trainee's training start date can no longer change: true once any
 * evaluation form exists for them (plan, Decisions (Step 2 outcome) item 2 and
 * (Step 3d outcome) items 2 and 6). That is a form about them or written by
 * them, and also a Form 1.3 they wrote, which stores no author: it is found by
 * recomputing the trainee's own authorHash for every preceptor any Form 1.3 is
 * about.
 *
 * Call it inside the transaction, after lockTraineeRow(tx, traineeId). Throws
 * AuthorHashKeyError (fail closed) when Form 1.3 rows exist but the hash key
 * is missing.
 */
export async function trainingStartDateLocked(tx: Prisma.TransactionClient, traineeId: string): Promise<boolean> {
  const direct = await tx.nutritionEvaluationForm.count({
    where: { OR: [{ subjectId: traineeId }, { authorId: traineeId }] },
  })
  if (direct > 0) return true

  const formOneThree = await tx.nutritionEvaluationForm.findMany({ where: { formType: 'FORM_1_3' }, select: { subjectId: true } })
  const subjects = [...new Set(formOneThree.map((form) => form.subjectId))]
  if (subjects.length === 0) return false
  const ownHashes = subjects.flatMap((subjectId) => trainee1_3Hashes(traineeId, subjectId))
  const written = await tx.nutritionEvaluationForm.count({ where: { formType: 'FORM_1_3', authorHash: { in: ownHashes } } })
  return written > 0
}
