import { NutritionRole } from '@prisma/client'
import { z } from 'zod'

// Input rules for the people admin. Every server action parses its form with
// one of these before touching the database.

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'That email address is too long.')
  .pipe(z.email({ error: 'Enter a valid email address.' }))

const fullName = z
  .string()
  .trim()
  .min(2, 'Enter the full name.')
  .max(120, 'Keep the name under 120 characters.')

const role = z.enum(NutritionRole, { error: 'Pick a role.' })

/** Optional free text: empty becomes null. */
const institution = z
  .string()
  .trim()
  .max(160, 'Keep the institution under 160 characters.')
  .optional()
  .transform((value) => value || null)

const isoDate = z.iso.date({ error: 'Use a date like 2026-10-01.' })

/** Optional date: empty becomes null. */
const optionalDate = z
  .union([z.literal(''), isoDate])
  .optional()
  .transform((value) => value || null)

const id = z.uuid({ error: 'Invalid id.' })

const activeFlag = z.enum(['true', 'false'], { error: 'Pick active or inactive.' }).transform((value) => value === 'true')

// Supabase stores passwords with bcrypt, which reads at most 72 BYTES. The
// limit is counted in UTF-8 bytes, not characters: an accented letter takes 2
// bytes and an emoji 4, so such a password holds fewer than 72 characters.
const utf8Length = (value: string) => new TextEncoder().encode(value).length

const password = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .refine((value) => utf8Length(value) <= 72, 'Use at most 72 bytes: up to 72 English characters, fewer with other letters or emoji.')

const newProfile = {
  email,
  fullName,
  role,
  institution,
  trainingStartDate: optionalDate,
}

function onlyTraineesHaveStartDates<T extends { role: NutritionRole; trainingStartDate: string | null }>(
  value: T,
  ctx: z.RefinementCtx,
) {
  if (value.trainingStartDate && value.role !== 'TRAINEE') {
    ctx.addIssue({ code: 'custom', path: ['trainingStartDate'], message: 'Only trainees have a training start date.' })
  }
}

export const linkProfileSchema = z.object(newProfile).superRefine(onlyTraineesHaveStartDates)

export const createAccountSchema = z.object({ ...newProfile, password }).superRefine(onlyTraineesHaveStartDates)

export const updateProfileSchema = z.object({
  profileId: id,
  fullName,
  role,
  institution,
  isActive: activeFlag,
})

export const trainingStartDateSchema = z.object({
  profileId: id,
  trainingStartDate: isoDate,
})

export const assignPreceptorSchema = z
  .object({ traineeId: id, preceptorId: id })
  .refine((value) => value.traineeId !== value.preceptorId, {
    path: ['preceptorId'],
    message: 'A trainee cannot be their own preceptor.',
  })

export const endAssignmentSchema = z.object({ assignmentId: id })
