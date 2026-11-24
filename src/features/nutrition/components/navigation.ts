import type { NutritionRole } from '@prisma/client'

// The nutrition portal's pages: who may open each one, and how the sidebar
// lists them. One table, so the sidebar and the page guards cannot drift apart.
// Every page.tsx under (portal) calls requireNutritionRole(pageRoles(HREF))
// with its own href, and the sidebar only shows a link to someone that page
// would let in. Pure data and functions, safe in both server and client code.

export const NUTRITION_ROLES: readonly NutritionRole[] = ['TRAINEE', 'PRECEPTOR', 'UNIT_LEAD', 'ASSESSOR', 'ADMIN']

/** For client components, which cannot import auth/guard.ts. A test keeps it equal to NUTRITION_LOGIN_PATH. */
export const NUTRITION_LOGIN_HREF = '/nutrition/login'

export interface PortalPage {
  href: string
  label: string
  roles: readonly NutritionRole[]
  /** The plan step that builds the page. Until then it shows "Coming in Step N". */
  step: number
}

export interface PortalSection {
  title: string
  pages: readonly PortalPage[]
}

/** What the sidebar receives: links only, never the role lists. */
export interface NavLink {
  href: string
  label: string
}

export interface NavSection {
  title: string
  links: NavLink[]
}

const PRECEPTOR_OR_ASSESSOR: readonly NutritionRole[] = ['PRECEPTOR', 'ASSESSOR']

export const PORTAL_SECTIONS: readonly PortalSection[] = [
  {
    title: 'Trainee',
    pages: [
      { href: '/nutrition/trainee', label: 'Dashboard', roles: ['TRAINEE'], step: 4 },
      { href: '/nutrition/trainee/logbook', label: 'Case log', roles: ['TRAINEE'], step: 3 },
      { href: '/nutrition/trainee/forms', label: 'Forms', roles: ['TRAINEE'], step: 4 },
      { href: '/nutrition/trainee/assessments', label: 'Assessments', roles: ['TRAINEE'], step: 5 },
      { href: '/nutrition/trainee/epa', label: 'EPA levels', roles: ['TRAINEE'], step: 6 },
      { href: '/nutrition/trainee/remediation', label: 'Remediation', roles: ['TRAINEE'], step: 6 },
      { href: '/nutrition/trainee/portfolio', label: 'Portfolio', roles: ['TRAINEE'], step: 7 },
      { href: '/nutrition/trainee/certificate', label: 'Certificate', roles: ['TRAINEE'], step: 7 },
      { href: '/nutrition/trainee/attendance', label: 'Attendance', roles: ['TRAINEE'], step: 8 },
    ],
  },
  {
    title: 'Preceptor',
    pages: [
      { href: '/nutrition/preceptor', label: 'Dashboard', roles: PRECEPTOR_OR_ASSESSOR, step: 4 },
      { href: '/nutrition/preceptor/reviews', label: 'Case reviews', roles: ['PRECEPTOR'], step: 3 },
      { href: '/nutrition/preceptor/forms', label: 'Forms', roles: ['PRECEPTOR'], step: 4 },
      { href: '/nutrition/preceptor/feedback', label: 'Trainee feedback', roles: ['PRECEPTOR'], step: 4 },
      { href: '/nutrition/preceptor/wpba', label: 'Assessments (WPBA)', roles: PRECEPTOR_OR_ASSESSOR, step: 5 },
      { href: '/nutrition/preceptor/scorecard', label: 'WPBA scorecards', roles: ['PRECEPTOR'], step: 5 },
      { href: '/nutrition/preceptor/epa', label: 'EPA & standards', roles: ['PRECEPTOR'], step: 6 },
      { href: '/nutrition/preceptor/checklist', label: 'Month 9 checklist', roles: ['PRECEPTOR'], step: 6 },
      { href: '/nutrition/preceptor/msf', label: '360° feedback', roles: ['PRECEPTOR'], step: 6 },
      { href: '/nutrition/preceptor/remediation', label: 'Remediation', roles: ['PRECEPTOR'], step: 6 },
      { href: '/nutrition/preceptor/attendance', label: 'Attendance', roles: ['PRECEPTOR'], step: 8 },
      { href: '/nutrition/preceptor/attendance-settings', label: 'Attendance settings', roles: ['PRECEPTOR'], step: 8 },
    ],
  },
  {
    title: 'Unit Lead',
    pages: [
      { href: '/nutrition/unit-lead', label: 'Dashboard', roles: ['UNIT_LEAD'], step: 4 },
      { href: '/nutrition/unit-lead/rotations', label: 'Rotation sign-off', roles: ['UNIT_LEAD'], step: 3 },
      { href: '/nutrition/unit-lead/feedback', label: 'Preceptor feedback', roles: ['UNIT_LEAD'], step: 4 },
    ],
  },
  {
    title: 'Admin',
    pages: [
      { href: '/nutrition/admin', label: 'Dashboard', roles: ['ADMIN'], step: 7 },
      { href: '/nutrition/admin/people', label: 'People & assignments', roles: ['ADMIN'], step: 3 },
      { href: '/nutrition/admin/rotations', label: 'Rotations', roles: ['ADMIN'], step: 3 },
      { href: '/nutrition/admin/feedback', label: 'Preceptor feedback', roles: ['ADMIN'], step: 4 },
      { href: '/nutrition/admin/analytics', label: 'Analytics', roles: ['ADMIN'], step: 7 },
      { href: '/nutrition/admin/certificates', label: 'Certificates', roles: ['ADMIN'], step: 7 },
      { href: '/nutrition/admin/export', label: 'Export', roles: ['ADMIN'], step: 7 },
      { href: '/nutrition/admin/attendance', label: 'Attendance', roles: ['ADMIN'], step: 8 },
    ],
  },
]

/** The page and its section title. Throws for an unknown href: a typo must fail loudly, never open a page. */
export function portalPage(href: string): { page: PortalPage; section: string } {
  for (const section of PORTAL_SECTIONS) {
    const page = section.pages.find((p) => p.href === href)
    if (page) return { page, section: section.title }
  }
  throw new Error(`portalPage: ${href} is not a nutrition portal page`)
}

/** The roles allowed on a portal page (see portalPage). */
export function pageRoles(href: string): readonly NutritionRole[] {
  return portalPage(href).page.roles
}

/** The sidebar for this person: only the pages they may open, and no role lists. */
export function navFor(roles: readonly NutritionRole[]): NavSection[] {
  return PORTAL_SECTIONS.map((section) => ({
    title: section.title,
    links: section.pages
      .filter((page) => page.roles.some((role) => roles.includes(role)))
      .map(({ href, label }) => ({ href, label })),
  })).filter((section) => section.links.length > 0)
}

// Where /nutrition sends someone, highest priority first.
const DASHBOARD_PRIORITY: readonly (readonly [NutritionRole, string])[] = [
  ['ADMIN', '/nutrition/admin'],
  ['PRECEPTOR', '/nutrition/preceptor'],
  ['UNIT_LEAD', '/nutrition/unit-lead'],
  ['ASSESSOR', '/nutrition/preceptor'],
  ['TRAINEE', '/nutrition/trainee'],
]

/** This person's dashboard, by role priority; null for no roles. */
export function dashboardPathFor(roles: readonly NutritionRole[]): string | null {
  return DASHBOARD_PRIORITY.find(([role]) => roles.includes(role))?.[1] ?? null
}

/** The sidebar link to highlight: the longest href that is the path itself or a parent of it. */
export function activeHref(pathname: string, hrefs: readonly string[]): string | null {
  let best: string | null = null
  for (const href of hrefs) {
    if ((pathname === href || pathname.startsWith(`${href}/`)) && href.length > (best?.length ?? -1)) best = href
  }
  return best
}
