import { describe, expect, it } from 'vitest'
import type { GroupRanges, HoursRanges, HoursSummary } from '../../server/attendance-hours-core'
import {
  GROUP_HIDDEN_TEXT,
  RANGE_KEYS,
  RANGE_LABELS,
  groupLines,
  minutesText,
  programRangeRows,
  rangeRowText,
  shortMonthLabel,
  summaryLines,
  traineeRangeRows,
  weekLabel,
} from '../attendance/attendance-hours-display'

// Display helpers for the attendance graphs: wording only, no rules.

const summary = (fields: Partial<HoursSummary> = {}): HoursSummary => ({
  presentDays: 4,
  completeDays: 3,
  lateMinutes: 75,
  earlyMinutes: 20,
  hoursWorked: 24.5,
  averageLateMinutes: 25,
  averageEarlyMinutes: 6.7,
  averageHoursWorked: 8.17,
  ...fields,
})

describe('minutesText', () => {
  const cases: [number, string][] = [
    [0, '0 min'],
    [45, '45 min'],
    [59.6, '1 h 00 min'],
    [60, '1 h 00 min'],
    [125, '2 h 05 min'],
    [6.7, '7 min'],
  ]
  for (const [minutes, text] of cases) it(`${minutes} → "${text}"`, () => expect(minutesText(minutes)).toBe(text))
})

describe('shortMonthLabel', () => {
  const cases: [string, string][] = [
    ['2026-11', 'Nov 26'],
    ['2027-01', 'Jan 27'],
    ['nope', 'nope'],
  ]
  for (const [month, text] of cases) it(`${month} → "${text}"`, () => expect(shortMonthLabel(month)).toBe(text))
})

describe('summaryLines', () => {
  it('totals and averages, saying only complete days are measured', () =>
    expect(summaryLines(summary())).toEqual([
      '4 present days, 3 with both a check-in and a check-out (only these are measured).',
      'Late: 1 h 15 min in total, 25 min per day on average.',
      'Left early: 20 min in total, 7 min per day on average.',
      'Hours worked: 24.5 h in total, 8.17 h per day on average.',
    ]))
  it('no complete day yet', () =>
    expect(summaryLines(summary({ presentDays: 1, completeDays: 0 }))).toEqual(['1 present day; none with both a check-in and a check-out yet.']))
})

describe('groupLines and the program rows: hidden below 3', () => {
  it('a hidden group says "Shown from 3"', () => {
    expect(GROUP_HIDDEN_TEXT).toBe('Shown from 3 trainees')
    expect(groupLines({ n: 2, hidden: true })).toEqual(['Shown from 3 trainees; this month has 2.'])
  })
  it('a shown group gives its averages', () =>
    expect(groupLines({ n: 3, hidden: false, lateMinutes: 10, earlyMinutes: 20, averageHoursWorked: 8.17 })).toEqual([
      'Averages over 3 trainees with at least one complete day.',
      'Late: 10 min per trainee this month.',
      'Left early: 20 min per trainee this month.',
      'Hours worked: 8.17 h per day on average.',
    ]))
})

describe('weekLabel', () => {
  const cases: [string, string, string][] = [
    ['2026-11-02', '2026-11-08', '2 Nov–8 Nov'],
    ['2026-09-28', '2026-10-04', '28 Sep–4 Oct'],
    ['2026-12-28', '2027-01-03', '28 Dec–3 Jan'],
  ]
  for (const [start, end, text] of cases) it(`${start}..${end} → "${text}"`, () => expect(weekLabel(start, end)).toBe(text))
})

describe('the range selector: Daily, Weekly, Monthly', () => {
  it('three ranges, in this order', () => {
    expect(RANGE_KEYS).toEqual(['DAILY', 'WEEKLY', 'MONTHLY'])
    expect(RANGE_KEYS.map((key) => RANGE_LABELS[key])).toEqual(['Daily', 'Weekly', 'Monthly'])
  })
})

describe('traineeRangeRows: one trainee\'s rows for each range', () => {
  const none = summary({ presentDays: 1, completeDays: 0, lateMinutes: 0, earlyMinutes: 0, hoursWorked: 0, averageLateMinutes: null, averageEarlyMinutes: null, averageHoursWorked: null })
  const ranges: HoursRanges = {
    months: [
      { month: '2026-10', summary: none },
      { month: '2026-11', summary: summary() },
    ],
    weeks: [{ weekStart: '2026-10-26', weekEnd: '2026-11-01', summary: summary({ lateMinutes: 10, earlyMinutes: 0, averageHoursWorked: 8 }) }],
    days: [
      { day: '2026-11-02', lateMinutes: 30, earlyMinutes: 0, hoursWorked: 7.5 },
      { day: '2026-11-03', lateMinutes: null, earlyMinutes: null, hoursWorked: null },
    ],
  }
  const rows = traineeRangeRows(ranges)
  const cases: [string, keyof typeof rows, number, object][] = [
    ['Daily: a measured day', 'DAILY', 0, { key: '2026-11-02', label: '2', full: 'Mon 2 Nov', late: 30, early: 0, hours: 7.5, hidden: false }],
    ['Daily: an unmeasured day is a gap', 'DAILY', 1, { key: '2026-11-03', late: null, early: null, hours: null, hidden: false }],
    ['Weekly: a week\'s totals and hours per day', 'WEEKLY', 0, { key: '2026-10-26', label: '26 Oct–1 Nov', late: 10, early: 0, hours: 8, hidden: false }],
    ['Monthly: a month with no complete day is a gap, not 0', 'MONTHLY', 0, { key: '2026-10', label: 'Oct 26', late: null, early: null, hours: null, hidden: false }],
    ['Monthly: the month\'s totals', 'MONTHLY', 1, { key: '2026-11', full: 'November 2026', late: 75, early: 20, hours: 8.17, hidden: false }],
  ]
  for (const [name, range, index, expected] of cases) it(name, () => expect(rows[range][index]).toMatchObject(expected))
})

describe('programRangeRows: averages only, hidden below 3 in every range', () => {
  const ranges: GroupRanges = {
    months: [
      { month: '2026-10', group: { n: 2, hidden: true } },
      { month: '2026-11', group: { n: 3, hidden: false, lateMinutes: 10, earlyMinutes: 5, averageHoursWorked: 8 } },
    ],
    weeks: [{ weekStart: '2026-11-02', weekEnd: '2026-11-08', group: { n: 1, hidden: true } }],
    days: [
      { day: '2026-11-02', n: 3, hoursWorked: 8, lateMinutes: 5, earlyMinutes: 20 },
      { day: '2026-11-03', n: 2, hoursWorked: null, lateMinutes: null, earlyMinutes: null },
    ],
  }
  const rows = programRangeRows(ranges)
  const cases: [string, keyof typeof rows, number, object][] = [
    ['Daily: 3 trainees → shown', 'DAILY', 0, { late: 5, early: 20, hours: 8, hidden: false }],
    ['Daily: 2 trainees → hidden', 'DAILY', 1, { late: null, early: null, hours: null, hidden: true }],
    ['Weekly: 1 trainee → hidden', 'WEEKLY', 0, { late: null, early: null, hours: null, hidden: true }],
    ['Monthly: 2 trainees → hidden', 'MONTHLY', 0, { late: null, early: null, hours: null, hidden: true }],
    ['Monthly: 3 trainees → averages', 'MONTHLY', 1, { late: 10, early: 5, hours: 8, hidden: false }],
  ]
  for (const [name, range, index, expected] of cases) it(name, () => expect(rows[range][index]).toMatchObject(expected))

  it('a hidden bucket reads "Shown from 3 trainees"', () => {
    expect(rangeRowText(rows.MONTHLY[0])).toBe(`October 2026: ${GROUP_HIDDEN_TEXT}`)
    expect(GROUP_HIDDEN_TEXT).toBe('Shown from 3 trainees')
  })
  it('a shown bucket in words', () => expect(rangeRowText(rows.MONTHLY[1])).toBe('November 2026: late 10 min, left early 5 min, 8 h per day'))
})
