'use client'

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import AuthCookieSync from '@/features/nutrition/components/AuthCookieSync'

// Wraps every /nutrition page, the public ones included.
//
//  - Mounts AuthCookieSync, which keeps the auth cookie that the server-side
//    guard reads in step with the supabase-js session.
//  - Applies the dark theme: `.dark` on a wrapper around `.portal-content`,
//    which is what globals.css themes. The choice is kept in localStorage
//    under 'cdnep-theme'.

const THEME_KEY = 'cdnep-theme'
// Same-tab change signal. The browser's 'storage' event covers other tabs.
const THEME_EVENT = 'nutrition:theme-change'

function readDark(): boolean {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark'
  } catch {
    return false
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange)
  window.addEventListener(THEME_EVENT, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(THEME_EVENT, onChange)
  }
}

interface Theme {
  dark: boolean
  toggleTheme: () => void
}

const ThemeContext = createContext<Theme>({ dark: false, toggleTheme: () => {} })

export function useNutritionTheme(): Theme {
  return useContext(ThemeContext)
}

export function NutritionRoot({ children }: { children: ReactNode }) {
  // The server render and hydration use light; the saved choice applies right after.
  const dark = useSyncExternalStore(subscribe, readDark, () => false)

  const toggleTheme = useCallback(() => {
    try {
      localStorage.setItem(THEME_KEY, readDark() ? 'light' : 'dark')
    } catch {
      // Storage unavailable (e.g. a private window): the choice just won't persist.
    }
    window.dispatchEvent(new Event(THEME_EVENT))
  }, [])

  const theme = useMemo(() => ({ dark, toggleTheme }), [dark, toggleTheme])

  return (
    <ThemeContext.Provider value={theme}>
      <AuthCookieSync />
      <div className={dark ? 'dark' : undefined}>
        <div className="portal-content min-h-screen bg-gray-50">{children}</div>
      </div>
    </ThemeContext.Provider>
  )
}
