import 'server-only'
import type { EpaLevel, MillerLevel } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { EPA_LIST, epaLabel } from '@/features/nutrition/config/epas'
import { EPA_LEVEL_LABELS, MILLER_LEVEL_LABELS } from '@/features/nutrition/config/forms'
import { activeTraineeIds } from '../evaluation-forms-core'
import { ownPreceptorId } from '../own-preceptor'
import { ownTraineeId } from '../own-trainee'

// Read models for the EPA entrustment dashboard (Step 6a). Each loader checks
// its role itself, with an exact role list (portal-guard-coverage.test.ts):
//  - a preceptor reads the EPA history of the trainees they are the ACTIVE
//    primary preceptor of, and nobody else's (a rotation preceptor has none);
//  - a trainee reads only their own EPA history, by their own profile id.
// Each EPA's current level is its newest row; every earlier row is kept and
// shown as history.

export interface EpaHistoryEntry {
  id: string
  level: EpaLevel
  levelLabel: string
  millerLevel: MillerLevel
  millerLabel: string
  assessedOn: string
  assessorName: string
  notes: string | null
}

export interface EpaStatus {
  key: string
  label: string
  /** The newest entry, or null when the EPA has no level yet. */
  current: EpaHistoryEntry | null
  /** Newest first, the current entry included. */
  history: EpaHistoryEntry[]
}

export interface TraineeEpaDashboard {
  traineeId: string
  traineeName: string
  epas: EpaStatus[]
}

const NEWEST_FIRST = [{ assessedOn: 'desc' as const }, { createdAt: 'desc' as const }]

const ROW_FIELDS = {
  id: true,
  traineeId: true,
  epaName: true,
  level: true,
  millerLevel: true,
  assessedOn: true,
  notes: true,
  assessor: { select: { fullName: true } },
} as const

interface EpaRow {
  id: string
  traineeId: string
  epaName: string
  level: EpaLevel
  millerLevel: MillerLevel
  assessedOn: Date
  notes: string | null
  assessor: { fullName: string }
}

function entry(row: EpaRow): EpaHistoryEntry {
  return {
    id: row.id,
    level: row.level,
    levelLabel: EPA_LEVEL_LABELS[row.level],
    millerLevel: row.millerLevel,
    millerLabel: MILLER_LEVEL_LABELS[row.millerLevel],
    assessedOn: row.assessedOn.toISOString().slice(0, 10),
    assessorName: row.assessor.fullName,
    notes: row.notes,
  }
}

/** Every configured EPA in order, then any retired key that still has rows. Rows arrive newest first. */
function byEpa(rows: readonly EpaRow[]): EpaStatus[] {
  const keys = [...EPA_LIST.map((epa) => epa.key)]
  for (const row of rows) if (!keys.includes(row.epaName)) keys.push(row.epaName)
  return keys.map((key) => {
    const history = rows.filter((row) => row.epaName === key).map(entry)
    return { key, label: epaLabel(key), current: history[0] ?? null, history }
  })
}

/** The caller's ACTIVE primary trainees, each with every EPA's current level and history. */
export async function listMyTraineesEpa(): Promise<TraineeEpaDashboard[]> {
  const access = await requireNutritionRole(['PRECEPTOR'])
  const traineeIds = await activeTraineeIds(prisma, ownPreceptorId(access))
  if (traineeIds.length === 0) return []
  const trainees = await prisma.nutritionProfile.findMany({
    where: { id: { in: traineeIds }, role: 'TRAINEE', isActive: true },
    orderBy: [{ fullName: 'asc' }],
    select: { id: true, fullName: true },
  })
  const rows = await prisma.nutritionEpaAssessment.findMany({
    where: { traineeId: { in: trainees.map((trainee) => trainee.id) } },
    orderBy: NEWEST_FIRST,
    select: ROW_FIELDS,
  })
  return trainees.map((trainee) => ({
    traineeId: trainee.id,
    traineeName: trainee.fullName,
    epas: byEpa(rows.filter((row) => row.traineeId === trainee.id)),
  }))
}

/** The trainee's own EPA levels: current and history per EPA. */
export async function getMyEpaHistory(): Promise<EpaStatus[]> {
  const access = await requireNutritionRole(['TRAINEE'])
  const traineeId = ownTraineeId(access)
  const rows = await prisma.nutritionEpaAssessment.findMany({
    where: { traineeId },
    orderBy: NEWEST_FIRST,
    select: ROW_FIELDS,
  })
  return byEpa(rows)
}
