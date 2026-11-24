import { describe, expect, it } from 'vitest'
import {
  CASE_LOG_STATUS_LABELS,
  NOT_ENOUGH_DATA,
  TRAINEE_STATUS_LABELS,
  checklistText,
  epaChartRows,
  groupNote,
  groupText,
  summativeText,
  verifyUrl,
} from '../portfolio/portfolio-display'

// The Step 7 screens' pure display helpers. They decide nothing; the loaders
// hide small groups and the credential action checks the summative rule.

describe('group values', () => {
  it('a hidden group says "Not enough data" and why; a shown one its value', () => {
    expect(groupText({ n: 2, hidden: true })).toBe(NOT_ENOUGH_DATA)
    expect(groupNote({ n: 2, hidden: true })).toBe('Shown from 3; this group has fewer.')
    expect(groupText({ n: 3, hidden: false, value: 72.5 }, '%')).toBe('72.5%')
    expect(groupNote({ n: 3, hidden: false, value: 72.5 })).toBeNull()
  })
})

describe('labels and texts', () => {
  it('trainee and case log statuses', () => {
    expect(Object.values(TRAINEE_STATUS_LABELS)).toEqual(['Start date not set', 'Not started yet', 'In training', 'Finished'])
    expect(CASE_LOG_STATUS_LABELS.REJECTED).toBe('Returned')
  })

  it.each([
    [null, 'Not started'],
    [{ status: 'DRAFT', submittedOn: null }, 'In progress (draft)'],
    [{ status: 'SUBMITTED', submittedOn: '2026-04-10' }, 'Submitted on 2026-04-10'],
  ] as const)('checklist %j -> %s', (checklist, text) => {
    expect(checklistText(checklist)).toBe(text)
  })

  it('summative text', () => {
    const epas = (meets: boolean[]) => meets.map((m, i) => ({ key: `E${i}`, label: `EPA ${i}`, latest: null, meets: m }))
    expect(summativeText({ met: true, epas: epas([true, true]) }, true)).toBe('Summative target met: every EPA at E4 or E5.')
    expect(summativeText({ met: true, epas: epas([true, true]) }, false)).toBe('Every EPA is at E4 or E5; sign-off opens in training month 12.')
    expect(summativeText({ met: false, epas: epas([true, false, false]) }, true)).toBe('Summative target not met yet: 2 of 3 EPAs below E4.')
  })

  it('the verify link', () => {
    expect(verifyUrl('https://example.test/', 'X'.repeat(43))).toBe(`https://example.test/nutrition/verify/${'X'.repeat(43)}`)
  })
})

describe('the EPA chart rows', () => {
  it('one row per day, carrying each EPA level forward', () => {
    const point = (assessedOn: string, epaKey: string, value: number) => ({ assessedOn, epaKey, epaLabel: epaKey, level: `E${value}` as never, value })
    const { rows, epas } = epaChartRows([point('2026-02-01', 'EPA_01', 2), point('2026-03-01', 'EPA_02', 1), point('2026-04-01', 'EPA_01', 3)])
    expect(epas.map((epa) => epa.key)).toEqual(['EPA_01', 'EPA_02'])
    expect(rows).toEqual([
      { assessedOn: '2026-02-01', EPA_01: 2 },
      { assessedOn: '2026-03-01', EPA_01: 2, EPA_02: 1 },
      { assessedOn: '2026-04-01', EPA_01: 3, EPA_02: 1 },
    ])
  })
})
