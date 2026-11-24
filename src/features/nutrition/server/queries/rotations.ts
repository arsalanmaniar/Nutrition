import 'server-only'
import { prisma } from '@/lib/prisma'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'

// Read model for the rotations admin page. Checks ADMIN itself, like every
// loader. The e-logbook's rotation picker (Step 3e) gets its own loader, with
// its own roles, listing active rotations only.

export interface RotationRow {
  id: string
  name: string
  isActive: boolean
}

export async function listRotations(): Promise<RotationRow[]> {
  await requireNutritionRole(['ADMIN'])
  return prisma.nutritionRotation.findMany({
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    select: { id: true, name: true, isActive: true },
  })
}
