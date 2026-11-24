import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('../../auth/__tests__/fakes')).headersModule)
vi.mock('next/navigation', async () => (await import('../../auth/__tests__/fakes')).navigationModule)
vi.mock('@supabase/supabase-js', async () => (await import('../../auth/__tests__/fakes')).supabaseModule)
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./fake-prisma')).fakePrisma }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createHash } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import type { ActionResult } from '@/features/nutrition/lib/action-result'
import { RedirectSignal, resetState } from '../../auth/__tests__/fakes'
import { createCaseLog, submitCaseLog, updateCaseLog } from '../actions/case-logs'
import { getMyCaseLog, listLogbookRotations, listMyCaseLogs } from '../queries/case-logs'
import { IDLE, NON_TRAINEE_CALLERS, form, isGuardRead, seedProfile, signInTrainee } from './actors'
import { fakePrisma } from './fake-prisma'

// The trainee's e-logbook: server actions and loaders, against the in-memory
// Prisma fake, with the real guard in front of them (see actors.ts).

const LOGBOOK = '/nutrition/trainee/logbook'
const NOW = new Date('2026-10-11T08:00:00Z')
const MISSING_ID = '6f1c2b8e-4a3d-4f5e-9b7a-1c2d3e4f5a6b'
const NOT_FOUND = { status: 'error', message: 'This case log was not found.' }
const CHECK_FIELDS = 'Check the highlighted fields.'

const TEXT = {
  assessment: 'Weight 72.5 kg, BMI 26.6; eating half of each meal for two weeks.',
  diagnosis: 'Inadequate oral intake related to nausea, as evidenced by intake below 50% of needs.',
  intervention: 'Small frequent meals; energy 1800 to 2000 kcal/day; protein 1.2 g/kg/day.',
  monitoring_evaluation: 'Weigh weekly; review intake and nausea in 7 days.',
}
const ALL_FIELDS = 'assessment,diagnosis,intervention,monitoring_evaluation'

type Row = Record<string, unknown>
const logs = () => fakePrisma.tables.nutritionCaseLog
const audit = () => fakePrisma.tables.nutritionAuditLog
const snapshot = (value: unknown) => value as Row

let rotation: { id: string }

const seedRotation = (name: string, isActive = true) =>
  fakePrisma.seed('nutritionRotation', { name, isActive, createdBy: 'auth-seed' }) as { id: string }

function seedLog(traineeId: string, fields: Row = {}) {
  return fakePrisma.seed('nutritionCaseLog', {
    traineeId,
    rotationId: rotation.id,
    caseCode: 'C-2026-001',
    ageBand: '40_59y',
    diagnosisCategory: 'placeholder_renal',
    formType: 'A',
    formVersion: 1,
    data: { ...TEXT },
    epaLevel: 'E2',
    createdBy: 'auth-seed',
    ...fields,
  }) as { id: string }
}

/** A complete Form A, as the case-log form posts it. */
function fields(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    formType: 'A',
    rotationId: rotation.id,
    ageBand: '40_59y',
    diagnosisCategory: 'placeholder_renal',
    epaLevel: 'E2',
    ...Object.fromEntries(Object.entries(TEXT).map(([key, value]) => [`data.${key}`, value])),
    ...overrides,
  }
}

const blankText = (value = '') => Object.fromEntries(Object.keys(TEXT).map((key) => [`data.${key}`, value]))

/** An action's result, or where it redirected (createCaseLog opens the new log). */
async function outcome(attempt: Promise<ActionResult>): Promise<ActionResult | { redirect: string }> {
  try {
    return await attempt
  } catch (error) {
    if (error instanceof RedirectSignal) return { redirect: error.path }
    throw error
  }
}

const create = (overrides: Record<string, string> = {}) => outcome(createCaseLog(IDLE, form(fields(overrides))))
const update = (logId: string, overrides: Record<string, string> = {}) =>
  outcome(updateCaseLog(IDLE, form({ logId, ...fields(overrides) })))
const submit = (logId: string, overrides: Record<string, string> = {}) =>
  outcome(submitCaseLog(IDLE, form({ logId, ...fields(overrides) })))

/** Where the guard sent the caller; fails if the call went through. */
async function refusal(attempt: Promise<unknown>): Promise<string> {
  try {
    await attempt
  } catch (error) {
    if (error instanceof RedirectSignal) return error.path
    throw error
  }
  throw new Error('expected the guard to refuse, but the call went through')
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  resetState()
  fakePrisma.reset()
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
  vi.mocked(revalidatePath).mockReset()
  rotation = seedRotation('Nephrology')
})

afterEach(() => {
  expect(fakePrisma.calls.filter((call) => /\.delete(Many)?$/.test(call.op))).toEqual([])
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('createCaseLog', () => {
  it('creates a DRAFT with a server-made case code and the trimmed text, audited without the text, then opens it', async () => {
    const me = signInTrainee()
    const result = await create({ 'data.assessment': `   ${TEXT.assessment}  ` })

    const log = logs()[0]
    expect(result).toEqual({ redirect: `${LOGBOOK}/${log.id}` })
    expect(logs()).toEqual([
      expect.objectContaining({
        traineeId: me.id,
        caseCode: 'C-2026-001',
        status: 'DRAFT',
        formType: 'A',
        formVersion: 1,
        rotationId: rotation.id,
        ageBand: '40_59y',
        diagnosisCategory: 'placeholder_renal',
        epaLevel: 'E2',
        data: TEXT,
        createdBy: me.authUserId,
        submittedAt: null,
      }),
    ])
    expect(audit()).toEqual([
      expect.objectContaining({ entity: 'NutritionCaseLog', entityId: log.id, action: 'create', actorId: me.authUserId, before: null }),
    ])
    expect(snapshot(audit()[0].after)).toMatchObject({ caseCode: 'C-2026-001', status: 'DRAFT', dataFields: ALL_FIELDS })
    expect(fakePrisma.writes().every((write) => write.inTransaction)).toBe(true)
    expect(revalidatePath).toHaveBeenCalledWith(LOGBOOK)
  })

  it('the server sets the case code, owner, status and version: those fields in the form are ignored', async () => {
    const other = seedProfile('TRAINEE')
    const me = signInTrainee()
    await create({
      caseCode: 'C-1999-999',
      traineeId: other.id,
      status: 'APPROVED',
      createdBy: 'auth-someone-else',
      formVersion: '99',
      submittedAt: '2026-01-01',
    })
    expect(logs()).toEqual([
      expect.objectContaining({ traineeId: me.id, caseCode: 'C-2026-001', status: 'DRAFT', createdBy: me.authUserId, formVersion: 1, submittedAt: null }),
    ])
  })

  it("numbers run per trainee and carry on across years; another trainee's codes do not count", async () => {
    const other = seedProfile('TRAINEE')
    seedLog(other.id, { caseCode: 'C-2026-050' })
    const me = signInTrainee()
    seedLog(me.id, { caseCode: 'C-2025-007' })
    await create()
    expect(logs().filter((log) => log.traineeId === me.id).map((log) => log.caseCode)).toEqual(['C-2025-007', 'C-2026-008'])
  })

  it('the year is the year in Karachi: at 19:30 UTC on 31 December it is already the new year there', async () => {
    vi.setSystemTime(new Date('2026-12-31T19:30:00Z'))
    signInTrainee()
    await create()
    expect(logs()[0].caseCode).toBe('C-2027-001')
  })

  it('two quick creates by the same trainee get different case codes: the second waits for the row lock', async () => {
    const me = signInTrainee()
    const results = await Promise.all([create(), create()])

    expect(results).toEqual([
      { redirect: expect.stringMatching(`^${LOGBOOK}/`) },
      { redirect: expect.stringMatching(`^${LOGBOOK}/`) },
    ])
    expect(logs().map((log) => log.caseCode).sort()).toEqual(['C-2026-001', 'C-2026-002'])
    // Both locked the trainee's own row, and the second read the existing
    // codes only after the first had written its log.
    const locks = fakePrisma.calls.filter((call) => call.op === '$queryRaw' && (call.args as { sql: string }).sql.includes('nutr_profile'))
    expect(locks.map((call) => [(call.args as { values: unknown[] }).values, call.inTransaction])).toEqual([
      [[me.id], true],
      [[me.id], true],
    ])
    const ops = fakePrisma.calls.map((call) => call.op)
    const codeReads = ops.flatMap((op, index) => (op === 'nutritionCaseLog.findMany' ? [index] : []))
    expect(codeReads).toHaveLength(2)
    expect(codeReads[1]).toBeGreaterThan(ops.indexOf('nutritionCaseLog.create'))
  })

  it('a draft may leave the rotation, the EPA level and every field empty', async () => {
    signInTrainee()
    expect(await create({ rotationId: '', epaLevel: '', ...blankText('   ') })).toEqual({ redirect: expect.any(String) })
    expect(logs()[0]).toMatchObject({ rotationId: null, epaLevel: null, data: {} })
    expect(snapshot(audit()[0].after)).toMatchObject({ dataFields: '' })
  })

  it('the age band and the diagnosis category are needed even for a draft', async () => {
    signInTrainee()
    expect(await create({ ageBand: '', diagnosisCategory: 'not_a_category' })).toEqual({
      status: 'error',
      message: CHECK_FIELDS,
      fieldErrors: { ageBand: 'Pick an age band.', diagnosisCategory: 'Pick a diagnosis category.' },
    })
    expect(fakePrisma.writes()).toEqual([])
  })

  it('a retired, unknown or malformed rotation is refused', async () => {
    signInTrainee()
    const retired = seedRotation('Burns Unit', false)
    const notActive = { status: 'error', message: 'Pick an active rotation.', fieldErrors: { rotationId: 'Not an active rotation.' } }
    expect(await create({ rotationId: retired.id })).toEqual(notActive)
    expect(await create({ rotationId: MISSING_ID })).toEqual(notActive)
    expect(await create({ rotationId: 'not-an-id' })).toMatchObject({ fieldErrors: { rotationId: 'Pick a rotation from the list.' } })
    expect(fakePrisma.writes()).toEqual([])
  })

  it('an unknown form type is refused before the database is touched', async () => {
    signInTrainee()
    expect(await create({ formType: 'E' })).toEqual({ status: 'error', message: CHECK_FIELDS, fieldErrors: { formType: 'Pick a form: A, B, C or D.' } })
    expect(fakePrisma.calls.filter((call) => !isGuardRead(call))).toEqual([])
  })

  it('a field over its length limit is refused', async () => {
    signInTrainee()
    expect(await create({ 'data.assessment': 'a'.repeat(4001) })).toMatchObject({
      fieldErrors: { 'data.assessment': 'Keep this under 4000 characters.' },
    })
    expect(fakePrisma.writes()).toEqual([])
  })
})

describe('the patient-identifier rule, through the actions', () => {
  it('an identifier in any field is refused on that field, at draft and at submit, and nothing is stored', async () => {
    const me = signInTrainee()
    expect(await create({ 'data.assessment': 'Mother reachable on 0300-1234567', 'data.intervention': 'Leaflet at www.example.com' })).toEqual({
      status: 'error',
      message: CHECK_FIELDS,
      fieldErrors: {
        'data.assessment':
          '"0300-1234567" looks like a phone number. Remove it. A range or a date can be written another way, e.g. "1800 to 2000" or "11 Oct".',
        'data.intervention': '"www.example.com" looks like a web address. Remove it.',
      },
    })

    const log = seedLog(me.id)
    expect(await update(log.id, { 'data.diagnosis': 'MRN 1234567' })).toMatchObject({
      fieldErrors: { 'data.diagnosis': expect.stringContaining('looks like an MRN') },
    })
    expect(await submit(log.id, { 'data.monitoring_evaluation': 'CNIC 42101-1234567-1' })).toMatchObject({
      fieldErrors: { 'data.monitoring_evaluation': '"42101-1234567-1" looks like a CNIC number. Remove it.' },
    })
    expect(await submit(log.id, { 'data.assessment': 'Daughter: someone@example.com' })).toMatchObject({
      fieldErrors: { 'data.assessment': expect.stringContaining('looks like an email address') },
    })

    expect(fakePrisma.writes()).toEqual([])
    expect(logs()).toHaveLength(1)
    expect(logs()[0]).toMatchObject({ status: 'DRAFT', data: TEXT })
  })
})

describe('updateCaseLog', () => {
  it('saves my own draft, audited before and after without the text', async () => {
    const me = signInTrainee()
    const log = seedLog(me.id)
    expect(await update(log.id, { 'data.assessment': 'Weight 71 kg; appetite improving.', epaLevel: 'E3' })).toEqual({
      status: 'ok',
      message: 'Saved.',
    })
    expect(logs()[0]).toMatchObject({ status: 'DRAFT', epaLevel: 'E3', data: { ...TEXT, assessment: 'Weight 71 kg; appetite improving.' } })

    expect(audit()).toEqual([expect.objectContaining({ action: 'update', entityId: log.id, actorId: me.authUserId })])
    const [before, after] = [snapshot(audit()[0].before), snapshot(audit()[0].after)]
    expect([before.epaLevel, after.epaLevel]).toEqual(['E2', 'E3'])
    expect(after.dataSha256).not.toBe(before.dataSha256)
    expect(revalidatePath).toHaveBeenCalledWith(`${LOGBOOK}/${log.id}`)
  })

  it('no change: "No changes to save." and nothing written', async () => {
    const me = signInTrainee()
    const log = seedLog(me.id)
    expect(await update(log.id)).toEqual({ status: 'ok', message: 'No changes to save.' })
    expect(fakePrisma.writes()).toEqual([])
  })

  it('a REJECTED log can be edited, and stays REJECTED until it is resubmitted', async () => {
    const me = signInTrainee()
    const log = seedLog(me.id, { status: 'REJECTED' })
    expect(await update(log.id, { 'data.diagnosis': 'A fuller PES statement.' })).toEqual({ status: 'ok', message: 'Saved.' })
    expect(logs()[0]).toMatchObject({ status: 'REJECTED', data: { ...TEXT, diagnosis: 'A fuller PES statement.' } })
  })

  it.each([
    ['SUBMITTED', 'This case log has been submitted and can no longer be changed.'],
    ['APPROVED', 'This case log has been approved and can no longer be changed.'],
  ])('a %s log is refused, unchanged, with no audit row', async (status, message) => {
    const me = signInTrainee()
    const log = seedLog(me.id, { status })
    const stored = structuredClone(logs()[0])
    expect(await update(log.id, { 'data.assessment': 'Changed later.' })).toEqual({ status: 'error', message })
    expect(logs()[0]).toEqual(stored)
    expect(fakePrisma.writes()).toEqual([])
  })

  it("the form type must be the log's own", async () => {
    const me = signInTrainee()
    const log = seedLog(me.id)
    expect(await update(log.id, { formType: 'B', 'data.assessment': 'Changed.' })).toEqual({
      status: 'error',
      message: 'This case log uses a different form. Reload the page and try again.',
    })
    expect(fakePrisma.writes()).toEqual([])
  })

  it('keeps a rotation retired after the log chose it, but refuses a switch to another retired one', async () => {
    const me = signInTrainee()
    const retiredSince = seedRotation('Old Ward', false)
    const otherRetired = seedRotation('Closed Clinic', false)
    const log = seedLog(me.id, { rotationId: retiredSince.id })
    expect(await update(log.id, { rotationId: retiredSince.id, 'data.assessment': 'Updated.' })).toEqual({ status: 'ok', message: 'Saved.' })
    expect(await update(log.id, { rotationId: otherRetired.id })).toMatchObject({ status: 'error', message: 'Pick an active rotation.' })
    expect(logs()[0].rotationId).toBe(retiredSince.id)
  })
})

describe('submitCaseLog', () => {
  it('submits my draft with the changes in the form: SUBMITTED, submittedAt now, audited as submit', async () => {
    const me = signInTrainee()
    const log = seedLog(me.id)
    expect(await submit(log.id, { 'data.intervention': 'Oral nutrition supplement twice daily.' })).toEqual({
      status: 'ok',
      message: 'Submitted for review.',
    })
    expect(logs()[0]).toMatchObject({ status: 'SUBMITTED', submittedAt: NOW, data: { ...TEXT, intervention: 'Oral nutrition supplement twice daily.' } })
    expect(audit()).toEqual([expect.objectContaining({ action: 'submit', entityId: log.id, actorId: me.authUserId })])
    expect([snapshot(audit()[0].before).status, snapshot(audit()[0].after).status]).toEqual(['DRAFT', 'SUBMITTED'])
  })

  it('resubmits a REJECTED log, audited as resubmit', async () => {
    const me = signInTrainee()
    const log = seedLog(me.id, { status: 'REJECTED' })
    expect(await submit(log.id)).toEqual({ status: 'ok', message: 'Resubmitted for review.' })
    expect(logs()[0].status).toBe('SUBMITTED')
    expect(audit().map((row) => row.action)).toEqual(['resubmit'])
  })

  it('to submit, the rotation, the EPA level and every required field are needed', async () => {
    const me = signInTrainee()
    const log = seedLog(me.id, { rotationId: null, epaLevel: null, data: {} })
    expect(await submit(log.id, { rotationId: '', epaLevel: '', ...blankText() })).toEqual({
      status: 'error',
      message: CHECK_FIELDS,
      fieldErrors: {
        rotationId: 'Pick a rotation to submit.',
        epaLevel: 'Pick an EPA level to submit.',
        'data.assessment': 'Fill this in to submit.',
        'data.diagnosis': 'Fill this in to submit.',
        'data.intervention': 'Fill this in to submit.',
        'data.monitoring_evaluation': 'Fill this in to submit.',
      },
    })
    expect(logs()[0].status).toBe('DRAFT')
    expect(fakePrisma.writes()).toEqual([])
  })

  it('once submitted, the trainee can change it neither by saving nor by submitting again', async () => {
    const me = signInTrainee()
    const log = seedLog(me.id)
    expect(await submit(log.id)).toEqual({ status: 'ok', message: 'Submitted for review.' })
    const submitted = structuredClone(logs()[0])

    const locked = { status: 'error', message: 'This case log has been submitted and can no longer be changed.' }
    expect(await update(log.id, { 'data.assessment': 'Edited after submitting.' })).toEqual(locked)
    expect(await submit(log.id, { 'data.assessment': 'Edited after submitting.' })).toEqual(locked)
    expect(logs()[0]).toEqual(submitted)
    expect(audit().map((row) => row.action)).toEqual(['submit'])
  })

  it('a submit and a save sent at the same moment (two tabs): the save waits for the row lock, then finds the log submitted', async () => {
    const me = signInTrainee()
    const log = seedLog(me.id)
    const [submitted, saved] = await Promise.all([submit(log.id), update(log.id, { 'data.assessment': 'Saved in the other tab.' })])
    expect(submitted).toEqual({ status: 'ok', message: 'Submitted for review.' })
    expect(saved).toEqual({ status: 'error', message: 'This case log has been submitted and can no longer be changed.' })
    expect(logs()[0]).toMatchObject({ status: 'SUBMITTED', data: TEXT })
    expect(audit().map((row) => row.action)).toEqual(['submit'])
  })
})

describe('a trainee reaches only their own case logs', () => {
  it("cannot change or submit another trainee's log: the same answer as a log that does not exist, nothing written", async () => {
    const other = seedProfile('TRAINEE')
    const theirs = seedLog(other.id)
    const stored = structuredClone(logs())
    signInTrainee()

    expect(await update(theirs.id, { 'data.assessment': 'Changed by someone else.' })).toEqual(NOT_FOUND)
    expect(await submit(theirs.id)).toEqual(NOT_FOUND)
    expect(await update(MISSING_ID, { 'data.assessment': 'Changed.' })).toEqual(NOT_FOUND)
    expect(logs()).toEqual(stored)
    expect(fakePrisma.writes()).toEqual([])
  })

  it("the loaders return only the caller's own logs", async () => {
    const other = seedProfile('TRAINEE')
    const theirs = seedLog(other.id)
    const me = signInTrainee()
    const older = seedLog(me.id, { createdAt: new Date('2026-10-01T08:00:00Z'), caseCode: 'C-2026-001' })
    const newer = seedLog(me.id, { createdAt: new Date('2026-10-05T08:00:00Z'), caseCode: 'C-2026-002', rotationId: null })

    expect(await listMyCaseLogs()).toEqual([
      expect.objectContaining({ id: newer.id, caseCode: 'C-2026-002', rotationName: null }),
      expect.objectContaining({ id: older.id, caseCode: 'C-2026-001', rotationName: 'Nephrology', status: 'DRAFT' }),
    ])
    expect(await getMyCaseLog(theirs.id)).toBeNull()
    expect(await getMyCaseLog(older.id)).toMatchObject({ id: older.id, rotationName: 'Nephrology', data: TEXT, createdOn: '2026-10-01' })
  })

  it('a malformed id is "not found" without a database read', async () => {
    signInTrainee()
    expect(await getMyCaseLog('../../admin')).toBeNull()
    expect(fakePrisma.calls.filter((call) => !isGuardRead(call))).toEqual([])
  })

  it('the rotation picker lists active rotations, plus the log’s own even after it was retired', async () => {
    signInTrainee()
    const retired = seedRotation('Old Ward', false)
    seedRotation('Diabetes Clinic')
    expect((await listLogbookRotations()).map((r) => r.name)).toEqual(['Diabetes Clinic', 'Nephrology'])
    expect((await listLogbookRotations(retired.id)).map((r) => [r.name, r.isActive])).toEqual([
      ['Diabetes Clinic', true],
      ['Nephrology', true],
      ['Old Ward', false],
    ])
  })
})

describe('only a TRAINEE may use the logbook', () => {
  function calls(logId: string): { name: string; run: () => Promise<unknown> }[] {
    return [
      { name: 'createCaseLog', run: () => createCaseLog(IDLE, form(fields())) },
      { name: 'updateCaseLog', run: () => updateCaseLog(IDLE, form({ logId, ...fields() })) },
      { name: 'submitCaseLog', run: () => submitCaseLog(IDLE, form({ logId, ...fields() })) },
      { name: 'listMyCaseLogs', run: () => listMyCaseLogs() },
      { name: 'getMyCaseLog', run: () => getMyCaseLog(logId) },
      { name: 'listLogbookRotations', run: () => listLogbookRotations() },
    ]
  }

  it.each(NON_TRAINEE_CALLERS)('$label: every action and loader is refused (/nutrition/no-access) before it reads or writes anything', async (caller) => {
    const log = seedLog(seedProfile('TRAINEE').id)
    caller.signIn()
    for (const call of calls(log.id)) expect(await refusal(call.run()), call.name).toBe('/nutrition/no-access')
    expect(fakePrisma.calls.filter((call) => !isGuardRead(call))).toEqual([])
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('not signed in: refused (/nutrition/login)', async () => {
    const log = seedLog(seedProfile('TRAINEE').id)
    for (const call of calls(log.id)) expect(await refusal(call.run()), call.name).toBe('/nutrition/login')
    expect(fakePrisma.calls).toEqual([])
  })
})

describe('the audit log keeps no clinical text', () => {
  it('create, update and submit: the rows hold the field names and a hash, never the text', async () => {
    signInTrainee()
    await create()
    const id = logs()[0].id as string
    const changed = 'Weight 70 kg; nausea settled with small meals.'
    await update(id, { 'data.assessment': changed })
    await submit(id, { 'data.assessment': changed })

    expect(audit().map((row) => row.action)).toEqual(['create', 'update', 'submit'])
    const logged = JSON.stringify(audit())
    for (const text of [...Object.values(TEXT), changed]) expect(logged).not.toContain(text)

    for (const row of audit()) {
      for (const value of [row.before, row.after]) {
        if (value === null) continue
        expect(Object.keys(snapshot(value))).not.toContain('data')
        expect(Object.keys(snapshot(value))).not.toContain('reviewComment')
        expect(snapshot(value)).toMatchObject({ dataFields: ALL_FIELDS, dataSha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
      }
    }

    // The hash is of the stored text, so it shows when the text changed, and only then.
    const stored = logs()[0].data as Record<string, string>
    const expected = createHash('sha256')
      .update(JSON.stringify(Object.keys(stored).sort().map((key) => [key, stored[key]])))
      .digest('hex')
    const [created, updated, submitted] = audit().map((row) => [snapshot(row.before), snapshot(row.after)])
    expect(updated[0].dataSha256).toBe(snapshot(created[1]).dataSha256)
    expect(updated[1].dataSha256).not.toBe(updated[0].dataSha256)
    expect(submitted[1].dataSha256).toBe(updated[1].dataSha256)
    expect(submitted[1].dataSha256).toBe(expected)
  })

  it("leaves out the preceptor's review comment too", async () => {
    const preceptor = seedProfile('PRECEPTOR')
    const me = signInTrainee()
    const log = seedLog(me.id, {
      status: 'REJECTED',
      reviewComment: 'Please expand the PES statement.',
      reviewedById: preceptor.id,
      reviewedAt: new Date('2026-10-10T09:00:00Z'),
    })
    await update(log.id, { 'data.diagnosis': 'A fuller PES statement.' })
    expect(audit()).toHaveLength(1)
    expect(JSON.stringify(audit())).not.toContain('Please expand the PES statement.')
    expect(snapshot(audit()[0].before)).toMatchObject({ reviewedById: preceptor.id, reviewedAt: '2026-10-10T09:00:00.000Z' })
  })
})
