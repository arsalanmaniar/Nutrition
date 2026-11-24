import type { EpaLevel } from '@prisma/client'

// Display helpers for the remediation screens (Step 6c UI). Pure data and
// functions, safe in client and server components. The server actions check
// every rule again.

export type Outcome = 'IN_PROGRESS' | 'MET' | 'NOT_MET'

export const OUTCOMES: readonly Outcome[] = ['IN_PROGRESS', 'MET', 'NOT_MET']

export const OUTCOME_LABELS: Readonly<Record<Outcome, string>> = {
  IN_PROGRESS: 'In progress',
  MET: 'Met',
  NOT_MET: 'Not met',
}

/** The label for a stored outcome; anything else shows as "Not set". */
export function outcomeLabel(outcome: string | null): string {
  return outcome && outcome in OUTCOME_LABELS ? OUTCOME_LABELS[outcome as Outcome] : 'Not set'
}

/** "EPA 1 (pending): E2 → E3", with a dash for a level not recorded. */
export function epaChangeText(epa: { label: string; before: EpaLevel | null; after: EpaLevel | null } | null): string | null {
  if (!epa) return null
  return `${epa.label}: ${epa.before ?? '—'} → ${epa.after ?? '—'}`
}

/** The WPBAs the picker offers for a step: filed after the step was created (the server checks again). */
export function linkableWpbas<T extends { filedAt: string }>(options: readonly T[], stepCreatedAt: string): T[] {
  return options.filter((option) => option.filedAt > stepCreatedAt)
}

export const REMEDIATION_EPA_NOTE =
  'Completing a step does not record an EPA level. Record a new level on the EPA page; the step then shows the level before and after.'
