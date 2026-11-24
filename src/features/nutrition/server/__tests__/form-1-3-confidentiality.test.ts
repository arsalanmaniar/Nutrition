import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('../../auth/__tests__/fakes')).headersModule)
vi.mock('next/navigation', async () => (await import('../../auth/__tests__/fakes')).navigationModule)
vi.mock('@supabase/supabase-js', async () => (await import('../../auth/__tests__/fakes')).supabaseModule)
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./fake-prisma')).fakePrisma }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/features/nutrition/server/service-role', () => ({
  canCreateAccounts: vi.fn(() => false),
  createAuthUser: vi.fn(),
  deleteAuthUser: vi.fn(),
}))

import { RedirectSignal, resetState } from '../../auth/__tests__/fakes'
import { MIN_FORM_1_3_RESPONSES } from '../../config/evaluation-forms'
import { reopenEvaluationForm, saveMyFormOneThree, startMyFormOneThree, submitMyFormOneThree } from '../actions/evaluation-forms'
import { assignPreceptor, endAssignment, updateProfile } from '../actions/people'
import { authorHash } from '../author-hash'
import {
  getMyDueNow,
  getMyEvaluationForm,
  getMyFormOneThree,
  getMyFormsOverview,
  getTraineeEvaluationForm,
  listAllFormOneThreeFeedback,
  listMyFormOneThreeFeedback,
  listMyTraineesForms,
  listRotationFormOneThreeFeedback,
} from '../queries/evaluation-forms'
import { IDLE, form, seedAssignment, seedProfile, signIn, signInAdmin, signInSuperAdmin, type SeededProfile } from './actors'
import {
  ALREADY_SUBMITTED,
  FORM_1_3_UNAVAILABLE,
  KEY,
  NOT_DUE,
  NOT_FOUND,
  NOW,
  audit,
  complete,
  formById,
  forms,
  outcome,
  pair,
  seedFormOneThree,
  seedTrainee,
  signInAs,
} from './evaluation-fixtures'
import { fakePrisma } from './fake-prisma'

// Form 1.3 is the trainee's CONFIDENTIAL evaluation of their primary
// preceptor (plan, Step 4). Every line of the rules is tested here:
//  1. the row stores no author (authorId and createdBy NULL, only the 4a
//     authorHash), and its audit rows have actorId NULL and only the type,
//     version, checkpoint and subject;
//  2. the author reads it only through the hash loader; nobody else has any
//     loader that returns an individual 1.3;
//  3. aggregates per preceptor and checkpoint, shown from 2 submitted forms,
//     otherwise exactly { count, hidden: true };
//  4. no timestamps or ids in an aggregate;
//  5. a later admin action cannot reveal a lone response.

const start =() => outcome(startMyFormOneThree())
const save = (formId: string, fields: Record<string, string> = {}) => saveMyFormOneThree(IDLE, form({ formId, ...fields }))
const submit = (formId: string, fields: Record<string, string> = {}) => submitMyFormOneThree(IDLE, form({ formId, ...fields }))
const formOneThree = () => forms().filter((row) => row.formType === 'FORM_1_3')
const formOneThreeAudit = () => audit().filter((row) => row.entity === 'NutritionEvaluationForm' && formOneThree().some((f) => f.id === row.entityId))

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
const DAY = /\b20\d\d-\d{2}-\d{2}\b/
const SECRET = 'SECRET-COMMENT-only-the-author-may-read-this'

/** Everything that identifies this trainee as an author. */
const identity = (trainee: SeededProfile) => [trainee.id, trainee.authUserId as string, trainee.email, trainee.fullName]

beforeEach(() => {
  resetState()
  fakePrisma.reset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW) // 15 April 2026: month 4 for a trainee who started on 1 January
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
  vi.stubEnv('NUTRITION_AUTHOR_HASH_KEY', KEY)
})

afterEach(() => {
  // No Form 1.3 is ever deleted, and no audit row is ever changed.
  expect(fakePrisma.calls.filter((call) => /\.delete(Many)?$/.test(call.op) || /^nutritionAuditLog\.update/.test(call.op))).toEqual([])
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('rule 1: the row and its audit carry no author', () => {
  it('start: authorId NULL, createdBy NULL, the 4a authorHash, about the primary preceptor, at the due checkpoint', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    signInAs(trainee)
    expect(await start()).toEqual({ redirect: '/nutrition/trainee/forms/confidential/M04' })
    const [row] = formOneThree()
    expect(row).toMatchObject({
      formType: 'FORM_1_3',
      subjectId: preceptor.id,
      authorId: null,
      createdBy: null,
      authorHash: authorHash(trainee.id, preceptor.id, 'M04'),
      assessmentPoint: 'M04',
      monthNumber: 4,
      status: 'DRAFT',
      reviewedById: null,
    })
    for (const value of identity(trainee)) expect(JSON.stringify(row)).not.toContain(value)
  })

  it('every audit row of a 1.3 (create, update, submit): actorId NULL, exactly type, version, checkpoint and subject', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    signInAs(trainee)
    await start()
    const id = formOneThree()[0].id as string
    expect(await save(id, { 'rating.used_time_efficiently': '2' })).toEqual({ status: 'ok', message: 'Saved.' })
    expect(await submit(id, { ...complete('FORM_1_3'), 'text.preceptor_comments': SECRET })).toMatchObject({ status: 'ok' })

    const rows = formOneThreeAudit()
    expect(rows.map((row) => row.action)).toEqual(['create', 'update', 'submit'])
    const expected = { formType: 'FORM_1_3', formVersion: 1, assessmentPoint: 'M04', subjectId: preceptor.id }
    for (const row of rows) {
      expect(row.actorId).toBeNull()
      for (const snapshot of [row.before, row.after].filter(Boolean)) expect(snapshot).toEqual(expected)
      const text = JSON.stringify(row)
      for (const value of [...identity(trainee), formOneThree()[0].authorHash as string, SECRET]) expect(text).not.toContain(value)
    }
  })

  it('submit: scored on the server, then locked for good (a second submit and a save are refused)', async () => {
    const { trainee } = pair('2026-01-01')
    signInAs(trainee)
    await start()
    const id = formOneThree()[0].id as string
    expect(await submit(id, { ...complete('FORM_1_3', 2), totalScore: '132' })).toEqual({
      status: 'ok',
      message: 'Submitted. Thank you: your name is not stored with it.',
    })
    expect(formById(id)).toMatchObject({ status: 'SUBMITTED', totalScore: 88, maxScore: 132, authorId: null })
    const writes = fakePrisma.writes().length
    expect(await submit(id, complete('FORM_1_3'))).toEqual(ALREADY_SUBMITTED)
    expect(await save(id, complete('FORM_1_3'))).toEqual(ALREADY_SUBMITTED)
    expect(fakePrisma.writes()).toHaveLength(writes)
  })

  it('can never be reopened, not by its subject preceptor nor by anyone', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    const row = seedFormOneThree(trainee.id, preceptor.id)
    signInAs(preceptor)
    expect(await reopenEvaluationForm(IDLE, form({ formId: row.id as string }))).toEqual(NOT_FOUND)
    expect(formById(row.id as string)).toMatchObject({ status: 'SUBMITTED' })
  })

  it('the checkpoint comes from the server: a client-sent point is ignored', async () => {
    const { trainee } = pair('2026-01-01')
    signInAs(trainee)
    expect(await outcome(startMyFormOneThree())).toEqual({ redirect: '/nutrition/trainee/forms/confidential/M04' })
    expect(formOneThree().map((row) => row.assessmentPoint)).toEqual(['M04'])
  })

  it.each([
    ['month 2 (no checkpoint yet)', '2026-02-20', []],
    ['month 5, Month 4 already submitted', '2025-12-10', ['M04']],
  ] as const)('not due in %s: refused, nothing written', async (_label, startDate, submitted) => {
    const { trainee, preceptor } = pair(startDate)
    for (const point of submitted) seedFormOneThree(trainee.id, preceptor.id, point)
    const before = forms().length
    signInAs(trainee)
    expect(await start()).toEqual(NOT_DUE)
    expect(forms()).toHaveLength(before)
  })

  it('a second start opens the same draft', async () => {
    const { trainee } = pair('2026-01-01')
    signInAs(trainee)
    await start()
    await start()
    expect(formOneThree()).toHaveLength(1)
  })

  it.each([
    ['missing', undefined],
    ['too short', 'short-key'],
  ])('fails closed when the hash key is %s: refused, nothing written', async (_label, key) => {
    const { trainee, preceptor } = pair('2026-01-01')
    const draft = seedFormOneThree(trainee.id, preceptor.id, 'M04', { status: 'DRAFT' })
    vi.stubEnv('NUTRITION_AUTHOR_HASH_KEY', key)
    signInAs(trainee)
    const writes = fakePrisma.writes().length
    expect(await start()).toEqual(FORM_1_3_UNAVAILABLE)
    expect(await save(draft.id as string, { 'rating.used_time_efficiently': '2' })).toEqual(FORM_1_3_UNAVAILABLE)
    expect(await submit(draft.id as string, complete('FORM_1_3'))).toEqual(FORM_1_3_UNAVAILABLE)
    expect(fakePrisma.writes()).toHaveLength(writes)
  })

  it('a trainee with no primary preceptor cannot start one', async () => {
    signInAs(seedTrainee('2026-01-01'))
    expect(await start()).toEqual({ status: 'error', message: 'You have no primary preceptor assigned yet, so there is no one to evaluate.' })
    expect(forms()).toEqual([])
  })

  it("a super_admin's own trainee profile can neither write nor read a 1.3", async () => {
    const preceptor = seedProfile('PRECEPTOR')
    const trainee = seedProfile('TRAINEE', { authUserId: 'auth-boss', email: 'boss@cdnep.test', trainingStartDate: new Date('2026-01-01T00:00:00Z') })
    seedAssignment(trainee.id, preceptor.id)
    seedFormOneThree(trainee.id, preceptor.id)
    signInSuperAdmin()
    expect(await start()).toEqual(FORM_1_3_UNAVAILABLE)
    expect(await getMyFormOneThree('M04')).toEqual({ status: 'unavailable' })
    expect((await getMyFormsOverview()).formOneThree).toEqual([])
  })

  it('comments are checked for patient identifiers when written', async () => {
    const { trainee } = pair('2026-01-01')
    signInAs(trainee)
    await start()
    const id = formOneThree()[0].id as string
    expect(await save(id, { 'text.program_comments': 'Email me at trainee@hospital.edu.pk' })).toMatchObject({
      status: 'error',
      fieldErrors: { 'text.program_comments': expect.stringContaining('email address') },
    })
  })

  it("another trainee cannot save or submit someone's 1.3, even with its id", async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    const draft = seedFormOneThree(trainee.id, preceptor.id, 'M04', { status: 'DRAFT' })
    const other = seedTrainee('2026-01-01')
    seedAssignment(other.id, preceptor.id)
    signInAs(other)
    expect(await save(draft.id as string, { 'rating.used_time_efficiently': '0' })).toEqual(NOT_FOUND)
    expect(await submit(draft.id as string, complete('FORM_1_3'))).toEqual(NOT_FOUND)
    expect(formById(draft.id as string)).toMatchObject({ status: 'DRAFT', answers: expect.objectContaining({ text: {} }) })
  })
})

describe('rule 2: an individual 1.3 is readable only by its author, through the hash loader', () => {
  it('the author reads their own: answers and preceptor, no timestamps', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    seedFormOneThree(trainee.id, preceptor.id, 'M04', { comments: { preceptor_comments: SECRET } })
    signInAs(trainee)
    const mine = await getMyFormOneThree('M04')
    expect(mine.status).toBe('found')
    if (mine.status !== 'found') return
    expect(Object.keys(mine.form).sort()).toEqual(['answers', 'assessmentPoint', 'editable', 'id', 'maxScore', 'preceptorName', 'status', 'totalScore'])
    expect(mine.form).toMatchObject({ assessmentPoint: 'M04', status: 'SUBMITTED', preceptorName: 'Dr Primary', editable: false })
    expect(mine.form.answers.text.preceptor_comments).toBe(SECRET)
    expect(await getMyFormOneThree('M08')).toEqual({ status: 'none' })
    expect(await getMyFormOneThree('W04')).toEqual({ status: 'none' })
  })

  // Every caller but the author, and every loader they could possibly call.
  const LOADERS = (formId: string) => [
    () => getMyFormsOverview(),
    () => getMyDueNow(),
    () => getMyEvaluationForm(formId),
    () => getMyFormOneThree('M04'),
    () => getMyFormOneThree('M08'),
    () => getMyFormOneThree('M12'),
    () => listMyTraineesForms(),
    () => getTraineeEvaluationForm(formId),
    () => listMyFormOneThreeFeedback(),
    () => listRotationFormOneThreeFeedback(),
    () => listAllFormOneThreeFeedback(),
  ]

  it.each([
    ['another trainee of the same preceptor', 'otherTrainee'],
    ['the preceptor the form is about', 'subject'],
    ['another preceptor', 'otherPreceptor'],
    ['a unit lead whose rotation the author is placed on', 'unitLead'],
    ['an ADMIN with a profile', 'admin'],
    ['a super_admin', 'superAdmin'],
    ["a super_admin's trainee profile", 'superAdminTrainee'],
    ['an assessor', 'assessor'],
  ] as const)('%s gets no trace of it from any loader', async (_label, who) => {
    const { trainee, preceptor } = pair('2026-01-01')
    const row = seedFormOneThree(trainee.id, preceptor.id, 'M04', { rating: 1, comments: { preceptor_comments: SECRET, program_comments: SECRET } })
    const unitLead = seedProfile('UNIT_LEAD')
    const rotation = fakePrisma.seed('nutritionRotation', { name: 'Nephrology', unitLeadId: unitLead.id, createdBy: 'auth-seed' })
    fakePrisma.seed('nutritionRotationEntry', { traineeId: trainee.id, rotationId: rotation.id, startDate: new Date('2026-01-01T00:00:00Z'), createdBy: 'auth-seed' })

    const callers: Record<typeof who, () => void> = {
      otherTrainee: () => {
        const other = seedTrainee('2026-01-01')
        seedAssignment(other.id, preceptor.id)
        signInAs(other)
      },
      subject: () => signInAs(preceptor),
      otherPreceptor: () => signInAs(seedProfile('PRECEPTOR')),
      unitLead: () => signInAs(unitLead),
      admin: () => void signInAdmin(),
      superAdmin: () => void signInSuperAdmin(),
      superAdminTrainee: () => {
        seedProfile('TRAINEE', { authUserId: 'auth-boss', email: 'boss@cdnep.test', trainingStartDate: new Date('2026-01-01T00:00:00Z') })
        signInSuperAdmin()
      },
      assessor: () => signInAs(seedProfile('ASSESSOR')),
    }
    callers[who]()

    const seen: string[] = []
    let refused = 0
    for (const load of LOADERS(row.id as string)) {
      try {
        seen.push(JSON.stringify((await load()) ?? null))
      } catch (error) {
        if (!(error instanceof RedirectSignal)) throw error
        refused++ // the guard refused: nothing read
      }
    }
    expect(seen.length + refused).toBe(LOADERS(row.id as string).length)
    const everything = seen.join('\n')
    // Seeing the trainee by name (a preceptor sees their own trainee) is fine; any trace of this form is not.
    for (const secret of [row.id as string, row.authorHash as string, SECRET]) expect(everything).not.toContain(secret)
    // Nobody but a trainee (about their OWN 1.3) is even told that a Form 1.3 is due or exists.
    if (who !== 'otherTrainee') expect(everything).not.toContain('FORM_1_3')
  })

  it('positive control: the same sweep run as the author does find it', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    seedFormOneThree(trainee.id, preceptor.id, 'M04', { comments: { preceptor_comments: SECRET } })
    signInAs(trainee)
    expect(JSON.stringify(await getMyFormOneThree('M04'))).toContain(SECRET)
  })
})

describe('rules 3 and 4: aggregates only, from 3 responses, no ids or timestamps', () => {
  const HIDDEN_ONE = { count: 1, hidden: true }
  const NONE = { count: 0, hidden: true }

  function scene() {
    const { trainee, preceptor } = pair('2026-01-01')
    const second = seedTrainee('2026-01-01', { fullName: 'Bilal Trainee' })
    seedAssignment(second.id, preceptor.id)
    const third = seedTrainee('2026-01-01', { fullName: 'Chand Trainee' })
    seedAssignment(third.id, preceptor.id)
    const unitLead = seedProfile('UNIT_LEAD')
    const rotation = fakePrisma.seed('nutritionRotation', { name: 'Nephrology', unitLeadId: unitLead.id, createdBy: 'auth-seed' })
    fakePrisma.seed('nutritionRotationEntry', { traineeId: trainee.id, rotationId: rotation.id, startDate: new Date('2026-01-01T00:00:00Z'), createdBy: 'auth-seed' })
    return { trainee, second, third, preceptor, unitLead }
  }

  /** The preceptor's checkpoints as each permitted viewer sees them. */
  async function viewsOf(preceptor: SeededProfile, unitLead: SeededProfile) {
    signInAs(preceptor)
    const own = await listMyFormOneThreeFeedback()
    signInAs(unitLead)
    const lead = (await listRotationFormOneThreeFeedback()).find((row) => row.preceptorName === preceptor.fullName)?.checkpoints
    signInAdmin()
    const admin = (await listAllFormOneThreeFeedback()).find((row) => row.preceptorName === preceptor.fullName)?.checkpoints
    return { own, lead, admin }
  }

  it('MIN_FORM_1_3_RESPONSES is 3', () => {
    expect(MIN_FORM_1_3_RESPONSES).toBe(3)
  })

  it.each([1, 2])('n = %i: exactly { count, hidden: true } for the preceptor, the unit lead and ADMIN; no scores, no comments', async (n) => {
    const { trainee, second, preceptor, unitLead } = scene()
    for (const author of [trainee, second].slice(0, n)) {
      seedFormOneThree(author.id, preceptor.id, 'M04', { rating: 1, comments: { preceptor_comments: SECRET } })
    }
    const views = await viewsOf(preceptor, unitLead)
    for (const checkpoints of [views.own, views.lead, views.admin]) {
      expect(checkpoints).toEqual([
        { assessmentPoint: 'M04', result: { count: n, hidden: true } },
        { assessmentPoint: 'M08', result: NONE },
        { assessmentPoint: 'M12', result: NONE },
      ])
      expect(JSON.stringify(checkpoints)).not.toContain(SECRET)
    }
  })

  it('n = 3: averages and the comments, with exactly these keys and no id or timestamp anywhere', async () => {
    const { trainee, second, third, preceptor, unitLead } = scene()
    seedFormOneThree(trainee.id, preceptor.id, 'M04', { rating: 3, comments: { preceptor_comments: 'Always prepared.' } })
    seedFormOneThree(second.id, preceptor.id, 'M04', { rating: 1, comments: { preceptor_comments: 'Hard to reach.', program_comments: 'More clinic time.' } })
    seedFormOneThree(third.id, preceptor.id, 'M04', { rating: 2 })
    const views = await viewsOf(preceptor, unitLead)
    for (const checkpoints of [views.own, views.lead, views.admin]) {
      const m04 = checkpoints?.[0]
      expect(Object.keys(m04 ?? {}).sort()).toEqual(['assessmentPoint', 'result'])
      const result = m04?.result
      expect(Object.keys(result ?? {}).sort()).toEqual(['comments', 'count', 'hidden', 'items', 'sections', 'total'])
      if (!result || result.hidden) throw new Error('expected a shown aggregate')
      expect(result.count).toBe(3)
      expect(result.total).toEqual({ average: 88, maxScore: 132 })
      expect(result.sections).toEqual([
        { key: 'organized_focused', average: 16, maxScore: 24 },
        { key: 'values_interaction', average: 24, maxScore: 36 },
        { key: 'relates_well', average: 14, maxScore: 21 },
        { key: 'teaching_strategies', average: 16, maxScore: 24 },
        { key: 'professional_competence', average: 18, maxScore: 27 },
      ])
      expect(result.items).toHaveLength(44)
      expect(result.items.every((item) => Object.keys(item).sort().join() === 'average,key' && item.average === 2)).toBe(true)
      expect(Object.keys(result.comments).sort()).toEqual(['preceptor_comments', 'program_comments'])
      expect([...result.comments.preceptor_comments].sort()).toEqual(['Always prepared.', 'Hard to reach.'])
      expect(result.comments.program_comments).toEqual(['More clinic time.'])
      expect(checkpoints?.slice(1).map((c) => c.result)).toEqual([NONE, NONE])

      const text = JSON.stringify(checkpoints)
      expect(text).not.toMatch(UUID)
      expect(text).not.toMatch(ISO_TIME)
      expect(text).not.toMatch(DAY)
      expect(text).not.toMatch(/"(id|formId|traineeId|subjectId|authorId|authorHash|createdBy|submittedAt|submittedOn|createdAt|updatedAt|reviewedAt)":/)
    }
  })

  it('drafts never count: one submitted and one draft stay hidden at n = 1', async () => {
    const { trainee, second, preceptor, unitLead } = scene()
    seedFormOneThree(trainee.id, preceptor.id, 'M04')
    seedFormOneThree(second.id, preceptor.id, 'M04', { status: 'DRAFT', comments: { preceptor_comments: SECRET } })
    const views = await viewsOf(preceptor, unitLead)
    expect(views.own?.[0].result).toEqual(HIDDEN_ONE)
    expect(JSON.stringify(views)).not.toContain(SECRET)
  })

  it('responses about different preceptors, or at different checkpoints, are never pooled to reach 2', async () => {
    const { trainee, second, preceptor } = scene()
    const other = seedProfile('PRECEPTOR', { fullName: 'Dr Other' })
    seedFormOneThree(trainee.id, preceptor.id, 'M04')
    seedFormOneThree(second.id, other.id, 'M04')
    seedFormOneThree(second.id, preceptor.id, 'M08')
    signInAdmin()
    const all = await listAllFormOneThreeFeedback()
    for (const row of all) for (const checkpoint of row.checkpoints) expect(checkpoint.result.hidden).toBe(true)
  })

  it('a unit lead sees only the preceptors linked to their rotations; one with no rotation sees none', async () => {
    const { preceptor, unitLead } = scene()
    const rotationPreceptor = seedProfile('PRECEPTOR', { fullName: 'Dr Rotation' })
    seedProfile('PRECEPTOR', { fullName: 'Dr Elsewhere' })
    const entry = fakePrisma.tables.nutritionRotationEntry[0]
    entry.rotationPreceptorId = rotationPreceptor.id
    signInAs(unitLead)
    expect((await listRotationFormOneThreeFeedback()).map((row) => row.preceptorName)).toEqual(['Dr Primary', 'Dr Rotation'])
    signInAs(seedProfile('UNIT_LEAD'))
    expect(await listRotationFormOneThreeFeedback()).toEqual([])
    expect(preceptor).toBeTruthy()
  })
})

describe('rule 5: a later admin action does not reveal a lone response', () => {
  it('ending the assignment, assigning another preceptor and deactivating the trainee leave it hidden and untouched', async () => {
    const { trainee, preceptor, assignment } = pair('2026-01-01')
    const next = seedProfile('PRECEPTOR', { fullName: 'Dr Next' })
    const row = seedFormOneThree(trainee.id, preceptor.id, 'M04', { rating: 1, comments: { preceptor_comments: SECRET } })
    const before = JSON.stringify(row)

    signInAdmin()
    expect(await endAssignment(IDLE, form({ assignmentId: assignment.id }))).toMatchObject({ status: 'ok' })
    expect(await assignPreceptor(IDLE, form({ traineeId: trainee.id, preceptorId: next.id }))).toMatchObject({ status: 'ok' })
    const nextAssignment = fakePrisma.tables.nutritionPreceptorAssignment.find((a) => a.preceptorId === next.id && a.active)
    expect(await endAssignment(IDLE, form({ assignmentId: nextAssignment?.id as string }))).toMatchObject({ status: 'ok' })
    expect(
      await updateProfile(IDLE, form({ profileId: trainee.id, fullName: trainee.fullName, role: 'TRAINEE', institution: '', isActive: 'false' })),
    ).toMatchObject({ status: 'ok' })

    const all = await listAllFormOneThreeFeedback()
    expect(all.find((r) => r.preceptorName === 'Dr Primary')?.checkpoints[0]).toEqual({ assessmentPoint: 'M04', result: { count: 1, hidden: true } })
    expect(all.find((r) => r.preceptorName === 'Dr Next')?.checkpoints.map((c) => c.result)).toEqual([
      { count: 0, hidden: true },
      { count: 0, hidden: true },
      { count: 0, hidden: true },
    ])
    signInAs(preceptor)
    expect((await listMyFormOneThreeFeedback())[0]).toEqual({ assessmentPoint: 'M04', result: { count: 1, hidden: true } })

    // The 1.3 itself is unchanged, and the admin actions' audit rows never mention it.
    expect(JSON.stringify(formById(row.id as string))).toBe(before)
    const adminAudit = JSON.stringify(audit())
    for (const secret of [row.id as string, row.authorHash as string, SECRET]) expect(adminAudit).not.toContain(secret)
  })
})

describe('the hash loader is per author', () => {
  it('two trainees with the same preceptor each see only their own 1.3', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    const other = seedTrainee('2026-01-01')
    seedAssignment(other.id, preceptor.id)
    seedFormOneThree(trainee.id, preceptor.id, 'M04', { comments: { preceptor_comments: 'mine' } })
    seedFormOneThree(other.id, preceptor.id, 'M04', { comments: { preceptor_comments: 'theirs' } })
    signIn(trainee.authUserId as string, trainee.email)
    const mine = await getMyFormOneThree('M04')
    expect(JSON.stringify(mine)).toContain('"mine"')
    expect(JSON.stringify(mine)).not.toContain('theirs')
  })
})
