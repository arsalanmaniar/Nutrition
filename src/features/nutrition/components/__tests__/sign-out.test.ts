import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The supabase-js client is faked. Like the real one, getSession() reads the
// stored session afresh on every call, which is what AuthCookieSync relies on.
const auth = vi.hoisted(() => ({
  signOut: vi.fn(),
  getSession: vi.fn(),
  stopAutoRefresh: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ supabase: { auth } }))

import { AUTH_TOKEN_COOKIE, writeAuthCookie } from '@/lib/auth-cookie'
import { isSupabaseSessionKey, signOutNutrition } from '../sign-out'

const SESSION_KEY = 'sb-hpocproject-auth-token'
const VERIFIER_KEY = 'sb-hpocproject-auth-token-code-verifier'
const TOKEN = 'header.payload.signature'

/** A minimal Storage: just the members the code under test uses. */
class FakeStorage {
  private items = new Map<string, string>()
  get length() {
    return this.items.size
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null
  }
  getItem(key: string) {
    return this.items.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.items.set(key, value)
  }
  removeItem(key: string) {
    this.items.delete(key)
  }
  keys() {
    return [...this.items.keys()]
  }
}

/** A cookie jar that behaves like document.cookie for name=value and Max-Age=0 deletion. */
function fakeDocument() {
  const jar = new Map<string, string>()
  return {
    get cookie() {
      return [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
    },
    set cookie(raw: string) {
      const [pair, ...attributes] = raw.split(';').map((part) => part.trim())
      const name = pair.slice(0, pair.indexOf('='))
      const value = pair.slice(pair.indexOf('=') + 1)
      const maxAge = attributes.find((a) => /^max-age=/i.test(a))
      if (maxAge && Number(maxAge.split('=')[1]) <= 0) jar.delete(name)
      else jar.set(name, value)
    },
  }
}

let storage: FakeStorage
let doc: ReturnType<typeof fakeDocument>
let assign: ReturnType<typeof vi.fn>

beforeEach(() => {
  storage = new FakeStorage()
  storage.setItem(SESSION_KEY, JSON.stringify({ access_token: TOKEN }))
  storage.setItem(VERIFIER_KEY, 'verifier')
  storage.setItem('cdnep-theme', 'dark')
  storage.setItem('unrelated-setting', 'keep me')

  doc = fakeDocument()
  doc.cookie = `${AUTH_TOKEN_COOKIE}=${TOKEN}; Path=/; Max-Age=3600; SameSite=Lax`

  assign = vi.fn()
  vi.stubGlobal('document', doc)
  vi.stubGlobal('window', { localStorage: storage, location: { protocol: 'https:', assign } })

  auth.stopAutoRefresh.mockResolvedValue(undefined)
  auth.getSession.mockImplementation(async () => {
    await Promise.resolve() // the real one awaits a lock and storage before reading
    return { data: { session: storage.getItem(SESSION_KEY) ? { access_token: TOKEN } : null }, error: null }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

/** What AuthCookieSync does when the next page mounts: copy any stored session's token into the cookie. */
async function mountAuthCookieSync() {
  const { data } = await auth.getSession()
  if (data.session?.access_token) writeAuthCookie(data.session.access_token)
}

describe('signOutNutrition: whatever supabase signOut does, this browser ends up signed out', () => {
  it.each<[string, () => void]>([
    [
      'succeeds (and clears its own storage)',
      () =>
        auth.signOut.mockImplementation(async () => {
          storage.removeItem(SESSION_KEY)
          storage.removeItem(VERIFIER_KEY)
          return { error: null }
        }),
    ],
    [
      'returns an error, as supabase-js does offline (and leaves the session stored)',
      () => auth.signOut.mockResolvedValue({ error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' } }),
    ],
    ['rejects', () => auth.signOut.mockRejectedValue(new Error('500 from the auth server'))],
    [
      'throws offline (synchronously)',
      () =>
        auth.signOut.mockImplementation(() => {
          throw new TypeError('Failed to fetch')
        }),
    ],
  ])(
    'signOut %s: cookie cleared, sb-* keys removed, cdnep-theme kept, redirect to /nutrition/login',
    async (_label, arrange) => {
      arrange()
      await signOutNutrition()

      expect(doc.cookie).not.toContain(AUTH_TOKEN_COOKIE)
      expect(storage.keys().filter(isSupabaseSessionKey)).toEqual([])
      expect(storage.getItem('cdnep-theme')).toBe('dark')
      expect(storage.getItem('unrelated-setting')).toBe('keep me')
      expect(assign).toHaveBeenCalledTimes(1)
      expect(assign).toHaveBeenCalledWith('/nutrition/login')

      // On the reloaded login page, AuthCookieSync finds no session and writes no cookie.
      await mountAuthCookieSync()
      expect(doc.cookie).not.toContain(AUTH_TOKEN_COOKIE)
    },
  )

  it('stopAutoRefresh failing as well changes nothing: still signed out and redirected', async () => {
    auth.stopAutoRefresh.mockRejectedValue(new Error('boom'))
    auth.signOut.mockResolvedValue({ error: { status: 0 } })
    await signOutNutrition()
    expect(doc.cookie).not.toContain(AUTH_TOKEN_COOKIE)
    expect(storage.keys().filter(isSupabaseSessionKey)).toEqual([])
    expect(assign).toHaveBeenCalledWith('/nutrition/login')
  })

  it('a session written back right after the wipe (a token refresh already in flight) is cleared again before the redirect', async () => {
    auth.signOut.mockResolvedValue({ error: { status: 0 } })
    // The refresh lands just after the first wipe, independently of anything
    // the helper calls, and stores the session and cookie again.
    const removeItem = storage.removeItem.bind(storage)
    let raced = false
    storage.removeItem = (key: string) => {
      removeItem(key)
      if (key === SESSION_KEY && !raced) {
        raced = true
        queueMicrotask(() => {
          storage.setItem(SESSION_KEY, '{}')
          doc.cookie = `${AUTH_TOKEN_COOKIE}=${TOKEN}; Path=/`
        })
      }
    }
    await signOutNutrition()
    expect(raced).toBe(true)
    expect(storage.getItem(SESSION_KEY)).toBeNull()
    expect(doc.cookie).not.toContain(AUTH_TOKEN_COOKIE)
    expect(assign).toHaveBeenCalledWith('/nutrition/login')
  })
})

describe('isSupabaseSessionKey: only supabase-js session keys are removed', () => {
  it.each([
    ['sb-hpocproject-auth-token', true],
    ['sb-hpocproject-auth-token-code-verifier', true],
    ['sb-hpocproject-auth-token-user', true],
    ['cdnep-theme', false],
    ['nutrition:theme-change', false],
    ['sb-hpocproject-something-else', false],
    ['my-sb-hpocproject-auth-token', false],
  ])('%s -> %s', (key, expected) => {
    expect(isSupabaseSessionKey(key)).toBe(expected)
  })
})
