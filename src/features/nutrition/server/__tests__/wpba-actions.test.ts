import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('../../auth/__tests__/fakes')).headersModule)
vi.mock('next/navigation', async () => (await import('../../auth/__tests__/fakes')).navigationModule)
vi.mock('@supabase/supabase-js', async () => (await import('../../auth/__tests__/fakes')).supabaseModule)
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./fake-prisma')).fakePrisma }))

import { resetState } from '../../auth/__tests__/fakes'
import * as wpbaActions from '../actions/wpba'
import { submitWpba } from '../actions/wpba'
import { IDLE, form, seedAssignment, seedProfile, signIn, signInAdmin, signInSuperAdmin } from './actors'
import { NOW, audit, pair, refusal, seedTrainee, signInAs } from './evaluation-fixtures'
import { fakePrisma } from './fake-prisma'
import {
  CASE_LOG_NOT_FOUND,
  DOUBLE_SUBMIT,
  NOT_ASSESSABLE,
  TODAY,
  itemKeys,
  seedCaseLog,
  seedPlacement,
  seedWpba,
  wpbaForm,
  wpbaRatings,
  wpbas,
} from './wpba-fixtures'

// Filing a workplace-based assessment (Step 5a): who may assess, the scores
// and the OSCE result from the server only, the CbD case log, dates, the
// double-submit guard, privacy and the audit row.

const LOCK_SQL = 'SELECT id FROM nutr_profile WHERE id = ? FOR UPDATE'
const file = (fields: Record<string, string>) => submitWpba(IDLE, form(fields))
const FEEDBACK = 'Clear history taking. Next time, summarise the feeding plan for the family before closing.'

beforeEach(() => {
  resetState()
  fakePrisma.reset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW) // noon in Karachi, 15 April 2026
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
})

afterEach(() => {
  // A WPBA is final: never updated or deleted; and no audit row is changed.
  expect(fakePrisma.calls.filter((call) => /^nutritionWpba\.(update|updateMany|delete|deleteMany)$/.test(call.op) || /^nutritionAuditLog\.update/.test(call.op))).toEqual([])
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('who may file: the active primary preceptor, or a rotation preceptor/assessor covering the day', () => {
  it('the primary preceptor files a Mini-CEX: scored and levelled by the server, under the trainee row lock, audited without feedback', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    signInAs(preceptor)
    expect(await file(wpbaForm('MINI_CEX', trainee.id))).toEqual({ status: 'ok', message: 'Mini-CEX submitted.' })

    const [row] = wpbas()
    expect(row).toMatchObject({
      type: 'MINI_CEX',
      formVersion: 1,
      traineeId: trainee.id,
      assessorId: preceptor.id,
      rotationEntryId: null,
      caseLogId: null,
      procedure: null,
      total: 40,
      maxScore: 45,
      passed: null,
      criticalError: null,
      millerLevel: 'SHOWS_HOW',
      feedback: FEEDBACK,
      assessedOn: new Date(`${TODAY}T00:00:00Z`),
      createdBy: preceptor.authUserId,
    })
    expect(row.scores).toEqual({ ratings: Object.fromEntries(itemKeys('MINI_CEX').map((key) => [key, 8])) })
    expect(fakePrisma.calls.filter((call) => call.inTransaction)[0]).toEqual({ op: '$queryRaw', args: { sql: LOCK_SQL, values: [trainee.id] }, inTransaction: true })

    expect(audit()).toHaveLength(1)
    const entry = audit()[0]
    expect(entry).toMatchObject({ entity: 'NutritionWpba', entityId: row.id, action: 'create', actorId: preceptor.authUserId, before: null })
    expect(Object.keys(entry.after as object).sort()).toEqual(
      ['assessedOn', 'assessorId', 'caseLogId', 'criticalError', 'formVersion', 'id', 'maxScore', 'millerLevel', 'passed', 'procedure', 'rotationEntryId', 'total', 'traineeId', 'type'].sort(),
    )
    const text = JSON.stringify(entry)
    expect(text).not.toContain('history taking')
    for (const key of itemKeys('MINI_CEX')) expect(text).not.toContain(key)
  })

  it.each([
    ['a PRECEPTOR, open-ended placement', 'PRECEPTOR', '2026-03-01', null],
    ['an ASSESSOR, placement covering the day', 'ASSESSOR', '2026-04-01', '2026-04-30'],
    ['a PRECEPTOR, placement starting that day', 'PRECEPTOR', TODAY, '2026-05-15'],
    ['an ASSESSOR, placement ending that day', 'ASSESSOR', '2026-03-15', TODAY],
  ] as const)('a rotation assessor may file: %s; the WPBA records the placement', async (_label, role, start, end) => {
    const { trainee } = pair('2026-01-01')
    const assessor = seedProfile(role)
    const placement = seedPlacement(trainee.id, assessor.id, start, end)
    signInAs(assessor)
    expect(await file(wpbaForm('DOPS', trainee.id))).toEqual({ status: 'ok', message: 'DOPS submitted.' })
    expect(wpbas()[0]).toMatchObject({ assessorId: assessor.id, rotationEntryId: placement.id, millerLevel: 'DOES', total: 4, maxScore: 5 })
  })

  it.each([
    ['a preceptor with no link to the trainee', () => ({ caller: seedProfile('PRECEPTOR') })],
    [
      'a former primary preceptor (assignment ended)',
      (traineeId: string) => {
        const caller = seedProfile('PRECEPTOR')
        seedAssignment(traineeId, caller.id, false)
        return { caller }
      },
    ],
    [
      "a rotation preceptor of another trainee's placement",
      () => {
        const caller = seedProfile('PRECEPTOR')
        seedPlacement(seedTrainee('2026-01-01').id, caller.id, '2026-01-01')
        return { caller }
      },
    ],
    [
      'a placement that starts after the day assessed',
      (traineeId: string) => {
        const caller = seedProfile('ASSESSOR')
        seedPlacement(traineeId, caller.id, '2026-04-16')
        return { caller }
      },
    ],
    [
      'a placement that ended before the day assessed',
      (traineeId: string) => {
        const caller = seedProfile('ASSESSOR')
        seedPlacement(traineeId, caller.id, '2026-02-01', '2026-04-14')
        return { caller }
      },
    ],
    ['an assessor with no placement', () => ({ caller: seedProfile('ASSESSOR') })],
  ])('refused for %s: not found, nothing written', async (_label, setup) => {
    const { trainee } = pair('2026-01-01')
    const { caller } = setup(trainee.id)
    signInAs(caller)
    expect(await file(wpbaForm('MINI_CEX', trainee.id))).toEqual(NOT_ASSESSABLE)
    expect(wpbas()).toEqual([])
    expect(audit()).toEqual([])
  })

  it('refused for a trainee who is deactivated, an id that is not a trainee, and an unknown id', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    signInAs(preceptor)
    fakePrisma.tables.nutritionProfile.find((p) => p.id === trainee.id)!.isActive = false
    expect(await file(wpbaForm('MINI_CEX', trainee.id))).toEqual(NOT_ASSESSABLE)
    expect(await file(wpbaForm('MINI_CEX', preceptor.id))).toEqual(NOT_ASSESSABLE)
    expect(await file(wpbaForm('MINI_CEX', '6f1c2b8e-4a3d-4f5e-9b7a-1c2d3e4f5a6b'))).toEqual(NOT_ASSESSABLE)
    expect(wpbas()).toEqual([])
  })

  it.each([
    ['a TRAINEE', () => void signInAs(seedTrainee('2026-01-01'))],
    ['a UNIT_LEAD', () => void signInAs(seedProfile('UNIT_LEAD'))],
    ['an ADMIN with a profile', () => void signInAdmin()],
    ['a super_admin without a profile', () => void signInSuperAdmin()],
    [
      'a deactivated PRECEPTOR',
      () => {
        const p = seedProfile('PRECEPTOR', { isActive: false })
        signIn(p.authUserId as string, p.email)
      },
    ],
  ])('%s is refused by the guard, nothing written', async (_label, signInCaller) => {
    const { trainee } = pair('2026-01-01')
    signInCaller()
    expect(await refusal(file(wpbaForm('MINI_CEX', trainee.id)))).toBe('/nutrition/no-access')
    expect(wpbas()).toEqual([])
  })
})

describe('scores, the OSCE result and the Miller level come only from the server', () => {
  it('client-sent total, maxScore, passed, failReasons, millerLevel, EPA and ids are ignored', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    const other = seedProfile('PRECEPTOR')
    signInAs(preceptor)
    const result = await file({
      ...wpbaForm('OSCE', trainee.id),
      ...wpbaRatings('OSCE', 3),
      total: '25',
      maxScore: '25',
      passed: 'true',
      failReasons: '[]',
      millerLevel: 'DOES',
      suggestedEpa: 'E5',
      percentage: '100',
      formVersion: '9',
      assessorId: other.id,
      rotationEntryId: '6f1c2b8e-4a3d-4f5e-9b7a-1c2d3e4f5a6b',
      createdBy: 'someone-else',
    })
    expect(result).toEqual({ status: 'ok', message: 'OSCE submitted.' })
    expect(wpbas()[0]).toMatchObject({
      total: 15,
      maxScore: 25,
      passed: false,
      millerLevel: 'SHOWS_HOW',
      formVersion: 1,
      assessorId: preceptor.id,
      rotationEntryId: null,
      createdBy: preceptor.authUserId,
      scores: expect.objectContaining({ failReasons: ['BELOW_PASS_MARK'] }),
    })
  })

  // [ratings, critical error, total, passed, reasons]
  it.each([
    [[4, 4, 4, 3, 3], false, 18, true, []],
    [[4, 4, 3, 3, 3], false, 17, false, ['BELOW_PASS_MARK']],
    [[5, 5, 5, 5, 5], true, 25, false, ['CRITICAL_ERROR']],
    [[4, 4, 3, 3, 3], true, 17, false, ['BELOW_PASS_MARK', 'CRITICAL_ERROR']],
  ] as const)('OSCE %j, critical error %s: total %i, passed %s, reasons %j', async (ratings, critical, total, passed, reasons) => {
    const { trainee, preceptor } = pair('2026-01-01')
    signInAs(preceptor)
    const fields = { ...wpbaForm('OSCE', trainee.id), ...wpbaRatings('OSCE', ratings), ...(critical ? { criticalError: 'on' } : {}) }
    expect(await file(fields)).toMatchObject({ status: 'ok' })
    expect(wpbas()[0]).toMatchObject({ total, maxScore: 25, passed, criticalError: critical, scores: expect.objectContaining({ failReasons: reasons }) })
    expect(audit()[0].after).toMatchObject({ total, passed, criticalError: critical })
  })

  it('a critical-error flag on any other type is ignored: no pass or fail', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    signInAs(preceptor)
    expect(await file({ ...wpbaForm('MINI_CEX', trainee.id), criticalError: 'on' })).toMatchObject({ status: 'ok' })
    expect(wpbas()[0]).toMatchObject({ passed: null, criticalError: null })
    expect(wpbas()[0].scores).toEqual({ ratings: expect.any(Object) })
  })

  it.each([
    ['an unknown item', { 'rating.not_an_item': '5' }, 'rating.not_an_item', 'This is not an item of this assessment.'],
    ['a 10 on the 9-point scale', { 'rating.clinical_reasoning': '10' }, 'rating.clinical_reasoning', 'Pick a rating from the scale.'],
    ['a 0', { 'rating.clinical_reasoning': '0' }, 'rating.clinical_reasoning', 'Pick a rating from the scale.'],
    ['a fraction', { 'rating.clinical_reasoning': '7.5' }, 'rating.clinical_reasoning', 'Pick a rating from the scale.'],
    ['a missing item', { 'rating.clinical_reasoning': '' }, 'rating.clinical_reasoning', 'Rate this item.'],
  ])('refuses %s, nothing written', async (_label, override, name, message) => {
    const { trainee, preceptor } = pair('2026-01-01')
    signInAs(preceptor)
    expect(await file({ ...wpbaForm('MINI_CEX', trainee.id), ...override })).toEqual({
      status: 'error',
      message: 'Check the highlighted fields.',
      fieldErrors: { [name]: message },
    })
    expect(wpbas()).toEqual([])
  })
})

describe("CbD: must discuss one of the trainee's SUBMITTED or APPROVED case logs", () => {
  it.each(['SUBMITTED', 'APPROVED'] as const)('a %s log is accepted and linked; CbD is scored /25 at Knows How', async (status) => {
    const { trainee, preceptor } = pair('2026-01-01')
    const log = seedCaseLog(trainee.id, status)
    signInAs(preceptor)
    expect(await file(wpbaForm('CBD', trainee.id, { caseLogId: log.id as string }))).toEqual({ status: 'ok', message: 'CbD submitted.' })
    expect(wpbas()[0]).toMatchObject({ caseLogId: log.id, total: 20, maxScore: 25, millerLevel: 'KNOWS_HOW', passed: null })
  })

  it.each([
    ['a DRAFT log', (traineeId: string) => seedCaseLog(traineeId, 'DRAFT').id],
    ['a returned (REJECTED) log', (traineeId: string) => seedCaseLog(traineeId, 'REJECTED').id],
    ["another trainee's submitted log", () => seedCaseLog(seedTrainee('2026-01-01').id, 'SUBMITTED').id],
    ['a log that does not exist', () => '6f1c2b8e-4a3d-4f5e-9b7a-1c2d3e4f5a6b'],
  ])('refused with the same "not found" for %s, nothing written', async (_label, logFor) => {
    const { trainee, preceptor } = pair('2026-01-01')
    const caseLogId = logFor(trainee.id) as string
    signInAs(preceptor)
    expect(await file(wpbaForm('CBD', trainee.id, { caseLogId }))).toEqual(CASE_LOG_NOT_FOUND)
    expect(wpbas()).toEqual([])
    expect(audit()).toEqual([])
  })

  it('a CbD needs a case log, and only a CbD may have one', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    const log = seedCaseLog(trainee.id)
    signInAs(preceptor)
    expect(await file(wpbaForm('CBD', trainee.id))).toMatchObject({ status: 'error', fieldErrors: { caseLogId: 'Pick the submitted case log under discussion.' } })
    expect(await file(wpbaForm('MINI_CEX', trainee.id, { caseLogId: log.id as string }))).toMatchObject({
      status: 'error',
      fieldErrors: { caseLogId: 'Only a CbD links a case log.' },
    })
    expect(wpbas()).toEqual([])
  })
})

describe('DOPS: one procedure, or "other" with a required, identifier-checked description', () => {
  it('stores a listed key, or the description for "other"; the audit row says only "other"', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    signInAs(preceptor)
    expect(await file(wpbaForm('DOPS', trainee.id, { procedure: 'diet_formulation' }))).toMatchObject({ status: 'ok' })
    expect(await file(wpbaForm('DOPS', trainee.id, { procedure: 'other', procedureOther: 'Nasogastric tube placement check' }))).toMatchObject({ status: 'ok' })
    expect(wpbas().map((row) => row.procedure)).toEqual(['diet_formulation', 'Nasogastric tube placement check'])
    expect(audit().map((row) => (row.after as { procedure: string }).procedure)).toEqual(['diet_formulation', 'other'])
    expect(JSON.stringify(audit())).not.toContain('Nasogastric')
  })

  it.each([
    ['"other" with no description', { procedure: 'other' }, 'procedureOther', 'Describe the procedure.'],
    ['an unknown procedure', { procedure: 'liver_biopsy' }, 'procedure', 'Pick the procedure observed.'],
    ['no procedure', { procedure: '' }, 'procedure', 'Pick the procedure observed.'],
    ['a description with a phone number', { procedure: 'other', procedureOther: 'Called the mother on 0300 1234567' }, 'procedureOther', expect.stringContaining('phone number')],
  ])('refuses %s', async (_label, extra, name, message) => {
    const { trainee, preceptor } = pair('2026-01-01')
    signInAs(preceptor)
    expect(await file(wpbaForm('DOPS', trainee.id, extra))).toMatchObject({ status: 'error', fieldErrors: { [name]: message } })
    expect(wpbas()).toEqual([])
  })

  it('a procedure on any other type is refused', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    signInAs(preceptor)
    expect(await file(wpbaForm('MINI_CEX', trainee.id, { procedure: 'growth_plotting' }))).toMatchObject({
      status: 'error',
      fieldErrors: { procedure: 'Only a DOPS records a procedure.' },
    })
  })
})

describe('the day assessed: not in the future (Karachi), not before training started', () => {
  it('today is accepted; tomorrow is refused, nothing written', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    signInAs(preceptor)
    expect(await file(wpbaForm('MINI_CEX', trainee.id, { assessedOn: '2026-04-16' }))).toEqual({
      status: 'error',
      message: 'The assessment date cannot be in the future.',
      fieldErrors: { assessedOn: 'The assessment date cannot be in the future.' },
    })
    expect(wpbas()).toEqual([])
    expect(await file(wpbaForm('MINI_CEX', trainee.id))).toMatchObject({ status: 'ok' })
  })

  it('"today" is the Karachi day: at 00:30 in Karachi (19:30 UTC the day before) the new day is already allowed', async () => {
    vi.setSystemTime(new Date('2026-04-15T19:30:00Z'))
    const { trainee, preceptor } = pair('2026-01-01')
    signInAs(preceptor)
    expect(await file(wpbaForm('MINI_CEX', trainee.id, { assessedOn: '2026-04-16' }))).toMatchObject({ status: 'ok' })
  })

  it.each([
    ['before the training start date', '2026-03-01', '2026-02-28', { status: 'error', message: 'The assessment date is before the trainee started training.', fieldErrors: { assessedOn: 'Before the training start date.' } }],
    ['with no training start date', null, TODAY, { status: 'error', message: "This trainee's training start date is not set yet." }],
    ['a malformed date', '2026-01-01', '15/04/2026', { status: 'error', fieldErrors: { assessedOn: 'Use a date like 2026-10-11.' } }],
    ['an impossible date', '2026-01-01', '2026-02-30', { status: 'error', fieldErrors: { assessedOn: 'Use a date like 2026-10-11.' } }],
  ] as const)('refused %s', async (_label, start, assessedOn, expected) => {
    const { trainee, preceptor } = pair(start)
    signInAs(preceptor)
    expect(await file(wpbaForm('MINI_CEX', trainee.id, { assessedOn }))).toMatchObject(expected)
    expect(wpbas()).toEqual([])
  })
})

describe('double-submit guard: the identical WPBA within 60 seconds', () => {
  it('a second identical submit is refused; after 60 seconds it is filed again', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    signInAs(preceptor)
    const fields = wpbaForm('MINI_CEX', trainee.id)
    expect(await file(fields)).toMatchObject({ status: 'ok' })
    vi.setSystemTime(new Date(NOW.getTime() + 59_000))
    expect(await file(fields)).toEqual(DOUBLE_SUBMIT)
    expect(wpbas()).toHaveLength(1)
    vi.setSystemTime(new Date(NOW.getTime() + 61_000))
    signInAs(preceptor)
    expect(await file(fields)).toMatchObject({ status: 'ok' })
    expect(wpbas()).toHaveLength(2)
  })

  it('a different assessment straight away is filed: repeated Mini-CEX are normal', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    signInAs(preceptor)
    expect(await file(wpbaForm('MINI_CEX', trainee.id))).toMatchObject({ status: 'ok' })
    expect(await file({ ...wpbaForm('MINI_CEX', trainee.id), ...wpbaRatings('MINI_CEX', 6) })).toMatchObject({ status: 'ok' })
    expect(await file({ ...wpbaForm('MINI_CEX', trainee.id), feedback: 'Second observation, different case.' })).toMatchObject({ status: 'ok' })
    expect(wpbas()).toHaveLength(3)
  })

  it('matches however the stored JSON orders its keys (Postgres jsonb does not keep key order)', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    const reversed = Object.fromEntries([...itemKeys('MINI_CEX')].reverse().map((key) => [key, 8]))
    fakePrisma.seed('nutritionWpba', {
      type: 'MINI_CEX',
      formVersion: 1,
      traineeId: trainee.id,
      assessorId: preceptor.id,
      scores: { ratings: reversed },
      total: 40,
      maxScore: 45,
      millerLevel: 'SHOWS_HOW',
      feedback: FEEDBACK,
      assessedOn: new Date(`${TODAY}T00:00:00Z`),
      createdBy: preceptor.authUserId,
    })
    signInAs(preceptor)
    expect(await file(wpbaForm('MINI_CEX', trainee.id))).toEqual(DOUBLE_SUBMIT)
  })

  it("another assessor's identical assessment is not a double submit", async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    const rotation = seedProfile('ASSESSOR')
    seedPlacement(trainee.id, rotation.id, '2026-04-01')
    seedWpba('MINI_CEX', trainee.id, preceptor.id, { feedback: FEEDBACK, createdAt: NOW })
    signInAs(rotation)
    expect(await file(wpbaForm('MINI_CEX', trainee.id))).toMatchObject({ status: 'ok' })
  })
})

describe('feedback: required and identifier-checked; a WPBA cannot be changed afterwards', () => {
  it.each([
    ['no feedback', { feedback: '   ' }, 'Write your feedback.'],
    ['an email address', { feedback: 'Send notes to mother@example.com' }, expect.stringContaining('email address')],
    ['an MRN-like number', { feedback: 'Patient 12345678 was seen.' }, expect.stringContaining('ID number')],
  ])('refuses %s', async (_label, extra, message) => {
    const { trainee, preceptor } = pair('2026-01-01')
    signInAs(preceptor)
    expect(await file(wpbaForm('MINI_CEX', trainee.id, extra))).toMatchObject({ status: 'error', fieldErrors: { feedback: message } })
    expect(wpbas()).toEqual([])
  })

  it('the actions module offers filing only: no edit, no correction, no delete', () => {
    expect(Object.keys(wpbaActions)).toEqual(['submitWpba'])
  })
})
