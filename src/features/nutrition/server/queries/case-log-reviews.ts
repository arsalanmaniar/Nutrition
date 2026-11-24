import 'server-only'
import type { CaseFormType, EpaLevel, Prisma, SubmissionStatus } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { ownPreceptorId } from '../own-preceptor'

// Read models for the preceptor's case-log review. Each loader checks
// PRECEPTOR itself, then reads only the logs of trainees for whom the caller
// holds an ACTIVE primary assignment (looked up by the caller's own profile
// id), and never a DRAFT. Anything else is left out, or null for one log.
// Of the trainee, only the name is shown.

export interface ReviewQueueRow {
  id: string
  caseCode: string
  formType: CaseFormType
  traineeName: string
  rotationName: string | null
  epaLevel: EpaLevel | null
  submittedOn: string | null
}

export interface ReviewHistoryRow {
  id: string
  caseCode: string
  formType: CaseFormType
  traineeName: string
  status: SubmissionStatus
  reviewedOn: string | null
  reviewerName: string | null
}

export interface ReviewCaseLogDetail {
  id: string
  caseCode: string
  formType: CaseFormType
  traineeName: string
  rotationName: string | null
  ageBand: string
  diagnosisCategory: string
  epaLevel: EpaLevel | null
  status: SubmissionStatus
  /** The Form A–D fields that hold text, keyed by field key. */
  data: Record<string, string>
  submittedOn: string | null
  reviewedOn: string | null
  reviewerName: string | null
  /** The latest review's comment; on a resubmitted log, the one it was returned with. */
  reviewComment: string | null
}

/** Every status but DRAFT: a preceptor never sees a draft. */
const VISIBLE: SubmissionStatus[] = ['SUBMITTED', 'APPROVED', 'REJECTED']

/** A calendar day in Karachi time, e.g. 2026-10-11. */
const day = (date: Date | null) => (date ? date.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }) : null)

function textData(data: Prisma.JsonValue): Record<string, string> {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return {}
  return Object.fromEntries(Object.entries(data).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

/** The trainees for whom this preceptor holds an active primary assignment. */
async function assignedTraineeIds(preceptorId: string): Promise<string[]> {
  const assignments = await prisma.nutritionPreceptorAssignment.findMany({
    where: { preceptorId, active: true },
    select: { traineeId: true },
  })
  return assignments.map((assignment) => assignment.traineeId)
}

/** SUBMITTED logs of the caller's trainees, waiting for review, oldest first. */
export async function listReviewQueue(): Promise<ReviewQueueRow[]> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const traineeIds = await assignedTraineeIds(ownPreceptorId(access))
  const rows = await prisma.nutritionCaseLog.findMany({
    where: { traineeId: { in: traineeIds }, status: 'SUBMITTED' },
    orderBy: [{ submittedAt: 'asc' }],
    select: {
      id: true,
      caseCode: true,
      formType: true,
      epaLevel: true,
      submittedAt: true,
      trainee: { select: { fullName: true } },
      rotation: { select: { name: true } },
    },
  })
  return rows.map((row) => ({
    id: row.id,
    caseCode: row.caseCode,
    formType: row.formType,
    traineeName: row.trainee.fullName,
    rotationName: row.rotation?.name ?? null,
    epaLevel: row.epaLevel,
    submittedOn: day(row.submittedAt),
  }))
}

/** APPROVED and REJECTED logs of the caller's trainees, reviewed by anyone, latest review first. */
export async function listReviewHistory(): Promise<ReviewHistoryRow[]> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const traineeIds = await assignedTraineeIds(ownPreceptorId(access))
  const rows = await prisma.nutritionCaseLog.findMany({
    where: { traineeId: { in: traineeIds }, status: { in: ['APPROVED', 'REJECTED'] } },
    orderBy: [{ reviewedAt: 'desc' }],
    select: {
      id: true,
      caseCode: true,
      formType: true,
      status: true,
      reviewedAt: true,
      trainee: { select: { fullName: true } },
      reviewedBy: { select: { fullName: true } },
    },
  })
  return rows.map((row) => ({
    id: row.id,
    caseCode: row.caseCode,
    formType: row.formType,
    traineeName: row.trainee.fullName,
    status: row.status,
    reviewedOn: day(row.reviewedAt),
    reviewerName: row.reviewedBy?.fullName ?? null,
  }))
}

/** One log the caller may see: one of their trainees', and not a DRAFT. Otherwise null. */
export async function getReviewCaseLog(logId: string): Promise<ReviewCaseLogDetail | null> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  if (!z.uuid().safeParse(logId).success) return null
  const traineeIds = await assignedTraineeIds(ownPreceptorId(access))
  const row = await prisma.nutritionCaseLog.findFirst({
    where: { id: logId, traineeId: { in: traineeIds }, status: { in: VISIBLE } },
    select: {
      id: true,
      caseCode: true,
      formType: true,
      ageBand: true,
      diagnosisCategory: true,
      epaLevel: true,
      status: true,
      data: true,
      submittedAt: true,
      reviewedAt: true,
      reviewComment: true,
      trainee: { select: { fullName: true } },
      rotation: { select: { name: true } },
      reviewedBy: { select: { fullName: true } },
    },
  })
  if (!row) return null
  return {
    id: row.id,
    caseCode: row.caseCode,
    formType: row.formType,
    traineeName: row.trainee.fullName,
    rotationName: row.rotation?.name ?? null,
    ageBand: row.ageBand,
    diagnosisCategory: row.diagnosisCategory,
    epaLevel: row.epaLevel,
    status: row.status,
    data: textData(row.data),
    submittedOn: day(row.submittedAt),
    reviewedOn: day(row.reviewedAt),
    reviewerName: row.reviewedBy?.fullName ?? null,
    reviewComment: row.reviewComment,
  }
}
