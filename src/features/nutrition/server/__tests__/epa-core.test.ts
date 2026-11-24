import { describe, expect, it } from 'vitest'
import type { EpaLevel, MillerLevel } from '@prisma/client'
import { EPA_KEYS, EPA_LIST, epaLabel } from '../../config/epas'
import { MILLER_EPA_TARGETS, STANDARDS_CHECKLIST } from '../../config/forms'
import {
  STANDARD_KEYS,
  checklistAuditSnapshot,
  checklistFromFields,
  epaAuditSnapshot,
  epaRangeProblem,
  evidenceIds,
  parseEvidence,
  storedItems,
} from '../epa-core'

// The pure Step 6a rules: the Miller-to-EPA range check, and reading the
// standards checklist's form fields and stored items.

const LEVELS: EpaLevel[] = ['E1', 'E2', 'E3', 'E4', 'E5']
const ID = '0b0c3e1e-6c1b-4c39-9a37-3f5c2f1f9a11'

describe('epaRangeProblem: the level must sit inside MILLER_EPA_TARGETS, both ends included', () => {
  // Spelled out, not derived from config, so a config change is caught here too.
  const ALLOWED: Record<MillerLevel, EpaLevel[]> = {
    KNOWS: ['E1'],
    KNOWS_HOW: ['E1', 'E2'],
    SHOWS_HOW: ['E2', 'E3'],
    DOES: ['E3', 'E4', 'E5'],
  }

  for (const [miller, allowed] of Object.entries(ALLOWED) as [MillerLevel, EpaLevel[]][]) {
    for (const level of LEVELS) {
      const fits = allowed.includes(level)
      it(`${miller} + ${level}: ${fits ? 'allowed' : 'refused'}`, () => {
        if (fits) expect(epaRangeProblem(level, miller)).toBeNull()
        else expect(epaRangeProblem(level, miller)).toEqual(expect.stringContaining(`${level} (`))
      })
    }
  }

  it('the refusal names the allowed range', () => {
    expect(epaRangeProblem('E4', 'SHOWS_HOW')).toBe('E4 (Unsupervised (spot-checked)) is outside the range for Shows How: use E2 to E3.')
    expect(epaRangeProblem('E2', 'KNOWS')).toBe('E2 (Direct supervision) is outside the range for Knows: use E1.')
  })

  it('agrees with the config map', () => {
    expect(MILLER_EPA_TARGETS.DOES).toEqual({ min: 'E3', max: 'E5' })
  })
})

describe('the EPA list (placeholder until the program supplies its own)', () => {
  it('has unique keys and a label for each', () => {
    expect(new Set(EPA_KEYS).size).toBe(EPA_LIST.length)
    expect(EPA_LIST.length).toBeGreaterThan(0)
    expect(epaLabel('EPA_01')).toBe('EPA 1 (pending)')
    expect(epaLabel('RETIRED_KEY')).toBe('RETIRED_KEY')
  })
})

describe('the standards checklist fields', () => {
  it('has the 4 SOP steps and the 6 SOPP domains from config', () => {
    expect(STANDARDS_CHECKLIST.groups.map((group) => [group.key, group.standards.length])).toEqual([
      ['sop', 4],
      ['sopp', 6],
    ])
    expect(STANDARD_KEYS).toHaveLength(10)
  })

  it('parseEvidence accepts only CASE_LOG:<uuid> or WPBA:<uuid>', () => {
    expect(parseEvidence(`WPBA:${ID}`)).toEqual({ kind: 'WPBA', id: ID })
    expect(parseEvidence(`CASE_LOG:${ID.toUpperCase()}`)).toEqual({ kind: 'CASE_LOG', id: ID })
    for (const bad of ['', ID, `FORM:${ID}`, 'WPBA:not-a-uuid', `WPBA:${ID}:extra`, `wpba:${ID}`]) expect(parseEvidence(bad)).toBeNull()
  })

  it('a draft may be partial; only configured standards are read', () => {
    const result = checklistFromFields(
      { 'rating.sop_diagnosis': 'MEETS', 'evidence.sop_intervention': `WPBA:${ID}`, 'rating.not_a_standard': 'EXCEEDS' },
      { requireAll: false },
    )
    expect(result).toEqual({
      ok: true,
      items: {
        sop_diagnosis: { rating: 'MEETS', evidence: null },
        sop_intervention: { rating: null, evidence: { kind: 'WPBA', id: ID } },
      },
    })
  })

  it('submit needs every standard rated with evidence', () => {
    const result = checklistFromFields({ 'rating.sop_diagnosis': 'MEETS' }, { requireAll: true })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(Object.keys(result.errors)).toHaveLength(19)
    expect(result.errors['evidence.sop_diagnosis']).toBe('Link a case log or a WPBA as evidence.')
    expect(result.errors['rating.sopp_quality_in_practice']).toBe('Rate this standard.')
  })

  it('a bad rating or evidence value is a field error, never stored', () => {
    const result = checklistFromFields({ 'rating.sop_diagnosis': 'GREAT', 'evidence.sop_diagnosis': 'case 12' }, { requireAll: false })
    expect(result).toEqual({
      ok: false,
      errors: { 'rating.sop_diagnosis': 'Pick Developing, Meets or Exceeds.', 'evidence.sop_diagnosis': 'Pick a case log or a WPBA.' },
    })
  })

  it('storedItems drops unknown standards and malformed parts', () => {
    expect(
      storedItems({
        sop_diagnosis: { rating: 'EXCEEDS', evidence: { kind: 'CASE_LOG', id: ID } },
        sop_intervention: { rating: 'BAD', evidence: { kind: 'FORM', id: ID } },
        rogue: { rating: 'MEETS', evidence: null },
      }),
    ).toEqual({ sop_diagnosis: { rating: 'EXCEEDS', evidence: { kind: 'CASE_LOG', id: ID } } })
    expect(storedItems(null)).toEqual({})
    expect(storedItems([1, 2])).toEqual({})
  })

  it('evidenceIds groups the references by kind, once each', () => {
    const other = '1b0c3e1e-6c1b-4c39-9a37-3f5c2f1f9a12'
    expect(
      evidenceIds({
        a: { rating: 'MEETS', evidence: { kind: 'WPBA', id: ID } },
        b: { rating: 'MEETS', evidence: { kind: 'WPBA', id: ID } },
        c: { rating: null, evidence: { kind: 'CASE_LOG', id: other } },
        d: { rating: 'MEETS', evidence: null },
      }),
    ).toEqual({ caseLogIds: [other], wpbaIds: [ID] })
  })
})

describe('audit snapshots carry no free text', () => {
  it('an EPA snapshot has ids, the EPA key, levels and the day; never notes', () => {
    const snapshot = epaAuditSnapshot({
      id: 'e1',
      traineeId: 't1',
      assessorId: 'p1',
      epaName: 'EPA_01',
      level: 'E3',
      millerLevel: 'DOES',
      assessedOn: new Date('2026-04-15T00:00:00Z'),
      notes: 'Private remark',
    } as Parameters<typeof epaAuditSnapshot>[0])
    expect(snapshot).toEqual({ id: 'e1', traineeId: 't1', assessorId: 'p1', epaName: 'EPA_01', level: 'E3', millerLevel: 'DOES', assessedOn: '2026-04-15' })
  })

  it('a checklist snapshot has ids, status and counts; never ratings by name or evidence ids', () => {
    const snapshot = checklistAuditSnapshot({
      id: 'c1',
      traineeId: 't1',
      monthNumber: 9,
      formVersion: 1,
      status: 'DRAFT',
      items: { sop_diagnosis: { rating: 'EXCEEDS', evidence: { kind: 'WPBA', id: ID } }, sop_intervention: { rating: 'MEETS', evidence: null } },
    })
    expect(snapshot).toEqual({ id: 'c1', traineeId: 't1', monthNumber: 9, formVersion: 1, status: 'DRAFT', rated: 2, withEvidence: 1 })
    expect(JSON.stringify(snapshot)).not.toMatch(/EXCEEDS|MEETS|sop_|WPBA/)
  })
})
