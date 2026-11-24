// Shared set-up for the Step 5a WPBA tests (not itself a test file).

import type { CaseFormType, SubmissionStatus, WpbaType } from '@prisma/client'
import { ratingFieldName } from '@/features/nutrition/config/evaluation-forms'
import { WPBA_FORMS } from '@/features/nutrition/config/forms'
import { fakePrisma } from './fake-prisma'

/** The day NOW (evaluation-fixtures.ts) falls on in Karachi. */
export const TODAY = '2026-04-15'

export const NOT_ASSESSABLE = { status: 'error', message: 'This trainee was not found among the trainees you may assess.' }
export const CASE_LOG_NOT_FOUND = {
  status: 'error',
  message: 'This case log was not found.',
  fieldErrors: { caseLogId: 'This case log was not found.' },
}
export const DOUBLE_SUBMIT = { status: 'error', message: 'This assessment was submitted a moment ago. It has not been filed twice.' }

type Row = Record<string, unknown>
export const wpbas = () => fakePrisma.tables.nutritionWpba as Row[]

export const itemKeys = (type: WpbaType) => WPBA_FORMS[type].sections.flatMap((section) => section.items.map((item) => item.key))

/** Every item of a WPBA type rated: one value for all, or values in item order. */
export function wpbaRatings(type: WpbaType, values: number | readonly number[]): Record<string, string> {
  return Object.fromEntries(
    itemKeys(type).map((key, i) => [ratingFieldName(key), String(typeof values === 'number' ? values : values[i])]),
  )
}

const DEFAULTS: Record<WpbaType, { rating: number; extra: Record<string, string> }> = {
  MINI_CEX: { rating: 8, extra: {} },
  DOPS: { rating: 4, extra: { procedure: 'growth_plotting' } },
  CBD: { rating: 4, extra: {} },
  OSCE: { rating: 4, extra: {} },
}

/** What a complete WPBA form posts, assessed today. A CbD needs a caseLogId in `extra`. */
export function wpbaForm(type: WpbaType, traineeId: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    type,
    traineeId,
    assessedOn: TODAY,
    feedback: 'Clear history taking. Next time, summarise the feeding plan for the family before closing.',
    ...wpbaRatings(type, DEFAULTS[type].rating),
    ...DEFAULTS[type].extra,
    ...extra,
  }
}

/** One of the trainee's case logs, SUBMITTED unless told otherwise. */
export function seedCaseLog(traineeId: string, status: SubmissionStatus = 'SUBMITTED', caseCode = 'C-2026-001'): Row {
  return fakePrisma.seed('nutritionCaseLog', {
    traineeId,
    caseCode,
    ageBand: '40_59y',
    diagnosisCategory: 'placeholder_renal',
    formType: 'A' as CaseFormType,
    formVersion: 1,
    data: { assessment: 'Weight 72.5 kg.' },
    status,
    submittedAt: status === 'DRAFT' ? null : new Date('2026-04-10T08:00:00Z'),
    createdBy: 'auth-seed',
  })
}

/** A placement of the trainee on a rotation, supervised by `rotationPreceptorId`, from `start` to `end` (open-ended if none). */
export function seedPlacement(traineeId: string, rotationPreceptorId: string, start: string, end: string | null = null): Row {
  const rotation = fakePrisma.seed('nutritionRotation', { name: `Rotation ${fakePrisma.tables.nutritionRotation.length + 1}`, createdBy: 'auth-seed' })
  return fakePrisma.seed('nutritionRotationEntry', {
    traineeId,
    rotationId: rotation.id,
    rotationPreceptorId,
    startDate: new Date(`${start}T00:00:00Z`),
    endDate: end ? new Date(`${end}T00:00:00Z`) : null,
    createdBy: 'auth-seed',
  })
}

/** A WPBA as the action stores it. */
export function seedWpba(
  type: WpbaType,
  traineeId: string,
  assessorId: string,
  fields: Partial<{ assessedOn: string; total: number; passed: boolean | null; feedback: string; createdAt: Date; caseLogId: string; procedure: string }> = {},
): Row {
  const definition = WPBA_FORMS[type]
  const rating = DEFAULTS[type].rating
  return fakePrisma.seed('nutritionWpba', {
    type,
    formVersion: 1,
    traineeId,
    assessorId,
    caseLogId: fields.caseLogId ?? null,
    procedure: fields.procedure ?? (type === 'DOPS' ? 'growth_plotting' : null),
    scores: { ratings: Object.fromEntries(itemKeys(type).map((key) => [key, rating])), ...(type === 'OSCE' ? { failReasons: [] } : {}) },
    total: fields.total ?? rating * itemKeys(type).length,
    maxScore: definition.maxScore,
    passed: fields.passed ?? (type === 'OSCE' ? true : null),
    criticalError: type === 'OSCE' ? false : null,
    millerLevel: definition.millerLevel,
    feedback: fields.feedback ?? 'Seeded feedback.',
    assessedOn: new Date(`${fields.assessedOn ?? TODAY}T00:00:00Z`),
    createdBy: 'auth-seed',
    ...(fields.createdAt ? { createdAt: fields.createdAt } : {}),
  })
}
