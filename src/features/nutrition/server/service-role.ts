import 'server-only'
import { createClient } from '@supabase/supabase-js'

// Account creation with the Supabase service-role key. SERVER ONLY: import
// this from server actions and server pages, never from a client component
// ('server-only' fails the build if one does, and portal-guard-coverage.test.ts
// checks the direct imports). The key is read from the
// environment here, used for the admin API call, and never logged, returned or
// sent to the browser. Pages learn only the boolean from canCreateAccounts().

// The value .env.example ships with, as the existing /api/admin/users route
// checks, plus anything else that is obviously a stand-in.
const PLACEHOLDER = /^your-|placeholder|changeme/i

function serviceRoleKey(): string | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
  return key && !PLACEHOLDER.test(key) ? key : null
}

/** True when this server can create Supabase accounts (a real service-role key is set). */
export function canCreateAccounts(): boolean {
  return serviceRoleKey() !== null && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL)
}

function adminClient() {
  const key = serviceRoleKey()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!key || !url) throw new Error('Supabase account creation is not configured on this server')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** Creates a confirmed Supabase account. The password goes to Supabase and nowhere else. */
export async function createAuthUser(
  email: string,
  password: string,
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const failed = { ok: false, error: 'Supabase could not create the account. Try again later.' } as const
  try {
    const { data, error } = await adminClient().auth.admin.createUser({ email, password, email_confirm: true })
    if (error || !data.user) {
      const exists = error?.code === 'email_exists' || /already|exists|registered/i.test(error?.message ?? '')
      return exists ? { ok: false, error: 'A Supabase account already uses this email. Link it instead.' } : failed
    }
    return { ok: true, userId: data.user.id }
  } catch {
    return failed
  }
}

/** Deletes a Supabase account (used to undo createAuthUser). True when it is gone. */
export async function deleteAuthUser(userId: string): Promise<boolean> {
  try {
    const { error } = await adminClient().auth.admin.deleteUser(userId)
    return !error
  } catch {
    return false
  }
}
