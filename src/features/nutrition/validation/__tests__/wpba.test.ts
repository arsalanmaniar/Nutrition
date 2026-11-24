import { describe, expect, it } from 'vitest'
import { ratingFieldErrors, ratingsFromFields, wpbaInputSchema } from '../wpba'

const TRAINEE = '6f1c2b8e-4a3d-4f5e-9b7a-1c2d3e4f5a6b'
const LOG = '7a2d3c9f-5b4e-4a6f-8c8b-2d3e4f5a6b7c'
const base = { traineeId: TRAINEE, assessedOn: '2026-04-15', feedback: 'Good.' }
const errors = (input: Record<string, string>) => {
  const result = wpbaInputSchema.safeParse(input)
  return result.success ? {} : Object.fromEntries(result.error.issues.map((issue) => [String(issue.path[0]), issue.message]))
}

describe('wpbaInputSchema', () => {
  it('keeps only what the server uses: no total, passed, maxScore or Miller level from the client', () => {
    expect(
      wpbaInputSchema.parse({ ...base, type: 'OSCE', criticalError: 'on', total: '25', passed: 'true', maxScore: '25', millerLevel: 'DOES', assessorId: 'x' }),
    ).toEqual({ type: 'OSCE', traineeId: TRAINEE, assessedOn: '2026-04-15', caseLogId: null, procedure: null, criticalError: true, feedback: 'Good.' })
  })

  it('a critical error counts for an OSCE only', () => {
    expect(wpbaInputSchema.parse({ ...base, type: 'OSCE' }).criticalError).toBe(false)
    expect(wpbaInputSchema.parse({ ...base, type: 'MINI_CEX', criticalError: 'on' }).criticalError).toBe(false)
  })

  it('DOPS stores a listed key, or the "other" description', () => {
    expect(wpbaInputSchema.parse({ ...base, type: 'DOPS', procedure: 'growth_plotting', procedureOther: 'ignored' }).procedure).toBe('growth_plotting')
    expect(wpbaInputSchema.parse({ ...base, type: 'DOPS', procedure: 'other', procedureOther: '  Swallow screen  ' }).procedure).toBe('Swallow screen')
  })

  it.each([
    ['no type', { ...base }, 'type', 'Pick an assessment type.'],
    ['a bad trainee id', { ...base, type: 'CBD', caseLogId: LOG, traineeId: 'x' }, 'traineeId', 'Invalid id.'],
    ['a CbD without a log', { ...base, type: 'CBD' }, 'caseLogId', 'Pick the submitted case log under discussion.'],
    ['a log on an OSCE', { ...base, type: 'OSCE', caseLogId: LOG }, 'caseLogId', 'Only a CbD links a case log.'],
    ['DOPS "other" without a description', { ...base, type: 'DOPS', procedure: 'other' }, 'procedureOther', 'Describe the procedure.'],
    ['an unknown DOPS procedure', { ...base, type: 'DOPS', procedure: 'x' }, 'procedure', 'Pick the procedure observed.'],
    ['a procedure on a CbD', { ...base, type: 'CBD', caseLogId: LOG, procedure: 'growth_plotting' }, 'procedure', 'Only a DOPS records a procedure.'],
    ['a description over 200 characters', { ...base, type: 'DOPS', procedure: 'other', procedureOther: 'a'.repeat(201) }, 'procedureOther', 'Keep the description under 200 characters.'],
    ['an impossible date', { ...base, type: 'MINI_CEX', assessedOn: '2026-02-30' }, 'assessedOn', 'Use a date like 2026-10-11.'],
    ['empty feedback', { ...base, type: 'MINI_CEX', feedback: ' ' }, 'feedback', 'Write your feedback.'],
    ['feedback over 2000 characters', { ...base, type: 'MINI_CEX', feedback: 'a'.repeat(2001) }, 'feedback', 'Keep the feedback under 2000 characters.'],
    ['a CNIC in the feedback', { ...base, type: 'MINI_CEX', feedback: 'CNIC 42101-1234567-1' }, 'feedback', expect.stringContaining('CNIC')],
  ])('refuses %s', (_label, input, field, message) => {
    expect(errors(input as Record<string, string>)).toMatchObject({ [field]: message })
  })
})

describe('ratings', () => {
  it('reads rating.* fields: whole numbers as numbers, anything else as text for scoring to refuse, blanks skipped', () => {
    expect(ratingsFromFields({ 'rating.a': '4', 'rating.b': ' 7 ', 'rating.c': '3.5', 'rating.d': '', total: '45' })).toEqual({ a: 4, b: 7, c: '3.5' })
  })

  it('maps scoring problems to field errors', () => {
    expect(ratingFieldErrors([{ key: 'a', problem: 'MISSING' }, { key: '', problem: 'NOT_AN_OBJECT' }])).toEqual({ 'rating.a': 'Rate this item.', ratings: 'Invalid ratings.' })
  })
})
