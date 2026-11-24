import { describe, expect, it } from 'vitest'
import type { AttendanceStatus } from '@prisma/client'
import type { AttendanceWindow } from '../attendance-core'
import {
  dailyLateExtra,
  extraMinutes,
  groupLateExtraDay,
  groupLateExtraRanges,
  groupLateExtraTotals,
  lateExtraRanges,
  lateExtraTotals,
  lateMinutes,
  type LateExtraTotals,
} from '../attendance-hours-core'

// Late arrival and extra time for the late / extra bar chart. The working
// hours are 08:00 to 16:00 Karachi (UTC+5): 08:00 is 03:00 UTC, 16:00 is
// 11:00 UTC, 18:14 is 13:14 UTC. Monday 2 November 2026.

const DAY = '2026-11-02'
const W: AttendanceWindow = { weekdays: [1, 2, 3, 4, 5, 6], startTime: '08:00', endTime: '16:00' }
const BAD: AttendanceWindow = { weekdays: [1], startTime: '16:00', endTime: '08:00' }
const scheduleOn = () => W

/** An instant at Karachi `hhmm` (or "hh:mm:ss") on `day`. */
const karachi = (day: string, hhmm: string) => new Date(`${day}T${hhmm.length === 5 ? `${hhmm}:00` : hhmm}+05:00`)

function rec(day: string, checkIn: string | null, checkOut: string | null, fields: Partial<{ voided: boolean; status: AttendanceStatus }> = {}) {
  return {
    workDate: new Date(`${day}T00:00:00Z`),
    checkInAt: checkIn ? karachi(day, checkIn) : null,
    checkOutAt: checkOut ? karachi(day, checkOut) : null,
    status: fields.status ?? ('PRESENT' as AttendanceStatus),
    voidedAt: fields.voided ? karachi(day, '18:30') : null,
  }
}

describe('lateMinutes: check-in after the 08:00 start, whole minutes rounded down', () => {
  const cases: [string, Date | null, AttendanceWindow, number | null][] = [
    ['check-in exactly 08:00 → 0 late', karachi(DAY, '08:00'), W, 0],
    ['check-in 08:00:59 → 0 (rounded down)', karachi(DAY, '08:00:59'), W, 0],
    ['check-in 08:31 → 31', karachi(DAY, '08:31'), W, 31],
    ['check-in 07:45 (early) → 0', karachi(DAY, '07:45'), W, 0],
    ['no check-in → null (not counted)', null, W, null],
    ['an unusable window → null', karachi(DAY, '09:00'), BAD, null],
  ]
  for (const [name, checkIn, window, expected] of cases) it(name, () => expect(lateMinutes(DAY, checkIn, window)).toBe(expected))
})

describe('extraMinutes: check-out after the 16:00 end, whole minutes rounded down', () => {
  const cases: [string, Date | null, AttendanceWindow, number | null][] = [
    ['check-out exactly 16:00 → 0 extra', karachi(DAY, '16:00'), W, 0],
    ['check-out 18:14 → 134 extra', karachi(DAY, '18:14'), W, 134],
    ['check-out 16:00:59 → 0 (rounded down)', karachi(DAY, '16:00:59'), W, 0],
    ['check-out 16:01:30 → 1', karachi(DAY, '16:01:30'), W, 1],
    ['check-out 15:00 (before the end) → 0', karachi(DAY, '15:00'), W, 0],
    ['check-out 00:30 the next Karachi day → 510', karachi('2026-11-03', '00:30'), W, 510],
    ['no check-out → null (not counted)', null, W, null],
    ['an unusable window → null', karachi(DAY, '18:00'), BAD, null],
  ]
  for (const [name, checkOut, window, expected] of cases) it(name, () => expect(extraMinutes(DAY, checkOut, window)).toBe(expected))
})

describe('dailyLateExtra: one entry per day, each measure on its own', () => {
  const cases: [string, ReturnType<typeof rec>[], { lateMinutes: number | null; extraMinutes: number | null }][] = [
    ['08:00 to 16:00 → 0 late, 0 extra', [rec(DAY, '08:00', '16:00')], { lateMinutes: 0, extraMinutes: 0 }],
    ['08:06 to 18:14 → 6 late, 134 extra', [rec(DAY, '08:06', '18:14')], { lateMinutes: 6, extraMinutes: 134 }],
    ['a missing check-out is skipped for extra; late still counts', [rec(DAY, '08:20', null)], { lateMinutes: 20, extraMinutes: null }],
    ['a missing check-in is skipped for late; extra still counts', [rec(DAY, null, '17:00', { status: 'OUT_OF_WINDOW_RECORDED_BY_STAFF' })], { lateMinutes: null, extraMinutes: 60 }],
    ['a voided record is skipped', [rec(DAY, '10:00', '20:00', { voided: true })], { lateMinutes: null, extraMinutes: null }],
    ['a voided record beside a live one: the live one counts', [rec(DAY, '10:00', '20:00', { voided: true }), rec(DAY, '08:05', '16:30')], { lateMinutes: 5, extraMinutes: 30 }],
    ['no record → nothing', [], { lateMinutes: null, extraMinutes: null }],
  ]
  for (const [name, records, expected] of cases) it(name, () => expect(dailyLateExtra(records, [DAY], scheduleOn)).toEqual([{ day: DAY, ...expected }]))
})

describe('lateExtraTotals: sums, each over the days that have that measure', () => {
  it('a day without a check-out adds to late only', () => {
    const daily = dailyLateExtra([rec('2026-11-02', '08:10', '18:14'), rec('2026-11-03', '08:20', null), rec('2026-11-04', '08:00', '16:00', { voided: true })], ['2026-11-02', '2026-11-03', '2026-11-04'], scheduleOn)
    expect(lateExtraTotals(daily)).toEqual({ lateDays: 2, lateMinutes: 30, extraDays: 1, extraMinutes: 134 })
  })
  it('nothing measured → zero days', () => expect(lateExtraTotals([])).toEqual({ lateDays: 0, lateMinutes: 0, extraDays: 0, extraMinutes: 0 }))
})

describe('lateExtraRanges: the same Daily, Weekly and Monthly buckets as the other chart', () => {
  const ranges = lateExtraRanges([rec('2026-11-02', '08:10', '18:14'), rec('2026-10-30', '08:30', '16:45'), rec('2026-11-03', '09:00', null)], '2026-11', scheduleOn)
  const cases: [string, () => unknown, unknown][] = [
    ['Daily: every day of November', () => ranges?.days.length, 30],
    ['Daily: 2 Nov', () => ranges?.days[1], { day: '2026-11-02', lateMinutes: 10, extraMinutes: 134 }],
    ['Weekly: the first week reaches back to 26 Oct and holds 30 Oct', () => ranges?.weeks[0], { weekStart: '2026-10-26', weekEnd: '2026-11-01', totals: { lateDays: 1, lateMinutes: 30, extraDays: 1, extraMinutes: 45 } }],
    ['Weekly: 2-8 Nov, the 3 Nov day without a check-out adds to late only', () => ranges?.weeks[1].totals, { lateDays: 2, lateMinutes: 70, extraDays: 1, extraMinutes: 134 }],
    ['Monthly: 6 months ending with November', () => ranges?.months.map((m) => m.month), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']],
    ['Monthly: October', () => ranges?.months[4].totals, { lateDays: 1, lateMinutes: 30, extraDays: 1, extraMinutes: 45 }],
    ['a malformed month → null', () => lateExtraRanges([], '2026-13', scheduleOn), null],
  ]
  for (const [name, actual, expected] of cases) it(name, () => expect(actual()).toEqual(expected))
})

describe('group averages: each measure hidden below 3 trainees', () => {
  const t = (lateDays: number, late: number, extraDays: number, extra: number): LateExtraTotals => ({ lateDays, lateMinutes: late, extraDays, extraMinutes: extra })
  const cases: [string, LateExtraTotals[], object][] = [
    ['3 trainees with both → both averaged', [t(2, 30, 2, 60), t(1, 10, 1, 0), t(1, 20, 1, 30)], { late: { n: 3, value: 20 }, extra: { n: 3, value: 30 } }],
    ['3 with a check-in, 2 with a check-out → late shown, extra hidden', [t(1, 10, 1, 40), t(1, 20, 1, 20), t(1, 15, 0, 0)], { late: { n: 3, value: 15 }, extra: { n: 2, value: null } }],
    ['2 trainees → both hidden', [t(1, 10, 1, 10), t(1, 20, 1, 20)], { late: { n: 2, value: null }, extra: { n: 2, value: null } }],
    ['a trainee with no measured day does not count', [t(1, 10, 1, 10), t(1, 20, 1, 20), t(0, 0, 0, 0)], { late: { n: 2, value: null }, extra: { n: 2, value: null } }],
    ['averages keep one decimal', [t(1, 10, 1, 1), t(1, 10, 1, 1), t(1, 11, 1, 2)], { late: { n: 3, value: 10.3 }, extra: { n: 3, value: 1.3 } }],
  ]
  for (const [name, totals, expected] of cases) it(`week / month: ${name}`, () => expect(groupLateExtraTotals(totals)).toEqual(expected))

  it('a day: averaged over the trainees with that figure on the day', () => {
    const day = (late: number | null, extra: number | null) => ({ day: DAY, lateMinutes: late, extraMinutes: extra })
    expect(groupLateExtraDay([day(10, 134), day(0, null), day(20, 30), day(null, null)])).toEqual({ late: { n: 3, value: 10 }, extra: { n: 2, value: null } })
  })

  it('groupLateExtraRanges: one bucket per day, week and month; 2 trainees → hidden everywhere', () => {
    const a = lateExtraRanges([rec('2026-11-02', '08:10', '18:14')], '2026-11', scheduleOn)!
    const b = lateExtraRanges([rec('2026-11-02', '08:20', '16:10')], '2026-11', scheduleOn)!
    const c = lateExtraRanges([rec('2026-11-02', '08:00', '17:00')], '2026-11', scheduleOn)!
    const two = groupLateExtraRanges([a, b], '2026-11')!
    expect(two.days[1].group).toEqual({ late: { n: 2, value: null }, extra: { n: 2, value: null } })
    expect(two.weeks[1].group).toEqual({ late: { n: 2, value: null }, extra: { n: 2, value: null } })
    expect(two.months[5].group).toEqual({ late: { n: 2, value: null }, extra: { n: 2, value: null } })
    const three = groupLateExtraRanges([a, b, c], '2026-11')!
    expect(three.days[1]).toEqual({ day: '2026-11-02', group: { late: { n: 3, value: 10 }, extra: { n: 3, value: 68 } } })
    expect(three.months[5].group).toEqual({ late: { n: 3, value: 10 }, extra: { n: 3, value: 68 } })
    expect(three.days[2].group).toEqual({ late: { n: 0, value: null }, extra: { n: 0, value: null } })
    expect(groupLateExtraRanges([a], 'nope')).toBeNull()
  })
})
