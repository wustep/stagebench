import { useEffect, useMemo, useState } from 'react'
import { createSession, type Session } from './app/session'
import { DESIGN, PRESENTATION, VARIANT } from './hardware/geometry'
import { createBrowserPlatform } from './platform/browser'
import type { Platform } from './platform/types'
import { Console } from './ui/Console'
import { Instrument } from './ui/Instrument'

export const ZOOM_STEPS = [1, 1.5, 2, 3, 4] as const

/** Vertical room kept for the status console when fitting a short, wide viewport. */
const CONSOLE_RESERVE = 210

export interface Viewport {
  width: number
  height: number
}

/** Screen px per design px when the instrument is fitted to a viewport. */
export function fitScale(viewport: Viewport): number {
  const byWidth = viewport.width * PRESENTATION.fitWidthFraction
  const roomBelow = Math.max(120, viewport.height - CONSOLE_RESERVE)
  const byHeight = roomBelow * VARIANT.aspectRatio
  return Math.max(0.01, Math.min(byWidth, byHeight) / DESIGN.width)
}

interface AppProps {
  /** Injected in tests; defaults to the real browser. */
  platform?: Platform
}

export default function App({ platform: injected }: AppProps) {
  const platform = useMemo(() => injected ?? createBrowserPlatform(), [injected])
  const [session, setSession] = useState<Session | null>(null)
  const [viewport, setViewport] = useState<Viewport>(() => platform.events.viewport())
  const [zoom, setZoom] = useState(1)

  // The session owns audio, MIDI, and listeners; unmounting disposes all of it.
  useEffect(() => {
    const created = createSession(platform)
    setSession(created)
    return () => {
      created.dispose()
      setSession(null)
    }
  }, [platform])

  useEffect(() => {
    setViewport(platform.events.viewport())
    return platform.events.onResize(() => setViewport(platform.events.viewport()))
  }, [platform])

  // Start fetching and decoding the piano samples straight away, so the first key press
  // does not have to wait for them. This creates no AudioContext and changes no status.
  useEffect(() => {
    session?.engine.preload()
  }, [session])

  const scale = fitScale(viewport) * zoom

  return (
    <div className={`app${zoom > 1 ? ' app--zoomed' : ''}`} data-phase="3" data-variant={VARIANT.id}>
      <a className="skip-link" href="#keybed">
        Skip to keybed
      </a>
      <main className={`stage${zoom > 1 ? ' stage--zoomed' : ''}`} aria-label={`${VARIANT.fullName} instrument`}>
        <h1 className="visually-hidden">{VARIANT.fullName} — interactive instrument, Phase 3</h1>
        {session ? <Instrument session={session} scale={scale} /> : null}
      </main>
      {session ? <Console session={session} zoom={zoom} zoomSteps={ZOOM_STEPS} onZoom={setZoom} /> : null}
    </div>
  )
}
