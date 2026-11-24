import { clearAuthCookie } from '@/lib/auth-cookie'
import { supabase } from '@/lib/supabase'
import { NUTRITION_LOGIN_HREF } from './navigation'

// Signing out of the nutrition portal must lock this browser even when the
// network does not cooperate.
//
// supabase-js's signOut() removes its stored session only when the server call
// succeeds or fails with 401/403/404. Offline or on a 5xx it returns an error
// and leaves the session in localStorage. AuthCookieSync would then copy that
// surviving session back into the auth cookie the guard reads, and the login
// page would offer "Continue": the person would not really be signed out.
//
// So the server call is best effort and its outcome is ignored. The local
// cleanup always runs.

/**
 * The localStorage keys supabase-js keeps a session in: `sb-<project>-auth-token`,
 * any `sb-…-code-verifier`, and the `-user` key if userStorage is ever configured.
 */
export function isSupabaseSessionKey(key: string): boolean {
  return /^sb-.+-auth-token(-user)?$/.test(key) || /^sb-.+-code-verifier$/.test(key)
}

/** Removes those keys and nothing else (cdnep-theme and the rest stay). Returns how many are left. */
export function removeSupabaseSessionKeys(storage: Storage): number {
  const sessionKeys = () => {
    const keys: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key !== null && isSupabaseSessionKey(key)) keys.push(key)
    }
    return keys
  }
  for (const key of sessionKeys()) storage.removeItem(key)
  return sessionKeys().length
}

/** Signs this browser out of the portal, whatever the network does, then reloads the login page. */
export async function signOutNutrition(): Promise<void> {
  // 1. Best effort, outcome ignored: stop the token auto-refresh (so it cannot
  //    write a session back mid-cleanup), then end this browser's session on
  //    the server. 'local' because the default ('global') would also sign the
  //    person out on every other device they use.
  try {
    await supabase.auth.stopAutoRefresh()
  } catch {
    // Ignored.
  }
  try {
    await supabase.auth.signOut({ scope: 'local' })
  } catch {
    // Ignored: the cleanup below runs whatever happened here.
  }

  // 2. Always: the cookie the guard reads, and supabase-js's stored session.
  const left = clearLocalSession()

  // 3. AuthCookieSync re-syncs from supabase.auth.getSession(), which reads the
  //    stored session afresh on every call. Confirm it now finds none; if a
  //    session was written back meanwhile, clear it again.
  if (left > 0 || (await sessionVisible())) clearLocalSession()

  // 4. Full reload, so no client state survives.
  window.location.assign(NUTRITION_LOGIN_HREF)
}

/** Clears the auth cookie and supabase-js's stored session. Returns how many session keys are left. */
function clearLocalSession(): number {
  clearAuthCookie()
  try {
    return removeSupabaseSessionKeys(window.localStorage)
  } catch {
    // localStorage unavailable: then supabase-js could not have stored a session there either.
    return 0
  }
}

async function sessionVisible(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession()
    return data.session !== null
  } catch {
    return false
  }
}
