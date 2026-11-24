import type { EvaluationFormType, SubmissionStatus } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { assessmentPoint } from '../assessment-point'
import { dueForms, type DueForm, type ExistingForm, type Schedule } from '../scheduler'

// Training starts on 1 January 2026 unless a test says otherwise. `at(day)`
// is noon in Karachi on that day.
const START = new Date('2026-01-01T00:00:00Z')
const trainee = { trainingStartDate: START }
const at = (day: string) => new Date(`${day}T07:00:00Z`)
const existing = (formType: EvaluationFormType, point: string, status: SubmissionStatus = 'SUBMITTED'): ExistingForm => ({
  formType,
  assessmentPoint: point,
  status,
})

/** Every form of every period before training month `month` and week `week`, submitted. */
function submittedBefore(week: number, month: number): ExistingForm[] {
  const forms: ExistingForm[] = []
  for (let w = 1; w < week; w++) forms.push(existing('WEEKLY', assessmentPoint('WEEK', w)))
  for (let m = 1; m < month; m++) {
    const point = assessmentPoint('MONTH', m)
    forms.push(existing('FORM_1_1', point), existing('FORM_3_1', point))
    if ([4, 8, 12].includes(m)) forms.push(existing('FORM_1_2', point), existing('FORM_1_3', point))
  }
  return forms
}

/** "FORM_1_1 M01 NOT_STARTED due 2026-01-31", with " OVERDUE" when it is. */
const brief = (form: DueForm) => `${form.formType} ${form.assessmentPoint} ${form.status} due ${form.dueBy}${form.overdue ? ' OVERDUE' : ''}`
const forms = (schedule: Schedule) => ('forms' in schedule ? schedule.forms : [])

describe('dueForms: nothing is due outside training', () => {
  it('a trainee with no start date: "start date not set"', () => {
    expect(dueForms({ trainingStartDate: null }, at('2026-03-01'), [])).toEqual({ state: 'START_DATE_NOT_SET' })
  })

  it.each([
    ['2026-11-01', '2026-10-31'],
    ['2026-11-01', '2026-01-15'],
  ])('a start date in the future (%s, now %s): not started yet', (start, today) => {
    expect(dueForms({ trainingStartDate: new Date(`${start}T00:00:00Z`) }, at(today), [])).toEqual({ state: 'NOT_STARTED', startsOn: start })
  })
})

describe('dueForms: the current period', () => {
  it('day 0: the week 1 check-in, and Forms 1.1 and 3.1 for month 1', () => {
    const schedule = dueForms(trainee, at('2026-01-01'), [])
    expect(schedule).toMatchObject({ state: 'IN_TRAINING', week: 1, month: 1 })
    expect(forms(schedule)).toEqual([
      { formType: 'WEEKLY', assessmentPoint: 'W01', monthNumber: 1, filledBy: 'TRAINEE', dueBy: '2026-01-07', status: 'NOT_STARTED', overdue: false },
      { formType: 'FORM_1_1', assessmentPoint: 'M01', monthNumber: 1, filledBy: 'TRAINEE', dueBy: '2026-01-31', status: 'NOT_STARTED', overdue: false },
      { formType: 'FORM_3_1', assessmentPoint: 'M01', monthNumber: 1, filledBy: 'PRECEPTOR', dueBy: '2026-01-31', status: 'NOT_STARTED', overdue: false },
    ])
  })

  // [training month, a day in it, the week of that day]
  it.each([
    [1, '2026-01-15', 3],
    [2, '2026-02-15', 7],
    [3, '2026-03-15', 11],
    [4, '2026-04-15', 15],
    [5, '2026-05-15', 20],
    [6, '2026-06-15', 24],
    [7, '2026-07-15', 28],
    [8, '2026-08-15', 33],
    [9, '2026-09-15', 37],
    [10, '2026-10-15', 42],
    [11, '2026-11-15', 46],
    [12, '2026-12-15', 50],
  ])('month %i: Forms 1.2 and 1.3 are due only in Months 4, 8 and 12', (month, day, week) => {
    const schedule = dueForms(trainee, at(day), submittedBefore(week, month))
    expect(schedule).toMatchObject({ state: 'IN_TRAINING', week, month })
    const point = assessmentPoint('MONTH', month)
    const monthly = ['FORM_1_1', 'FORM_3_1']
    const due = [4, 8, 12].includes(month) ? ['FORM_1_1', 'FORM_1_2', 'FORM_1_3', 'FORM_3_1'] : monthly
    expect(forms(schedule).map((form) => `${form.formType} ${form.assessmentPoint}`)).toEqual([
      `WEEKLY ${assessmentPoint('WEEK', week)}`,
      ...due.map((type) => `${type} ${point}`),
    ])
    expect(forms(schedule).every((form) => !form.overdue && form.status === 'NOT_STARTED')).toBe(true)
  })

  it('Form 1.2 is the preceptor\'s and Form 1.3 the trainee\'s, both due by the end of Month 4', () => {
    const due = forms(dueForms(trainee, at('2026-04-15'), submittedBefore(15, 4)))
    expect(due.find((form) => form.formType === 'FORM_1_2')).toMatchObject({ filledBy: 'PRECEPTOR', dueBy: '2026-04-30', monthNumber: 4 })
    expect(due.find((form) => form.formType === 'FORM_1_3')).toMatchObject({ filledBy: 'TRAINEE', dueBy: '2026-04-30', monthNumber: 4 })
  })

  // [rows for the current WEEKLY W01, expected status]
  it.each([
    [[], 'NOT_STARTED'],
    [['DRAFT'], 'DRAFT'],
    [['SUBMITTED'], 'SUBMITTED'],
    [['APPROVED'], 'SUBMITTED'],
    [['REJECTED'], 'DRAFT'],
    [['DRAFT', 'SUBMITTED'], 'SUBMITTED'],
  ] as const)('a current form with rows %j is %s, and never overdue', (statuses, expected) => {
    const rows = statuses.map((status) => existing('WEEKLY', 'W01', status))
    const weekly = forms(dueForms(trainee, at('2026-01-03'), rows)).find((form) => form.formType === 'WEEKLY')
    expect(weekly).toMatchObject({ assessmentPoint: 'W01', status: expected, overdue: false })
  })

  it('only a row of the same type and the same period counts', () => {
    const rows = [existing('FORM_1_1', 'M02'), existing('WEEKLY', 'W02'), existing('FORM_3_1', 'W01')]
    expect(forms(dueForms(trainee, at('2026-01-03'), rows)).map((form) => form.status)).toEqual(['NOT_STARTED', 'NOT_STARTED', 'NOT_STARTED'])
  })

  it('the last day of training is in week 53: a one-day check-in, due that day', () => {
    const schedule = dueForms(trainee, at('2026-12-31'), submittedBefore(53, 12))
    expect(schedule).toMatchObject({ state: 'IN_TRAINING', week: 53, month: 12 })
    expect(forms(schedule).find((form) => form.formType === 'WEEKLY')).toEqual({
      formType: 'WEEKLY',
      assessmentPoint: 'W53',
      monthNumber: 12,
      filledBy: 'TRAINEE',
      dueBy: '2026-12-31',
      status: 'NOT_STARTED',
      overdue: false,
    })
  })

  it("a weekly form's monthNumber is the training month of the week's first day", () => {
    // Week 5 is 29 Jan - 4 Feb (month 1 starts it); week 6 starts on 5 Feb (month 2).
    const currentWeekly = (day: string, week: number) =>
      forms(dueForms(trainee, at(day), submittedBefore(week, 2))).find((form) => form.formType === 'WEEKLY' && !form.overdue)
    expect(currentWeekly('2026-02-03', 5)).toMatchObject({ assessmentPoint: 'W05', monthNumber: 1 })
    expect(currentWeekly('2026-02-05', 6)).toMatchObject({ assessmentPoint: 'W06', monthNumber: 2 })
  })

  it('months follow the same-day-of-month rule: from 31 January, month 1 ends on 27 February', () => {
    const schedule = dueForms({ trainingStartDate: new Date('2026-01-31T00:00:00Z') }, at('2026-02-27'), submittedBefore(4, 1))
    expect(schedule).toMatchObject({ state: 'IN_TRAINING', week: 4, month: 1 })
    // Same due date: config order (forms.ts) breaks the tie.
    expect(forms(schedule).map(brief)).toEqual([
      'FORM_1_1 M01 NOT_STARTED due 2026-02-27',
      'FORM_3_1 M01 NOT_STARTED due 2026-02-27',
      'WEEKLY W04 NOT_STARTED due 2026-02-27',
    ])
  })
})

describe('dueForms: overdue forms', () => {
  it('a past period with no submitted form stays on the list, overdue, oldest first', () => {
    const rows = [existing('WEEKLY', 'W01', 'DRAFT'), existing('WEEKLY', 'W02')]
    expect(forms(dueForms(trainee, at('2026-01-22'), rows)).map(brief)).toEqual([
      'WEEKLY W01 DRAFT due 2026-01-07 OVERDUE',
      'WEEKLY W03 NOT_STARTED due 2026-01-21 OVERDUE',
      'WEEKLY W04 NOT_STARTED due 2026-01-28',
      'FORM_1_1 M01 NOT_STARTED due 2026-01-31',
      'FORM_3_1 M01 NOT_STARTED due 2026-01-31',
    ])
  })

  it('a checkpoint form not submitted by the end of Month 4 is overdue in Month 5', () => {
    const rows = submittedBefore(20, 5).filter((form) => form.formType !== 'FORM_1_3')
    expect(forms(dueForms(trainee, at('2026-05-15'), rows)).map(brief)).toEqual([
      'FORM_1_3 M04 NOT_STARTED due 2026-04-30 OVERDUE',
      'WEEKLY W20 NOT_STARTED due 2026-05-20',
      'FORM_1_1 M05 NOT_STARTED due 2026-05-31',
      'FORM_3_1 M05 NOT_STARTED due 2026-05-31',
    ])
  })

  it('the week turns at midnight in Karachi: 23:59:59 on day 6 is still week 1', () => {
    const lastSecond = dueForms(trainee, new Date('2026-01-07T18:59:59Z'), [])
    const nextDay = dueForms(trainee, new Date('2026-01-07T19:00:00Z'), [])
    expect(lastSecond).toMatchObject({ week: 1 })
    expect(forms(lastSecond).filter((form) => form.overdue)).toEqual([])
    expect(nextDay).toMatchObject({ week: 2 })
    expect(forms(nextDay).filter((form) => form.overdue).map(brief)).toEqual(['WEEKLY W01 NOT_STARTED due 2026-01-07 OVERDUE'])
  })

  it('after month 12: finished, and only the forms still owed remain', () => {
    expect(dueForms(trainee, at('2027-01-01'), submittedBefore(54, 13))).toEqual({ state: 'FINISHED', forms: [] })

    const owed = dueForms(trainee, at('2027-03-01'), [])
    expect(owed.state).toBe('FINISHED')
    // 53 check-ins, Forms 1.1 and 3.1 for 12 months, Forms 1.2 and 1.3 at 3 checkpoints.
    expect(forms(owed)).toHaveLength(53 + 12 * 2 + 3 * 2)
    expect(forms(owed).every((form) => form.overdue && form.status === 'NOT_STARTED')).toBe(true)
  })
})
