'use client'

import { useId, useState } from 'react'
import type { NutritionRole } from '@prisma/client'
import { createProfileWithAccount, linkProfile } from '@/features/nutrition/server/actions/people'
import { Field, FormMessage, describedBy, fieldError, useServerForm } from './form-ui'
import { CARD, INPUT, PRIMARY_BUTTON } from './styles'
import { ROLE_OPTIONS } from './role-labels'

type Mode = 'link' | 'create'

/**
 * Adds a person to the portal. "Link" gives an existing, confirmed Supabase
 * account a profile. "Create" makes the account and the profile together and
 * is offered only when the server has a real service-role key: the page passes
 * in a boolean, the key itself never leaves the server.
 */
export function AddPerson({ canCreateAccounts }: { canCreateAccounts: boolean }) {
  const [mode, setMode] = useState<Mode>('link')
  const tab = (value: Mode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      aria-pressed={mode === value}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
        mode === value ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {label}
    </button>
  )

  return (
    <section className={CARD} aria-labelledby="add-person-title">
      <h2 id="add-person-title" className="text-base font-semibold text-gray-900">
        Add a person
      </h2>
      {canCreateAccounts ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {tab('link', 'Link an existing account')}
          {tab('create', 'Create a new account')}
        </div>
      ) : (
        <p className="mt-1 text-sm text-gray-500">
          Creating sign-in accounts is switched off on this server (no Supabase service-role key), so you can only
          link an account that already exists. Create the account in Supabase first, then link it here by its email.
        </p>
      )}
      <NewPersonForm key={mode} mode={canCreateAccounts ? mode : 'link'} />
    </section>
  )
}

function NewPersonForm({ mode }: { mode: Mode }) {
  const [role, setRole] = useState<NutritionRole | ''>('')
  const { formRef, state, pending, onSubmit } = useServerForm(mode === 'link' ? linkProfile : createProfileWithAccount, {
    resetOnSuccess: true,
    onSuccess: () => setRole(''),
  })
  const id = useId()
  const ids = {
    email: `${id}-email`,
    fullName: `${id}-name`,
    role: `${id}-role`,
    institution: `${id}-institution`,
    trainingStartDate: `${id}-start`,
    password: `${id}-password`,
  }
  const error = (field: keyof typeof ids) => fieldError(state, field)

  return (
    <form ref={formRef} onSubmit={onSubmit} className="mt-4 space-y-4">
      {mode === 'link' && (
        <p className="text-sm text-gray-600">
          Enter the email of a confirmed Supabase account. That account then signs in to the portal in the role you pick.
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id={ids.email} label="Email" error={error('email')}>
          <input
            {...describedBy(ids.email, error('email'))}
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="off"
            className={INPUT}
          />
        </Field>
        <Field id={ids.fullName} label="Full name" error={error('fullName')}>
          <input
            {...describedBy(ids.fullName, error('fullName'))}
            name="fullName"
            required
            minLength={2}
            maxLength={120}
            dir="auto"
            autoComplete="off"
            className={INPUT}
          />
        </Field>
        <Field id={ids.role} label="Role" error={error('role')}>
          <select
            {...describedBy(ids.role, error('role'))}
            name="role"
            required
            value={role}
            onChange={(event) => setRole(event.target.value as NutritionRole | '')}
            className={INPUT}
          >
            <option value="">Choose a role…</option>
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
            dir="auto"
            autoComplete="off"
            className={INPUT}
          />
        </Field>
        {role === 'TRAINEE' && (
          <Field
            id={ids.trainingStartDate}
            label="Training start date (optional)"
            error={error('trainingStartDate')}
            hint="Can be set later, until the trainee's first evaluation form exists."
          >
            <input
              {...describedBy(ids.trainingStartDate, error('trainingStartDate'))}
              name="trainingStartDate"
              type="date"
              className={INPUT}
            />
          </Field>
        )}
        {mode === 'create' && (
          <Field
            id={ids.password}
            label="Initial password"
            error={error('password')}
            hint="At least 8 characters and at most 72 bytes (fewer characters with non-English letters or emoji). Give it to the person privately."
          >
            <input
              {...describedBy(ids.password, error('password'))}
              name="password"
              type="password"
              required
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
              className={INPUT}
            />
          </Field>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
          {pending ? 'Saving…' : mode === 'link' ? 'Link account' : 'Create account'}
        </button>
        <FormMessage state={state} />
      </div>
    </form>
  )
}
