import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorHashKeyError, MIN_KEY_LENGTH, authorHash, trainee1_3Hashes } from '../author-hash'

// A fake key for the tests, exactly 32 characters. Never a real one.
const KEY = 'cdn-ep-test-key-0123456789abcdef'
const TRAINEE = '11111111-1111-4111-8111-111111111111'
const PRECEPTOR = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'

const hmac = (key: string, text: string) => createHmac('sha256', key).update(text).digest('hex')

beforeEach(() => {
  vi.stubEnv('NUTRITION_AUTHOR_HASH_KEY', KEY)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('authorHash', () => {
  it('is HMAC-SHA256 with NUTRITION_AUTHOR_HASH_KEY over "author|subject|point", in hex', () => {
    expect(authorHash(TRAINEE, PRECEPTOR, 'M04')).toBe(hmac(KEY, `${TRAINEE}|${PRECEPTOR}|M04`))
  })

  it('matches fixed vectors, so neither the input nor the algorithm can drift', () => {
    expect(authorHash(TRAINEE, PRECEPTOR, 'M04')).toBe('95f75408d7f887f3a86d9f4a6363653a096fb9b48b70829c439063406a9ae124')
    expect(authorHash(TRAINEE, PRECEPTOR, 'M08')).toBe('b9ed9d246c6f165a9348c3522a9fd62f24291322d196b12328c00ed9fbc3e2f9')
    expect(authorHash(TRAINEE, PRECEPTOR, 'M12')).toBe('8021a0b72713ab5f5f51b2e71cd64879e5eb918f3ea647ec33c4ab356a30ffe8')
  })

  it('changes with every part: author, subject, checkpoint and key; order matters', () => {
    const base = authorHash(TRAINEE, PRECEPTOR, 'M04')
    const variants = [
      authorHash(OTHER, PRECEPTOR, 'M04'),
      authorHash(TRAINEE, OTHER, 'M04'),
      authorHash(TRAINEE, PRECEPTOR, 'M08'),
      authorHash(PRECEPTOR, TRAINEE, 'M04'),
    ]
    vi.stubEnv('NUTRITION_AUTHOR_HASH_KEY', `${KEY}-another`)
    variants.push(authorHash(TRAINEE, PRECEPTOR, 'M04'))
    expect(new Set([base, ...variants]).size).toBe(6)
  })

  it('reads the key on every call (nothing cached at import)', () => {
    vi.stubEnv('NUTRITION_AUTHOR_HASH_KEY', 'k'.repeat(MIN_KEY_LENGTH))
    expect(authorHash(TRAINEE, PRECEPTOR, 'M04')).toBe(hmac('k'.repeat(MIN_KEY_LENGTH), `${TRAINEE}|${PRECEPTOR}|M04`))
  })

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['31 characters', 'k'.repeat(MIN_KEY_LENGTH - 1)],
  ])('fails closed when the key is %s: throws, returns no hash', (_label, key) => {
    vi.stubEnv('NUTRITION_AUTHOR_HASH_KEY', key)
    expect(() => authorHash(TRAINEE, PRECEPTOR, 'M04')).toThrow(AuthorHashKeyError)
    expect(() => trainee1_3Hashes(TRAINEE, PRECEPTOR)).toThrow(AuthorHashKeyError)
  })

  it('the error names the variable but never contains the key', () => {
    vi.stubEnv('NUTRITION_AUTHOR_HASH_KEY', 'secret-but-too-short')
    expect(() => authorHash(TRAINEE, PRECEPTOR, 'M04')).toThrow(/NUTRITION_AUTHOR_HASH_KEY/)
    try {
      authorHash(TRAINEE, PRECEPTOR, 'M04')
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('secret-but-too-short')
    }
  })

  it('a key of exactly 32 characters is enough', () => {
    expect(KEY).toHaveLength(MIN_KEY_LENGTH)
    expect(authorHash(TRAINEE, PRECEPTOR, 'M04')).toMatch(/^[0-9a-f]{64}$/)
  })

  it.each([
    ['an author id with "|"', `${TRAINEE}|x`, PRECEPTOR, 'M04'],
    ['a subject id with "|"', TRAINEE, `x|${PRECEPTOR}`, 'M04'],
    ['an empty author id', '', PRECEPTOR, 'M04'],
    ['an empty subject id', TRAINEE, '', 'M04'],
    ['a month that is not a checkpoint', TRAINEE, PRECEPTOR, 'M05'],
    ['a weekly point', TRAINEE, PRECEPTOR, 'W04'],
    ['a malformed point', TRAINEE, PRECEPTOR, 'M4'],
  ])('refuses %s', (_label, author, subject, point) => {
    expect(() => authorHash(author, subject, point)).toThrow()
  })
})

describe('trainee1_3Hashes', () => {
  it("is the trainee's hashes about this preceptor at M04, M08 and M12, in that order", () => {
    expect(trainee1_3Hashes(TRAINEE, PRECEPTOR)).toEqual([
      hmac(KEY, `${TRAINEE}|${PRECEPTOR}|M04`),
      hmac(KEY, `${TRAINEE}|${PRECEPTOR}|M08`),
      hmac(KEY, `${TRAINEE}|${PRECEPTOR}|M12`),
    ])
  })

  it("never matches another trainee's hashes", () => {
    const mine = trainee1_3Hashes(TRAINEE, PRECEPTOR)
    for (const hash of trainee1_3Hashes(OTHER, PRECEPTOR)) expect(mine).not.toContain(hash)
  })
})

describe('author-hash.ts stays on the server', () => {
  it("its first statement is import 'server-only'", () => {
    const file = new URL('../author-hash.ts', import.meta.url)
    const first = ts.createSourceFile('author-hash.ts', readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true).statements[0]
    expect(first && ts.isImportDeclaration(first) && !first.importClause && (first.moduleSpecifier as ts.StringLiteral).text).toBe('server-only')
  })
})
