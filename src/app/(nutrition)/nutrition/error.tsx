'use client'

import Link from 'next/link'

// The nutrition module's error page (plan: Decisions, Step 3d outcome, item 5).
// It shows nothing about the error: no message, no stack, no digest. The props
// Next.js passes (error, unstable_retry, reset) are deliberately not read. The
// full error stays in the server logs.
export default function NutritionError() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-xl">
        <h1 className="text-xl font-bold text-gray-800">Something went wrong</h1>
        <p className="mt-2 text-sm text-gray-500">
          This page could not be shown. Please try again in a moment. If it keeps happening, contact the program
          administrator.
        </p>
        <Link
          href="/nutrition"
          className="mt-6 block w-full rounded-lg bg-red-700 py-3 font-bold text-white transition hover:bg-red-800"
        >
          Back to home
        </Link>
      </div>
    </div>
  )
}
