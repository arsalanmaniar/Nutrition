import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => ({ prisma: (await import('../../server/__tests__/fake-prisma')).fakePrisma }))

import { IDLE, form } from '../../server/__tests__/actors'
import { submitMsfResponse } from '../../server/public/msf'
import {
  MSF_DEAD_LINK_TEXT,
  MSF_STATUS_LABELS,
  currentRoundText,
  msfLinkUrl,
  remainingInvites,
  responsesText,
  roundLabel,
} from '../msf/msf-display'
import { OUTCOMES, epaChangeText, linkableWpbas, outcomeLabel } from '../remediation/remediation-display'

// The Step 6c screens' pure display helpers. They decide nothing; the server
// actions and loaders apply every rule.

describe('MSF labels and texts', () => {
  it('status labels for every state', () => {
    expect(MSF_STATUS_LABELS).toEqual({ OPEN: 'Open', USED: 'Answered', EXPIRED: 'Expired', REVOKED: 'Revoked' })
  })

  it.each([
    ['M04', 'Month 4'],
    ['M08', 'Month 8'],
    ['M12', 'Month 12'],
    ['odd', 'odd'],
  ])('round %s -> %s', (point, label) => {
    expect(roundLabel(point)).toBe(label)
  })

  it('the current-round line', () => {
    expect(currentRoundText('M08')).toBe('Month 8 round: links you create now join this round.')
    expect(currentRoundText(null)).toBe('No MSF round this month: links can be created in training months 4, 8, 12.')
  })

  it.each([
    [{ count: 0, hidden: true }, '0 responses: not enough responses yet (averages show from 3).'],
    [{ count: 1, hidden: true }, '1 response: not enough responses yet (averages show from 3).'],
    [{ count: 2, hidden: true }, '2 responses: not enough responses yet (averages show from 3).'],
    [{ count: 3, hidden: false }, '3 responses.'],
  ])('%j -> %s', (aggregate, text) => {
    expect(responsesText(aggregate)).toBe(text)
  })

  it('places left in a round: open and answered links count, revoked and expired do not', () => {
    const invites = (...statuses: ('OPEN' | 'USED' | 'REVOKED' | 'EXPIRED')[]) => statuses.map((status) => ({ status }))
    expect(remainingInvites([])).toBe(5)
    expect(remainingInvites(invites('OPEN', 'USED', 'REVOKED', 'EXPIRED'))).toBe(3)
    expect(remainingInvites(invites('OPEN', 'OPEN', 'USED', 'USED', 'USED', 'OPEN'))).toBe(0)
  })

  it('the link is the public route', () => {
    expect(msfLinkUrl('https://example.test/', 'A'.repeat(43))).toBe(`https://example.test/nutrition/msf/${'A'.repeat(43)}`)
  })

  it("the public page's generic message is the server's, word for word", async () => {
    const result = await submitMsfResponse(IDLE, form({ token: 'not-a-token' }))
    expect(result).toEqual({ status: 'error', message: MSF_DEAD_LINK_TEXT })
  })
})

describe('remediation labels', () => {
  it.each([
    ['IN_PROGRESS', 'In progress'],
    ['MET', 'Met'],
    ['NOT_MET', 'Not met'],
    [null, 'Not set'],
    ['SOMETHING', 'Not set'],
  ])('outcome %j -> %s', (outcome, label) => {
    expect(outcomeLabel(outcome)).toBe(label)
  })

  it('offers the three outcomes the server accepts', () => {
    expect([...OUTCOMES].sort()).toEqual(['IN_PROGRESS', 'MET', 'NOT_MET'])
  })

  it('EPA before and after', () => {
    expect(epaChangeText({ label: 'EPA 1 (pending)', before: 'E2', after: 'E3' })).toBe('EPA 1 (pending): E2 → E3')
    expect(epaChangeText({ label: 'EPA 2 (pending)', before: null, after: null })).toBe('EPA 2 (pending): — → —')
    expect(epaChangeText(null)).toBeNull()
  })

  it('the WPBA picker offers only WPBAs filed after the step', () => {
    const options = [
      { id: 'a', filedAt: '2026-04-10T05:00:00.000Z' },
      { id: 'b', filedAt: '2026-04-15T07:00:00.000Z' },
      { id: 'c', filedAt: '2026-04-15T07:00:01.000Z' },
    ]
    expect(linkableWpbas(options, '2026-04-15T07:00:00.000Z').map((option) => option.id)).toEqual(['c'])
  })
})
