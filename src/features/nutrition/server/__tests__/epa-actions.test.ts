import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('../../auth/__tests__/fakes')).headersModule)
vi.mock('next/navigation', async () => (await import('../../auth/__tests__/fakes')).navigationModule)
vi.mock('@supabase/supabase-js', async () => (await import('../../auth/__tests__/fakes')).supabaseModule)
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./fake-prisma')).fakePrisma }))

import { resetState } from '../../auth/__tests__/fakes'
import { assignEpaLevel } from '../actions/epa'
import { IDLE, NON_PRECEPTOR_CALLERS, form, seedAssignment, seedProfile } from './actors'
import { TRAINEE_NOT_FOUND, epaForm, epaRows, seedEpa } from './epa-fixtures'
import { NOW, audit, pair, refusal, seedTrainee, signInAs } from './evaluation-fixtures'
import { fakePrisma } from './fake-prisma'
import { seedPlacement } from './wpba-fixtures'

// The EPA entrustment action (Step 6a): only the ACTIVE primary preceptor,
// under the trainee row lock; the level must fit the Miller level; every
// change is a new row; the audit row has no free text.

const LOCK_SQL = 'SELECT id FROM nutr_profile WHERE id = ? FOR UPDATE'
const assign = (fields: Record<string, string>) => assignEpaLevel(IDLE, form(fields))

beforeEach(() => {
  resetState()
  fakePrisma.reset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW) // noon in Karachi, 15 April 2026
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
})

afterEach(() => {
  // History is kept: an EPA row is never updated or deleted, and no audit row is changed.
  expect(
    fakePrisma.calls.filter(
      (call) => /^nutritionEpaAssessment\.(update|updateMany|upsert|delete|deleteMany)$/.test(call.op) || /^nutritionAuditLog\.(update|delete)/.test(call.op),
    ),
  ).toEqual([])
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('the active primary preceptor records a level', () => {
  it('creates a row with the server-set day and assessor, under the trainee row lock, audited without the notes', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    signInAs(preceptor)
    const result = await assign(epaForm(trainee.id, { level: 'E3', millerLevel: 'DOES', notes: 'Ran the feeding round alone.' }))
    expect(result).toEqual({ status: 'ok', message: 'EPA 1 (pending): E3 recorded.' })

    const [row] = epaRows()
    expect(row).toMatchObject({
      traineeId: trainee.id,
      assessorId: preceptor.id,
      epaName: 'EPA_01',
      level: 'E3',
      millerLevel: 'DOES',
      assessedOn: new Date('2026-04-15T00:00:00Z'),
      notes: 'Ran the feeding round alone.',
      createdBy: preceptor.authUserId,
    })
    // The trainee row lock is the transaction's first statement.
    expect(fakePrisma.calls.filter((call) => call.inTransaction)[0]).toEqual({ op: '$queryRaw', args: { sql: LOCK_SQL, values: [trainee.id] }, inTransaction: true })

    expect(audit()).toHaveLength(1)
    const entry = audit()[0]
    expect(entry).toMatchObject({ entity: 'NutritionEpaAssessment', entityId: row.id, action: 'create', actorId: preceptor.authUserId, before: null })
    expect(entry.after).toEqual({
      id: row.id,
      traineeId: trainee.id,
      assessorId: preceptor.id,
      epaName: 'EPA_01',
      level: 'E3',
      millerLevel: 'DOES',
      assessedOn: '2026-04-15',
    })
    expect(JSON.stringify(entry)).not.toContain('feeding round')
  })

  it('a change is a NEW row: the earlier level stays as history', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    const earlier = seedEpa(trainee.id, preceptor.id, { level: 'E2', millerLevel: 'SHOWS_HOW', assessedOn: '2026-03-01' })
    signInAs(preceptor)
    expect((await assign(epaForm(trainee.id, { level: 'E3', millerLevel: 'SHOWS_HOW' }))).status).toBe('ok')
    expect((await assign(epaForm(trainee.id, { level: 'E4', millerLevel: 'DOES' }))).status).toBe('ok')

    expect(epaRows().map((row) => row.level)).toEqual(['E2', 'E3', 'E4'])
    expect(epaRows()[0]).toEqual(earlier)
    expect(fakePrisma.writes().filter((call) => call.op.startsWith('nutritionEpaAssessment.')).map((call) => call.op)).toEqual([
      'nutritionEpaAssessment.create',
      'nutritionEpaAssessment.create',
    ])
  })

  it('client-sent assessor, day or author fields are ignored', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    const other = seedProfile('PRECEPTOR')
    signInAs(preceptor)
    await assign(epaForm(trainee.id, { assessorId: other.id, assessedOn: '2020-01-01', createdBy: 'someone-else' }))
    expect(epaRows()[0]).toMatchObject({ assessorId: preceptor.id, assessedOn: new Date('2026-04-15T00:00:00Z'), createdBy: preceptor.authUserId })
  })
})

describe('the Miller range rule (MILLER_EPA_TARGETS)', () => {
  it.each([
    ['E2', 'KNOWS', 'E2 (Direct supervision) is outside the range for Knows: use E1.'],
    ['E3', 'KNOWS_HOW', 'E3 (Indirect supervision) is outside the range for Knows How: use E1 to E2.'],
    ['E1', 'SHOWS_HOW', 'E1 (Observer) is outside the range for Shows How: use E2 to E3.'],
    ['E4', 'SHOWS_HOW', 'E4 (Unsupervised (spot-checked)) is outside the range for Shows How: use E2 to E3.'],
    ['E2', 'DOES', 'E2 (Direct supervision) is outside the range for Does: use E3 to E5.'],
  ])('%s at %s is refused with the allowed range, and nothing is written', async (level, millerLevel, message) => {
    const { trainee, preceptor } = pair('2026-01-01')
    signInAs(preceptor)
    expect(await assign(epaForm(trainee.id, { level, millerLevel }))).toEqual({ status: 'error', message, fieldErrors: { level: message } })
    expect(epaRows()).toEqual([])
    expect(audit()).toEqual([])
  })

  it.each([
    ['E1', 'KNOWS'],
    ['E2', 'KNOWS_HOW'],
    ['E3', 'SHOWS_HOW'],
    ['E3', 'DOES'],
    ['E5', 'DOES'],
  ])('%s at %s (an edge of its range) is accepted', async (level, millerLevel) => {
    const { trainee, preceptor } = pair('2026-01-01')
    signInAs(preceptor)
    expect((await assign(epaForm(trainee.id, { level, millerLevel }))).status).toBe('ok')
    expect(epaRows()).toHaveLength(1)
  })
})

describe('who may record a level: the ACTIVE primary preceptor only', () => {
  it('another preceptor, a former primary preceptor and a rotation preceptor get "not found", and nothing is written', async () => {
    const { trainee } = pair('2026-01-01')
    const stranger = seedProfile('PRECEPTOR')
    const former = seedProfile('PRECEPTOR')
    seedAssignment(trainee.id, former.id, false)
    const rotation = seedProfile('PRECEPTOR')
    seedPlacement(trainee.id, rotation.id, '2026-04-01')
    for (const caller of [stranger, former, rotation]) {
      signInAs(caller)
      expect(await assign(epaForm(trainee.id))).toEqual(TRAINEE_NOT_FOUND)
    }
    expect(epaRows()).toEqual([])
    expect(audit()).toEqual([])
  })

  it('a deactivated trainee, a non-trainee profile and an unknown id get "not found"', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    const inactive = seedTrainee('2026-01-01', { isActive: false })
    seedAssignment(inactive.id, preceptor.id)
    const notATrainee = seedProfile('UNIT_LEAD')
    seedAssignment(notATrainee.id, preceptor.id)
    signInAs(preceptor)
    for (const id of [inactive.id, notATrainee.id, '0b0c3e1e-6c1b-4c39-9a37-3f5c2f1f9a11']) {
      expect(await assign(epaForm(id))).toEqual(TRAINEE_NOT_FOUND)
    }
    expect(epaRows()).toEqual([])
    expect(trainee.id).toBeTruthy()
  })

  it.each(NON_PRECEPTOR_CALLERS)('$label is refused by the guard, before any read', async ({ signIn }) => {
    const { trainee } = pair('2026-01-01')
    signIn()
    expect(await refusal(assign(epaForm(trainee.id)))).toMatch(/^\/nutrition\//)
    expect(epaRows()).toEqual([])
    expect(fakePrisma.calls.filter((call) => call.op.startsWith('nutritionEpaAssessment.'))).toEqual([])
  })
})

describe('input and dates', () => {
  it.each([
    [{ epaKey: 'EPA_99' }, 'epaKey'],
    [{ epaKey: '' }, 'epaKey'],
    [{ level: 'E6' }, 'level'],
    [{ millerLevel: 'MASTERS' }, 'millerLevel'],
    [{ traineeId: 'not-an-id' }, 'traineeId'],
  ])('%j is refused on the field %s', async (extra, field) => {
    const { trainee, preceptor } = pair('2026-01-01')
    signInAs(preceptor)
    const result = await assign(epaForm(trainee.id, extra as Record<string, string>))
    expect(result.status).toBe('error')
    expect(Object.keys((result as { fieldErrors?: Record<string, string> }).fieldErrors ?? {})).toContain(field)
    expect(epaRows()).toEqual([])
  })

  it('notes with a patient identifier are refused', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    signInAs(preceptor)
    const result = await assign(epaForm(trainee.id, { notes: 'Seen with MRN 1234567 on the ward.' }))
    expect(result.status).toBe('error')
    expect(Object.keys((result as { fieldErrors?: Record<string, string> }).fieldErrors ?? {})).toEqual(['notes'])
    expect(epaRows()).toEqual([])
  })

  it('no start date, or a start date after today, is refused', async () => {
    const { trainee: noStart, preceptor } = pair(null)
    signInAs(preceptor)
    expect(await assign(epaForm(noStart.id))).toEqual({ status: 'error', message: "This trainee's training start date is not set yet." })
    const later = seedTrainee('2026-05-01')
    seedAssignment(later.id, preceptor.id)
    expect(await assign(epaForm(later.id))).toEqual({ status: 'error', message: "This trainee's training has not started yet." })
    expect(epaRows()).toEqual([])
  })
})
