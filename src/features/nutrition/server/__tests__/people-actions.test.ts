import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('../../auth/__tests__/fakes')).headersModule)
vi.mock('next/navigation', async () => (await import('../../auth/__tests__/fakes')).navigationModule)
vi.mock('@supabase/supabase-js', async () => (await import('../../auth/__tests__/fakes')).supabaseModule)
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./fake-prisma')).fakePrisma }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/features/nutrition/server/service-role', () => ({
  canCreateAccounts: vi.fn(),
  createAuthUser: vi.fn(),
  deleteAuthUser: vi.fn(),
}))

import { revalidatePath } from 'next/cache'
import { canCreateAccounts, createAuthUser, deleteAuthUser } from '@/features/nutrition/server/service-role'
import { RedirectSignal, resetState } from '../../auth/__tests__/fakes'
import {
  assignPreceptor,
  createProfileWithAccount,
  endAssignment,
  linkProfile,
  setTrainingStartDate,
  updateProfile,
} from '../actions/people'
import {
  IDLE,
  NON_ADMIN_CALLERS,
  form,
  isGuardRead,
  seedAssignment,
  seedProfile,
  signInAdmin,
  signInSuperAdmin,
} from './actors'
import { fakePrisma, uniqueViolation } from './fake-prisma'

const PEOPLE = '/nutrition/admin/people'
const audit = () => fakePrisma.tables.nutritionAuditLog
const assignments = () => fakePrisma.tables.nutritionPreceptorAssignment
const profileByEmail = (email: string) => fakePrisma.tables.nutritionProfile.find((p) => p.email === email)
const profileById = (id: string) => fakePrisma.tables.nutritionProfile.find((p) => p.id === id)

/** Where the guard redirected the caller. Fails the test if the action ran instead. */
async function refusal(attempt: Promise<unknown>): Promise<string> {
  try {
    await attempt
  } catch (error) {
    if (error instanceof RedirectSignal) return error.path
    throw error
  }
  throw new Error('expected the guard to refuse, but the action ran')
}

beforeEach(() => {
  resetState()
  fakePrisma.reset()
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
  vi.mocked(revalidatePath).mockReset()
  vi.mocked(canCreateAccounts).mockReset().mockReturnValue(false)
  vi.mocked(createAuthUser).mockReset()
  vi.mocked(deleteAuthUser).mockReset()
})

afterEach(() => {
  // Whatever a test did, nothing is ever hard-deleted.
  expect(fakePrisma.calls.filter((call) => /\.delete(Many)?$/.test(call.op))).toEqual([])
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('linkProfile', () => {
  it('links a confirmed account: email lower-cased, createdBy and audit actorId are the acting admin', async () => {
    signInAdmin()
    fakePrisma.authUsers.push({ id: 'auth-new', email: 'New.Trainee@CDNEP.test', confirmed: true })

    const result = await linkProfile(
      IDLE,
      form({ email: '  New.Trainee@CDNEP.test ', fullName: ' Ayesha Khan ', role: 'TRAINEE', institution: '', trainingStartDate: '2026-10-01' }),
    )

    expect(result).toEqual({ status: 'ok', message: 'Ayesha Khan added.' })
    const profile = profileByEmail('new.trainee@cdnep.test')
    expect(profile).toMatchObject({
      authUserId: 'auth-new',
      fullName: 'Ayesha Khan',
      role: 'TRAINEE',
      institution: null,
      isActive: true,
      trainingStartDate: new Date('2026-10-01T00:00:00Z'),
      createdBy: 'auth-admin',
    })
    expect(audit()).toEqual([
      expect.objectContaining({
        entity: 'NutritionProfile',
        entityId: profile?.id,
        action: 'link_account',
        actorId: 'auth-admin',
        before: null,
        after: {
          id: profile?.id,
          authUserId: 'auth-new',
          email: 'new.trainee@cdnep.test',
          fullName: 'Ayesha Khan',
          role: 'TRAINEE',
          institution: null,
          trainingStartDate: '2026-10-01',
          isActive: true,
        },
      }),
    ])
    // The profile and its audit row are written together, in one transaction.
    expect(fakePrisma.writes().map((w) => [w.op, w.inTransaction])).toEqual([
      ['nutritionProfile.create', true],
      ['nutritionAuditLog.create', true],
    ])
    expect(revalidatePath).toHaveBeenCalledWith(PEOPLE)
  })

  it.each(['not-an-email', 'a@b', 'two@@cdnep.test', 'spaces in@cdnep.test', ''])(
    'rejects the bad email %j with a field error, before any lookup or write',
    async (email) => {
      signInAdmin()
      const result = await linkProfile(IDLE, form({ email, fullName: 'Some Person', role: 'TRAINEE' }))
      expect(result).toMatchObject({ status: 'error', fieldErrors: { email: 'Enter a valid email address.' } })
      expect(fakePrisma.calls.some((call) => call.op === '$queryRaw')).toBe(false)
      expect(fakePrisma.writes()).toEqual([])
    },
  )

  it('rejects a duplicate profile: same email in another case, nothing written', async () => {
    signInAdmin()
    seedProfile('PRECEPTOR', { email: 'dup@cdnep.test' })
    fakePrisma.authUsers.push({ id: 'auth-dup', email: 'Dup@CDNEP.test', confirmed: true })
    const profilesBefore = fakePrisma.tables.nutritionProfile.length

    const result = await linkProfile(IDLE, form({ email: 'DUP@cdnep.test', fullName: 'Duplicate Person', role: 'TRAINEE' }))

    expect(result).toEqual({
      status: 'error',
      message: 'A profile with this email already exists.',
      fieldErrors: { email: 'Already has a profile.' },
    })
    expect(fakePrisma.tables.nutritionProfile).toHaveLength(profilesBefore)
    expect(fakePrisma.writes()).toEqual([])
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('one profile per Supabase account: an account that already has a profile cannot get a second', async () => {
    signInAdmin()
    // The account's email changed in Supabase after its profile was made.
    seedProfile('TRAINEE', { authUserId: 'auth-moved', email: 'old.address@cdnep.test' })
    fakePrisma.authUsers.push({ id: 'auth-moved', email: 'new.address@cdnep.test', confirmed: true })

    const result = await linkProfile(IDLE, form({ email: 'new.address@cdnep.test', fullName: 'Moved Person', role: 'TRAINEE' }))

    expect(result).toMatchObject({ status: 'error', message: 'This Supabase account already has a profile.' })
    expect(fakePrisma.writes()).toEqual([])
  })

  it('the unique index is the last line: a P2002 from the database becomes a plain error, audit rolled back', async () => {
    signInAdmin()
    fakePrisma.authUsers.push({ id: 'auth-race', email: 'race@cdnep.test', confirmed: true })
    fakePrisma.failNext('nutritionProfile.create', uniqueViolation('email'))

    const result = await linkProfile(IDLE, form({ email: 'race@cdnep.test', fullName: 'Race Person', role: 'PRECEPTOR' }))

    expect(result).toEqual({ status: 'error', message: 'A profile with this email or Supabase account already exists.' })
    expect(profileByEmail('race@cdnep.test')).toBeUndefined()
    expect(audit()).toEqual([])
  })

  it('no confirmed account with that email: refused, nothing written', async () => {
    signInAdmin()
    fakePrisma.authUsers.push({ id: 'auth-unconfirmed', email: 'pending@cdnep.test', confirmed: false })
    const result = await linkProfile(IDLE, form({ email: 'pending@cdnep.test', fullName: 'Pending Person', role: 'TRAINEE' }))
    expect(result).toMatchObject({ status: 'error', fieldErrors: { email: 'No confirmed account with this email.' } })
    expect(fakePrisma.writes()).toEqual([])
  })

  it('two accounts match the email: refused rather than guessing', async () => {
    signInAdmin()
    fakePrisma.authUsers.push({ id: 'auth-twin-1', email: 'twin@cdnep.test', confirmed: true })
    fakePrisma.authUsers.push({ id: 'auth-twin-2', email: 'Twin@cdnep.test', confirmed: true })
    const result = await linkProfile(IDLE, form({ email: 'twin@cdnep.test', fullName: 'Twin Person', role: 'TRAINEE' }))
    expect(result).toMatchObject({ status: 'error', message: expect.stringContaining('More than one Supabase account') })
    expect(fakePrisma.writes()).toEqual([])
  })

  it('a training start date is refused for anyone but a trainee', async () => {
    signInAdmin()
    fakePrisma.authUsers.push({ id: 'auth-p', email: 'preceptor.new@cdnep.test', confirmed: true })
    const result = await linkProfile(
      IDLE,
      form({ email: 'preceptor.new@cdnep.test', fullName: 'New Preceptor', role: 'PRECEPTOR', trainingStartDate: '2026-10-01' }),
    )
    expect(result).toMatchObject({ status: 'error', fieldErrors: { trainingStartDate: 'Only trainees have a training start date.' } })
    expect(fakePrisma.writes()).toEqual([])
  })
})

describe('createProfileWithAccount', () => {
  const PASSWORD = 'Initial-pass-2026'
  const newPerson = { email: 'New.Person@CDNEP.test', fullName: 'New Person', role: 'PRECEPTOR', password: PASSWORD }

  function enableAccountCreation(userId = 'auth-created') {
    vi.mocked(canCreateAccounts).mockReturnValue(true)
    vi.mocked(createAuthUser).mockResolvedValue({ ok: true, userId })
    vi.mocked(deleteAuthUser).mockResolvedValue(true)
  }

  it('without a usable service-role key: refused before Supabase is called or anything is written', async () => {
    signInAdmin()
    const result = await createProfileWithAccount(IDLE, form(newPerson))
    expect(result).toEqual({
      status: 'error',
      message: 'Account creation is not available on this server. Link an existing account instead.',
    })
    expect(createAuthUser).not.toHaveBeenCalled()
    expect(fakePrisma.writes()).toEqual([])
  })

  it('creates the account and the profile together; the password goes to Supabase only', async () => {
    const admin = signInAdmin()
    enableAccountCreation()

    const result = await createProfileWithAccount(IDLE, form(newPerson))

    expect(result).toEqual({ status: 'ok', message: 'New Person added.' })
    expect(createAuthUser).toHaveBeenCalledWith('new.person@cdnep.test', PASSWORD)
    expect(profileByEmail('new.person@cdnep.test')).toMatchObject({ authUserId: 'auth-created', role: 'PRECEPTOR', createdBy: 'auth-admin' })
    expect(audit()).toEqual([expect.objectContaining({ action: 'create_with_account', actorId: 'auth-admin', before: null })])
    for (const text of [JSON.stringify(fakePrisma.tables), JSON.stringify(fakePrisma.calls), JSON.stringify(result)]) {
      expect(text).not.toContain(PASSWORD)
      expect(text).not.toContain(admin.token)
    }
    expect(deleteAuthUser).not.toHaveBeenCalled()
  })

  it('if the profile insert fails, the Supabase account it just created is deleted again', async () => {
    signInAdmin()
    enableAccountCreation()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fakePrisma.failNext('nutritionProfile.create', new Error('fake: connection lost'))

    const result = await createProfileWithAccount(IDLE, form(newPerson))

    expect(result).toEqual({ status: 'error', message: 'The profile could not be saved. The new Supabase account was removed again.' })
    expect(deleteAuthUser).toHaveBeenCalledExactlyOnceWith('auth-created')
    expect(profileByEmail('new.person@cdnep.test')).toBeUndefined()
    expect(audit()).toEqual([])
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('if the audit row fails, the profile rolls back too and the account is deleted', async () => {
    signInAdmin()
    enableAccountCreation()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fakePrisma.failNext('nutritionAuditLog.create', new Error('fake: audit insert failed'))

    const result = await createProfileWithAccount(IDLE, form(newPerson))

    expect(result).toMatchObject({ status: 'error', message: expect.stringContaining('removed again') })
    expect(profileByEmail('new.person@cdnep.test')).toBeUndefined()
    expect(deleteAuthUser).toHaveBeenCalledExactlyOnceWith('auth-created')
  })

  it('if someone links the same email meanwhile, the clash is reported and the new account deleted', async () => {
    signInAdmin()
    enableAccountCreation()
    vi.mocked(createAuthUser).mockImplementation(async () => {
      seedProfile('TRAINEE', { email: 'new.person@cdnep.test' })
      return { ok: true, userId: 'auth-created' }
    })

    const result = await createProfileWithAccount(IDLE, form(newPerson))

    expect(result).toEqual({
      status: 'error',
      message: 'A profile with this email already exists. The new Supabase account was removed again.',
    })
    expect(deleteAuthUser).toHaveBeenCalledExactlyOnceWith('auth-created')
  })

  it('if removing the account fails too, the message says to delete it by hand', async () => {
    signInAdmin()
    enableAccountCreation()
    vi.mocked(deleteAuthUser).mockResolvedValue(false)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fakePrisma.failNext('nutritionProfile.create', new Error('fake: connection lost'))

    const result = await createProfileWithAccount(IDLE, form(newPerson))

    expect(result).toMatchObject({
      status: 'error',
      message: expect.stringContaining('could not be removed: delete new.person@cdnep.test in the Supabase dashboard'),
    })
  })

  it('an email that already has a profile is caught before Supabase is called', async () => {
    signInAdmin()
    enableAccountCreation()
    seedProfile('TRAINEE', { email: 'new.person@cdnep.test' })
    const result = await createProfileWithAccount(IDLE, form(newPerson))
    expect(result).toMatchObject({ status: 'error', message: 'A profile with this email already exists.' })
    expect(createAuthUser).not.toHaveBeenCalled()
  })

  const TOO_LONG = 'Use at most 72 bytes: up to 72 English characters, fewer with other letters or emoji.'

  it.each([
    ['short', 'Use at least 8 characters.'],
    ['x'.repeat(73), TOO_LONG],
    // 37 characters, but 74 bytes in UTF-8 (ü is 2 bytes): a character count would let it through.
    ['ü'.repeat(37), TOO_LONG],
    // 19 emoji: 38 UTF-16 units (string length), 76 bytes.
    ['🔑'.repeat(19), TOO_LONG],
  ])('a bad password (%s) is a field error and Supabase is not called', async (password, message) => {
    signInAdmin()
    enableAccountCreation()
    const result = await createProfileWithAccount(IDLE, form({ ...newPerson, password }))
    expect(result).toMatchObject({ status: 'error', fieldErrors: { password: message } })
    expect(createAuthUser).not.toHaveBeenCalled()
  })

  it.each([
    ['72 ASCII characters', 'x'.repeat(72)],
    ['36 × ü (72 bytes)', 'ü'.repeat(36)],
    ['18 emoji (72 bytes)', '🔑'.repeat(18)],
    ['Urdu letters (2 bytes each)', 'پاسورڈ-محفوظ-2026'],
  ])('a password of at most 72 bytes is accepted: %s', async (_label, password) => {
    expect(new TextEncoder().encode(password).length).toBeLessThanOrEqual(72)
    signInAdmin()
    enableAccountCreation()
    expect(await createProfileWithAccount(IDLE, form({ ...newPerson, password }))).toMatchObject({ status: 'ok' })
    expect(createAuthUser).toHaveBeenCalledWith('new.person@cdnep.test', password)
  })

  it('a Supabase refusal (account exists) is reported and nothing is written', async () => {
    signInAdmin()
    enableAccountCreation()
    vi.mocked(createAuthUser).mockResolvedValue({ ok: false, error: 'A Supabase account already uses this email. Link it instead.' })
    const result = await createProfileWithAccount(IDLE, form(newPerson))
    expect(result).toMatchObject({ status: 'error', message: 'A Supabase account already uses this email. Link it instead.' })
    expect(fakePrisma.writes()).toEqual([])
    expect(deleteAuthUser).not.toHaveBeenCalled()
  })
})

describe('updateProfile', () => {
  const edit = (p: { id: string; fullName: string; role: string }, changes: Record<string, string> = {}) =>
    form({ profileId: p.id, fullName: p.fullName, role: p.role, institution: '', isActive: 'true', ...changes })

  it('edits name, role and institution, auditing before and after', async () => {
    signInAdmin()
    const person = seedProfile('PRECEPTOR', { fullName: 'Old Name' })

    const result = await updateProfile(IDLE, edit(person, { fullName: 'New Name', role: 'UNIT_LEAD', institution: 'Karachi Teaching Hospital' }))

    expect(result).toEqual({ status: 'ok', message: 'Saved.' })
    expect(profileById(person.id)).toMatchObject({ fullName: 'New Name', role: 'UNIT_LEAD', institution: 'Karachi Teaching Hospital' })
    expect(audit()).toEqual([
      expect.objectContaining({
        entity: 'NutritionProfile',
        entityId: person.id,
        action: 'update',
        actorId: 'auth-admin',
        before: expect.objectContaining({ fullName: 'Old Name', role: 'PRECEPTOR', institution: null }),
        after: expect.objectContaining({ fullName: 'New Name', role: 'UNIT_LEAD', institution: 'Karachi Teaching Hospital' }),
      }),
    ])
    expect(revalidatePath).toHaveBeenCalledWith(`${PEOPLE}/${person.id}`)
  })

  it('locks the profile row first, inside the transaction', async () => {
    signInAdmin()
    const person = seedProfile('PRECEPTOR')
    await updateProfile(IDLE, edit(person, { fullName: 'Changed Name' }))
    const actionCalls = fakePrisma.calls.filter((call) => !isGuardRead(call))
    expect(actionCalls[0]).toMatchObject({
      op: '$queryRaw',
      args: { sql: 'SELECT id FROM nutr_profile WHERE id = ? FOR UPDATE', values: [person.id] },
      inTransaction: true,
    })
  })

  it('deactivates instead of deleting: the row stays, isActive is false, audited as deactivate', async () => {
    signInAdmin()
    const person = seedProfile('ASSESSOR')

    const result = await updateProfile(IDLE, edit(person, { isActive: 'false' }))

    expect(result).toEqual({ status: 'ok', message: 'Deactivated.' })
    expect(profileById(person.id)).toMatchObject({ isActive: false })
    expect(audit()).toEqual([
      expect.objectContaining({ action: 'deactivate', before: expect.objectContaining({ isActive: true }), after: expect.objectContaining({ isActive: false }) }),
    ])
  })

  it('reactivates', async () => {
    signInAdmin()
    const person = seedProfile('ASSESSOR', { isActive: false })
    expect(await updateProfile(IDLE, edit(person))).toEqual({ status: 'ok', message: 'Reactivated.' })
    expect(audit()).toEqual([expect.objectContaining({ action: 'reactivate' })])
  })

  it('an admin cannot deactivate themselves or drop their own ADMIN role', async () => {
    const { profile } = signInAdmin()
    const attempts: Record<string, string>[] = [{ isActive: 'false' }, { role: 'TRAINEE' }]
    for (const changes of attempts) {
      const result = await updateProfile(IDLE, edit(profile, changes))
      expect(result).toEqual({ status: 'error', message: 'You cannot remove your own admin access.' })
    }
    expect(fakePrisma.writes()).toEqual([])
    expect(profileById(profile.id)).toMatchObject({ role: 'ADMIN', isActive: true })
  })

  it('role change or deactivation is refused while the person has an active assignment; a rename is fine', async () => {
    signInAdmin()
    const trainee = seedProfile('TRAINEE')
    const preceptor = seedProfile('PRECEPTOR')
    seedAssignment(trainee.id, preceptor.id)

    for (const [person, changes] of [
      [trainee, { isActive: 'false' }],
      [trainee, { role: 'PRECEPTOR' }],
      [preceptor, { isActive: 'false' }],
      [preceptor, { role: 'UNIT_LEAD' }],
    ] as const) {
      expect(await updateProfile(IDLE, edit(person, changes))).toEqual({
        status: 'error',
        message: "End this person's active assignments first.",
      })
    }
    expect(fakePrisma.writes()).toEqual([])
    expect(await updateProfile(IDLE, edit(trainee, { fullName: 'Renamed Trainee' }))).toEqual({ status: 'ok', message: 'Saved.' })
  })

  it('no change: nothing written, no audit row', async () => {
    signInAdmin()
    const person = seedProfile('PRECEPTOR')
    expect(await updateProfile(IDLE, edit(person))).toEqual({ status: 'ok', message: 'No changes to save.' })
    expect(fakePrisma.writes()).toEqual([])
  })

  it('an unknown profile id and a malformed one are both refused', async () => {
    signInAdmin()
    const missing = { id: '6f1c2b8e-4a3d-4f5e-9b7a-1c2d3e4f5a6b', fullName: 'Nobody Here', role: 'TRAINEE' }
    expect(await updateProfile(IDLE, edit(missing))).toEqual({ status: 'error', message: 'This profile no longer exists.' })
    expect(await updateProfile(IDLE, edit({ ...missing, id: 'not-a-uuid' }))).toMatchObject({
      status: 'error',
      fieldErrors: { profileId: 'Invalid id.' },
    })
  })
})

describe('setTrainingStartDate', () => {
  const setDate = (profileId: string, trainingStartDate: string) => setTrainingStartDate(IDLE, form({ profileId, trainingStartDate }))
  const seedForm = (fields: { subjectId: string; authorId?: string | null }) =>
    fakePrisma.seed('nutritionEvaluationForm', { createdBy: fields.authorId ?? null, ...fields })

  it('sets the date while the trainee has no evaluation forms, auditing before and after', async () => {
    signInAdmin()
    const trainee = seedProfile('TRAINEE')

    expect(await setDate(trainee.id, '2026-11-01')).toEqual({ status: 'ok', message: 'Training start date saved.' })

    expect(profileById(trainee.id)?.trainingStartDate).toEqual(new Date('2026-11-01T00:00:00Z'))
    expect(audit()).toEqual([
      expect.objectContaining({
        action: 'set_training_start_date',
        actorId: 'auth-admin',
        before: expect.objectContaining({ trainingStartDate: null }),
        after: expect.objectContaining({ trainingStartDate: '2026-11-01' }),
      }),
    ])
  })

  it.each([
    ['about the trainee', (traineeId: string, preceptorId: string) => ({ subjectId: traineeId, authorId: preceptorId })],
    ['written by the trainee', (traineeId: string, preceptorId: string) => ({ subjectId: preceptorId, authorId: traineeId })],
  ])('locked once a form %s exists: refused with a clear message, nothing written', async (_label, formFor) => {
    signInAdmin()
    const trainee = seedProfile('TRAINEE', { trainingStartDate: new Date('2026-10-01T00:00:00Z') })
    const preceptor = seedProfile('PRECEPTOR')
    seedForm(formFor(trainee.id, preceptor.id))

    expect(await setDate(trainee.id, '2026-11-01')).toEqual({
      status: 'error',
      message: 'Locked: this trainee already has evaluation forms, so the training start date can no longer change.',
      fieldErrors: { trainingStartDate: 'Locked: evaluation forms exist.' },
    })
    expect(profileById(trainee.id)?.trainingStartDate).toEqual(new Date('2026-10-01T00:00:00Z'))
    expect(fakePrisma.writes()).toEqual([])
  })

  it("another trainee's forms do not lock this trainee", async () => {
    signInAdmin()
    const trainee = seedProfile('TRAINEE')
    const other = seedProfile('TRAINEE')
    seedForm({ subjectId: other.id, authorId: other.id })
    expect(await setDate(trainee.id, '2026-11-01')).toMatchObject({ status: 'ok' })
  })

  it('only trainees have a start date', async () => {
    signInAdmin()
    const preceptor = seedProfile('PRECEPTOR')
    expect(await setDate(preceptor.id, '2026-11-01')).toEqual({ status: 'error', message: 'Only trainees have a training start date.' })
    expect(fakePrisma.writes()).toEqual([])
  })

  it.each(['2026-02-30', '01/11/2026', '2026-1-1', ''])('rejects the impossible or malformed date %j', async (date) => {
    signInAdmin()
    const trainee = seedProfile('TRAINEE')
    expect(await setDate(trainee.id, date)).toMatchObject({ status: 'error', fieldErrors: { trainingStartDate: 'Use a date like 2026-10-01.' } })
  })
})

describe('assignPreceptor and endAssignment', () => {
  const assign = (traineeId: string, preceptorId: string) => assignPreceptor(IDLE, form({ traineeId, preceptorId }))
  const end = (assignmentId: string) => endAssignment(IDLE, form({ assignmentId }))

  it('assigns, inside a transaction that first locks both people (in id order)', async () => {
    signInAdmin()
    const trainee = seedProfile('TRAINEE')
    const preceptor = seedProfile('PRECEPTOR')

    expect(await assign(trainee.id, preceptor.id)).toEqual({ status: 'ok', message: 'Preceptor assigned.' })

    expect(assignments()).toEqual([
      expect.objectContaining({ traineeId: trainee.id, preceptorId: preceptor.id, active: true, createdBy: 'auth-admin' }),
    ])
    expect(audit()).toEqual([
      expect.objectContaining({
        entity: 'NutritionPreceptorAssignment',
        entityId: assignments()[0].id,
        action: 'assign',
        actorId: 'auth-admin',
        before: null,
        after: { id: assignments()[0].id, traineeId: trainee.id, preceptorId: preceptor.id, active: true },
      }),
    ])
    const actionCalls = fakePrisma.calls.filter((call) => !isGuardRead(call))
    expect(actionCalls.slice(0, 2)).toEqual(
      [trainee.id, preceptor.id].sort().map((id) => ({
        op: '$queryRaw',
        args: { sql: 'SELECT id FROM nutr_profile WHERE id = ? FOR UPDATE', values: [id] },
        inTransaction: true,
      })),
    )
    expect(actionCalls.every((call) => call.inTransaction)).toBe(true)
  })

  it('refuses a second active primary preceptor for the same trainee', async () => {
    signInAdmin()
    const trainee = seedProfile('TRAINEE')
    const first = seedProfile('PRECEPTOR')
    const second = seedProfile('PRECEPTOR')
    expect(await assign(trainee.id, first.id)).toMatchObject({ status: 'ok' })

    expect(await assign(trainee.id, second.id)).toEqual({
      status: 'error',
      message: 'This trainee already has an active primary preceptor. End that assignment first.',
      fieldErrors: { preceptorId: 'Already has an active primary preceptor.' },
    })
    expect(assignments().filter((a) => a.traineeId === trainee.id && a.active)).toHaveLength(1)
    expect(audit().filter((row) => row.action === 'assign')).toHaveLength(1)
  })

  it('ending sets active = false and keeps the row; then a new preceptor can be assigned', async () => {
    signInAdmin()
    const trainee = seedProfile('TRAINEE')
    const first = seedProfile('PRECEPTOR')
    const second = seedProfile('PRECEPTOR')
    await assign(trainee.id, first.id)
    const firstId = assignments()[0].id as string

    expect(await end(firstId)).toEqual({ status: 'ok', message: 'Assignment ended.' })
    expect(assignments()).toEqual([expect.objectContaining({ id: firstId, active: false })])
    expect(audit().at(-1)).toMatchObject({
      action: 'end',
      entityId: firstId,
      before: expect.objectContaining({ active: true }),
      after: expect.objectContaining({ active: false }),
    })
    expect(revalidatePath).toHaveBeenCalledWith(`${PEOPLE}/${trainee.id}`)
    expect(revalidatePath).toHaveBeenCalledWith(`${PEOPLE}/${first.id}`)

    expect(await assign(trainee.id, second.id)).toMatchObject({ status: 'ok' })
    expect(assignments().map((a) => [a.preceptorId, a.active])).toEqual([
      [first.id, false],
      [second.id, true],
    ])
  })

  it('ending an assignment twice: the second is refused and not audited', async () => {
    signInAdmin()
    const id = seedAssignment(seedProfile('TRAINEE').id, seedProfile('PRECEPTOR').id).id
    await end(id)
    expect(await end(id)).toEqual({ status: 'error', message: 'This assignment has already ended.' })
    expect(audit().filter((row) => row.action === 'end')).toHaveLength(1)
  })

  it('one preceptor may supervise several trainees (the limit is per trainee)', async () => {
    signInAdmin()
    const preceptor = seedProfile('PRECEPTOR')
    expect(await assign(seedProfile('TRAINEE').id, preceptor.id)).toMatchObject({ status: 'ok' })
    expect(await assign(seedProfile('TRAINEE').id, preceptor.id)).toMatchObject({ status: 'ok' })
  })

  it('refuses anyone who is not an active trainee / active preceptor', async () => {
    signInAdmin()
    const trainee = seedProfile('TRAINEE')
    const preceptor = seedProfile('PRECEPTOR')
    const pickTrainee = { status: 'error', message: 'Pick an active trainee.', fieldErrors: { traineeId: 'Not an active trainee.' } }
    const pickPreceptor = { status: 'error', message: 'Pick an active preceptor.', fieldErrors: { preceptorId: 'Not an active preceptor.' } }

    expect(await assign(seedProfile('PRECEPTOR').id, preceptor.id)).toEqual(pickTrainee)
    expect(await assign(seedProfile('TRAINEE', { isActive: false }).id, preceptor.id)).toEqual(pickTrainee)
    expect(await assign('6f1c2b8e-4a3d-4f5e-9b7a-1c2d3e4f5a6b', preceptor.id)).toEqual(pickTrainee)
    expect(await assign(trainee.id, seedProfile('TRAINEE').id)).toEqual(pickPreceptor)
    expect(await assign(trainee.id, seedProfile('UNIT_LEAD').id)).toEqual(pickPreceptor)
    expect(await assign(trainee.id, seedProfile('PRECEPTOR', { isActive: false }).id)).toEqual(pickPreceptor)
    expect(fakePrisma.writes()).toEqual([])
  })

  it('a trainee cannot be their own preceptor (validation)', async () => {
    signInAdmin()
    const trainee = seedProfile('TRAINEE')
    expect(await assign(trainee.id, trainee.id)).toMatchObject({
      status: 'error',
      fieldErrors: { preceptorId: 'A trainee cannot be their own preceptor.' },
    })
  })
})

describe('only ADMIN may call these actions', () => {
  // Each action gets input that WOULD succeed, so a missing guard shows up as a write.
  function validCalls(): { name: string; run: () => Promise<unknown> }[] {
    const editable = seedProfile('ASSESSOR')
    const trainee = seedProfile('TRAINEE')
    const unassigned = seedProfile('TRAINEE')
    const preceptor = seedProfile('PRECEPTOR')
    const toEnd = seedAssignment(seedProfile('TRAINEE').id, seedProfile('PRECEPTOR').id)
    fakePrisma.authUsers.push({ id: 'auth-target', email: 'target@cdnep.test', confirmed: true })
    vi.mocked(canCreateAccounts).mockReturnValue(true)
    vi.mocked(createAuthUser).mockResolvedValue({ ok: true, userId: 'auth-target-new' })
    const person = { fullName: 'Target Person', role: 'TRAINEE' }
    return [
      { name: 'linkProfile', run: () => linkProfile(IDLE, form({ email: 'target@cdnep.test', ...person })) },
      {
        name: 'createProfileWithAccount',
        run: () => createProfileWithAccount(IDLE, form({ email: 'target.new@cdnep.test', password: 'Initial-pass-2026', ...person })),
      },
      {
        name: 'updateProfile',
        run: () => updateProfile(IDLE, form({ profileId: editable.id, fullName: 'Made Admin', role: 'ADMIN', isActive: 'true' })),
      },
      { name: 'setTrainingStartDate', run: () => setTrainingStartDate(IDLE, form({ profileId: trainee.id, trainingStartDate: '2026-12-01' })) },
      { name: 'assignPreceptor', run: () => assignPreceptor(IDLE, form({ traineeId: unassigned.id, preceptorId: preceptor.id })) },
      { name: 'endAssignment', run: () => endAssignment(IDLE, form({ assignmentId: toEnd.id })) },
    ]
  }

  it.each(NON_ADMIN_CALLERS)('$label: every action is refused (/nutrition/no-access) before it reads or writes anything', async (caller) => {
    const calls = validCalls()
    caller.signIn()
    for (const call of calls) {
      expect(await refusal(call.run()), call.name).toBe('/nutrition/no-access')
    }
    expect(fakePrisma.calls.filter((call) => !isGuardRead(call))).toEqual([])
    expect(createAuthUser).not.toHaveBeenCalled()
    expect(deleteAuthUser).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('not signed in: every action is refused (/nutrition/login)', async () => {
    for (const call of validCalls()) {
      expect(await refusal(call.run()), call.name).toBe('/nutrition/login')
    }
    expect(fakePrisma.writes()).toEqual([])
  })

  it('a signed-in ADMIN gets through every one of them', async () => {
    signInAdmin()
    for (const call of validCalls()) {
      expect(await call.run(), call.name).toMatchObject({ status: 'ok' })
    }
  })
})

describe('a super_admin acts as ADMIN without a NutritionProfile', () => {
  it('createdBy and audit actorId are the super_admin auth user id', async () => {
    const boss = signInSuperAdmin()
    expect(fakePrisma.tables.nutritionProfile.some((p) => p.authUserId === boss.authUserId)).toBe(false)
    fakePrisma.authUsers.push({ id: 'auth-new', email: 'new@cdnep.test', confirmed: true })
    const preceptor = seedProfile('PRECEPTOR')

    expect(await linkProfile(IDLE, form({ email: 'new@cdnep.test', fullName: 'New Trainee', role: 'TRAINEE' }))).toMatchObject({ status: 'ok' })
    const trainee = profileByEmail('new@cdnep.test')
    expect(trainee?.createdBy).toBe('auth-boss')

    expect(await assignPreceptor(IDLE, form({ traineeId: trainee?.id as string, preceptorId: preceptor.id }))).toMatchObject({ status: 'ok' })
    expect(assignments()[0].createdBy).toBe('auth-boss')

    expect(audit().map((row) => [row.action, row.actorId])).toEqual([
      ['link_account', 'auth-boss'],
      ['assign', 'auth-boss'],
    ])
  })

  it('a super_admin can edit an ADMIN profile (the self-lockout rule needs their own profile)', async () => {
    signInSuperAdmin()
    const otherAdmin = seedProfile('ADMIN')
    const result = await updateProfile(IDLE, form({ profileId: otherAdmin.id, fullName: otherAdmin.fullName, role: 'ADMIN', isActive: 'false' }))
    expect(result).toEqual({ status: 'ok', message: 'Deactivated.' })
    expect(audit()[0]).toMatchObject({ actorId: 'auth-boss' })
  })
})

it('the session token never reaches the database or the audit log', async () => {
  const { token } = signInAdmin()
  fakePrisma.authUsers.push({ id: 'auth-new', email: 'new@cdnep.test', confirmed: true })
  expect(await linkProfile(IDLE, form({ email: 'new@cdnep.test', fullName: 'New Trainee', role: 'TRAINEE' }))).toMatchObject({ status: 'ok' })
  expect(JSON.stringify(fakePrisma.tables)).not.toContain(token)
  expect(JSON.stringify(fakePrisma.calls)).not.toContain(token)
})
