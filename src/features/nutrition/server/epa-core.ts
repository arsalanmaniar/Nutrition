import 'server-only'
import type { EpaLevel, MillerLevel, StandardRating, SubmissionStatus } from '@prisma/client'
import { EPA_LEVEL_LABELS, MILLER_EPA_TARGETS, MILLER_LEVEL_LABELS, STANDARDS_CHECKLIST } from '@/features/nutrition/config/forms'
import type { Snapshot } from './audit'

// Rules shared by the EPA entrustment and Month 9 standards checklist actions
// and loaders (Step 6a). Nothing here checks roles: every caller has already
// run requireNutritionRole.

const EPA_ORDER: readonly EpaLevel[] = ['E1', 'E2', 'E3', 'E4', 'E5']

/**
 * Whether an entrustment level fits the Miller level it was assessed at:
 * inside MILLER_EPA_TARGETS[miller], both ends included. Null means it fits;
 * otherwise the refusal, saying the allowed range.
 */
export function epaRangeProblem(level: EpaLevel, millerLevel: MillerLevel): string | null {
  const range = MILLER_EPA_TARGETS[millerLevel]
  const at = EPA_ORDER.indexOf(level)
  if (at >= EPA_ORDER.indexOf(range.min) && at <= EPA_ORDER.indexOf(range.max)) return null
  const allowed = range.min === range.max ? range.min : `${range.min} to ${range.max}`
  return `${level} (${EPA_LEVEL_LABELS[level]}) is outside the range for ${MILLER_LEVEL_LABELS[millerLevel]}: use ${allowed}.`
}

/** The audit snapshot of an EPA assessment: ids, the EPA key, levels and the day. Never the notes. */
export function epaAuditSnapshot(row: {
  id: string
  traineeId: string
  assessorId: string
  epaName: string
  level: EpaLevel
  millerLevel: MillerLevel
  assessedOn: Date
}): Snapshot {
  return {
    id: row.id,
    traineeId: row.traineeId,
    assessorId: row.assessorId,
    epaName: row.epaName,
    level: row.level,
    millerLevel: row.millerLevel,
    assessedOn: row.assessedOn.toISOString().slice(0, 10),
  }
}

// ── Month 9 standards checklist ──────────────────────────────────────────────

export type EvidenceKind = 'CASE_LOG' | 'WPBA'

export interface EvidenceRef {
  kind: EvidenceKind
  id: string
}

/** One standard as stored in NutritionStandardsChecklist.items. A draft may lack either part. */
export interface StandardEntry {
  rating: StandardRating | null
  evidence: EvidenceRef | null
}

export type ChecklistItems = Record<string, StandardEntry>

const RATINGS: readonly StandardRating[] = ['DEVELOPING', 'MEETS', 'EXCEEDS']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Every standard's key, SOP first, in config order. */
export const STANDARD_KEYS: readonly string[] = STANDARDS_CHECKLIST.groups.flatMap((group) => group.standards.map((s) => s.key))

export const ratingField = (key: string) => `rating.${key}`
export const evidenceField = (key: string) => `evidence.${key}`

/** "CASE_LOG:<uuid>" or "WPBA:<uuid>", as the form posts it; null if malformed. */
export function parseEvidence(value: string): EvidenceRef | null {
  const [kind, id, ...rest] = value.split(':')
  if (rest.length > 0 || (kind !== 'CASE_LOG' && kind !== 'WPBA') || !UUID.test(id ?? '')) return null
  return { kind, id: id.toLowerCase() }
}

export const evidenceValue = (ref: EvidenceRef) => `${ref.kind}:${ref.id}`

/**
 * The checklist entries in a submitted form: only the configured standards'
 * rating.<key> and evidence.<key> fields are read. A blank field leaves that
 * part empty; with `requireAll` (submit) every standard needs both.
 */
export function checklistFromFields(
  fields: Record<string, string>,
  { requireAll }: { requireAll: boolean },
): { ok: true; items: ChecklistItems } | { ok: false; errors: Record<string, string> } {
  const items: ChecklistItems = {}
  const errors: Record<string, string> = {}
  for (const key of STANDARD_KEYS) {
    const ratingIn = (fields[ratingField(key)] ?? '').trim()
    const evidenceIn = (fields[evidenceField(key)] ?? '').trim()
    let rating: StandardRating | null = null
    let evidence: EvidenceRef | null = null
    if (ratingIn) {
      if ((RATINGS as readonly string[]).includes(ratingIn)) rating = ratingIn as StandardRating
      else errors[ratingField(key)] = 'Pick Developing, Meets or Exceeds.'
    } else if (requireAll) errors[ratingField(key)] = 'Rate this standard.'
    if (evidenceIn) {
      evidence = parseEvidence(evidenceIn)
      if (!evidence) errors[evidenceField(key)] = 'Pick a case log or a WPBA.'
    } else if (requireAll) errors[evidenceField(key)] = 'Link a case log or a WPBA as evidence.'
    if (rating || evidence) items[key] = { rating, evidence }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, items }
}

/** The stored items, read defensively: unknown standards and malformed parts are dropped. */
export function storedItems(value: unknown): ChecklistItems {
  const items: ChecklistItems = {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return items
  for (const key of STANDARD_KEYS) {
    const entry = (value as Record<string, unknown>)[key]
    if (entry === null || typeof entry !== 'object') continue
    const { rating, evidence } = entry as { rating?: unknown; evidence?: unknown }
    const ref =
      evidence !== null && typeof evidence === 'object'
        ? parseEvidence(`${(evidence as { kind?: unknown }).kind}:${(evidence as { id?: unknown }).id}`)
        : null
    const okRating = typeof rating === 'string' && (RATINGS as readonly string[]).includes(rating) ? (rating as StandardRating) : null
    if (okRating || ref) items[key] = { rating: okRating, evidence: ref }
  }
  return items
}

/** The evidence references in these items, by kind. */
export function evidenceIds(items: ChecklistItems): { caseLogIds: string[]; wpbaIds: string[] } {
  const refs = Object.values(items).flatMap((entry) => (entry.evidence ? [entry.evidence] : []))
  return {
    caseLogIds: [...new Set(refs.filter((ref) => ref.kind === 'CASE_LOG').map((ref) => ref.id))],
    wpbaIds: [...new Set(refs.filter((ref) => ref.kind === 'WPBA').map((ref) => ref.id))],
  }
}

/** The audit snapshot of a checklist: ids, status and how much is filled in. Never ratings by name, evidence ids or any text. */
export function checklistAuditSnapshot(row: {
  id: string
  traineeId: string
  monthNumber: number
  formVersion: number
  status: SubmissionStatus
  items: unknown
}): Snapshot {
  const items = storedItems(row.items)
  return {
    id: row.id,
    traineeId: row.traineeId,
    monthNumber: row.monthNumber,
    formVersion: row.formVersion,
    status: row.status,
    rated: Object.values(items).filter((entry) => entry.rating !== null).length,
    withEvidence: Object.values(items).filter((entry) => entry.evidence !== null).length,
  }
}
