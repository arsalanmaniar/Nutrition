import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('../../auth/__tests__/fakes')).headersModule)
vi.mock('next/navigation', async () => (await import('../../auth/__tests__/fakes')).navigationModule)
vi.mock('@supabase/supabase-js', async () => (await import('../../auth/__tests__/fakes')).supabaseModule)
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./fake-prisma')).fakePrisma }))

import { resetState } from '../../auth/__tests__/fakes'
import { EPA_LIST } from '../../config/epas'
import { VERIFICATION_ID_PATTERN } from '../../config/portfolio'
import { issueCompletionCredential } from '../actions/credentials'
import { getCredentialVerification } from '../public/verify'
import { IDLE, NON_PRECEPTOR_CALLERS, form, seedAssignment, seedProfile } from './actors'
import { seedEpa } from './epa-fixtures'
import { NOW, audit, pair, refusal, signInAs } from './evaluation-fixtures'
import { fakePrisma } from './fake-prisma'
import { MONTH_11_START, MONTH_12_START, credentials, seedAllEpas, seedCredential } from './portfolio-fixtures'
import { seedPlacement } from './wpba-fixtures'

// Issuing the certificate of completion (Step 7): the ACTIVE primary
// preceptor confirms; training month 12; every EPA's newest level at E4–E5;
// one valid credential per trainee; a random 32-byte verification id; no
// PDF stored; no verification id in the audit log.

const LOCK_SQL = 'SELECT id FROM nutr_profile WHERE id = ? FOR UPDATE'
const issue = (traineeId: string, confirm: string | null = 'on') =>
  issueCompletionCredential(IDLE, form(confirm === null ? { traineeId } : { traineeId, confirm }))

beforeEach(() => {
  resetState()
  fakePrisma.reset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
})

afterEach(() => {
  expect(fakePrisma.calls.filter((call) => /^nutritionCredential\.(update|delete)/.test(call.op) || /^nutritionAuditLog\.(update|delete)/.test(call.op))).toEqual([])
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('issuing when every rule is met', () => {
  it('creates one COMPLETION credential with a random 32-byte id and no PDF, under the trainee row lock; the id is not audited', async () => {
    const { trainee, preceptor } = pair(MONTH_12_START)
    seedAllEpas(trainee.id, preceptor.id, 'E4')
    signInAs(preceptor)
    expect(await issue(trainee.id)).toEqual({ status: 'ok', message: 'Certificate of completion issued.' })
    const [row] = credentials()
    expect(row).toMatchObject({ traineeId: trainee.id, type: 'COMPLETION', issuedAt: NOW, pdfPath: null, revokedAt: null, createdBy: preceptor.authUserId })
    expect(row.verificationId).toMatch(VERIFICATION_ID_PATTERN)
    expect(Buffer.from(row.verificationId as string, 'base64url')).toHaveLength(32)
    expect(fakePrisma.calls.filter((call) => call.inTransaction)[0]).toEqual({ op: '$queryRaw', args: { sql: LOCK_SQL, values: [trainee.id] }, inTransaction: true })
    expect(audit()[0]).toMatchObject({ entity: 'NutritionCredential', action: 'create', actorId: preceptor.authUserId })
    expect(JSON.stringify(audit())).not.toContain(row.verificationId as string)
    // The public check finds it.
    expect(await getCredentialVerification(row.verificationId as string)).toMatchObject({ status: 'VALID', name: 'Ayesha Trainee' })
  })
})

describe('refusals', () => {
  it('without the confirmation box', async () => {
    const { trainee, preceptor } = pair(MONTH_12_START)
    seedAllEpas(trainee.id, preceptor.id, 'E5')
    signInAs(preceptor)
    expect(await issue(trainee.id, null)).toEqual({
      status: 'error',
      message: 'Tick the box to confirm the summative sign-off.',
      fieldErrors: { confirm: 'Confirm the sign-off to issue the certificate.' },
    })
    expect(credentials()).toEqual([])
  })

  it('before training month 12', async () => {
    const { trainee, preceptor } = pair(MONTH_11_START)
    seedAllEpas(trainee.id, preceptor.id, 'E5')
    signInAs(preceptor)
    expect(await issue(trainee.id)).toEqual({ status: 'error', message: 'The certificate can be issued from training month 12.' })
    expect(credentials()).toEqual([])
  })

  it('one EPA at E3, or a newer E3 after an E4, or one EPA with no level', async () => {
    const cases: ((traineeId: string, preceptorId: string) => void)[] = [
      (t, p) => {
        seedAllEpas(t, p, 'E4')
        seedEpa(t, p, { epaName: EPA_LIST[1].key, level: 'E3', millerLevel: 'DOES', assessedOn: '2026-04-10' })
      },
      (t, p) => {
        for (const epa of EPA_LIST.slice(1)) seedEpa(t, p, { epaName: epa.key, level: 'E5', millerLevel: 'DOES', assessedOn: '2026-04-01' })
      },
    ]
    for (const setUp of cases) {
      fakePrisma.reset()
      resetState()
      const { trainee, preceptor } = pair(MONTH_12_START)
      setUp(trainee.id, preceptor.id)
      signInAs(preceptor)
      const result = await issue(trainee.id)
      expect(result.status).toBe('error')
      expect((result as { message: string }).message).toMatch(/^The summative target is not met: every EPA needs E4 or E5\./)
      expect(credentials()).toEqual([])
    }
  })

  it('a second credential while one is valid; a revoked one does not block a new one', async () => {
    const { trainee, preceptor } = pair(MONTH_12_START)
    seedAllEpas(trainee.id, preceptor.id, 'E4')
    seedCredential(trainee.id)
    signInAs(preceptor)
    expect(await issue(trainee.id)).toEqual({ status: 'error', message: 'This trainee already has a valid certificate of completion.' })
    fakePrisma.reset()
    resetState()
    const again = pair(MONTH_12_START)
    seedAllEpas(again.trainee.id, again.preceptor.id, 'E4')
    seedCredential(again.trainee.id, { revoked: true })
    signInAs(again.preceptor)
    expect((await issue(again.trainee.id)).status).toBe('ok')
    expect(credentials()).toHaveLength(2)
  })

  it('another, a former and a rotation preceptor get "not found"', async () => {
    const { trainee, preceptor } = pair(MONTH_12_START)
    seedAllEpas(trainee.id, preceptor.id, 'E5')
    const stranger = seedProfile('PRECEPTOR')
    const former = seedProfile('PRECEPTOR')
    seedAssignment(trainee.id, former.id, false)
    const rotation = seedProfile('PRECEPTOR')
    seedPlacement(trainee.id, rotation.id, '2026-04-01')
    for (const caller of [stranger, former, rotation]) {
      signInAs(caller)
      expect(await issue(trainee.id)).toEqual({ status: 'error', message: 'This trainee was not found among your trainees.' })
    }
    expect(credentials()).toEqual([])
  })

  it.each(NON_PRECEPTOR_CALLERS)('$label is refused by the guard (trainee and admin included)', async ({ signIn }) => {
    const { trainee } = pair(MONTH_12_START)
    signIn()
    expect(await refusal(issue(trainee.id))).toMatch(/^\/nutrition\//)
    expect(credentials()).toEqual([])
  })
})
