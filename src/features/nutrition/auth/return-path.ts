// Where to send someone after they sign in, given a `next` / returnTo value from
// the URL (for the 3c login page).
//
// That value is attacker-controlled: anyone can craft a login link. So it is
// accepted only if it is a path inside /nutrition on this site, and anything
// else falls back to /nutrition. That closes the open-redirect hole where a link
// such as /nutrition/login?next=//evil.example sends a freshly signed-in user to
// another site.

export const NUTRITION_HOME_PATH = '/nutrition'

// Only used to resolve the path; it never leaves this function.
const PLACEHOLDER_ORIGIN = 'https://nutrition.invalid'

export function safeNutritionReturnPath(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/nutrition/')) return NUTRITION_HOME_PATH

  // No "//" anywhere (a leading "//" is another site), no backslash (browsers
  // read "\" as "/"), no spaces or control characters, and no scheme such as
  // "javascript:" anywhere in the value.
  if (raw.includes('//') || raw.includes('\\') || hasSpaceOrControl(raw) || /[a-z][a-z0-9+.-]*:/i.test(raw)) {
    return NUTRITION_HOME_PATH
  }

  // Resolve "." and ".." segments, including %2e-encoded ones, the way a browser
  // would, then check the result is still inside /nutrition on this site.
  let url: URL
  try {
    url = new URL(raw, PLACEHOLDER_ORIGIN)
  } catch {
    return NUTRITION_HOME_PATH
  }
  if (url.origin !== PLACEHOLDER_ORIGIN || !url.pathname.startsWith('/nutrition/')) return NUTRITION_HOME_PATH
  return url.pathname + url.search + url.hash
}

function hasSpaceOrControl(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x20 || code === 0x7f) return true
  }
  return false
}
