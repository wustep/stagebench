import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Section-inspect/zoom overlay (narrow-legend-legibility, SHOWCASE.md
 * iteration 1's oldest open issue): additive, opt-in magnification of one
 * control-deck section. It does not alter the default panel layout — the
 * chassis regression tests at 390x844 assert the untouched default DOM and
 * geometry, so this overlay portals under `.stage-app` instead of nesting
 * inside `.control-deck`.
 *
 * The overlay renders a LIVE clone of the section (the same React component,
 * same `store`/`instrument`/`engine` props) inside a fresh `container-type:
 * inline-size` context sized much wider than the section's usual slice of
 * the instrument. Every panel size in this app is expressed in `cqw` (1% of
 * the nearest container-query ancestor's inline size — see styles.css's
 * header comment), so re-parenting the same markup under a wider container
 * recomputes every legend/knob/LED size larger in absolute pixels, with the
 * controls staying fully real and operable (same canonical stores).
 */
export function SectionZoomOverlay({
  title,
  onClose,
  children,
}: {
  /** Human-readable section name for the dialog's aria-label, e.g. "Organ". */
  title: string
  onClose: () => void
  /** The section component, rendered again at the zoomed container width. */
  children: ReactNode
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  // Trap initial focus on the close button; restore focus to whatever opened
  // the overlay (the section's Inspect button) when it closes.
  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButtonRef.current?.focus()
    return () => previousFocusRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      // Tab containment: the dialog is modal (aria-modal), so focus wraps at
      // its first/last focusable instead of escaping to the deck behind it.
      const dialog = dialogRef.current
      if (!dialog) return
      const focusables = [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ]
      if (focusables.length === 0) return
      const first = focusables[0]!
      const last = focusables[focusables.length - 1]!
      const active = document.activeElement
      if (event.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          event.preventDefault()
          last.focus()
        }
      } else if (active === last || !dialog.contains(active)) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const host = document.querySelector('.stage-app')
  if (!host) return null

  return createPortal(
    <div className="section-zoom-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="section-zoom-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${title} section magnified`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="section-zoom-toolbar">
          <span className="section-zoom-label">{title} — magnified</span>
          <button type="button" ref={closeButtonRef} className="section-zoom-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="section-zoom-stage">
          <div className="section-zoom-container">{children}</div>
        </div>
      </div>
    </div>,
    host,
  )
}
