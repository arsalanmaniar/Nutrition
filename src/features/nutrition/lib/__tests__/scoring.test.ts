import type { EvaluationFormType } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { EVALUATION_FORMS } from '../../config/forms'
import { ratingErrors, scoreForm, type RatingProblem } from '../scoring'

const TYPES = Object.keys(EVALUATION_FORMS) as EvaluationFormType[]
const itemKeys = (type: EvaluationFormType) => EVALUATION_FORMS[type].sections.flatMap((section) => section.items.map((item) => item.key))

/** Every item rated: one value for all, or values in item order. */
function rate(type: EvaluationFormType, values: number | readonly number[]): Record<string, number> {
  const keys = itemKeys(type)
  if (Array.isArray(values) && values.length !== keys.length) throw new Error(`${type} has ${keys.length} items`)
  return Object.fromEntries(keys.map((key, i) => [key, typeof values === 'number' ? values : (values as readonly number[])[i]]))
}

const problems = (type: EvaluationFormType, ratings: unknown) => {
  const result = scoreForm(type, ratings)
  return result.ok ? [] : result.errors.map((error) => `${error.key}:${error.problem}`)
}

describe('the form config scoring relies on', () => {
  it.each(TYPES)('%s: item keys are unique, apart from the free-text keys, and the maxima add up', (type) => {
    const form = EVALUATION_FORMS[type]
    const keys = itemKeys(type)
    expect(new Set(keys).size).toBe(keys.length)
    for (const field of form.freeText) expect(keys).not.toContain(field.key)
    for (const section of form.sections) expect(section.maxScore).toBe(section.items.length * section.scale.max)
    expect(form.maxScore).toBe(form.sections.reduce((sum, section) => sum + section.maxScore, 0))
  })
})

describe('scoreForm: totals are computed here, from the ratings alone', () => {
  it('Form 1.3: 44 items in 5 groups (8, 12, 7, 8, 9), Always 3 to Never 0, max 132', () => {
    const form = EVALUATION_FORMS.FORM_1_3
    expect(form.sections.map((section) => section.items.length)).toEqual([8, 12, 7, 8, 9])
    expect(form.sections.every((section) => section.scale.min === 0 && section.scale.max === 3)).toBe(true)

    expect(scoreForm('FORM_1_3', rate('FORM_1_3', 3))).toEqual({
      ok: true,
      score: {
        sections: [
          { key: 'organized_focused', total: 24, maxScore: 24 },
          { key: 'values_interaction', total: 36, maxScore: 36 },
          { key: 'relates_well', total: 21, maxScore: 21 },
          { key: 'teaching_strategies', total: 24, maxScore: 24 },
          { key: 'professional_competence', total: 27, maxScore: 27 },
        ],
        total: 132,
        maxScore: 132,
        percentage: 100,
      },
    })
    // Never (0) is a real answer on this scale.
    expect(scoreForm('FORM_1_3', rate('FORM_1_3', 0))).toMatchObject({ ok: true, score: { total: 0, maxScore: 132, percentage: 0 } })
    // 0, 1, 2, 3, 0, 1, ... across the 44 items.
    const cycling = itemKeys('FORM_1_3').map((_, i) => i % 4)
    expect(scoreForm('FORM_1_3', rate('FORM_1_3', cycling))).toMatchObject({
      ok: true,
      score: { sections: [{ total: 12 }, { total: 18 }, { total: 9 }, { total: 12 }, { total: 15 }], total: 66, percentage: 50 },
    })
    // 88 / 132 = 66.666...%, shown to one decimal place.
    expect(scoreForm('FORM_1_3', rate('FORM_1_3', 2))).toMatchObject({ ok: true, score: { total: 88, percentage: 66.7 } })
  })

  it('Form 3.1 MDGRS: 6 domains rated 1-5, total /30', () => {
    expect(itemKeys('FORM_3_1')).toHaveLength(6)
    expect(scoreForm('FORM_3_1', rate('FORM_3_1', [5, 4, 3, 4, 5, 3]))).toEqual({
      ok: true,
      score: { sections: [{ key: 'domains', total: 24, maxScore: 30 }], total: 24, maxScore: 30, percentage: 80 },
    })
    expect(scoreForm('FORM_3_1', rate('FORM_3_1', 1))).toMatchObject({ ok: true, score: { total: 6, percentage: 20 } })
    expect(scoreForm('FORM_3_1', rate('FORM_3_1', 5))).toMatchObject({ ok: true, score: { total: 30, percentage: 100 } })
  })

  it('Form 1.1: Part A and Part B, 5 items each rated 1-5, max 25 each and 50 in all', () => {
    expect(scoreForm('FORM_1_1', rate('FORM_1_1', [4, 4, 3, 5, 4, 3, 4, 4, 2, 5]))).toEqual({
      ok: true,
      score: {
        sections: [
          { key: 'part_a', total: 20, maxScore: 25 },
          { key: 'part_b', total: 18, maxScore: 25 },
        ],
        total: 38,
        maxScore: 50,
        percentage: 76,
      },
    })
  })

  it('Form 1.2: 10 areas rated 1-5, max 50', () => {
    expect(itemKeys('FORM_1_2')).toHaveLength(10)
    expect(scoreForm('FORM_1_2', rate('FORM_1_2', 4))).toMatchObject({ ok: true, score: { total: 40, maxScore: 50, percentage: 80 } })
    expect(scoreForm('FORM_1_2', rate('FORM_1_2', [5, 4, 3, 2, 1, 5, 4, 3, 2, 1]))).toEqual({
      ok: true,
      score: { sections: [{ key: 'areas', total: 30, maxScore: 50 }], total: 30, maxScore: 50, percentage: 60 },
    })
  })

  it('the weekly check-in is unscored: no score, and no rating is accepted for it', () => {
    expect(scoreForm('WEEKLY', {})).toEqual({ ok: true, score: null })
    expect(problems('WEEKLY', { cases_this_week: 3 })).toEqual(['cases_this_week:UNKNOWN_ITEM'])
  })
})

describe("scoreForm: refuses anything but whole numbers on the scale, for the form's own items", () => {
  // The rating is given to the form's first item; `shown` names it in the test title.
  it.each([
    { type: 'FORM_3_1', value: 0, shown: '0', problem: 'OUT_OF_RANGE' },
    { type: 'FORM_3_1', value: 6, shown: '6', problem: 'OUT_OF_RANGE' },
    { type: 'FORM_1_1', value: 0, shown: '0', problem: 'OUT_OF_RANGE' },
    { type: 'FORM_1_2', value: 6, shown: '6', problem: 'OUT_OF_RANGE' },
    { type: 'FORM_1_3', value: -1, shown: '-1', problem: 'OUT_OF_RANGE' },
    { type: 'FORM_1_3', value: 4, shown: '4', problem: 'OUT_OF_RANGE' },
    { type: 'FORM_3_1', value: 3.5, shown: '3.5', problem: 'NOT_A_WHOLE_NUMBER' },
    { type: 'FORM_3_1', value: '3', shown: 'the string "3"', problem: 'NOT_A_WHOLE_NUMBER' },
    { type: 'FORM_3_1', value: null, shown: 'null', problem: 'NOT_A_WHOLE_NUMBER' },
    { type: 'FORM_3_1', value: true, shown: 'true', problem: 'NOT_A_WHOLE_NUMBER' },
    { type: 'FORM_3_1', value: Number.NaN, shown: 'NaN', problem: 'NOT_A_WHOLE_NUMBER' },
    { type: 'FORM_3_1', value: Number.POSITIVE_INFINITY, shown: 'Infinity', problem: 'NOT_A_WHOLE_NUMBER' },
    { type: 'FORM_3_1', value: [3], shown: 'the array [3]', problem: 'NOT_A_WHOLE_NUMBER' },
    { type: 'FORM_1_3', value: '0', shown: 'the string "0"', problem: 'NOT_A_WHOLE_NUMBER' },
  ] as const)('$type: a rating of $shown is $problem', ({ type, value, problem }: { type: EvaluationFormType; value: unknown; problem: RatingProblem }) => {
    const [first] = itemKeys(type)
    const ratings: Record<string, unknown> = { ...rate(type, EVALUATION_FORMS[type].sections[0].scale.max), [first]: value }
    expect(scoreForm(type, ratings)).toEqual({ ok: false, errors: [expect.objectContaining({ key: first, problem })] })
  })

  it.each([
    ['FORM_3_1', 'total'],
    ['FORM_3_1', 'percentage'],
    ['FORM_3_1', 'maxScore'],
    ['FORM_1_1', 'worked_well'],
    ['FORM_1_1', 'planned_activities_in_advance'],
    ['FORM_1_3', 'preceptor_comments'],
  ] as const)('%s: the key %j is not an item, so it is refused', (type, key) => {
    expect(problems(type, { ...rate(type, 3), [key]: 3 })).toEqual([`${key}:UNKNOWN_ITEM`])
  })

  it('a client-sent total is never used: refused, and the score comes from the ratings', () => {
    expect(problems('FORM_3_1', { ...rate('FORM_3_1', 5), total: 1 })).toEqual(['total:UNKNOWN_ITEM'])
    expect(scoreForm('FORM_3_1', rate('FORM_3_1', 5))).toMatchObject({ ok: true, score: { total: 30 } })
  })

  it('a "__proto__" key from parsed JSON is just an unknown item', () => {
    const ratings = JSON.parse(`{"__proto__": 5, ${itemKeys('FORM_3_1').map((key) => `"${key}": 4`).join(', ')}}`) as unknown
    expect(problems('FORM_3_1', ratings)).toEqual(['__proto__:UNKNOWN_ITEM'])
  })

  it('every item must be rated to be scored', () => {
    const ratings: Record<string, number> = rate('FORM_1_2', 4)
    delete ratings.teamwork
    delete ratings.critical_thinking
    expect(problems('FORM_1_2', ratings)).toEqual(['teamwork:MISSING', 'critical_thinking:MISSING'])
  })

  it('reports every problem at once: unknown keys first, then items in form order', () => {
    const ratings: Record<string, unknown> = { ...rate('FORM_3_1', 3), extra: 1, technical_skills: 9, communication: 'x' }
    delete ratings.overall_clinical_judgment
    expect(problems('FORM_3_1', ratings)).toEqual([
      'extra:UNKNOWN_ITEM',
      'technical_skills:OUT_OF_RANGE',
      'communication:NOT_A_WHOLE_NUMBER',
      'overall_clinical_judgment:MISSING',
    ])
  })

  it.each([null, undefined, [], 'ratings', 42, new Map([['clinical_knowledge', 5]])])('ratings that are not a plain object (%j) are refused', (ratings) => {
    expect(problems('FORM_3_1', ratings)).toEqual([':NOT_AN_OBJECT'])
  })

  it('inherited properties are not ratings', () => {
    const inherited = Object.create(rate('FORM_3_1', 5)) as unknown
    expect(problems('FORM_3_1', inherited)).toEqual([':NOT_AN_OBJECT'])
  })
})

describe('ratingErrors for a draft (requireAll: false)', () => {
  it('a half-filled draft is fine; out-of-range and unknown keys are still refused', () => {
    expect(ratingErrors('FORM_1_3', { planned_activities_in_advance: 2 }, { requireAll: false })).toEqual([])
    expect(ratingErrors('FORM_1_3', {}, { requireAll: false })).toEqual([])
    expect(
      ratingErrors('FORM_1_3', { planned_activities_in_advance: 7, total: 132 }, { requireAll: false }).map((error) => error.problem),
    ).toEqual(['UNKNOWN_ITEM', 'OUT_OF_RANGE'])
  })

  it('with requireAll: true the same draft is missing its other items', () => {
    const errors = ratingErrors('FORM_1_3', { planned_activities_in_advance: 2 }, { requireAll: true })
    expect(errors).toHaveLength(43)
    expect(errors.every((error) => error.problem === 'MISSING')).toBe(true)
  })
})
