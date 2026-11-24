import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('../../auth/__tests__/fakes')).headersModule)
vi.mock('next/navigation', async () => (await import('../../auth/__tests__/fakes')).navigationModule)
vi.mock('@supabase/supabase-js', async () => (await import('../../auth/__tests__/fakes')).supabaseModule)
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./fake-prisma')).fakePrisma }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { revalidatePath } from 'next/cache'
import { RedirectSignal, resetState } from '../../auth/__tests__/fakes'
import { approveCaseLog, rejectCaseLog } from '../actions/case-log-reviews'
import { submitCaseLog } from '../actions/case-logs'
import { getReviewCaseLog, listReviewHistory, listReviewQueue } from '../queries/case-log-reviews'
import { getMyCaseLog } from '../queries/case-logs'
import { IDLE, NON_PRECEPTOR_CALLERS, form, isGuardRead, seedAssignment, seedProfile, signIn, signInPreceptor } from './actors'
import { fakePrisma } from './fake-prisma'

// The preceptor's case-log review: server actions and loaders, against the
// in-memory Prisma fake, with the real guard in front of them (see actors.ts).

const REVIEWS = '/nutrition/preceptor/reviews'
const NOW = new Date('2026-10-11T08:00:00Z')
const MISSING_ID = '6f1c2b8e-4a3d-4f5e-9b7a-1c2d3e4f5a6b'
const NOT_FOUND = { status: 'error', message: 'This case log was not found.' }
const ALREADY_APPROVED = { status: 'error', message: 'This case log has already been approved.' }
const ALREADY_RETURNED = { status: 'error', message: 'This case log has already been reviewed and returned to the trainee.' }

const TEXT = {
  assessment: 'Weight 72.5 kg, BMI 26.6; eating half of each meal for two weeks.',
  diagnosis: 'Inadequate oral intake related to nausea, as evidenced by intake below 50% of needs.',
  intervention: 'Small frequent meals; energy 1800 to 2000 kcal/day; protein 1.2 g/kg/day.',
  monitoring_evaluation: 'Weigh weekly; review intake and nausea in 7 days.',
}

type Row = Record<string, unknown>
const logs = () => fakePrisma.tables.nutritionCaseLog
const audit = () => fakePrisma.tables.nutritionAuditLog
const snapshot = (value: unknown) => value as Row
const logById = (id: string) => logs().find((log) => log.id === id) as Row

let rotation: { id: string }

/** A case log, SUBMITTED unless told otherwise. */
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
    status: 'SUBMITTED',
    submittedAt: new Date('2026-10-10T08:00:00Z'),
    createdBy: 'auth-seed',
    ...fields,
  }) as { id: string }
}

/** The signed-in preceptor with one trainee of their own, and a colleague with another trainee. */
function scenario() {
  const mine = seedProfile('TRAINEE', { fullName: 'Ayesha Khan' })
  const theirs = seedProfile('TRAINEE', { fullName: 'Bilal Ahmed' })
  const colleague = seedProfile('PRECEPTOR', { fullName: 'Dr Colleague' })
  const me = signInPreceptor({ fullName: 'Dr Me' })
  const myAssignment = seedAssignment(mine.id, me.id)
  seedAssignment(theirs.id, colleague.id)
  return { me, mine, theirs, colleague, myAssignment }
}

const approve = (logId: string, fields: Record<string, string> = {}) => approveCaseLog(IDLE, form({ logId, ...fields }))
const reject = (logId: string, comment?: string, fields: Record<string, string> = {}) =>
  rejectCaseLog(IDLE, form({ logId, ...(comment === undefined ? {} : { comment }), ...fields }))

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
  rotation = fakePrisma.seed('nutritionRotation', { name: 'Nephrology', createdBy: 'auth-seed' }) as { id: string }
})

afterEach(() => {
  expect(fakePrisma.calls.filter((call) => /\.delete(Many)?$/.test(call.op))).toEqual([])
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('what a preceptor sees', () => {
  it('the queue holds only SUBMITTED logs of my own trainees, oldest first', async () => {
    const { mine, theirs } = scenario()
    const later = seedLog(mine.id, { caseCode: 'C-2026-002', submittedAt: new Date('2026-10-09T08:00:00Z') })
    const earlier = seedLog(mine.id, { caseCode: 'C-2026-001', submittedAt: new Date('2026-10-02T08:00:00Z') })
    seedLog(mine.id, { caseCode: 'C-2026-003', status: 'DRAFT', submittedAt: null })
    seedLog(mine.id, { caseCode: 'C-2026-004', status: 'APPROVED' })
    seedLog(mine.id, { caseCode: 'C-2026-005', status: 'REJECTED' })
    seedLog(theirs.id, { caseCode: 'C-2026-001' })

    const row = { formType: 'A', traineeName: 'Ayesha Khan', rotationName: 'Nephrology', epaLevel: 'E2' }
    expect(await listReviewQueue()).toEqual([
      { ...row, id: earlier.id, caseCode: 'C-2026-001', submittedOn: '2026-10-02' },
      { ...row, id: later.id, caseCode: 'C-2026-002', submittedOn: '2026-10-09' },
    ])
  })

  it('the history holds APPROVED and REJECTED logs of my trainees, reviewed by anyone, latest review first', async () => {
    const { me, mine, theirs, colleague } = scenario()
    const byColleague = seedLog(mine.id, {
      caseCode: 'C-2026-001',
      status: 'APPROVED',
      reviewedById: colleague.id,
      reviewedAt: new Date('2026-10-02T08:00:00Z'),
    })
    const byMe = seedLog(mine.id, {
      caseCode: 'C-2026-002',
      status: 'REJECTED',
      reviewedById: me.id,
      reviewedAt: new Date('2026-10-05T08:00:00Z'),
      reviewComment: 'Add the PES statement.',
    })
    seedLog(mine.id, { caseCode: 'C-2026-003', status: 'DRAFT', submittedAt: null })
    seedLog(mine.id, { caseCode: 'C-2026-004' })
    seedLog(theirs.id, { status: 'APPROVED', reviewedById: colleague.id, reviewedAt: NOW })

    expect(await listReviewHistory()).toEqual([
      { id: byMe.id, caseCode: 'C-2026-002', formType: 'A', traineeName: 'Ayesha Khan', status: 'REJECTED', reviewedOn: '2026-10-05', reviewerName: 'Dr Me' },
      {
        id: byColleague.id,
        caseCode: 'C-2026-001',
        formType: 'A',
        traineeName: 'Ayesha Khan',
        status: 'APPROVED',
        reviewedOn: '2026-10-02',
        reviewerName: 'Dr Colleague',
      },
    ])
  })

  it("one of my trainee's logs, read only: the case content and of the trainee only the name", async () => {
    const { mine } = scenario()
    const log = seedLog(mine.id)
    const detail = await getReviewCaseLog(log.id)
    expect(detail).toEqual({
      id: log.id,
      caseCode: 'C-2026-001',
      formType: 'A',
      traineeName: 'Ayesha Khan',
      rotationName: 'Nephrology',
      ageBand: '40_59y',
      diagnosisCategory: 'placeholder_renal',
      epaLevel: 'E2',
      status: 'SUBMITTED',
      data: TEXT,
      submittedOn: '2026-10-10',
      reviewedOn: null,
      reviewerName: null,
      reviewComment: null,
    })
    expect(JSON.stringify(detail)).not.toContain(mine.email)
    expect(JSON.stringify(detail)).not.toContain(mine.id)
  })

  it("a DRAFT of my trainee, another trainee's log and a missing log are all not found", async () => {
    const { mine, theirs } = scenario()
    const draft = seedLog(mine.id, { status: 'DRAFT', submittedAt: null })
    const other = seedLog(theirs.id)
    for (const id of [draft.id, other.id, MISSING_ID]) expect(await getReviewCaseLog(id), id).toBeNull()
  })

  it('a malformed id is not found, without a database read', async () => {
    scenario()
    expect(await getReviewCaseLog('../../admin')).toBeNull()
    expect(fakePrisma.calls.filter((call) => !isGuardRead(call))).toEqual([])
  })

  it("when the assignment ends, the preceptor loses access to that trainee's logs", async () => {
    const { mine, myAssignment } = scenario()
    const waiting = seedLog(mine.id)
    const reviewed = seedLog(mine.id, { caseCode: 'C-2026-002', status: 'APPROVED', reviewedAt: NOW })
    expect(await listReviewQueue()).toHaveLength(1)
    expect(await listReviewHistory()).toHaveLength(1)

    // An admin ends it, as endAssignment does: active = false, the row stays.
    const assignment = fakePrisma.tables.nutritionPreceptorAssignment.find((row) => row.id === myAssignment.id) as Row
    assignment.active = false

    expect(await listReviewQueue()).toEqual([])
    expect(await listReviewHistory()).toEqual([])
    expect(await getReviewCaseLog(waiting.id)).toBeNull()
    expect(await getReviewCaseLog(reviewed.id)).toBeNull()
    expect(await approve(waiting.id)).toEqual(NOT_FOUND)
    expect(await reject(waiting.id, 'Please expand the plan.')).toEqual(NOT_FOUND)
    expect(logById(waiting.id).status).toBe('SUBMITTED')
    expect(fakePrisma.writes()).toEqual([])
  })
})

describe('approve and reject', () => {
  it('approve: SUBMITTED → APPROVED, reviewed by my profile now, with an optional comment', async () => {
    const { me, mine } = scenario()
    const log = seedLog(mine.id)
    expect(await approve(log.id, { comment: '  Well reasoned PES statement.  ' })).toEqual({ status: 'ok', message: 'Approved.' })
    expect(logById(log.id)).toMatchObject({
      status: 'APPROVED',
      reviewedById: me.id,
      reviewedAt: NOW,
      reviewComment: 'Well reasoned PES statement.',
      epaLevel: 'E2',
      data: TEXT,
    })
    expect(audit()).toEqual([expect.objectContaining({ entity: 'NutritionCaseLog', entityId: log.id, action: 'approve', actorId: me.authUserId })])
    expect(fakePrisma.writes().every((write) => write.inTransaction)).toBe(true)
    for (const path of [REVIEWS, `${REVIEWS}/${log.id}`, '/nutrition/preceptor']) expect(revalidatePath).toHaveBeenCalledWith(path)
  })

  it('approve without a comment stores none', async () => {
    const { mine } = scenario()
    const log = seedLog(mine.id)
    expect(await approve(log.id)).toEqual({ status: 'ok', message: 'Approved.' })
    expect(logById(log.id)).toMatchObject({ status: 'APPROVED', reviewComment: null })
  })

  it('reject: SUBMITTED → REJECTED with the trimmed comment, back with the trainee', async () => {
    const { me, mine } = scenario()
    const log = seedLog(mine.id)
    expect(await reject(log.id, '  Expand the monitoring plan.  ')).toEqual({ status: 'ok', message: 'Returned to the trainee.' })
    expect(logById(log.id)).toMatchObject({ status: 'REJECTED', reviewedById: me.id, reviewedAt: NOW, reviewComment: 'Expand the monitoring plan.' })
    expect(audit().map((row) => row.action)).toEqual(['reject'])
  })

  it.each([
    ['no comment at all', undefined, 'Say what the trainee should change.'],
    ['an empty comment', '', 'Say what the trainee should change (at least 5 characters).'],
    ['only spaces', '        ', 'Say what the trainee should change (at least 5 characters).'],
    ['4 characters', 'Redo', 'Say what the trainee should change (at least 5 characters).'],
    ['2001 characters', 'x'.repeat(2001), 'Keep the comment under 2000 characters.'],
  ])('reject with %s is refused, and nothing is written', async (_label, comment, message) => {
    const { mine } = scenario()
    const log = seedLog(mine.id)
    expect(await reject(log.id, comment)).toEqual({ status: 'error', message: 'Check the highlighted fields.', fieldErrors: { comment: message } })
    expect(logById(log.id).status).toBe('SUBMITTED')
    expect(fakePrisma.writes()).toEqual([])
  })

  it('an approval comment over 2000 characters is refused', async () => {
    const { mine } = scenario()
    const log = seedLog(mine.id)
    expect(await approve(log.id, { comment: 'x'.repeat(2001) })).toMatchObject({ fieldErrors: { comment: 'Keep the comment under 2000 characters.' } })
    expect(fakePrisma.writes()).toEqual([])
  })

  it('a comment with a patient identifier is refused, approving or returning', async () => {
    const { mine } = scenario()
    const log = seedLog(mine.id)
    expect(await reject(log.id, 'Call the mother on 0300-1234567 first.')).toMatchObject({
      fieldErrors: { comment: expect.stringContaining('looks like a phone number') },
    })
    expect(await approve(log.id, { comment: 'Matches MRN 1234567.' })).toMatchObject({
      fieldErrors: { comment: expect.stringContaining('looks like an MRN') },
    })
    expect(fakePrisma.writes()).toEqual([])
  })

  it("my trainee's DRAFT, another trainee's log and a missing log get the same not found, and nothing is written", async () => {
    const { mine, theirs } = scenario()
    const draft = seedLog(mine.id, { status: 'DRAFT', submittedAt: null })
    const other = seedLog(theirs.id)
    const stored = structuredClone(logs())
    for (const id of [draft.id, other.id, MISSING_ID]) {
      expect(await approve(id), `approve ${id}`).toEqual(NOT_FOUND)
      expect(await reject(id, 'Please expand this.'), `reject ${id}`).toEqual(NOT_FOUND)
    }
    expect(logs()).toEqual(stored)
    expect(fakePrisma.writes()).toEqual([])
  })

  it('APPROVED is final: neither approve nor reject changes it again', async () => {
    const { mine } = scenario()
    const log = seedLog(mine.id)
    await approve(log.id, { comment: 'Good work.' })
    const approved = structuredClone(logById(log.id))
    expect(await approve(log.id)).toEqual(ALREADY_APPROVED)
    expect(await reject(log.id, 'Changed my mind.')).toEqual(ALREADY_APPROVED)
    expect(logById(log.id)).toEqual(approved)
    expect(audit().map((row) => row.action)).toEqual(['approve'])
  })

  it('a returned log waits for the trainee to resubmit; its comment stays visible until the next review overwrites it', async () => {
    const { me, mine } = scenario()
    const log = seedLog(mine.id)
    const comment = 'Expand the monitoring plan.'
    expect(await reject(log.id, comment)).toEqual({ status: 'ok', message: 'Returned to the trainee.' })
    expect(await approve(log.id)).toEqual(ALREADY_RETURNED)

    // The trainee sees the comment, resubmits with the real e-logbook action, and still sees it.
    signIn(mine.authUserId as string, mine.email)
    expect(await getMyCaseLog(log.id)).toMatchObject({ status: 'REJECTED', reviewComment: comment })
    const resubmit = form({
      logId: log.id,
      formType: 'A',
      rotationId: rotation.id,
      ageBand: '40_59y',
      diagnosisCategory: 'placeholder_renal',
      epaLevel: 'E3',
      ...Object.fromEntries(Object.entries(TEXT).map(([key, value]) => [`data.${key}`, value])),
      'data.monitoring_evaluation': 'Weigh weekly; repeat the 24-hour recall in 7 days.',
    })
    expect(await submitCaseLog(IDLE, resubmit)).toEqual({ status: 'ok', message: 'Resubmitted for review.' })
    expect(await getMyCaseLog(log.id)).toMatchObject({ status: 'SUBMITTED', reviewComment: comment })

    // The preceptor sees it again, with the comment it was returned with; the next review overwrites it.
    signIn(me.authUserId as string, me.email)
    expect(await getReviewCaseLog(log.id)).toMatchObject({ status: 'SUBMITTED', epaLevel: 'E3', reviewComment: comment })
    expect(await approve(log.id)).toEqual({ status: 'ok', message: 'Approved.' })
    expect(logById(log.id)).toMatchObject({ status: 'APPROVED', reviewComment: null })

    expect(audit().map((row) => row.action)).toEqual(['reject', 'resubmit', 'approve'])
    expect(snapshot(audit()[2].before).reviewCommentLength).toBe(comment.length)
    expect(JSON.stringify(audit())).not.toContain(comment)
  })

  it.each([
    ['approve first', 'APPROVED'],
    ['reject first', 'REJECTED'],
  ])('two tabs, an approve and a reject at the same moment (%s): only the first wins', async (_label, first) => {
    const { mine } = scenario()
    const log = seedLog(mine.id)
    const approving = () => approve(log.id)
    const rejecting = () => reject(log.id, 'Please expand this.')
    const [winner, loser] = first === 'APPROVED' ? await Promise.all([approving(), rejecting()]) : await Promise.all([rejecting(), approving()])

    expect(winner).toEqual({ status: 'ok', message: first === 'APPROVED' ? 'Approved.' : 'Returned to the trainee.' })
    expect(loser).toEqual(first === 'APPROVED' ? ALREADY_APPROVED : ALREADY_RETURNED)
    expect(logById(log.id).status).toBe(first)
    expect(audit().map((row) => row.action)).toEqual([first === 'APPROVED' ? 'approve' : 'reject'])
  })

  it('a double click on approve approves once', async () => {
    const { mine } = scenario()
    const log = seedLog(mine.id)
    expect(await Promise.all([approve(log.id), approve(log.id)])).toEqual([{ status: 'ok', message: 'Approved.' }, ALREADY_APPROVED])
    expect(audit()).toHaveLength(1)
  })

  it('a review changes only the status and the review columns: an EPA level, status, content or owner in the form is ignored', async () => {
    const { me, mine, theirs } = scenario()
    const log = seedLog(mine.id)
    await approve(log.id, {
      epaLevel: 'E5',
      status: 'REJECTED',
      traineeId: theirs.id,
      reviewedById: 'someone-else',
      caseCode: 'C-9999-999',
      'data.assessment': 'Rewritten by the preceptor.',
    })
    expect(logById(log.id)).toMatchObject({
      status: 'APPROVED',
      epaLevel: 'E2',
      traineeId: mine.id,
      reviewedById: me.id,
      caseCode: 'C-2026-001',
      data: TEXT,
    })
  })
})

describe('only a PRECEPTOR may review', () => {
  function calls(logId: string): { name: string; run: () => Promise<unknown> }[] {
    return [
      { name: 'approveCaseLog', run: () => approve(logId) },
      { name: 'rejectCaseLog', run: () => reject(logId, 'Please expand this.') },
      { name: 'listReviewQueue', run: () => listReviewQueue() },
      { name: 'listReviewHistory', run: () => listReviewHistory() },
      { name: 'getReviewCaseLog', run: () => getReviewCaseLog(logId) },
    ]
  }

  function someonesLog(): string {
    const trainee = seedProfile('TRAINEE')
    seedAssignment(trainee.id, seedProfile('PRECEPTOR').id)
    return seedLog(trainee.id).id
  }

  it.each(NON_PRECEPTOR_CALLERS)('$label: every action and loader is refused (/nutrition/no-access) before it reads or writes anything', async (caller) => {
    const logId = someonesLog()
    caller.signIn()
    for (const call of calls(logId)) expect(await refusal(call.run()), call.name).toBe('/nutrition/no-access')
    expect(fakePrisma.calls.filter((call) => !isGuardRead(call))).toEqual([])
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('not signed in: refused (/nutrition/login)', async () => {
    const logId = someonesLog()
    for (const call of calls(logId)) expect(await refusal(call.run()), call.name).toBe('/nutrition/login')
    expect(fakePrisma.calls).toEqual([])
  })
})

describe('the audit log keeps no comment and no case content', () => {
  it('approve and reject rows: the status before and after and the comment length, never the comment or the case text', async () => {
    const { me, mine } = scenario()
    const first = seedLog(mine.id)
    const second = seedLog(mine.id, { caseCode: 'C-2026-002' })
    const rejectComment = 'Expand the monitoring plan with weekly weights.'
    const approveComment = 'Clear and complete assessment.'
    await reject(first.id, rejectComment)
    await approve(second.id, { comment: approveComment })

    expect(
      audit().map((row) => [row.action, row.actorId, snapshot(row.before).status, snapshot(row.after).status, snapshot(row.after).reviewCommentLength]),
    ).toEqual([
      ['reject', me.authUserId, 'SUBMITTED', 'REJECTED', rejectComment.length],
      ['approve', me.authUserId, 'SUBMITTED', 'APPROVED', approveComment.length],
    ])
    const logged = JSON.stringify(audit())
    for (const text of [rejectComment, approveComment, ...Object.values(TEXT)]) expect(logged).not.toContain(text)
    for (const row of audit()) {
      for (const value of [row.before, row.after]) {
        expect(Object.keys(snapshot(value)).sort()).toEqual(['caseCode', 'id', 'reviewCommentLength', 'reviewedAt', 'reviewedById', 'status', 'traineeId'])
      }
    }
  })
})
