import { describe, expect, it } from 'vitest'
import type { AttendanceStatus } from '@prisma/client'
import { CONFIG_DEFAULT_WINDOW, daysOfMonth, type AttendanceWindow } from '../attendance-core'
import {
  HOURS_CHART_MONTHS,
  dailyHours,
  earlyMinutes,
  groupDailyHours,
  groupHours,
  hoursWorked,
  lateMinutes,
  monthlyHoursSummary,
  groupRanges,
  hoursRanges,
  monthsEnding,
  rangeDays,
  weekStartOf,
  weeklyHours,
  weeksCovering,
  type HoursSummary,
} from '../attendance-hours-core'

// Late, early and hours-worked rules for the attendance graphs. Karachi is
// UTC+5 all year, so 08:00 Karachi is 03:00 UTC and Karachi midnight is
// 19:00 UTC on the day before.

const at = (iso: string) => new Date(iso)
const W: AttendanceWindow = { weekdays: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '17:00' }
const NINE_TO_FIVE: AttendanceWindow = { weekdays: [1, 2, 3, 4, 5, 6], startTime: '09:00', endTime: '17:00' }
const BAD: AttendanceWindow = { weekdays: [1], startTime: '17:00', endTime: '08:00' }

function rec(day: string, checkIn: string | null, checkOut: string | null, fields: Partial<{ voided: boolean; status: AttendanceStatus }> = {}) {
  return {
    workDate: new Date(`${day}T00:00:00Z`),
    checkInAt: checkIn ? at(checkIn) : null,
    checkOutAt: checkOut ? at(checkOut) : null,
    status: fields.status ?? ('PRESENT' as AttendanceStatus),
    voidedAt: fields.voided ? at(`${day}T13:00:00Z`) : null,
  }
}

describe('lateMinutes: max(0, check-in − start), whole minutes rounded down', () => {
  const cases: [string, string, Date | null, AttendanceWindow, number | null][] = [
    ['check-in exactly at start → 0', '2026-11-03', at('2026-11-03T03:00:00Z'), W, 0],
    ['59 seconds after start → 0 (whole minutes only)', '2026-11-03', at('2026-11-03T03:00:59Z'), W, 0],
    ['one minute after start → 1', '2026-11-03', at('2026-11-03T03:01:00Z'), W, 1],
    ['08:31 → 31', '2026-11-03', at('2026-11-03T03:31:00Z'), W, 31],
    ['early arrival 07:45 → 0, never negative', '2026-11-03', at('2026-11-03T02:45:00Z'), W, 0],
    ['Karachi midnight (19:00 UTC the day before) is on the record day → 0, not 16 h late', '2026-11-03', at('2026-11-02T19:00:00Z'), W, 0],
    ['00:00 UTC is 05:00 Karachi on the same day → 0', '2026-11-03', at('2026-11-03T00:00:00Z'), W, 0],
    ['the preceptor window 09:00: 09:15 → 15', '2026-11-03', at('2026-11-03T04:15:00Z'), NINE_TO_FIVE, 15],
    ['no check-in → null', '2026-11-03', null, W, null],
    ['an unusable window → null, never a guess', '2026-11-03', at('2026-11-03T04:00:00Z'), BAD, null],
  ]
  for (const [name, day, checkIn, window, expected] of cases) it(name, () => expect(lateMinutes(day, checkIn, window)).toBe(expected))
})

describe('earlyMinutes: max(0, end − check-out), whole minutes rounded down', () => {
  const cases: [string, string, Date | null, AttendanceWindow, number | null][] = [
    ['check-out exactly at end → 0', '2026-11-03', at('2026-11-03T12:00:00Z'), W, 0],
    ['16:00 → 60', '2026-11-03', at('2026-11-03T11:00:00Z'), W, 60],
    ['16:59:30 → 0 (half a minute is not counted)', '2026-11-03', at('2026-11-03T11:59:30Z'), W, 0],
    ['18:14, after the end → 0', '2026-11-03', at('2026-11-03T13:14:00Z'), W, 0],
    ['23:59 Karachi, just before midnight → 0', '2026-11-03', at('2026-11-03T18:59:00Z'), W, 0],
    ['past Karachi midnight (00:30 next day) → 0, not a full day early', '2026-11-03', at('2026-11-03T19:30:00Z'), W, 0],
    ['missing check-out → null', '2026-11-03', null, W, null],
    ['an unusable window → null', '2026-11-03', at('2026-11-03T11:00:00Z'), BAD, null],
  ]
  for (const [name, day, checkOut, window, expected] of cases) it(name, () => expect(earlyMinutes(day, checkOut, window)).toBe(expected))
})

describe('hoursWorked: check-out − check-in, two decimals', () => {
  const cases: [string, Date | null, Date | null, number | null][] = [
    ['08:00 to 17:00 → 9', at('2026-11-03T03:00:00Z'), at('2026-11-03T12:00:00Z'), 9],
    ['08:21 to 16:09 → 7.8', at('2026-11-03T03:21:00Z'), at('2026-11-03T11:09:00Z'), 7.8],
    ['08:10 to 16:07 → 7.95', at('2026-11-03T03:10:00Z'), at('2026-11-03T11:07:00Z'), 7.95],
    ['across Karachi midnight: 22:00 to 01:00 → 3', at('2026-11-03T17:00:00Z'), at('2026-11-03T20:00:00Z'), 3],
    ['the same instant → 0', at('2026-11-03T03:00:00Z'), at('2026-11-03T03:00:00Z'), 0],
    ['missing check-out → null', at('2026-11-03T03:00:00Z'), null, null],
    ['missing check-in → null', null, at('2026-11-03T12:00:00Z'), null],
    ['check-out before check-in → null', at('2026-11-03T12:00:00Z'), at('2026-11-03T03:00:00Z'), null],
  ]
  for (const [name, checkIn, checkOut, expected] of cases) it(name, () => expect(hoursWorked(checkIn, checkOut)).toBe(expected))
})

describe('dailyHours: one entry per day, figures only on complete days', () => {
  const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']
  const records = [
    rec('2026-11-02', '2026-11-02T03:00:00Z', '2026-11-02T12:00:00Z'), // 08:00–17:00
    rec('2026-11-03', '2026-11-03T03:20:00Z', null), // missing check-out
    rec('2026-11-04', '2026-11-04T03:30:00Z', '2026-11-04T11:00:00Z', { voided: true }), // voided
    rec('2026-11-05', '2026-11-04T19:30:00Z', '2026-11-05T11:30:00Z'), // 00:30 to 16:30 Karachi on the 5th
  ]
  const result = dailyHours(records, days, () => W)
  const cases: [string, number, object][] = [
    ['a full day on time', 0, { day: '2026-11-02', lateMinutes: 0, earlyMinutes: 0, hoursWorked: 9 }],
    ['a day with a missing check-out has no figures', 1, { day: '2026-11-03', lateMinutes: null, earlyMinutes: null, hoursWorked: null }],
    ['a voided record is ignored', 2, { day: '2026-11-04', lateMinutes: null, earlyMinutes: null, hoursWorked: null }],
    ['a check-in at 00:30 Karachi belongs to its Karachi day', 3, { day: '2026-11-05', lateMinutes: 0, earlyMinutes: 30, hoursWorked: 16 }],
    ['a day with no record', 4, { day: '2026-11-06', lateMinutes: null, earlyMinutes: null, hoursWorked: null }],
  ]
  for (const [name, index, expected] of cases) it(name, () => expect(result[index]).toEqual(expected))

  it('a voided record does not hide a live record of the same day', () => {
    const both = [rec('2026-11-04', '2026-11-04T03:00:00Z', '2026-11-04T12:00:00Z', { voided: true }), rec('2026-11-04', '2026-11-04T03:10:00Z', '2026-11-04T12:00:00Z')]
    expect(dailyHours(both, ['2026-11-04'], () => W)).toEqual([{ day: '2026-11-04', lateMinutes: 10, earlyMinutes: 0, hoursWorked: 8.83 }])
  })

  it('uses the window in force on each day', () => {
    const scheduleOn = (day: string) => (day < '2026-11-03' ? W : NINE_TO_FIVE)
    const two = [rec('2026-11-02', '2026-11-02T04:00:00Z', '2026-11-02T12:00:00Z'), rec('2026-11-03', '2026-11-03T04:00:00Z', '2026-11-03T12:00:00Z')]
    expect(dailyHours(two, ['2026-11-02', '2026-11-03'], scheduleOn).map((d) => d.lateMinutes)).toEqual([60, 0])
  })
})

describe('monthlyHoursSummary: totals, averages per complete day, present days', () => {
  const nov = daysOfMonth('2026-11') as string[]
  const oct = daysOfMonth('2026-10') as string[]
  const records = [
    rec('2026-11-02', '2026-11-02T03:30:00Z', '2026-11-02T11:00:00Z'), // 30 late, 60 early, 7.5 h
    rec('2026-11-03', '2026-11-03T03:00:00Z', '2026-11-03T12:00:00Z'), // 0, 0, 9 h
    rec('2026-11-04', '2026-11-04T03:45:00Z', null), // present, missing check-out: not measured
    rec('2026-11-05', '2026-11-05T05:00:00Z', '2026-11-05T09:00:00Z', { voided: true }), // voided: nothing
    rec('2026-11-06', '2026-11-06T04:00:00Z', '2026-11-06T12:00:00Z', { status: 'OUT_OF_WINDOW_RECORDED_BY_STAFF' }), // 60, 0, 8 h
    rec('2026-11-01', '2026-10-31T19:10:00Z', '2026-11-01T03:10:00Z'), // 00:10–08:10 Karachi on 1 Nov: November, not October
  ]

  const cases: [string, readonly string[], HoursSummary][] = [
    [
      'November: 5 present, 4 complete (missing check-out and voided left out)',
      nov,
      {
        presentDays: 5,
        completeDays: 4,
        lateMinutes: 90,
        earlyMinutes: 60 + 530,
        hoursWorked: 32.5,
        averageLateMinutes: 22.5,
        averageEarlyMinutes: 147.5,
        averageHoursWorked: 8.13,
      },
    ],
    [
      'October: the record past Karachi midnight on 1 Nov is not counted here',
      oct,
      {
        presentDays: 0,
        completeDays: 0,
        lateMinutes: 0,
        earlyMinutes: 0,
        hoursWorked: 0,
        averageLateMinutes: null,
        averageEarlyMinutes: null,
        averageHoursWorked: null,
      },
    ],
  ]
  for (const [name, days, expected] of cases) it(name, () => expect(monthlyHoursSummary(records, days, () => W)).toEqual(expected))

  it('only a voided record → nothing present, nothing measured', () => {
    const summary = monthlyHoursSummary([rec('2026-11-02', '2026-11-02T03:30:00Z', '2026-11-02T11:00:00Z', { voided: true })], nov, () => CONFIG_DEFAULT_WINDOW)
    expect(summary).toMatchObject({ presentDays: 0, completeDays: 0, lateMinutes: 0, averageLateMinutes: null })
  })

  it('only a missing check-out → present, but no late or early figure', () => {
    const summary = monthlyHoursSummary([rec('2026-11-02', '2026-11-02T05:00:00Z', null)], nov, () => W)
    expect(summary).toMatchObject({ presentDays: 1, completeDays: 0, lateMinutes: 0, earlyMinutes: 0, averageLateMinutes: null })
  })
})

describe('groupHours: program averages, hidden below 3', () => {
  const s = (completeDays: number, late: number, early: number, avgHours: number | null): HoursSummary => ({
    presentDays: completeDays,
    completeDays,
    lateMinutes: late,
    earlyMinutes: early,
    hoursWorked: 0,
    averageLateMinutes: null,
    averageEarlyMinutes: null,
    averageHoursWorked: avgHours,
  })
  const cases: [string, HoursSummary[], ReturnType<typeof groupHours>][] = [
    ['no trainees → hidden, n 0', [], { n: 0, hidden: true }],
    ['2 trainees → hidden', [s(3, 10, 0, 8), s(2, 20, 5, 7)], { n: 2, hidden: true }],
    ['3 trainees, one with no complete day → only 2 count → hidden', [s(3, 10, 0, 8), s(2, 20, 5, 7), s(0, 0, 0, null)], { n: 2, hidden: true }],
    [
      '3 trainees → averages of their monthly totals',
      [s(3, 10, 0, 8), s(2, 20, 5, 7), s(1, 0, 10, 7.5)],
      { n: 3, hidden: false, lateMinutes: 10, earlyMinutes: 5, averageHoursWorked: 7.5 },
    ],
  ]
  for (const [name, summaries, expected] of cases) it(name, () => expect(groupHours(summaries)).toEqual(expected))
})

describe('groupDailyHours: a day shown only with at least 3 complete days', () => {
  const d = (day: string, hours: number | null, late: number | null = null, early: number | null = null) => ({
    day,
    lateMinutes: hours === null ? null : (late ?? 0),
    earlyMinutes: hours === null ? null : (early ?? 0),
    hoursWorked: hours,
  })
  const perTrainee = [
    [d('2026-11-02', 8, 10, 0), d('2026-11-03', 9)],
    [d('2026-11-02', 7, 0, 60), d('2026-11-03', null)],
    [d('2026-11-02', 9, 5, 0), d('2026-11-03', 8)],
  ]
  it('3 complete days → the means of hours, late and early; 2 → all hidden (null), with the count', () =>
    expect(groupDailyHours(perTrainee, ['2026-11-02', '2026-11-03'])).toEqual([
      { day: '2026-11-02', n: 3, hoursWorked: 8, lateMinutes: 5, earlyMinutes: 20 },
      { day: '2026-11-03', n: 2, hoursWorked: null, lateMinutes: null, earlyMinutes: null },
    ]))
})

describe('weekStartOf: the Monday of the week (Monday to Sunday)', () => {
  const cases: [string, string, string][] = [
    ['a Monday is its own week start', '2026-11-02', '2026-11-02'],
    ['a Tuesday → the Monday before', '2026-11-03', '2026-11-02'],
    ['a Saturday → the Monday before', '2026-11-07', '2026-11-02'],
    ['a Sunday ends the week → the Monday six days before, not the next day', '2026-11-08', '2026-11-02'],
    ['the Monday after that Sunday starts a new week', '2026-11-09', '2026-11-09'],
    ['across a month end: Thu 1 Oct → Mon 28 Sep', '2026-10-01', '2026-09-28'],
    ['across a year end: Fri 1 Jan 2027 → Mon 28 Dec 2026', '2027-01-01', '2026-12-28'],
  ]
  for (const [name, day, monday] of cases) it(name, () => expect(weekStartOf(day)).toBe(monday))
  it('refuses a malformed day', () => expect(() => weekStartOf('nope')).toThrow(RangeError))
})

describe('weeksCovering: full Monday-to-Sunday weeks touching a month', () => {
  const cases: [string, [string, string][]][] = [
    [
      '2026-11 (starts on a Sunday)',
      [
        ['2026-10-26', '2026-11-01'],
        ['2026-11-02', '2026-11-08'],
        ['2026-11-09', '2026-11-15'],
        ['2026-11-16', '2026-11-22'],
        ['2026-11-23', '2026-11-29'],
        ['2026-11-30', '2026-12-06'],
      ],
    ],
    [
      '2026-02 (starts on a Sunday, 28 days)',
      [
        ['2026-01-26', '2026-02-01'],
        ['2026-02-02', '2026-02-08'],
        ['2026-02-09', '2026-02-15'],
        ['2026-02-16', '2026-02-22'],
        ['2026-02-23', '2026-03-01'],
      ],
    ],
    [
      '2027-02 (starts on a Monday, ends on a Sunday: exactly 4 weeks)',
      [
        ['2027-02-01', '2027-02-07'],
        ['2027-02-08', '2027-02-14'],
        ['2027-02-15', '2027-02-21'],
        ['2027-02-22', '2027-02-28'],
      ],
    ],
  ]
  for (const [name, expected] of cases) {
    it(name, () => {
      const weeks = weeksCovering(name.slice(0, 7))
      expect(weeks?.map((w) => [w.weekStart, w.weekEnd])).toEqual(expected)
      for (const w of weeks ?? []) expect(w.days).toHaveLength(7)
    })
  }
  it('null for a malformed month', () => expect(weeksCovering('2026-13')).toBeNull())
})

describe('weeklyHours: the Sunday/Monday boundary is the Karachi day', () => {
  // Week of Mon 2 Nov – Sun 8 Nov 2026, and the next one from Mon 9 Nov.
  const weeks = weeksCovering('2026-11')!.filter((w) => w.weekStart === '2026-11-02' || w.weekStart === '2026-11-09')
  const records = [
    // Sunday 8 Nov, 08:30–16:00 Karachi: 30 late, 60 early, 7.5 h. In the 2 Nov week.
    rec('2026-11-08', '2026-11-08T03:30:00Z', '2026-11-08T11:00:00Z'),
    // Monday 9 Nov, 00:10–08:10 Karachi. The check-in instant is still SUNDAY 8 Nov in UTC
    // (19:10Z), but the record day is Monday in Karachi, so it belongs to the 9 Nov week.
    rec('2026-11-09', '2026-11-08T19:10:00Z', '2026-11-09T03:10:00Z'),
    // Monday 9 Nov again, voided: ignored.
    rec('2026-11-09', '2026-11-09T05:00:00Z', '2026-11-09T06:00:00Z', { voided: true }),
    // Tuesday 10 Nov, missing check-out: present, not measured.
    rec('2026-11-10', '2026-11-10T03:00:00Z', null),
  ]
  const result = weeklyHours(records, weeks, () => ({ weekdays: [0, 1, 2, 3, 4, 5, 6], startTime: '08:00', endTime: '17:00' }))
  const cases: [string, number, Partial<HoursSummary>][] = [
    ['the Sunday falls in the week that started on Monday 2 Nov', 0, { presentDays: 1, completeDays: 1, lateMinutes: 30, earlyMinutes: 60, hoursWorked: 7.5 }],
    [
      'the Monday 00:10 Karachi check-in (Sunday in UTC) falls in the week of 9 Nov; voided and missing check-out are not measured',
      1,
      { presentDays: 2, completeDays: 1, lateMinutes: 0, earlyMinutes: 530, hoursWorked: 8, averageHoursWorked: 8 },
    ],
  ]
  for (const [name, index, expected] of cases) it(name, () => expect(result[index].summary).toMatchObject(expected))
  it('keeps each week\'s first and last day', () =>
    expect(result.map((w) => [w.weekStart, w.weekEnd])).toEqual([
      ['2026-11-02', '2026-11-08'],
      ['2026-11-09', '2026-11-15'],
    ]))
})

describe('monthsEnding: the months the bars cover', () => {
  const cases: [string, number, string[] | null][] = [
    ['2026-11', HOURS_CHART_MONTHS, ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']],
    ['2026-02', 3, ['2025-12', '2026-01', '2026-02']],
    ['2026-01', 1, ['2026-01']],
    ['2026-13', 3, null],
    ['nope', 3, null],
    ['2026-11', 0, null],
  ]
  for (const [month, count, expected] of cases) it(`${month} × ${count}`, () => expect(monthsEnding(month, count)).toEqual(expected))
})

describe('hoursRanges: the range builder of the single chart', () => {
  const ALL_WEEK: AttendanceWindow = { weekdays: [0, 1, 2, 3, 4, 5, 6], startTime: '08:00', endTime: '16:00' }
  const records = [
    rec('2026-06-01', '2026-06-01T03:10:00Z', '2026-06-01T11:00:00Z'), // June: first month of the window, 10 late
    rec('2026-05-29', '2026-05-29T04:00:00Z', '2026-05-29T11:00:00Z'), // May: outside the 6-month window
    rec('2026-10-31', '2026-10-31T03:20:00Z', '2026-10-31T11:00:00Z'), // Sat 31 Oct: October, and the first November week
    rec('2026-11-01', '2026-11-01T03:00:00Z', '2026-11-01T10:00:00Z'), // Sun 1 Nov: 60 early; still the 26 Oct week
    rec('2026-11-02', '2026-11-01T19:10:00Z', '2026-11-02T11:00:00Z'), // Mon 2 Nov 00:10 Karachi (Sunday in UTC): the 2 Nov week
    rec('2026-11-30', '2026-11-30T03:30:00Z', '2026-11-30T11:00:00Z'), // Mon 30 Nov: last week, reaching into December
    rec('2026-12-01', '2026-12-01T03:45:00Z', '2026-12-01T11:00:00Z'), // Tue 1 Dec: December, but inside the last November week
  ]
  const r = hoursRanges(records, '2026-11', () => ALL_WEEK)!

  describe('Monthly: the 6 months ending at the chosen month', () => {
    it('June to November 2026, oldest first', () => expect(r.months.map((m) => m.month)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']))
    const cases: [string, number, Partial<HoursSummary>][] = [
      ['June counts its own record (May is outside the window)', 0, { completeDays: 1, lateMinutes: 10 }],
      ['July to September are empty', 1, { completeDays: 0, lateMinutes: 0 }],
      ['October has only 31 Oct', 4, { completeDays: 1, lateMinutes: 20, earlyMinutes: 0 }],
      ['November: 1, 2 and 30 Nov (not 1 Dec)', 5, { completeDays: 3, lateMinutes: 30, earlyMinutes: 60 }],
    ]
    for (const [name, index, expected] of cases) it(name, () => expect(r.months[index].summary).toMatchObject(expected))
  })

  describe('Weekly: Monday to Sunday weeks in Karachi touching the month', () => {
    it('6 weeks, from Mon 26 Oct to Sun 6 Dec', () =>
      expect(r.weeks.map((w) => [w.weekStart, w.weekEnd])).toEqual([
        ['2026-10-26', '2026-11-01'],
        ['2026-11-02', '2026-11-08'],
        ['2026-11-09', '2026-11-15'],
        ['2026-11-16', '2026-11-22'],
        ['2026-11-23', '2026-11-29'],
        ['2026-11-30', '2026-12-06'],
      ]))
    const cases: [string, number, Partial<HoursSummary>][] = [
      ['Sat 31 Oct and Sun 1 Nov close the first week', 0, { completeDays: 2, lateMinutes: 20, earlyMinutes: 60 }],
      ['Mon 2 Nov 00:10 Karachi (19:10 UTC Sunday) opens the next week', 1, { completeDays: 1, lateMinutes: 0, earlyMinutes: 0 }],
      ['an empty week', 2, { completeDays: 0 }],
      ['the last week includes Tue 1 Dec', 5, { completeDays: 2, lateMinutes: 75 }],
    ]
    for (const [name, index, expected] of cases) it(name, () => expect(r.weeks[index].summary).toMatchObject(expected))
  })

  describe('Daily: each day of the chosen month', () => {
    it('30 days, 1 to 30 November', () => {
      expect(r.days).toHaveLength(30)
      expect([r.days[0].day, r.days[29].day]).toEqual(['2026-11-01', '2026-11-30'])
    })
    const cases: [string, number, object][] = [
      ['Sun 1 Nov: 60 early', 0, { day: '2026-11-01', lateMinutes: 0, earlyMinutes: 60, hoursWorked: 7 }],
      ['Mon 2 Nov from 00:10 Karachi', 1, { day: '2026-11-02', lateMinutes: 0, earlyMinutes: 0, hoursWorked: 15.83 }],
      ['a day without a record', 2, { day: '2026-11-03', lateMinutes: null, earlyMinutes: null, hoursWorked: null }],
      ['Mon 30 Nov: 30 late', 29, { day: '2026-11-30', lateMinutes: 30, earlyMinutes: 0, hoursWorked: 7.5 }],
    ]
    for (const [name, index, expected] of cases) it(name, () => expect(r.days[index]).toEqual(expected))
  })

  it('null for a malformed month', () => expect(hoursRanges(records, '2026-13', () => ALL_WEEK)).toBeNull())

  it('rangeDays: every day the three ranges read, once each, sorted', () => {
    const days = rangeDays('2026-11')!
    expect([days[0], days[days.length - 1]]).toEqual(['2026-06-01', '2026-12-06'])
    expect(new Set(days).size).toBe(days.length)
    expect([...days].sort()).toEqual(days)
    expect(days.length).toBe(30 + 31 + 31 + 30 + 31 + 30 + 6) // June..November, plus 1..6 December
  })

  it('groupRanges: hidden below 3 in every range; shown at 3', () => {
    const two = groupRanges([r, r], '2026-11')!
    expect([two.months[5].group, two.weeks[0].group, two.days[0].hoursWorked]).toEqual([{ n: 2, hidden: true }, { n: 2, hidden: true }, null])
    const three = groupRanges([r, r, r], '2026-11')!
    expect(three.months[5].group).toMatchObject({ n: 3, hidden: false, lateMinutes: 30, earlyMinutes: 60 })
    expect(three.weeks[0].group).toMatchObject({ n: 3, hidden: false, lateMinutes: 20, earlyMinutes: 60 })
    expect(three.days[0]).toEqual({ day: '2026-11-01', n: 3, hoursWorked: 7, lateMinutes: 0, earlyMinutes: 60 })
  })
})
