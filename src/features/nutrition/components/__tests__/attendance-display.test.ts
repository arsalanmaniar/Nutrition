import { describe, expect, it } from 'vitest'
import {
  ATTENDANCE_STATUS_LABELS,
  CALENDAR_KIND_COLOURS,
  CALENDAR_KIND_LABELS,
  KARACHI_TIME_NOTE,
  dayLabel,
  groupNote,
  groupText,
  legendFor,
  monthLabel,
  percentageText,
  shiftMonth,
  weekdaysText,
  weekdaysValue,
  windowText,
} from '../attendance/attendance-display'

// The attendance screens' pure display helpers (Step 8 UI). They decide
// nothing; the loaders and actions apply every rule.

describe('labels', () => {
  it('a staff-created record shows only "Recorded by staff"', () => {
    expect(ATTENDANCE_STATUS_LABELS).toEqual({ PRESENT: 'Present', OUT_OF_WINDOW_RECORDED_BY_STAFF: 'Recorded by staff' })
  })
  it('every calendar kind has a label and a colour; deleted records are grey', () => {
    expect(Object.keys(CALENDAR_KIND_COLOURS).sort()).toEqual(Object.keys(CALENDAR_KIND_LABELS).sort())
    expect(CALENDAR_KIND_COLOURS.VOIDED).toBe('#9ca3af')
  })
  it('times are labelled as Karachi time', () => expect(KARACHI_TIME_NOTE).toContain('Asia/Karachi'))
})

describe('weekdaysText and weekdaysValue', () => {
  it.each([
    [[1, 2, 3, 4, 5], 'Mon–Fri'],
    [[5, 1, 3, 2, 4], 'Mon–Fri'],
    [[1, 2, 3, 4, 5, 6], 'Mon–Sat'],
    [[0, 1, 2, 3, 4, 5, 6], 'Every day'],
    [[1, 3, 6], 'Mon, Wed, Sat'],
    [[1, 2], 'Mon, Tue'],
    [[], 'No working days'],
    [[7, -1], 'No working days'],
  ])('%j → %s', (days, text) => expect(weekdaysText(days)).toBe(text))

  it('sends sorted, unique day numbers to the action', () => {
    expect(weekdaysValue([5, 1, 3, 1])).toBe('1,3,5')
    expect(weekdaysValue([])).toBe('')
  })
})

describe('windowText', () => {
  it('spells out that check-in closes at the end time', () => {
    expect(windowText({ startTime: '08:00', endTime: '17:00' })).toBe('08:00 to 17:00 (check-in closes at 17:00)')
  })
})

describe('percentageText', () => {
  it.each([
    [{ presentDays: 12, workingDays: 20, percent: 60 }, '12 of 20 working days (60%)'],
    [{ presentDays: 1, workingDays: 1, percent: 100 }, '1 of 1 working day (100%)'],
    [{ presentDays: 0, workingDays: 0, percent: null }, 'No working days counted yet.'],
  ])('%j → %s', (p, text) => expect(percentageText(p)).toBe(text))
})

describe('groupText and groupNote: the server hides groups under 3', () => {
  it('a hidden group shows only "Not enough data" and why', () => {
    expect(groupText({ n: 2, hidden: true })).toBe('Not enough data')
    expect(groupNote({ n: 2, hidden: true })).toBe('Shown from 3 trainees; this group has 2.')
  })
  it('a shown group has its average and no note', () => {
    expect(groupText({ n: 3, hidden: false, percent: 66.7 })).toBe('66.7% average over 3 trainees')
    expect(groupNote({ n: 3, hidden: false, percent: 66.7 })).toBeNull()
  })
})

describe('months and days', () => {
  it.each([
    ['2026-11', 'November 2026'],
    ['2027-01', 'January 2027'],
    ['2026-13', '2026-13'],
    ['nope', 'nope'],
  ])('monthLabel(%s) → %s', (month, label) => expect(monthLabel(month)).toBe(label))

  it.each([
    ['2026-11', -1, '2026-10'],
    ['2026-01', -1, '2025-12'],
    ['2026-12', 1, '2027-01'],
    ['2026-13', 1, null],
  ])('shiftMonth(%s, %i) → %s', (month, delta, result) => expect(shiftMonth(month, delta)).toBe(result))

  it('dayLabel shows weekday, day and month; a bad day comes back unchanged', () => {
    expect(dayLabel('2026-11-03')).toBe('Tue 3 Nov')
    expect(dayLabel('nope')).toBe('nope')
  })
})

describe('legendFor', () => {
  it('lists only the kinds present, in a fixed order', () => {
    expect(legendFor(['ABSENT', 'PRESENT', 'OFF', 'PRESENT'])).toEqual(['PRESENT', 'ABSENT', 'OFF'])
    expect(legendFor([])).toEqual([])
  })
})
