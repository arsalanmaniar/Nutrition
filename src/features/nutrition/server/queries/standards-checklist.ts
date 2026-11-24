import 'server-only'
import type { StandardRating, SubmissionStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { STANDARD_RATING_LABELS, STANDARDS_CHECKLIST, WPBA_FORMS } from '@/features/nutrition/config/forms'
import { periodDays, storedDay } from '@/features/nutrition/lib/assessment-point'
import { traineeIdSchema } from '@/features/nutrition/validation/epa'
import { storedItems, type EvidenceKind } from '../epa-core'
import { activePrimaryPreceptorId } from '../evaluation-forms-core'
import { ownPreceptorId } from '../own-preceptor'

// Read model for the Month 9 standards checklist (Step 6a). Starts with
// requireNutritionRole(['PRECEPTOR']) (portal-guard-coverage.test.ts).
// Only the trainee's ACTIVE primary preceptor gets anything; anyone else, and
// an id that is not a trainee's, gets null. The evidence options are only
// this trainee's own WPBAs and SUBMITTED or APPROVED case logs, the same rule
// the actions check.

export interface EvidenceView {
  kind: EvidenceKind
  id: string
  /** The case code, or the WPBA's title and day; "Not found" if the record has gone. */
  label: string
}

export interface StandardView {
  key: string
  label: string
  group: string
  rating: StandardRating | null
  ratingLabel: string | null
  evidence: EvidenceView | null
}

export interface TraineeStandardsChecklist {
  traineeId: string
  traineeName: string
  /** The first day of training month 9, or null while the start date is not set. */
  opensOn: string | null
  checklist: {
    status: SubmissionStatus
    submittedAt: string | null
    standards: StandardView[]
  } | null
  evidenceOptions: EvidenceView[]
}

/** The trainee's Month 9 checklist and the records that may be linked as evidence, for their primary preceptor only. */
export async function getTraineeStandardsChecklist(traineeId: string): Promise<TraineeStandardsChecklist | null> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const preceptorId = ownPreceptorId(access)
  const parsed = traineeIdSchema.safeParse({ traineeId })
  if (!parsed.success) return null
  if ((await activePrimaryPreceptorId(prisma, parsed.data.traineeId)) !== preceptorId) return null
  const trainee = await prisma.nutritionProfile.findUnique({
    where: { id: parsed.data.traineeId },
    select: { id: true, fullName: true, role: true, isActive: true, trainingStartDate: true },
  })
  if (trainee?.role !== 'TRAINEE' || !trainee.isActive) return null

  const [row, logs, wpbas] = await Promise.all([
    prisma.nutritionStandardsChecklist.findFirst({
      where: { traineeId: trainee.id, monthNumber: STANDARDS_CHECKLIST.monthNumber },
      select: { status: true, submittedAt: true, items: true },
    }),
    prisma.nutritionCaseLog.findMany({
      where: { traineeId: trainee.id, status: { in: ['SUBMITTED', 'APPROVED'] } },
      orderBy: [{ caseCode: 'asc' }],
      select: { id: true, caseCode: true },
    }),
    prisma.nutritionWpba.findMany({
      where: { traineeId: trainee.id },
      orderBy: [{ assessedOn: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, type: true, assessedOn: true },
    }),
  ])

  const evidenceOptions: EvidenceView[] = [
    ...logs.map((log) => ({ kind: 'CASE_LOG' as const, id: log.id, label: log.caseCode })),
    ...wpbas.map((wpba) => ({ kind: 'WPBA' as const, id: wpba.id, label: `${WPBA_FORMS[wpba.type].title}, ${storedDay(wpba.assessedOn)}` })),
  ]
  const known = new Map(evidenceOptions.map((option) => [`${option.kind}:${option.id}`, option]))

  const items = row ? storedItems(row.items) : {}
  const standards: StandardView[] = STANDARDS_CHECKLIST.groups.flatMap((group) =>
    group.standards.map((standard) => {
      const stored = items[standard.key]
      const ref = stored?.evidence ?? null
      return {
        key: standard.key,
        label: standard.label,
        group: group.title,
        rating: stored?.rating ?? null,
        ratingLabel: stored?.rating ? STANDARD_RATING_LABELS[stored.rating] : null,
        evidence: ref ? (known.get(`${ref.kind}:${ref.id}`) ?? { ...ref, label: 'Not found' }) : null,
      }
    }),
  )

  return {
    traineeId: trainee.id,
    traineeName: trainee.fullName,
    opensOn: trainee.trainingStartDate
      ? periodDays(storedDay(trainee.trainingStartDate), { kind: 'MONTH', number: STANDARDS_CHECKLIST.monthNumber }).first
      : null,
    checklist: row ? { status: row.status, submittedAt: row.submittedAt?.toISOString() ?? null, standards } : null,
    evidenceOptions,
  }
}
