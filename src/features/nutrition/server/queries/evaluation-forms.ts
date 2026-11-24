import 'server-only'
import type { EvaluationFormType, SubmissionStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { canSeeIndividualForm13, type NutritionAccess } from '@/features/nutrition/auth/roles'
import { EVALUATION_FORMS } from '@/features/nutrition/config/forms'
import type { DueStatus, ExistingForm, Schedule } from '@/features/nutrition/lib/scheduler'
import { storedAnswers, type EvaluationAnswers } from '@/features/nutrition/validation/evaluation-forms'
import { AuthorHashKeyError } from '../author-hash'
import {
  SUBMITTED_STATUSES,
  activePrimaryPreceptorId,
  activeTraineeIds,
  karachiDate,
  nextDue,
  scheduleFor,
} from '../evaluation-forms-core'
import { FORM_1_3_POINTS, formOneThreeAvailable, formOneThreeFeedback, ownFormOneThreeRows, type CheckpointFeedback, type OwnFormOneThree } from '../form-1-3'
import { ownPreceptorId } from '../own-preceptor'
import { ownTraineeId } from '../own-trainee'

// Read models for the evaluation forms (Step 4b). Each loader checks its role
// itself, with an exact role list (portal-guard-coverage.test.ts), and reads
// only what that person may see:
//  - a trainee: their own forms, the 1.2 and 3.1 their preceptor SUBMITTED
//    about them, and their own Form 1.3 rows, found only by recomputing their
//    authorHash (form-1-3.ts);
//  - a preceptor: the forms of trainees for whom they hold an ACTIVE primary
//    assignment (never a trainee's draft), and their own Form 1.3 results as
//    aggregates;
//  - a unit lead and ADMIN (a super_admin included): Form 1.3 aggregates.
// No loader returns an individual Form 1.3 row to anyone but the trainee who
// wrote it, and every loader but the trainee's own leaves Form 1.3 out.

const TRAINEE_FORMS = '/nutrition/trainee/forms'
const PRECEPTOR_FORMS = '/nutrition/preceptor/forms'

export interface DueRow {
  formType: EvaluationFormType
  title: string
  assessmentPoint: string
  dueBy: string
  status: DueStatus
  overdue: boolean
  /** The form's page, to continue or view it; null if it is not started. */
  href: string | null
  /** The not-started form of its type that the server would open next (forms are filled oldest first). */
  canStart: boolean
}

export interface ScheduleSummary {
  state: Schedule['state']
  startsOn: string | null
  week: number | null
  month: number | null
}

export interface FormListRow {
  id: string
  formType: EvaluationFormType
  title: string
  assessmentPoint: string
  status: SubmissionStatus
  submittedOn: string | null
  href: string
}

export interface OwnFormOneThreeRow {
  assessmentPoint: string
  status: SubmissionStatus
  preceptorName: string | null
  href: string
}

export interface MyFormsOverview extends ScheduleSummary {
  due: DueRow[]
  /** No active primary preceptor: Form 1.3 cannot be started. */
  hasPreceptor: boolean
  /** Form 1.3 cannot be read or written now (no hash key, or a super_admin's trainee profile). */
  formOneThreeUnavailable: boolean
  /** The trainee's own weekly check-ins and Forms 1.1, and the 1.2 and 3.1 submitted about them. */
  forms: FormListRow[]
  /** The trainee's own Form 1.3 rows: checkpoint and status, no timestamps. */
  formOneThree: OwnFormOneThreeRow[]
}

export interface EvaluationFormDetail {
  id: string
  formType: EvaluationFormType
  assessmentPoint: string
  monthNumber: number
  status: SubmissionStatus
  answers: EvaluationAnswers
  totalScore: number | null
  maxScore: number | null
  submittedOn: string | null
  /** Who filled it in, when that is not the viewer. */
  authorName: string | null
  /** The preceptor's comment on a weekly check-in. */
  reviewComment: string | null
  reviewerName: string | null
  reviewedOn: string | null
  /** The viewer may still change it. */
  editable: boolean
}

export interface PreceptorFormDetail extends EvaluationFormDetail {
  traineeName: string
  /** Submitted, and the viewer is the trainee's active primary preceptor. */
  canReopen: boolean
  canComment: boolean
}

export type MyFormOneThree =
  | { status: 'unavailable' }
  | { status: 'none' }
  | {
      status: 'found'
      form: {
        id: string
        assessmentPoint: string
        status: SubmissionStatus
        answers: EvaluationAnswers
        totalScore: number | null
        maxScore: number | null
        preceptorName: string | null
        editable: boolean
      }
    }

export interface TraineeFormsRow extends ScheduleSummary {
  traineeId: string
  traineeName: string
  /** Forms 1.2 and 3.1 due from this preceptor. */
  due: DueRow[]
  /** The trainee's submitted weekly check-ins, newest first, for comments. */
  weekly: { id: string; assessmentPoint: string; submittedOn: string | null; commented: boolean; href: string }[]
  /** The trainee's other submitted forms (1.1, 1.2, 3.1), to view or reopen. */
  submitted: FormListRow[]
}

export interface PreceptorFeedbackRow {
  /** Never an id: the aggregate names the preceptor only. */
  preceptorName: string
  checkpoints: CheckpointFeedback[]
}

const FORM_ROW = {
  id: true,
  formType: true,
  assessmentPoint: true,
  status: true,
  authorId: true,
  subjectId: true,
  submittedAt: true,
  reviewComment: true,
} as const

const isSubmitted = (status: SubmissionStatus) => SUBMITTED_STATUSES.includes(status)
const byPointDesc = (a: { assessmentPoint: string }, b: { assessmentPoint: string }) => b.assessmentPoint.localeCompare(a.assessmentPoint)

function summary(schedule: Schedule): ScheduleSummary {
  return {
    state: schedule.state,
    startsOn: schedule.state === 'NOT_STARTED' ? schedule.startsOn : null,
    week: schedule.state === 'IN_TRAINING' ? schedule.week : null,
    month: schedule.state === 'IN_TRAINING' ? schedule.month : null,
  }
}

/** The due forms of these types, with where each one opens and which one the server would start next. */
function dueRows(schedule: Schedule, types: readonly EvaluationFormType[], href: (formType: EvaluationFormType, point: string) => string | null): DueRow[] {
  if (schedule.state !== 'IN_TRAINING' && schedule.state !== 'FINISHED') return []
  return schedule.forms
    .filter((form) => types.includes(form.formType))
    .map((form) => {
      const next = nextDue(schedule, form.formType)
      return {
        formType: form.formType,
        title: EVALUATION_FORMS[form.formType].title,
        assessmentPoint: form.assessmentPoint,
        dueBy: form.dueBy,
        status: form.status,
        overdue: form.overdue,
        href: form.status === 'NOT_STARTED' ? null : href(form.formType, form.assessmentPoint),
        canStart: form.status === 'NOT_STARTED' && next?.assessmentPoint === form.assessmentPoint,
      }
    })
}

// ── Trainee ──────────────────────────────────────────────────────────────────

/** The trainee's own Form 1.3 rows, or null when they cannot be read now (fail closed). */
async function ownFormOneThreeOrNull(access: NutritionAccess, traineeId: string): Promise<OwnFormOneThree[] | null> {
  if (!canSeeIndividualForm13(access) || !formOneThreeAvailable()) return null
  try {
    return await ownFormOneThreeRows(prisma, traineeId)
  } catch (error) {
    if (error instanceof AuthorHashKeyError) return null
    throw error
  }
}

async function traineeOverview(access: NutritionAccess): Promise<MyFormsOverview> {
  const traineeId = ownTraineeId(access)
  const [trainee, rows, preceptorId, own] = await Promise.all([
    prisma.nutritionProfile.findUnique({ where: { id: traineeId }, select: { trainingStartDate: true } }),
    prisma.nutritionEvaluationForm.findMany({ where: { subjectId: traineeId, formType: { not: 'FORM_1_3' } }, select: FORM_ROW }),
    activePrimaryPreceptorId(prisma, traineeId),
    ownFormOneThreeOrNull(access, traineeId),
  ])
  const existing: ExistingForm[] = [
    ...rows,
    ...(own ?? []).map((row) => ({ formType: 'FORM_1_3' as const, assessmentPoint: row.assessmentPoint, status: row.status })),
  ]
  const schedule = scheduleFor({ trainingStartDate: trainee?.trainingStartDate ?? null }, existing)
  const mine = rows.filter((row) => row.authorId === traineeId)
  const types: EvaluationFormType[] = own === null ? ['WEEKLY', 'FORM_1_1'] : ['WEEKLY', 'FORM_1_1', 'FORM_1_3']
  const due = dueRows(schedule, types, (formType, point) => {
    if (formType === 'FORM_1_3') return `${TRAINEE_FORMS}/confidential/${point}`
    const row = mine.find((r) => r.formType === formType && r.assessmentPoint === point)
    return row ? `${TRAINEE_FORMS}/${row.id}` : null
  }).map((row) => (row.formType === 'FORM_1_3' && !preceptorId ? { ...row, canStart: false } : row))

  return {
    ...summary(schedule),
    due,
    hasPreceptor: preceptorId !== null,
    formOneThreeUnavailable: own === null,
    forms: rows
      .filter((row) => row.authorId === traineeId || isSubmitted(row.status))
      .sort(byPointDesc)
      .map((row) => ({
        id: row.id,
        formType: row.formType,
        title: EVALUATION_FORMS[row.formType].title,
        assessmentPoint: row.assessmentPoint,
        status: row.status,
        submittedOn: karachiDate(row.submittedAt),
        href: `${TRAINEE_FORMS}/${row.id}`,
      })),
    formOneThree: (own ?? []).sort(byPointDesc).map((row) => ({
      assessmentPoint: row.assessmentPoint,
      status: row.status,
      preceptorName: row.subject?.fullName ?? null,
      href: `${TRAINEE_FORMS}/confidential/${row.assessmentPoint}`,
    })),
  }
}

/** The trainee's forms page: the Due panel (forms they fill), their forms, and their own Form 1.3 rows. */
export async function getMyFormsOverview(): Promise<MyFormsOverview> {
  const access = await requireNutritionRole(['TRAINEE'])
  return traineeOverview(access)
}

/** The trainee dashboard's "Due now" card: how many forms they owe now, and how many are overdue. */
export async function getMyDueNow(): Promise<ScheduleSummary & { dueNow: number; overdue: number }> {
  const access = await requireNutritionRole(['TRAINEE'])
  const overview = await traineeOverview(access)
  const open = overview.due.filter((row) => row.status !== 'SUBMITTED')
  return {
    state: overview.state,
    startsOn: overview.startsOn,
    week: overview.week,
    month: overview.month,
    dueNow: open.filter((row) => !row.overdue).length,
    overdue: open.filter((row) => row.overdue).length,
  }
}

/**
 * One of the trainee's own weekly check-ins or Forms 1.1 (any status), or a
 * 1.2 or 3.1 SUBMITTED about them. Never a Form 1.3: that has its own loader.
 */
export async function getMyEvaluationForm(formId: string): Promise<EvaluationFormDetail | null> {
  const access = await requireNutritionRole(['TRAINEE'])
  const traineeId = ownTraineeId(access)
  const row = await prisma.nutritionEvaluationForm.findFirst({
    where: {
      id: formId,
      subjectId: traineeId,
      formType: { not: 'FORM_1_3' },
      OR: [{ authorId: traineeId }, { status: { in: [...SUBMITTED_STATUSES] } }],
    },
    select: DETAIL_FIELDS,
  })
  if (!row) return null
  return detail(row, row.authorId === traineeId && row.status === 'DRAFT', row.authorId === traineeId)
}

/**
 * The trainee's own Form 1.3 at a checkpoint, found ONLY by recomputing their
 * authorHash. Nobody else has any loader for an individual 1.3, and a
 * super_admin's trainee profile gets none either. No timestamps, even here.
 */
export async function getMyFormOneThree(point: string): Promise<MyFormOneThree> {
  const access = await requireNutritionRole(['TRAINEE'])
  const traineeId = ownTraineeId(access)
  if (!FORM_1_3_POINTS.includes(point)) return { status: 'none' }
  const own = await ownFormOneThreeOrNull(access, traineeId)
  if (own === null) return { status: 'unavailable' }
  const atPoint = own.filter((row) => row.assessmentPoint === point)
  if (atPoint.length === 0) return { status: 'none' }
  const preceptorId = await activePrimaryPreceptorId(prisma, traineeId)
  // A draft left about a former preceptor stays behind; show the submitted one, or the current preceptor's.
  const row = atPoint.find((r) => isSubmitted(r.status)) ?? atPoint.find((r) => r.subjectId === preceptorId) ?? atPoint[0]
  return {
    status: 'found',
    form: {
      id: row.id,
      assessmentPoint: row.assessmentPoint,
      status: row.status,
      answers: storedAnswers(row.answers),
      totalScore: row.totalScore,
      maxScore: row.maxScore,
      preceptorName: row.subject?.fullName ?? null,
      editable: row.status === 'DRAFT',
    },
  }
}

// ── Preceptor ────────────────────────────────────────────────────────────────

const DETAIL_FIELDS = {
  id: true,
  formType: true,
  assessmentPoint: true,
  monthNumber: true,
  status: true,
  answers: true,
  totalScore: true,
  maxScore: true,
  submittedAt: true,
  authorId: true,
  subjectId: true,
  reviewComment: true,
  reviewedAt: true,
  author: { select: { fullName: true } },
  reviewedBy: { select: { fullName: true } },
  subject: { select: { fullName: true } },
} as const

type DetailRow = {
  id: string
  formType: EvaluationFormType
  assessmentPoint: string
  monthNumber: number
  status: SubmissionStatus
  answers: unknown
  totalScore: number | null
  maxScore: number | null
  submittedAt: Date | null
  authorId: string | null
  reviewComment: string | null
  reviewedAt: Date | null
  author: { fullName: string } | null
  reviewedBy: { fullName: string } | null
}

function detail(row: DetailRow, editable: boolean, ownForm: boolean): EvaluationFormDetail {
  return {
    id: row.id,
    formType: row.formType,
    assessmentPoint: row.assessmentPoint,
    monthNumber: row.monthNumber,
    status: row.status,
    answers: storedAnswers(row.answers),
    totalScore: row.totalScore,
    maxScore: row.maxScore,
    submittedOn: karachiDate(row.submittedAt),
    authorName: ownForm ? null : (row.author?.fullName ?? null),
    reviewComment: row.formType === 'WEEKLY' ? row.reviewComment : null,
    reviewerName: row.formType === 'WEEKLY' ? (row.reviewedBy?.fullName ?? null) : null,
    reviewedOn: row.formType === 'WEEKLY' ? karachiDate(row.reviewedAt) : null,
    editable,
  }
}

/**
 * The preceptor's forms page: for each trainee they are the ACTIVE primary
 * preceptor of, the Forms 1.2 and 3.1 due from them, the submitted weekly
 * check-ins (to comment on) and the other submitted forms. Never Form 1.3.
 */
export async function listMyTraineesForms(): Promise<TraineeFormsRow[]> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const preceptorId = ownPreceptorId(access)
  const traineeIds = await activeTraineeIds(prisma, preceptorId)
  if (traineeIds.length === 0) return []
  const [trainees, rows] = await Promise.all([
    prisma.nutritionProfile.findMany({
      where: { id: { in: traineeIds } },
      orderBy: [{ fullName: 'asc' }],
      select: { id: true, fullName: true, trainingStartDate: true },
    }),
    prisma.nutritionEvaluationForm.findMany({ where: { subjectId: { in: traineeIds }, formType: { not: 'FORM_1_3' } }, select: FORM_ROW }),
  ])

  return trainees.map((trainee) => {
    const theirs = rows.filter((row) => row.subjectId === trainee.id)
    const schedule = scheduleFor(trainee, theirs)
    const mine = theirs.filter((row) => row.authorId === preceptorId)
    return {
      traineeId: trainee.id,
      traineeName: trainee.fullName,
      ...summary(schedule),
      due: dueRows(schedule, ['FORM_1_2', 'FORM_3_1'], (formType, point) => {
        const row = mine.find((r) => r.formType === formType && r.assessmentPoint === point) ?? theirs.find((r) => r.formType === formType && r.assessmentPoint === point && isSubmitted(r.status))
        return row ? `${PRECEPTOR_FORMS}/${row.id}` : null
      }),
      weekly: theirs
        .filter((row) => row.formType === 'WEEKLY' && isSubmitted(row.status))
        .sort(byPointDesc)
        .map((row) => ({
          id: row.id,
          assessmentPoint: row.assessmentPoint,
          submittedOn: karachiDate(row.submittedAt),
          commented: Boolean(row.reviewComment),
          href: `${PRECEPTOR_FORMS}/${row.id}`,
        })),
      submitted: theirs
        .filter((row) => row.formType !== 'WEEKLY' && isSubmitted(row.status))
        .sort(byPointDesc)
        .map((row) => ({
          id: row.id,
          formType: row.formType,
          title: EVALUATION_FORMS[row.formType].title,
          assessmentPoint: row.assessmentPoint,
          status: row.status,
          submittedOn: karachiDate(row.submittedAt),
          href: `${PRECEPTOR_FORMS}/${row.id}`,
        })),
    }
  })
}

/**
 * One form about a trainee the caller is the ACTIVE primary preceptor of:
 * submitted, or the caller's own draft. Never a trainee's draft, never Form
 * 1.3 (whose subject is a preceptor, so it is excluded twice over).
 */
export async function getTraineeEvaluationForm(formId: string): Promise<PreceptorFormDetail | null> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const preceptorId = ownPreceptorId(access)
  const traineeIds = await activeTraineeIds(prisma, preceptorId)
  const row = await prisma.nutritionEvaluationForm.findFirst({
    where: {
      id: formId,
      subjectId: { in: traineeIds },
      formType: { not: 'FORM_1_3' },
      OR: [{ status: { in: [...SUBMITTED_STATUSES] } }, { authorId: preceptorId }],
    },
    select: DETAIL_FIELDS,
  })
  if (!row) return null
  const own = row.authorId === preceptorId
  const preceptorForm = row.formType === 'FORM_1_2' || row.formType === 'FORM_3_1'
  return {
    ...detail(row, own && preceptorForm && row.status === 'DRAFT', own),
    traineeName: row.subject?.fullName ?? '',
    canReopen: isSubmitted(row.status),
    canComment: row.formType === 'WEEKLY' && row.status === 'SUBMITTED',
  }
}

// ── Form 1.3 aggregates ──────────────────────────────────────────────────────

/** The preceptor's own Form 1.3 results, per checkpoint, aggregated: hidden below MIN_FORM_1_3_RESPONSES. */
export async function listMyFormOneThreeFeedback(): Promise<CheckpointFeedback[]> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const preceptorId = ownPreceptorId(access)
  return (await formOneThreeFeedback(prisma, [preceptorId])).get(preceptorId) ?? []
}

async function feedbackRows(preceptorIds: string[]): Promise<PreceptorFeedbackRow[]> {
  if (preceptorIds.length === 0) return []
  const [profiles, feedback] = await Promise.all([
    prisma.nutritionProfile.findMany({ where: { id: { in: preceptorIds } }, orderBy: [{ fullName: 'asc' }], select: { id: true, fullName: true } }),
    formOneThreeFeedback(prisma, preceptorIds),
  ])
  return profiles.map((profile) => ({ preceptorName: profile.fullName, checkpoints: feedback.get(profile.id) ?? [] }))
}

/**
 * A unit lead's view: Form 1.3 aggregates for the preceptors in their ROTATION
 * SCOPE, which the schema supports: the rotation preceptors of placements on
 * rotations they lead (NutritionRotation.unitLeadId), and the primary
 * preceptors (any assignment, current or ended) of the trainees placed there.
 */
export async function listRotationFormOneThreeFeedback(): Promise<PreceptorFeedbackRow[]> {
  const access = await requireNutritionRole(['UNIT_LEAD'])
  if (access.profile?.role !== 'UNIT_LEAD') throw new Error('nutrition: the caller has no active unit lead profile')
  const rotations = await prisma.nutritionRotation.findMany({ where: { unitLeadId: access.profile.id }, select: { id: true } })
  if (rotations.length === 0) return []
  const entries = await prisma.nutritionRotationEntry.findMany({
    where: { rotationId: { in: rotations.map((rotation) => rotation.id) } },
    select: { traineeId: true, rotationPreceptorId: true },
  })
  const traineeIds = [...new Set(entries.map((entry) => entry.traineeId))]
  const primaries =
    traineeIds.length === 0
      ? []
      : await prisma.nutritionPreceptorAssignment.findMany({ where: { traineeId: { in: traineeIds } }, select: { preceptorId: true } })
  const preceptorIds = new Set<string>()
  for (const entry of entries) if (entry.rotationPreceptorId) preceptorIds.add(entry.rotationPreceptorId)
  for (const assignment of primaries) preceptorIds.add(assignment.preceptorId)
  return feedbackRows([...preceptorIds])
}

/** ADMIN (a super_admin included): Form 1.3 aggregates for every preceptor, and anyone else a 1.3 is about. */
export async function listAllFormOneThreeFeedback(): Promise<PreceptorFeedbackRow[]> {
  await requireNutritionRole(['ADMIN'])
  const [preceptors, subjects] = await Promise.all([
    prisma.nutritionProfile.findMany({ where: { role: 'PRECEPTOR' }, select: { id: true } }),
    prisma.nutritionEvaluationForm.findMany({ where: { formType: 'FORM_1_3', status: 'SUBMITTED' }, select: { subjectId: true } }),
  ])
  return feedbackRows([...new Set([...preceptors.map((p) => p.id), ...subjects.map((s) => s.subjectId)])])
}
