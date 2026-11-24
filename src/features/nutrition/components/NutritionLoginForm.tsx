'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { AUTH_TOKEN_COOKIE, writeAuthCookie } from '@/lib/auth-cookie'
import { cookieHasToken, waitFor } from './auth-cookie-wait'
import { signOutNutrition } from './sign-out'

// The nutrition portal's own sign-in (email + password, the existing supabase-js
// client). `returnTo` was already checked on the server by safeNutritionReturnPath.
//
// The portal's server-side guard reads the auth cookie, not supabase-js's
// localStorage. Navigating before that cookie exists would make the guard see
// "no cookie" and send the person straight back here, in a loop. So after
// signing in, the token is written with the existing helper (the same write
// AuthCookieSync makes), and the page waits until the browser really holds it.
// If it never appears (cookies blocked, say), the person sees an error instead.

const COOKIE_TIMEOUT_MS = 5000

const COOKIE_ERROR =
  'You are signed in, but this browser did not save the session cookie, so the portal cannot see you. ' +
  'Allow cookies for this site and try again.'

type Phase = 'checking' | 'signed-in' | 'form' | 'leaving'

export function NutritionLoginForm({ returnTo }: { returnTo: string }) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [signedInAs, setSignedInAs] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Someone already signed in in this browser (for example, whose token lapsed
  // and the guard sent them here) can continue without retyping the password.
  // It is a button, never an automatic redirect: if the server rejected that
  // session, an automatic redirect would loop.
  useEffect(() => {
    let cancelled = false
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return
        const sessionEmail = data.session?.user.email
        setSignedInAs(sessionEmail ?? null)
        setPhase(sessionEmail ? 'signed-in' : 'form')
      })
      .catch(() => {
        if (!cancelled) setPhase('form')
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function enterPortal(token: string) {
    writeAuthCookie(token)
    const saved = await waitFor(() => cookieHasToken(document.cookie, AUTH_TOKEN_COOKIE, token), COOKIE_TIMEOUT_MS)
    if (!saved) {
      setBusy(false)
      setError(COOKIE_ERROR)
      return
    }
    setPhase('leaving')
    window.location.replace(returnTo)
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (signInError || !data.session) {
        setBusy(false)
        setError(
          signInError?.message === 'Invalid login credentials'
            ? 'Email or password is incorrect.'
            : 'Could not sign in. Please try again.',
        )
        return
      }
      await enterPortal(data.session.access_token)
    } catch {
      setBusy(false)
      setError('Could not reach the sign-in service. Check the connection and try again.')
    }
  }

  async function continueSignedIn() {
    setBusy(true)
    setError(null)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) {
        setBusy(false)
        setPhase('form')
        return
      }
      await enterPortal(token)
    } catch {
      setBusy(false)
      setError('Could not reach the sign-in service. Check the connection and try again.')
    }
  }

  async function switchAccount() {
    setBusy(true)
    // Same sign-out as the portal's button: the stored session and the cookie
    // are cleared even if the network call fails, then this page reloads empty.
    await signOutNutrition()
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center text-center">
          <h1 className="text-xl font-bold text-gray-800">MyLearningSphere</h1>
          <p className="text-sm text-gray-500">Clinical Dietetics &amp; Nutrition E-Portal</p>
        </div>

        {phase === 'checking' && <p className="text-center text-sm text-gray-500">Checking your session…</p>}

        {phase === 'leaving' && <p className="text-center text-sm text-gray-500">Opening the portal…</p>}

        {phase === 'signed-in' && (
          <div className="flex flex-col gap-3">
            <p className="text-center text-sm text-gray-600">
              Signed in as <span className="font-medium text-gray-800">{signedInAs}</span>
            </p>
            <button
              type="button"
              onClick={continueSignedIn}
              disabled={busy}
              className="w-full rounded-lg bg-red-700 py-3 font-bold text-white transition-all duration-150 hover:bg-red-800 active:scale-[0.98] disabled:opacity-50"
            >
              {busy ? 'Opening…' : 'Continue'}
            </button>
            <button
              type="button"
              onClick={switchAccount}
              disabled={busy}
              className="w-full rounded-lg border border-gray-300 bg-white py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
            >
              Use a different account
            </button>
          </div>
        )}

        {phase === 'form' && (
          <form onSubmit={signIn} className="flex flex-col gap-4">
            <div>
              <label htmlFor="nutrition-email" className="mb-1 block text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                id="nutrition-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900 focus:border-red-500"
              />
            </div>
            <div>
              <label htmlFor="nutrition-password" className="mb-1 block text-sm font-medium text-gray-700">
                Password
              </label>
              <input
                id="nutrition-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900 focus:border-red-500"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-red-700 py-3 font-bold text-white transition-all duration-150 hover:bg-red-800 active:scale-[0.98] disabled:opacity-50"
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
