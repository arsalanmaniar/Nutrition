import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('../../auth/__tests__/fakes')).headersModule)
vi.mock('next/navigation', async () => (await import('../../auth/__tests__/fakes')).navigationModule)
vi.mock('@supabase/supabase-js', async () => (await import('../../auth/__tests__/fakes')).supabaseModule)
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./fake-prisma')).fakePrisma }))

import { resetState } from '../../auth/__tests__/fakes'
import { getPersonDetail } from '../queries/people'
import { seedProfile, signInAdmin, type SeededProfile } from './actors'
import { KEY, seedForm, seedFormOneThree } from './evaluation-fixtures'
import { fakePrisma } from './fake-prisma'

// The admin person page's startDateLocked flag follows the same rule as
// setTrainingStartDate (start-date-lock.ts): a form about or by the trainee,
// or a Form 1.3 they wrote (found by hash). The fake cannot run the page's
// nested relation select, so findUnique returns the profile as Prisma would.

function serve(person: SeededProfile & { trainingStartDate?: Date | null }) {
  vi.spyOn(fakePrisma.nutritionProfile, 'findUnique').mockResolvedValue({
    ...person,
    institution: null,
    trainingStartDate: person.trainingStartDate ?? new Date('2026-01-01T00:00:00Z'),
    assignmentsAsTrainee: [],
    assignmentsAsPreceptor: [],
  } as never)
}

beforeEach(() => {
  resetState()
  fakePrisma.reset()
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
  vi.stubEnv('NUTRITION_AUTHOR_HASH_KEY', KEY)
  signInAdmin()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('getPersonDetail: startDateLocked', () => {
  // [what exists, locked, unchecked]
  it.each([
    ['no forms', () => {}, false],
    ['a form about the trainee', (t: string, p: string) => void seedForm('FORM_3_1', t, p, 'M01'), true],
    ['a form the trainee wrote', (t: string) => void seedForm('WEEKLY', t, t, 'W01', { status: 'DRAFT' }), true],
    ['only a Form 1.3 the trainee wrote', (t: string, p: string) => void seedFormOneThree(t, p, 'M04'), true],
    ["another trainee's Form 1.3", (_t: string, p: string, o: string) => void seedFormOneThree(o, p, 'M04'), false],
  ])('%s -> locked %s', async (_label, setup: (trainee: string, preceptor: string, other: string) => void, locked) => {
    const trainee = seedProfile('TRAINEE')
    const preceptor = seedProfile('PRECEPTOR')
    const other = seedProfile('TRAINEE')
    setup(trainee.id, preceptor.id, other.id)
    serve(trainee)
    expect(await getPersonDetail(trainee.id)).toMatchObject({ startDateLocked: locked, startDateUnchecked: false })
  })

  it('fails closed when Form 1.3 rows exist but the key is missing: shown as locked, and marked unchecked', async () => {
    const trainee = seedProfile('TRAINEE')
    const preceptor = seedProfile('PRECEPTOR')
    seedFormOneThree(seedProfile('TRAINEE').id, preceptor.id, 'M04')
    vi.stubEnv('NUTRITION_AUTHOR_HASH_KEY', undefined)
    serve(trainee)
    expect(await getPersonDetail(trainee.id)).toMatchObject({ startDateLocked: true, startDateUnchecked: true })
  })

  it('a preceptor has no start date to lock', async () => {
    const preceptor = seedProfile('PRECEPTOR')
    seedForm('FORM_3_1', seedProfile('TRAINEE').id, preceptor.id, 'M01')
    serve(preceptor)
    expect(await getPersonDetail(preceptor.id)).toMatchObject({ startDateLocked: false, startDateUnchecked: false })
  })
})
