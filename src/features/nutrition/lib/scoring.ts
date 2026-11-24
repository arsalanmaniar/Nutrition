// Server-side scoring of the evaluation forms against config/forms.ts (plan,
// Step 4: sum, max and percentage computed on the server, never trusted from
// the client). The only input is the ratings, keyed by item key; a total the
// client sends is never read, and a key such as "total" is refused as unknown.
//
// Every rating must belong to one of the form's rated items and be a whole
// number on that item's section scale. Scoring also needs every item rated;
// ratingErrors(..., { requireAll: false }) checks a half-filled draft without
// scoring it. WEEKLY has no rated items: it scores as null (no score), and
// any rating sent for it is an unknown item.

import type { EvaluationFormType } from '@prisma/client'
import { EVALUATION_FORMS, type RatingScale } from '@/features/nutrition/config/forms'

export type RatingProblem = 'NOT_AN_OBJECT' | 'UNKNOWN_ITEM' | 'NOT_A_WHOLE_NUMBER' | 'OUT_OF_RANGE' | 'MISSING'

export interface RatingError {
  /** The item key; empty for NOT_AN_OBJECT. */
  readonly key: string
  readonly problem: RatingProblem
  readonly message: string
}

export interface SectionScore {
  readonly key: string
  readonly total: number
  readonly maxScore: number
}

export interface FormScore {
  readonly sections: readonly SectionScore[]
  readonly total: number
  readonly maxScore: number
  /** total / maxScore × 100, rounded to one decimal place, for display. Compare totals, not this. */
  readonly percentage: number
}

export type ScoreResult =
  | { readonly ok: true; readonly score: FormScore | null }
  | { readonly ok: false; readonly errors: readonly RatingError[] }

/** Each rated item of a form, with its section's scale. */
function itemScales(formType: EvaluationFormType): Map<string, RatingScale> {
  const scales = new Map<string, RatingScale>()
  for (const section of EVALUATION_FORMS[formType].sections) {
    for (const item of section.items) scales.set(item.key, section.scale)
  }
  return scales
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value))

/** Everything wrong with these ratings for this form, in item order after any unknown keys. */
export function ratingErrors(
  formType: EvaluationFormType,
  ratings: unknown,
  { requireAll }: { requireAll: boolean },
): RatingError[] {
  if (!isPlainObject(ratings)) return [{ key: '', problem: 'NOT_AN_OBJECT', message: 'Ratings must be an object keyed by item.' }]
  const scales = itemScales(formType)
  const errors: RatingError[] = []
  for (const key of Object.keys(ratings)) {
    if (!scales.has(key)) errors.push({ key, problem: 'UNKNOWN_ITEM', message: `"${key}" is not an item of this form.` })
  }
  for (const [key, scale] of scales) {
    if (!Object.hasOwn(ratings, key)) {
      if (requireAll) errors.push({ key, problem: 'MISSING', message: `"${key}" is not rated.` })
      continue
    }
    const value = ratings[key]
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      errors.push({ key, problem: 'NOT_A_WHOLE_NUMBER', message: `"${key}" must be a whole number.` })
    } else if (value < scale.min || value > scale.max) {
      errors.push({ key, problem: 'OUT_OF_RANGE', message: `"${key}" must be from ${scale.min} to ${scale.max}.` })
    }
  }
  return errors
}

/** Validates a complete set of ratings and scores it: section totals, total, maximum and percentage. */
export function scoreForm(formType: EvaluationFormType, ratings: unknown): ScoreResult {
  const errors = ratingErrors(formType, ratings, { requireAll: true })
  if (errors.length > 0) return { ok: false, errors }
  const definition = EVALUATION_FORMS[formType]
  if (definition.sections.length === 0) return { ok: true, score: null }

  const values = ratings as Record<string, number>
  const sections = definition.sections.map((section) => ({
    key: section.key,
    total: section.items.reduce((sum, item) => sum + values[item.key], 0),
    maxScore: section.maxScore,
  }))
  const total = sections.reduce((sum, section) => sum + section.total, 0)
  return {
    ok: true,
    score: { sections, total, maxScore: definition.maxScore, percentage: Math.round((total * 1000) / definition.maxScore) / 10 },
  }
}
