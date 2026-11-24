import 'server-only'
import type { CaseFormType, EpaLevel, Prisma, SubmissionStatus } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { ownTraineeId } from '../own-trainee'

// Read models for the trainee's e-logbook. Each loader checks TRAINEE itself
// and reads only the caller's own case logs, filtered by their own profile id,
// so a page that lost its guard still could not show anyone else's.

export interface CaseLogRow {
  id: string
  caseCode: string
  formType: CaseFormType
  rotationName: string | null
  epaLevel: EpaLevel | null
  status: SubmissionStatus
  /** The last change, as a Karachi calendar day. */
  updatedOn: string
}

export interface CaseLogDetail {
  id: string
  caseCode: string
  formType: CaseFormType
  formVersion: number
  rotationId: string | null
  rotationName: string | null
  ageBand: string
  diagnosisCategory: string
  epaLevel: EpaLevel | null
  status: SubmissionStatus
  /** The Form A–D fields that hold text, keyed by field key. */
  data: Record<string, string>
  createdOn: string
  submittedOn: string | null
  reviewedOn: string | null
  /** The preceptor's comment, e.g. why the log was rejected (Step 3f). */
  reviewComment: string | null
}

export interface RotationOption {
  id: string
  name: string
  isActive: boolean
}

/** A calendar day in Karachi time, e.g. 2026-10-11. */
const day = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })

function textData(data: Prisma.JsonValue): Record<string, string> {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return {}
  return Object.fromEntries(Object.entries(data).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

/** The caller's own case logs, newest first. */
export async function listMyCaseLogs(): Promise<CaseLogRow[]> {
  const access = await requireNutritionRole(['TRAINEE'])
  const rows = await prisma.nutritionCaseLog.findMany({
    where: { traineeId: ownTraineeId(access) },
    orderBy: [{ createdAt: 'desc' }],
    select: {
      id: true,
      caseCode: true,
      formType: true,
      epaLevel: true,
      status: true,
      updatedAt: true,
      rotation: { select: { name: true } },
    },
  })
  return rows.map((row) => ({
    id: row.id,
    caseCode: row.caseCode,
    formType: row.formType,
    rotationName: row.rotation?.name ?? null,
    epaLevel: row.epaLevel,
    status: row.status,
    updatedOn: day(row.updatedAt),
  }))
}

/** One of the caller's own case logs; null for a malformed id, someone else's log, or no log at all. */
export async function getMyCaseLog(logId: string): Promise<CaseLogDetail | null> {
  const access = await requireNutritionRole(['TRAINEE'])
  if (!z.uuid().safeParse(logId).success) return null
  const row = await prisma.nutritionCaseLog.findFirst({
    where: { id: logId, traineeId: ownTraineeId(access) },
    select: {
      id: true,
      caseCode: true,
      formType: true,
      formVersion: true,
      rotationId: true,
      ageBand: true,
      diagnosisCategory: true,
      epaLevel: true,
      status: true,
      data: true,
      createdAt: true,
      submittedAt: true,
      reviewedAt: true,
      reviewComment: true,
      rotation: { select: { name: true } },
    },
  })
  if (!row) return null
  return {
    id: row.id,
    caseCode: row.caseCode,
    formType: row.formType,
    formVersion: row.formVersion,
    rotationId: row.rotationId,
    rotationName: row.rotation?.name ?? null,
    ageBand: row.ageBand,
    diagnosisCategory: row.diagnosisCategory,
    epaLevel: row.epaLevel,
    status: row.status,
    data: textData(row.data),
    createdOn: day(row.createdAt),
    submittedOn: row.submittedAt ? day(row.submittedAt) : null,
    reviewedOn: row.reviewedAt ? day(row.reviewedAt) : null,
    reviewComment: row.reviewComment,
  }
}

/**
 * The rotations a trainee may pick, by name: the active ones, plus the log's
 * current rotation even if it has been retired since, so editing an older log
 * does not lose it.
 */
export async function listLogbookRotations(currentRotationId: string | null = null): Promise<RotationOption[]> {
  await requireNutritionRole(['TRAINEE'])
  return prisma.nutritionRotation.findMany({
    where: currentRotationId ? { OR: [{ isActive: true }, { id: currentRotationId }] } : { isActive: true },
    orderBy: [{ name: 'asc' }],
    select: { id: true, name: true, isActive: true },
  })
}
