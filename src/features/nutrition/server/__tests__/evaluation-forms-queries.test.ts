import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('../../auth/__tests__/fakes')).headersModule)
vi.mock('next/navigation', async () => (await import('../../auth/__tests__/fakes')).navigationModule)
vi.mock('@supabase/supabase-js', async () => (await import('../../auth/__tests__/fakes')).supabaseModule)
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./fake-prisma')).fakePrisma }))

import { resetState } from '../../auth/__tests__/fakes'
import {
  getMyDueNow,
  getMyEvaluationForm,
  getMyFormsOverview,
  getTraineeEvaluationForm,
  listMyTraineesForms,
} from '../queries/evaluation-forms'
import { seedAssignment, seedProfile } from './actors'
import { KEY, NOW, pair, seedForm, seedFormOneThree, seedHistory, seedTrainee, signInAs } from './evaluation-fixtures'
import { fakePrisma } from './fake-prisma'

// The evaluation-form loaders for the trainee and the preceptor: the Due panel
// from the scheduler, the lists, and one form. Form 1.3 confidentiality has its
// own file (form-1-3-confidentiality.test.ts).

const brief = (rows: { formType: string; assessmentPoint: string; status: string; overdue: boolean; canStart: boolean; href: string | null }[]) =>
  rows.map((row) => `${row.formType} ${row.assessmentPoint} ${row.status}${row.overdue ? ' OVERDUE' : ''}${row.canStart ? ' START' : ''}${row.href ? ' LINK' : ''}`)

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
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('trainee: getMyFormsOverview', () => {
  it('day 0: the week 1 check-in and Form 1.1 for month 1 can be started; Forms 1.2, 3.1 and 1.3 are not in the panel', async () => {
    const { trainee } = pair('2026-04-15')
    signInAs(trainee)
    const overview = await getMyFormsOverview()
    expect(overview).toMatchObject({ state: 'IN_TRAINING', week: 1, month: 1, hasPreceptor: true, formOneThreeUnavailable: false })
    expect(brief(overview.due)).toEqual(['WEEKLY W01 NOT_STARTED START', 'FORM_1_1 M01 NOT_STARTED START'])
  })

  it('only the oldest form of each type can be started; a draft links to its page', async () => {
    const trainee = signInAs(seedTrainee('2026-04-01')) // week 3
    const draft = seedForm('WEEKLY', trainee.id, trainee.id, 'W01', { status: 'DRAFT' })
    const overview = await getMyFormsOverview()
    expect(brief(overview.due)).toEqual([
      'WEEKLY W01 DRAFT OVERDUE LINK',
      'WEEKLY W02 NOT_STARTED OVERDUE',
      'WEEKLY W03 NOT_STARTED',
      'FORM_1_1 M01 NOT_STARTED START',
    ])
    expect(overview.due[0].href).toBe(`/nutrition/trainee/forms/${draft.id}`)
  })

  it('Month 4: Form 1.3 is due and can be started, linking to the confidential page by checkpoint only', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    seedHistory(trainee.id, preceptor.id, 14, 3)
    signInAs(trainee)
    expect(brief((await getMyFormsOverview()).due)).toEqual(['WEEKLY W15 NOT_STARTED START', 'FORM_1_1 M04 NOT_STARTED START', 'FORM_1_3 M04 NOT_STARTED START'])

    seedFormOneThree(trainee.id, preceptor.id, 'M04', { status: 'DRAFT' })
    const overview = await getMyFormsOverview()
    expect(overview.due.find((row) => row.formType === 'FORM_1_3')).toMatchObject({ status: 'DRAFT', href: '/nutrition/trainee/forms/confidential/M04' })
    expect(overview.formOneThree).toEqual([
      { assessmentPoint: 'M04', status: 'DRAFT', preceptorName: 'Dr Primary', href: '/nutrition/trainee/forms/confidential/M04' },
    ])
  })

  it('without a primary preceptor Form 1.3 is listed but cannot be started', async () => {
    const trainee = signInAs(seedTrainee('2026-01-01'))
    const preceptor = seedProfile('PRECEPTOR')
    seedHistory(trainee.id, preceptor.id, 14, 3)
    const overview = await getMyFormsOverview()
    expect(overview.hasPreceptor).toBe(false)
    expect(overview.due.find((row) => row.formType === 'FORM_1_3')).toMatchObject({ canStart: false })
  })

  it('without the hash key Form 1.3 is left out (fail closed); the other forms still work', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    seedHistory(trainee.id, preceptor.id, 14, 3)
    vi.stubEnv('NUTRITION_AUTHOR_HASH_KEY', undefined)
    signInAs(trainee)
    const overview = await getMyFormsOverview()
    expect(overview.formOneThreeUnavailable).toBe(true)
    expect(overview.due.map((row) => row.formType)).toEqual(['WEEKLY', 'FORM_1_1'])
  })

  it("lists the trainee's own forms and the preceptor's SUBMITTED ones, never the preceptor's drafts", async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    const own = seedForm('WEEKLY', trainee.id, trainee.id, 'W01', { status: 'DRAFT' })
    const mdgrs = seedForm('FORM_3_1', trainee.id, preceptor.id, 'M01')
    seedForm('FORM_3_1', trainee.id, preceptor.id, 'M02', { status: 'DRAFT' })
    signInAs(trainee)
    const { forms } = await getMyFormsOverview()
    expect(forms.map((row) => row.id).sort()).toEqual([own.id, mdgrs.id].sort())
  })

  it.each([
    ['no start date', null, { state: 'START_DATE_NOT_SET', startsOn: null }],
    ['a start date in the future', '2026-06-01', { state: 'NOT_STARTED', startsOn: '2026-06-01' }],
  ] as const)('%s: nothing due', async (_label, start, expected) => {
    signInAs(seedTrainee(start))
    expect(await getMyFormsOverview()).toMatchObject({ ...expected, due: [] })
  })
})

describe('trainee: getMyDueNow and getMyEvaluationForm', () => {
  it('counts what is due now and what is overdue', async () => {
    const trainee = signInAs(seedTrainee('2026-04-01'))
    seedForm('WEEKLY', trainee.id, trainee.id, 'W01')
    expect(await getMyDueNow()).toEqual({ state: 'IN_TRAINING', startsOn: null, week: 3, month: 1, dueNow: 2, overdue: 1 })
  })

  it("opens the trainee's own form, and a submitted Form 3.1 about them, but nothing else", async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    const other = seedTrainee('2026-01-01')
    const own = seedForm('FORM_1_1', trainee.id, trainee.id, 'M01', { status: 'DRAFT' })
    const mdgrs = seedForm('FORM_3_1', trainee.id, preceptor.id, 'M01')
    const mdgrsDraft = seedForm('FORM_3_1', trainee.id, preceptor.id, 'M02', { status: 'DRAFT' })
    const theirs = seedForm('WEEKLY', other.id, other.id, 'W01')
    const formOneThree = seedFormOneThree(trainee.id, preceptor.id)
    signInAs(trainee)
    expect(await getMyEvaluationForm(own.id as string)).toMatchObject({ formType: 'FORM_1_1', editable: true, authorName: null })
    expect(await getMyEvaluationForm(mdgrs.id as string)).toMatchObject({ formType: 'FORM_3_1', editable: false, authorName: 'Dr Primary' })
    for (const row of [mdgrsDraft, theirs, formOneThree]) expect(await getMyEvaluationForm(row.id as string)).toBeNull()
  })
})

describe('preceptor: listMyTraineesForms and getTraineeEvaluationForm', () => {
  it("lists only the active primary preceptor's trainees, with the Forms 1.2 and 3.1 due from them", async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    seedHistory(trainee.id, preceptor.id, 14, 3)
    const former = seedTrainee('2026-01-01', { fullName: 'Former Trainee' })
    seedAssignment(former.id, preceptor.id, false)
    signInAs(preceptor)
    const rows = await listMyTraineesForms()
    expect(rows.map((row) => row.traineeName)).toEqual(['Ayesha Trainee'])
    expect(brief(rows[0].due)).toEqual(['FORM_1_2 M04 NOT_STARTED START', 'FORM_3_1 M04 NOT_STARTED START'])
    expect(JSON.stringify(rows)).not.toContain('FORM_1_3')
  })

  it("shows the trainee's SUBMITTED check-ins for comment, never their drafts", async () => {
    const { trainee, preceptor } = pair('2026-04-15')
    const submitted = seedForm('WEEKLY', trainee.id, trainee.id, 'W01', { reviewComment: 'Good.' })
    seedForm('FORM_1_1', trainee.id, trainee.id, 'M01', { status: 'DRAFT' })
    signInAs(preceptor)
    const [row] = await listMyTraineesForms()
    expect(row.weekly).toEqual([{ id: submitted.id, assessmentPoint: 'W01', submittedOn: '2026-04-01', commented: true, href: `/nutrition/preceptor/forms/${submitted.id}` }])
    expect(row.submitted).toEqual([])
  })

  it('opens a submitted form of their trainee and their own drafts; not the trainee’s drafts, not another trainee, not a 1.3', async () => {
    const { trainee, preceptor } = pair('2026-01-01')
    const stranger = seedTrainee('2026-01-01')
    const weekly = seedForm('WEEKLY', trainee.id, trainee.id, 'W01')
    const ownDraft = seedForm('FORM_3_1', trainee.id, preceptor.id, 'M01', { status: 'DRAFT' })
    const traineeDraft = seedForm('FORM_1_1', trainee.id, trainee.id, 'M01', { status: 'DRAFT' })
    const strangers = seedForm('WEEKLY', stranger.id, stranger.id, 'W01')
    const formOneThree = seedFormOneThree(trainee.id, preceptor.id)
    signInAs(preceptor)
    expect(await getTraineeEvaluationForm(weekly.id as string)).toMatchObject({ traineeName: 'Ayesha Trainee', canComment: true, canReopen: true, editable: false })
    expect(await getTraineeEvaluationForm(ownDraft.id as string)).toMatchObject({ editable: true, canReopen: false })
    for (const row of [traineeDraft, strangers, formOneThree]) expect(await getTraineeEvaluationForm(row.id as string)).toBeNull()
  })
})
