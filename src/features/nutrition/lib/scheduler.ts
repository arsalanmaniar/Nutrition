// The evaluation-form scheduler (plan, Step 4): which forms a trainee owes,
// computed on read from trainingStartDate. No cron and nothing stored: the
// caller passes the trainee, the time and the forms already in the database.
//
// What is due, by each form's cadence in config/forms.ts:
//  - WEEKLY for the current training week;
//  - FORM_1_1 and FORM_3_1 for the current training month;
//  - FORM_1_2 and FORM_1_3 only in the CHECKPOINT_MONTHS (4, 8 and 12).
// A form is due by the last day of its period (assessment-point.ts has the
// week and month rule). Every period that is over and still has no submitted
// form stays on the list, flagged overdue; a submitted one drops off.
//
// existingForms must be this trainee's forms: the ones about them (WEEKLY,
// 1.1, 1.2, 3.1) plus the Form 1.3 rows they wrote, which store no author, so
// the caller finds those by the trainee's authorHash (server/author-hash.ts).

import type { EvaluationFormType, SubmissionStatus } from '@prisma/client'
import { CHECKPOINT_MONTHS, EVALUATION_FORMS, type EvaluationFormDefinition } from '@/features/nutrition/config/forms'
import {
  LAST_TRAINING_MONTH,
  LAST_TRAINING_WEEK,
  assessmentPoint,
  karachiDay,
  periodDays,
  storedDay,
  trainingPosition,
  type CalendarDay,
  type TrainingPeriod,
} from './assessment-point'

export type DueStatus = 'NOT_STARTED' | 'DRAFT' | 'SUBMITTED'

export interface ScheduledTrainee {
  /** As stored (@db.Date, midnight UTC); null until an admin sets it. */
  readonly trainingStartDate: Date | null
}

export interface ExistingForm {
  readonly formType: EvaluationFormType
  readonly assessmentPoint: string
  readonly status: SubmissionStatus
}

export interface DueForm {
  readonly formType: EvaluationFormType
  readonly assessmentPoint: string
  /** The training month of the period, as NutritionEvaluationForm.monthNumber stores it (a week's first day decides). */
  readonly monthNumber: number
  readonly filledBy: EvaluationFormDefinition['filledBy']
  /** The period's last day. */
  readonly dueBy: CalendarDay
  readonly status: DueStatus
  /** The period is over and the form is still not submitted. */
  readonly overdue: boolean
}

export type Schedule =
  | { readonly state: 'START_DATE_NOT_SET' }
  | { readonly state: 'NOT_STARTED'; readonly startsOn: CalendarDay }
  | { readonly state: 'IN_TRAINING'; readonly week: number; readonly month: number; readonly forms: readonly DueForm[] }
  /** Month 12 is over; only the forms still owed remain. */
  | { readonly state: 'FINISHED'; readonly forms: readonly DueForm[] }

const FORM_TYPES = Object.keys(EVALUATION_FORMS) as EvaluationFormType[]
const withCadence = (cadence: EvaluationFormDefinition['cadence']) => FORM_TYPES.filter((type) => EVALUATION_FORMS[type].cadence === cadence)
const WEEKLY_FORMS = withCadence('WEEKLY')
const MONTHLY_FORMS = withCadence('MONTHLY')
const CHECKPOINT_FORMS = withCadence('CHECKPOINTS')
const isCheckpoint = (month: number) => (CHECKPOINT_MONTHS as readonly number[]).includes(month)

/**
 * SUBMITTED and APPROVED count as submitted. REJECTED, which evaluation forms
 * do not use, counts as a draft: the form is back with its author.
 */
function statusOf(existing: readonly ExistingForm[], formType: EvaluationFormType, point: string): DueStatus {
  const rows = existing.filter((form) => form.formType === formType && form.assessmentPoint === point)
  if (rows.some((form) => form.status === 'SUBMITTED' || form.status === 'APPROVED')) return 'SUBMITTED'
  return rows.length > 0 ? 'DRAFT' : 'NOT_STARTED'
}

/** What the trainee owes at `now`: the current period's forms, then every earlier one not yet submitted. */
export function dueForms(trainee: ScheduledTrainee, now: Date, existingForms: readonly ExistingForm[]): Schedule {
  if (trainee.trainingStartDate === null) return { state: 'START_DATE_NOT_SET' }
  const start = storedDay(trainee.trainingStartDate)
  const today = karachiDay(now)
  if (today < start) return { state: 'NOT_STARTED', startsOn: start }
  const position = trainingPosition(start, today)

  const forms: DueForm[] = []
  const consider = (formType: EvaluationFormType, period: TrainingPeriod) => {
    const point = assessmentPoint(period.kind, period.number)
    const { first, last } = periodDays(start, period)
    const status = statusOf(existingForms, formType, point)
    const over = today > last
    if (over && status === 'SUBMITTED') return
    forms.push({
      formType,
      assessmentPoint: point,
      monthNumber: period.kind === 'MONTH' ? period.number : (trainingPosition(start, first)?.month ?? LAST_TRAINING_MONTH),
      filledBy: EVALUATION_FORMS[formType].filledBy,
      dueBy: last,
      status,
      overdue: over,
    })
  }

  // After month 12 every period is over: all of them are checked.
  const lastWeek = position?.week ?? LAST_TRAINING_WEEK
  const lastMonth = position?.month ?? LAST_TRAINING_MONTH
  for (let week = 1; week <= lastWeek; week++) {
    for (const formType of WEEKLY_FORMS) consider(formType, { kind: 'WEEK', number: week })
  }
  for (let month = 1; month <= lastMonth; month++) {
    for (const formType of MONTHLY_FORMS) consider(formType, { kind: 'MONTH', number: month })
    if (isCheckpoint(month)) for (const formType of CHECKPOINT_FORMS) consider(formType, { kind: 'MONTH', number: month })
  }

  // Oldest due date first, so overdue forms lead; ties in config order.
  forms.sort((a, b) => a.dueBy.localeCompare(b.dueBy) || FORM_TYPES.indexOf(a.formType) - FORM_TYPES.indexOf(b.formType))
  return position
    ? { state: 'IN_TRAINING', week: position.week, month: position.month, forms }
    : { state: 'FINISHED', forms }
}
