'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'

/**
 * The one modal shell for the admin.
 *
 * It exists because modals rendered inline inside the page inherited whatever
 * the page was doing — a transformed ancestor makes `position: fixed` resolve
 * against that ancestor instead of the viewport, so the overlay covered the
 * wrong box and the panel drifted while the page behind it scrolled.
 *
 * What it guarantees:
 *  - rendered through a portal on <body>, so no ancestor can affect it;
 *  - a translucent, blurred backdrop rather than a solid black one;
 *  - the page behind cannot scroll while it is open, and does not jump when the
 *    scrollbar disappears;
 *  - the panel itself scrolls when it is taller than the viewport;
 *  - Escape and a click outside close it, unless `dismissible` is false.
 */
export default function Modal({
  onClose,
  children,
  align = 'center',
  dismissible = true,
  labelledBy,
}: {
  onClose: () => void
  children: React.ReactNode
  /** 'sheet' docks the panel to the bottom on phones — closer to the thumb. */
  align?: 'center' | 'sheet'
  dismissible?: boolean
  labelledBy?: string
}) {
  // Lock the page behind the modal. The padding compensates for the scrollbar
  // that `overflow: hidden` removes, so the layout does not shift sideways.
  useEffect(() => {
    const { body } = document
    const prevOverflow = body.style.overflow
    const prevPadding = body.style.paddingRight
    const gap = window.innerWidth - document.documentElement.clientWidth
    body.style.overflow = 'hidden'
    if (gap > 0) body.style.paddingRight = `${gap}px`
    return () => {
      body.style.overflow = prevOverflow
      body.style.paddingRight = prevPadding
    }
  }, [])

  useEffect(() => {
    if (!dismissible) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, dismissible])

  // Modals only ever render from a user interaction, i.e. after hydration, so
  // reading `document` here cannot cause a server/client mismatch.
  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className={`modal-backdrop fixed inset-0 z-50 flex justify-center overflow-y-auto overscroll-contain bg-gray-900/60 backdrop-blur-sm p-4 ${
        align === 'sheet' ? 'items-end sm:items-center' : 'items-center'
      }`}
      onClick={() => dismissible && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <div
        className="modal-panel w-full max-h-[90vh] overflow-y-auto overscroll-contain flex items-start justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}
