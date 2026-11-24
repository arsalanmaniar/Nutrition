'use client'

import { startTransition, useActionState, useRef, type FormEvent, type ReactNode } from 'react'
import { IDLE_RESULT, type ActionResult } from '@/features/nutrition/lib/action-result'
import { LABEL } from './styles'

// Client-side pieces shared by the nutrition admin forms. The class names are
// in styles.ts.

type ServerAction = (previous: ActionResult, formData: FormData) => Promise<ActionResult>

/**
 * Runs a server action from the form's submit event instead of its action
 * prop. React resets a form after every action-prop submission, including one
 * that comes back with a validation error, which would wipe what the admin
 * typed. Here the form is reset only after a success, and only if asked.
 */
export function useServerForm(
  action: ServerAction,
  { resetOnSuccess = false, onSuccess }: { resetOnSuccess?: boolean; onSuccess?: () => void } = {},
) {
  const formRef = useRef<HTMLFormElement>(null)
  const [state, dispatch, pending] = useActionState(async (previous: ActionResult, formData: FormData) => {
    const result = await action(previous, formData)
    if (result.status === 'ok') {
      if (resetOnSuccess) formRef.current?.reset()
      onSuccess?.()
    }
    return result
  }, IDLE_RESULT)

  /** Sends a FormData now; used directly to send one captured before a confirmation. */
  const submit = (formData: FormData) => startTransition(() => dispatch(formData))

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    submit(new FormData(event.currentTarget))
  }

  return { formRef, state, pending, onSubmit, submit }
}

export function FormMessage({ state }: { state: ActionResult }) {
  if (state.status === 'idle') return null
  return state.status === 'ok' ? (
    <p role="status" className="text-sm text-green-700">
      {state.message}
    </p>
  ) : (
    <p role="alert" className="text-sm text-red-600">
      {state.message}
    </p>
  )
}

export function fieldError(state: ActionResult, field: string): string | undefined {
  return state.status === 'error' ? state.fieldErrors?.[field] : undefined
}

/** A field's error under it; give the input aria-describedby={id} when there is one. */
export function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="mt-1 text-xs text-red-600">
      {message}
    </p>
  ) : null
}

/** The props that tie an input to its label's error message. */
export function describedBy(id: string, error: string | undefined) {
  return { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? `${id}-error` : undefined }
}

/** A labelled field with an optional hint and its error. The input inside uses describedBy(id, error). */
export function Field({
  id,
  label,
  error,
  hint,
  className,
  children,
}: {
  id: string
  label: string
  error?: string
  hint?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  )
}
