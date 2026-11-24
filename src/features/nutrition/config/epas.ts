// The program's EPAs (Entrustable Professional Activities), for the EPA
// entrustment dashboard (Step 6a).
//
// PENDING: the spec does not list the program's EPAs yet. These five
// placeholders let the dashboard work end to end; replace the labels (and add
// or remove entries) once the program supplies its list. The KEY is what
// NutritionEpaAssessment.epaName stores, so never rename a key that has rows:
// add a new one instead.
//
// The server accepts only these keys, so epaName is a controlled value, never
// free text.

export interface EpaDefinition {
  readonly key: string
  readonly label: string
}

export const EPA_LIST: readonly EpaDefinition[] = [
  { key: 'EPA_01', label: 'EPA 1 (pending)' },
  { key: 'EPA_02', label: 'EPA 2 (pending)' },
  { key: 'EPA_03', label: 'EPA 3 (pending)' },
  { key: 'EPA_04', label: 'EPA 4 (pending)' },
  { key: 'EPA_05', label: 'EPA 5 (pending)' },
]

export const EPA_LIST_PENDING = "Placeholder EPAs; replace with the program's own list"

export const EPA_KEYS: readonly string[] = EPA_LIST.map((epa) => epa.key)

/** The label for a stored EPA key; an unknown (retired) key shows as itself. */
export function epaLabel(key: string): string {
  return EPA_LIST.find((epa) => epa.key === key)?.label ?? key
}
