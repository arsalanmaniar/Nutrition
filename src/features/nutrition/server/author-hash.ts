import 'server-only'
import { createHmac } from 'node:crypto'
import { CHECKPOINT_MONTHS } from '@/features/nutrition/config/forms'
import { assessmentPoint } from '@/features/nutrition/lib/assessment-point'

// Form 1.3 is the trainee's confidential evaluation of their preceptor: its
// row stores no authorId, only authorHash (plan, Step 2), so nobody reading
// the table can tell who wrote it. The hash is
//
//   HMAC-SHA256(NUTRITION_AUTHOR_HASH_KEY, `${authorProfileId}|${subjectId}|${assessmentPoint}`), hex
//
// and its unique index allows one Form 1.3 per trainee, preceptor and
// checkpoint. Only the server, holding the key, can recompute a trainee's
// hashes: the start-date lock does that (start-date-lock.ts).
//
// The key must never change once Form 1.3 rows exist: old hashes would stop
// matching, which reopens duplicates and breaks the start-date lock (plan,
// Decisions (Step 3d outcome) item 6). Without a key of at least 32
// characters, nothing is hashed: every call throws (fail closed).

export const MIN_KEY_LENGTH = 32

/** NUTRITION_AUTHOR_HASH_KEY is missing or too short, so no author hash can be computed. */
export class AuthorHashKeyError extends Error {
  constructor() {
    super(`NUTRITION_AUTHOR_HASH_KEY is missing or shorter than ${MIN_KEY_LENGTH} characters.`)
    this.name = 'AuthorHashKeyError'
  }
}

/** Read on every call, never cached. */
function hashKey(): string {
  const key = process.env.NUTRITION_AUTHOR_HASH_KEY
  if (!key || key.length < MIN_KEY_LENGTH) throw new AuthorHashKeyError()
  return key
}

/** Form 1.3 happens only at the checkpoints: "M04", "M08", "M12". */
const CHECKPOINT_POINTS: readonly string[] = CHECKPOINT_MONTHS.map((month) => assessmentPoint('MONTH', month))

/** The authorHash of a Form 1.3 written by `authorProfileId` about `subjectId` at a checkpoint. */
export function authorHash(authorProfileId: string, subjectId: string, point: string): string {
  // "|" separates the parts, so a part containing one could make two different
  // triples hash alike. Profile ids are uuids; anything else is a bug.
  for (const id of [authorProfileId, subjectId]) {
    if (id === '' || id.includes('|')) throw new TypeError('authorHash: a profile id must be non-empty and contain no "|".')
  }
  if (!CHECKPOINT_POINTS.includes(point)) throw new RangeError(`authorHash: Form 1.3 has no assessment point ${JSON.stringify(point)}.`)
  return createHmac('sha256', hashKey()).update(`${authorProfileId}|${subjectId}|${point}`).digest('hex')
}

/** The hashes a trainee's Form 1.3 about this preceptor would have, at M04, M08 and M12, for the start-date lock. */
export function trainee1_3Hashes(traineeId: string, subjectId: string): string[] {
  return CHECKPOINT_POINTS.map((point) => authorHash(traineeId, subjectId, point))
}
