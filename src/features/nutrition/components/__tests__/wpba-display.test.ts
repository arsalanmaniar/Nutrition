import { describe, expect, it } from 'vitest'
import { WPBA_FORMS } from '../../config/forms'
import { osceOutcome } from '../../server/wpba-core'
import { MAX_PROCEDURE_TEXT } from '../../validation/wpba'
import {
  FAIL_REASON_LABELS,
  PROCEDURE_TEXT_MAX,
  assessedOnBounds,
  osceLivePreview,
  passMarkPoints,
  percentLabel,
  resultLabel,
} from '../wpba/wpba-display'

// The WPBA screens' pure display helpers (Step 5b). They decide nothing; the
// server's result is the one stored. The live OSCE preview must still say the
// same as the server would.

describe('percentLabel', () => {
  it.each([
    [18, 25, '72%'],
    [17, 25, '68%'],
    [35, 50, '70%'],
    [40, 45, '88.9%'],
    [1, 3, '33.3%'],
    [2, 3, '66.7%'],
    [0, 25, '0%'],
  ])('%i of %i is %s', (total, maxScore, label) => {
    expect(percentLabel(total, maxScore)).toBe(label)
  })

  it.each([
    [null, 25],
    [18, null],
    [18, 0],
  ])('no label for (%j, %j)', (total, maxScore) => {
    expect(percentLabel(total, maxScore)).toBeNull()
  })
})

describe('passMarkPoints: the fewest whole points that reach the pass mark', () => {
  it.each([
    [70, 25, 18],
    [70, 50, 35],
    [70, 45, 32],
    [70, 5, 4],
  ])('%i percent of %i needs %i', (minPercent, maxScore, points) => {
    expect(passMarkPoints(minPercent, maxScore)).toBe(points)
  })

  it('agrees with the OSCE rule: one point below fails, the pass mark passes', () => {
    const rule = WPBA_FORMS.OSCE.passRule ?? { minPercent: 70, noCriticalError: true }
    const points = passMarkPoints(rule.minPercent, WPBA_FORMS.OSCE.maxScore)
    expect(osceOutcome(points, WPBA_FORMS.OSCE.maxScore, false, rule).passed).toBe(true)
    expect(osceOutcome(points - 1, WPBA_FORMS.OSCE.maxScore, false, rule).passed).toBe(false)
  })
})

describe('osceLivePreview (display only)', () => {
  const five = (values: number[]) => Object.fromEntries(values.map((value, i) => [`c${i}`, value]))

  it('until every criterion is rated it shows progress only', () => {
    expect(osceLivePreview(five([4, 4]), 5, 25, 70, false)).toEqual({
      rated: 2,
      total: 8,
      complete: false,
      percentage: null,
      reachesPassMark: null,
      wouldPass: null,
    })
  })

  it.each([
    [[4, 4, 4, 3, 3], false, '72%', true, true],
    [[4, 4, 3, 3, 3], false, '68%', false, false],
    [[5, 5, 5, 5, 5], true, '100%', true, false],
    [[1, 1, 1, 1, 1], true, '20%', false, false],
  ])('%j with critical error %s: %s, reaches the mark %s, would pass %s', (values, critical, percentage, reaches, wouldPass) => {
    expect(osceLivePreview(five(values), 5, 25, 70, critical)).toMatchObject({ complete: true, percentage, reachesPassMark: reaches, wouldPass })
  })

  it('exactly 70% reaches the mark, as on the server (35 of 50)', () => {
    const ten = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`c${i}`, i < 5 ? 4 : 3]))
    expect(osceLivePreview(ten, 10, 50, 70, false)).toMatchObject({ total: 35, reachesPassMark: true, wouldPass: true })
  })

  it('says what the server would say for every OSCE total, with and without a critical error', () => {
    const rule = { minPercent: 70, noCriticalError: true }
    for (let total = 5; total <= 25; total++) {
      const values = [5, 5, 5, 5, 5]
      let excess = 25 - total
      for (let i = 0; excess > 0; i = (i + 1) % 5) {
        if (values[i] > 1) {
          values[i]--
          excess--
        }
      }
      for (const critical of [false, true]) {
        expect(osceLivePreview(five(values), 5, 25, 70, critical).wouldPass).toBe(osceOutcome(total, 25, critical, rule).passed)
      }
    }
  })
})

describe('assessedOnBounds: from the training start date to today (Karachi)', () => {
  it.each([
    ['2026-01-01', '2026-04-15', { min: '2026-01-01', max: '2026-04-15' }],
    ['2026-04-15', '2026-04-15', { min: '2026-04-15', max: '2026-04-15' }],
    ['2026-05-01', '2026-04-15', null],
    [null, '2026-04-15', null],
  ] as const)('start %j, today %s -> %j', (start, today, bounds) => {
    expect(assessedOnBounds(start, today)).toEqual(bounds)
  })
})

describe('result labels', () => {
  it.each([
    [null, [], null],
    [true, [], 'Pass'],
    [false, ['BELOW_PASS_MARK'], 'Fail: below the 70% pass mark'],
    [false, ['CRITICAL_ERROR'], 'Fail: a critical error'],
    [false, ['BELOW_PASS_MARK', 'CRITICAL_ERROR'], 'Fail: below the 70% pass mark and a critical error'],
    [false, [], 'Fail'],
  ] as const)('passed %j, reasons %j -> %j', (passed, reasons, label) => {
    expect(resultLabel(passed, reasons)).toBe(label)
  })

  it('every server reason has a label', () => {
    expect(Object.keys(FAIL_REASON_LABELS).sort()).toEqual(['BELOW_PASS_MARK', 'CRITICAL_ERROR'])
  })

  it('the DOPS "other" description limit matches the server', () => {
    expect(PROCEDURE_TEXT_MAX).toBe(MAX_PROCEDURE_TEXT)
  })
})
