'use client'

import { useId, useState, type FormEvent } from 'react'
import type { NutritionRole } from '@prisma/client'
import ConfirmModal from '@/components/ui/ConfirmModal'
import { updateProfile } from '@/features/nutrition/server/actions/people'
import { Field, FormMessage, describedBy, fieldError, useServerForm } from './form-ui'
import { CARD, INPUT, PRIMARY_BUTTON } from './styles'
import { ROLE_OPTIONS } from './role-labels'

export interface EditableProfile {
  id: string
  email: string
  fullName: string
  role: NutritionRole
  institution: string | null
  isActive: boolean
}

/**
 * Name, role, institution and status. Deactivating asks first. The server
 * refuses to let an admin lock themselves out or to change someone who still
 * has active assignments; the form only mirrors the first rule so it cannot be
 * picked by accident.
 */
export function ProfileEditForm({ profile, isSelf }: { profile: EditableProfile; isSelf: boolean }) {
  const { formRef, state, pending, submit } = useServerForm(updateProfile)
  const [confirming, setConfirming] = useState<FormData | null>(null)
  const id = useId()
  const ids = { fullName: `${id}-name`, role: `${id}-role`, institution: `${id}-institution`, isActive: `${id}-status` }
  const error = (field: keyof typeof ids) => fieldError(state, field)
  const roleLocked = isSelf && profile.role === 'ADMIN'

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    if (profile.isActive && formData.get('isActive') === 'false') setConfirming(formData)
    else submit(formData)
  }

  return (
    <section className={CARD} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-base font-semibold text-gray-900">
        Details
      </h2>
      <form ref={formRef} onSubmit={onSubmit} className="mt-4 space-y-4">
        <input type="hidden" name="profileId" value={profile.id} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="block text-xs font-medium text-gray-600 mb-1">Email</p>
            <p className="p-2.5 text-sm text-gray-800 break-all">{profile.email}</p>
          </div>
          <Field id={ids.fullName} label="Full name" error={error('fullName')}>
            <input
              {...describedBy(ids.fullName, error('fullName'))}
              name="fullName"
              required
              minLength={2}
              maxLength={120}
              defaultValue={profile.fullName}
              dir="auto"
              autoComplete="off"
              className={INPUT}
            />
          </Field>
          <Field
            id={ids.role}
            label="Role"
            error={error('role')}
            hint={roleLocked ? 'You cannot remove your own admin role.' : undefined}
          >
            {roleLocked && <input type="hidden" name="role" value={profile.role} />}
            <select
              {...describedBy(ids.role, error('role'))}
              name={roleLocked ? undefined : 'role'}
              defaultValue={profile.role}
              disabled={roleLocked}
              className={INPUT}
            >
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id={ids.institution} label="Institution (optional)" error={error('institution')}>
            <input
              {...describedBy(ids.institution, error('institution'))}
              name="institution"
              maxLength={160}
              defaultValue={profile.institution ?? ''}
              dir="auto"
              autoComplete="off"
              className={INPUT}
            />
          </Field>
          <Field
            id={ids.isActive}
            label="Status"
            error={error('isActive')}
            hint={isSelf ? 'You cannot deactivate yourself.' : 'Inactive people cannot sign in to the portal.'}
          >
            {isSelf && <input type="hidden" name="isActive" value="true" />}
            <select
              {...describedBy(ids.isActive, error('isActive'))}
              name={isSelf ? undefined : 'isActive'}
              defaultValue={String(profile.isActive)}
              disabled={isSelf}
              className={INPUT}
            >
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
            {pending ? 'Saving…' : 'Save changes'}
          </button>
          <FormMessage state={state} />
        </div>
      </form>

      {confirming && (
        <ConfirmModal
          title={`Deactivate ${profile.fullName}?`}
          message="They lose access to the nutrition portal at once. Their records stay, and you can reactivate them later."
          confirmLabel="Deactivate"
          onConfirm={() => {
            const formData = confirming
            setConfirming(null)
            submit(formData)
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </section>
  )
}
