import type { ReactNode } from 'react'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { NUTRITION_ROLES, navFor } from '@/features/nutrition/components/navigation'
import { PortalShell } from '@/features/nutrition/components/PortalShell'

// Renders the sidebar for whoever is signed in. This layout is NOT the guard:
// layouts do not re-render on client-side navigation, so every page.tsx below
// calls requireNutritionRole itself (portal-guard-coverage.test.ts enforces it).
export default async function NutritionPortalLayout({ children }: { children: ReactNode }) {
  const access = await requireNutritionRole(NUTRITION_ROLES)
  return (
    <PortalShell
      sections={navFor(access.roles)}
      userName={access.profile?.fullName ?? access.email}
      userEmail={access.email}
    >
      {children}
    </PortalShell>
  )
}
