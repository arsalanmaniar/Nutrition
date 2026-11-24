// An in-memory stand-in for the Prisma client, for the nutrition server action
// tests (not itself a test file). It covers what the actions and the auth code
// they call use, and is strict about the rest: an unknown field, filter or
// argument throws, so a query the fake cannot honour fails the test instead of
// quietly matching nothing.
//
// Faithful where the tests depend on it: single-column unique indexes throw
// P2002 like Postgres; a failed $transaction undoes every write it made; update
// on a missing row throws P2025; rows are copied in and out, so callers cannot
// mutate stored rows.
//
// Concurrency: each $transaction gets its own client, and SELECT … FOR UPDATE
// takes a real row lock, which another transaction waits for until the holder
// commits or rolls back, as in Postgres. Plain reads take no locks and see
// other transactions' writes at once (there is no isolation), so a test of two
// concurrent writers passes only if the code locks before it reads, which is
// what such a test should check. There is no deadlock detection: a deadlock
// hangs the test until it times out.

import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'

type Row = Record<string, unknown>

interface Relation {
  /** The related model. */
  model: string
  /** This model's column holding the related row's id. */
  foreignKey: string
}

interface ModelSpec {
  columns: readonly string[]
  /** Values a new row gets when create() does not give one. */
  defaults: (now: Date) => Row
  /** Single-column unique indexes. NULL never clashes, as in Postgres. */
  unique: readonly string[]
  /** Multi-column unique indexes. A row with NULL in any of the columns never clashes, as in Postgres. */
  uniqueTogether?: readonly (readonly string[])[]
  /** Set to now() by every update, like Prisma's @updatedAt. */
  updatedAt: boolean
  /** To-one relations a select may include, as { relation: { select: { … } } }. */
  relations?: Readonly<Record<string, Relation>>
}

const MODELS = {
  nutritionProfile: {
    columns: ['id', 'authUserId', 'email', 'fullName', 'role', 'institution', 'trainingStartDate', 'isActive', 'createdAt', 'updatedAt', 'createdBy'],
    defaults: (now) => ({ authUserId: null, institution: null, trainingStartDate: null, isActive: true, createdAt: now, updatedAt: now }),
    unique: ['email', 'authUserId'],
    updatedAt: true,
  },
  nutritionPreceptorAssignment: {
    columns: ['id', 'traineeId', 'preceptorId', 'active', 'createdAt', 'updatedAt', 'createdBy'],
    defaults: (now) => ({ active: true, createdAt: now, updatedAt: now }),
    unique: [],
    updatedAt: true,
  },
  nutritionRotation: {
    columns: ['id', 'name', 'unitLeadId', 'isActive', 'createdAt', 'updatedAt', 'createdBy'],
    defaults: (now) => ({ unitLeadId: null, isActive: true, createdAt: now, updatedAt: now }),
    unique: ['name'],
    updatedAt: true,
  },
  nutritionCaseLog: {
    columns: [
      'id', 'traineeId', 'rotationId', 'caseCode', 'ageBand', 'diagnosisCategory', 'formType', 'formVersion', 'data', 'epaLevel',
      'status', 'submittedAt', 'reviewedById', 'reviewedAt', 'reviewComment', 'createdAt', 'updatedAt', 'createdBy',
    ],
    defaults: (now) => ({
      rotationId: null, epaLevel: null, status: 'DRAFT', submittedAt: null, reviewedById: null, reviewedAt: null, reviewComment: null,
      createdAt: now, updatedAt: now,
    }),
    // As in the schema: caseCode has no unique index; the create action's row lock keeps it unique per trainee.
    unique: [],
    updatedAt: true,
    relations: {
      rotation: { model: 'nutritionRotation', foreignKey: 'rotationId' },
      trainee: { model: 'nutritionProfile', foreignKey: 'traineeId' },
      reviewedBy: { model: 'nutritionProfile', foreignKey: 'reviewedById' },
    },
  },
  nutritionEvaluationForm: {
    columns: [
      'id', 'formType', 'formVersion', 'subjectId', 'authorId', 'authorHash', 'monthNumber', 'assessmentPoint', 'answers',
      'totalScore', 'maxScore', 'status', 'submittedAt', 'reviewedById', 'reviewedAt', 'reviewComment', 'createdAt', 'updatedAt', 'createdBy',
    ],
    defaults: (now) => ({
      formType: 'FORM_1_1', formVersion: 1, authorId: null, authorHash: null, monthNumber: 1, assessmentPoint: 'M01', answers: {},
      totalScore: null, maxScore: null, status: 'DRAFT', submittedAt: null, reviewedById: null, reviewedAt: null, reviewComment: null,
      createdAt: now, updatedAt: now, createdBy: null,
    }),
    unique: ['authorHash'],
    // nutr_evaluation_form_period_key. Form 1.3 rows (authorId NULL) never clash on it.
    uniqueTogether: [['formType', 'subjectId', 'authorId', 'assessmentPoint']],
    updatedAt: true,
    relations: {
      subject: { model: 'nutritionProfile', foreignKey: 'subjectId' },
      author: { model: 'nutritionProfile', foreignKey: 'authorId' },
      reviewedBy: { model: 'nutritionProfile', foreignKey: 'reviewedById' },
    },
  },
  nutritionRotationEntry: {
    columns: [
      'id', 'traineeId', 'rotationId', 'rotationPreceptorId', 'startDate', 'endDate', 'hours', 'verifiedById', 'verifiedAt',
      'createdAt', 'updatedAt', 'createdBy',
    ],
    defaults: (now) => ({
      rotationPreceptorId: null, endDate: null, hours: null, verifiedById: null, verifiedAt: null, createdAt: now, updatedAt: now,
    }),
    unique: [],
    updatedAt: true,
  },
  nutritionWpba: {
    columns: [
      'id', 'type', 'formVersion', 'traineeId', 'assessorId', 'rotationEntryId', 'caseLogId', 'procedure', 'scores', 'total',
      'maxScore', 'passed', 'criticalError', 'millerLevel', 'feedback', 'assessedOn', 'createdAt', 'updatedAt', 'createdBy',
    ],
    defaults: (now) => ({
      rotationEntryId: null, caseLogId: null, procedure: null, total: null, maxScore: null, passed: null, criticalError: null,
      feedback: null, createdAt: now, updatedAt: now,
    }),
    unique: [],
    updatedAt: true,
    relations: {
      trainee: { model: 'nutritionProfile', foreignKey: 'traineeId' },
      assessor: { model: 'nutritionProfile', foreignKey: 'assessorId' },
      caseLog: { model: 'nutritionCaseLog', foreignKey: 'caseLogId' },
      rotationEntry: { model: 'nutritionRotationEntry', foreignKey: 'rotationEntryId' },
    },
  },
  nutritionEpaAssessment: {
    columns: ['id', 'traineeId', 'epaName', 'level', 'millerLevel', 'assessorId', 'assessedOn', 'notes', 'createdAt', 'updatedAt', 'createdBy'],
    defaults: (now) => ({ notes: null, createdAt: now, updatedAt: now }),
    unique: [],
    updatedAt: true,
    relations: {
      trainee: { model: 'nutritionProfile', foreignKey: 'traineeId' },
      assessor: { model: 'nutritionProfile', foreignKey: 'assessorId' },
    },
  },
  nutritionStandardsChecklist: {
    columns: ['id', 'traineeId', 'monthNumber', 'formVersion', 'items', 'status', 'submittedAt', 'createdAt', 'updatedAt', 'createdBy'],
    defaults: (now) => ({ monthNumber: 9, status: 'DRAFT', submittedAt: null, createdAt: now, updatedAt: now }),
    unique: [],
    // nutr_standards_checklist_traineeId_monthNumber_key.
    uniqueTogether: [['traineeId', 'monthNumber']],
    updatedAt: true,
    relations: {
      trainee: { model: 'nutritionProfile', foreignKey: 'traineeId' },
    },
  },
  nutritionMsfInvite: {
    columns: ['id', 'traineeId', 'tokenHash', 'assessorName', 'assessorRole', 'expiresAt', 'usedAt', 'createdAt', 'updatedAt', 'createdBy'],
    defaults: (now) => ({ usedAt: null, createdAt: now, updatedAt: now }),
    unique: ['tokenHash'],
    updatedAt: true,
    relations: {
      trainee: { model: 'nutritionProfile', foreignKey: 'traineeId' },
    },
  },
  nutritionMsfResponse: {
    columns: ['id', 'inviteId', 'formVersion', 'answers', 'comments', 'createdAt', 'updatedAt', 'createdBy'],
    defaults: (now) => ({ comments: null, createdAt: now, updatedAt: now, createdBy: null }),
    unique: ['inviteId'],
    updatedAt: true,
    relations: {
      invite: { model: 'nutritionMsfInvite', foreignKey: 'inviteId' },
    },
  },
  nutritionRemediationPlan: {
    columns: ['id', 'traineeId', 'closedAt', 'createdAt', 'updatedAt', 'createdBy'],
    defaults: (now) => ({ closedAt: null, createdAt: now, updatedAt: now }),
    unique: [],
    updatedAt: true,
    relations: {
      trainee: { model: 'nutritionProfile', foreignKey: 'traineeId' },
    },
  },
  nutritionRemediationStep: {
    columns: [
      'id', 'planId', 'position', 'deficiency', 'activity', 'reassessmentDate', 'linkedWpbaId', 'outcome', 'epaName', 'epaBefore',
      'epaAfter', 'createdAt', 'updatedAt', 'createdBy',
    ],
    defaults: (now) => ({
      activity: null, reassessmentDate: null, linkedWpbaId: null, outcome: null, epaName: null, epaBefore: null, epaAfter: null,
      createdAt: now, updatedAt: now,
    }),
    unique: [],
    // nutr_remediation_step_planId_position_key.
    uniqueTogether: [['planId', 'position']],
    updatedAt: true,
    relations: {
      plan: { model: 'nutritionRemediationPlan', foreignKey: 'planId' },
      linkedWpba: { model: 'nutritionWpba', foreignKey: 'linkedWpbaId' },
    },
  },
  nutritionCredential: {
    columns: ['id', 'traineeId', 'type', 'verificationId', 'issuedAt', 'pdfPath', 'revokedAt', 'createdAt', 'updatedAt', 'createdBy'],
    defaults: (now) => ({ pdfPath: null, revokedAt: null, createdAt: now, updatedAt: now }),
    unique: ['verificationId'],
    updatedAt: true,
    relations: {
      trainee: { model: 'nutritionProfile', foreignKey: 'traineeId' },
    },
  },
  // Attendance (Step A4). The partial unique indexes of nutrition-step8.sql are
  // approximated: for schedules, uniqueTogether skips NULL, so it matches the
  // preceptor-scope index only. The "live rows only" indexes on holidays and
  // records are not modelled at all (the actions' lookups and the trainee row
  // lock are what the tests check).
  nutritionAttendanceHoliday: {
    columns: ['id', 'scopeProfileId', 'workDate', 'name', 'voidedAt', 'voidedById', 'voidReason', 'createdAt', 'updatedAt', 'createdBy'],
    defaults: (now) => ({ scopeProfileId: null, voidedAt: null, voidedById: null, voidReason: null, createdAt: now, updatedAt: now }),
    unique: [],
    updatedAt: true,
  },
  nutritionAttendanceSchedule: {
    columns: ['id', 'scopeProfileId', 'weekdays', 'startTime', 'endTime', 'effectiveFrom', 'createdAt', 'updatedAt', 'createdBy'],
    defaults: (now) => ({ scopeProfileId: null, createdAt: now, updatedAt: now }),
    unique: [],
    uniqueTogether: [['scopeProfileId', 'effectiveFrom']],
    updatedAt: true,
  },
  nutritionAttendanceRecord: {
    columns: [
      'id', 'traineeId', 'workDate', 'checkInAt', 'checkOutAt', 'status', 'voidedAt', 'voidedById', 'voidReason', 'staffReason', 'createdAt',
      'updatedAt', 'createdBy',
    ],
    defaults: (now) => ({
      checkInAt: null, checkOutAt: null, status: 'PRESENT', voidedAt: null, voidedById: null, voidReason: null, staffReason: null,
      createdAt: now, updatedAt: now,
    }),
    unique: [],
    updatedAt: true,
    relations: {
      trainee: { model: 'nutritionProfile', foreignKey: 'traineeId' },
    },
  },
  nutritionAuditLog: {
    columns: ['id', 'entity', 'entityId', 'action', 'actorId', 'before', 'after', 'at'],
    defaults: (now) => ({ actorId: null, before: null, after: null, at: now }),
    unique: [],
    updatedAt: false,
  },
} satisfies Record<string, ModelSpec>

export type ModelName = keyof typeof MODELS

const MODEL_NAMES = Object.keys(MODELS) as ModelName[]

export interface FakeAuthUser {
  id: string
  email: string
  confirmed: boolean
  deleted?: boolean
  anonymous?: boolean
  bannedUntil?: Date | null
}

export interface Call {
  /** e.g. "nutritionProfile.create" or "$queryRaw". */
  op: string
  args: unknown
  inTransaction: boolean
}

/** One interactive transaction: the row locks it holds, and how to undo its writes. */
interface TransactionState {
  locks: Set<string>
  undo: (() => void)[]
}

const WRITE_OPS = /\.(create|update|updateMany|delete|deleteMany|upsert)$/

function knownError(code: 'P2002' | 'P2025', message: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: 'fake', meta })
}

const copy = <T>(value: T): T => structuredClone(value)

/** Prisma treats an undefined value as "not given": the default on create, unchanged on update. */
const given = (data: Row): Row => Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined))

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  return a === b
}

const FILTER_KEYS = new Set(['equals', 'mode', 'in', 'not'])

function fieldMatches(value: unknown, condition: unknown): boolean {
  if (condition === null || typeof condition !== 'object' || condition instanceof Date) return sameValue(value, condition)
  const filter = condition as { equals?: unknown; mode?: string; in?: unknown[]; not?: unknown }
  for (const key of Object.keys(filter)) if (!FILTER_KEYS.has(key)) throw new Error(`fake prisma: unsupported filter "${key}"`)
  const insensitive = filter.mode === 'insensitive'
  const equal = (a: unknown, b: unknown) =>
    insensitive && typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : sameValue(a, b)
  if ('equals' in filter && !equal(value, filter.equals)) return false
  if (filter.in && !filter.in.some((candidate) => equal(value, candidate))) return false
  if ('not' in filter) {
    const not = filter.not
    const excluded = not !== null && typeof not === 'object' && !(not instanceof Date) ? fieldMatches(value, not) : equal(value, not)
    if (excluded) return false
  }
  return true
}

function matches(spec: ModelSpec, row: Row, where: Row | undefined): boolean {
  if (!where) return true
  return Object.entries(where).every(([key, condition]) => {
    if (condition === undefined) return true
    const list = (c: unknown) => (Array.isArray(c) ? c : [c]) as Row[]
    if (key === 'OR') return list(condition).some((w) => matches(spec, row, w))
    if (key === 'AND') return list(condition).every((w) => matches(spec, row, w))
    if (key === 'NOT') return !list(condition).some((w) => matches(spec, row, w))
    if (!spec.columns.includes(key)) throw new Error(`fake prisma: unknown or relation field "${key}" in where`)
    return fieldMatches(row[key], condition)
  })
}

/** Postgres order: NULL sorts after every value, so it comes last ascending and first descending. */
function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a === null || a === undefined) return 1
  if (b === null || b === undefined) return -1
  const plain = (v: unknown) => (v instanceof Date ? v.getTime() : typeof v === 'boolean' ? Number(v) : v) as number | string
  const [x, y] = [plain(a), plain(b)]
  return x < y ? -1 : x > y ? 1 : 0
}

function sortRows(spec: ModelSpec, rows: Row[], orderBy: unknown): Row[] {
  if (orderBy === undefined) return rows
  const order = ((Array.isArray(orderBy) ? orderBy : [orderBy]) as Row[]).map((entry) => {
    const pairs = Object.entries(entry)
    const [field, direction] = pairs[0] ?? []
    if (pairs.length !== 1 || !spec.columns.includes(field as string) || (direction !== 'asc' && direction !== 'desc')) {
      throw new Error(`fake prisma: unsupported orderBy ${JSON.stringify(entry)}`)
    }
    return { field: field as string, sign: direction === 'asc' ? 1 : -1 }
  })
  return [...rows].sort((a, b) => {
    for (const { field, sign } of order) {
      const result = compareValues(a[field], b[field])
      if (result !== 0) return result * sign
    }
    return 0
  })
}

function checkArgs(op: string, args: Row, allowed: readonly string[]) {
  for (const key of Object.keys(args)) if (!allowed.includes(key)) throw new Error(`fake prisma: ${op} does not support "${key}"`)
}

function checkData(model: ModelName, data: Row) {
  for (const key of Object.keys(data)) {
    if (!MODELS[model].columns.includes(key)) throw new Error(`fake prisma: unknown field "${key}" in ${model} data`)
  }
}

function emptyTables(): Record<ModelName, Row[]> {
  return Object.fromEntries(MODEL_NAMES.map((name) => [name, []])) as unknown as Record<ModelName, Row[]>
}

class FakePrismaClient {
  tables = emptyTables()
  authUsers: FakeAuthUser[] = []
  calls: Call[] = []
  private failures = new Map<string, Error>()
  /** Row lock → the transaction holding it. */
  private lockHolders = new Map<string, TransactionState>()
  /** Row lock → the transactions waiting for it. */
  private lockWaiters = new Map<string, (() => void)[]>()

  readonly nutritionProfile = this.delegate('nutritionProfile', null)
  readonly nutritionPreceptorAssignment = this.delegate('nutritionPreceptorAssignment', null)
  readonly nutritionRotation = this.delegate('nutritionRotation', null)
  readonly nutritionCaseLog = this.delegate('nutritionCaseLog', null)
  readonly nutritionEvaluationForm = this.delegate('nutritionEvaluationForm', null)
  readonly nutritionRotationEntry = this.delegate('nutritionRotationEntry', null)
  readonly nutritionWpba = this.delegate('nutritionWpba', null)
  readonly nutritionEpaAssessment = this.delegate('nutritionEpaAssessment', null)
  readonly nutritionStandardsChecklist = this.delegate('nutritionStandardsChecklist', null)
  readonly nutritionMsfInvite = this.delegate('nutritionMsfInvite', null)
  readonly nutritionMsfResponse = this.delegate('nutritionMsfResponse', null)
  readonly nutritionRemediationPlan = this.delegate('nutritionRemediationPlan', null)
  readonly nutritionRemediationStep = this.delegate('nutritionRemediationStep', null)
  readonly nutritionCredential = this.delegate('nutritionCredential', null)
  readonly nutritionAttendanceHoliday = this.delegate('nutritionAttendanceHoliday', null)
  readonly nutritionAttendanceSchedule = this.delegate('nutritionAttendanceSchedule', null)
  readonly nutritionAttendanceRecord = this.delegate('nutritionAttendanceRecord', null)
  readonly nutritionAuditLog = this.delegate('nutritionAuditLog', null)

  reset(): void {
    this.tables = emptyTables()
    this.authUsers = []
    this.calls = []
    this.failures.clear()
    this.lockHolders.clear()
    this.lockWaiters.clear()
  }

  /** The next call of `op` (e.g. "nutritionProfile.create") throws `error` instead of running. */
  failNext(op: string, error: Error = new Error(`fake prisma: injected failure in ${op}`)): void {
    this.failures.set(op, error)
  }

  /** Every write the code under test made (create, update, delete...), in order. */
  writes(): Call[] {
    return this.calls.filter((call) => WRITE_OPS.test(call.op))
  }

  /** Adds a row directly, as test setup; not recorded as a call. */
  seed(model: ModelName, data: Row): Row {
    const row = this.insert(model, data, null)
    return copy(row)
  }

  /** Interactive transactions only, like the actions use. A throw undoes the transaction's writes. */
  async $transaction<T>(fn: (tx: Record<string, unknown>) => Promise<T>): Promise<T> {
    if (typeof fn !== 'function') throw new Error('fake prisma: only interactive transactions are supported')
    const state: TransactionState = { locks: new Set(), undo: [] }
    const tx: Record<string, unknown> = {
      $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => this.queryRaw(state, strings, values),
    }
    for (const model of MODEL_NAMES) tx[model] = this.delegate(model, state)
    try {
      return await fn(tx)
    } catch (error) {
      for (const undo of state.undo.reverse()) undo()
      throw error
    } finally {
      this.releaseLocks(state)
    }
  }

  async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]> {
    return this.queryRaw(null, strings, values)
  }

  /** The raw queries the nutrition code runs: the auth.users lookup, the row locks, the rotation name check. */
  private async queryRaw(state: TransactionState | null, strings: TemplateStringsArray, values: unknown[]): Promise<Row[]> {
    const sql = strings.join('?').replace(/\s+/g, ' ').trim()
    this.record('$queryRaw', { sql, values }, state)
    if (/^SELECT id FROM nutr_profile WHERE id = \? FOR UPDATE$/.test(sql)) {
      return this.lockRows(state, 'nutr_profile', this.tables.nutritionProfile.filter((p) => p.id === values[0]))
    }
    if (/^SELECT id FROM nutr_case_log WHERE id = \? AND "traineeId" = \? FOR UPDATE$/.test(sql)) {
      const rows = this.tables.nutritionCaseLog.filter((c) => c.id === values[0] && c.traineeId === values[1])
      return this.lockRows(state, 'nutr_case_log', rows)
    }
    if (/^SELECT id FROM nutr_case_log WHERE id = \? FOR UPDATE$/.test(sql)) {
      return this.lockRows(state, 'nutr_case_log', this.tables.nutritionCaseLog.filter((c) => c.id === values[0]))
    }
    const nameCheck = /^SELECT id FROM nutr_rotation WHERE lower\(trim\(name\)\) = lower\(trim\(\?\)\)( AND id <> \?)? LIMIT 1$/.exec(sql)
    if (nameCheck) {
      // Postgres trim() strips spaces only; JavaScript's strips all whitespace. Same for these tests.
      const normal = (value: unknown) => String(value).trim().toLowerCase()
      const exceptId = nameCheck[1] ? values[1] : undefined
      const row = this.tables.nutritionRotation.find((r) => r.id !== exceptId && normal(r.name) === normal(values[0]))
      return row ? [{ id: row.id }] : []
    }
    if (/FROM auth\.users WHERE lower\(email\) = \?/.test(sql)) {
      const now = new Date()
      return this.authUsers
        .filter(
          (u) =>
            u.email.toLowerCase() === values[0] &&
            u.confirmed &&
            !u.deleted &&
            !u.anonymous &&
            !(u.bannedUntil && u.bannedUntil > now),
        )
        .map((u) => ({ id: u.id }))
    }
    throw new Error(`fake prisma: unexpected raw query: ${sql}`)
  }

  /** SELECT … FOR UPDATE: waits while another transaction holds a row, then holds it until this one ends. */
  private async lockRows(state: TransactionState | null, table: string, rows: Row[]): Promise<Row[]> {
    if (!state) throw new Error('fake prisma: FOR UPDATE outside a transaction locks nothing')
    for (const row of rows) {
      const key = `${table}:${String(row.id)}`
      for (let holder = this.lockHolders.get(key); holder && holder !== state; holder = this.lockHolders.get(key)) {
        await new Promise<void>((wake) => this.lockWaiters.set(key, [...(this.lockWaiters.get(key) ?? []), wake]))
      }
      this.lockHolders.set(key, state)
      state.locks.add(key)
    }
    return rows.map((row) => ({ id: row.id }))
  }

  private releaseLocks(state: TransactionState): void {
    for (const key of state.locks) {
      this.lockHolders.delete(key)
      const waiters = this.lockWaiters.get(key) ?? []
      this.lockWaiters.delete(key)
      for (const wake of waiters) wake()
    }
    state.locks.clear()
  }

  private record(op: string, args: unknown, state: TransactionState | null): void {
    this.calls.push({ op, args: copy(args), inTransaction: state !== null })
    const failure = this.failures.get(op)
    if (failure) {
      this.failures.delete(op)
      throw failure
    }
  }

  private insert(model: ModelName, data: Row, state: TransactionState | null): Row {
    checkData(model, data)
    const spec: ModelSpec = MODELS[model]
    const row: Row = { ...spec.defaults(new Date()), id: randomUUID(), ...copy(given(data)) }
    for (const column of spec.columns) {
      if (row[column] === undefined) throw new Error(`fake prisma: ${model}.${column} is required`)
    }
    this.assertUnique(model, row)
    const table = this.tables[model]
    table.push(row)
    state?.undo.push(() => {
      const index = table.indexOf(row)
      if (index >= 0) table.splice(index, 1)
    })
    return row
  }

  private change(model: ModelName, row: Row, data: Row, state: TransactionState | null): void {
    const spec: ModelSpec = MODELS[model]
    const updated = { ...row, ...copy(given(data)), ...(spec.updatedAt ? { updatedAt: new Date() } : {}) }
    this.assertUnique(model, updated, row.id)
    const previous = copy(row)
    Object.assign(row, updated)
    state?.undo.push(() => Object.assign(row, previous))
  }

  private assertUnique(model: ModelName, row: Row, ignoreId?: unknown): void {
    for (const column of MODELS[model].unique) {
      if (row[column] === null) continue
      const clash = this.tables[model].some((other) => other.id !== ignoreId && sameValue(other[column], row[column]))
      if (clash) throw knownError('P2002', `Unique constraint failed on the fields: (\`${column}\`)`, { target: [column] })
    }
    const spec: ModelSpec = MODELS[model]
    for (const columns of spec.uniqueTogether ?? []) {
      if (columns.some((column) => row[column] === null)) continue
      const clash = this.tables[model].some(
        (other) => other.id !== ignoreId && columns.every((column) => sameValue(other[column], row[column])),
      )
      if (clash) throw knownError('P2002', `Unique constraint failed on the fields: (${columns.map((c) => `\`${c}\``).join(',')})`, { target: columns })
    }
  }

  private project(spec: ModelSpec, row: Row, select: Row | undefined): Row {
    if (!select) return copy(row)
    const picked: Row = {}
    for (const [key, wanted] of Object.entries(select)) {
      const relation = spec.relations?.[key]
      if (relation) {
        const nested = wanted as { select?: Row } | null
        if (!nested?.select || Object.keys(nested).length !== 1) {
          throw new Error(`fake prisma: select the relation "${key}" as { ${key}: { select: { … } } }`)
        }
        const target = relation.model as ModelName
        const related = this.tables[target].find((other) => other.id === row[relation.foreignKey])
        picked[key] = related ? this.project(MODELS[target], related, nested.select) : null
        continue
      }
      if (wanted !== true) throw new Error(`fake prisma: only plain "key: true" selects are supported (got ${key})`)
      if (!spec.columns.includes(key)) throw new Error(`fake prisma: unknown field "${key}" in select`)
      picked[key] = copy(row[key])
    }
    return picked
  }

  private delegate(model: ModelName, state: TransactionState | null) {
    const spec: ModelSpec = MODELS[model]
    const rows = () => this.tables[model]
    const op = (name: string) => `${model}.${name}`

    return {
      findUnique: async (args: { where: Row; select?: Row }) => {
        checkArgs(op('findUnique'), args, ['where', 'select'])
        this.record(op('findUnique'), args, state)
        const found = rows().filter((row) => matches(spec, row, args.where))
        if (found.length > 1) throw new Error(`fake prisma: ${op('findUnique')} matched ${found.length} rows`)
        return found[0] ? this.project(spec, found[0], args.select) : null
      },
      findFirst: async (args: { where?: Row; select?: Row; orderBy?: unknown }) => {
        checkArgs(op('findFirst'), args, ['where', 'select', 'orderBy'])
        this.record(op('findFirst'), args, state)
        const row = sortRows(spec, rows(), args.orderBy).find((r) => matches(spec, r, args.where))
        return row ? this.project(spec, row, args.select) : null
      },
      findMany: async (args: { where?: Row; select?: Row; orderBy?: unknown } = {}) => {
        checkArgs(op('findMany'), args, ['where', 'select', 'orderBy'])
        this.record(op('findMany'), args, state)
        return sortRows(spec, rows(), args.orderBy)
          .filter((r) => matches(spec, r, args.where))
          .map((r) => this.project(spec, r, args.select))
      },
      count: async (args: { where?: Row } = {}) => {
        checkArgs(op('count'), args, ['where'])
        this.record(op('count'), args, state)
        return rows().filter((r) => matches(spec, r, args.where)).length
      },
      create: async (args: { data: Row; select?: Row }) => {
        checkArgs(op('create'), args, ['data', 'select'])
        this.record(op('create'), args, state)
        return this.project(spec, this.insert(model, args.data, state), args.select)
      },
      update: async (args: { where: Row; data: Row; select?: Row }) => {
        checkArgs(op('update'), args, ['where', 'data', 'select'])
        this.record(op('update'), args, state)
        checkData(model, args.data)
        const found = rows().filter((row) => matches(spec, row, args.where))
        if (found.length === 0) throw knownError('P2025', 'Record to update not found.')
        if (found.length > 1) throw new Error(`fake prisma: ${op('update')} matched ${found.length} rows`)
        this.change(model, found[0], args.data, state)
        return this.project(spec, found[0], args.select)
      },
      updateMany: async (args: { where?: Row; data: Row }) => {
        checkArgs(op('updateMany'), args, ['where', 'data'])
        this.record(op('updateMany'), args, state)
        checkData(model, args.data)
        const found = rows().filter((row) => matches(spec, row, args.where))
        for (const row of found) this.change(model, row, args.data, state)
        return { count: found.length }
      },
      delete: async (args: unknown) => {
        this.record(op('delete'), args, state)
        throw new Error('fake prisma: nutrition rows are never deleted')
      },
      deleteMany: async (args: unknown) => {
        this.record(op('deleteMany'), args, state)
        throw new Error('fake prisma: nutrition rows are never deleted')
      },
    }
  }
}

export type { FakePrismaClient }

/** The one instance the tests install as `prisma` from '@/lib/prisma'. */
export const fakePrisma = new FakePrismaClient()

/** A P2002 error as Prisma throws it, for failure injection. */
export function uniqueViolation(column: string) {
  return knownError('P2002', `Unique constraint failed on the fields: (\`${column}\`)`, { target: [column] })
}
