import { z } from 'zod'

// Input rules for the rotations admin.

const name = z
  .string()
  .trim()
  .min(2, 'Enter a rotation name.')
  .max(80, 'Keep the name under 80 characters.')

const id = z.uuid({ error: 'Invalid id.' })

export const createRotationSchema = z.object({ name })

export const renameRotationSchema = z.object({ rotationId: id, name })

export const setRotationActiveSchema = z.object({
  rotationId: id,
  isActive: z.enum(['true', 'false'], { error: 'Pick active or inactive.' }).transform((value) => value === 'true'),
})
