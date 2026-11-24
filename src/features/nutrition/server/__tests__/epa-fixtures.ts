// Shared setup for the Step 6a tests: EPA entrustment and the Month 9
// standards checklist (not itself a test file).

import type { EpaLevel, MillerLevel, StandardRating, SubmissionStatus } from '@prisma/client'
import { STANDARD_KEYS } from '../epa-core'
import { fakePrisma } from './fake-prisma'

type Row = Record<string, unknown>

export const TRAINEE_NOT_FOUND = { status: 'error', message: 'This trainee was not found among your trainees.' }
export const CHECKLIST_NOT_FOUND = { status: 'error', message: 'This checklist was not found. Start it first.' }
export const CHECKLIST_EXISTS = { status: 'error', message: 'This checklist already exists. Reload the page to continue it.' }
export const CHECKLIST_SUBMITTED = { status: 'error', message: 'This checklist has already been submitted and can no longer be changed.' }
export const EVIDENCE_NOT_FOUND = "This case log or WPBA was not found among the trainee's records."

/** Training started so that today (15 April 2026, see evaluation-fixtures NOW) is in training month 9. */
export const MONTH_9_START = '2025-08-01'
/** Today is in training month 8: the checklist opens on 2026-05-01. */
export const MONTH_8_START = '2025-09-01'

export const epaRows = () => fakePrisma.tables.nutritionEpaAssessment as Row[]
export const checklists = () => fakePrisma.tables.nutritionStandardsChecklist as Row[]

export function epaForm(traineeId: string, extra: Record<string, string> = {}): Record<string, string> {
  return { traineeId, epaKey: 'EPA_01', level: 'E2', millerLevel: 'SHOWS_HOW', ...extra }
}

export function seedEpa(
  traineeId: string,
  assessorId: string,
  fields: Partial<{ epaName: string; level: EpaLevel; millerLevel: MillerLevel; assessedOn: string; notes: string | null; createdAt: Date }> = {},
): Row {
  return fakePrisma.seed('nutritionEpaAssessment', {
    traineeId,
    assessorId,
    epaName: fields.epaName ?? 'EPA_01',
    level: fields.level ?? 'E2',
    millerLevel: fields.millerLevel ?? 'SHOWS_HOW',
    assessedOn: new Date(`${fields.assessedOn ?? '2026-04-01'}T00:00:00Z`),
    notes: fields.notes ?? null,
    createdBy: 'auth-seed',
    ...(fields.createdAt ? { createdAt: fields.createdAt } : {}),
  })
}

export function seedChecklist(traineeId: string, status: SubmissionStatus = 'DRAFT', items: Row = {}): Row {
  return fakePrisma.seed('nutritionStandardsChecklist', {
    traineeId,
    monthNumber: 9,
    formVersion: 1,
    items,
    status,
    submittedAt: status === 'DRAFT' ? null : new Date('2026-04-10T08:00:00Z'),
    createdBy: 'auth-seed',
  })
}

/** Checklist form fields: every standard rated `rating`, each with `evidence` (e.g. "WPBA:<id>"). */
export function checklistFields(traineeId: string, evidence: string, rating: StandardRating = 'MEETS'): Record<string, string> {
  const fields: Record<string, string> = { traineeId }
  for (const key of STANDARD_KEYS) {
    fields[`rating.${key}`] = rating
    fields[`evidence.${key}`] = evidence
  }
  return fields
}
