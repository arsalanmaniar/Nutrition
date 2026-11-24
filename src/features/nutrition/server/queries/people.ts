import 'server-only'
import type { NutritionRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { AuthorHashKeyError } from '../author-hash'
import { trainingStartDateLocked } from '../start-date-lock'

// Read models for the people admin pages. Each loader checks ADMIN itself, so
// a page that lost its own guard still could not leak the list, and selects
// only what the pages show.

export interface PersonRow {
  id: string
  fullName: string
  email: string
  role: NutritionRole
  institution: string | null
  isActive: boolean
  /** The trainee's active primary preceptor. */
  primaryPreceptor: string | null
  /** How many trainees this person is currently primary preceptor for. */
  activeTrainees: number
}

export interface AssignmentRow {
  id: string
  /** The other person: the preceptor on a trainee's page, the trainee on a preceptor's. */
  personId: string
  personName: string
  active: boolean
  since: string
  /** When an ended assignment was ended (its last change). */
  endedOn: string | null
}

export interface PersonDetail {
  id: string
  fullName: string
  email: string
  role: NutritionRole
  institution: string | null
  isActive: boolean
  trainingStartDate: string | null
  /**
   * Evaluation forms exist, so the training start date can no longer change.
   * The same rule as setTrainingStartDate (start-date-lock.ts), Form 1.3
   * included. True also when that cannot be checked (startDateUnchecked).
   */
  startDateLocked: boolean
  /** Form 1.3 rows exist but the hash key is missing, so the lock could not be checked: shown as locked (fail closed). */
  startDateUnchecked: boolean
  /** This is the signed-in admin's own profile. */
  isSelf: boolean
  preceptors: AssignmentRow[]
  trainees: AssignmentRow[]
  /** Active preceptors to choose from when assigning (trainees only). */
  preceptorOptions: { id: string; fullName: string; email: string }[]
}

/** A calendar day in Karachi time, e.g. 2026-10-11. */
const day = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })

export async function listPeople(): Promise<PersonRow[]> {
  await requireNutritionRole(['ADMIN'])
  const rows = await prisma.nutritionProfile.findMany({
    orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      institution: true,
      isActive: true,
      assignmentsAsTrainee: { where: { active: true }, take: 1, select: { preceptor: { select: { fullName: true } } } },
      _count: { select: { assignmentsAsPreceptor: { where: { active: true } } } },
    },
  })
  return rows.map(({ assignmentsAsTrainee, _count, ...person }) => ({
    ...person,
    primaryPreceptor: assignmentsAsTrainee[0]?.preceptor.fullName ?? null,
    activeTrainees: _count.assignmentsAsPreceptor,
  }))
}

export async function getPersonDetail(profileId: string): Promise<PersonDetail | null> {
  const access = await requireNutritionRole(['ADMIN'])
  const person = await prisma.nutritionProfile.findUnique({
    where: { id: profileId },
    select: {
      id: true,
      authUserId: true,
      fullName: true,
      email: true,
      role: true,
      institution: true,
      isActive: true,
      trainingStartDate: true,
      assignmentsAsTrainee: {
        orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
        select: { id: true, active: true, createdAt: true, updatedAt: true, preceptor: { select: { id: true, fullName: true } } },
      },
      assignmentsAsPreceptor: {
        orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
        select: { id: true, active: true, createdAt: true, updatedAt: true, trainee: { select: { id: true, fullName: true } } },
      },
    },
  })
  if (!person) return null

  let startDateLocked = false
  let startDateUnchecked = false
  if (person.role === 'TRAINEE') {
    try {
      startDateLocked = await trainingStartDateLocked(prisma, person.id)
    } catch (error) {
      if (!(error instanceof AuthorHashKeyError)) throw error
      startDateLocked = true
      startDateUnchecked = true
    }
  }

  const preceptorOptions =
    person.role === 'TRAINEE'
      ? await prisma.nutritionProfile.findMany({
          where: { role: 'PRECEPTOR', isActive: true },
          orderBy: { fullName: 'asc' },
          select: { id: true, fullName: true, email: true },
        })
      : []

  const row = (a: { id: string; active: boolean; createdAt: Date; updatedAt: Date }, other: { id: string; fullName: string }) => ({
    id: a.id,
    personId: other.id,
    personName: other.fullName,
    active: a.active,
    since: day(a.createdAt),
    endedOn: a.active ? null : day(a.updatedAt),
  })

  return {
    id: person.id,
    fullName: person.fullName,
    email: person.email,
    role: person.role,
    institution: person.institution,
    isActive: person.isActive,
    trainingStartDate: person.trainingStartDate ? person.trainingStartDate.toISOString().slice(0, 10) : null,
    startDateLocked,
    startDateUnchecked,
    isSelf: person.authUserId === access.userId,
    preceptors: person.assignmentsAsTrainee.map((a) => row(a, a.preceptor)),
    trainees: person.assignmentsAsPreceptor.map((a) => row(a, a.trainee)),
    preceptorOptions,
  }
}
