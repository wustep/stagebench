import { useEffect, useMemo, useState } from 'react'
import { browserBoundaries, type Boundaries } from './audio/boundaries'
import type { PianoEngineOptions } from './audio/engine'
import { InstrumentContext } from './ui/context'
import { createServices, type Services } from './ui/createServices'
import { Instrument } from './ui/Instrument'
import { StatusBar } from './ui/StatusBar'

export interface AppProps {
  boundaries?: Boundaries
  engineOptions?: Partial<PianoEngineOptions>
  /** Request Web MIDI on mount (default true). */
  midi?: boolean
  /** Exposes the services to the caller (tests, capture harness). */
  onServices?: (services: Services) => void
}

export default function App({ boundaries, engineOptions, midi = true, onServices }: AppProps) {
  const resolved = useMemo(() => boundaries ?? browserBoundaries(), [boundaries])
  const services = useMemo(() => createServices(resolved, engineOptions), [resolved, engineOptions])
  const [zoom, setZoom] = useState(1)
  useEffect(() => {
    onServices?.(services)
    const teardown = services.activate({ midi })
    return teardown
  }, [services, midi, onServices])
  useEffect(() => {
    const w = globalThis as unknown as { __stagebench?: Services }
    w.__stagebench = services
    return () => {
      if (w.__stagebench === services) delete w.__stagebench
    }
  }, [services])
  return (
    <InstrumentContext.Provider value={services}>
      <div className="page">
        <header className="page-header">
          <span className="page-title">Nord Stage 4 73 · Stagebench Phase 1</span>
          <span className="page-note">Surface complete; one generated piano voice from the keybed. Panel controls are decorative.</span>
        </header>
        <main className="stage" data-zoom={zoom}>
          <Instrument />
        </main>
        <StatusBar zoom={zoom} onZoom={setZoom} />
      </div>
    </InstrumentContext.Provider>
  )
}
