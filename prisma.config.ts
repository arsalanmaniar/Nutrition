import { defineConfig } from 'prisma/config'

// Prisma CLI configuration (generate, migrate). The app itself connects through
// src/lib/prisma.ts with DATABASE_URL.
//
// Migrations need a session connection, so the CLI prefers DIRECT_URL (the
// Supabase direct or session-pooler URL) and falls back to DATABASE_URL.
// The CLI does not load .env files: export the variables in your shell first.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '',
  },
})
