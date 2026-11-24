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

import type { Prisma } from '@prisma/client'
import { resetState } from '../../auth/__tests__/fakes'
import { setTrainingStartDate } from '../actions/people'
import { authorHash } from '../author-hash'
import { lockTraineeRow } from '../lock-trainee-row'
import { trainingStartDateLocked } from '../start-date-lock'
import { IDLE, form, seedProfile, signInAdmin } from './actors'
import { fakePrisma } from './fake-prisma'

// The 3d start-date lock (plan, Decisions (Step 3d outcome) items 1, 2 and 6),
// extended for Form 1.3: those rows have no authorId, only authorHash, so the
// lock recomputes the trainee's own hashes. people-actions.test.ts keeps the
// subject/author rule's tests.

const KEY = 'cdn-ep-test-key-0123456789abcdef'
const ORIGINAL = new Date('2026-10-01T00:00:00Z')
const LOCKED = {
  status: 'error',
  message: 'Locked: this trainee already has evaluation forms, so the training start date can no longer change.',
  fieldErrors: { trainingStartDate: 'Locked: evaluation forms exist.' },
}
const UNCHECKED = {
  status: 'error',
  message: 'Form 1.3 records cannot be checked right now, so the training start date was not changed.',
}
const LOCK_SQL = 'SELECT id FROM nutr_profile WHERE id = ? FOR UPDATE'

const setDate = (profileId: string) => setTrainingStartDate(IDLE, form({ profileId, trainingStartDate: '2026-11-01' }))
const startDateOf = (id: string) => fakePrisma.tables.nutritionProfile.find((p) => p.id === id)?.trainingStartDate

/** A Form 1.3 as Step 4b stores it: about the preceptor, no author, only the author's hash. */
function seedFormOneThree(authorId: string, preceptorId: string, point: 'M04' | 'M08' | 'M12' = 'M04') {
  return fakePrisma.seed('nutritionEvaluationForm', {
    formType: 'FORM_1_3',
    subjectId: preceptorId,
    authorId: null,
    authorHash: authorHash(authorId, preceptorId, point),
    monthNumber: Number(point.slice(1)),
    assessmentPoint: point,
    createdBy: null,
  })
}

function people() {
  signInAdmin()
  return {
    trainee: seedProfile('TRAINEE', { trainingStartDate: ORIGINAL }),
    other: seedProfile('TRAINEE', { trainingStartDate: ORIGINAL }),
    preceptor: seedProfile('PRECEPTOR'),
  }
}

beforeEach(() => {
  resetState()
  fakePrisma.reset()
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
  vi.stubEnv('NUTRITION_AUTHOR_HASH_KEY', KEY)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('setTrainingStartDate: a Form 1.3 the trainee wrote locks the start date', () => {
  it.each(['M04', 'M08', 'M12'] as const)('locked by their Form 1.3 at %s: refused, nothing written', async (point) => {
    const { trainee, preceptor } = people()
    seedFormOneThree(trainee.id, preceptor.id, point)

    expect(await setDate(trainee.id)).toEqual(LOCKED)
    expect(startDateOf(trainee.id)).toEqual(ORIGINAL)
    expect(fakePrisma.writes()).toEqual([])
  })

  it("another trainee's Form 1.3 about the same preceptor does not lock this trainee", async () => {
    const { trainee, other, preceptor } = people()
    seedFormOneThree(other.id, preceptor.id)

    expect(await setDate(trainee.id)).toEqual({ status: 'ok', message: 'Training start date saved.' })
    expect(startDateOf(trainee.id)).toEqual(new Date('2026-11-01T00:00:00Z'))
    expect(await setDate(other.id)).toEqual(LOCKED)
  })

  it('every preceptor that any Form 1.3 is about is checked', async () => {
    const { trainee, other, preceptor } = people()
    const second = seedProfile('PRECEPTOR')
    seedFormOneThree(other.id, preceptor.id)
    seedFormOneThree(trainee.id, second.id, 'M08')

    expect(await setDate(trainee.id)).toEqual(LOCKED)
  })

  it.each([
    ['missing', undefined],
    ['shorter than 32 characters', 'too-short-key'],
  ])('fails closed when Form 1.3 rows exist and the key is %s: refused, nothing written', async (_label, key) => {
    const { trainee, other, preceptor } = people()
    seedFormOneThree(other.id, preceptor.id)
    vi.stubEnv('NUTRITION_AUTHOR_HASH_KEY', key)

    expect(await setDate(trainee.id)).toEqual(UNCHECKED)
    expect(startDateOf(trainee.id)).toEqual(ORIGINAL)
    expect(fakePrisma.writes()).toEqual([])
  })

  it('needs no key while no Form 1.3 exists, and the subject/author rule needs none either', async () => {
    const { trainee, other, preceptor } = people()
    vi.stubEnv('NUTRITION_AUTHOR_HASH_KEY', undefined)
    expect(await setDate(trainee.id)).toMatchObject({ status: 'ok' })

    fakePrisma.seed('nutritionEvaluationForm', { subjectId: other.id, authorId: preceptor.id, createdBy: preceptor.id })
    expect(await setDate(other.id)).toEqual(LOCKED)
  })

  it("locks the trainee's row first, inside the transaction, before reading any form", async () => {
    const { trainee } = people()
    expect(await setDate(trainee.id)).toMatchObject({ status: 'ok' })

    const inTransaction = fakePrisma.calls.filter((call) => call.inTransaction)
    expect(inTransaction[0]).toEqual({ op: '$queryRaw', args: { sql: LOCK_SQL, values: [trainee.id] }, inTransaction: true })
    const formReads = fakePrisma.calls.filter((call) => call.op.startsWith('nutritionEvaluationForm.'))
    expect(formReads.length).toBeGreaterThan(0)
    expect(formReads.every((call) => call.inTransaction)).toBe(true)
  })

  it('a Form 1.3 created under lockTraineeRow while the change waits for the row is seen: refused', async () => {
    const { trainee, preceptor } = people()
    const lockCalls = () =>
      fakePrisma.calls.filter((call) => call.op === '$queryRaw' && (call.args as { values: unknown[] }).values[0] === trainee.id).length

    let insert = () => {}
    const mayInsert = new Promise<void>((resolve) => (insert = resolve))
    // Step 4b's shape: lock the trainee's row, then create the form, in one transaction.
    const creating = fakePrisma.$transaction(async (raw) => {
      const tx = raw as unknown as Prisma.TransactionClient
      await lockTraineeRow(tx, trainee.id)
      await mayInsert
      await tx.nutritionEvaluationForm.create({
        data: {
          formType: 'FORM_1_3',
          formVersion: 1,
          subjectId: preceptor.id,
          authorHash: authorHash(trainee.id, preceptor.id, 'M04'),
          monthNumber: 4,
          assessmentPoint: 'M04',
          answers: {},
        },
      })
    })
    await vi.waitFor(() => expect(lockCalls()).toBe(1))
    const changing = setDate(trainee.id)
    await vi.waitFor(() => expect(lockCalls()).toBe(2))

    insert()
    await creating
    expect(await changing).toEqual(LOCKED)
    expect(startDateOf(trainee.id)).toEqual(ORIGINAL)
  })
})

describe('trainingStartDateLocked', () => {
  // [what exists, locked?]
  it.each([
    ['no forms at all', () => {}, false],
    ['a form about the trainee', (t: string, p: string) => void fakePrisma.seed('nutritionEvaluationForm', { subjectId: t, authorId: p }), true],
    ['a form the trainee wrote', (t: string, p: string) => void fakePrisma.seed('nutritionEvaluationForm', { subjectId: p, authorId: t }), true],
    ['their own Form 1.3', (t: string, p: string) => void seedFormOneThree(t, p, 'M12'), true],
    ["another trainee's Form 1.3", (_t: string, p: string, o: string) => void seedFormOneThree(o, p), false],
  ])('%s -> %s', async (_label, setup: (trainee: string, preceptor: string, other: string) => void, expected) => {
    const { trainee, other, preceptor } = people()
    setup(trainee.id, preceptor.id, other.id)
    const locked = await fakePrisma.$transaction(async (raw) => {
      const tx = raw as unknown as Prisma.TransactionClient
      await lockTraineeRow(tx, trainee.id)
      return trainingStartDateLocked(tx, trainee.id)
    })
    expect(locked).toBe(expected)
  })
})

describe('lockTraineeRow', () => {
  it("runs the shared row lock on the trainee's nutr_profile row and says whether the row exists", async () => {
    const { trainee } = people()
    const found = await fakePrisma.$transaction(async (raw) => {
      const tx = raw as unknown as Prisma.TransactionClient
      return [await lockTraineeRow(tx, trainee.id), await lockTraineeRow(tx, '6f1c2b8e-4a3d-4f5e-9b7a-1c2d3e4f5a6b')]
    })
    expect(found).toEqual([true, false])
    expect(fakePrisma.calls.filter((call) => call.op === '$queryRaw').map((call) => call.args)).toEqual([
      { sql: LOCK_SQL, values: [trainee.id] },
      { sql: LOCK_SQL, values: ['6f1c2b8e-4a3d-4f5e-9b7a-1c2d3e4f5a6b'] },
    ])
  })
})
