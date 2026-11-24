import { describe, expect, it } from 'vitest'
import type { GroupLateExtraRanges, LateExtraRanges } from '../../server/attendance-hours-core'
import { GROUP_HIDDEN_TEXT, groupLateExtraRows, lateExtraRowText, minutesHoursText, traineeLateExtraRows } from '../attendance/attendance-hours-display'

// Display helpers of the late / extra-time bar chart: the tooltip text
// (minutes and h mm) and the chart rows.

describe('minutesHoursText: minutes and hours (h mm)', () => {
  const cases: [number, string][] = [
    [0, '0 min (0 h 00)'],
    [6, '6 min (0 h 06)'],
    [60, '60 min (1 h 00)'],
    [134, '134 min (2 h 14)'],
    [10.4, '10 min (0 h 10)'],
    [67.5, '68 min (1 h 08)'],
  ]
  for (const [minutes, text] of cases) it(`${minutes} → "${text}"`, () => expect(minutesHoursText(minutes)).toBe(text))
})

describe("traineeLateExtraRows: one trainee's rows", () => {
  const ranges: LateExtraRanges = {
    days: [
      { day: '2026-11-02', lateMinutes: 6, extraMinutes: 134 },
      { day: '2026-11-03', lateMinutes: 30, extraMinutes: null },
    ],
    weeks: [{ weekStart: '2026-11-02', weekEnd: '2026-11-08', totals: { lateDays: 2, lateMinutes: 36, extraDays: 1, extraMinutes: 134 } }],
    months: [{ month: '2026-10', totals: { lateDays: 0, lateMinutes: 0, extraDays: 0, extraMinutes: 0 } }],
  }
  const rows = traineeLateExtraRows(ranges)
  const cases: [string, keyof typeof rows, number, object][] = [
    ['Daily: both measures', 'DAILY', 0, { key: '2026-11-02', label: '2', full: 'Mon 2 Nov', late: 6, extra: 134, lateHidden: false, extraHidden: false }],
    ['Daily: no check-out → no extra bar', 'DAILY', 1, { late: 30, extra: null }],
    ['Weekly: totals', 'WEEKLY', 0, { label: '2 Nov–8 Nov', late: 36, extra: 134 }],
    ['Monthly: nothing measured → no bars, not 0', 'MONTHLY', 0, { full: 'October 2026', late: null, extra: null }],
  ]
  for (const [name, range, index, expected] of cases) it(name, () => expect(rows[range][index]).toMatchObject(expected))
  it('in words', () => {
    expect(lateExtraRowText(rows.DAILY[0])).toBe('Mon 2 Nov: late 6 min (0 h 06), extra time 134 min (2 h 14)')
    expect(lateExtraRowText(rows.DAILY[1])).toBe('Tue 3 Nov: late 30 min (0 h 30), extra time: no check-out')
  })
})

describe('groupLateExtraRows: averages, each measure hidden below 3', () => {
  const ranges: GroupLateExtraRanges = {
    days: [
      { day: '2026-11-02', group: { late: { n: 3, value: 10 }, extra: { n: 2, value: null } } },
      { day: '2026-11-03', group: { late: { n: 1, value: null }, extra: { n: 1, value: null } } },
    ],
    weeks: [{ weekStart: '2026-11-02', weekEnd: '2026-11-08', group: { late: { n: 3, value: 12.5 }, extra: { n: 3, value: 40 } } }],
    months: [{ month: '2026-11', group: { late: { n: 2, value: null }, extra: { n: 2, value: null } } }],
  }
  const rows = groupLateExtraRows(ranges)
  const cases: [string, keyof typeof rows, number, object][] = [
    ['Daily: late shown, extra hidden', 'DAILY', 0, { late: 10, extra: null, lateHidden: false, extraHidden: true }],
    ['Daily: 1 trainee → both hidden', 'DAILY', 1, { late: null, extra: null, lateHidden: true, extraHidden: true }],
    ['Weekly: 3 trainees → both shown', 'WEEKLY', 0, { late: 12.5, extra: 40, lateHidden: false, extraHidden: false }],
    ['Monthly: 2 trainees → both hidden', 'MONTHLY', 0, { lateHidden: true, extraHidden: true }],
  ]
  for (const [name, range, index, expected] of cases) it(name, () => expect(rows[range][index]).toMatchObject(expected))
  it('a hidden bucket reads "Shown from 3 trainees"', () => {
    expect(GROUP_HIDDEN_TEXT).toBe('Shown from 3 trainees')
    expect(lateExtraRowText(rows.MONTHLY[0])).toBe('November 2026: Shown from 3 trainees')
    expect(lateExtraRowText(rows.DAILY[0])).toBe('Mon 2 Nov: late 10 min (0 h 10), extra time: Shown from 3 trainees')
  })
})
