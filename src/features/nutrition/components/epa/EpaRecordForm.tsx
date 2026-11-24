'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { MillerLevel } from '@prisma/client'
import { MAX_FORM_TEXT } from '@/features/nutrition/config/evaluation-forms'
import { assignEpaLevel } from '@/features/nutrition/server/actions/epa'
import { PRIVACY_HINT } from '@/features/nutrition/validation/privacy'
import { Field, FormMessage, describedBy, fieldError, useServerForm } from '../admin/form-ui'
import { CARD, INPUT, PRIMARY_BUTTON } from '../admin/styles'
import { MILLER_LEVELS, allowedEpaLevels, epaLevelLabel, millerOptionLabel, millerRangeLabel } from './epa-display'

/**
 * Records a new EPA level for one trainee (Step 6b). The level select offers
 * only the levels inside the chosen Miller level's target range
 * (MILLER_EPA_TARGETS); the server action (server/actions/epa.ts) checks the
 * range, the trainee and the caller again, sets the day itself, and its
 * refusal is shown as it is. A recorded level is never edited: a change is a
 * new entry in the history.
 */
export function EpaRecordForm({ traineeId, epas }: { traineeId: string; epas: readonly { key: string; label: string }[] }) {
  const router = useRouter()
  const [miller, setMiller] = useState<MillerLevel | ''>('')
  const { formRef, state, pending, onSubmit } = useServerForm(assignEpaLevel, {
    resetOnSuccess: true,
    onSuccess: () => {
      setMiller('')
      router.refresh()
    },
  })
  const id = useId()
  const error = (name: string) => fieldError(state, name)
  const levels = miller ? allowedEpaLevels(miller) : []

  return (
    <form ref={formRef} onSubmit={onSubmit} className={`${CARD} space-y-4`}>
      <input type="hidden" name="traineeId" value={traineeId} />
      <fieldset disabled={pending} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field id={`${id}-epa`} label="EPA" error={error('epaKey')}>
          <select {...describedBy(`${id}-epa`, error('epaKey'))} name="epaKey" required defaultValue="" className={INPUT}>
            <option value="">Choose an EPA…</option>
            {epas.map((epa) => (
              <option key={epa.key} value={epa.key}>
                {epa.label}
              </option>
            ))}
          </select>
        </Field>

        <Field id={`${id}-miller`} label="Miller level" error={error('millerLevel')}>
          <select
            {...describedBy(`${id}-miller`, error('millerLevel'))}
            name="millerLevel"
            required
            value={miller}
            onChange={(event) => setMiller(event.target.value as MillerLevel | '')}
            className={INPUT}
          >
            <option value="">Choose a Miller level…</option>
            {MILLER_LEVELS.map((level) => (
              <option key={level} value={level}>
                {millerOptionLabel(level)}
              </option>
            ))}
          </select>
        </Field>

        <Field
          id={`${id}-level`}
          label="Entrustment level"
          error={error('level')}
          hint={miller ? `Allowed for this Miller level: ${millerRangeLabel(miller)}.` : 'Choose the Miller level first.'}
        >
          <select
            {...describedBy(`${id}-level`, error('level'))}
            key={miller || 'none'}
            name="level"
            required
            defaultValue=""
            disabled={!miller}
            className={INPUT}
          >
            <option value="">Choose a level…</option>
            {levels.map((level) => (
              <option key={level} value={level}>
                {epaLevelLabel(level)}
              </option>
            ))}
          </select>
        </Field>

        <div className="sm:col-span-3">
          <Field id={`${id}-notes`} label="Notes (optional)" error={error('notes')} hint={PRIVACY_HINT}>
            <textarea
              {...describedBy(`${id}-notes`, error('notes'))}
              name="notes"
              dir="auto"
              rows={3}
              maxLength={MAX_FORM_TEXT}
              className={INPUT}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
          <button type="submit" className={PRIMARY_BUTTON}>
            {pending ? 'Recording…' : 'Record level'}
          </button>
          <p className="text-xs text-gray-500">The date is today, set by the server.</p>
          <FormMessage state={state} />
        </div>
      </fieldset>
    </form>
  )
}
