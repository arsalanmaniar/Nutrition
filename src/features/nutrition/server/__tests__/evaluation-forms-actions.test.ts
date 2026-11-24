import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('../../auth/__tests__/fakes')).headersModule)
vi.mock('next/navigation', async () => (await import('../../auth/__tests__/fakes')).navigationModule)
vi.mock('@supabase/supabase-js', async () => (await import('../../auth/__tests__/fakes')).supabaseModule)
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./fake-prisma')).fakePrisma }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { resetState } from '../../auth/__tests__/fakes'
import {
  commentOnWeeklyCheckIn,
  reopenEvaluationForm,
  saveMyEvaluationForm,
  saveTraineeEvaluation,
  startMyEvaluationForm,
  startTraineeEvaluation,
  submitMyEvaluationForm,
  submitTraineeEvaluation,
} from '../actions/evaluation-forms'
import { IDLE, NON_PRECEPTOR_CALLERS, NON_TRAINEE_CALLERS, form, seedAssignment, seedProfile } from './actors'
import {
  ALREADY_EXISTS,
  ALREADY_SUBMITTED,
  KEY,
  NOT_DUE,
  NOT_FOUND,
  NOW,
  TRAINEE_NOT_FOUND,
  audit,
  complete,
  formById,
  forms,
  outcome,
  pair,
  ratingFields,
  refusal,
  seedForm,
  seedFormOneThree,
  seedHistory,
  seedTrainee,
  signInAs,
  textFields,
} from './evaluation-fixtures'
import { fakePrisma, uniqueViolation } from './fake-prisma'

// The evaluation-form actions for the trainee's weekly check-in and Form 1.1,
// the primary preceptor's Forms 1.2 and 3.1, reopen and weekly comments.
// Form 1.3 has its own file (form-1-3-confidentiality.test.ts).

const LOCK_SQL = 'SELECT id FROM nutr_profile WHERE id = ? FOR UPDATE'
const start = (fields: Record<string, string>) => outcome(startMyEvaluationForm(IDLE, form(fields)))
const startFor = (fields: Record<string, string>) => outcome(startTraineeEvaluation(IDLE, form(fields)))
const save = (formId: string, fields: Record<string, string> = {}) => saveMyEvaluationForm(IDLE, form({ formId, ...fields }))
const submit = (formId: string, fields: Record<string, string> = {}) => submitMyEvaluationForm(IDLE, form({ formId, ...fields }))
const idFrom = (result: unknown) => {
  const path = (result as { redirect?: string }).redirect
  if (!path) throw new Error(`expected a redirect, got ${JSON.stringify(result)}`)
  return path.split('/').pop() as string
}

beforeEach(() => {
  resetState()
  fakePrisma.reset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
  vi.stubEnv('NUTRITION_AUTHOR_HASH_KEY', KEY)
})

afterEach(() => {
  // Nothing is ever deleted, and no audit row is ever changed.
  expect(fakePrisma.calls.filter((call) => /\.delete(Many)?$/.test(call.op) || /^nutritionAuditLog\.update/.test(call.op))).toEqual([])
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('trainee: starting a weekly check-in or Form 1.1', () => {
  it('creates the DRAFT at the point the server computes, under the trainee row lock, and audits it', async () => {
    const trainee = signInAs(seedTrainee('2026-04-15'))
    const result = await start({ formType: 'WEEKLY' })
    const id = idFrom(result)
    expect(result).toEqual({ redirect: `/nutrition/trainee/forms/${id}` })
    expect(formById(id)).toMatchObject({
      formType: 'WEEKLY',
      formVersion: 1,
      assessmentPoint: 'W01',
      monthNumber: 1,
      subjectId: trainee.id,
      authorId: trainee.id,
      authorHash: null,
      createdBy: trainee.authUserId,
      status: 'DRAFT',
      answers: { ratings: {}, text: {} },
      totalScore: null,
    })
    expect(fakePrisma.calls.filter((call) => call.inTransaction)[0]).toEqual({
      op: '$queryRaw',
      args: { sql: LOCK_SQL, values: [trainee.id] },
      inTransaction: true,
    })
    expect(audit()).toEqual([expect.objectContaining({ entity: 'NutritionEvaluationForm', entityId: id, action: 'create', actorId: trainee.authUserId })])
  })

  it('ignores every column the client tries to set: point, month, subject, author, status, totals, version', async () => {
    const trainee = signInAs(seedTrainee('2026-04-15'))
    const other = seedTrainee('2026-04-15')
    const id = idFrom(
      await start({
        formType: 'FORM_1_1',
        assessmentPoint: 'M12',
        monthNumber: '12',
        subjectId: other.id,
        authorId: other.id,
        status: 'SUBMITTED',
        totalScore: '50',
        maxScore: '50',
        formVersion: '9',
      }),
    )
    expect(formById(id)).toMatchObject({
      assessmentPoint: 'M01',
      monthNumber: 1,
      subjectId: trainee.id,
      authorId: trainee.id,
      status: 'DRAFT',
      totalScore: null,
      maxScore: null,
      formVersion: 1,
    })
  })

  it('the oldest form not yet submitted comes first, and a second start opens the same draft', async () => {
    const trainee = signInAs(seedTrainee('2026-04-01')) // day 14: week 3, so weeks 1 and 2 are overdue
    const first = idFrom(await start({ formType: 'WEEKLY' }))
    expect(formById(first)).toMatchObject({ assessmentPoint: 'W01' })
    expect(idFrom(await start({ formType: 'WEEKLY' }))).toBe(first)
    expect(forms()).toHaveLength(1)

    expect(await submit(first, textFields('WEEKLY'))).toEqual({ status: 'ok', message: 'Submitted.' })
    const second = idFrom(await start({ formType: 'WEEKLY' }))
    expect(formById(second)).toMatchObject({ assessmentPoint: 'W02', subjectId: trainee.id })
  })

  it.each([
    ['no start date', null, [], { status: 'error', message: 'The training start date is not set yet, so no form is due.' }],
    ['a start date in the future', '2026-05-01', [], { status: 'error', message: 'Training starts on 2026-05-01, so no form is due yet.' }],
    ['this month already submitted', '2026-04-10', ['M01'], NOT_DUE],
  ] as const)('refused when nothing is due (%s), nothing written', async (_label, startDate, submitted, expected) => {
    const trainee = signInAs(seedTrainee(startDate))
    for (const point of submitted) seedForm('FORM_1_1', trainee.id, trainee.id, point)
    const before = forms().length
    expect(await start({ formType: 'FORM_1_1' })).toEqual(expected)
    expect(forms()).toHaveLength(before)
    expect(audit()).toEqual([])
  })

  it('after month 12, with everything submitted, nothing more can be started', async () => {
    vi.setSystemTime(new Date('2027-02-01T07:00:00Z'))
    const { trainee, preceptor } = pair('2026-01-01')
    seedHistory(trainee.id, preceptor.id, 53, 12)
    signInAs(trainee)
    expect(await start({ formType: 'WEEKLY' })).toEqual(NOT_DUE)
    expect(await start({ formType: 'FORM_1_1' })).toEqual(NOT_DUE)
  })

  it.each(['FORM_1_2', 'FORM_3_1', 'FORM_1_3', 'OTHER'])('the trainee action cannot start %s', async (formType) => {
    signInAs(seedTrainee('2026-01-01'))
    expect(await start({ formType })).toEqual({ status: 'error', message: 'Check the highlighted fields.', fieldErrors: { formType: 'Pick a form to start.' } })
    expect(forms()).toEqual([])
  })

  it('a clash on the unique period key is refused cleanly, and nothing is left behind', async () => {
    signInAs(seedTrainee('2026-04-15'))
    fakePrisma.failNext('nutritionEvaluationForm.create', uniqueViolation('formType'))
    expect(await start({ formType: 'WEEKLY' })).toEqual(ALREADY_EXISTS)
    expect(forms()).toEqual([])
    expect(audit()).toEqual([])
  })

  it('the fake enforces the period key like Postgres: a second row for the same type, subject, author and point throws', () => {
    const trainee = seedTrainee('2026-04-15')
    seedForm('WEEKLY', trainee.id, trainee.id, 'W01')
    expect(() => seedForm('WEEKLY', trainee.id, trainee.id, 'W01')).toThrow(/Unique constraint/)
  })
})

describe('trainee: saving and submitting', () => {
  async function started(formType: 'WEEKLY' | 'FORM_1_1', startDate = '2026-04-15') {
    const trainee = signInAs(seedTrainee(startDate))
    return { trainee, id: idFrom(await start({ formType })) }
  }

  it('a draft may be half-filled; submitting needs every item, and the server scores it', async () => {
    const { trainee, id } = await started('FORM_1_1')
    const partial = { 'rating.clinical_knowledge': '4', 'rating.teaching_clarity': '5' }
    expect(await save(id, partial)).toEqual({ status: 'ok', message: 'Saved.' })
    expect(formById(id)).toMatchObject({ status: 'DRAFT', answers: { ratings: { clinical_knowledge: 4, teaching_clarity: 5 }, text: {} } })

    const refused = await submit(id, partial)
    expect(refused).toMatchObject({ status: 'error', fieldErrors: { 'rating.professionalism': 'Rate this to submit.' } })
    expect(formById(id)).toMatchObject({ status: 'DRAFT' })

    // Part A 4,4,4,4,4 and Part B 3,3,3,3,3 = 35 of 50.
    expect(await submit(id, { ...ratingFields('FORM_1_1', (i) => (i < 5 ? 4 : 3)) })).toEqual({ status: 'ok', message: 'Submitted.' })
    expect(formById(id)).toMatchObject({ status: 'SUBMITTED', submittedAt: NOW, totalScore: 35, maxScore: 50 })
    const submittedAudit = audit().find((row) => row.action === 'submit')
    expect(submittedAudit).toMatchObject({ actorId: trainee.authUserId, before: expect.objectContaining({ status: 'DRAFT' }), after: expect.objectContaining({ status: 'SUBMITTED', totalScore: 35 }) })
  })

  it('the audit rows never hold the free text, only which fields were answered and a hash', async () => {
    const { id } = await started('WEEKLY')
    const text = textFields('WEEKLY', 'Saw a diabetic foot case with Dr Rana.')
    expect(await submit(id, text)).toEqual({ status: 'ok', message: 'Submitted.' })
    expect(JSON.stringify(audit())).not.toContain('diabetic foot')
    expect(audit().at(-1)?.after).toMatchObject({ textKeys: 'cases_this_week,difficulties_supervision,plan_next_week,progress_vs_objectives', answersSha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
  })

  it.each([
    ['an unknown item', { 'rating.not_an_item': '3' }, 'rating.not_an_item', 'This is not an item of this form.'],
    ['a rating off the scale', { 'rating.clinical_knowledge': '6' }, 'rating.clinical_knowledge', 'Pick a rating from the scale.'],
    ['a rating of 0 on a 1-5 scale', { 'rating.clinical_knowledge': '0' }, 'rating.clinical_knowledge', 'Pick a rating from the scale.'],
    ['a fractional rating', { 'rating.clinical_knowledge': '3.5' }, 'rating.clinical_knowledge', 'Pick a rating from the scale.'],
    ['a patient identifier in the text', { 'text.worked_well': 'Call the mother on 0300 1234567' }, 'text.worked_well', expect.stringContaining('phone number')],
    ['an unknown text field', { 'text.secret_notes': 'x' }, 'text.secret_notes', 'This is not a field of this form.'],
    ['a text over 2000 characters', { 'text.worked_well': 'a'.repeat(2001) }, 'text.worked_well', 'Keep this under 2000 characters.'],
  ])('refuses %s, writes nothing', async (_label, fields, name, message) => {
    const { id } = await started('FORM_1_1')
    const writes = fakePrisma.writes().length
    expect(await save(id, fields)).toMatchObject({ status: 'error', fieldErrors: { [name]: message } })
    expect(formById(id)).toMatchObject({ answers: { ratings: {}, text: {} } })
    expect(fakePrisma.writes()).toHaveLength(writes)
  })

  it('a client-sent total is never read: the stored score is the server’s', async () => {
    const { id } = await started('FORM_1_1')
    const result = await submit(id, { ...ratingFields('FORM_1_1', 2), totalScore: '50', maxScore: '50', percentage: '100', total: '50' })
    expect(result).toEqual({ status: 'ok', message: 'Submitted.' })
    expect(formById(id)).toMatchObject({ totalScore: 20, maxScore: 50 })
  })

  it('the weekly check-in needs its four texts to submit and stays unscored', async () => {
    const { id } = await started('WEEKLY')
    expect(await submit(id, { 'text.cases_this_week': 'Two renal cases.' })).toMatchObject({
      status: 'error',
      fieldErrors: { 'text.plan_next_week': 'Fill this in to submit.' },
    })
    expect(await submit(id, textFields('WEEKLY'))).toEqual({ status: 'ok', message: 'Submitted.' })
    expect(formById(id)).toMatchObject({ status: 'SUBMITTED', totalScore: null, maxScore: null })
  })

  it('a submitted form is locked: a second submit and a save are refused, nothing written', async () => {
    const { id } = await started('WEEKLY')
    expect(await submit(id, textFields('WEEKLY'))).toEqual({ status: 'ok', message: 'Submitted.' })
    const writes = fakePrisma.writes().length
    expect(await submit(id, textFields('WEEKLY', 'changed'))).toEqual(ALREADY_SUBMITTED)
    expect(await save(id, textFields('WEEKLY', 'changed'))).toEqual(ALREADY_SUBMITTED)
    expect(fakePrisma.writes()).toHaveLength(writes)
  })

  it('saving the same answers again writes nothing', async () => {
    const { id } = await started('FORM_1_1')
    expect(await save(id, { 'rating.relevance': '4' })).toEqual({ status: 'ok', message: 'Saved.' })
    const writes = fakePrisma.writes().length
    expect(await save(id, { 'rating.relevance': '4' })).toEqual({ status: 'ok', message: 'No changes to save.' })
    expect(fakePrisma.writes()).toHaveLength(writes)
  })

  it.each([
    ["another trainee's check-in", (t: string, o: string) => seedForm('WEEKLY', o, o, 'W01', { status: 'DRAFT' })],
    ["the preceptor's Form 3.1 about the trainee", (t: string, _o: string, p: string) => seedForm('FORM_3_1', t, p, 'M01', { status: 'DRAFT' })],
    ["a Form 1.3", (t: string, _o: string, p: string) => seedFormOneThree(t, p, 'M04', { status: 'DRAFT' })],
  ])('cannot save or submit %s: not found, nothing written', async (_label, seed) => {
    const { trainee, preceptor } = pair('2026-01-01')
    const other = seedTrainee('2026-01-01')
    signInAs(trainee)
    const row = seed(trainee.id, other.id, preceptor.id)
    const writes = fakePrisma.writes().length
    expect(await save(row.id as string, { 'rating.relevance': '4' })).toEqual(NOT_FOUND)
    expect(await submit(row.id as string, complete('FORM_1_1'))).toEqual(NOT_FOUND)
    expect(fakePrisma.writes()).toHaveLength(writes)
  })

  it.each(NON_TRAINEE_CALLERS)('$label cannot call the trainee actions', async ({ signIn }) => {
    signIn()
    expect(await refusal(startMyEvaluationForm(IDLE, form({ formType: 'WEEKLY' })))).toBe('/nutrition/no-access')
    expect(await refusal(submitMyEvaluationForm(IDLE, form({ formId: '6f1c2b8e-4a3d-4f5e-9b7a-1c2d3e4f5a6b' })))).toBe('/nutrition/no-access')
  })
})

describe('preceptor: Forms 1.2 and 3.1', () => {
  it('the active primary preceptor starts Form 3.1 for their trainee; the server picks the point', async () => {
    const { trainee, preceptor } = pair('2026-04-15')
    signInAs(preceptor)
    const result = await startFor({ formType: 'FORM_3_1', traineeId: trainee.id, assessmentPoint: 'M09' })
    const id = idFrom(result)
    expect(result).toEqual({ redirect: `/nutrition/preceptor/forms/${id}` })
    expect(formById(id)).toMatchObject({
      formType: 'FORM_3_1',
      subjectId: trainee.id,
      authorId: preceptor.id,
      assessmentPoint: 'M01',
      createdBy: preceptor.authUserId,
      status: 'DRAFT',
    })
    expect(fakePrisma.calls.filter((call) => call.inTransaction)[0]).toMatchObject({ args: { sql: LOCK_SQL, values: [trainee.id] } })
  })

  it('Form 1.2 is due only at Months 4, 8 and 12', async () => {
    const { trainee, preceptor } = pair('2026-01-01') // 15 April: month 4
    seedHistory(trainee.id, preceptor.id, 14, 3)
    signInAs(preceptor)
    const id = idFrom(await startFor({ formType: 'FORM_1_2', traineeId: trainee.id }))
    expect(formById(id)).toMatchObject({ assessmentPoint: 'M04', monthNumber: 4 })

    // Month 2 of another trainee: not a checkpoint.
    const early = seedTrainee('2026-03-01')
    seedAssignment(early.id, preceptor.id)
    expect(await startFor({ formType: 'FORM_1_2', traineeId: early.id })).toEqual(NOT_DUE)

    // Month 5, with Month 4 already submitted.
    vi.setSystemTime(new Date('2026-05-15T07:00:00Z'))
    signInAs(preceptor) // a fresh session token for the new time
    expect(await submitTraineeEvaluation(IDLE, form({ formId: id, ...complete('FORM_1_2') }))).toEqual({ status: 'ok', message: 'Submitted.' })
    expect(await startFor({ formType: 'FORM_1_2', traineeId: trainee.id })).toEqual(NOT_DUE)
  })

  it.each([
    ['a preceptor with no assignment', () => ({ caller: seedProfile('PRECEPTOR'), trainee: pair().trainee })],
    [
      'a former primary preceptor (assignment ended)',
      () => {
        const trainee = seedTrainee('2026-04-15')
        const caller = seedProfile('PRECEPTOR')
        seedAssignment(trainee.id, caller.id, false)
        return { caller, trainee }
      },
    ],
    [
      'a rotation preceptor (supervises a placement, holds no assignment)',
      () => {
        const { trainee } = pair('2026-04-15')
        const caller = seedProfile('PRECEPTOR')
        const rotation = fakePrisma.seed('nutritionRotation', { name: 'Nephrology', createdBy: 'auth-seed' })
        fakePrisma.seed('nutritionRotationEntry', {
          traineeId: trainee.id,
          rotationId: rotation.id,
          rotationPreceptorId: caller.id,
          startDate: new Date('2026-04-01T00:00:00Z'),
          createdBy: 'auth-seed',
        })
        return { caller, trainee }
      },
    ],
  ])('%s cannot start Form 1.2 or 3.1: refused, nothing written', async (_label, setup) => {
    const { caller, trainee } = setup()
    signInAs(caller)
    expect(await startFor({ formType: 'FORM_3_1', traineeId: trainee.id })).toEqual(TRAINEE_NOT_FOUND)
    expect(await startFor({ formType: 'FORM_1_2', traineeId: trainee.id })).toEqual(TRAINEE_NOT_FOUND)
    expect(forms()).toEqual([])
    expect(audit()).toEqual([])
  })

  it('saves and submits their own draft, and is refused once the assignment has ended', async () => {
    const { trainee, preceptor, assignment } = pair('2026-04-15')
    signInAs(preceptor)
    const id = idFrom(await startFor({ formType: 'FORM_3_1', traineeId: trainee.id }))
    expect(await saveTraineeEvaluation(IDLE, form({ formId: id, 'rating.professionalism': '4' }))).toEqual({ status: 'ok', message: 'Saved.' })

    fakePrisma.tables.nutritionPreceptorAssignment.find((a) => a.id === assignment.id)!.active = false
    expect(await submitTraineeEvaluation(IDLE, form({ formId: id, ...complete('FORM_3_1') }))).toEqual({
      status: 'error',
      message: "You are no longer this trainee's primary preceptor, so this form can no longer be changed.",
    })
    expect(formById(id)).toMatchObject({ status: 'DRAFT' })
  })

  it('MDGRS is scored on the server: 6 domains, out of 30', async () => {
    const { trainee, preceptor } = pair('2026-04-15')
    signInAs(preceptor)
    const id = idFrom(await startFor({ formType: 'FORM_3_1', traineeId: trainee.id }))
    expect(await submitTraineeEvaluation(IDLE, form({ formId: id, ...ratingFields('FORM_3_1', 4), totalScore: '30' }))).toEqual({
      status: 'ok',
      message: 'Submitted.',
    })
    expect(formById(id)).toMatchObject({ status: 'SUBMITTED', totalScore: 24, maxScore: 30 })
  })

  it("cannot change another preceptor's draft or the trainee's own form", async () => {
    const { trainee, preceptor } = pair('2026-04-15')
    const colleague = seedProfile('PRECEPTOR')
    const theirs = seedForm('FORM_3_1', trainee.id, colleague.id, 'M01', { status: 'DRAFT' })
    const traineeOwn = seedForm('FORM_1_1', trainee.id, trainee.id, 'M01', { status: 'DRAFT' })
    signInAs(preceptor)
    for (const row of [theirs, traineeOwn]) {
      expect(await saveTraineeEvaluation(IDLE, form({ formId: row.id as string, 'rating.professionalism': '4' }))).toEqual(NOT_FOUND)
    }
  })

  it.each(NON_PRECEPTOR_CALLERS)('$label cannot call the preceptor actions', async ({ signIn }) => {
    const { trainee } = pair('2026-04-15')
    signIn()
    expect(await refusal(startTraineeEvaluation(IDLE, form({ formType: 'FORM_3_1', traineeId: trainee.id })))).toBe('/nutrition/no-access')
    expect(await refusal(reopenEvaluationForm(IDLE, form({ formId: '6f1c2b8e-4a3d-4f5e-9b7a-1c2d3e4f5a6b' })))).toBe('/nutrition/no-access')
    expect(await refusal(commentOnWeeklyCheckIn(IDLE, form({ formId: '6f1c2b8e-4a3d-4f5e-9b7a-1c2d3e4f5a6b', comment: 'x' })))).toBe('/nutrition/no-access')
  })
})

describe('reopen: only by the active primary preceptor, logged, never Form 1.3', () => {
  it.each([
    ['WEEKLY', 'W01', 'trainee'],
    ['FORM_1_1', 'M01', 'trainee'],
    ['FORM_1_2', 'M04', 'preceptor'],
    ['FORM_3_1', 'M01', 'preceptor'],
  ] as const)('%s: back to DRAFT, scores cleared, audited as reopen', async (formType, point, author) => {
    const { trainee, preceptor } = pair('2026-01-01')
    const row = seedForm(formType, trainee.id, author === 'trainee' ? trainee.id : preceptor.id, point)
    signInAs(preceptor)
    expect(await reopenEvaluationForm(IDLE, form({ formId: row.id as string }))).toEqual({ status: 'ok', message: 'Reopened. Its author can change it and submit it again.' })
    expect(formById(row.id as string)).toMatchObject({ status: 'DRAFT', submittedAt: null, totalScore: null, maxScore: null })
    expect(audit()).toEqual([
      expect.objectContaining({
        action: 'reopen',
        entityId: row.id,
        actorId: preceptor.authUserId,
        before: expect.objectContaining({ status: 'SUBMITTED' }),
        after: expect.objectContaining({ status: 'DRAFT' }),
      }),
    ])
  })

  it('a reopened check-in can be changed and submitted again by the trainee', async () => {
    const { trainee, preceptor } = pair('2026-04-15')
    const row = seedForm('WEEKLY', trainee.id, trainee.id, 'W01')
    signInAs(preceptor)
    await reopenEvaluationForm(IDLE, form({ formId: row.id as string }))
    signInAs(trainee)
    expect(await submit(row.id as string, textFields('WEEKLY', 'Corrected.'))).toEqual({ status: 'ok', message: 'Submitted.' })
    expect(formById(row.id as string)).toMatchObject({ status: 'SUBMITTED', answers: { text: { cases_this_week: 'Corrected.' } } })
  })

  it.each([
    ['a colleague who is not the primary preceptor', 'colleague', 'SUBMITTED', NOT_FOUND],
    ['a former primary preceptor', 'former', 'SUBMITTED', NOT_FOUND],
    ['a form that is still a draft', 'primary', 'DRAFT', { status: 'error', message: 'Only a submitted form can be reopened.' }],
  ] as const)('refused for %s, nothing written', async (_label, who, status, expected) => {
    const { trainee, preceptor, assignment } = pair('2026-04-15')
    const colleague = seedProfile('PRECEPTOR')
    const row = seedForm('FORM_3_1', trainee.id, preceptor.id, 'M01', { status })
    if (who === 'former') fakePrisma.tables.nutritionPreceptorAssignment.find((a) => a.id === assignment.id)!.active = false
    signInAs(who === 'colleague' ? colleague : preceptor)
    expect(await reopenEvaluationForm(IDLE, form({ formId: row.id as string }))).toEqual(expected)
    expect(formById(row.id as string)).toMatchObject({ status })
    expect(audit()).toEqual([])
  })

  it('a Form 1.3 can never be reopened, not even by the preceptor it is about', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    const row = seedFormOneThree(trainee.id, preceptor.id, 'M04')
    signInAs(preceptor)
    expect(await reopenEvaluationForm(IDLE, form({ formId: row.id as string }))).toEqual(NOT_FOUND)
    expect(formById(row.id as string)).toMatchObject({ status: 'SUBMITTED' })
    expect(audit()).toEqual([])
  })
})

describe('weekly comments by the primary preceptor', () => {
  it('stores the comment with the reviewer and time; the audit row has its length only', async () => {
    const { trainee, preceptor } = pair('2026-04-15')
    const row = seedForm('WEEKLY', trainee.id, trainee.id, 'W01')
    signInAs(preceptor)
    const comment = 'Good week. Read the renal diet chapter before Thursday.'
    expect(await commentOnWeeklyCheckIn(IDLE, form({ formId: row.id as string, comment }))).toEqual({ status: 'ok', message: 'Comment saved.' })
    expect(formById(row.id as string)).toMatchObject({ reviewedById: preceptor.id, reviewedAt: NOW, reviewComment: comment, status: 'SUBMITTED' })
    expect(audit()).toEqual([expect.objectContaining({ action: 'comment', actorId: preceptor.authUserId, after: expect.objectContaining({ reviewCommentLength: comment.length }) })])
    expect(JSON.stringify(audit())).not.toContain('renal diet')
  })

  it.each([
    ['a patient identifier', 'SUBMITTED', 'WEEKLY', 'MRN 1234567 needs follow-up', 'primary', { status: 'error', fieldErrors: { comment: expect.stringContaining('ID number') } }],
    ['a draft check-in', 'DRAFT', 'WEEKLY', 'Nice.', 'primary', { status: 'error', message: 'Only a submitted check-in can be commented on.' }],
    ['a Form 1.1', 'SUBMITTED', 'FORM_1_1', 'Nice.', 'primary', NOT_FOUND],
    ['a preceptor who is not the primary one', 'SUBMITTED', 'WEEKLY', 'Nice.', 'colleague', NOT_FOUND],
  ] as const)('refused on %s', async (_label, status, formType, comment, who, expected) => {
    const { trainee, preceptor } = pair('2026-04-15')
    const colleague = seedProfile('PRECEPTOR')
    const row = seedForm(formType, trainee.id, trainee.id, formType === 'WEEKLY' ? 'W01' : 'M01', { status })
    signInAs(who === 'primary' ? preceptor : colleague)
    expect(await commentOnWeeklyCheckIn(IDLE, form({ formId: row.id as string, comment }))).toMatchObject(expected)
    expect(formById(row.id as string)).toMatchObject({ reviewComment: null })
  })
})
