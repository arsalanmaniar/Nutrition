// Shared setup for the Step 7 tests (not itself a test file).

import type { EpaLevel, EvaluationFormType } from '@prisma/client'
import { EPA_LIST } from '../../config/epas'
import { seedEpa } from './epa-fixtures'
import { fakePrisma } from './fake-prisma'

type Row = Record<string, unknown>

/** Today (15 April 2026) is in training month 12. */
export const MONTH_12_START = '2025-04-20'
/** Today is in training month 11. */
export const MONTH_11_START = '2025-06-01'

export const credentials = () => fakePrisma.tables.nutritionCredential as Row[]

/** Every configured EPA at `level` (newest entry), assessed on 1 April 2026. */
export function seedAllEpas(traineeId: string, assessorId: string, level: EpaLevel = 'E4'): void {
  for (const epa of EPA_LIST) seedEpa(traineeId, assessorId, { epaName: epa.key, level, millerLevel: 'DOES', assessedOn: '2026-04-01' })
}

/** A SUBMITTED evaluation form with a score. */
export function seedScoredForm(formType: EvaluationFormType, subjectId: string, total: number, maxScore: number, point = 'M03', status: 'SUBMITTED' | 'DRAFT' = 'SUBMITTED'): Row {
  return fakePrisma.seed('nutritionEvaluationForm', {
    formType,
    formVersion: 1,
    subjectId,
    authorId: formType === 'FORM_1_3' ? null : subjectId,
    authorHash: formType === 'FORM_1_3' ? `hash-${Math.random()}` : null,
    monthNumber: Number(point.slice(1)),
    assessmentPoint: point,
    answers: { ratings: {}, text: {} },
    totalScore: total,
    maxScore,
    status,
    submittedAt: status === 'SUBMITTED' ? new Date('2026-04-01T08:00:00Z') : null,
    createdBy: 'auth-seed',
  })
}

export function seedCredential(traineeId: string, fields: Partial<{ verificationId: string; revoked: boolean }> = {}): Row {
  return fakePrisma.seed('nutritionCredential', {
    traineeId,
    type: 'COMPLETION',
    verificationId: fields.verificationId ?? 'V'.repeat(43),
    issuedAt: new Date('2026-04-10T05:00:00Z'),
    revokedAt: fields.revoked ? new Date('2026-04-12T05:00:00Z') : null,
    createdBy: 'auth-seed',
  })
}
