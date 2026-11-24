import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('../../auth/__tests__/fakes')).headersModule)
vi.mock('next/navigation', async () => (await import('../../auth/__tests__/fakes')).navigationModule)
vi.mock('@supabase/supabase-js', async () => (await import('../../auth/__tests__/fakes')).supabaseModule)
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./fake-prisma')).fakePrisma }))

import { resetState } from '../../auth/__tests__/fakes'
import { saveStandardsChecklist, startStandardsChecklist, submitStandardsChecklist } from '../actions/standards-checklist'
import { STANDARD_KEYS } from '../epa-core'
import { IDLE, NON_PRECEPTOR_CALLERS, form, seedAssignment, seedProfile } from './actors'
import {
  CHECKLIST_EXISTS,
  CHECKLIST_NOT_FOUND,
  CHECKLIST_SUBMITTED,
  EVIDENCE_NOT_FOUND,
  MONTH_8_START,
  MONTH_9_START,
  TRAINEE_NOT_FOUND,
  checklistFields,
  checklists,
  seedChecklist,
} from './epa-fixtures'
import { NOW, audit, pair, refusal, seedTrainee, signInAs } from './evaluation-fixtures'
import { fakePrisma, uniqueViolation } from './fake-prisma'
import { seedCaseLog, seedPlacement, seedWpba } from './wpba-fixtures'

// The Month 9 standards checklist actions (Step 6a): primary preceptor only,
// under the trainee row lock; opens in training month 9; evidence must be
// the trainee's own record; immutable once submitted; audit rows without
// free text, ratings or evidence ids.

const LOCK_SQL = 'SELECT id FROM nutr_profile WHERE id = ? FOR UPDATE'
const start = (traineeId: string) => startStandardsChecklist(IDLE, form({ traineeId }))
const save = (fields: Record<string, string>) => saveStandardsChecklist(IDLE, form(fields))
const submit = (fields: Record<string, string>) => submitStandardsChecklist(IDLE, form(fields))

beforeEach(() => {
  resetState()
  fakePrisma.reset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW) // noon in Karachi, 15 April 2026
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
})

afterEach(() => {
  // No checklist is ever deleted, and no audit row is changed.
  expect(fakePrisma.calls.filter((call) => /^nutritionStandardsChecklist\.(delete|deleteMany)$/.test(call.op) || /^nutritionAuditLog\.(update|delete)/.test(call.op))).toEqual([])
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

/** A month-9 trainee with their primary preceptor signed in, plus one WPBA of the trainee as evidence. */
function month9() {
  const { trainee, preceptor } = pair(MONTH_9_START)
  const wpba = seedWpba('MINI_CEX', trainee.id, preceptor.id)
  signInAs(preceptor)
  return { trainee, preceptor, wpba, evidence: `WPBA:${wpba.id}` }
}

describe('starting the checklist', () => {
  it('the primary preceptor starts it in training month 9: a draft, under the trainee row lock, audited', async () => {
    const { trainee, preceptor } = month9()
    expect(await start(trainee.id)).toEqual({ status: 'ok', message: 'Month 9 standards checklist started.' })
    const [row] = checklists()
    expect(row).toMatchObject({ traineeId: trainee.id, monthNumber: 9, formVersion: 1, status: 'DRAFT', items: {}, submittedAt: null, createdBy: preceptor.authUserId })
    expect(fakePrisma.calls.filter((call) => call.inTransaction)[0]).toEqual({ op: '$queryRaw', args: { sql: LOCK_SQL, values: [trainee.id] }, inTransaction: true })
    expect(audit()).toHaveLength(1)
    expect(audit()[0]).toMatchObject({ entity: 'NutritionStandardsChecklist', entityId: row.id, action: 'create', actorId: preceptor.authUserId, before: null })
    expect(audit()[0].after).toEqual({ id: row.id, traineeId: trainee.id, monthNumber: 9, formVersion: 1, status: 'DRAFT', rated: 0, withEvidence: 0 })
  })

  it('before training month 9 it is refused with the opening day; without a start date too', async () => {
    const { trainee, preceptor } = pair(MONTH_8_START)
    signInAs(preceptor)
    expect(await start(trainee.id)).toEqual({ status: 'error', message: 'The Month 9 standards checklist opens on 2026-05-01.' })
    const noStart = seedTrainee(null)
    seedAssignment(noStart.id, preceptor.id)
    expect(await start(noStart.id)).toEqual({ status: 'error', message: "This trainee's training start date is not set yet." })
    expect(checklists()).toEqual([])
  })

  it('after training has ended it can still be started', async () => {
    const { trainee, preceptor } = pair('2025-01-01')
    signInAs(preceptor)
    expect((await start(trainee.id)).status).toBe('ok')
  })

  it('one per trainee and month: a second start is refused', async () => {
    const { trainee } = month9()
    expect((await start(trainee.id)).status).toBe('ok')
    expect(await start(trainee.id)).toEqual(CHECKLIST_EXISTS)
    expect(checklists()).toHaveLength(1)
  })

  it('a unique violation from a concurrent start is reported the same way', async () => {
    const { trainee } = month9()
    fakePrisma.failNext('nutritionStandardsChecklist.create', uniqueViolation('traineeId'))
    expect(await start(trainee.id)).toEqual(CHECKLIST_EXISTS)
  })
})

describe('saving and submitting', () => {
  it('a draft saves partial ratings and evidence; the audit row has counts only', async () => {
    const { trainee, preceptor, wpba } = month9()
    seedChecklist(trainee.id)
    const fields = { traineeId: trainee.id, 'rating.sop_diagnosis': 'EXCEEDS', 'evidence.sop_diagnosis': `WPBA:${wpba.id}`, 'rating.sop_intervention': 'DEVELOPING' }
    expect(await save(fields)).toEqual({ status: 'ok', message: 'Draft saved.' })
    expect(checklists()[0]).toMatchObject({
      status: 'DRAFT',
      items: {
        sop_diagnosis: { rating: 'EXCEEDS', evidence: { kind: 'WPBA', id: wpba.id } },
        sop_intervention: { rating: 'DEVELOPING', evidence: null },
      },
    })
    const entry = audit()[0]
    expect(entry).toMatchObject({ action: 'update', actorId: preceptor.authUserId })
    expect(entry.after).toMatchObject({ status: 'DRAFT', rated: 2, withEvidence: 1 })
    const text = JSON.stringify(entry)
    expect(text).not.toContain(wpba.id as string)
    expect(text).not.toMatch(/EXCEEDS|DEVELOPING|sop_/)
  })

  it('submit with every standard rated and evidenced: SUBMITTED, with submittedAt', async () => {
    const { trainee, evidence } = month9()
    seedChecklist(trainee.id)
    expect(await submit(checklistFields(trainee.id, evidence))).toEqual({ status: 'ok', message: 'Month 9 standards checklist submitted.' })
    const [row] = checklists()
    expect(row).toMatchObject({ status: 'SUBMITTED', submittedAt: NOW })
    expect(Object.keys(row.items as object).sort()).toEqual([...STANDARD_KEYS].sort())
    expect(audit()[0]).toMatchObject({ action: 'submit' })
    expect(audit()[0].after).toMatchObject({ status: 'SUBMITTED', rated: 10, withEvidence: 10 })
  })

  it('submit with a standard missing is refused on that field, and nothing changes', async () => {
    const { trainee, evidence } = month9()
    const seeded = seedChecklist(trainee.id)
    const fields = checklistFields(trainee.id, evidence)
    delete fields['evidence.sopp_utilization_resources']
    const result = await submit(fields)
    expect(result).toEqual({ status: 'error', message: 'Check the highlighted fields.', fieldErrors: { 'evidence.sopp_utilization_resources': 'Link a case log or a WPBA as evidence.' } })
    expect(checklists()[0]).toEqual(seeded)
  })

  it('without a started checklist, save and submit say so', async () => {
    const { trainee, evidence } = month9()
    expect(await save({ traineeId: trainee.id })).toEqual(CHECKLIST_NOT_FOUND)
    expect(await submit(checklistFields(trainee.id, evidence))).toEqual(CHECKLIST_NOT_FOUND)
  })
})

describe('a submitted checklist is immutable', () => {
  it('save and submit are refused and the row is unchanged', async () => {
    const { trainee, evidence } = month9()
    const seeded = seedChecklist(trainee.id, 'SUBMITTED', { sop_diagnosis: { rating: 'MEETS', evidence: null } })
    expect(await save({ traineeId: trainee.id, 'rating.sop_diagnosis': 'EXCEEDS' })).toEqual(CHECKLIST_SUBMITTED)
    expect(await submit(checklistFields(trainee.id, evidence, 'EXCEEDS'))).toEqual(CHECKLIST_SUBMITTED)
    expect(checklists()[0]).toEqual(seeded)
    expect(fakePrisma.writes().filter((call) => call.op.startsWith('nutritionStandardsChecklist.'))).toEqual([])
    expect(audit()).toEqual([])
  })
})

describe("evidence must be one of THIS trainee's records", () => {
  it("another trainee's WPBA or case log is refused on that standard", async () => {
    const { trainee, preceptor } = month9()
    seedChecklist(trainee.id)
    const other = seedTrainee(MONTH_9_START)
    seedAssignment(other.id, preceptor.id)
    const theirWpba = seedWpba('DOPS', other.id, preceptor.id)
    const theirLog = seedCaseLog(other.id, 'APPROVED', 'C-2026-099')
    const result = await save({
      traineeId: trainee.id,
      'rating.sop_diagnosis': 'MEETS',
      'evidence.sop_diagnosis': `WPBA:${theirWpba.id}`,
      'evidence.sop_intervention': `CASE_LOG:${theirLog.id}`,
    })
    expect(result).toEqual({
      status: 'error',
      message: 'Check the highlighted fields.',
      fieldErrors: { 'evidence.sop_diagnosis': EVIDENCE_NOT_FOUND, 'evidence.sop_intervention': EVIDENCE_NOT_FOUND },
    })
    expect(checklists()[0].items).toEqual({})
  })

  it('a draft or returned case log of the trainee is refused; a submitted or approved one is accepted', async () => {
    const { trainee } = month9()
    seedChecklist(trainee.id)
    const draft = seedCaseLog(trainee.id, 'DRAFT', 'C-2026-010')
    const rejected = seedCaseLog(trainee.id, 'REJECTED', 'C-2026-011')
    const submitted = seedCaseLog(trainee.id, 'SUBMITTED', 'C-2026-012')
    const approved = seedCaseLog(trainee.id, 'APPROVED', 'C-2026-013')
    expect(await save({ traineeId: trainee.id, 'evidence.sop_diagnosis': `CASE_LOG:${draft.id}`, 'evidence.sop_intervention': `CASE_LOG:${rejected.id}` })).toEqual({
      status: 'error',
      message: 'Check the highlighted fields.',
      fieldErrors: { 'evidence.sop_diagnosis': EVIDENCE_NOT_FOUND, 'evidence.sop_intervention': EVIDENCE_NOT_FOUND },
    })
    expect(
      (await save({ traineeId: trainee.id, 'evidence.sop_diagnosis': `CASE_LOG:${submitted.id}`, 'evidence.sop_intervention': `CASE_LOG:${approved.id}` })).status,
    ).toBe('ok')
  })

  it('a WPBA id offered as a case log (wrong kind) is refused', async () => {
    const { trainee, wpba } = month9()
    seedChecklist(trainee.id)
    expect((await save({ traineeId: trainee.id, 'evidence.sop_diagnosis': `CASE_LOG:${wpba.id}` })).status).toBe('error')
  })

  it('the evidence lookups filter by the trainee id', async () => {
    const { trainee, evidence } = month9()
    seedChecklist(trainee.id)
    seedCaseLog(trainee.id, 'SUBMITTED')
    await save({ traineeId: trainee.id, 'evidence.sop_diagnosis': evidence, 'evidence.sop_intervention': `CASE_LOG:${(fakePrisma.tables.nutritionCaseLog[0] as { id: string }).id}` })
    const lookups = fakePrisma.calls.filter((call) => call.op === 'nutritionWpba.findMany' || call.op === 'nutritionCaseLog.findMany')
    expect(lookups).toHaveLength(2)
    for (const call of lookups) expect((call.args as { where: { traineeId: string } }).where.traineeId).toBe(trainee.id)
  })
})

describe('who may write the checklist: the ACTIVE primary preceptor only', () => {
  it('another, a former and a rotation preceptor get "not found" on start, save and submit', async () => {
    const { trainee, evidence } = month9()
    seedChecklist(trainee.id)
    const stranger = seedProfile('PRECEPTOR')
    const former = seedProfile('PRECEPTOR')
    seedAssignment(trainee.id, former.id, false)
    const rotation = seedProfile('PRECEPTOR')
    seedPlacement(trainee.id, rotation.id, '2026-04-01')
    for (const caller of [stranger, former, rotation]) {
      signInAs(caller)
      expect(await start(trainee.id)).toEqual(TRAINEE_NOT_FOUND)
      expect(await save({ traineeId: trainee.id, 'rating.sop_diagnosis': 'MEETS' })).toEqual(TRAINEE_NOT_FOUND)
      expect(await submit(checklistFields(trainee.id, evidence))).toEqual(TRAINEE_NOT_FOUND)
    }
    expect(checklists()[0]).toMatchObject({ status: 'DRAFT', items: {} })
    expect(audit()).toEqual([])
  })

  it.each(NON_PRECEPTOR_CALLERS)('$label is refused by the guard on every action', async ({ signIn }) => {
    const { trainee } = pair(MONTH_9_START)
    signIn()
    expect(await refusal(start(trainee.id))).toMatch(/^\/nutrition\//)
    expect(await refusal(save({ traineeId: trainee.id }))).toMatch(/^\/nutrition\//)
    expect(await refusal(submit({ traineeId: trainee.id }))).toMatch(/^\/nutrition\//)
    expect(fakePrisma.calls.filter((call) => call.op.startsWith('nutritionStandardsChecklist.'))).toEqual([])
  })

  it('save and submit take the trainee row lock first', async () => {
    const { trainee, evidence } = month9()
    seedChecklist(trainee.id)
    await save({ traineeId: trainee.id, 'rating.sop_diagnosis': 'MEETS' })
    await submit(checklistFields(trainee.id, evidence))
    const firstInEachTransaction = fakePrisma.calls.filter((call, i, all) => call.inTransaction && !all[i - 1]?.inTransaction)
    expect(firstInEachTransaction).toEqual([
      { op: '$queryRaw', args: { sql: LOCK_SQL, values: [trainee.id] }, inTransaction: true },
      { op: '$queryRaw', args: { sql: LOCK_SQL, values: [trainee.id] }, inTransaction: true },
    ])
  })
})
