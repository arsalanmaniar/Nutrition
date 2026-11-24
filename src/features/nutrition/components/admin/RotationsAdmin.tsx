'use client'

import { useId, useState } from 'react'
import ConfirmModal from '@/components/ui/ConfirmModal'
import { createRotation, renameRotation, setRotationActive } from '@/features/nutrition/server/actions/rotations'
import type { RotationRow } from '@/features/nutrition/server/queries/rotations'
import { Field, FormMessage, describedBy, fieldError, useServerForm } from './form-ui'
import { CARD, INPUT, PRIMARY_BUTTON, SECONDARY_BUTTON } from './styles'

/** Rotations the e-logbook offers: add, rename, retire (never delete). */
export function RotationsAdmin({ rotations }: { rotations: RotationRow[] }) {
  return (
    <div className="space-y-6">
      <AddRotation />
      <section className={`${CARD} !p-0 overflow-hidden`} aria-label="Rotations">
        {rotations.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">No rotations yet. Add the first one above.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rotations.map((rotation) => (
              <RotationItem key={rotation.id} rotation={rotation} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function AddRotation() {
  const { formRef, state, pending, onSubmit } = useServerForm(createRotation, { resetOnSuccess: true })
  const id = useId()
  const inputId = `${id}-name`
  const error = fieldError(state, 'name')

  return (
    <section className={CARD} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-base font-semibold text-gray-900">
        Add a rotation
      </h2>
      <form ref={formRef} onSubmit={onSubmit} className="mt-4 space-y-3">
        <Field id={inputId} label="Name" error={error} hint="e.g. Pediatric Cardiology, Nephrology, Trauma ICU" className="max-w-md">
          <input
            {...describedBy(inputId, error)}
            name="name"
            required
            minLength={2}
            maxLength={80}
            dir="auto"
            autoComplete="off"
            className={INPUT}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
            {pending ? 'Adding…' : 'Add rotation'}
          </button>
          <FormMessage state={state} />
        </div>
      </form>
    </section>
  )
}

function RotationItem({ rotation }: { rotation: RotationRow }) {
  const [editing, setEditing] = useState(false)
  const [asking, setAsking] = useState(false)
  // Which action ran last, so the row shows that one's message.
  const [last, setLast] = useState<'rename' | 'status' | null>(null)
  const {
    formRef: renameRef,
    state: renameState,
    pending: renaming,
    onSubmit: onRename,
  } = useServerForm(renameRotation, { onSuccess: () => setEditing(false) })
  const { state: statusState, pending: savingStatus, submit: submitStatus } = useServerForm(setRotationActive)
  const id = useId()
  const inputId = `${id}-name`
  const renameError = fieldError(renameState, 'name')

  function sendStatus(isActive: boolean) {
    const formData = new FormData()
    formData.set('rotationId', rotation.id)
    formData.set('isActive', String(isActive))
    setLast('status')
    submitStatus(formData)
  }

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        {editing ? (
          <form
            ref={renameRef}
            onSubmit={(event) => {
              setLast('rename')
              onRename(event)
            }}
            className="space-y-2"
          >
            <input type="hidden" name="rotationId" value={rotation.id} />
            <Field id={inputId} label={`New name for ${rotation.name}`} error={renameError} className="max-w-md">
              <input
                {...describedBy(inputId, renameError)}
                name="name"
                required
                minLength={2}
                maxLength={80}
                defaultValue={rotation.name}
                dir="auto"
                autoComplete="off"
                className={INPUT}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" disabled={renaming} className={PRIMARY_BUTTON}>
                {renaming ? 'Saving…' : 'Save'}
              </button>
              <button type="button" disabled={renaming} onClick={() => setEditing(false)} className={SECONDARY_BUTTON}>
                Cancel
              </button>
              {renameState.status === 'error' && <FormMessage state={renameState} />}
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p dir="auto" className={`font-medium ${rotation.isActive ? 'text-gray-900' : 'text-gray-400 line-through'}`}>
              {rotation.name}
            </p>
            {!rotation.isActive && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">Inactive</span>
            )}
          </div>
        )}
        {!editing && last && (
          <div className="mt-1">
            <FormMessage state={last === 'rename' ? renameState : statusState} />
          </div>
        )}
      </div>

      {!editing && (
        <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" onClick={() => setEditing(true)} className={SECONDARY_BUTTON}>
            Rename
          </button>
          <button
            type="button"
            disabled={savingStatus}
            onClick={() => (rotation.isActive ? setAsking(true) : sendStatus(true))}
            className={SECONDARY_BUTTON}
          >
            {savingStatus ? 'Saving…' : rotation.isActive ? 'Deactivate' : 'Reactivate'}
          </button>
        </div>
      )}

      {asking && (
        <ConfirmModal
          title={`Deactivate ${rotation.name}?`}
          message="Trainees can no longer pick it for new case logs. Existing logs keep it, and you can reactivate it later."
          confirmLabel="Deactivate"
          onConfirm={() => {
            setAsking(false)
            sendStatus(false)
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </li>
  )
}
