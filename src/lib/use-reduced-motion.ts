'use client'

import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mql = window.matchMedia(QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(QUERY).matches
}

// The server cannot know the preference; assume motion is fine and let the
// client correct it on hydration.
const getServerSnapshot = () => false

/**
 * Whether this viewer has asked their system to reduce motion.
 *
 * `useSyncExternalStore` rather than an effect: it reads the correct value on
 * the first client render (no flash of animation), updates if the preference
 * changes mid-session, and sets no state inside an effect.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
