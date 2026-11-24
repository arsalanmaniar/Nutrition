'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SignOutButton } from './SignOutButton'
import { useNutritionTheme } from './NutritionRoot'
import { activeHref, type NavSection } from './navigation'

// The portal frame, mobile first: a top bar and a slide-in drawer on phones, a
// fixed sidebar from md up, laid out like the admin dashboard. It only shows
// links. Every page enforces its own access with requireNutritionRole.
export function PortalShell({
  sections,
  userName,
  userEmail,
  children,
}: {
  sections: NavSection[]
  userName: string
  userEmail: string
  children: ReactNode
}) {
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  const sidebar = (
    <SidebarContent sections={sections} userName={userName} userEmail={userEmail} onNavigate={() => setMenuOpen(false)} />
  )

  return (
    <div className="min-h-screen">
      <header className="md:hidden fixed top-0 inset-x-0 z-30 flex h-14 items-center gap-3 border-b border-white/10 bg-gray-900 px-4">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={menuOpen}
          className="rounded-lg p-2 text-gray-300 hover:bg-white/10 hover:text-white"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true">
            <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span className="font-semibold text-white">MyLearningSphere</span>
      </header>

      {menuOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/60" onClick={() => setMenuOpen(false)} aria-hidden="true" />
      )}
      <aside
        inert={!menuOpen}
        className={`md:hidden fixed inset-y-0 left-0 z-50 w-64 bg-gray-900 transition-transform duration-200 ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebar}
      </aside>

      <aside className="hidden md:flex fixed inset-y-0 left-0 z-30 w-64 flex-col bg-gray-900">{sidebar}</aside>

      <div className="pt-14 md:pt-0 md:ml-64">
        <main className="p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}

function SidebarContent({
  sections,
  userName,
  userEmail,
  onNavigate,
}: {
  sections: NavSection[]
  userName: string
  userEmail: string
  onNavigate: () => void
}) {
  const pathname = usePathname()
  const { dark, toggleTheme } = useNutritionTheme()
  const current = activeHref(pathname, sections.flatMap((section) => section.links.map((link) => link.href)))
  const rowClass =
    'block w-full rounded-lg px-3 py-2 text-left text-sm text-gray-300 transition hover:bg-white/10 hover:text-white'

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/10 px-4 py-5">
        <p className="font-semibold leading-tight text-white">MyLearningSphere</p>
        <p className="mt-0.5 text-xs text-gray-300">Clinical Dietetics &amp; Nutrition E-Portal</p>
      </div>

      <nav aria-label="Nutrition portal" className="flex-1 space-y-5 overflow-y-auto p-3">
        {sections.map((section) => (
          <div key={section.title}>
            <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-gray-300">{section.title}</p>
            <ul className="space-y-1">
              {section.links.map((link) => {
                const active = link.href === current
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={
                        active
                          ? 'block rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white shadow-sm'
                          : 'block rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-white/10 hover:text-white'
                      }
                    >
                      {link.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="space-y-1 border-t border-white/10 p-3">
        <div className="px-3 pb-2">
          <p className="truncate text-sm text-white">{userName}</p>
          <p className="truncate text-xs text-gray-300">{userEmail}</p>
        </div>
        <button type="button" onClick={toggleTheme} aria-pressed={dark} className={rowClass}>
          {dark ? 'Light mode' : 'Dark mode'}
        </button>
        <SignOutButton confirm className={rowClass} />
      </div>
    </div>
  )
}
