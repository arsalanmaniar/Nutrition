// Patient-identifier check for free text in the nutrition module. The
// e-logbook runs it on every free-text value of a case log, in the zod schemas
// of validation/case-logs.ts.
//
// BEST-EFFORT ONLY. It recognises identifiers that have a shape: phone numbers,
// CNIC numbers, email addresses, web addresses, and long ID numbers such as an
// MRN. It cannot recognise a patient's name or address, and anyone determined
// can write a number out in words. The hint on the form (PRIVACY_HINT) and the
// trainee's own care have to do the rest.
//
// The REAL check is the server-side zod validation that calls this function.
// The browser only shows what the server reports, so a modified client cannot
// skip it.
//
// It errs towards refusing, so some clinical text is caught too. The message
// says how to rewrite it:
//  - a range written with a dash, e.g. 1800-2000: write "1800 to 2000";
//  - a date written with dashes, e.g. 2026-10-11: write "11 Oct";
//  - a large value, e.g. 250000: write "250,000".

export const PRIVACY_HINT = 'Do not enter patient names, MRN, phone or address.'

export type IdentifierKind = 'email' | 'url' | 'cnic' | 'phone' | 'long_number'

export interface IdentifierMatch {
  kind: IdentifierKind
  /** The text that matched (after normalising, see below), shortened if long. */
  text: string
  /** What to tell the person who typed it. */
  message: string
}

// Characters a phone number may have between its digits: any horizontal space
// (not a line break), a hyphen or a dash. Not brackets, dots, slashes or
// commas, so "Na 135 (135-145)", "Hb 10.5", "BP 120/80" and "250,000" pass.
const SEPARATOR = '[\\p{Zs}\\t\\-\\u2010-\\u2015\\u2212]'

// The address must end in a dot and 2 or more letters, so "protein@1.2g/kg" is not one.
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/u
const WEB_ADDRESS = /(?:\b(?:https?|ftp):\/\/|\bwww\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|edu|gov|pk|info)\b\S*/iu
// 13 digits shaped 5-7-1, as in 42101-1234567-1; the dashes (or spaces) are optional.
const CNIC = new RegExp(`(?<!\\p{Nd})\\p{Nd}{5}${SEPARATOR}?\\p{Nd}{7}${SEPARATOR}?\\p{Nd}(?!\\p{Nd})`, 'u')
// Digits, possibly with up to three separators between each two.
const DIGIT_RUN = new RegExp(`\\p{Nd}(?:${SEPARATOR}{0,3}\\p{Nd})*`, 'gu')
const HAS_SEPARATOR = new RegExp(SEPARATOR, 'u')
const LONG_NUMBER = /\p{Nd}{6,}/u

const MESSAGES: Record<IdentifierKind, (text: string) => string> = {
  email: (text) => `"${text}" looks like an email address. Remove it.`,
  url: (text) => `"${text}" looks like a web address. Remove it.`,
  cnic: (text) => `"${text}" looks like a CNIC number. Remove it.`,
  phone: (text) =>
    `"${text}" looks like a phone number. Remove it. A range or a date can be written another way, e.g. "1800 to 2000" or "11 Oct".`,
  long_number: (text) =>
    `"${text}" looks like an MRN or other ID number (6 or more digits in a row). Remove it. A large value can be written with commas, e.g. 250,000.`,
}

/**
 * The first patient identifier found in `text`, or null. Checked in this
 * order, so the message names the most specific kind: email address, web
 * address, CNIC number, phone number (7 or more digits with separators), then
 * any run of 6 or more digits (an MRN, or a phone number typed without
 * separators).
 */
export function findPatientIdentifier(text: string): IdentifierMatch | null {
  // Full-width characters become plain ones (０３００ → 0300, ＠ → @), and
  // invisible formatting characters (zero-width spaces, soft hyphens) are
  // dropped, so neither can be used to slip a number past the patterns.
  const normal = text.normalize('NFKC').replace(/\p{Cf}/gu, '')

  const email = normal.includes('@') ? EMAIL.exec(normal) : null
  if (email) return found('email', email[0])
  const url = WEB_ADDRESS.exec(normal)
  if (url) return found('url', url[0])
  const cnic = CNIC.exec(normal)
  if (cnic) return found('cnic', cnic[0])
  for (const [run] of normal.matchAll(DIGIT_RUN)) {
    if (HAS_SEPARATOR.test(run) && (run.match(/\p{Nd}/gu) ?? []).length >= 7) return found('phone', run)
  }
  const long = LONG_NUMBER.exec(normal)
  if (long) return found('long_number', long[0])
  return null
}

function found(kind: IdentifierKind, matched: string): IdentifierMatch {
  const text = matched.length > 40 ? `${matched.slice(0, 39)}…` : matched
  return { kind, text, message: MESSAGES[kind](text) }
}
