import type { EventTargetLike } from '../audio/types'

export interface DocumentLike extends EventTargetLike {
  readonly visibilityState?: string
}

/**
 * Stops every voice when the page loses focus, becomes hidden or is being unloaded, so a note can never
 * get stuck because a key-up or pointer-up was never delivered.
 */
export function attachPageLifecycle(win: EventTargetLike, doc: DocumentLike, onLoseFocus: () => void): () => void {
  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') onLoseFocus()
  }
  win.addEventListener('blur', onLoseFocus)
  win.addEventListener('pagehide', onLoseFocus)
  doc.addEventListener('visibilitychange', onVisibility)
  return () => {
    win.removeEventListener('blur', onLoseFocus)
    win.removeEventListener('pagehide', onLoseFocus)
    doc.removeEventListener('visibilitychange', onVisibility)
  }
}
