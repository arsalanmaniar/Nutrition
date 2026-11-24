'use client'

import { startTransition, useActionState, useId, type FormEvent } from 'react'
import { MAX_MSF_COMMENT, msfRatingField } from '@/features/nutrition/config/msf'
import { IDLE_RESULT, type ActionResult } from '@/features/nutrition/lib/action-result'
import { PRIVACY_HINT } from '@/features/nutrition/validation/privacy'
import { FieldError, FormMessage, fieldError } from '../admin/form-ui'
import { CARD, INPUT, PRIMARY_BUTTON } from '../admin/styles'

/**
 * The public MSF form (Step 6c UI), for an assessor with no login. It imports
 * no server code: the page passes the public submit action in as `action`.
 * The form shows only the four domains and a comment box, never the
 * trainee's or the assessor's name. After a successful submit it shows the
 * server's thank-you and nothing else; a dead link gets the server's one
 * generic message.
 */
export function PublicMsfForm({
  token,
  domains,
  scale,
  action,
}: {
  token: string
  domains: readonly { key: string; label: string }[]
  scale: { min: number; max: number; anchors: Record<number, string> }
  action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>
}) {
  const [state, dispatch, pending] = useActionState(action, IDLE_RESULT)
  const id = useId()
  const points = Array.from({ length: scale.max - scale.min + 1 }, (_, i) => scale.min + i)

  if (state.status === 'ok') {
    return (
      <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
        {state.message}
      </p>
    )
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    startTransition(() => dispatch(formData))
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <fieldset disabled={pending} className="space-y-4">
        {domains.map((domain) => {
          const name = msfRatingField(domain.key)
          const error = fieldError(state, name)
          return (
            <fieldset key={domain.key} className={CARD} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-${domain.key}-error` : undefined}>
              <legend className="text-base font-semibold text-gray-900">{domain.label}</legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {points.map((point) => (
                  <label
                    key={point}
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm has-[:checked]:border-red-500 has-[:checked]:bg-red-50"
                  >
                    <input type="radio" name={name} value={point} required />
                    <span>
                      {point} · {scale.anchors[point]}
                    </span>
                  </label>
                ))}
              </div>
              <FieldError id={`${id}-${domain.key}-error`} message={error} />
            </fieldset>
          )
        })}

        <section className={CARD} aria-label="Comment">
          <label htmlFor={`${id}-comments`} className="block text-sm font-medium text-gray-800">
            Comment (optional)
          </label>
          <p className="mt-1 text-xs text-gray-500">{PRIVACY_HINT}</p>
          <textarea
            id={`${id}-comments`}
            name="comments"
            dir="auto"
            rows={4}
            maxLength={MAX_MSF_COMMENT}
            aria-invalid={fieldError(state, 'comments') ? true : undefined}
            aria-describedby={fieldError(state, 'comments') ? `${id}-comments-error` : undefined}
            className={`${INPUT} mt-2`}
          />
          <FieldError id={`${id}-comments-error`} message={fieldError(state, 'comments')} />
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={PRIMARY_BUTTON}>
            {pending ? 'Sending…' : 'Send feedback'}
          </button>
          <FormMessage state={state} />
        </div>
      </fieldset>
    </form>
  )
}
