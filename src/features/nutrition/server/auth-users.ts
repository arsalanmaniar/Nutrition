import 'server-only'
import { prisma } from '@/lib/prisma'

// Finds the Supabase sign-in account for an email, for "link existing account".
//
// Supabase keeps accounts in auth.users, which the app's database role can read
// (checked read-only against the live database on 2026-10-11). Only accounts
// that can really sign in are linkable: email confirmed, not deleted, not
// anonymous, not currently banned. The query is parameterised; `email` is
// already trimmed and lower-cased by the caller's zod schema.

export async function findLinkableAuthUser(email: string): Promise<{ id: string } | 'none' | 'ambiguous'> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id
      FROM auth.users
     WHERE lower(email) = ${email}
       AND email_confirmed_at IS NOT NULL
       AND deleted_at IS NULL
       AND is_anonymous IS NOT TRUE
       AND (banned_until IS NULL OR banned_until < now())`
  if (rows.length === 0) return 'none'
  if (rows.length > 1) return 'ambiguous'
  return { id: rows[0].id }
}
