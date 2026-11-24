'use client'

import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { writeAuthCookie, clearAuthCookie } from '@/lib/auth-cookie'

// Keeps the auth cookie that the portal's session reads in step with the
// supabase-js session. See src/lib/auth-cookie.ts for why the token is
// mirrored into a cookie rather than replacing supabase-js's storage.
//
// Renders nothing. NutritionRoot mounts it on every /nutrition page. Mounting
// it writes a cookie for a session that predates it, so nobody is stuck
// signing in again.

export default function AuthCookieSync() {
  useEffect(() => {
    // Cover the existing session eagerly; onAuthStateChange also emits
    // INITIAL_SESSION, but this avoids a first-paint gap.
    supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token
      if (token) writeAuthCookie(token)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.access_token) {
        // Covers SIGNED_IN, INITIAL_SESSION, TOKEN_REFRESHED and USER_UPDATED.
        // TOKEN_REFRESHED matters most: supabase-js rotates the access token
        // roughly hourly, and the cookie must not go stale behind it.
        writeAuthCookie(session.access_token)
      } else if (event === 'SIGNED_OUT') {
        clearAuthCookie()
      }
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  return null
}
