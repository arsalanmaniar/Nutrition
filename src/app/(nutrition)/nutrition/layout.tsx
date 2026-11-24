import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { NutritionRoot } from '@/features/nutrition/components/NutritionRoot'

export const metadata: Metadata = {
  title: 'MyLearningSphere',
  description: 'Clinical Dietetics & Nutrition E-Portal',
}

// Wraps every /nutrition page, the public ones included. NutritionRoot mounts
// AuthCookieSync (which keeps the auth cookie the guard reads in step with the
// supabase-js session) and the dark-theme wrapper.
// This layout is not a guard; see (portal)/layout.tsx.
export default function NutritionLayout({ children }: { children: ReactNode }) {
  return <NutritionRoot>{children}</NutritionRoot>
}
