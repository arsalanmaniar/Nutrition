import { describe, expect, it } from 'vitest'
import { AGE_BANDS, CASE_FORM_TYPES, CASE_LOG_FORMS, DIAGNOSIS_CATEGORIES, caseLogFields } from '../case-log-forms'

// Checks that still have to hold after the real Form A–D fields replace the
// placeholders: the shape the form and the server rely on.

describe('case-log form config', () => {
  it.each(CASE_FORM_TYPES)('Form %s: a version, at least one section, unique snake_case keys', (type) => {
    const form = CASE_LOG_FORMS[type]
    expect(form.type).toBe(type)
    expect(Number.isInteger(form.version) && form.version >= 1).toBe(true)
    expect(form.sections.length).toBeGreaterThan(0)

    const sectionKeys = form.sections.map((section) => section.key)
    const fieldKeys = caseLogFields(type).map((field) => field.key)
    expect(new Set(sectionKeys).size).toBe(sectionKeys.length)
    expect(new Set(fieldKeys).size).toBe(fieldKeys.length)
    for (const key of [...sectionKeys, ...fieldKeys]) expect(key).toMatch(/^[a-z][a-z0-9_]*$/)
    for (const field of caseLogFields(type)) expect(field.maxLength).toBeGreaterThan(0)
  })

  it('no field asks for a patient identifier', () => {
    const identifier = /\b(MRN|CNIC|phone|mobile|address|e-?mail|date of birth|DOB|patient'?s? name)\b/i
    for (const type of CASE_FORM_TYPES) {
      for (const field of caseLogFields(type)) expect(`${field.label} ${field.hint ?? ''}`).not.toMatch(identifier)
    }
  })

  it.each([
    ['AGE_BANDS', AGE_BANDS],
    ['DIAGNOSIS_CATEGORIES', DIAGNOSIS_CATEGORIES],
  ] as const)('%s: unique, non-empty keys and labels', (_name, options) => {
    expect(options.length).toBeGreaterThan(0)
    expect(new Set(options.map((option) => option.key)).size).toBe(options.length)
    expect(new Set(options.map((option) => option.label)).size).toBe(options.length)
    for (const option of options) {
      expect(option.key).toMatch(/^[a-z0-9][a-z0-9_]*$/)
      expect(option.label.trim()).not.toBe('')
    }
  })
})
