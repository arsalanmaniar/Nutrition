import 'server-only'
import { prisma } from '@/lib/prisma'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { COMPLETION_CREDENTIAL, PROGRAM_NAME } from '@/features/nutrition/config/portfolio'
import { traineeIdSchema } from '@/features/nutrition/validation/epa'
import { activePrimaryPreceptorId } from '../evaluation-forms-core'
import { ownPreceptorId } from '../own-preceptor'
import { ownTraineeId } from '../own-trainee'
import { analyticsCsv, performanceSummary, programAnalytics, type PerformanceSummary, type ProgramAnalytics } from '../portfolio-core'

// Read models for Step 7: the e-portfolio and Month 12 summary, the
// certificate, and the program analytics and export. Each loader checks its
// role itself, with an exact role list (portal-guard-coverage.test.ts):
//  - a trainee reads only their own portfolio, summary and certificate;
//  - a preceptor reads the summary of a trainee they are ACTIVE primary
//    preceptor of, and nobody else's;
//  - an ADMIN reads program aggregates only: no row names or identifies a
//    trainee, and any group under MIN_GROUP_SIZE shows only its size.

export interface MyCertificate {
  traineeName: string
  program: string
  issuedOn: string
  verificationId: string
  revoked: boolean
}

/** The trainee's own e-portfolio: MDGRS, WPBA scorecard, EPA history, checklist, case logs and summative status. */
export async function getMyPortfolio(): Promise<PerformanceSummary | null> {
  const access = await requireNutritionRole(['TRAINEE'])
  return performanceSummary(prisma, ownTraineeId(access), new Date())
}

/** The Month 12 summary of a trainee the caller is ACTIVE primary preceptor of; null for anyone else. */
export async function getTraineeSummary(traineeId: string): Promise<PerformanceSummary | null> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const preceptorId = ownPreceptorId(access)
  const parsed = traineeIdSchema.safeParse({ traineeId })
  if (!parsed.success) return null
  if ((await activePrimaryPreceptorId(prisma, parsed.data.traineeId)) !== preceptorId) return null
  const trainee = await prisma.nutritionProfile.findUnique({ where: { id: parsed.data.traineeId }, select: { isActive: true } })
  if (!trainee?.isActive) return null
  return performanceSummary(prisma, parsed.data.traineeId, new Date())
}

/** The trainee's own completion certificate, the newest one, or null. */
export async function getMyCertificate(): Promise<MyCertificate | null> {
  const access = await requireNutritionRole(['TRAINEE'])
  const traineeId = ownTraineeId(access)
  const row = await prisma.nutritionCredential.findFirst({
    where: { traineeId, type: COMPLETION_CREDENTIAL },
    orderBy: [{ issuedAt: 'desc' }],
    select: { issuedAt: true, revokedAt: true, verificationId: true, trainee: { select: { fullName: true } } },
  })
  if (!row) return null
  return {
    traineeName: row.trainee.fullName,
    program: PROGRAM_NAME,
    issuedOn: row.issuedAt.toISOString().slice(0, 10),
    verificationId: row.verificationId,
    revoked: row.revokedAt !== null,
  }
}

/** Program aggregates (Kirkpatrick levels 1–4) for ADMIN. */
export async function getProgramAnalytics(): Promise<ProgramAnalytics> {
  await requireNutritionRole(['ADMIN'])
  return programAnalytics(prisma, new Date())
}

/** The same aggregates as CSV, for the export page: metric, group, value. No names, no ids. */
export async function getProgramMetricsCsv(): Promise<string> {
  await requireNutritionRole(['ADMIN'])
  return analyticsCsv(await programAnalytics(prisma, new Date()))
}
