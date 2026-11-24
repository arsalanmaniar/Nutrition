import 'server-only'
import { createHash, randomBytes } from 'node:crypto'

// MSF link tokens (Step 6c). A link carries 32 random bytes as base64url; only
// their sha256 hash is stored (NutritionMsfInvite.tokenHash), so the database
// never holds a working link. The raw token is shown once, to the preceptor
// who created it, and is never logged or stored.

export const MSF_TOKEN_BYTES = 32

/** A new link token and the hash to store. */
export function newMsfToken(): { token: string; tokenHash: string } {
  const token = randomBytes(MSF_TOKEN_BYTES).toString('base64url')
  return { token, tokenHash: hashMsfToken(token) }
}

/** What is stored for, and looked up by, a raw token. */
export function hashMsfToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}
