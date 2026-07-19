// The published-build iframe used by every preview and report overlay, with a
// loading state and a load-failure fallback.
import { useEffect, useRef, useState } from 'react'
import type { SyntheticEvent } from 'react'

// Backstop for the truly-opaque case (a cross-origin frame, or a server that
// rejects HEAD): only fires while still loading. Generous enough that a
// slow-but-successful cold start — a large bundle or a cold Vercel edge — is
// not mistaken for a broken build.
const PREVIEW_LOAD_TIMEOUT_MS = 20000

export function PreviewFrame({
  className,
  scrolling,
  src,
  title,
  frameKey,
  autoFocus,
  onEscape,
}: {
  className?: string
  scrolling?: 'no'
  src: string
  title: string
  frameKey?: string
  /**
   * Focus the iframe once its build loads, so previews that listen for
   * computer-keyboard input on their own window (the showcase, candidate
   * builds) are playable immediately — without a click inside the frame
   * first. Real focus also means the keystrokes are trusted user activation
   * inside the frame, which is what lets its AudioContext start.
   */
  autoFocus?: boolean
  /**
   * Called when Escape is pressed *inside* the frame. Once focus is in the
   * iframe the parent window never sees the keydown, so same-origin previews
   * get a listener attached to their content window; without this, Escape
   * would silently stop closing the overlay.
   */
  onEscape?: () => void
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  // Latest-callback ref: the content-window listener is attached once per
  // frame load, but Dialogs passes inline close handlers that change identity
  // every render.
  const onEscapeRef = useRef(onEscape)
  onEscapeRef.current = onEscape

  const handleFrameLoad = (event: SyntheticEvent<HTMLIFrameElement>) => {
    // A 404/5xx body still fires onLoad, so never let a late load event
    // overwrite the probe's error verdict.
    setState((current) => (current === 'error' ? current : 'ready'))

    const frame = event.currentTarget
    try {
      // Same-origin only (all previews are served under /previews and
      // /reports); a cross-origin frame throws and gets skipped. Each
      // navigation creates a fresh content window, so re-attach on every
      // load — the old window (and its listener) is gone.
      frame.contentWindow?.addEventListener('keydown', (keyEvent) => {
        if (keyEvent.key !== 'Escape') return
        // A preview that consumes Escape itself (the showcase's section-zoom
        // dialog preventDefaults it to close just the zoom) keeps the outer
        // overlay open — Escape peels one layer at a time. This listener runs
        // before the preview's own (it registers at load, theirs later), so
        // defer the verdict past the whole dispatch; setTimeout, not a
        // microtask, since microtask checkpoints run between listeners.
        setTimeout(() => {
          if (!keyEvent.defaultPrevented) onEscapeRef.current?.()
        }, 0)
      })
    } catch {
      // Cross-origin frame: Escape inside it can't be observed.
    }
    if (autoFocus) frame.focus({ preventScroll: true })
  }

  // Iframe error signaling is unreliable across origins, so a slow build must
  // not be mistaken for a broken one. Previews are served same-origin under
  // /previews and /reports, so proactively probe reachability with a HEAD
  // request: a genuine 404/5xx surfaces the failure immediately, and any
  // response at all proves the server is alive — so the backstop timer is
  // cancelled and the iframe's own onLoad/onError decide from there. The timer
  // only covers the opaque case where the probe can't decide (network error,
  // CORS, HEAD unsupported).
  useEffect(() => {
    setState('loading')
    const controller = new AbortController()

    const timeout = window.setTimeout(() => {
      setState((current) => (current === 'loading' ? 'error' : current))
    }, PREVIEW_LOAD_TIMEOUT_MS)

    fetch(src, { method: 'HEAD', signal: controller.signal })
      .then((response) => {
        // Any response means the server answered — the opaque-case backstop no
        // longer applies, so a slow-but-alive build can never be torn down by
        // the timer mid-load.
        window.clearTimeout(timeout)
        // 404/410 = missing build; 5xx = server error. Set error even if the
        // iframe's onLoad already fired: a 404 body "loads" as a rendered
        // server error page, which must not read as ready.
        if (response.status === 404 || response.status === 410 || response.status >= 500) {
          setState('error')
        }
      })
      .catch(() => {
        // Aborted, offline, cross-origin, or HEAD-unsupported: fall back to the
        // iframe's onLoad/onError and the backstop timer.
      })

    return () => {
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [src])

  return (
    <div className="preview-frame-shell">
      {state === 'error' ? (
        <div className="preview-error" role="alert">
          <strong>Preview failed to load</strong>
          <p>The published build did not respond.</p>
          <code>{src}</code>
        </div>
      ) : (
        <>
          {state === 'loading' && (
            <div className="preview-loading" role="status">
              <span aria-hidden="true" className="loading-lights"><i /><i /><i /></span>
              <span>Loading build</span>
            </div>
          )}
          <iframe
            className={className}
            key={frameKey}
            onError={() => setState('error')}
            onLoad={handleFrameLoad}
            scrolling={scrolling}
            src={src}
            title={title}
          />
        </>
      )}
    </div>
  )
}
