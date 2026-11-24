// The e-portfolio, analytics and certificate settings (Step 7). Pure data,
// safe in client and server code.

/** The program named on the certificate and the verify page. */
export const PROGRAM_NAME = 'Clinical Dietetics & Nutrition Training Program'

/** The only credential type issued so far. */
export const COMPLETION_CREDENTIAL = 'COMPLETION'

/** A verification id: 32 random bytes as base64url (43 characters). Anything else is no id. */
export const VERIFICATION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/

/** Program analytics hide any group with fewer people (or Form 1.3 responses) than this. */
export const MIN_GROUP_SIZE = 3

/**
 * PENDING: the module learning goals are not in the spec yet. The portfolio
 * lists these placeholders until the program supplies its own.
 */
export const LEARNING_GOALS: readonly string[] = [
  'Module 1 learning goals (pending)',
  'Module 2 learning goals (pending)',
  'Module 3 learning goals (pending)',
]

/**
 * The research milestones the portfolio shows. No table stores them yet, so
 * each one shows as "Not recorded" until a later step adds storage.
 */
export const RESEARCH_MILESTONES: readonly { readonly key: string; readonly label: string }[] = [
  { key: 'synopsis', label: 'Research synopsis' },
  { key: 'dissertation', label: 'Dissertation' },
]
