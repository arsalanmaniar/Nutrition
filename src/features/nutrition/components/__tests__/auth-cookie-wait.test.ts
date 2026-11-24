import { afterEach, describe, expect, it, vi } from 'vitest'
import { cookieHasToken, waitFor } from '../auth-cookie-wait'

const NAME = 'cdnep-access-token'

describe('cookieHasToken', () => {
  it('finds the cookie with exactly this token among others', () => {
    expect(cookieHasToken(`a=1; ${NAME}=tok.en.sig; b=2`, NAME, 'tok.en.sig')).toBe(true)
    expect(cookieHasToken(`${NAME}=tok.en.sig`, NAME, 'tok.en.sig')).toBe(true)
  })

  it('a different token, a longer token or a look-alike name does not count', () => {
    expect(cookieHasToken(`${NAME}=old.token.sig`, NAME, 'tok.en.sig')).toBe(false)
    expect(cookieHasToken(`${NAME}=tok.en.sig-extra`, NAME, 'tok.en.sig')).toBe(false)
    expect(cookieHasToken(`x${NAME}=tok.en.sig`, NAME, 'tok.en.sig')).toBe(false)
    expect(cookieHasToken('', NAME, 'tok.en.sig')).toBe(false)
  })
})

describe('waitFor', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves true at once when the check already passes', async () => {
    expect(await waitFor(() => true, 5000)).toBe(true)
  })

  it('resolves true as soon as the check starts passing within the timeout', async () => {
    vi.useFakeTimers()
    let ready = false
    setTimeout(() => {
      ready = true
    }, 1200)
    const result = waitFor(() => ready, 5000)
    await vi.advanceTimersByTimeAsync(1300)
    expect(await result).toBe(true)
  })

  it('resolves false after the timeout (about 5 s) when the check never passes, then stops polling', async () => {
    vi.useFakeTimers()
    let checks = 0
    const result = waitFor(() => {
      checks++
      return false
    }, 5000)
    await vi.advanceTimersByTimeAsync(5200)
    expect(await result).toBe(false)
    const after = checks
    await vi.advanceTimersByTimeAsync(2000)
    expect(checks).toBe(after)
  })
})
