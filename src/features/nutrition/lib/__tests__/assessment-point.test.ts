import { describe, expect, it } from 'vitest'
import {
  LAST_TRAINING_MONTH,
  LAST_TRAINING_WEEK,
  assessmentPoint,
  karachiDay,
  parseAssessmentPoint,
  periodDays,
  storedDay,
  trainingPosition,
} from '../assessment-point'

// The same pattern as the CHECK constraint nutr_evaluation_form_period_format_check
// in prisma/nutrition-step2.sql.
const DB_FORMAT = /^(W(0[1-9]|[1-4][0-9]|5[0-3])|M(0[1-9]|1[0-2]))$/

describe('assessmentPoint and parseAssessmentPoint', () => {
  it.each([
    ['WEEK', 1, 'W01'],
    ['WEEK', 9, 'W09'],
    ['WEEK', 10, 'W10'],
    ['WEEK', 53, 'W53'],
    ['MONTH', 1, 'M01'],
    ['MONTH', 4, 'M04'],
    ['MONTH', 12, 'M12'],
  ] as const)('training %s %i is %s, zero-padded', (kind, number, point) => {
    expect(assessmentPoint(kind, number)).toBe(point)
    expect(parseAssessmentPoint(point)).toEqual({ kind, number })
  })

  it.each([
    ['WEEK', 0],
    ['WEEK', 54],
    ['WEEK', -1],
    ['WEEK', 1.5],
    ['MONTH', 0],
    ['MONTH', 13],
    ['MONTH', Number.NaN],
  ] as const)('refuses to build training %s %d', (kind, number) => {
    expect(() => assessmentPoint(kind, number)).toThrow(RangeError)
  })

  it.each(['W00', 'W54', 'M00', 'M13', 'W7', 'w07', 'M4', 'X01', ' W01', 'W01 ', 'W001', '', 'M1O', 'W５3'])(
    'parses %j as no assessment point',
    (point) => {
      expect(parseAssessmentPoint(point)).toBeNull()
    },
  )

  it('builds and parses exactly the points the database accepts', () => {
    const built = [
      ...Array.from({ length: LAST_TRAINING_WEEK }, (_, i) => assessmentPoint('WEEK', i + 1)),
      ...Array.from({ length: LAST_TRAINING_MONTH }, (_, i) => assessmentPoint('MONTH', i + 1)),
    ]
    for (const point of built) expect(point).toMatch(DB_FORMAT)

    const candidates = ['W', 'M'].flatMap((letter) => Array.from({ length: 100 }, (_, i) => `${letter}${String(i).padStart(2, '0')}`))
    const parsed = candidates.filter((point) => parseAssessmentPoint(point) !== null)
    expect(parsed).toEqual(candidates.filter((point) => DB_FORMAT.test(point)))
    expect(parsed.sort()).toEqual([...built].sort())
  })
})

describe('trainingPosition: week 1 = days 0-6, month n by the same-day-of-month rule', () => {
  // [start date, today, expected day / week / month, or null]
  it.each([
    // Weeks and plain months
    ['2026-01-01', '2026-01-01', { day: 0, week: 1, month: 1 }],
    ['2026-01-01', '2026-01-07', { day: 6, week: 1, month: 1 }],
    ['2026-01-01', '2026-01-08', { day: 7, week: 2, month: 1 }],
    ['2026-01-01', '2026-01-31', { day: 30, week: 5, month: 1 }],
    ['2026-01-01', '2026-02-01', { day: 31, week: 5, month: 2 }],
    ['2026-01-01', '2026-12-30', { day: 363, week: 52, month: 12 }],
    ['2026-01-01', '2026-12-31', { day: 364, week: 53, month: 12 }],
    ['2026-01-01', '2027-01-01', null],
    // Start on the 31st: short months start on their last day, and do not shift later months
    ['2026-01-31', '2026-02-27', { day: 27, week: 4, month: 1 }],
    ['2026-01-31', '2026-02-28', { day: 28, week: 5, month: 2 }],
    ['2026-01-31', '2026-03-30', { day: 58, week: 9, month: 2 }],
    ['2026-01-31', '2026-03-31', { day: 59, week: 9, month: 3 }],
    ['2026-01-31', '2026-04-29', { day: 88, week: 13, month: 3 }],
    ['2026-01-31', '2026-04-30', { day: 89, week: 13, month: 4 }],
    ['2026-01-31', '2027-01-30', { day: 364, week: 53, month: 12 }],
    ['2026-01-31', '2027-01-31', null],
    // Start on the 30th, into a leap February (29 days)
    ['2028-01-30', '2028-02-28', { day: 29, week: 5, month: 1 }],
    ['2028-01-30', '2028-02-29', { day: 30, week: 5, month: 2 }],
    // Start on the 29th, into an ordinary February (28 days)
    ['2027-01-29', '2027-02-27', { day: 29, week: 5, month: 1 }],
    ['2027-01-29', '2027-02-28', { day: 30, week: 5, month: 2 }],
    ['2027-01-29', '2027-03-28', { day: 58, week: 9, month: 2 }],
    ['2027-01-29', '2027-03-29', { day: 59, week: 9, month: 3 }],
    // Start on 29 February: 2029 has no 29 February, so training ends on the 28th
    ['2028-02-29', '2029-01-28', { day: 334, week: 48, month: 11 }],
    ['2028-02-29', '2029-01-29', { day: 335, week: 48, month: 12 }],
    ['2028-02-29', '2029-02-27', { day: 364, week: 53, month: 12 }],
    ['2028-02-29', '2029-02-28', null],
    // A year that contains 29 February has 366 days, so week 53 has two
    ['2027-03-01', '2028-02-28', { day: 364, week: 53, month: 12 }],
    ['2027-03-01', '2028-02-29', { day: 365, week: 53, month: 12 }],
    ['2027-03-01', '2028-03-01', null],
    // Not in training
    ['2026-11-01', '2026-10-31', null],
    ['2026-11-01', '2026-01-15', null],
    ['2026-01-01', '2025-12-31', null],
    ['2026-01-01', '2027-06-01', null],
  ])('start %s, on %s -> %j', (start, today, expected) => {
    expect(trainingPosition(start, today)).toEqual(expected)
  })

  it.each(['2026-02-30', '2026-1-1', '01/11/2026', '', '2026-13-01'])('refuses %j as a calendar day', (day) => {
    expect(() => trainingPosition(day, '2026-10-11')).toThrow(RangeError)
    expect(() => trainingPosition('2026-10-11', day)).toThrow(RangeError)
  })
})

describe('periodDays', () => {
  it.each([
    ['2026-01-01', 'WEEK', 1, '2026-01-01', '2026-01-07'],
    ['2026-01-01', 'WEEK', 2, '2026-01-08', '2026-01-14'],
    ['2026-01-01', 'WEEK', 53, '2026-12-31', '2026-12-31'],
    ['2027-03-01', 'WEEK', 53, '2028-02-28', '2028-02-29'],
    ['2026-01-01', 'MONTH', 2, '2026-02-01', '2026-02-28'],
    ['2026-01-01', 'MONTH', 12, '2026-12-01', '2026-12-31'],
    ['2026-01-31', 'MONTH', 1, '2026-01-31', '2026-02-27'],
    ['2026-01-31', 'MONTH', 2, '2026-02-28', '2026-03-30'],
    ['2026-01-31', 'MONTH', 12, '2026-12-31', '2027-01-30'],
    ['2028-02-29', 'MONTH', 12, '2029-01-29', '2029-02-27'],
  ] as const)('start %s: training %s %i runs %s to %s', (start, kind, number, first, last) => {
    expect(periodDays(start, { kind, number })).toEqual({ first, last })
  })

  it('refuses periods that do not exist', () => {
    expect(() => periodDays('2026-01-01', { kind: 'WEEK', number: 54 })).toThrow(RangeError)
    expect(() => periodDays('2026-01-01', { kind: 'MONTH', number: 13 })).toThrow(RangeError)
  })

  it.each(['2026-01-01', '2026-01-31', '2027-01-29', '2028-01-30', '2028-02-29', '2027-03-01', '2026-05-31', '2026-08-30'])(
    'start %s: every training day lies in exactly its own week and month, and the year is 365 or 366 days',
    (start) => {
      const days: string[] = []
      for (let i = 0; i < 400; i++) days.push(new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10))
      const inTraining = days.filter((day) => trainingPosition(start, day) !== null)
      expect([365, 366]).toContain(inTraining.length)
      // The training days are the first ones, without a gap.
      expect(inTraining).toEqual(days.slice(0, inTraining.length))

      for (const day of inTraining) {
        const position = trainingPosition(start, day)
        if (!position) throw new Error('unreachable')
        const week = periodDays(start, { kind: 'WEEK', number: position.week })
        const month = periodDays(start, { kind: 'MONTH', number: position.month })
        expect(week.first <= day && day <= week.last).toBe(true)
        expect(month.first <= day && day <= month.last).toBe(true)
      }
      // Months 1-12 tile the training year: each starts the day after the previous one ends.
      for (let n = 2; n <= LAST_TRAINING_MONTH; n++) {
        const previousLast = periodDays(start, { kind: 'MONTH', number: n - 1 }).last
        const dayAfter = new Date(Date.parse(`${previousLast}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
        expect(periodDays(start, { kind: 'MONTH', number: n }).first).toBe(dayAfter)
      }
      expect(periodDays(start, { kind: 'MONTH', number: 12 }).last).toBe(inTraining[inTraining.length - 1])
      expect(periodDays(start, { kind: 'WEEK', number: 53 }).last).toBe(inTraining[inTraining.length - 1])
    },
  )
})

describe('karachiDay and storedDay', () => {
  it('a day turns over at midnight in Karachi (UTC+5), not at midnight UTC', () => {
    expect(karachiDay(new Date('2026-10-11T18:59:59Z'))).toBe('2026-10-11')
    expect(karachiDay(new Date('2026-10-11T19:00:00Z'))).toBe('2026-10-12')
    expect(karachiDay(new Date('2026-10-11T00:30:00Z'))).toBe('2026-10-11')
  })

  it('a stored @db.Date (midnight UTC) is its own calendar day', () => {
    expect(storedDay(new Date('2026-11-01T00:00:00Z'))).toBe('2026-11-01')
  })
})
