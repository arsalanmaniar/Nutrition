import { describe, expect, it } from 'vitest'
import { NUTRITION_HOME_PATH, safeNutritionReturnPath } from '../return-path'

describe('safeNutritionReturnPath: a next/returnTo value is accepted only if it starts with /nutrition/ and has no "//" or scheme; otherwise /nutrition', () => {
  it.each([
    ['/nutrition/trainee', '/nutrition/trainee'],
    ['/nutrition/trainee/logbook?tab=drafts', '/nutrition/trainee/logbook?tab=drafts'],
    ['/nutrition/forms/FORM_1_3#month-4', '/nutrition/forms/FORM_1_3#month-4'],
    ['/nutrition/admin/profiles?page=2&sort=name', '/nutrition/admin/profiles?page=2&sort=name'],
    ['/nutrition/trainee/../preceptor', '/nutrition/preceptor'],
  ])('accepts %s', (raw, expected) => {
    expect(safeNutritionReturnPath(raw)).toBe(expected)
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['an empty string', ''],
    ['/nutrition with no trailing slash', '/nutrition'],
    ['a relative path', 'nutrition/trainee'],
    ['another area of the app', '/admin/dashboard'],
    ['a look-alike prefix', '/nutritional-info'],
    ['a protocol-relative URL', '//evil.example/nutrition/x'],
    ['a "//" later in the path', '/nutrition//evil.example'],
    ['an absolute URL', 'https://evil.example/nutrition/x'],
    ['a scheme inside the query', '/nutrition/x?next=https://evil.example'],
    ['javascript:', 'javascript:alert(1)'],
    ['javascript: inside the path', '/nutrition/javascript:alert(1)'],
    ['a leading backslash', '/\\evil.example'],
    ['a backslash in the path', '/nutrition/\\evil.example'],
    ['a ".." that climbs out', '/nutrition/../admin'],
    ['an encoded ".." that climbs out', '/nutrition/%2e%2e/admin'],
    ['a tab', '/nutrition/x\ty'],
    ['a leading space', ' /nutrition/x'],
  ])('falls back to /nutrition for %s', (_label, raw) => {
    expect(safeNutritionReturnPath(raw)).toBe(NUTRITION_HOME_PATH)
  })
})
