'use client'

import { startTransition, useActionState, useId, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import ConfirmModal from '@/components/ui/ConfirmModal'
import { MAX_ASSESSOR_NAME, MSF_ASSESSOR_ROLES } from '@/features/nutrition/config/msf'
import { IDLE_RESULT, type ActionResult } from '@/features/nutrition/lib/action-result'
import { createMsfInvite, revokeMsfInvite, type MsfInviteResult } from '@/features/nutrition/server/actions/msf'
import { PRIVACY_HINT } from '@/features/nutrition/validation/privacy'
import { Field, FormMessage, describedBy, fieldError, useServerForm } from '../admin/form-ui'
import { CARD, INPUT, PRIMARY_BUTTON, SECONDARY_BUTTON } from '../admin/styles'
import { MSF_LINK_SHOWN_ONCE, msfLinkUrl } from './msf-display'

/**
 * Creates one MSF link at a time for a trainee (Step 6c UI). The server
 * (server/actions/msf.ts) decides the round, checks the limit and who may ask,
 * and returns the raw token once. The link is shown here, once, with a copy
 * button; after a reload it is gone for good, because only its hash is kept.
 */
export function MsfInviteForm({ traineeId, remaining }: { traineeId: string; remaining: number }) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const id = useId()
  const [state, dispatch, pending] = useActionState(async (previous: ActionResult, formData: FormData): Promise<MsfInviteResult> => {
    const result = await createMsfInvite(previous, formData)
    if (result.status === 'ok' && 'token' in result) {
      setLink(msfLinkUrl(window.location.origin, result.token))
      setCopied(false)
      formRef.current?.reset()
      router.refresh()
      // The token stays only in this component's state, never in the form state.
      return { status: 'ok', message: result.message }
    }
    return result
  }, IDLE_RESULT)
  const error = (name: string) => fieldError(state, name)

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    startTransition(() => dispatch(formData))
  }

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="space-y-3">
      {link && (
        <div role="alert" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">{MSF_LINK_SHOWN_ONCE}</p>
          <div className="flex flex-wrap items-center gap-2">
            <input readOnly value={link} onFocus={(event) => event.currentTarget.select()} className={`${INPUT} font-mono text-xs`} aria-label="New MSF link" />
            <button type="button" onClick={copy} className={SECONDARY_BUTTON}>
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" onClick={() => setLink(null)} className={SECONDARY_BUTTON}>
              Done
            </button>
          </div>
        </div>
      )}

      {remaining === 0 ? (
        <p className="text-sm text-gray-600">This round has 5 open or answered links. Revoke an open one to invite someone else.</p>
      ) : (
        <form ref={formRef} onSubmit={onSubmit} className={`${CARD} space-y-4`}>
          <input type="hidden" name="traineeId" value={traineeId} />
          <fieldset disabled={pending} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id={`${id}-name`} label="Assessor's name" error={error('assessorName')} hint={PRIVACY_HINT}>
              <input
                {...describedBy(`${id}-name`, error('assessorName'))}
                name="assessorName"
                required
                dir="auto"
                maxLength={MAX_ASSESSOR_NAME}
                autoComplete="off"
                className={INPUT}
              />
            </Field>
            <Field id={`${id}-role`} label="Profession" error={error('assessorRole')}>
              <select {...describedBy(`${id}-role`, error('assessorRole'))} name="assessorRole" required defaultValue="" className={INPUT}>
                <option value="">Choose a profession…</option>
                {MSF_ASSESSOR_ROLES.map((role) => (
                  <option key={role.key} value={role.key}>
                    {role.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <button type="submit" className={PRIMARY_BUTTON}>
                {pending ? 'Creating…' : 'Create link'}
              </button>
              <p className="text-xs text-gray-500">{remaining} of 5 places left in this round.</p>
              <FormMessage state={state} />
            </div>
          </fieldset>
        </form>
      )}
    </div>
  )
}

/** Revokes an open link after a confirmation. The server checks it is still open and the caller's. */
export function RevokeInviteButton({ inviteId, assessorName }: { inviteId: string; assessorName: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const { state, pending, submit } = useServerForm(revokeMsfInvite, { onSuccess: () => router.refresh() })
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" disabled={pending} onClick={() => setConfirming(true)} className={SECONDARY_BUTTON}>
        {pending ? 'Revoking…' : 'Revoke'}
      </button>
      {state.status === 'error' && <FormMessage state={state} />}
      {confirming && (
        <ConfirmModal
          title="Revoke this link?"
          message={`The link sent to ${assessorName} will stop working. Its place in the round is freed for someone else.`}
          confirmLabel="Revoke"
          danger
          onConfirm={() => {
            setConfirming(false)
            const formData = new FormData()
            formData.set('inviteId', inviteId)
            submit(formData)
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </span>
  )
}
