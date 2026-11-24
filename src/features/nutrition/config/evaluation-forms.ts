// Settings for the evaluation forms (Step 4b) that are not part of a form's
// definition in forms.ts. A plain module, safe in client and server code.

/**
 * Form 1.3 results are shown only as aggregates, and only once at least this
 * many trainees have SUBMITTED one about the same preceptor at the same
 * checkpoint (plan, Decisions (Step 4 outcome) item 1: at least 3, raised from
 * Step 4's 2). Below it, a viewer learns the count and nothing else.
 */
export const MIN_FORM_1_3_RESPONSES = 3

/** The longest answer any free-text field of an evaluation form takes, and a weekly review comment. */
export const MAX_FORM_TEXT = 2000

/** Shown at the top of Form 1.3, in the trainee's view only. */
export const FORM_1_3_CONFIDENTIAL_NOTICE =
  'Confidential: your name is not stored with this form. Your preceptor, unit leads and admins see only averages ' +
  `and comments from at least ${MIN_FORM_1_3_RESPONSES} trainees together, never your individual answers.`

/** The name a rating posts under: rating.<item key>. */
export const ratingFieldName = (key: string) => `rating.${key}`

/** The name a free-text answer posts under: text.<field key>. */
export const textFieldName = (key: string) => `text.${key}`
