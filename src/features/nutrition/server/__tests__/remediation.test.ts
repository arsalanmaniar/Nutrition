import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('../../auth/__tests__/fakes')).headersModule)
vi.mock('next/navigation', async () => (await import('../../auth/__tests__/fakes')).navigationModule)
vi.mock('@supabase/supabase-js', async () => (await import('../../auth/__tests__/fakes')).supabaseModule)
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./fake-prisma')).fakePrisma }))

import { resetState } from '../../auth/__tests__/fakes'
import {
  closeRemediationPlan,
  createRemediationPlan,
  flagDeficiency,
  linkReassessmentWpba,
  scheduleReassessment,
  setRemediationActivity,
  setRemediationOutcome,
} from '../actions/remediation'
import { getMyRemediation, getTraineeRemediation } from '../queries/remediation'
import { IDLE, NON_PRECEPTOR_CALLERS, NON_TRAINEE_CALLERS, form, seedAssignment, seedProfile } from './actors'
import { epaRows, seedEpa } from './epa-fixtures'
import { NOW, audit, pair, refusal, signInAs } from './evaluation-fixtures'
import { fakePrisma } from './fake-prisma'
import { seedPlacement, seedWpba } from './wpba-fixtures'

// The 4-step remediation module (Step 6c): ACTIVE primary preceptor only,
// under the trainee row lock; the reassessment WPBA must be the trainee's and
// filed after the step; completing a step writes no EPA row; a closed plan is
// read-only; the trainee reads their own plans; audit rows carry no text.

type Row = Record<string, unknown>

const LOCK_SQL = 'SELECT id FROM nutr_profile WHERE id = ? FOR UPDATE'
const DEFICIENCY = 'Growth chart plotting below expectation on two Mini-CEX.'
const ACTIVITY = 'Three additional growth-chart cases, then a repeat CbD.'
const plans = () => fakePrisma.tables.nutritionRemediationPlan as Row[]
const steps = () => fakePrisma.tables.nutritionRemediationStep as Row[]
const call = <T,>(action: (previous: typeof IDLE, data: FormData) => Promise<T>, fields: Record<string, string>) => action(IDLE, form(fields))

beforeEach(() => {
  resetState()
  fakePrisma.reset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
})

afterEach(() => {
  // Remediation never writes an EPA row, and no audit row is changed.
  expect(fakePrisma.writes().filter((c) => c.op.startsWith('nutritionEpaAssessment.'))).toEqual([])
  expect(fakePrisma.calls.filter((c) => /^nutritionAuditLog\.(update|delete)/.test(c.op))).toEqual([])
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

/** A primary pair with an open plan (one step on EPA_01), signed in as the preceptor. */
async function openPlan() {
  const { trainee, preceptor } = pair('2026-01-01')
  seedEpa(trainee.id, preceptor.id, { level: 'E2', millerLevel: 'SHOWS_HOW', assessedOn: '2026-03-01' })
  signInAs(preceptor)
  expect(await call(createRemediationPlan, { traineeId: trainee.id, deficiency: DEFICIENCY, epaKey: 'EPA_01' })).toEqual({ status: 'ok', message: 'Remediation plan opened.' })
  return { trainee, preceptor, plan: plans()[0], step: steps()[0] }
}

describe('the four steps, by the active primary preceptor', () => {
  it('1: opening a plan creates step 1 with the EPA level before, under the trainee row lock; audits carry no text', async () => {
    const { trainee, preceptor, plan, step } = await openPlan()
    expect(plan).toMatchObject({ traineeId: trainee.id, closedAt: null, createdBy: preceptor.authUserId })
    expect(step).toMatchObject({ planId: plan.id, position: 1, deficiency: DEFICIENCY, outcome: 'IN_PROGRESS', epaName: 'EPA_01', epaBefore: 'E2', epaAfter: null })
    expect(fakePrisma.calls.filter((c) => c.inTransaction)[0]).toEqual({ op: '$queryRaw', args: { sql: LOCK_SQL, values: [trainee.id] }, inTransaction: true })
    expect(audit().map((row) => [row.entity, row.action])).toEqual([
      ['NutritionRemediationPlan', 'create'],
      ['NutritionRemediationStep', 'create'],
    ])
    expect(JSON.stringify(audit())).not.toContain('Growth chart')
  })

  it('1: only one open plan per trainee; further deficiencies are added to it as steps 2, 3', async () => {
    const { trainee, plan } = await openPlan()
    expect(await call(createRemediationPlan, { traineeId: trainee.id, deficiency: 'Another.' })).toEqual({
      status: 'error',
      message: 'This trainee already has an open remediation plan. Add the deficiency to it instead.',
    })
    expect((await call(flagDeficiency, { planId: plan.id as string, deficiency: 'Feeding plan calculations.' })).status).toBe('ok')
    expect((await call(flagDeficiency, { planId: plan.id as string, deficiency: 'Counselling the family.' })).status).toBe('ok')
    expect(steps().map((row) => row.position)).toEqual([1, 2, 3])
  })

  it('2 and 3: activity (free text) and a reassessment date; a past date is refused', async () => {
    const { step } = await openPlan()
    expect((await call(setRemediationActivity, { stepId: step.id as string, activity: ACTIVITY })).status).toBe('ok')
    expect(await call(scheduleReassessment, { stepId: step.id as string, reassessmentDate: '2026-04-14' })).toMatchObject({ status: 'error' })
    expect((await call(scheduleReassessment, { stepId: step.id as string, reassessmentDate: '2026-05-10' })).status).toBe('ok')
    expect(steps()[0]).toMatchObject({ activity: ACTIVITY, reassessmentDate: new Date('2026-05-10T00:00:00Z') })
    expect(JSON.stringify(audit())).not.toContain('growth-chart cases')
  })

  it('3: links a WPBA of the same trainee filed after the step', async () => {
    const { trainee, preceptor, step } = await openPlan()
    vi.setSystemTime(new Date(NOW.getTime() + 60_000))
    const later = seedWpba('MINI_CEX', trainee.id, preceptor.id, { createdAt: new Date(NOW.getTime() + 60_000) })
    expect(await call(linkReassessmentWpba, { stepId: step.id as string, wpbaId: later.id as string })).toEqual({ status: 'ok', message: 'Reassessment WPBA linked.' })
    expect(steps()[0].linkedWpbaId).toBe(later.id)
  })

  it("3: another trainee's WPBA, and a WPBA filed before the step, are refused", async () => {
    const { trainee, preceptor, step } = await openPlan()
    const { trainee: other } = pair('2026-01-01')
    const theirs = seedWpba('MINI_CEX', other.id, preceptor.id, { createdAt: new Date(NOW.getTime() + 60_000) })
    const earlier = seedWpba('DOPS', trainee.id, preceptor.id, { createdAt: new Date(NOW.getTime() - 60_000) })
    const message = "This WPBA was not found among the trainee's assessments filed after the step was created."
    for (const wpba of [theirs, earlier]) {
      expect(await call(linkReassessmentWpba, { stepId: step.id as string, wpbaId: wpba.id as string })).toEqual({ status: 'error', message, fieldErrors: { wpbaId: message } })
    }
    expect(steps()[0].linkedWpbaId).toBeNull()
  })

  it('4: MET records the EPA level after from the newest EPA row, and writes no EPA row', async () => {
    const { trainee, preceptor, step } = await openPlan()
    seedEpa(trainee.id, preceptor.id, { level: 'E3', millerLevel: 'DOES', assessedOn: '2026-04-14' })
    const epaBefore = epaRows().length
    expect(await call(setRemediationOutcome, { stepId: step.id as string, outcome: 'MET' })).toEqual({ status: 'ok', message: 'Outcome saved.' })
    expect(steps()[0]).toMatchObject({ outcome: 'MET', epaBefore: 'E2', epaAfter: 'E3' })
    expect(epaRows()).toHaveLength(epaBefore)
    expect(await call(setRemediationOutcome, { stepId: step.id as string, outcome: 'DONE' })).toMatchObject({ status: 'error' })
  })

  it('closing the plan makes it read-only', async () => {
    const { plan, step } = await openPlan()
    expect((await call(closeRemediationPlan, { planId: plan.id as string })).status).toBe('ok')
    expect(plans()[0].closedAt).toEqual(NOW)
    const closed = { status: 'error', message: 'This remediation plan is closed and can no longer be changed.' }
    expect(await call(setRemediationActivity, { stepId: step.id as string, activity: ACTIVITY })).toEqual(closed)
    expect(await call(flagDeficiency, { planId: plan.id as string, deficiency: 'More.' })).toEqual(closed)
    expect(await call(closeRemediationPlan, { planId: plan.id as string })).toEqual(closed)
  })

  it('free text with a patient identifier is refused', async () => {
    const { step } = await openPlan()
    const result = await call(setRemediationActivity, { stepId: step.id as string, activity: 'Review MRN 1234567 again.' })
    expect(Object.keys((result as { fieldErrors?: object }).fieldErrors ?? {})).toEqual(['activity'])
  })
})

describe('who may write: the ACTIVE primary preceptor only', () => {
  it('another, a former and a rotation preceptor get "not found" on every action', async () => {
    const { trainee, plan, step } = await openPlan()
    const stranger = seedProfile('PRECEPTOR')
    const former = seedProfile('PRECEPTOR')
    seedAssignment(trainee.id, former.id, false)
    const rotation = seedProfile('PRECEPTOR')
    seedPlacement(trainee.id, rotation.id, '2026-04-01')
    const before = JSON.stringify([plans(), steps()])
    for (const caller of [stranger, former, rotation]) {
      signInAs(caller)
      expect(await call(createRemediationPlan, { traineeId: trainee.id, deficiency: 'x' })).toEqual({ status: 'error', message: 'This trainee was not found among your trainees.' })
      expect(await call(flagDeficiency, { planId: plan.id as string, deficiency: 'x' })).toEqual({ status: 'error', message: 'This remediation plan was not found.' })
      expect(await call(setRemediationOutcome, { stepId: step.id as string, outcome: 'MET' })).toEqual({ status: 'error', message: 'This remediation step was not found.' })
      expect(await call(closeRemediationPlan, { planId: plan.id as string })).toEqual({ status: 'error', message: 'This remediation plan was not found.' })
    }
    expect(JSON.stringify([plans(), steps()])).toBe(before)
  })

  it.each(NON_PRECEPTOR_CALLERS)('$label (the trainee included) is refused by the guard on writes', async ({ signIn }) => {
    const { trainee } = pair('2026-01-01')
    signIn()
    expect(await refusal(call(createRemediationPlan, { traineeId: trainee.id, deficiency: 'x' }))).toMatch(/^\/nutrition\//)
    expect(await refusal(call(setRemediationOutcome, { stepId: '0b0c3e1e-6c1b-4c39-9a37-3f5c2f1f9a11', outcome: 'MET' }))).toMatch(/^\/nutrition\//)
    expect(plans()).toEqual([])
  })
})

describe('reading plans', () => {
  it('the primary preceptor gets the plans and the linkable WPBAs; anyone else gets null', async () => {
    const { trainee, preceptor } = await openPlan()
    seedWpba('MINI_CEX', trainee.id, preceptor.id)
    const view = await getTraineeRemediation(trainee.id)
    expect(view).toMatchObject({ traineeId: trainee.id, plans: [{ open: true, steps: [{ position: 1, deficiency: DEFICIENCY, epa: { key: 'EPA_01', before: 'E2', after: null } }] }] })
    expect(view!.wpbaOptions).toHaveLength(1)
    signInAs(seedProfile('PRECEPTOR'))
    expect(await getTraineeRemediation(trainee.id)).toBeNull()
    expect(await getTraineeRemediation('not-an-id')).toBeNull()
  })

  it('the trainee reads their own plans only', async () => {
    const { trainee } = await openPlan()
    const { trainee: other, preceptor: otherPreceptor } = pair('2026-01-01')
    signInAs(otherPreceptor)
    await call(createRemediationPlan, { traineeId: other.id, deficiency: 'Someone else entirely.' })
    signInAs(trainee)
    const mine = await getMyRemediation()
    expect(mine).toHaveLength(1)
    expect(JSON.stringify(mine)).not.toContain('Someone else entirely')
  })

  it.each(NON_PRECEPTOR_CALLERS)('$label is refused by the preceptor loader', async ({ signIn }) => {
    const { trainee } = pair('2026-01-01')
    signIn()
    expect(await refusal(getTraineeRemediation(trainee.id))).toMatch(/^\/nutrition\//)
  })

  it.each(NON_TRAINEE_CALLERS)('$label is refused by the trainee loader', async ({ signIn }) => {
    signIn()
    expect(await refusal(getMyRemediation())).toMatch(/^\/nutrition\//)
  })
})
