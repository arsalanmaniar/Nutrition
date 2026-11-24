import 'server-only'
import { prisma } from '@/lib/prisma'
import { PROGRAM_NAME, VERIFICATION_ID_PATTERN } from '@/features/nutrition/config/portfolio'

// The PUBLIC certificate check behind /nutrition/verify/[id] (Step 7).
// Deliberately unguarded, and kept in server/public with the MSF form
// (portal-guard-coverage.test.ts checks this folder never imports the guard,
// and that this file queries only NutritionCredential, by verificationId).
// It is a plain server-only loader, not a server action.
//
// It returns exactly four fields: the holder's name, the program, the issue
// date and valid/revoked. An unknown or malformed id gets null, and the page
// shows one generic message.

export interface CredentialVerification {
  name: string
  program: string
  issuedOn: string
  status: 'VALID' | 'REVOKED'
}

/** The four public facts of a credential, or null. */
export async function getCredentialVerification(verificationId: string): Promise<CredentialVerification | null> {
  if (!VERIFICATION_ID_PATTERN.test(verificationId)) return null
  const row = await prisma.nutritionCredential.findUnique({
    where: { verificationId },
    select: { issuedAt: true, revokedAt: true, trainee: { select: { fullName: true } } },
  })
  if (!row) return null
  return {
    name: row.trainee.fullName,
    program: PROGRAM_NAME,
    issuedOn: row.issuedAt.toISOString().slice(0, 10),
    status: row.revokedAt ? 'REVOKED' : 'VALID',
  }
}
