import { describe, expect, it } from 'vitest'
import {
  ATTENDANCE_TIMEZONE,
  DEFAULT_ATTENDANCE_WINDOW,
  DEFAULT_WEEKEND_DAYS,
  DEFAULT_WORKING_WEEKDAYS,
  MIN_ATTENDANCE_GROUP,
} from '../../config/attendance'
import {
  CONFIG_DEFAULT_WINDOW,
  attendanceHolidaySnapshot,
  checkInDecision,
  checkOutDecision,
  effectiveSchedule,
  isValidWindow,
  groupPercent,
  isWithinWindow,
  karachiInstant,
  karachiTime,
  localDateKarachi,
  missedDayDecision,
  monthlyPercentage,
  parseHhMm,
  weekdayOf,
  workDateOf,
  workingDays,
  type AttendanceRecordLike,
  type AttendanceWindow,
  type ScheduleRow,
} from '../attendance-core'

// The pure Step A3 attendance rules. Karachi is UTC+5 all year (no daylight
// saving), so every instant below is written in UTC with its Karachi time in
// the comment. November 2026: the 1st is a Sunday; the 3rd is a Tuesday.

const at = (iso: string) => new Date(iso)
const day = workDateOf

/** Monday to Friday, 08:00 to 17:00. */
const WEEKDAYS: AttendanceWindow = { weekdays: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '17:00' }
/** Monday to Friday, all day: isolates the day rules from the time rule. */
const ALL_DAY: AttendanceWindow = { weekdays: [1, 2, 3, 4, 5], startTime: '00:00', endTime: '23:59' }

function record(over: Partial<AttendanceRecordLike> & { workDate: Date }): AttendanceRecordLike {
  return { checkInAt: null, checkOutAt: null, status: 'PRESENT', voidedAt: null, ...over }
}

describe('config/attendance: the stated defaults', () => {
  it('uses the IANA zone Asia/Karachi', () => expect(ATTENDANCE_TIMEZONE).toBe('Asia/Karachi'))
  it('defaults to 08:00–16:00, Monday to Friday', () => {
    expect(DEFAULT_ATTENDANCE_WINDOW).toEqual({ startTime: '08:00', endTime: '16:00' })
    expect([...DEFAULT_WEEKEND_DAYS].sort()).toEqual([0, 6])
    expect(DEFAULT_WORKING_WEEKDAYS).toEqual([1, 2, 3, 4, 5])
    expect(isValidWindow(CONFIG_DEFAULT_WINDOW)).toBe(true)
  })
  it('hides groups under 3', () => expect(MIN_ATTENDANCE_GROUP).toBe(3))
})

describe('localDateKarachi: the Karachi calendar day, not the UTC one', () => {
  const cases: [string, string, string][] = [
    ['2026-11-03T00:00:00Z', '2026-11-03', '05:00 Karachi'],
    ['2026-11-03T18:59:59Z', '2026-11-03', '23:59:59 Karachi, last second of the day'],
    ['2026-11-03T19:00:00Z', '2026-11-04', 'midnight Karachi while UTC is still the 3rd'],
    ['2026-10-31T19:30:00Z', '2026-11-01', 'month boundary'],
    ['2026-12-31T19:00:00Z', '2027-01-01', 'year boundary'],
  ]
  for (const [iso, expected, why] of cases) {
    it(`${iso} → ${expected} (${why})`, () => expect(localDateKarachi(at(iso))).toBe(expected))
  }
  it('rejects an invalid date', () => expect(() => localDateKarachi(new Date('nope'))).toThrow(RangeError))
})

describe('day helpers', () => {
  it('weekdayOf uses 0 = Sunday … 6 = Saturday', () => {
    expect(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-07'].map(weekdayOf)).toEqual([0, 1, 2, 6])
  })
  for (const bad of ['2026-02-30', '2026-2-3', '2026-11-03T00:00', '']) {
    it(`workDateOf refuses "${bad}"`, () => expect(() => workDateOf(bad)).toThrow(RangeError))
  }
  it('workDateOf is midnight UTC, as Prisma returns a @db.Date', () => {
    expect(workDateOf('2026-11-03').toISOString()).toBe('2026-11-03T00:00:00.000Z')
  })
})

describe('parseHhMm and isValidWindow', () => {
  const times: [string, number | null][] = [
    ['00:00', 0],
    ['08:00', 480],
    ['23:59', 1439],
    ['8:00', null],
    ['24:00', null],
    ['12:60', null],
    ['12:00:00', null],
    ['', null],
  ]
  for (const [value, minutes] of times) it(`"${value}" → ${minutes}`, () => expect(parseHhMm(value)).toBe(minutes))

  const windows: [string, AttendanceWindow, boolean][] = [
    ['the default', WEEKDAYS, true],
    ['start equal to end', { ...WEEKDAYS, endTime: '08:00' }, false],
    ['start after end (overnight)', { ...WEEKDAYS, startTime: '22:00', endTime: '06:00' }, false],
    ['no weekdays', { ...WEEKDAYS, weekdays: [] }, false],
    ['weekday 7', { ...WEEKDAYS, weekdays: [1, 7] }, false],
    ['weekday 1.5', { ...WEEKDAYS, weekdays: [1.5] }, false],
    ['bad time', { ...WEEKDAYS, startTime: '8:00' }, false],
  ]
  for (const [name, window, valid] of windows) it(`${name}: ${valid ? 'valid' : 'invalid'}`, () => expect(isValidWindow(window)).toBe(valid))
})

describe('isWithinWindow: Karachi time, start included, end excluded', () => {
  const cases: [string, string, AttendanceWindow, boolean][] = [
    ['2026-11-03T02:59:59Z', '07:59:59, one second early', WEEKDAYS, false],
    ['2026-11-03T03:00:00Z', '08:00:00, start is included', WEEKDAYS, true],
    ['2026-11-03T11:59:59Z', '16:59:59, last second inside', WEEKDAYS, true],
    ['2026-11-03T12:00:00Z', '17:00:00, end is excluded', WEEKDAYS, false],
    ['2026-11-03T18:30:00Z', '23:30', WEEKDAYS, false],
    // UTC 19:00 would be outside any daytime window; Karachi midnight is inside an all-day one.
    ['2026-11-03T19:00:00Z', '00:00 the next Karachi day', ALL_DAY, true],
    ['2026-11-03T05:00:00Z', '10:00 but the window is invalid', { ...WEEKDAYS, endTime: '08:00' }, false],
  ]
  for (const [iso, karachi, window, inside] of cases) {
    it(`${iso} (${karachi}): ${inside ? 'inside' : 'outside'}`, () => expect(isWithinWindow(at(iso), window)).toBe(inside))
  }
})

describe('effectiveSchedule: preceptor row, else program row, else config', () => {
  const row = (from: string, startTime: string, endTime: string): ScheduleRow => ({
    weekdays: [1, 2, 3, 4, 5],
    startTime,
    endTime,
    effectiveFrom: day(from),
  })
  const preceptor = [row('2026-11-10', '09:00', '17:00'), row('2026-09-01', '08:00', '16:00'), row('2026-12-01', '10:00', '18:00')]
  const program = [row('2026-01-01', '07:30', '15:30')]
  const cases: [string, string, readonly ScheduleRow[], readonly ScheduleRow[], string][] = [
    ['latest preceptor row on or before the day', '2026-11-03', preceptor, program, '08:00'],
    ['a row applies from its effectiveFrom day', '2026-11-10', preceptor, program, '09:00'],
    ['a future row is ignored', '2026-11-30', preceptor, program, '09:00'],
    ['before any preceptor row: program default', '2026-08-31', preceptor, program, '07:30'],
    ['no preceptor rows: program default', '2026-11-03', [], program, '07:30'],
    ['no rows at all: config default', '2026-11-03', [], [], DEFAULT_ATTENDANCE_WINDOW.startTime],
  ]
  for (const [name, on, p, g, start] of cases) it(name, () => expect(effectiveSchedule(on, p, g).startTime).toBe(start))
})

describe('workingDays: schedule weekdays minus holidays, both ends included', () => {
  const weekdays = () => WEEKDAYS
  it('November 2026, Monday to Friday: 21 days', () => expect(workingDays('2026-11-01', '2026-11-30', weekdays, [])).toHaveLength(21))
  it('a holiday on a working weekday removes it', () => {
    const days = workingDays('2026-11-01', '2026-11-30', weekdays, ['2026-11-04'])
    expect(days).toHaveLength(20)
    expect(days).not.toContain('2026-11-04')
  })
  it('a holiday on a weekend changes nothing', () => expect(workingDays('2026-11-01', '2026-11-30', weekdays, ['2026-11-07'])).toHaveLength(21))
  it('honours a schedule change mid-range', () => {
    const sixDays: AttendanceWindow = { ...WEEKDAYS, weekdays: [1, 2, 3, 4, 5, 6] }
    // Saturdays become working days from the 15th: the 21st and 28th are added.
    expect(workingDays('2026-11-01', '2026-11-30', (d) => (d >= '2026-11-15' ? sixDays : WEEKDAYS), [])).toHaveLength(23)
  })
  it('an empty range when from is after to', () => expect(workingDays('2026-11-05', '2026-11-04', weekdays, [])).toEqual([]))
  it('refuses a range over 400 days', () => expect(() => workingDays('2026-01-01', '2027-12-31', weekdays, [])).toThrow(RangeError))
})

describe('checkInDecision', () => {
  const HOLIDAYS = ['2026-11-04'] // a Wednesday: a holiday on a working weekday
  const tue = day('2026-11-03')
  const cases: [string, string, AttendanceWindow, readonly string[], AttendanceRecordLike | null, string][] = [
    ['Tuesday 10:00, nothing recorded', '2026-11-03T05:00:00Z', WEEKDAYS, HOLIDAYS, null, 'ALLOWED'],
    ['Tuesday 08:00:00, the window opens', '2026-11-03T03:00:00Z', WEEKDAYS, HOLIDAYS, null, 'ALLOWED'],
    ['Tuesday 07:59:59', '2026-11-03T02:59:59Z', WEEKDAYS, HOLIDAYS, null, 'OUTSIDE_WINDOW'],
    ['Tuesday 17:00:00, end excluded', '2026-11-03T12:00:00Z', WEEKDAYS, HOLIDAYS, null, 'OUTSIDE_WINDOW'],
    ['Wednesday 10:00, a holiday on a working weekday', '2026-11-04T05:00:00Z', WEEKDAYS, HOLIDAYS, null, 'HOLIDAY'],
    ['Saturday 10:00', '2026-11-07T05:00:00Z', WEEKDAYS, HOLIDAYS, null, 'WEEKEND'],
    ['Sunday 10:00', '2026-11-08T05:00:00Z', WEEKDAYS, HOLIDAYS, null, 'WEEKEND'],
    // Midnight boundary: the UTC date and the Karachi date differ.
    ['UTC Friday 19:30 is Karachi Saturday 00:30', '2026-11-06T19:30:00Z', ALL_DAY, [], null, 'WEEKEND'],
    ['UTC Sunday 19:30 is Karachi Monday 00:30', '2026-11-01T19:30:00Z', ALL_DAY, [], null, 'ALLOWED'],
    ['UTC Wednesday 19:30 is Karachi Thursday 00:30, a holiday', '2026-11-04T19:30:00Z', ALL_DAY, ['2026-11-05'], null, 'HOLIDAY'],
    // 23:58, not 23:59:59: the all-day window ends at 23:59, which is excluded.
    ['UTC Wednesday 18:58 is still Karachi Wednesday, not the holiday', '2026-11-04T18:58:00Z', ALL_DAY, ['2026-11-05'], null, 'ALLOWED'],
    // Existing records.
    ['already checked in today', '2026-11-03T06:00:00Z', WEEKDAYS, HOLIDAYS, record({ workDate: tue, checkInAt: at('2026-11-03T04:00:00Z') }), 'ALREADY_CHECKED_IN'],
    [
      'already checked out today',
      '2026-11-03T06:00:00Z',
      WEEKDAYS,
      HOLIDAYS,
      record({ workDate: tue, checkInAt: at('2026-11-03T04:00:00Z'), checkOutAt: at('2026-11-03T05:00:00Z') }),
      'ALREADY_CHECKED_OUT',
    ],
    [
      "today's record was voided: may record again",
      '2026-11-03T06:00:00Z',
      WEEKDAYS,
      HOLIDAYS,
      record({ workDate: tue, checkInAt: at('2026-11-03T04:00:00Z'), voidedAt: at('2026-11-03T05:30:00Z') }),
      'ALLOWED',
    ],
    ["yesterday's open record does not block today", '2026-11-03T06:00:00Z', WEEKDAYS, HOLIDAYS, record({ workDate: day('2026-11-02'), checkInAt: at('2026-11-02T04:00:00Z') }), 'ALLOWED'],
  ]
  for (const [name, iso, window, holidays, existing, expected] of cases) {
    it(`${name} → ${expected}`, () => {
      const decision = checkInDecision(at(iso), window, holidays, existing)
      if (expected === 'ALLOWED') {
        expect(decision).toEqual({ allowed: true, workDate: localDateKarachi(at(iso)) })
      } else {
        expect(decision).toMatchObject({ allowed: false, reason: expected })
        if (!decision.allowed) expect(decision.message.length).toBeGreaterThan(0)
      }
    })
  }
  it('allowed check-in carries the Karachi day, not the UTC one', () => {
    expect(checkInDecision(at('2026-11-01T19:30:00Z'), ALL_DAY, [], null)).toEqual({ allowed: true, workDate: '2026-11-02' })
  })
  it('the refusal names the window', () => {
    const decision = checkInDecision(at('2026-11-03T12:00:00Z'), WEEKDAYS, [], null)
    expect(decision).toMatchObject({ message: expect.stringContaining('08:00 until 17:00') })
  })
})

describe('checkOutDecision', () => {
  const tue = day('2026-11-03')
  const checkedIn = record({ workDate: tue, checkInAt: at('2026-11-03T04:00:00Z') }) // 09:00 Karachi
  const cases: [string, string, AttendanceRecordLike | null, string][] = [
    ['16:00 after a 09:00 check-in', '2026-11-03T11:00:00Z', checkedIn, 'ALLOWED'],
    ['20:00, after the window: check-out is not window-bound', '2026-11-03T15:00:00Z', checkedIn, 'ALLOWED'],
    ['the same instant as the check-in', '2026-11-03T04:00:00Z', checkedIn, 'ALLOWED'],
    ['no record', '2026-11-03T11:00:00Z', null, 'NO_CHECK_IN'],
    ['a record with no check-in', '2026-11-03T11:00:00Z', record({ workDate: tue, status: 'OUT_OF_WINDOW_RECORDED_BY_STAFF' }), 'NO_CHECK_IN'],
    ['a voided record', '2026-11-03T11:00:00Z', { ...checkedIn, voidedAt: at('2026-11-03T10:00:00Z') }, 'NO_CHECK_IN'],
    ['already checked out', '2026-11-03T11:00:00Z', { ...checkedIn, checkOutAt: at('2026-11-03T10:00:00Z') }, 'ALREADY_CHECKED_OUT'],
    ['before the check-in', '2026-11-03T03:59:59Z', checkedIn, 'BEFORE_CHECK_IN'],
    ['23:59:59 Karachi, still the same day', '2026-11-03T18:59:59Z', checkedIn, 'ALLOWED'],
    ['00:00 Karachi the next day (UTC still the 3rd)', '2026-11-03T19:00:00Z', checkedIn, 'NOT_TODAY'],
  ]
  for (const [name, iso, rec, expected] of cases) {
    it(`${name} → ${expected}`, () => {
      const decision = checkOutDecision(at(iso), rec)
      if (expected === 'ALLOWED') expect(decision).toEqual({ allowed: true })
      else expect(decision).toMatchObject({ allowed: false, reason: expected })
    })
  }
})

describe('monthlyPercentage: present working days over working days, voided rows ignored', () => {
  const NOV = workingDays('2026-11-01', '2026-11-30', () => WEEKDAYS, []) // 21 days
  const present = (d: string) => record({ workDate: day(d), checkInAt: at(`${d}T04:00:00Z`) })
  const voided = (d: string) => ({ ...present(d), voidedAt: at(`${d}T10:00:00Z`) })

  const cases: [string, AttendanceRecordLike[], readonly string[], { presentDays: number; workingDays: number; percent: number | null }][] = [
    ['no records', [], NOV, { presentDays: 0, workingDays: 21, percent: 0 }],
    ['three present days', [present('2026-11-02'), present('2026-11-03'), present('2026-11-05')], NOV, { presentDays: 3, workingDays: 21, percent: 14.3 }],
    ['a voided record does not count', [present('2026-11-02'), voided('2026-11-03')], NOV, { presentDays: 1, workingDays: 21, percent: 4.8 }],
    ['voided plus a live redo on the same day counts once', [voided('2026-11-03'), present('2026-11-03')], NOV, { presentDays: 1, workingDays: 21, percent: 4.8 }],
    ['two live rows on one day count once', [present('2026-11-03'), present('2026-11-03')], NOV, { presentDays: 1, workingDays: 21, percent: 4.8 }],
    ['a record on a weekend does not count', [present('2026-11-07')], NOV, { presentDays: 0, workingDays: 21, percent: 0 }],
    ['a record outside the period does not count', [present('2026-12-01')], NOV, { presentDays: 0, workingDays: 21, percent: 0 }],
    [
      'a staff-recorded day counts even without a check-in',
      [record({ workDate: day('2026-11-03'), status: 'OUT_OF_WINDOW_RECORDED_BY_STAFF' })],
      NOV,
      { presentDays: 1, workingDays: 21, percent: 4.8 },
    ],
    ['a PRESENT row with no check-in does not count', [record({ workDate: day('2026-11-03') })], NOV, { presentDays: 0, workingDays: 21, percent: 0 }],
    ['every working day', NOV.map(present), NOV, { presentDays: 21, workingDays: 21, percent: 100 }],
    ['no working days: no percentage', [present('2026-11-03')], [], { presentDays: 0, workingDays: 0, percent: null }],
  ]
  for (const [name, records, days, expected] of cases) it(name, () => expect(monthlyPercentage(records, days)).toEqual(expected))
})

describe('missedDayDecision: an editor records a day the trainee missed', () => {
  const today = '2026-11-04' // Wednesday
  const cases: [string, string, string | null, readonly string[], AttendanceRecordLike | null, string][] = [
    ['a past working day', '2026-11-02', '2026-01-01', [], null, 'ALLOWED'],
    ['today', today, '2026-01-01', [], null, 'ALLOWED'],
    ['tomorrow', '2026-11-05', '2026-01-01', [], null, 'FUTURE'],
    ['before the training start date', '2026-11-02', '2026-11-03', [], null, 'BEFORE_TRAINING'],
    ['the training start date itself', '2026-11-03', '2026-11-03', [], null, 'ALLOWED'],
    ['no start date set', '2026-11-02', null, [], null, 'ALLOWED'],
    ['a holiday on a working weekday', '2026-11-03', '2026-01-01', ['2026-11-03'], null, 'HOLIDAY'],
    ['a Sunday', '2026-11-01', '2026-01-01', [], null, 'NOT_WORKING_DAY'],
    ['a day with a live record', '2026-11-02', '2026-01-01', [], record({ workDate: day('2026-11-02'), checkInAt: at('2026-11-02T04:00:00Z') }), 'ALREADY_RECORDED'],
    [
      'a day whose only record is voided',
      '2026-11-02',
      '2026-01-01',
      [],
      record({ workDate: day('2026-11-02'), checkInAt: at('2026-11-02T04:00:00Z'), voidedAt: at('2026-11-02T10:00:00Z') }),
      'ALLOWED',
    ],
  ]
  for (const [name, d, start, holidays, existing, expected] of cases) {
    it(`${name} → ${expected}`, () => {
      const decision = missedDayDecision(d, today, start, WEEKDAYS, holidays, existing)
      if (expected === 'ALLOWED') expect(decision).toEqual({ allowed: true })
      else expect(decision).toMatchObject({ allowed: false, reason: expected })
    })
  }
})

describe('Step A4 helpers', () => {
  it('karachiInstant and karachiTime are inverses at the midnight boundary', () => {
    expect(karachiInstant('2026-11-04', '00:00').toISOString()).toBe('2026-11-03T19:00:00.000Z')
    expect(karachiTime(at('2026-11-03T19:00:00Z'))).toBe('00:00')
    expect(karachiTime(karachiInstant('2026-11-04', '17:45'))).toBe('17:45')
  })
  it('groupPercent hides groups under 3 and averages the rest, ignoring trainees with no working days', () => {
    expect(groupPercent([100, 50])).toEqual({ n: 2, hidden: true })
    expect(groupPercent([100, 50, null])).toEqual({ n: 2, hidden: true })
    expect(groupPercent([100, 50, 0])).toEqual({ n: 3, hidden: false, percent: 50 })
  })
  it('the holiday audit snapshot has scope, day and void state, never the name or reason', () => {
    const snapshot = attendanceHolidaySnapshot({ id: 'h1', scopeProfileId: null, workDate: day('2026-11-03'), voidedAt: at('2026-11-03T05:00:00Z'), voidedById: 'auth-boss' })
    expect(snapshot).toEqual({ id: 'h1', scopeProfileId: null, workDate: '2026-11-03', voidedAt: '2026-11-03T05:00:00.000Z', voidedById: 'auth-boss' })
  })
})
