// The MSF (multi-source, 360° feedback) form and its rules (Step 6c).
// Pure data, safe in client and server code.
//
// A preceptor creates single-use links for up to MSF_ASSESSORS_PER_ROUND
// assessors (nurses, physicians, allied staff) in training months 4, 8 and 12,
// the Form 1.2 months. The round is the training month the link was created
// in. Each link works for MSF_LINK_DAYS and only once; the assessor needs no
// login. The preceptor and the trainee see aggregates only, and only once a
// round has MIN_MSF_RESPONSES responses.

export const MSF_FORM_VERSION = 1

/** Training months with an MSF round (the Form 1.2 months). */
export const MSF_ROUND_MONTHS: readonly number[] = [4, 8, 12]

export const MSF_LINK_DAYS = 14
export const MSF_ASSESSORS_PER_ROUND = 5

/** Below this many responses a round's aggregates are hidden (only the count shows). */
export const MIN_MSF_RESPONSES = 3

export const MSF_SCALE = {
  min: 1,
  max: 5,
  anchors: { 1: 'Poor', 2: 'Below expectations', 3: 'Meets expectations', 4: 'Above expectations', 5: 'Excellent' } as Readonly<Record<number, string>>,
} as const

export interface MsfDomain {
  readonly key: string
  readonly label: string
}

/** One 1–5 rating per domain. */
export const MSF_DOMAINS: readonly MsfDomain[] = [
  { key: 'communication', label: 'Communication' },
  { key: 'teamwork', label: 'Teamwork' },
  { key: 'professionalism', label: 'Professionalism' },
  { key: 'interpersonal_skills', label: 'Interpersonal skills' },
]

/** The assessor's profession, stored in NutritionMsfInvite.assessorRole as the key. */
export const MSF_ASSESSOR_ROLES: readonly { readonly key: string; readonly label: string }[] = [
  { key: 'NURSE', label: 'Nurse' },
  { key: 'PHYSICIAN', label: 'Physician' },
  { key: 'ALLIED_HEALTH', label: 'Allied health professional' },
  { key: 'OTHER', label: 'Other staff' },
]

export const MAX_ASSESSOR_NAME = 120
export const MAX_MSF_COMMENT = 2000

/** The rating field for a domain on the public form: rating.<domain key>. */
export const msfRatingField = (key: string) => `rating.${key}`

/** The label for a stored assessor role; an unknown key shows as itself. */
export function assessorRoleLabel(key: string): string {
  return MSF_ASSESSOR_ROLES.find((role) => role.key === key)?.label ?? key
}
