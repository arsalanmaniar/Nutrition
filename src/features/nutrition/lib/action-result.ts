// What a nutrition server action returns to the form that called it. Plain
// data, safe for client components to import (no server code, no zod).

export type ActionResult =
  | { status: 'idle' }
  | { status: 'ok'; message: string }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string> }

export const IDLE_RESULT: ActionResult = { status: 'idle' }

export function ok(message: string): ActionResult {
  return { status: 'ok', message }
}

export function fail(message: string, fieldErrors?: Record<string, string>): ActionResult {
  return fieldErrors ? { status: 'error', message, fieldErrors } : { status: 'error', message }
}
