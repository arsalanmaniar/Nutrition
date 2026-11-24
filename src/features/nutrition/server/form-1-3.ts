import 'server-only'
import { randomInt } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { MIN_FORM_1_3_RESPONSES } from '@/features/nutrition/config/evaluation-forms'
import { CHECKPOINT_MONTHS, EVALUATION_FORMS } from '@/features/nutrition/config/forms'
import { assessmentPoint } from '@/features/nutrition/lib/assessment-point'
import { scoreForm } from '@/features/nutrition/lib/scoring'
import { storedAnswers } from '@/features/nutrition/validation/evaluation-forms'
import type { Snapshot } from './audit'
import { AuthorHashKeyError, trainee1_3Hashes } from './author-hash'
import type { Db } from './evaluation-forms-core'

// Form 1.3, the trainee's confidential evaluation of their primary preceptor.
// Everything that reads or writes a 1.3 row goes through this module or the
// 1.3 actions, and keeps to these rules (plan, Step 4):
//  - the row stores no author: authorId and createdBy are NULL; only
//    authorHash (author-hash.ts) ties it to the trainee who wrote it;
//  - its audit rows have actorId NULL and name only the form type, version,
//    assessment point and subject (the preceptor) — never the trainee;
//  - the trainee finds their own rows only by recomputing their hashes
//    (ownFormOneThreeRows), never through an author id;
//  - everyone else gets aggregates only, per preceptor and checkpoint, and
//    only from MIN_FORM_1_3_RESPONSES submitted forms on. Below that, the count
//    alone. An aggregate never carries a row id, a timestamp or the order the
//    forms came in, and its comments are shuffled.
// Aggregates count every submitted 1.3 about the preceptor at that point,
// whatever the assignments are now, so changing assignments later cannot
// shrink a group and expose one trainee's answers.

/** The columns the trainee's own view of a 1.3 needs. */
export const OWN_FORM_1_3_FIELDS = {
  id: true,
  formVersion: true,
  subjectId: true,
  monthNumber: true,
  assessmentPoint: true,
  answers: true,
  totalScore: true,
  maxScore: true,
  status: true,
  subject: { select: { fullName: true } },
} as const

export type OwnFormOneThree = Prisma.NutritionEvaluationFormGetPayload<{ select: typeof OWN_FORM_1_3_FIELDS }>

/**
 * The Form 1.3 rows this trainee wrote, found ONLY by recomputing their own
 * authorHash for every preceptor any 1.3 is about, at M04, M08 and M12. Throws
 * AuthorHashKeyError without the key (fail closed).
 */
export async function ownFormOneThreeRows(db: Db, traineeId: string): Promise<OwnFormOneThree[]> {
  const subjects = await db.nutritionEvaluationForm.findMany({ where: { formType: 'FORM_1_3' }, select: { subjectId: true } })
  const hashes = [...new Set(subjects.map((row) => row.subjectId))].flatMap((subjectId) => trainee1_3Hashes(traineeId, subjectId))
  if (hashes.length === 0) return []
  return db.nutritionEvaluationForm.findMany({ where: { formType: 'FORM_1_3', authorHash: { in: hashes } }, select: OWN_FORM_1_3_FIELDS })
}

/**
 * Whether Form 1.3 can be written and read now: the hash key is configured.
 * Runs authorHash's own key check on placeholder ids, so the rule lives in
 * one place.
 */
export function formOneThreeAvailable(): boolean {
  try {
    trainee1_3Hashes('key-check', 'key-check')
    return true
  } catch (error) {
    if (error instanceof AuthorHashKeyError) return false
    throw error
  }
}

/** The only thing a Form 1.3 audit row may say about the form: type, version, checkpoint and the preceptor it is about. */
export function formOneThreeAuditSnapshot(row: { formVersion: number; assessmentPoint: string; subjectId: string }): Snapshot {
  return { formType: 'FORM_1_3', formVersion: row.formVersion, assessmentPoint: row.assessmentPoint, subjectId: row.subjectId }
}

/** Writes a Form 1.3 audit row with NO actor: who acted would be who wrote it. */
export async function writeFormOneThreeAudit(
  tx: Db,
  entry: { entityId: string; action: 'create' | 'update' | 'submit'; before: Snapshot | null; after: Snapshot },
): Promise<void> {
  await tx.nutritionAuditLog.create({
    data: {
      entity: 'NutritionEvaluationForm',
      entityId: entry.entityId,
      action: entry.action,
      actorId: null,
      before: entry.before ?? undefined,
      after: entry.after,
    },
  })
}

// ── Aggregates ───────────────────────────────────────────────────────────────

/** Fewer than MIN_FORM_1_3_RESPONSES forms: the count and nothing else. */
export interface HiddenFeedback {
  count: number
  hidden: true
}

export interface ShownFeedback {
  count: number
  hidden: false
  /** Average rating per item, in form order. */
  items: { key: string; average: number }[]
  /** Average section total per section, in form order. */
  sections: { key: string; average: number; maxScore: number }[]
  total: { average: number; maxScore: number }
  /** Per comment field, the non-empty comments, shuffled. */
  comments: Record<string, string[]>
}

export interface CheckpointFeedback {
  assessmentPoint: string
  result: HiddenFeedback | ShownFeedback
}

/** Form 1.3 is due at the checkpoints only: M04, M08, M12. */
export const FORM_1_3_POINTS: readonly string[] = CHECKPOINT_MONTHS.map((month) => assessmentPoint('MONTH', month))

const round2 = (value: number) => Math.round(value * 100) / 100
const average = (values: readonly number[]) => round2(values.reduce((sum, v) => sum + v, 0) / values.length)

function shuffled<T>(values: readonly T[]): T[] {
  const result = [...values]
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/** One preceptor's results at one checkpoint, from the answers of the submitted forms only. */
function feedbackFrom(answerSets: readonly unknown[]): HiddenFeedback | ShownFeedback {
  const definition = EVALUATION_FORMS.FORM_1_3
  const responses = answerSets
    .map((answers) => {
      const { ratings, text } = storedAnswers(answers)
      const scored = scoreForm('FORM_1_3', ratings)
      return scored.ok && scored.score ? { ratings, text, score: scored.score } : null
    })
    .filter((response) => response !== null)
  const count = responses.length
  if (count < MIN_FORM_1_3_RESPONSES) return { count, hidden: true }

  return {
    count,
    hidden: false,
    items: definition.sections.flatMap((section) =>
      section.items.map((item) => ({ key: item.key, average: average(responses.map((r) => r.ratings[item.key])) })),
    ),
    sections: definition.sections.map((section, i) => ({
      key: section.key,
      average: average(responses.map((r) => r.score.sections[i].total)),
      maxScore: section.maxScore,
    })),
    total: { average: average(responses.map((r) => r.score.total)), maxScore: definition.maxScore },
    comments: Object.fromEntries(
      definition.freeText.map((field) => [field.key, shuffled(responses.map((r) => r.text[field.key]).filter((c): c is string => Boolean(c)))]),
    ),
  }
}

/**
 * Aggregated Form 1.3 results for each of these preceptors, at every
 * checkpoint (a checkpoint with no forms reads count 0, hidden). Reads only
 * the subject, the checkpoint and the answers of SUBMITTED rows: no id, no
 * author hash, no timestamp leaves the database.
 */
export async function formOneThreeFeedback(db: Db, preceptorIds: readonly string[]): Promise<Map<string, CheckpointFeedback[]>> {
  const rows =
    preceptorIds.length === 0
      ? []
      : await db.nutritionEvaluationForm.findMany({
          where: { formType: 'FORM_1_3', status: 'SUBMITTED', subjectId: { in: [...preceptorIds] } },
          select: { subjectId: true, assessmentPoint: true, answers: true },
        })
  const result = new Map<string, CheckpointFeedback[]>()
  for (const preceptorId of preceptorIds) {
    result.set(
      preceptorId,
      FORM_1_3_POINTS.map((point) => ({
        assessmentPoint: point,
        result: feedbackFrom(rows.filter((row) => row.subjectId === preceptorId && row.assessmentPoint === point).map((row) => row.answers)),
      })),
    )
  }
  return result
}
