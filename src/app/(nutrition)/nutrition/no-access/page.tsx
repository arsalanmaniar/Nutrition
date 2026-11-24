import { SignOutButton } from '@/features/nutrition/components/SignOutButton'

// Public: no guard. Deliberately says nothing about which roles exist or what
// this person lacks.
export default function NutritionNoAccessPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-xl">
        <h1 className="text-xl font-bold text-gray-800">No access</h1>
        <p className="mt-2 text-sm text-gray-500">
          This account cannot use MyLearningSphere, the Clinical Dietetics &amp; Nutrition E-Portal. If you think that is a mistake,
          contact the program administrator.
        </p>
        <SignOutButton className="mt-6 w-full rounded-lg bg-red-700 py-3 font-bold text-white transition hover:bg-red-800 disabled:opacity-50" />
      </div>
    </div>
  )
}
