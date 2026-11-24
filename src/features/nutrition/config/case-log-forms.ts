// The clinical e-logbook's case forms (A–D), and the lists its selects offer.
// The trainee's case-log form renders from these objects and the server
// validates against them, so a change of fields is an edit here, not a
// migration.
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ TODO(CDN-EP): PLACEHOLDER CONTENT, NOT THE PROGRAM'S REAL FORMS.         ║
// ║                                                                          ║
// ║ The real Form A–D fields have not been supplied (plan: Open Items).      ║
// ║ Until they are, every form uses NCP_DEFAULT_SECTIONS below: the four     ║
// ║ Nutrition Care Process steps, one free-text field each. To put in the    ║
// ║ real fields, per form in CASE_LOG_FORMS:                                 ║
// ║   1. replace `title` and `sections`;                                     ║
// ║   2. set `placeholder: false` (this removes the form's warning banner);  ║
// ║   3. leave `version` at 1 while no real logs exist; bump it after that.  ║
// ║ DIAGNOSIS_CATEGORIES is a placeholder list too; replace it the same way. ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// Rules for editing (as in forms.ts):
//  - NutritionCaseLog.data stores the answers keyed by field `key`. Never
//    rename or reuse a key once real logs exist; add a new one instead.
//  - Bump a form's `version` when its fields change. Each log records the
//    version it was written against (NutritionCaseLog.formVersion).
//  - Every field is free text, and the server checks every value for patient
//    identifiers (validation/privacy.ts). Nothing here may ask for a name,
//    MRN, phone number, address or date of birth.
//  - Age band and diagnosis category are stored by `key`. A key removed from a
//    list stays readable on old logs (shown as the bare key) but can no longer
//    be picked.

import type { CaseFormType } from '@prisma/client'

export interface CaseLogField {
  /** Unique within its form: the key in NutritionCaseLog.data. snake_case. */
  readonly key: string
  readonly label: string
  /** Guidance shown under the field. */
  readonly hint?: string
  /** One line of text, or a multi-line box. Both are free text. */
  readonly kind: 'text' | 'textarea'
  /** Must be filled in to submit. A draft may leave any field empty. */
  readonly required: boolean
  readonly maxLength: number
}

export interface CaseLogSection {
  readonly key: string
  readonly title: string
  readonly fields: readonly CaseLogField[]
}

export interface CaseLogFormDefinition {
  readonly type: CaseFormType
  readonly version: number
  readonly title: string
  /** True while the form shows NCP_DEFAULT_SECTIONS instead of its real fields. */
  readonly placeholder: boolean
  readonly sections: readonly CaseLogSection[]
}

export interface ListOption {
  readonly key: string
  readonly label: string
}

// TODO(CDN-EP): the stand-in fields for Forms A–D, until the real ones arrive.
const NCP_DEFAULT_SECTIONS: readonly CaseLogSection[] = [
  {
    key: 'assessment',
    title: 'Assessment',
    fields: [{ key: 'assessment', label: 'Nutrition assessment', kind: 'textarea', required: true, maxLength: 4000 }],
  },
  {
    key: 'diagnosis',
    title: 'Diagnosis',
    fields: [{ key: 'diagnosis', label: 'Nutrition diagnosis', kind: 'textarea', required: true, maxLength: 4000 }],
  },
  {
    key: 'intervention',
    title: 'Intervention',
    fields: [{ key: 'intervention', label: 'Nutrition intervention', kind: 'textarea', required: true, maxLength: 4000 }],
  },
  {
    key: 'monitoring_evaluation',
    title: 'Monitoring & Evaluation',
    fields: [{ key: 'monitoring_evaluation', label: 'Monitoring and evaluation', kind: 'textarea', required: true, maxLength: 4000 }],
  },
]

export const CASE_LOG_FORMS: Readonly<Record<CaseFormType, CaseLogFormDefinition>> = {
  // TODO(CDN-EP): replace with the real Form A.
  A: { type: 'A', version: 1, title: 'Form A', placeholder: true, sections: NCP_DEFAULT_SECTIONS },
  // TODO(CDN-EP): replace with the real Form B.
  B: { type: 'B', version: 1, title: 'Form B', placeholder: true, sections: NCP_DEFAULT_SECTIONS },
  // TODO(CDN-EP): replace with the real Form C.
  C: { type: 'C', version: 1, title: 'Form C', placeholder: true, sections: NCP_DEFAULT_SECTIONS },
  // TODO(CDN-EP): replace with the real Form D.
  D: { type: 'D', version: 1, title: 'Form D', placeholder: true, sections: NCP_DEFAULT_SECTIONS },
}

export const CASE_FORM_TYPES = ['A', 'B', 'C', 'D'] as const satisfies readonly CaseFormType[]

/** Every field of a form, in display order. */
export function caseLogFields(type: CaseFormType): CaseLogField[] {
  return CASE_LOG_FORMS[type].sections.flatMap((section) => section.fields)
}

/** The input name the case-log form posts a field under, and the server reports its errors under. */
export const dataFieldName = (key: string) => `data.${key}`

/**
 * Age bands for NutritionCaseLog.ageBand: a band, never an exact age or a date
 * of birth. A default set, not from the source documents: change it here if
 * the program uses other bands.
 */
export const AGE_BANDS: readonly ListOption[] = [
  { key: 'under_1m', label: 'Under 1 month' },
  { key: '1_11m', label: '1–11 months' },
  { key: '1_4y', label: '1–4 years' },
  { key: '5_9y', label: '5–9 years' },
  { key: '10_17y', label: '10–17 years' },
  { key: '18_39y', label: '18–39 years' },
  { key: '40_59y', label: '40–59 years' },
  { key: '60_79y', label: '60–79 years' },
  { key: '80_plus', label: '80 years and over' },
]

// TODO(CDN-EP): PLACEHOLDER LIST, to be replaced with the program's real
// diagnosis categories. The "[Placeholder]" labels make that visible in the form.
export const DIAGNOSIS_CATEGORIES: readonly ListOption[] = [
  { key: 'placeholder_renal', label: '[Placeholder] Renal' },
  { key: 'placeholder_transplant', label: '[Placeholder] Transplant' },
  { key: 'placeholder_diabetes_endocrine', label: '[Placeholder] Diabetes & endocrine' },
  { key: 'placeholder_cardiac', label: '[Placeholder] Cardiac' },
  { key: 'placeholder_critical_care', label: '[Placeholder] Critical care' },
  { key: 'placeholder_gastro_liver', label: '[Placeholder] Gastrointestinal & liver' },
  { key: 'placeholder_paediatric', label: '[Placeholder] Paediatric' },
  { key: 'placeholder_other', label: '[Placeholder] Other' },
]

/** The label for a stored key, or the key itself if the list no longer has it. */
export function optionLabel(options: readonly ListOption[], key: string): string {
  return options.find((option) => option.key === key)?.label ?? key
}
