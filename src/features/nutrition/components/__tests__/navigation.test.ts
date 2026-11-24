import { describe, expect, it, vi } from 'vitest'
import type { NutritionRole } from '@prisma/client'

// guard.ts is imported only to compare a constant; keep the real Prisma client out of it.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { NUTRITION_LOGIN_PATH } from '@/features/nutrition/auth/guard'
import {
  NUTRITION_LOGIN_HREF,
  NUTRITION_ROLES,
  PORTAL_SECTIONS,
  activeHref,
  dashboardPathFor,
  navFor,
  pageRoles,
} from '../navigation'

describe('dashboardPathFor: /nutrition sends each person to one dashboard, by priority', () => {
  it.each<[NutritionRole[], string | null]>([
    [['ADMIN'], '/nutrition/admin'],
    [['PRECEPTOR'], '/nutrition/preceptor'],
    [['UNIT_LEAD'], '/nutrition/unit-lead'],
    [['ASSESSOR'], '/nutrition/preceptor'],
    [['TRAINEE'], '/nutrition/trainee'],
    [['TRAINEE', 'ADMIN'], '/nutrition/admin'],
    [['UNIT_LEAD', 'PRECEPTOR'], '/nutrition/preceptor'],
    [['TRAINEE', 'UNIT_LEAD'], '/nutrition/unit-lead'],
    [['TRAINEE', 'ASSESSOR'], '/nutrition/preceptor'],
    [[], null],
  ])('%j -> %s', (roles, expected) => {
    expect(dashboardPathFor(roles)).toBe(expected)
  })

  it.each(NUTRITION_ROLES)('a %s is let into the dashboard it is sent to (no redirect to no-access)', (role) => {
    expect(pageRoles(dashboardPathFor([role]) as string)).toContain(role)
  })
})

describe('navFor: the sidebar only lists pages the person may open', () => {
  it('a trainee sees the Trainee section only, as plain links with no role lists', () => {
    const nav = navFor(['TRAINEE'])
    expect(nav.map((s) => s.title)).toEqual(['Trainee'])
    expect(nav[0].links.length).toBe(9)
    for (const link of nav[0].links) expect(Object.keys(link).sort()).toEqual(['href', 'label'])
  })

  it('an assessor sees only the preceptor dashboard and the WPBA page', () => {
    expect(navFor(['ASSESSOR'])).toEqual([
      {
        title: 'Preceptor',
        links: [
          { href: '/nutrition/preceptor', label: 'Dashboard' },
          { href: '/nutrition/preceptor/wpba', label: 'Assessments (WPBA)' },
        ],
      },
    ])
  })

  it('ADMIN (e.g. a super_admin) sees the Admin section; ADMIN plus TRAINEE sees both', () => {
    expect(navFor(['ADMIN']).map((s) => s.title)).toEqual(['Admin'])
    expect(navFor(['TRAINEE', 'ADMIN']).map((s) => s.title)).toEqual(['Trainee', 'Admin'])
  })

  it('every link shown is a page that would let the person in', () => {
    for (const role of NUTRITION_ROLES) {
      for (const section of navFor([role])) {
        for (const link of section.links) expect(pageRoles(link.href)).toContain(role)
      }
    }
  })
})

describe('the page table', () => {
  it('hrefs are unique', () => {
    const hrefs = PORTAL_SECTIONS.flatMap((s) => s.pages.map((p) => p.href))
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })

  it('pageRoles throws for an href that is not a portal page (a typo fails loudly, never opens a page)', () => {
    expect(() => pageRoles('/nutrition/admin/peple')).toThrow('not a nutrition portal page')
  })

  it("NUTRITION_LOGIN_HREF matches the guard's NUTRITION_LOGIN_PATH", () => {
    expect(NUTRITION_LOGIN_HREF).toBe(NUTRITION_LOGIN_PATH)
  })
})

describe('activeHref: the sidebar highlights the most specific link', () => {
  const hrefs = ['/nutrition/trainee', '/nutrition/trainee/logbook', '/nutrition/admin', '/nutrition/admin/people']

  it.each([
    ['/nutrition/trainee', '/nutrition/trainee'],
    ['/nutrition/trainee/logbook', '/nutrition/trainee/logbook'],
    ['/nutrition/trainee/logbook/new', '/nutrition/trainee/logbook'],
    ['/nutrition/admin/people', '/nutrition/admin/people'],
    ['/nutrition/traineeship', null],
    ['/nutrition', null],
  ])('%s -> %s', (pathname, expected) => {
    expect(activeHref(pathname, hrefs)).toBe(expected)
  })
})
