// Small pure helpers for the login page's "wait until the auth cookie exists"
// step. Kept free of `document` so they can be unit tested in Node.

/** Does this `document.cookie` string hold `name` with exactly `value`? */
export function cookieHasToken(cookieString: string, name: string, value: string): boolean {
  return cookieString.split(';').some((part) => part.trim() === `${name}=${value}`)
}

/**
 * Polls `check` every `intervalMs` until it returns true (resolves true) or
 * `timeoutMs` has passed (resolves false).
 */
export async function waitFor(check: () => boolean, timeoutMs: number, intervalMs = 100): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (check()) return true
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}
