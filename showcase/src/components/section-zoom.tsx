import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
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
  sectionId,
  onClose,
  children,
}: {
  /** Human-readable section name for the dialog's aria-label, e.g. "Organ". */
  title: string
  /** deck-section id ('organ' | 'piano' | …) — used to measure the section's
   *  on-panel aspect ratio so the magnified clone keeps the panel's
   *  proportions instead of stretching to a fixed frame. */
  sectionId: string
  onClose: () => void
  /** The section component, rendered again at the zoomed container width. */
  children: ReactNode
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const pressOnBackdropRef = useRef(false)
  // The clone must reproduce the panel section EXACTLY, only k× larger.
  // cqw units resolve against the container width, so the container is a
  // virtual panel scaled by k (cqWidth = k × .instrument width) while the
  // section itself keeps its natural share of it (sectionWidth = k × its
  // on-panel width); a clip box hides the virtual panel's unused remainder.
  const [size, setSize] = useState<{ clipWidth: number; clipHeight: number; cqWidth: number } | null>(null)

  useEffect(() => {
    const measure = () => {
      const section = document.querySelector(`.control-deck .deck-section[data-section='${sectionId}']`)
      const panel = document.querySelector('.instrument')
      if (!section || !panel) return
      const rect = section.getBoundingClientRect()
      const panelRect = panel.getBoundingClientRect()
      if (!rect.width || !rect.height || !panelRect.width) return
      const fitWidth = window.innerWidth * 0.92 - 48
      const fitHeight = window.innerHeight * 0.78 - 48
      // Largest fully-visible scale — but never below the magnification
      // floor: on narrow viewports (the overlay's reason to exist) the
      // clone must render larger than the panel and let the stage scroll,
      // or the legends would shrink instead of magnify.
      const k = Math.max(Math.min(fitWidth / rect.width, fitHeight / rect.height), 1000 / rect.width)
      setSize({ clipWidth: rect.width * k, clipHeight: rect.height * k, cqWidth: panelRect.width * k })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [sectionId])

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
    <div
      className="section-zoom-backdrop"
      // Standard modal-scrim rule: close only when the PRESS began on the
      // backdrop — a drag that starts on a control inside the dialog and
      // releases over the scrim must not dismiss it (the browser dispatches
      // that click on the common ancestor, i.e. the backdrop).
      onPointerDown={(event) => {
        pressOnBackdropRef.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && pressOnBackdropRef.current) onClose()
      }}
    >
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
          <div
            className="section-zoom-clip"
            style={size ? { width: size.clipWidth, height: size.clipHeight } : undefined}
          >
            <div
              className="section-zoom-container"
              style={
                size
                  ? ({ width: size.cqWidth, height: size.clipHeight, '--zoom-section-width': `${size.clipWidth}px` } as CSSProperties)
                  : undefined
              }
            >
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>,
    host,
  )
}
