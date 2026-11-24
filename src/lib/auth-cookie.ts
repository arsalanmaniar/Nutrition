// Shared definition of the portal's auth cookie.
//
// WHY THIS EXISTS
// supabase-js persists its session in localStorage, which the server cannot
// read. Server code that must know who is signed in before it renders needs
// the token somewhere it can see it.
//
// Rather than replace supabase-js's storage (which would mean re-implementing
// session chunking to stay under the 4KB cookie limit, and risking the working
// login flow), the browser mirrors its access token into this cookie and the
// server verifies it before anything renders. The only server reader is
// src/features/nutrition/auth/session.ts, which has Supabase's auth server
// verify the token on every request.
//
// SECURITY NOTE: this cookie is intentionally NOT httpOnly — the browser client
// has to write it. That is not a new exposure: the same token already sits in
// localStorage, so anything able to read this cookie could already read that.
// The security property comes from the server verifying the token against
// Supabase's auth server on every request, so a forged or expired token is
// rejected regardless of what the client puts here.

export const AUTH_TOKEN_COOKIE = 'cdnep-access-token'

/** Decodes a JWT payload without verifying it. Used only for a fast expiry check. */
export function decodeJwtExp(token: string): number | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const parsed = JSON.parse(json) as { exp?: number }
    return typeof parsed.exp === 'number' ? parsed.exp : null
  } catch {
    return null
  }
}

/** True when the token is absent, malformed, or past its expiry. */
export function isExpired(token: string | undefined): boolean {
  if (!token) return true
  const exp = decodeJwtExp(token)
  if (exp === null) return true
  return Date.now() >= exp * 1000
}

// ── Browser-only helpers ─────────────────────────────────────────────────────
// Guarded on `document` so this module stays importable from server code,
// such as src/features/nutrition/auth/session.ts.

/** Writes the auth cookie, expiring it exactly with the token it carries. */
export function writeAuthCookie(token: string): void {
  if (typeof document === 'undefined') return
  const exp = decodeJwtExp(token)
  const maxAge = exp ? Math.max(0, exp - Math.floor(Date.now() / 1000)) : 3600
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${AUTH_TOKEN_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`
}

export function clearAuthCookie(): void {
  if (typeof document === 'undefined') return
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${AUTH_TOKEN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
}
