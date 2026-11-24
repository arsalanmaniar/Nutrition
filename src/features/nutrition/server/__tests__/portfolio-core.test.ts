import { describe, expect, it } from 'vitest'
import type { EpaLevel } from '@prisma/client'
import { EPA_LIST } from '../../config/epas'
import { VERIFICATION_ID_PATTERN } from '../../config/portfolio'
import { analyticsCsv, credentialAuditSnapshot, groupValue, newVerificationId, reachedMonth12, summativeStatus, type ProgramAnalytics } from '../portfolio-core'

// The pure Step 7 rules: the summative EPA target, month 12, the min-3 group
// rule, verification ids and the CSV.

const at = (day: string, created = 0) => ({ assessedOn: new Date(`${day}T00:00:00Z`), createdAt: new Date(Date.UTC(2026, 0, 1) + created) })
const allAt = (level: EpaLevel) => EPA_LIST.map((epa) => ({ epaName: epa.key, level, ...at('2026-04-01') }))

describe('summativeStatus: every configured EPA at E4 or E5 by its newest entry', () => {
  it.each(['E4', 'E5'] as const)('every EPA at %s: met', (level) => {
    expect(summativeStatus(allAt(level)).met).toBe(true)
  })

  it.each(['E1', 'E2', 'E3'] as const)('every EPA at %s: not met', (level) => {
    expect(summativeStatus(allAt(level)).met).toBe(false)
  })

  it('one EPA missing: not met, and that EPA has no level', () => {
    const status = summativeStatus(allAt('E5').slice(1))
    expect(status.met).toBe(false)
    expect(status.epas[0]).toEqual({ key: EPA_LIST[0].key, label: EPA_LIST[0].label, latest: null, meets: false })
  })

  it('the NEWEST entry decides: an older E5 does not count once a later E3 exists', () => {
    const rows = [...allAt('E5'), { epaName: EPA_LIST[2].key, level: 'E3' as const, ...at('2026-04-10') }]
    expect(summativeStatus(rows).met).toBe(false)
    expect(summativeStatus(rows).epas[2]).toMatchObject({ latest: 'E3', meets: false })
  })

  it('same day: the later-filed entry wins', () => {
    const rows = [...allAt('E4'), { epaName: EPA_LIST[0].key, level: 'E2' as const, ...at('2026-04-01', 5000) }]
    expect(summativeStatus(rows).epas[0].latest).toBe('E2')
  })
})

describe('reachedMonth12', () => {
  const now = new Date('2026-04-15T07:00:00Z')
  it.each([
    ['2025-04-20', true],
    ['2025-01-01', true],
    ['2025-06-01', false],
    ['2026-05-01', false],
  ])('start %s -> %s', (start, expected) => {
    expect(reachedMonth12(new Date(`${start}T00:00:00Z`), now)).toBe(expected)
  })

  it('no start date: false', () => {
    expect(reachedMonth12(null, now)).toBe(false)
  })
})

describe('groupValue: never a value for fewer than 3', () => {
  it.each([0, 1, 2])('%i -> only the size', (n) => {
    expect(groupValue(n, 99)).toEqual({ n, hidden: true })
  })
  it('3 -> the value, one decimal', () => {
    expect(groupValue(3, 72.345)).toEqual({ n: 3, hidden: false, value: 72.3 })
  })
})

describe('verification ids', () => {
  it('32 random bytes as base64url, never repeating', () => {
    const ids = Array.from({ length: 50 }, newVerificationId)
    for (const id of ids) {
      expect(id).toMatch(VERIFICATION_ID_PATTERN)
      expect(Buffer.from(id, 'base64url')).toHaveLength(32)
    }
    expect(new Set(ids).size).toBe(50)
  })

  it('the audit snapshot never carries the verification id', () => {
    const snapshot = credentialAuditSnapshot({
      id: 'c1',
      traineeId: 't1',
      type: 'COMPLETION',
      issuedAt: new Date('2026-04-15T07:00:00Z'),
      revokedAt: null,
      verificationId: 'secret',
    } as never)
    expect(snapshot).toEqual({ id: 'c1', traineeId: 't1', type: 'COMPLETION', issuedOn: '2026-04-15', revoked: false })
  })
})

describe('the metrics CSV', () => {
  it('has only metric, group and value columns, and says "not enough data" for hidden groups', () => {
    const hidden = { n: 1, hidden: true as const }
    const analytics: ProgramAnalytics = {
      traineesByStatus: [{ status: 'IN_TRAINING', count: { n: 4, hidden: false, value: 4 } }],
      level1: { form11Percent: hidden, form13Percent: { n: 3, hidden: false, value: 80 } },
      level2: [{ type: 'MINI_CEX', title: 'Mini-CEX', averageTotal: hidden, averagePercent: hidden }],
      level3: { mdgrsAverage: hidden, miniCexAverage: hidden },
      level4: { epaLevels: [{ level: 'E4', count: hidden }], summativeReached: hidden },
    }
    const lines = analyticsCsv(analytics).trim().split('\n')
    expect(lines[0]).toBe('metric,group,value')
    expect(lines).toContain('trainees_by_status,IN_TRAINING,4')
    expect(lines).toContain('level1_form_1_1_average_percent,all,not enough data')
    expect(lines).toContain('level1_form_1_3_average_percent,all,80')
    for (const line of lines) expect(line.split(',')).toHaveLength(3)
  })
})
