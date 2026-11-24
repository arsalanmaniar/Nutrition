import { describe, expect, it } from 'vitest'
import { PRIVACY_HINT, findPatientIdentifier, type IdentifierKind } from '../privacy'

// The patient-identifier check, case by case. It is best-effort by design (see
// privacy.ts); these cases pin down what it catches, what it lets through, and
// the clinical text it catches on purpose because it has an identifier's shape.

const REFUSED: [label: string, text: string, kind: IdentifierKind][] = [
  ['mobile number with a dash', 'Mother reachable on 0300-1234567', 'phone'],
  ['mobile number with a space', 'call 0321 7654321 after 5', 'phone'],
  ['international number, spaced', 'Son: +92 300 1234567', 'phone'],
  ['international number, dashed', '+92-345-1234567', 'phone'],
  ['landline with the area code in brackets', 'Home (021) 3456 7890', 'phone'],
  ['landline, dashed', 'Tel 021-34567890', 'phone'],
  ['number spread out with spaced dashes', '0300 - 123 - 4567', 'phone'],
  ['mobile number typed as one number', 'ph 03001234567', 'long_number'],
  ['MRN-like, 6 digits', 'MRN 123456', 'long_number'],
  ['7 digits in a row', 'file 1234567', 'long_number'],
  ['CNIC with dashes', 'CNIC 42101-1234567-1', 'cnic'],
  ['CNIC as one number', '4210112345671', 'cnic'],
  ['CNIC with spaces', '42101 1234567 1', 'cnic'],
  ['email address', 'Email ali.khan@gmail.com for reports', 'email'],
  ['email address on a .pk domain', 'reports to someone@hospital.org.pk', 'email'],
  ['https address', 'see https://example.com/patients/77', 'url'],
  ['www address', 'photo on www.facebook.com/ali', 'url'],
  ['bare domain', 'uploaded to drive.google.com', 'url'],
  ['bare .pk domain', 'from hospital.org.pk', 'url'],
  ['Urdu digits', 'نمبر ۰۳۰۰۱۲۳۴۵۶۷', 'long_number'],
  ['Arabic-Indic digits', 'phone ٠٣٠٠١٢٣٤٥٦٧', 'long_number'],
  ['full-width digits with a dash', '０３００-１２３４５６７', 'phone'],
  ['full-width @', 'ali＠gmail.com', 'email'],
  ['a zero-width space inside a number', '0300​1234567', 'long_number'],
  ['a soft hyphen inside a number', '1234­567', 'long_number'],
  // Not identifiers, but with an identifier's shape: refused on purpose, and
  // the message says how to write them instead.
  ['a range with a dash (write "1800 to 2000")', 'Energy 1800-2000 kcal/day', 'phone'],
  ['a date with dashes (write "11 Oct")', 'Seen 2026-10-11', 'phone'],
  ['a large value without commas (write "250,000")', 'Platelets 250000', 'long_number'],
]

const ALLOWED: [label: string, text: string][] = [
  ['anthropometry', 'Weight 72.5 kg, height 165 cm, BMI 26.6'],
  ['blood pressure and heart rate', 'BP 130/85 mmHg, HR 88'],
  ['lab values with ranges in brackets', 'Na 135 (135-145), K 5.2 (3.5-5.1)'],
  ['energy and protein targets', 'Energy 1800 to 2000 kcal/day; protein 1.2 g/kg/day'],
  ['glycaemic control', 'HbA1c 8.2%, fasting glucose 9.4 mmol/L'],
  ['renal function', 'eGFR 22 mL/min/1.73m², CKD stage 4'],
  ['fluids and dialysis', 'Fluid restriction 1.5 L/day; haemodialysis 3x/week'],
  ['tube feeding', 'Enteral feed at 60 mL/h for 20 h'],
  ['a date with slashes', 'Reviewed 12/10/2026'],
  ['large values with commas', 'Vitamin D 50,000 IU weekly; platelets 250,000'],
  ['a short list of numbers', 'Weights 72 71 70 kg'],
  ['@ used for a rate', 'Protein @ 1.2 g/kg; protein@1.2g/kg'],
  ['clock times', 'NPO from 0600, review at 1400'],
  ['ward and bed', 'Ward 7, bed 12'],
  ['a guideline reference', 'Per ASPEN 2022 guidance, p. 12'],
  ['abbreviations with dots', 'e.g. low-potassium diet, i.e. < 2 g/day; Inj. co-amoxiclav'],
  ['Urdu text', 'مریض کو کم نمک والی غذا دی گئی'],
  ['5 digits in a row', 'Steps 10000 a day'],
  ['empty', ''],
]

describe('findPatientIdentifier', () => {
  it('has at least 15 cases each way', () => {
    expect(REFUSED.length).toBeGreaterThanOrEqual(15)
    expect(ALLOWED.length).toBeGreaterThanOrEqual(15)
  })

  it.each(REFUSED)('refuses %s', (_label, text, kind) => {
    expect(findPatientIdentifier(text)).toMatchObject({ kind })
  })

  it.each(ALLOWED)('allows %s', (_label, text) => {
    expect(findPatientIdentifier(text)).toBeNull()
  })

  it('names what it found and says what to do', () => {
    expect(findPatientIdentifier('Mother reachable on 0300-1234567')).toEqual({
      kind: 'phone',
      text: '0300-1234567',
      message:
        '"0300-1234567" looks like a phone number. Remove it. A range or a date can be written another way, e.g. "1800 to 2000" or "11 Oct".',
    })
    expect(findPatientIdentifier('MRN 123456')?.message).toBe(
      '"123456" looks like an MRN or other ID number (6 or more digits in a row). Remove it. A large value can be written with commas, e.g. 250,000.',
    )
    expect(findPatientIdentifier('CNIC 42101-1234567-1')?.message).toBe('"42101-1234567-1" looks like a CNIC number. Remove it.')
    expect(findPatientIdentifier('Email ali.khan@gmail.com')?.message).toBe('"ali.khan@gmail.com" looks like an email address. Remove it.')
    expect(findPatientIdentifier('see www.example.com')?.message).toBe('"www.example.com" looks like a web address. Remove it.')
  })

  it('shortens a long match in the message', () => {
    const found = findPatientIdentifier(`https://example.com/${'x'.repeat(100)}`)
    expect(found?.text).toHaveLength(40)
    expect(found?.text.endsWith('…')).toBe(true)
  })

  it('finds an identifier anywhere in a long text', () => {
    const notes = `${'Patient tolerating oral diet well. '.repeat(50)}Daughter: 0300-1234567.`
    expect(findPatientIdentifier(notes)).toMatchObject({ kind: 'phone', text: '0300-1234567' })
  })

  it('the form hint names what not to enter', () => {
    expect(PRIVACY_HINT).toBe('Do not enter patient names, MRN, phone or address.')
  })
})
