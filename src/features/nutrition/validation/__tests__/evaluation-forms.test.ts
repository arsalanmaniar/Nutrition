import { describe, expect, it } from 'vitest'
import { EVALUATION_FORMS } from '../../config/forms'
import {
  parseAnswers,
  startOwnFormSchema,
  startTraineeFormSchema,
  storedAnswers,
  weeklyCommentSchema,
} from '../evaluation-forms'

const all = (formType: keyof typeof EVALUATION_FORMS, value: string) =>
  Object.fromEntries(EVALUATION_FORMS[formType].sections.flatMap((s) => s.items.map((i) => [`rating.${i.key}`, value])))
const errors = (result: ReturnType<typeof parseAnswers>) =>
  result.success ? {} : Object.fromEntries(result.error.issues.map((issue) => [String(issue.path[0]), issue.message]))

describe('parseAnswers', () => {
  it('a draft may be empty or half-filled; values are trimmed and blank ratings skipped', () => {
    expect(parseAnswers({}, 'FORM_1_1', 'draft')).toEqual({ success: true, answers: { ratings: {}, text: {} }, score: null })
    expect(parseAnswers({ 'rating.relevance': ' 4 ', 'rating.time_adequacy': '', 'text.worked_well': '  Ward rounds.  ' }, 'FORM_1_1', 'draft')).toEqual({
      success: true,
      answers: { ratings: { relevance: 4 }, text: { worked_well: 'Ward rounds.' } },
      score: null,
    })
  })

  it('submit: every item rated and every required text; scored by scoring.ts', () => {
    const result = parseAnswers({ ...all('FORM_3_1', '5') }, 'FORM_3_1', 'submit')
    expect(result).toMatchObject({ success: true, score: { total: 30, maxScore: 30, percentage: 100 } })
    expect(errors(parseAnswers({}, 'FORM_3_1', 'submit'))).toMatchObject({ 'rating.clinical_knowledge': 'Rate this to submit.' })
    expect(errors(parseAnswers({}, 'WEEKLY', 'submit'))).toEqual({
      'text.cases_this_week': 'Fill this in to submit.',
      'text.progress_vs_objectives': 'Fill this in to submit.',
      'text.difficulties_supervision': 'Fill this in to submit.',
      'text.plan_next_week': 'Fill this in to submit.',
    })
    // Optional comments may stay empty.
    expect(parseAnswers(all('FORM_1_3', '0'), 'FORM_1_3', 'submit')).toMatchObject({ success: true, score: { total: 0, maxScore: 132 } })
  })

  it.each([
    ['an unknown item', { 'rating.nope': '3' }, 'rating.nope', 'This is not an item of this form.'],
    ['a decimal', { 'rating.relevance': '3.5' }, 'rating.relevance', 'Pick a rating from the scale.'],
    ['a word', { 'rating.relevance': 'five' }, 'rating.relevance', 'Pick a rating from the scale.'],
    ['out of range', { 'rating.relevance': '9' }, 'rating.relevance', 'Pick a rating from the scale.'],
    ['an unknown text field', { 'text.nope': 'x' }, 'text.nope', 'This is not a field of this form.'],
    ['an email address', { 'text.worked_well': 'mail me: a.b@example.com' }, 'text.worked_well', expect.stringContaining('email address')],
    ['an MRN-like number', { 'text.could_improve': 'patient 12345678' }, 'text.could_improve', expect.stringContaining('ID number')],
    ['too long', { 'text.worked_well': 'x'.repeat(2001) }, 'text.worked_well', 'Keep this under 2000 characters.'],
  ])('refuses %s, even in a draft', (_label, fields, name, message) => {
    expect(errors(parseAnswers(fields, 'FORM_1_1', 'draft'))).toEqual({ [name]: message })
  })

  it('ignores everything that is not a rating.* or text.* field: point, totals, status, ids', () => {
    expect(
      parseAnswers(
        { assessmentPoint: 'M12', totalScore: '50', maxScore: '50', status: 'SUBMITTED', subjectId: 'x', formId: 'y', 'rating.relevance': '4' },
        'FORM_1_1',
        'draft',
      ),
    ).toEqual({ success: true, answers: { ratings: { relevance: 4 }, text: {} }, score: null })
  })
})

describe('storedAnswers', () => {
  it.each([null, 'x', [], { ratings: 'x', text: 3 }])('reads %j as empty', (value) => {
    expect(storedAnswers(value)).toEqual({ ratings: {}, text: {} })
  })

  it('keeps only number ratings and string texts', () => {
    expect(storedAnswers({ ratings: { a: 3, b: '4' }, text: { c: 'ok', d: 5 } })).toEqual({ ratings: { a: 3 }, text: { c: 'ok' } })
  })
})

describe('start and comment schemas', () => {
  it.each(['FORM_1_2', 'FORM_3_1', 'FORM_1_3', ''])('the trainee may not start %j with the generic action', (formType) => {
    expect(startOwnFormSchema.safeParse({ formType }).success).toBe(false)
  })

  it.each(['WEEKLY', 'FORM_1_1', 'FORM_1_3'])('the preceptor may not start %s', (formType) => {
    expect(startTraineeFormSchema.safeParse({ formType, traineeId: '6f1c2b8e-4a3d-4f5e-9b7a-1c2d3e4f5a6b' }).success).toBe(false)
  })

  it('a weekly comment is trimmed, required and identifier-checked', () => {
    const formId = '6f1c2b8e-4a3d-4f5e-9b7a-1c2d3e4f5a6b'
    expect(weeklyCommentSchema.parse({ formId, comment: '  Good week.  ' })).toEqual({ formId, comment: 'Good week.' })
    expect(weeklyCommentSchema.safeParse({ formId, comment: '   ' }).success).toBe(false)
    expect(weeklyCommentSchema.safeParse({ formId, comment: 'ring 0321-1234567' }).success).toBe(false)
  })
})
