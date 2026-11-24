import { safeNutritionReturnPath } from '@/features/nutrition/auth/return-path'
import { NutritionLoginForm } from '@/features/nutrition/components/NutritionLoginForm'

// Public: no guard. ?next= is attacker-controlled, so it is checked here, on the
// server, and the form only ever sees the safe result (default /nutrition).
export default async function NutritionLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { next } = await searchParams
  return <NutritionLoginForm returnTo={safeNutritionReturnPath(Array.isArray(next) ? next[0] : next)} />
}
