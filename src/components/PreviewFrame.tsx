// The published-build iframe used by every preview and report overlay, with a
// loading state and a load-failure fallback.
import { useEffect, useState } from 'react'

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
}: {
  className?: string
  scrolling?: 'no'
  src: string
  title: string
  frameKey?: string
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  // Iframe error signaling is unreliable across origins, so a slow build must
  // not be mistaken for a broken one. Previews are served same-origin under
  // /previews and /reports, so proactively probe reachability with a HEAD
  // request: a genuine 404/5xx surfaces the failure immediately instead of
  // waiting out the backstop timer, while a slow-but-reachable build still
  // resolves via the iframe's own onLoad. The timer only covers the opaque
  // case where the probe can't decide (network error, CORS, HEAD unsupported).
  useEffect(() => {
    setState('loading')
    const controller = new AbortController()

    fetch(src, { method: 'HEAD', signal: controller.signal })
      .then((response) => {
        // 404/410 = missing build; 5xx = server error. Other statuses
        // (200, or a 405 from a server that dislikes HEAD) are inconclusive,
        // so defer to the iframe load events and the timer.
        if (response.status === 404 || response.status === 410 || response.status >= 500) {
          setState((current) => (current === 'loading' ? 'error' : current))
        }
      })
      .catch(() => {
        // Aborted, offline, cross-origin, or HEAD-unsupported: fall back to the
        // iframe's onLoad/onError and the backstop timer.
      })

    const timeout = window.setTimeout(() => {
      setState((current) => (current === 'loading' ? 'error' : current))
    }, PREVIEW_LOAD_TIMEOUT_MS)

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
            onLoad={() => setState('ready')}
            scrolling={scrolling}
            src={src}
            title={title}
          />
        </>
      )}
    </div>
  )
}
