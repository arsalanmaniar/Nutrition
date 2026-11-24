'use server'

import type { NutritionRole, Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { fail, ok, type ActionResult } from '@/features/nutrition/lib/action-result'
import {
  assignPreceptorSchema,
  createAccountSchema,
  endAssignmentSchema,
  linkProfileSchema,
  trainingStartDateSchema,
  updateProfileSchema,
} from '@/features/nutrition/validation/people'
import { ActionFailure, formFields, invalid, isUniqueViolation } from '../action-helpers'
import { assignmentSnapshot, profileSnapshot, writeAudit } from '../audit'
import { findLinkableAuthUser } from '../auth-users'
import { AuthorHashKeyError } from '../author-hash'
import { lockTraineeRow } from '../lock-trainee-row'
import { canCreateAccounts, createAuthUser, deleteAuthUser } from '../service-role'
import { trainingStartDateLocked } from '../start-date-lock'

// Server actions for /nutrition/admin/people.
//
// Every exported function starts with requireNutritionRole(['ADMIN'])
// (portal-guard-coverage.test.ts checks it), then parses its form with zod,
// then changes the database inside a transaction that also writes the audit
// row. Nothing is ever deleted: people are deactivated, assignments are ended.
// createdBy and the audit actorId are the caller's Supabase auth user id, which
// a super_admin without a profile also has.

const PEOPLE_PATH = '/nutrition/admin/people'

const START_DATE_UNCHECKED = 'Form 1.3 records cannot be checked right now, so the training start date was not changed.'

const PROFILE_FIELDS = {
  id: true,
  authUserId: true,
  email: true,
  fullName: true,
  role: true,
  institution: true,
  trainingStartDate: true,
  isActive: true,
} as const

const ASSIGNMENT_FIELDS = { id: true, traineeId: true, preceptorId: true, active: true } as const

type ProfileChange = 'none' | 'update' | 'deactivate' | 'reactivate'

/** Links an existing, confirmed Supabase account (found by email) to a new profile. */
export async function linkProfile(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['ADMIN'])
  const parsed = linkProfileSchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)

  const account = await findLinkableAuthUser(parsed.data.email)
  if (account === 'none') {
    return fail('No confirmed Supabase account uses this email. The person needs an account first.', {
      email: 'No confirmed account with this email.',
    })
  }
  if (account === 'ambiguous') {
    return fail('More than one Supabase account matches this email. Sort that out in Supabase first.')
  }

  const result = await saveNewProfile(access.userId, { ...parsed.data, authUserId: account.id }, 'link_account')
  if (result.status === 'ok') revalidatePath(PEOPLE_PATH)
  return result
}

/**
 * Creates a Supabase account and its profile together. Only where a real
 * service-role key is set; if the profile cannot be saved, the new account is
 * deleted again so no orphan login is left behind.
 */
export async function createProfileWithAccount(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['ADMIN'])
  if (!canCreateAccounts()) {
    return fail('Account creation is not available on this server. Link an existing account instead.')
  }
  const parsed = createAccountSchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)
  const { password, ...profile } = parsed.data

  // Checked before Supabase is called, so a duplicate never creates a stray account.
  const existing = await prisma.nutritionProfile.findFirst({ where: { email: profile.email }, select: { id: true } })
  if (existing) return fail('A profile with this email already exists.', { email: 'Already has a profile.' })

  const account = await createAuthUser(profile.email, password)
  if (!account.ok) return fail(account.error, { email: account.error })

  let result: ActionResult
  try {
    result = await saveNewProfile(access.userId, { ...profile, authUserId: account.userId }, 'create_with_account')
  } catch (error) {
    console.error('nutrition people: saving the profile failed:', error instanceof Error ? error.message : 'unknown error')
    result = fail('The profile could not be saved.')
  }
  if (result.status === 'ok') {
    revalidatePath(PEOPLE_PATH)
    return result
  }

  // The transaction rolled back, so the account has no profile: remove it again.
  const reason = result.status === 'error' ? result.message : 'The profile could not be saved.'
  const removed = await deleteAuthUser(account.userId)
  return fail(
    removed
      ? `${reason} The new Supabase account was removed again.`
      : `${reason} The new Supabase account could not be removed: delete ${profile.email} in the Supabase dashboard.`,
  )
}

/** Edits name, role, institution and active status. Deactivation is the only way to remove someone. */
export async function updateProfile(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['ADMIN'])
  const parsed = updateProfileSchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)
  const input = parsed.data

  let change: ProfileChange
  try {
    change = await prisma.$transaction(async (tx): Promise<ProfileChange> => {
      await lockProfiles(tx, [input.profileId])
      const before = await tx.nutritionProfile.findUnique({ where: { id: input.profileId }, select: PROFILE_FIELDS })
      if (!before) throw new ActionFailure('This profile no longer exists.')

      const roleChanges = before.role !== input.role
      const deactivating = before.isActive && !input.isActive
      const reactivating = !before.isActive && input.isActive
      const detailsChange = before.fullName !== input.fullName || before.institution !== input.institution
      if (!roleChanges && !deactivating && !reactivating && !detailsChange) return 'none'

      if (before.authUserId === access.userId && (deactivating || (roleChanges && before.role === 'ADMIN'))) {
        throw new ActionFailure('You cannot remove your own admin access.')
      }
      if (roleChanges || deactivating) {
        const activeAssignments = await tx.nutritionPreceptorAssignment.count({
          where: { active: true, OR: [{ traineeId: before.id }, { preceptorId: before.id }] },
        })
        if (activeAssignments > 0) throw new ActionFailure("End this person's active assignments first.")
      }

      const action = deactivating ? 'deactivate' : reactivating ? 'reactivate' : 'update'
      const after = await tx.nutritionProfile.update({
        where: { id: before.id },
        data: { fullName: input.fullName, role: input.role, institution: input.institution, isActive: input.isActive },
        select: PROFILE_FIELDS,
      })
      await writeAudit(tx, {
        entity: 'NutritionProfile',
        entityId: before.id,
        action,
        actorId: access.userId,
        before: profileSnapshot(before),
        after: profileSnapshot(after),
      })
      return action
    })
  } catch (error) {
    if (error instanceof ActionFailure) return fail(error.message, error.fieldErrors)
    throw error
  }

  if (change === 'none') return ok('No changes to save.')
  revalidatePath(PEOPLE_PATH)
  revalidatePath(`${PEOPLE_PATH}/${input.profileId}`)
  return ok(change === 'deactivate' ? 'Deactivated.' : change === 'reactivate' ? 'Reactivated.' : 'Saved.')
}

/** Sets a trainee's training start date, which is locked once any evaluation form exists (plan decision). */
export async function setTrainingStartDate(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['ADMIN'])
  const parsed = trainingStartDateSchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)
  const input = parsed.data

  try {
    await prisma.$transaction(async (tx) => {
      // Every form is created under the same lock (lockTraineeRow), so no form
      // can appear between the lock check below and the update.
      await lockTraineeRow(tx, input.profileId)
      const before = await tx.nutritionProfile.findUnique({ where: { id: input.profileId }, select: PROFILE_FIELDS })
      if (!before) throw new ActionFailure('This profile no longer exists.')
      if (before.role !== 'TRAINEE') throw new ActionFailure('Only trainees have a training start date.')

      // Forms about the trainee or by them, Form 1.3 included (start-date-lock.ts).
      if (await trainingStartDateLocked(tx, before.id)) {
        throw new ActionFailure(
          'Locked: this trainee already has evaluation forms, so the training start date can no longer change.',
          { trainingStartDate: 'Locked: evaluation forms exist.' },
        )
      }

      const after = await tx.nutritionProfile.update({
        where: { id: before.id },
        data: { trainingStartDate: new Date(`${input.trainingStartDate}T00:00:00Z`) },
        select: PROFILE_FIELDS,
      })
      await writeAudit(tx, {
        entity: 'NutritionProfile',
        entityId: before.id,
        action: 'set_training_start_date',
        actorId: access.userId,
        before: profileSnapshot(before),
        after: profileSnapshot(after),
      })
    })
  } catch (error) {
    if (error instanceof ActionFailure) return fail(error.message, error.fieldErrors)
    // Fail closed: without the hash key, Form 1.3 authorship cannot be checked.
    if (error instanceof AuthorHashKeyError) return fail(START_DATE_UNCHECKED)
    throw error
  }

  revalidatePath(PEOPLE_PATH)
  revalidatePath(`${PEOPLE_PATH}/${input.profileId}`)
  return ok('Training start date saved.')
}

/** Makes a preceptor a trainee's primary preceptor. At most one active assignment per trainee. */
export async function assignPreceptor(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['ADMIN'])
  const parsed = assignPreceptorSchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)
  const input = parsed.data

  try {
    await prisma.$transaction(async (tx) => {
      // Lock both people: a second assignment for the same trainee waits here
      // until this one commits and then finds it below, and neither person's
      // role or status can change halfway through.
      await lockProfiles(tx, [input.traineeId, input.preceptorId])

      const trainee = await tx.nutritionProfile.findUnique({ where: { id: input.traineeId }, select: PROFILE_FIELDS })
      if (!trainee || trainee.role !== 'TRAINEE' || !trainee.isActive) {
        throw new ActionFailure('Pick an active trainee.', { traineeId: 'Not an active trainee.' })
      }
      const preceptor = await tx.nutritionProfile.findUnique({ where: { id: input.preceptorId }, select: PROFILE_FIELDS })
      if (!preceptor || preceptor.role !== 'PRECEPTOR' || !preceptor.isActive) {
        throw new ActionFailure('Pick an active preceptor.', { preceptorId: 'Not an active preceptor.' })
      }

      const current = await tx.nutritionPreceptorAssignment.findFirst({
        where: { traineeId: trainee.id, active: true },
        select: { id: true },
      })
      if (current) {
        throw new ActionFailure('This trainee already has an active primary preceptor. End that assignment first.', {
          preceptorId: 'Already has an active primary preceptor.',
        })
      }

      const created = await tx.nutritionPreceptorAssignment.create({
        data: { traineeId: trainee.id, preceptorId: preceptor.id, createdBy: access.userId },
        select: ASSIGNMENT_FIELDS,
      })
      await writeAudit(tx, {
        entity: 'NutritionPreceptorAssignment',
        entityId: created.id,
        action: 'assign',
        actorId: access.userId,
        before: null,
        after: assignmentSnapshot(created),
      })
    })
  } catch (error) {
    if (error instanceof ActionFailure) return fail(error.message, error.fieldErrors)
    throw error
  }

  revalidatePath(PEOPLE_PATH)
  revalidatePath(`${PEOPLE_PATH}/${input.traineeId}`)
  revalidatePath(`${PEOPLE_PATH}/${input.preceptorId}`)
  return ok('Preceptor assigned.')
}

/** Ends an assignment by setting active = false. The row is kept as history. */
export async function endAssignment(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const access = await requireNutritionRole(['ADMIN'])
  const parsed = endAssignmentSchema.safeParse(formFields(formData))
  if (!parsed.success) return invalid(parsed.error)

  let ended: { traineeId: string; preceptorId: string }
  try {
    ended = await prisma.$transaction(async (tx) => {
      const before = await tx.nutritionPreceptorAssignment.findUnique({
        where: { id: parsed.data.assignmentId },
        select: ASSIGNMENT_FIELDS,
      })
      if (!before) throw new ActionFailure('This assignment no longer exists.')

      // Conditional, so two admins ending the same assignment at once end (and log) it only once.
      const { count } = await tx.nutritionPreceptorAssignment.updateMany({
        where: { id: before.id, active: true },
        data: { active: false },
      })
      if (count === 0) throw new ActionFailure('This assignment has already ended.')

      await writeAudit(tx, {
        entity: 'NutritionPreceptorAssignment',
        entityId: before.id,
        action: 'end',
        actorId: access.userId,
        before: assignmentSnapshot(before),
        after: assignmentSnapshot({ ...before, active: false }),
      })
      return { traineeId: before.traineeId, preceptorId: before.preceptorId }
    })
  } catch (error) {
    if (error instanceof ActionFailure) return fail(error.message, error.fieldErrors)
    throw error
  }

  revalidatePath(PEOPLE_PATH)
  revalidatePath(`${PEOPLE_PATH}/${ended.traineeId}`)
  revalidatePath(`${PEOPLE_PATH}/${ended.preceptorId}`)
  return ok('Assignment ended.')
}

/**
 * Row-locks profiles until the transaction ends, so two admins working at once
 * cannot slip past each other's checks. Sorted, so two transactions locking
 * the same people always lock them in the same order and cannot deadlock.
 */
async function lockProfiles(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
  for (const id of [...new Set(ids)].sort()) {
    await tx.$queryRaw`SELECT id FROM nutr_profile WHERE id = ${id} FOR UPDATE`
  }
}

interface NewProfile {
  authUserId: string
  email: string
  fullName: string
  role: NutritionRole
  institution: string | null
  trainingStartDate: string | null
}

/** One profile per email and per Supabase account, created with its audit row. */
async function saveNewProfile(
  actorId: string,
  profile: NewProfile,
  action: 'link_account' | 'create_with_account',
): Promise<ActionResult> {
  try {
    await prisma.$transaction(async (tx) => {
      const clash = await tx.nutritionProfile.findFirst({
        where: { OR: [{ email: profile.email }, { authUserId: profile.authUserId }] },
        select: { email: true },
      })
      if (clash) {
        throw clash.email === profile.email
          ? new ActionFailure('A profile with this email already exists.', { email: 'Already has a profile.' })
          : new ActionFailure('This Supabase account already has a profile.', { email: 'Account already linked.' })
      }

      const created = await tx.nutritionProfile.create({
        data: {
          authUserId: profile.authUserId,
          email: profile.email,
          fullName: profile.fullName,
          role: profile.role,
          institution: profile.institution,
          trainingStartDate: profile.trainingStartDate ? new Date(`${profile.trainingStartDate}T00:00:00Z`) : null,
          createdBy: actorId,
        },
        select: PROFILE_FIELDS,
      })
      await writeAudit(tx, {
        entity: 'NutritionProfile',
        entityId: created.id,
        action,
        actorId,
        before: null,
        after: profileSnapshot(created),
      })
    })
  } catch (error) {
    if (error instanceof ActionFailure) return fail(error.message, error.fieldErrors)
    if (isUniqueViolation(error)) return fail('A profile with this email or Supabase account already exists.')
    throw error
  }
  return ok(`${profile.fullName} added.`)
}
