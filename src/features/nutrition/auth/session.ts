import { cache } from 'react'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { AUTH_TOKEN_COOKIE, isExpired } from '@/lib/auth-cookie'

// Who is signed in, for the nutrition module. Server-only: it reads the request
// cookies through next/headers.
//
// The browser mirrors its supabase-js access token into the auth cookie
// (src/lib/auth-cookie.ts, kept fresh by AuthCookieSync). This file reads that
// cookie and has Supabase's auth server confirm the token on every request, so
// a forged or expired cookie gets nobody in. This file only establishes
// identity; roles.ts decides access.

export interface NutritionSession {
  /** Supabase auth.users.id, which is what NutritionProfile.authUserId stores. */
  userId: string
  email: string
  /** Whether Supabase has the email as confirmed. roles.ts requires it for the super admin allowlist. */
  emailConfirmed: boolean
  /** The verified access token. Never hand it to a page. */
  accessToken: string
}

/** The signed-in Supabase user, or null. Memoized for the duration of a request render. */
export const getNutritionSession = cache(async (): Promise<NutritionSession | null> => {
  const token = (await cookies()).get(AUTH_TOKEN_COOKIE)?.value
  // Fast path: no network call for a missing, malformed or expired token.
  if (!token || isExpired(token)) return null
  return verifySupabaseToken(token)
})

async function verifySupabaseToken(token: string): Promise<NutritionSession | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    // Fail closed: without config nobody can be verified.
    console.error('nutrition session: Supabase env vars missing — denying access')
    return null
  }

  try {
    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await supabase.auth.getUser(token)
    const user = data?.user
    if (error || !user?.id || !user.email) return null
    return { userId: user.id, email: user.email, emailConfirmed: Boolean(user.email_confirmed_at), accessToken: token }
  } catch {
    return null
  }
}
