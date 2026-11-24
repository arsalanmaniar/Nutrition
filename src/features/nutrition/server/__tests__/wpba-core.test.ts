import type { WpbaType } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { DOPS_OTHER_PROCEDURE, DOPS_PROCEDURES, MILLER_EPA_TARGETS, WPBA_FORMS } from '../../config/forms'
import { osceOutcome, procedureForAudit, procedureLabel, scoreWpba, wpbaAuditSnapshot, wpbaScorecard } from '../wpba-core'

// Pure WPBA scoring from config (Step 5a): every type, the OSCE pass rule with
// its whole-number boundary, and what the audit row and the scorecard hold.

const keys = (type: WpbaType) => WPBA_FORMS[type].sections.flatMap((s) => s.items.map((i) => i.key))
const rate = (type: WpbaType, values: number | readonly number[]) =>
  Object.fromEntries(keys(type).map((key, i) => [key, typeof values === 'number' ? values : values[i]]))

describe('the WPBA config (5a)', () => {
  it('CbD: the five default questions, 1-5, out of 25, with "Feedback and agreed action" and a pending note', () => {
    const cbd = WPBA_FORMS.CBD
    expect(cbd.sections.flatMap((s) => s.items.map((i) => i.label))).toEqual([
      'Assessment (anthropometric, biochemical, clinical, dietary data)',
      'Nutrition diagnosis (identifying and prioritising the problem)',
      'Intervention planning (feeding/nutrition plan)',
      'Monitoring and evaluation (outcomes, adjusting the plan)',
      'Overall clinical judgment',
    ])
    expect(cbd.sections.every((s) => s.scale.min === 1 && s.scale.max === 5)).toBe(true)
    expect(cbd.maxScore).toBe(25)
    expect(cbd.freeText).toEqual([{ key: 'feedback', label: 'Feedback and agreed action', optional: false }])
    expect(cbd.pending).toBe("Default CbD questions; replace with the program's own")
  })

  it('Mini-CEX 5 x 1-9 = 45; DOPS one 1-5 rating per procedure, still pending; OSCE 5 x 1-5 = 25 with the 70% rule; nothing bumped', () => {
    expect([keys('MINI_CEX').length, WPBA_FORMS.MINI_CEX.sections[0].scale, WPBA_FORMS.MINI_CEX.maxScore]).toEqual([5, { min: 1, max: 9 }, 45])
    expect([keys('DOPS'), WPBA_FORMS.DOPS.maxScore, Boolean(WPBA_FORMS.DOPS.pending)]).toEqual([['overall'], 5, true])
    expect(WPBA_FORMS.DOPS.sections[0].scale.anchors?.[1]).toBe('Unsafe / direct instruction')
    expect([keys('OSCE').length, WPBA_FORMS.OSCE.maxScore, WPBA_FORMS.OSCE.passRule]).toEqual([5, 25, { minPercent: 70, noCriticalError: true }])
    expect(Object.values(WPBA_FORMS).map((form) => form.version)).toEqual([1, 1, 1, 1])
    expect(DOPS_PROCEDURES.map((p) => p.key)).toEqual(['tube_feeding_calculation', 'growth_plotting', 'diet_formulation'])
    expect(DOPS_OTHER_PROCEDURE.key).toBe('other')
  })
})

describe('scoreWpba', () => {
  // [type, ratings, total, maxScore, Miller level]
  it.each([
    ['MINI_CEX', 9, 45, 45, 'SHOWS_HOW'],
    ['MINI_CEX', 1, 5, 45, 'SHOWS_HOW'],
    ['MINI_CEX', [9, 7, 5, 3, 1], 25, 45, 'SHOWS_HOW'],
    ['DOPS', 3, 3, 5, 'DOES'],
    ['CBD', [5, 4, 3, 4, 5], 21, 25, 'KNOWS_HOW'],
    ['OSCE', 5, 25, 25, 'SHOWS_HOW'],
  ] as const)('%s %j: total %i of %i, at %s, with the EPA range from MILLER_EPA_TARGETS', (type, values, total, maxScore, millerLevel) => {
    const result = scoreWpba(type, rate(type, values), false)
    expect(result).toMatchObject({ ok: true, score: { total, maxScore, millerLevel, suggestedEpa: MILLER_EPA_TARGETS[millerLevel] } })
  })

  it('the other types have no pass or fail, and ignore a critical-error flag', () => {
    for (const type of ['MINI_CEX', 'DOPS', 'CBD'] as const) {
      expect(scoreWpba(type, rate(type, 1), true)).toMatchObject({ ok: true, score: { passed: null, criticalError: null, failReasons: [] } })
    }
  })

  // [OSCE ratings, critical error, total, passed, reasons]
  it.each([
    [[4, 4, 4, 3, 3], false, 18, true, []],
    [[4, 4, 3, 3, 3], false, 17, false, ['BELOW_PASS_MARK']],
    [[5, 5, 5, 5, 5], false, 25, true, []],
    [[1, 1, 1, 1, 1], false, 5, false, ['BELOW_PASS_MARK']],
    [[5, 5, 5, 5, 5], true, 25, false, ['CRITICAL_ERROR']],
    [[4, 4, 4, 3, 3], true, 18, false, ['CRITICAL_ERROR']],
    [[4, 4, 3, 3, 3], true, 17, false, ['BELOW_PASS_MARK', 'CRITICAL_ERROR']],
  ] as const)('OSCE %j with critical error %s: %i/25, passed %s, %j', (values, critical, total, passed, failReasons) => {
    expect(scoreWpba('OSCE', rate('OSCE', values), critical)).toMatchObject({ ok: true, score: { total, passed, criticalError: critical, failReasons } })
  })

  it('the pass mark is total * 100 >= 70 * maxScore in whole numbers: exactly 70% passes, a point less fails; 17.5/25 cannot occur', () => {
    const rule = { minPercent: 70, noCriticalError: true }
    expect(osceOutcome(35, 50, false, rule)).toEqual({ passed: true, failReasons: [] })
    expect(osceOutcome(34, 50, false, rule)).toEqual({ passed: false, failReasons: ['BELOW_PASS_MARK'] })
    expect(osceOutcome(17, 25, false, rule)).toEqual({ passed: false, failReasons: ['BELOW_PASS_MARK'] })
    expect(osceOutcome(18, 25, false, rule)).toEqual({ passed: true, failReasons: [] })
    expect(osceOutcome(25, 25, true, rule)).toEqual({ passed: false, failReasons: ['CRITICAL_ERROR'] })
  })

  it.each([
    ['an unknown key', { ...rate('MINI_CEX', 5), total: 45 }, 'total:UNKNOWN_ITEM'],
    ['a 10 on the 9-point scale', { ...rate('MINI_CEX', 5), clinical_reasoning: 10 }, 'clinical_reasoning:OUT_OF_RANGE'],
    ['a 0', { ...rate('MINI_CEX', 5), clinical_reasoning: 0 }, 'clinical_reasoning:OUT_OF_RANGE'],
    ['a fraction', { ...rate('MINI_CEX', 5), clinical_reasoning: 4.5 }, 'clinical_reasoning:NOT_A_WHOLE_NUMBER'],
    ['a string', { ...rate('MINI_CEX', 5), clinical_reasoning: '4' }, 'clinical_reasoning:NOT_A_WHOLE_NUMBER'],
    ['a missing item', Object.fromEntries(Object.entries(rate('MINI_CEX', 5)).slice(1)), 'medical_interviewing:MISSING'],
  ])('refuses %s', (_label, ratings, problem) => {
    const result = scoreWpba('MINI_CEX', ratings, false)
    expect(result.ok ? [] : result.errors.map((e) => `${e.key}:${e.problem}`)).toEqual([problem])
  })

  it.each([null, [], 'x', Object.create({ overall: 3 })])('refuses ratings that are not a plain object (%j)', (ratings) => {
    expect(scoreWpba('DOPS', ratings, false)).toEqual({ ok: false, errors: [{ key: '', problem: 'NOT_AN_OBJECT' }] })
  })
})

describe('audit snapshot, procedure and scorecard', () => {
  const row = {
    id: 'w1',
    type: 'DOPS' as const,
    formVersion: 1,
    traineeId: 't1',
    assessorId: 'a1',
    rotationEntryId: null,
    caseLogId: null,
    procedure: 'Nasogastric tube check',
    assessedOn: new Date('2026-04-15T00:00:00Z'),
    total: 4,
    maxScore: 5,
    passed: null,
    criticalError: null,
    millerLevel: 'DOES' as const,
  }

  it('the audit snapshot: ids, type, date, totals and result; the "other" description only as "other"', () => {
    expect(wpbaAuditSnapshot(row)).toEqual({ ...row, procedure: 'other', assessedOn: '2026-04-15' })
    expect(wpbaAuditSnapshot({ ...row, procedure: 'growth_plotting' }).procedure).toBe('growth_plotting')
  })

  it('procedure labels and audit values', () => {
    expect([procedureLabel('growth_plotting'), procedureLabel('Bedside swallow screen'), procedureLabel(null)]).toEqual([
      'Growth plotting',
      'Other: Bedside swallow screen',
      null,
    ])
    expect([procedureForAudit('diet_formulation'), procedureForAudit('Bedside swallow screen'), procedureForAudit(null)]).toEqual(['diet_formulation', 'other', null])
  })

  it('the scorecard takes the latest by date assessed, then by filing time, and the highest Miller level', () => {
    const at = (day: string, minute = 0) => ({ assessedOn: new Date(`${day}T00:00:00Z`), createdAt: new Date(`2026-04-15T08:${String(minute).padStart(2, '0')}:00Z`) })
    const card = wpbaScorecard([
      { type: 'CBD', ...at('2026-04-01'), total: 15, maxScore: 25, passed: null, millerLevel: 'KNOWS_HOW' },
      { type: 'CBD', ...at('2026-04-03', 1), total: 20, maxScore: 25, passed: null, millerLevel: 'KNOWS_HOW' },
      { type: 'CBD', ...at('2026-04-03', 0), total: 10, maxScore: 25, passed: null, millerLevel: 'KNOWS_HOW' },
      { type: 'OSCE', ...at('2026-04-02'), total: 18, maxScore: 25, passed: true, millerLevel: 'SHOWS_HOW' },
    ])
    expect(card.types.find((t) => t.type === 'CBD')).toEqual({ type: 'CBD', title: 'CbD', count: 3, latest: { assessedOn: '2026-04-03', total: 20, maxScore: 25, passed: null } })
    expect([card.highestMillerLevel, card.highestMillerLabel]).toEqual(['SHOWS_HOW', 'Shows How'])
  })
})
