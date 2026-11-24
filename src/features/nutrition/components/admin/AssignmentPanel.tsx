'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import ConfirmModal from '@/components/ui/ConfirmModal'
import { assignPreceptor, endAssignment } from '@/features/nutrition/server/actions/people'
import type { AssignmentRow } from '@/features/nutrition/server/queries/people'
import { Field, FormMessage, describedBy, fieldError, useServerForm } from './form-ui'
import { CARD, INPUT, PRIMARY_BUTTON, SECONDARY_BUTTON } from './styles'

const PEOPLE_HREF = '/nutrition/admin/people'

/** A trainee's primary preceptor: the active assignment, a way to end it, the history. */
export function TraineeAssignments({
  traineeId,
  traineeActive,
  assignments,
  preceptorOptions,
}: {
  traineeId: string
  traineeActive: boolean
  assignments: AssignmentRow[]
  preceptorOptions: { id: string; fullName: string; email: string }[]
}) {
  const id = useId()
  const current = assignments.find((a) => a.active)
  const ended = assignments.filter((a) => !a.active)

  return (
    <section className={CARD} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-base font-semibold text-gray-900">
        Primary preceptor
      </h2>
      {current ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-800">
            <Link href={`${PEOPLE_HREF}/${current.personId}`} className="font-medium text-red-600 hover:text-red-700">
              {current.personName}
            </Link>{' '}
            <span className="text-gray-500">since {current.since}</span>
          </p>
          <EndAssignmentButton assignmentId={current.id} who={current.personName} />
        </div>
      ) : (
        <p className="mt-2 text-sm text-gray-500">No primary preceptor assigned.</p>
      )}

      {!current && traineeActive && <AssignForm traineeId={traineeId} preceptorOptions={preceptorOptions} />}
      {current && (
        <p className="mt-3 text-xs text-gray-500">A trainee has one primary preceptor at a time. End this assignment to assign someone else.</p>
      )}
      {!traineeActive && !current && <p className="mt-2 text-xs text-gray-500">Reactivate this trainee to assign a preceptor.</p>}

      <AssignmentHistory title="Earlier preceptors" rows={ended} />
    </section>
  )
}

/** The trainees a preceptor is (or was) primary preceptor for. Assigning is done from the trainee's page. */
export function PreceptorTrainees({ assignments }: { assignments: AssignmentRow[] }) {
  const id = useId()
  const current = assignments.filter((a) => a.active)
  const ended = assignments.filter((a) => !a.active)

  return (
    <section className={CARD} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-base font-semibold text-gray-900">
        Trainees (as primary preceptor)
      </h2>
      {current.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">No current trainees. Assign this preceptor from a trainee&apos;s page.</p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100">
          {current.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <p className="text-sm text-gray-800">
                <Link href={`${PEOPLE_HREF}/${a.personId}`} className="font-medium text-red-600 hover:text-red-700">
                  {a.personName}
                </Link>{' '}
                <span className="text-gray-500">since {a.since}</span>
              </p>
              <EndAssignmentButton assignmentId={a.id} who={a.personName} />
            </li>
          ))}
        </ul>
      )}
      <AssignmentHistory title="Earlier trainees" rows={ended} />
    </section>
  )
}

function AssignForm({
  traineeId,
  preceptorOptions,
}: {
  traineeId: string
  preceptorOptions: { id: string; fullName: string; email: string }[]
}) {
  const { formRef, state, pending, onSubmit } = useServerForm(assignPreceptor, { resetOnSuccess: true })
  const id = useId()
  const selectId = `${id}-preceptor`
  const error = fieldError(state, 'preceptorId')

  if (preceptorOptions.length === 0) {
    return <p className="mt-3 text-sm text-gray-500">There are no active preceptors yet. Add one on the People page first.</p>
  }
  return (
    <form ref={formRef} onSubmit={onSubmit} className="mt-4 space-y-3">
      <input type="hidden" name="traineeId" value={traineeId} />
      <Field id={selectId} label="Assign a primary preceptor" error={error} className="max-w-md">
        <select {...describedBy(selectId, error)} name="preceptorId" required defaultValue="" className={INPUT}>
          <option value="" disabled>
            Choose a preceptor…
          </option>
          {preceptorOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.fullName} ({p.email})
            </option>
          ))}
        </select>
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
          {pending ? 'Assigning…' : 'Assign'}
        </button>
        <FormMessage state={state} />
      </div>
    </form>
  )
}

/** Ends an assignment (active = false) after a confirmation. The row stays as history. */
function EndAssignmentButton({ assignmentId, who }: { assignmentId: string; who: string }) {
  const { state, pending, submit } = useServerForm(endAssignment)
  const [asking, setAsking] = useState(false)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={pending} onClick={() => setAsking(true)} className={SECONDARY_BUTTON}>
        {pending ? 'Ending…' : 'End assignment'}
      </button>
      {state.status === 'error' && <FormMessage state={state} />}
      {asking && (
        <ConfirmModal
          title="End this assignment?"
          message={`${who} stops being primary preceptor for this pairing. The assignment is kept as history; earlier forms stay attributed to it.`}
          confirmLabel="End assignment"
          onConfirm={() => {
            setAsking(false)
            const formData = new FormData()
            formData.set('assignmentId', assignmentId)
            submit(formData)
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </div>
  )
}

function AssignmentHistory({ title, rows }: { title: string; rows: AssignmentRow[] }) {
  if (rows.length === 0) return null
  return (
    <div className="mt-4 border-t border-gray-100 pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</p>
      <ul className="mt-2 space-y-1">
        {rows.map((a) => (
          <li key={a.id} className="text-sm text-gray-700">
            <Link href={`${PEOPLE_HREF}/${a.personId}`} className="hover:underline">
              {a.personName}
            </Link>{' '}
            <span className="text-gray-500">
              {a.since} to {a.endedOn}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
