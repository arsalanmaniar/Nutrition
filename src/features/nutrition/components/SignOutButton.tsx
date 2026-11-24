'use client'

import { useState } from 'react'
import ConfirmModal from '@/components/ui/ConfirmModal'
import { signOutNutrition } from './sign-out'

// Signs this browser out and reloads the login page. signOutNutrition clears
// the auth cookie and supabase-js's stored session even when the network call
// fails, so a failed sign-out cannot leave the portal open (see sign-out.ts).
export function SignOutButton({ confirm = false, className }: { confirm?: boolean; className?: string }) {
  const [asking, setAsking] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  async function signOut() {
    setSigningOut(true)
    await signOutNutrition()
  }

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={signingOut}
        onClick={() => (confirm ? setAsking(true) : void signOut())}
      >
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
      {asking && (
        <ConfirmModal
          title="Sign out?"
          message="You will need your email and password to sign in again."
          confirmLabel="Sign out"
          danger={false}
          onConfirm={() => {
            setAsking(false)
            void signOut()
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </>
  )
}
