import { createHash } from 'node:crypto'
import type { CaseFormType, EpaLevel, NutritionRole, Prisma, SubmissionStatus } from '@prisma/client'

// Writes NutritionAuditLog rows. Every create, update and deactivation in the
// nutrition admin goes through here, inside the same transaction as the change.
//
// actorId is ALWAYS the Supabase auth user id of whoever acted, never a
// NutritionProfile id: a super_admin acts as nutrition ADMIN without having a
// profile (plan decision 5). The profile, when there is one, is found through
// NutritionProfile.authUserId.
//
// Snapshots are built field by field from the row, so a password, token or key
// can never reach the log. That includes tokenHash (an MSF invite's snapshot
// must leave it out). writeAudit refuses secret-looking field names as a
// second line of defence.

/** Flat, JSON-safe copy of a row: the only shape the audit log stores. */
export type Snapshot = Record<string, string | number | boolean | null>

// Not plain "pass": Step 5's WPBA rows have a `passed` result that must be loggable.
const SECRET_FIELD = /passw(or)?d|pwd|token|secret|service.?role|api.?key/i

export interface AuditEntry {
  entity: string
  entityId: string
  action: string
  actorId: string
  before: Snapshot | null
  after: Snapshot | null
}

export async function writeAudit(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
  for (const snapshot of [entry.before, entry.after]) {
    for (const field of Object.keys(snapshot ?? {})) {
      if (SECRET_FIELD.test(field)) throw new Error(`audit: refusing to log the field "${field}"`)
    }
  }
  await tx.nutritionAuditLog.create({
    data: {
      entity: entry.entity,
      entityId: entry.entityId,
      action: entry.action,
      actorId: entry.actorId,
      before: entry.before ?? undefined,
      after: entry.after ?? undefined,
    },
  })
}

const isoDate = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null)

export function profileSnapshot(p: {
  id: string
  authUserId: string | null
  email: string
  fullName: string
  role: NutritionRole
  institution: string | null
  trainingStartDate: Date | null
  isActive: boolean
}): Snapshot {
  return {
    id: p.id,
    authUserId: p.authUserId,
    email: p.email,
    fullName: p.fullName,
    role: p.role,
    institution: p.institution,
    trainingStartDate: isoDate(p.trainingStartDate),
    isActive: p.isActive,
  }
}

export function assignmentSnapshot(a: { id: string; traineeId: string; preceptorId: string; active: boolean }): Snapshot {
  return { id: a.id, traineeId: a.traineeId, preceptorId: a.preceptorId, active: a.active }
}

export function rotationSnapshot(r: { id: string; name: string; isActive: boolean }): Snapshot {
  return { id: r.id, name: r.name, isActive: r.isActive }
}

/**
 * A case log WITHOUT its free text: the audit log must not become a second copy
 * of clinical notes. In place of `data` it records which fields hold text
 * (dataFields) and a SHA-256 of all of it (dataSha256), which shows whether
 * the text changed between two rows without repeating it. The preceptor's
 * review comment is left out for the same reason.
 */
export function caseLogSnapshot(log: {
  id: string
  traineeId: string
  caseCode: string
  formType: CaseFormType
  formVersion: number
  rotationId: string | null
  ageBand: string
  diagnosisCategory: string
  epaLevel: EpaLevel | null
  status: SubmissionStatus
  submittedAt: Date | null
  reviewedById: string | null
  reviewedAt: Date | null
  data: Prisma.JsonValue
}): Snapshot {
  const data: Prisma.JsonObject = log.data !== null && typeof log.data === 'object' && !Array.isArray(log.data) ? log.data : {}
  const keys = Object.keys(data).sort()
  return {
    id: log.id,
    traineeId: log.traineeId,
    caseCode: log.caseCode,
    formType: log.formType,
    formVersion: log.formVersion,
    rotationId: log.rotationId,
    ageBand: log.ageBand,
    diagnosisCategory: log.diagnosisCategory,
    epaLevel: log.epaLevel,
    status: log.status,
    submittedAt: log.submittedAt?.toISOString() ?? null,
    reviewedById: log.reviewedById,
    reviewedAt: log.reviewedAt?.toISOString() ?? null,
    dataFields: keys.join(','),
    dataSha256: createHash('sha256')
      .update(JSON.stringify(keys.map((key) => [key, data[key]])))
      .digest('hex'),
  }
}

/**
 * A case log's review, for the approve and reject rows: the status, who
 * reviewed it and when, and the comment's LENGTH (0 for none). Never the
 * comment itself and never the case content.
 */
export function reviewSnapshot(log: {
  id: string
  traineeId: string
  caseCode: string
  status: SubmissionStatus
  reviewedById: string | null
  reviewedAt: Date | null
  reviewComment: string | null
}): Snapshot {
  return {
    id: log.id,
    traineeId: log.traineeId,
    caseCode: log.caseCode,
    status: log.status,
    reviewedById: log.reviewedById,
    reviewedAt: log.reviewedAt?.toISOString() ?? null,
    reviewCommentLength: log.reviewComment?.length ?? 0,
  }
}
