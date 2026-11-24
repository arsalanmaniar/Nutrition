'use server'

import type { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { fail, ok, type ActionResult } from '@/features/nutrition/lib/action-result'
import {
  createRotationSchema,
  renameRotationSchema,
  setRotationActiveSchema,
} from '@/features/nutrition/validation/rotations'
import { ActionFailure, formFields, invalid, isUniqueViolation } from '../action-helpers'
import { rotationSnapshot, writeAudit } from '../audit'

// Server actions for /nutrition/admin/rotations. The same rules as the people
// actions: the guard first, zod next, and every change written to the audit
// log in the same transaction. Rotations are deactivated, never deleted, so
// case logs that point at one keep their history.

const ROTATIONS_PATH = '/nutrition/admin/rotations'

const ROTATION_FIELDS = { id: true, name: true, isActive: true } as const

const DUPLICATE_NAME = 'A rotation with this name already exists.'

export async function createRotation(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['ADMIN'])
  const parsed = createRotationSchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)
  const { name } = parsed.data

  try {
    await prisma.$transaction(async (tx) => {
      if (await nameTaken(tx, name)) throw new ActionFailure(DUPLICATE_NAME, { name: 'Already exists.' })

      const created = await tx.nutritionRotation.create({
        data: { name, createdBy: access.userId },
        select: ROTATION_FIELDS,
      })
      await writeAudit(tx, {
        entity: 'NutritionRotation',
        entityId: created.id,
        action: 'create',
        actorId: access.userId,
        before: null,
        after: rotationSnapshot(created),
      })
    })
  } catch (error) {
    if (error instanceof ActionFailure) return fail(error.message, error.fieldErrors)
    if (isUniqueViolation(error)) return fail(DUPLICATE_NAME, { name: 'Already exists.' })
    throw error
  }

  revalidatePath(ROTATIONS_PATH)
  return ok(`Rotation "${name}" added.`)
}

export async function renameRotation(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['ADMIN'])
  const parsed = renameRotationSchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)
  const { rotationId, name } = parsed.data

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.nutritionRotation.findUnique({ where: { id: rotationId }, select: ROTATION_FIELDS })
      if (!before) throw new ActionFailure('This rotation no longer exists.')
      if (await nameTaken(tx, name, rotationId)) throw new ActionFailure(DUPLICATE_NAME, { name: 'Already exists.' })

      const after = await tx.nutritionRotation.update({ where: { id: rotationId }, data: { name }, select: ROTATION_FIELDS })
      await writeAudit(tx, {
        entity: 'NutritionRotation',
        entityId: rotationId,
        action: 'rename',
        actorId: access.userId,
        before: rotationSnapshot(before),
        after: rotationSnapshot(after),
      })
    })
  } catch (error) {
    if (error instanceof ActionFailure) return fail(error.message, error.fieldErrors)
    if (isUniqueViolation(error)) return fail(DUPLICATE_NAME, { name: 'Already exists.' })
    throw error
  }

  revalidatePath(ROTATIONS_PATH)
  return ok('Renamed.')
}

export async function setRotationActive(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['ADMIN'])
  const parsed = setRotationActiveSchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)
  const { rotationId, isActive } = parsed.data

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.nutritionRotation.findUnique({ where: { id: rotationId }, select: ROTATION_FIELDS })
      if (!before) throw new ActionFailure('This rotation no longer exists.')
      if (before.isActive === isActive) throw new ActionFailure(isActive ? 'Already active.' : 'Already inactive.')

      const after = await tx.nutritionRotation.update({ where: { id: rotationId }, data: { isActive }, select: ROTATION_FIELDS })
      await writeAudit(tx, {
        entity: 'NutritionRotation',
        entityId: rotationId,
        action: isActive ? 'reactivate' : 'deactivate',
        actorId: access.userId,
        before: rotationSnapshot(before),
        after: rotationSnapshot(after),
      })
    })
  } catch (error) {
    if (error instanceof ActionFailure) return fail(error.message, error.fieldErrors)
    throw error
  }

  revalidatePath(ROTATIONS_PATH)
  return ok(isActive ? 'Reactivated.' : 'Deactivated.')
}

/**
 * Is the name already used by another rotation, ignoring case and surrounding
 * spaces? The unique index on name is case-sensitive, so this compares
 * lower(trim(name)) itself, inside the transaction that then writes the row.
 * Two admins saving at the same instant can still both pass it; the planned
 * unique index on lower(name) closes that (plan: Decisions, Step 3d outcome).
 */
async function nameTaken(tx: Prisma.TransactionClient, name: string, exceptId?: string): Promise<boolean> {
  const rows = exceptId
    ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM nutr_rotation WHERE lower(trim(name)) = lower(trim(${name})) AND id <> ${exceptId} LIMIT 1`
    : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM nutr_rotation WHERE lower(trim(name)) = lower(trim(${name})) LIMIT 1`
  return rows.length > 0
}
