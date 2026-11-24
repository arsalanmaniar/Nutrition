import { describe, expect, it } from 'vitest'
import type { EpaLevel, MillerLevel } from '@prisma/client'
import { epaRangeProblem, evidenceField, evidenceValue, parseEvidence, ratingField } from '../../server/epa-core'
import {
  MILLER_LEVELS,
  STANDARD_RATINGS,
  allowedEpaLevels,
  checklistEvidenceField,
  checklistOpensText,
  checklistRatingField,
  epaLevelLabel,
  evidenceOptionLabel,
  evidenceOptionValue,
  millerOptionLabel,
  millerRangeLabel,
  ratingLabel,
} from '../epa/epa-display'

// The Step 6b screens' pure display helpers. They decide nothing; the server
// actions check every rule again. The levels the form offers must still be
// exactly the ones the server accepts.

const LEVELS: EpaLevel[] = ['E1', 'E2', 'E3', 'E4', 'E5']

describe('the Miller range the EPA form offers', () => {
  it.each([
    ['KNOWS', ['E1'], 'E1', 'Knows (E1)'],
    ['KNOWS_HOW', ['E1', 'E2'], 'E1 to E2', 'Knows How (E1 to E2)'],
    ['SHOWS_HOW', ['E2', 'E3'], 'E2 to E3', 'Shows How (E2 to E3)'],
    ['DOES', ['E3', 'E4', 'E5'], 'E3 to E5', 'Does (E3 to E5)'],
  ] as const)('%s offers %j, labelled %s', (miller, levels, range, option) => {
    expect(allowedEpaLevels(miller)).toEqual(levels)
    expect(millerRangeLabel(miller)).toBe(range)
    expect(millerOptionLabel(miller)).toBe(option)
  })

  it('offers exactly the levels the server accepts, for every Miller level', () => {
    expect([...MILLER_LEVELS].sort()).toEqual(['DOES', 'KNOWS', 'KNOWS_HOW', 'SHOWS_HOW'])
    for (const miller of MILLER_LEVELS as MillerLevel[]) {
      const accepted = LEVELS.filter((level) => epaRangeProblem(level, miller) === null)
      expect({ miller, offered: allowedEpaLevels(miller) }).toEqual({ miller, offered: accepted })
    }
  })

  it('labels each level with its name', () => {
    expect(epaLevelLabel('E1')).toBe('E1 · Observer')
    expect(epaLevelLabel('E4')).toBe('E4 · Unsupervised (spot-checked)')
  })
})

describe('the Month 9 opening text', () => {
  it.each([
    [null, '2026-04-15', "The trainee's training start date is not set yet, so the checklist cannot open."],
    ['2026-05-01', '2026-04-15', 'The checklist opens on 2026-05-01, the first day of training month 9.'],
    ['2026-04-15', '2026-04-15', null],
    ['2026-04-01', '2026-04-15', null],
  ] as const)('opens %j, today %s -> %j', (opensOn, today, text) => {
    expect(checklistOpensText(opensOn, today)).toBe(text)
  })
})

describe('rating labels', () => {
  it.each([
    ['DEVELOPING', 'Developing'],
    ['MEETS', 'Meets'],
    ['EXCEEDS', 'Exceeds'],
    [null, 'Not rated'],
  ] as const)('%j -> %s', (rating, label) => {
    expect(ratingLabel(rating)).toBe(label)
  })

  it('offers the three ratings in order', () => {
    expect(STANDARD_RATINGS).toEqual(['DEVELOPING', 'MEETS', 'EXCEEDS'])
  })
})

describe('the checklist form fields match what the server reads', () => {
  const ID = '0b0c3e1e-6c1b-4c39-9a37-3f5c2f1f9a11'

  it('field names', () => {
    expect(checklistRatingField('sop_diagnosis')).toBe(ratingField('sop_diagnosis'))
    expect(checklistEvidenceField('sop_diagnosis')).toBe(evidenceField('sop_diagnosis'))
  })

  it('an evidence option value round-trips through the server parser', () => {
    for (const kind of ['CASE_LOG', 'WPBA'] as const) {
      const value = evidenceOptionValue({ kind, id: ID })
      expect(value).toBe(evidenceValue({ kind, id: ID }))
      expect(parseEvidence(value)).toEqual({ kind, id: ID })
    }
  })

  it('evidence labels say what kind of record it is', () => {
    expect(evidenceOptionLabel({ kind: 'CASE_LOG', label: 'C-2026-012' })).toBe('Case log C-2026-012')
    expect(evidenceOptionLabel({ kind: 'WPBA', label: 'Mini-CEX, 2026-04-10' })).toBe('WPBA Mini-CEX, 2026-04-10')
  })
})
