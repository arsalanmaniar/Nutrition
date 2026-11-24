import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Test runner for the CDN-EP portal: `npm test`.
//
// Pure unit tests only: nothing here may reach a real database or Supabase.
// Tests mock Prisma and the Supabase client themselves.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Next.js handles 'server-only' internally and the package is not installed.
      'server-only': fileURLToPath(new URL('./src/features/nutrition/server/__tests__/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**'],
    // The super admin allowlist the auth and server tests sign in against.
    env: {
      NUTRITION_SUPER_ADMIN_EMAILS: 'boss@example.test, boss@cdnep.test',
    },
  },
})
