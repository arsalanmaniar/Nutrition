# MyLearningSphere (CDN-EP)

The Clinical Dietetics & Nutrition E-Portal: e-logbook, evaluation forms (1.1, 1.2,
confidential 1.3, 3.1 MDGRS, weekly check-in), WPBA (Mini-CEX, DOPS, CbD, OSCE), EPA
entrustment, Month 9 SOP/SOPP checklist, MSF 360, remediation, portfolio and
analytics, certificates with public verification, and attendance.

It is a standalone Next.js app with its own Supabase project (database and sign-in) and
its own Vercel project. It shares nothing with the SIUT survey app, which it was split
out of.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Prisma 7 with
`@prisma/adapter-pg` · Supabase Auth (email and password) · Recharts · zod · Vitest.

## Routes

Everything lives under `/nutrition`, and `/` redirects there.

| Path | Who |
|---|---|
| `/nutrition/login` | sign in |
| `/nutrition/trainee/**` | TRAINEE |
| `/nutrition/preceptor/**` | PRECEPTOR |
| `/nutrition/unit-lead/**` | UNIT_LEAD |
| `/nutrition/admin/**` | ADMIN (or a super admin) |
| `/nutrition/msf/[token]` | public, single-use MSF link |
| `/nutrition/verify/[id]` | public certificate check |

Every page checks the caller's role on the server (`requireNutritionRole`).

## Setup

You need Node 20 or later and a Supabase project made for this app only.

1. **Install:** `npm install`. This also runs `prisma generate`.
2. **Environment:** copy `.env.example` to `.env.local` and fill it in. Each variable is
   explained in that file.
3. **Database:** the Prisma CLI does not read `.env` files, so export the connection
   first and then apply the baseline migration once to the EMPTY database. In PowerShell:

   ```powershell
   $env:DIRECT_URL = '<session connection string from Supabase>'
   npx prisma migrate deploy
   npx prisma migrate status
   ```

   `prisma/migrations/0001_baseline` creates every `nutr_*` table, enum, index, CHECK
   constraint and foreign key, the append-only trigger on `nutr_audit_log`, and Row
   Level Security on every table. RLS has no policies, so the Supabase API keys can read
   nothing. The app connects as `postgres`, which bypasses RLS.

   **Never use `prisma db push` or `prisma migrate dev`** against a database with real
   data. Schema changes are new migration files, applied with `migrate deploy`.
4. **First admin:** there is no seed script. In the Supabase dashboard, go to
   Authentication > Users and create a user with a confirmed email. Put that email in
   `NUTRITION_SUPER_ADMIN_EMAILS`, then sign in at `/nutrition/login`. A super admin is
   a nutrition ADMIN and can create everyone else under Admin > People.
5. **Run:** `npm run dev`, then open http://localhost:3000.

## Checks

```bash
npm test           # Vitest unit tests (no database, no network)
npm run typecheck
npm run lint
npm run build
```

On Windows, run the tests from a path with an upper-case drive letter
(`E:\...`, not `e:\...`). Otherwise Vitest loads twice and every file fails with
"failed to find the runner".

## Deploying (Vercel)

- The build command is in `vercel.json`: `npx prisma generate && next build`.
- Set every variable from `.env.example` for Production and Preview. `DIRECT_URL` is
  only needed where migrations run.
- `NUTRITION_AUTHOR_HASH_KEY` must never change once Form 1.3 data exists.

## Privacy rules

- Case logs hold a case code, an age band and a diagnosis category, never patient
  names, MRNs, phone numbers or addresses. Validation rejects identifiers.
- Form 1.3 is confidential. Its author is stored only as a keyed hash, and preceptors and
  admins see aggregates only, from 3 responses up.
- Never commit `.env*`, credentials, database dumps or data exports. `.gitignore`
  covers them.
