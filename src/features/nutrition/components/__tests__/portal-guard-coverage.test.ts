import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { PORTAL_SECTIONS, pageRoles } from '../navigation'

// Enforcement: the (portal) layout is never the only guard. Layouts do not
// re-render on client-side navigation and server actions can be called
// directly, so every portal page, every server action and every data loader
// must call requireNutritionRole itself. This test fails the build of any file
// that does not. Server actions and loaders are checked function by function
// on the syntax tree, so one unguarded export in an otherwise guarded file is
// caught too.

const repo = fileURLToPath(new URL('../../../../../', import.meta.url))
const nutritionDir = path.join(repo, 'src/app/(nutrition)/nutrition')
const portalDir = path.join(nutritionDir, '(portal)')
const featureDir = path.join(repo, 'src/features/nutrition')
const serverDir = path.join(featureDir, 'server')
const actionsDir = path.join(serverDir, 'actions')
const queriesDir = path.join(serverDir, 'queries')

// Server actions that only a nutrition ADMIN may call.
const ADMIN_ONLY_ACTION_FILES = ['people.ts', 'rotations.ts']

// The e-logbook: server actions and loaders that only a TRAINEE may call.
const TRAINEE_ONLY_FILES = [path.join(actionsDir, 'case-logs.ts'), path.join(queriesDir, 'case-logs.ts')]

// The case-log review: server actions and loaders that only a PRECEPTOR may call.
const PRECEPTOR_ONLY_FILES = [path.join(actionsDir, 'case-log-reviews.ts'), path.join(queriesDir, 'case-log-reviews.ts')]

// The evaluation forms (Step 4b): each export and the exact roles it admits.
// Form 1.3's individual rows are read only by the TRAINEE loader
// getMyFormOneThree (by hash); the aggregates are for PRECEPTOR, UNIT_LEAD and
// ADMIN, each through its own loader.
const EVALUATION_FORM_ROLES: Record<string, Record<string, string>> = {
  [path.join(actionsDir, 'evaluation-forms.ts')]: {
    startMyEvaluationForm: "['TRAINEE']",
    saveMyEvaluationForm: "['TRAINEE']",
    submitMyEvaluationForm: "['TRAINEE']",
    startMyFormOneThree: "['TRAINEE']",
    saveMyFormOneThree: "['TRAINEE']",
    submitMyFormOneThree: "['TRAINEE']",
    startTraineeEvaluation: "['PRECEPTOR']",
    saveTraineeEvaluation: "['PRECEPTOR']",
    submitTraineeEvaluation: "['PRECEPTOR']",
    reopenEvaluationForm: "['PRECEPTOR']",
    commentOnWeeklyCheckIn: "['PRECEPTOR']",
  },
  [path.join(queriesDir, 'evaluation-forms.ts')]: {
    getMyFormsOverview: "['TRAINEE']",
    getMyDueNow: "['TRAINEE']",
    getMyEvaluationForm: "['TRAINEE']",
    getMyFormOneThree: "['TRAINEE']",
    listMyTraineesForms: "['PRECEPTOR']",
    getTraineeEvaluationForm: "['PRECEPTOR']",
    listMyFormOneThreeFeedback: "['PRECEPTOR']",
    listRotationFormOneThreeFeedback: "['UNIT_LEAD']",
    listAllFormOneThreeFeedback: "['ADMIN']",
  },
}

// The WPBAs (Step 5a): filed by a preceptor or assessor (the action then
// checks primary or rotation), read back by whoever filed them or by the
// trainee. No other role, ADMIN included, has a WPBA loader.
const WPBA_ROLES: Record<string, Record<string, string>> = {
  [path.join(actionsDir, 'wpba.ts')]: {
    submitWpba: "['PRECEPTOR','ASSESSOR']",
  },
  [path.join(queriesDir, 'wpba.ts')]: {
    listMyAssessments: "['PRECEPTOR','ASSESSOR']",
    listMyWpbas: "['TRAINEE']",
    getMyWpbaScorecard: "['TRAINEE']",
  },
  // The read models behind the WPBA screens (Step 5b).
  [path.join(queriesDir, 'wpba-picker.ts')]: {
    listAssessableTrainees: "['PRECEPTOR','ASSESSOR']",
    listCbdCaseLogs: "['PRECEPTOR','ASSESSOR']",
    getMyLatestAssessment: "['PRECEPTOR','ASSESSOR']",
    listPrimaryTraineeScorecards: "['PRECEPTOR']",
  },
}

// EPA entrustment and the Month 9 standards checklist (Step 6a): written only
// by a PRECEPTOR (the action then checks ACTIVE primary); the trainee reads
// only their own EPA history. No other role has a loader.
const EPA_STANDARDS_ROLES: Record<string, Record<string, string>> = {
  [path.join(actionsDir, 'epa.ts')]: {
    assignEpaLevel: "['PRECEPTOR']",
  },
  [path.join(actionsDir, 'standards-checklist.ts')]: {
    startStandardsChecklist: "['PRECEPTOR']",
    saveStandardsChecklist: "['PRECEPTOR']",
    submitStandardsChecklist: "['PRECEPTOR']",
  },
  [path.join(queriesDir, 'epa.ts')]: {
    listMyTraineesEpa: "['PRECEPTOR']",
    getMyEpaHistory: "['TRAINEE']",
  },
  [path.join(queriesDir, 'standards-checklist.ts')]: {
    getTraineeStandardsChecklist: "['PRECEPTOR']",
  },
}

// The WPBA pages (Step 5b) and exactly who may open each one.
const WPBA_PAGE_ROLES: Record<string, readonly string[]> = {
  '/nutrition/preceptor/wpba': ['PRECEPTOR', 'ASSESSOR'],
  '/nutrition/trainee/assessments': ['TRAINEE'],
  '/nutrition/preceptor/scorecard': ['PRECEPTOR'],
}

// The EPA and Month 9 checklist pages (Step 6b) and exactly who may open each one.
// MSF links and remediation (Step 6c): written only by a PRECEPTOR (the
// action then checks ACTIVE primary); the trainee reads only their own MSF
// averages and their own plans. Unit leads and admins have no loader.
const MSF_REMEDIATION_ROLES: Record<string, Record<string, string>> = {
  [path.join(actionsDir, 'msf.ts')]: {
    createMsfInvite: "['PRECEPTOR']",
    revokeMsfInvite: "['PRECEPTOR']",
  },
  [path.join(queriesDir, 'msf.ts')]: {
    listMyTraineesMsf: "['PRECEPTOR']",
    getMyMsfSummary: "['TRAINEE']",
  },
  [path.join(actionsDir, 'remediation.ts')]: {
    createRemediationPlan: "['PRECEPTOR']",
    flagDeficiency: "['PRECEPTOR']",
    setRemediationActivity: "['PRECEPTOR']",
    scheduleReassessment: "['PRECEPTOR']",
    linkReassessmentWpba: "['PRECEPTOR']",
    setRemediationOutcome: "['PRECEPTOR']",
    closeRemediationPlan: "['PRECEPTOR']",
  },
  [path.join(queriesDir, 'remediation.ts')]: {
    getTraineeRemediation: "['PRECEPTOR']",
    getMyRemediation: "['TRAINEE']",
  },
}

// The public MSF code (Step 6c): unguarded on purpose, so it may touch only the
// MSF tables and may import only these server modules (none of them reads the
// database or checks roles).
const publicDir = path.join(serverDir, 'public')
// Each public file: its first statement, the only models it may touch, and
// the only server modules it may import.
const PUBLIC_FILES: Record<string, { directive: 'use server' | 'server-only'; models: readonly string[]; serverImports: readonly string[] }> = {
  'msf.ts': { directive: 'use server', models: ['nutritionMsfInvite', 'nutritionMsfResponse'], serverImports: ['action-helpers', 'msf-core', 'msf-token'] },
  // The certificate check (Step 7): a plain server-only loader, not a server action.
  'verify.ts': { directive: 'server-only', models: ['nutritionCredential'], serverImports: [] },
}

// The portfolio, summary, certificate, analytics and export (Step 7).
const STEP7_ROLES: Record<string, Record<string, string>> = {
  [path.join(queriesDir, 'portfolio.ts')]: {
    getMyPortfolio: "['TRAINEE']",
    getTraineeSummary: "['PRECEPTOR']",
    getMyCertificate: "['TRAINEE']",
    getProgramAnalytics: "['ADMIN']",
    getProgramMetricsCsv: "['ADMIN']",
  },
  [path.join(actionsDir, 'credentials.ts')]: {
    issueCompletionCredential: "['PRECEPTOR']",
  },
}

const STEP7_PAGE_ROLES: Record<string, readonly string[]> = {
  '/nutrition/trainee/portfolio': ['TRAINEE'],
  '/nutrition/trainee/certificate': ['TRAINEE'],
  '/nutrition/admin/analytics': ['ADMIN'],
  '/nutrition/admin/export': ['ADMIN'],
}

// Step 7 sub-pages with no sidebar entry: guarded with a listed parent page's roles.
const STEP7_SUBPAGES: Record<string, { constName: string; parent: string; roles: readonly string[] }> = {
  'trainee/portfolio/summary': { constName: 'PORTFOLIO_HREF', parent: '/nutrition/trainee/portfolio', roles: ['TRAINEE'] },
  'preceptor/summary/[traineeId]': { constName: 'EPA_HREF', parent: '/nutrition/preceptor/epa', roles: ['PRECEPTOR'] },
}

const EPA_PAGE_ROLES: Record<string, readonly string[]> = {
  '/nutrition/preceptor/epa': ['PRECEPTOR'],
  '/nutrition/preceptor/checklist': ['PRECEPTOR'],
  '/nutrition/trainee/epa': ['TRAINEE'],
}

// The MSF and remediation pages (Step 6c UI) and exactly who may open each one.
const MSF_REMEDIATION_PAGE_ROLES: Record<string, readonly string[]> = {
  '/nutrition/preceptor/msf': ['PRECEPTOR'],
  '/nutrition/preceptor/remediation': ['PRECEPTOR'],
  '/nutrition/trainee/remediation': ['TRAINEE'],
}

// Attendance (Step A4). Check-in and check-out: TRAINEE only. Schedules and
// holidays: PRECEPTOR (own scope) and ADMIN (program). Edit: PRECEPTOR and
// ADMIN at the guard, then the action admits any nutrition ADMIN (a
// super_admin counts as one) or the ACTIVE primary preceptor. Void: any
// nutrition ADMIN.
// No delete action exists.
const ATTENDANCE_ROLES: Record<string, Record<string, string>> = {
  [path.join(actionsDir, 'attendance.ts')]: {
    checkIn: "['TRAINEE']",
    checkOut: "['TRAINEE']",
    setSchedule: "['PRECEPTOR','ADMIN']",
    setHoliday: "['PRECEPTOR','ADMIN']",
    editRecord: "['PRECEPTOR','ADMIN']",
    voidRecord: "['ADMIN']",
    // Same editors as editRecord: then any nutrition ADMIN or the ACTIVE primary preceptor.
    createMissedRecord: "['PRECEPTOR','ADMIN']",
    // Then any nutrition ADMIN (any holiday), or the holiday's own preceptor.
    voidHoliday: "['PRECEPTOR','ADMIN']",
  },
  [path.join(queriesDir, 'attendance.ts')]: {
    getMyAttendance: "['TRAINEE']",
    listMyTraineesAttendance: "['PRECEPTOR']",
    getProgramAttendanceSummary: "['ADMIN']",
    // Then super_admin only: any other ADMIN is sent to no-access.
    listAttendanceRecordsForVoid: "['ADMIN']",
    // Step 8 UI loaders.
    getMyCheckInStatus: "['TRAINEE']",
    getMyAttendanceCalendar: "['TRAINEE']",
    getTraineeAttendanceCalendar: "['PRECEPTOR']",
    listMyAttendanceSettings: "['PRECEPTOR']",
    getProgramAttendanceSettings: "['ADMIN']",
  },
  // Late / early / hours-worked graphs: read only, same visibility as above.
  [path.join(queriesDir, 'attendance-hours.ts')]: {
    getMyAttendanceHours: "['TRAINEE']",
    listMyTraineesAttendanceHours: "['PRECEPTOR']",
    getProgramAttendanceHours: "['ADMIN']",
  },
}

// The attendance pages (Step 8 UI) and exactly who may open each one. The
// super_admin record list is a section of the admin page, not a page.
const ATTENDANCE_PAGE_ROLES: Record<string, readonly string[]> = {
  '/nutrition/trainee/attendance': ['TRAINEE'],
  '/nutrition/preceptor/attendance': ['PRECEPTOR'],
  '/nutrition/preceptor/attendance-settings': ['PRECEPTOR'],
  '/nutrition/admin/attendance': ['ADMIN'],
}

const CALLS_GUARD = /\brequireNutritionRole\s*\(/

function filesUnder(dir: string, keep: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return []
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((rel) => keep(path.basename(rel)))
    .map((rel) => path.join(dir, rel))
}

const sourceFiles = (dir: string) =>
  filesUnder(dir, (name) => /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)).filter(
    (file) => !file.split(path.sep).includes('__tests__'),
  )

/** Source without comments, so a commented-out call does not count. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const rel = (file: string) => path.relative(repo, file).split(path.sep).join('/')

function parse(file: string): ts.SourceFile {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, kind)
}

function hasDirective(source: ts.SourceFile, directive: string): boolean {
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false
    if (statement.expression.text === directive) return true
  }
  return false
}

const isExported = (node: ts.Node) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)

const isAsync = (node: ts.Node) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)

/** The arguments of `await requireNutritionRole(...)` if that is this statement, else null. */
function guardArguments(statement: ts.Statement | undefined, source: ts.SourceFile): string | null {
  if (!statement) return null
  let expression: ts.Expression | undefined
  if (ts.isExpressionStatement(statement)) expression = statement.expression
  else if (ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1) {
    expression = statement.declarationList.declarations[0].initializer
  }
  if (!expression || !ts.isAwaitExpression(expression)) return null
  const call = expression.expression
  if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== 'requireNutritionRole') return null
  if (call.arguments.length !== 1) return null
  return call.arguments[0].getText(source).replace(/\s+/g, '')
}

interface ExportedFunction {
  name: string
  /** Why it fails the rule, or null. */
  problem: string | null
  /** The guard's argument, as written, e.g. ['ADMIN']. */
  roles: string | null
}

/** Every export of a module, checked: an async function whose first statement awaits the guard. */
function exportedFunctions(file: string): ExportedFunction[] {
  const source = parse(file)
  const found: ExportedFunction[] = []

  const check = (name: string, fn: ts.FunctionLikeDeclaration | undefined) => {
    if (!fn) return found.push({ name, problem: 'exported, but not a function', roles: null })
    if (!isAsync(fn)) return found.push({ name, problem: 'not async', roles: null })
    if (!fn.body || !ts.isBlock(fn.body)) return found.push({ name, problem: 'no block body', roles: null })
    const roles = guardArguments(fn.body.statements[0], source)
    found.push({ name, roles, problem: roles ? null : 'first statement is not `await requireNutritionRole(...)`' })
  }

  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && isExported(statement)) {
      check(statement.name?.text ?? 'default', statement)
    } else if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer
        const fn = init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? init : undefined
        check(declaration.name.getText(source), fn)
      }
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      found.push({ name: statement.getText(source), problem: 're-export: define the function here so it can be checked', roles: null })
    } else if (ts.isExportAssignment(statement)) {
      found.push({ name: 'default', problem: 'export default of an expression cannot be checked', roles: null })
    }
  }
  return found
}

function guardProblems(files: string[]): { problems: string[]; checked: string[] } {
  const problems: string[] = []
  const checked: string[] = []
  for (const file of files) {
    for (const fn of exportedFunctions(file)) {
      checked.push(`${rel(file)}#${fn.name}`)
      if (fn.problem) problems.push(`${rel(file)}#${fn.name}: ${fn.problem}`)
    }
  }
  return { problems, checked }
}

/** Where an import specifier points, as an absolute path without extension; null for packages. */
function resolveImport(fromFile: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) return path.join(repo, 'src', specifier.slice(2))
  if (specifier.startsWith('.')) return path.resolve(path.dirname(fromFile), specifier)
  return null
}

describe('every portal page, server action and data loader guards itself', () => {
  it('every page.tsx under (portal) calls requireNutritionRole(', () => {
    const pages = filesUnder(portalDir, (name) => name === 'page.tsx')
    expect(pages.map(rel)).toContain('src/app/(nutrition)/nutrition/(portal)/page.tsx')
    expect(pages.length).toBeGreaterThan(1)
    expect(pages.filter((file) => !CALLS_GUARD.test(code(file))).map(rel)).toEqual([])
  })

  it('every exported server action is async and FIRST awaits requireNutritionRole(...)', () => {
    const files = sourceFiles(actionsDir)
    const { problems, checked } = guardProblems(files)
    expect(problems).toEqual([])
    // Not vacuous: the 3d actions are all found and checked.
    for (const name of ['linkProfile', 'createProfileWithAccount', 'updateProfile', 'setTrainingStartDate', 'assignPreceptor', 'endAssignment']) {
      expect(checked).toContain(`src/features/nutrition/server/actions/people.ts#${name}`)
    }
    for (const name of ['createRotation', 'renameRotation', 'setRotationActive']) {
      expect(checked).toContain(`src/features/nutrition/server/actions/rotations.ts#${name}`)
    }
    for (const name of ['createCaseLog', 'updateCaseLog', 'submitCaseLog']) {
      expect(checked).toContain(`src/features/nutrition/server/actions/case-logs.ts#${name}`)
    }
    for (const name of ['approveCaseLog', 'rejectCaseLog']) {
      expect(checked).toContain(`src/features/nutrition/server/actions/case-log-reviews.ts#${name}`)
    }
    for (const name of Object.keys(EVALUATION_FORM_ROLES[path.join(actionsDir, 'evaluation-forms.ts')])) {
      expect(checked).toContain(`src/features/nutrition/server/actions/evaluation-forms.ts#${name}`)
    }
    expect(checked).toContain('src/features/nutrition/server/actions/wpba.ts#submitWpba')
  })

  it('the WPBA action and loaders: exactly these exports, each with exactly its roles (no edit or delete action exists)', () => {
    for (const [file, expected] of Object.entries(WPBA_ROLES)) {
      const found = Object.fromEntries(exportedFunctions(file).map((fn) => [fn.name, fn.roles]))
      expect({ file: rel(file), found }).toEqual({ file: rel(file), found: expected })
    }
  })

  it('the MSF and remediation actions and loaders: exactly these exports, each with exactly its roles', () => {
    for (const [file, expected] of Object.entries(MSF_REMEDIATION_ROLES)) {
      const found = Object.fromEntries(exportedFunctions(file).map((fn) => [fn.name, fn.roles]))
      expect({ file: rel(file), found }).toEqual({ file: rel(file), found: expected })
    }
  })

  it('the public code never uses the guard, touches only its own tables, and imports only pure server modules', () => {
    const files = sourceFiles(publicDir)
    expect(files.map((file) => path.basename(file)).sort()).toEqual(Object.keys(PUBLIC_FILES).sort())
    const problems: string[] = []
    for (const file of files) {
      const rule = PUBLIC_FILES[path.basename(file)]
      const source = parse(file)
      const text = code(file)
      if (rule.directive === 'use server' && !hasDirective(source, 'use server')) problems.push(`${rel(file)}: not a 'use server' module`)
      if (rule.directive === 'server-only') {
        if (hasDirective(source, 'use server')) problems.push(`${rel(file)}: must not be a server action module`)
        const first = source.statements[0]
        if (!(first && ts.isImportDeclaration(first) && (first.moduleSpecifier as ts.StringLiteral).text === 'server-only')) {
          problems.push(`${rel(file)}: not marked 'server-only'`)
        }
      }
      if (CALLS_GUARD.test(text)) problems.push(`${rel(file)}: calls requireNutritionRole`)
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement)) continue
        const specifier = (statement.moduleSpecifier as ts.StringLiteral).text
        if (/features\/nutrition\/auth|\/auth\/|^\.\.?\/.*guard/.test(specifier)) problems.push(`${rel(file)} imports ${specifier}`)
        const target = resolveImport(file, specifier)
        if (target && target.startsWith(serverDir + path.sep) && !rule.serverImports.includes(path.basename(target))) {
          problems.push(`${rel(file)} imports server module ${specifier}`)
        }
      }
      const models = [...text.matchAll(/\b(?:prisma|tx)\.(\w+)/g)].map((m) => m[1]).filter((name) => !name.startsWith('$'))
      for (const model of new Set(models)) if (!rule.models.includes(model)) problems.push(`${rel(file)} touches ${model}`)
      expect(models.length).toBeGreaterThan(0)
    }
    // The modules they may import read no database themselves.
    for (const name of new Set(Object.values(PUBLIC_FILES).flatMap((rule) => rule.serverImports))) {
      expect({ name, readsDb: /\b(?:prisma|tx|db)\.\w+\.(?:find|create|update|count)/.test(code(path.join(serverDir, `${name}.ts`))) }).toEqual({ name, readsDb: false })
    }
    expect(problems).toEqual([])
  })

  it('the verify loader queries only NutritionCredential, by verificationId, and exports only itself', () => {
    const file = path.join(publicDir, 'verify.ts')
    const text = code(file)
    expect([...text.matchAll(/\bprisma\.(\w+)\.(\w+)\(/g)].map((m) => `${m[1]}.${m[2]}`)).toEqual(['nutritionCredential.findUnique'])
    expect(text).toMatch(/where:\s*\{\s*verificationId\s*\}/)
    expect(exportedFunctions(file).map((fn) => fn.name)).toEqual(['getCredentialVerification'])
  })

  it('each attendance page first awaits requireNutritionRole(pageRoles(HREF)), and its href admits exactly its roles', () => {
    for (const [href, roles] of Object.entries(ATTENDANCE_PAGE_ROLES)) {
      expect({ href, roles: [...pageRoles(href)].sort() }).toEqual({ href, roles: [...roles].sort() })
      const file = path.join(portalDir, ...href.replace(/^\/nutrition\//, '').split('/'), 'page.tsx')
      const source = parse(file)
      const page = source.statements.find(
        (statement): statement is ts.FunctionDeclaration =>
          ts.isFunctionDeclaration(statement) && (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword),
      )
      expect({ href, guard: page?.body ? guardArguments(page.body.statements[0], source) : null }).toEqual({ href, guard: 'pageRoles(HREF)' })
      expect(code(file)).toContain(`const HREF = '${href}'`)
      expect(code(file)).not.toContain('ComingSoon')
    }
    // The super_admin list loader is called only behind access.isSuperAdmin.
    expect(code(path.join(portalDir, 'admin', 'attendance', 'page.tsx'))).toMatch(/access\.isSuperAdmin && summary \? await listAttendanceRecordsForVoid\(/)
  })

  it('the attendance actions and loaders: exactly these exports, each with exactly its roles (no delete action exists)', () => {
    for (const [file, expected] of Object.entries(ATTENDANCE_ROLES)) {
      const found = Object.fromEntries(exportedFunctions(file).map((fn) => [fn.name, fn.roles]))
      expect({ file: rel(file), found }).toEqual({ file: rel(file), found: expected })
    }
  })

  it('the Step 7 loaders and the credential action: exactly these exports, each with exactly its roles', () => {
    for (const [file, expected] of Object.entries(STEP7_ROLES)) {
      const found = Object.fromEntries(exportedFunctions(file).map((fn) => [fn.name, fn.roles]))
      expect({ file: rel(file), found }).toEqual({ file: rel(file), found: expected })
    }
  })

  it('each Step 7 page first awaits requireNutritionRole(pageRoles(HREF)), and its href admits exactly its roles', () => {
    for (const [href, roles] of Object.entries(STEP7_PAGE_ROLES)) {
      expect({ href, roles: [...pageRoles(href)].sort() }).toEqual({ href, roles: [...roles].sort() })
      const file = path.join(portalDir, ...href.replace(/^\/nutrition\//, '').split('/'), 'page.tsx')
      const source = parse(file)
      const page = source.statements.find(
        (statement): statement is ts.FunctionDeclaration =>
          ts.isFunctionDeclaration(statement) && (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword),
      )
      expect({ href, guard: page?.body ? guardArguments(page.body.statements[0], source) : null }).toEqual({ href, guard: 'pageRoles(HREF)' })
      expect(code(file)).toContain(`const HREF = '${href}'`)
      expect(code(file)).not.toContain('ComingSoon')
    }
  })

  it("each Step 7 sub-page first awaits requireNutritionRole(pageRoles(<parent>)), and the parent admits exactly its roles", () => {
    for (const [dir, { constName, parent, roles }] of Object.entries(STEP7_SUBPAGES)) {
      const file = path.join(portalDir, ...dir.split('/'), 'page.tsx')
      const source = parse(file)
      const page = source.statements.find(
        (statement): statement is ts.FunctionDeclaration =>
          ts.isFunctionDeclaration(statement) && (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword),
      )
      expect({ dir, guard: page?.body ? guardArguments(page.body.statements[0], source) : null }).toEqual({ dir, guard: `pageRoles(${constName})` })
      expect(code(file)).toContain(`const ${constName} = '${parent}'`)
      expect({ dir, roles: [...pageRoles(parent)].sort() }).toEqual({ dir, roles: [...roles].sort() })
    }
  })

  it('the EPA and standards checklist actions and loaders: exactly these exports, each with exactly its roles (no edit or delete of an EPA row exists)', () => {
    for (const [file, expected] of Object.entries(EPA_STANDARDS_ROLES)) {
      const found = Object.fromEntries(exportedFunctions(file).map((fn) => [fn.name, fn.roles]))
      expect({ file: rel(file), found }).toEqual({ file: rel(file), found: expected })
    }
  })

  it('each WPBA page first awaits requireNutritionRole(pageRoles(HREF)), and its href admits exactly its roles', () => {
    for (const [href, roles] of Object.entries(WPBA_PAGE_ROLES)) {
      expect({ href, roles: [...pageRoles(href)].sort() }).toEqual({ href, roles: [...roles].sort() })
      const file = path.join(portalDir, ...href.replace(/^\/nutrition\//, '').split('/'), 'page.tsx')
      const source = parse(file)
      const page = source.statements.find(
        (statement): statement is ts.FunctionDeclaration =>
          ts.isFunctionDeclaration(statement) && (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword),
      )
      expect({ href, guard: page?.body ? guardArguments(page.body.statements[0], source) : null }).toEqual({ href, guard: 'pageRoles(HREF)' })
      expect(code(file)).toContain(`const HREF = '${href}'`)
    }
  })

  it('each MSF and remediation page first awaits requireNutritionRole(pageRoles(HREF)), and its href admits exactly its roles', () => {
    for (const [href, roles] of Object.entries(MSF_REMEDIATION_PAGE_ROLES)) {
      expect({ href, roles: [...pageRoles(href)].sort() }).toEqual({ href, roles: [...roles].sort() })
      const file = path.join(portalDir, ...href.replace(/^\/nutrition\//, '').split('/'), 'page.tsx')
      const source = parse(file)
      const page = source.statements.find(
        (statement): statement is ts.FunctionDeclaration =>
          ts.isFunctionDeclaration(statement) && (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword),
      )
      expect({ href, guard: page?.body ? guardArguments(page.body.statements[0], source) : null }).toEqual({ href, guard: 'pageRoles(HREF)' })
      expect(code(file)).toContain(`const HREF = '${href}'`)
      expect(code(file)).not.toContain('ComingSoon')
    }
  })

  it('each EPA and checklist page first awaits requireNutritionRole(pageRoles(HREF)), and its href admits exactly its roles', () => {
    for (const [href, roles] of Object.entries(EPA_PAGE_ROLES)) {
      expect({ href, roles: [...pageRoles(href)].sort() }).toEqual({ href, roles: [...roles].sort() })
      const file = path.join(portalDir, ...href.replace(/^\/nutrition\//, '').split('/'), 'page.tsx')
      const source = parse(file)
      const page = source.statements.find(
        (statement): statement is ts.FunctionDeclaration =>
          ts.isFunctionDeclaration(statement) && (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword),
      )
      expect({ href, guard: page?.body ? guardArguments(page.body.statements[0], source) : null }).toEqual({ href, guard: 'pageRoles(HREF)' })
      expect(code(file)).toContain(`const HREF = '${href}'`)
      expect(code(file)).not.toContain('ComingSoon')
    }
  })

  it('the evaluation-form actions and loaders: exactly these exports, each with exactly its roles', () => {
    for (const [file, expected] of Object.entries(EVALUATION_FORM_ROLES)) {
      const found = Object.fromEntries(exportedFunctions(file).map((fn) => [fn.name, fn.roles]))
      expect({ file: rel(file), found }).toEqual({ file: rel(file), found: expected })
    }
  })

  it('only the Form 1.3 modules touch authorHash, and only the evaluation-form actions and loaders use form-1-3.ts', () => {
    const serverFiles = sourceFiles(serverDir)
    const mentionsHash = serverFiles.filter((file) => /\bauthorHash\b/.test(code(file))).map(rel)
    expect(mentionsHash.sort()).toEqual(
      [
        'src/features/nutrition/server/actions/evaluation-forms.ts',
        'src/features/nutrition/server/author-hash.ts',
        'src/features/nutrition/server/form-1-3.ts',
        'src/features/nutrition/server/start-date-lock.ts',
      ].sort(),
    )
    const usesFormOneThree = serverFiles.filter((file) => /from '\.{1,2}\/form-1-3'/.test(readFileSync(file, 'utf8'))).map(rel)
    expect(usesFormOneThree.sort()).toEqual(
      ['src/features/nutrition/server/actions/evaluation-forms.ts', 'src/features/nutrition/server/queries/evaluation-forms.ts'].sort(),
    )
  })

  it("every server action file is a 'use server' module", () => {
    const files = sourceFiles(actionsDir)
    expect(files.length).toBeGreaterThan(0)
    expect(files.filter((file) => !hasDirective(parse(file), 'use server')).map(rel)).toEqual([])
  })

  it("the admin actions allow exactly ['ADMIN']", () => {
    const wrong: string[] = []
    for (const name of ADMIN_ONLY_ACTION_FILES) {
      for (const fn of exportedFunctions(path.join(actionsDir, name))) {
        if (fn.roles !== "['ADMIN']") wrong.push(`${name}#${fn.name}: requireNutritionRole(${fn.roles})`)
      }
    }
    expect(wrong).toEqual([])
  })

  it("the e-logbook's actions and loaders allow exactly ['TRAINEE']", () => {
    const wrong: string[] = []
    let checked = 0
    for (const file of TRAINEE_ONLY_FILES) {
      for (const fn of exportedFunctions(file)) {
        checked++
        if (fn.roles !== "['TRAINEE']") wrong.push(`${rel(file)}#${fn.name}: requireNutritionRole(${fn.roles})`)
      }
    }
    expect(wrong).toEqual([])
    expect(checked).toBe(6)
  })

  it("the case-log review's actions and loaders allow exactly ['PRECEPTOR']", () => {
    const wrong: string[] = []
    let checked = 0
    for (const file of PRECEPTOR_ONLY_FILES) {
      for (const fn of exportedFunctions(file)) {
        checked++
        if (fn.roles !== "['PRECEPTOR']") wrong.push(`${rel(file)}#${fn.name}: requireNutritionRole(${fn.roles})`)
      }
    }
    expect(wrong).toEqual([])
    expect(checked).toBe(5)
  })

  it('every exported data loader in server/queries FIRST awaits requireNutritionRole(...)', () => {
    const { problems, checked } = guardProblems(sourceFiles(queriesDir))
    expect(problems).toEqual([])
    expect(checked).toEqual(
      expect.arrayContaining([
        'src/features/nutrition/server/queries/people.ts#listPeople',
        'src/features/nutrition/server/queries/people.ts#getPersonDetail',
        'src/features/nutrition/server/queries/rotations.ts#listRotations',
        'src/features/nutrition/server/queries/case-logs.ts#listMyCaseLogs',
        'src/features/nutrition/server/queries/case-logs.ts#getMyCaseLog',
        'src/features/nutrition/server/queries/case-logs.ts#listLogbookRotations',
        'src/features/nutrition/server/queries/case-log-reviews.ts#listReviewQueue',
        'src/features/nutrition/server/queries/case-log-reviews.ts#listReviewHistory',
        'src/features/nutrition/server/queries/case-log-reviews.ts#getReviewCaseLog',
        ...Object.keys(EVALUATION_FORM_ROLES[path.join(queriesDir, 'evaluation-forms.ts')]).map(
          (name) => `src/features/nutrition/server/queries/evaluation-forms.ts#${name}`,
        ),
        ...Object.keys(WPBA_ROLES[path.join(queriesDir, 'wpba.ts')]).map((name) => `src/features/nutrition/server/queries/wpba.ts#${name}`),
        ...Object.keys(WPBA_ROLES[path.join(queriesDir, 'wpba-picker.ts')]).map(
          (name) => `src/features/nutrition/server/queries/wpba-picker.ts#${name}`,
        ),
      ]),
    )
  })

  it('each sidebar page exists and guards itself with its own href', () => {
    const problems: string[] = []
    for (const section of PORTAL_SECTIONS) {
      for (const page of section.pages) {
        const file = path.join(portalDir, ...page.href.replace(/^\/nutrition\//, '').split('/'), 'page.tsx')
        if (!existsSync(file)) {
          problems.push(`${page.href}: missing ${rel(file)}`)
          continue
        }
        const source = code(file)
        if (!source.includes(`const HREF = '${page.href}'`)) problems.push(`${page.href}: HREF is not its own href`)
        if (!/requireNutritionRole\(\s*pageRoles\(\s*HREF\s*\)\s*\)/.test(source)) problems.push(`${page.href}: not guarded with pageRoles(HREF)`)
      }
    }
    expect(problems).toEqual([])
  })

  it('the public MSF page /nutrition/msf/[token] sits outside (portal), carries no guard and loads only from server/public', () => {
    expect(existsSync(path.join(portalDir, 'msf'))).toBe(false)
    const file = path.join(nutritionDir, 'msf', '[token]', 'page.tsx')
    expect(existsSync(file)).toBe(true)
    // It is the only page under /nutrition/msf.
    expect(filesUnder(path.join(nutritionDir, 'msf'), (name) => name === 'page.tsx').map(rel)).toEqual(['src/app/(nutrition)/nutrition/msf/[token]/page.tsx'])
    const text = code(file)
    expect(CALLS_GUARD.test(text)).toBe(false)
    expect(text).not.toMatch(/features\/nutrition\/auth/)
    const serverImports = [...text.matchAll(/from '(@\/features\/nutrition\/server\/[^']+)'/g)].map((m) => m[1])
    expect(serverImports.filter((specifier) => !specifier.startsWith('@/features/nutrition/server/public/'))).toEqual([])
  })

  it('the public verify page /nutrition/verify/[id] sits outside (portal), carries no guard, imports no server action and loads only from server/public/verify', () => {
    expect(existsSync(path.join(portalDir, 'verify'))).toBe(false)
    expect(filesUnder(path.join(nutritionDir, 'verify'), (name) => name === 'page.tsx').map(rel)).toEqual(['src/app/(nutrition)/nutrition/verify/[id]/page.tsx'])
    const text = code(path.join(nutritionDir, 'verify', '[id]', 'page.tsx'))
    expect(CALLS_GUARD.test(text)).toBe(false)
    expect(text).not.toMatch(/features\/nutrition\/auth/)
    const serverImports = [...text.matchAll(/from '(@\/features\/nutrition\/server\/[^']+)'/g)].map((m) => m[1])
    expect(serverImports).toEqual(['@/features/nutrition/server/public/verify'])
  })

  it('the public pages sit outside (portal) and carry no guard (a guarded login page would loop)', () => {
    for (const page of ['login', 'no-access']) {
      const file = path.join(nutritionDir, page, 'page.tsx')
      expect(existsSync(file)).toBe(true)
      expect(CALLS_GUARD.test(code(file))).toBe(false)
      expect(existsSync(path.join(portalDir, page))).toBe(false)
    }
  })
})

describe('server code stays on the server', () => {
  const clientFiles = [...sourceFiles(featureDir), ...sourceFiles(nutritionDir)].filter((file) =>
    hasDirective(parse(file), 'use client'),
  )

  it("no 'use client' module imports nutrition server code (except server actions, or `import type`) or Prisma", () => {
    expect(clientFiles.map(rel)).toEqual(
      expect.arrayContaining([
        'src/features/nutrition/components/admin/AddPerson.tsx',
        'src/features/nutrition/components/admin/RotationsAdmin.tsx',
        'src/features/nutrition/components/logbook/CaseLogForm.tsx',
        'src/features/nutrition/components/reviews/ReviewForm.tsx',
        'src/app/(nutrition)/nutrition/error.tsx',
      ]),
    )
    const problems: string[] = []
    for (const file of clientFiles) {
      const source = parse(file)
      for (const statement of source.statements) {
        const isImport = ts.isImportDeclaration(statement)
        const isReExport = ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined
        if (!isImport && !isReExport) continue
        if (isImport && statement.importClause?.isTypeOnly) continue
        if (isReExport && statement.isTypeOnly) continue
        const specifier = (statement.moduleSpecifier as ts.StringLiteral).text
        const target = resolveImport(file, specifier)
        const intoServer = target !== null && (target === serverDir || target.startsWith(serverDir + path.sep))
        const intoActions = target !== null && target.startsWith(actionsDir + path.sep)
        if ((intoServer && !intoActions) || specifier === '@/lib/prisma') {
          problems.push(`${rel(file)} imports ${specifier}`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('no client module names the service-role key variable or its module (even in a dynamic import)', () => {
    const offenders = clientFiles.filter((file) => /SUPABASE_SERVICE_ROLE_KEY|\/service-role['"]/.test(code(file)))
    expect(offenders.map(rel)).toEqual([])
  })

  it("the modules holding the service-role key, reading auth.users or loading data are marked 'server-only'", () => {
    const serverOnly = [
      path.join(serverDir, 'service-role.ts'),
      path.join(serverDir, 'auth-users.ts'),
      // The Form 1.3 hash key and the code that holds or finds authorship (Step 4).
      path.join(serverDir, 'author-hash.ts'),
      path.join(serverDir, 'form-1-3.ts'),
      path.join(serverDir, 'start-date-lock.ts'),
      path.join(serverDir, 'lock-trainee-row.ts'),
      path.join(serverDir, 'evaluation-forms-core.ts'),
      // WPBA scoring (Step 5a).
      path.join(serverDir, 'wpba-core.ts'),
      // EPA and standards checklist rules, and the primary-trainee lock (Step 6a).
      path.join(serverDir, 'epa-core.ts'),
      path.join(serverDir, 'primary-trainee.ts'),
      // MSF tokens and rules, and remediation rules (Step 6c).
      path.join(serverDir, 'msf-token.ts'),
      path.join(serverDir, 'msf-core.ts'),
      path.join(serverDir, 'remediation-core.ts'),
      // Portfolio, analytics and credential rules, and the public verify loader (Step 7).
      path.join(serverDir, 'portfolio-core.ts'),
      path.join(publicDir, 'verify.ts'),
      // Attendance rules and their schedule and holiday loader (Step A4).
      path.join(serverDir, 'attendance-core.ts'),
      path.join(serverDir, 'attendance-rules.ts'),
      // Late, early and hours-worked rules for the attendance graphs.
      path.join(serverDir, 'attendance-hours-core.ts'),
      ...sourceFiles(queriesDir),
    ]
    const unmarked = serverOnly.filter((file) => {
      const first = parse(file).statements[0]
      return !(first && ts.isImportDeclaration(first) && (first.moduleSpecifier as ts.StringLiteral).text === 'server-only' && !first.importClause)
    })
    expect(unmarked.map(rel)).toEqual([])
  })
})
