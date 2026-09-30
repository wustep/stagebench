import { useEffect, useMemo, useState } from 'react'
import { browserDeps, createInstrument, type Instrument, type InstrumentDeps } from './audio/instrument'
import { bindPanel, syncPanel } from './engine/panelBindings'
import { createEngineStore } from './engine/state'
import { CONTROLS } from './hardware/layout'
import { createHardwareStore } from './hardware/store'
import { EngineContext, HardwareContext, InstrumentContext, useEngineState, useHardware, useInstrumentSnapshot } from './ui/context'
import InstrumentView from './ui/InstrumentView'
import StatusBar from './ui/StatusBar'

export interface AppProps {
  /** injectable browser boundaries (audio, MIDI, timers, event targets); defaults to the real browser */
  deps?: InstrumentDeps
}

/** a failed piano model makes the type LED flash (manual p. 24); the Program display reports it */
function PanelStatusBridge() {
  const store = useHardware()
  const snap = useInstrumentSnapshot()
  const engine = useEngineState()
  const failed = snap.models[engine.focus].phase === 'error'
  useEffect(() => {
    store.patch('piano-select', { focused: failed ? true : undefined, note: failed ? 'Piano not found: the type LED flashes and a labelled fallback voice plays' : undefined })
  }, [store, failed])
  return null
}

export default function App({ deps }: AppProps) {
  const engine = useMemo(() => createEngineStore(), [])
  // the panel starts in the canonical state, so the first paint already shows the real defaults
  const store = useMemo(() => {
    const s = createHardwareStore(CONTROLS)
    syncPanel(s, engine.get())
    return s
  }, [engine])
  const [instrument, setInstrument] = useState<Instrument | null>(null)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    const resolved = deps ?? browserDeps()
    const created = createInstrument(resolved, engine)
    const unbind = bindPanel({ store, engine, scheduler: resolved.scheduler })
    setInstrument(created)
    return () => {
      unbind()
      created.dispose()
      setInstrument(null)
    }
  }, [deps, engine, store])

  return (
    <HardwareContext.Provider value={store}>
      <EngineContext.Provider value={engine}>
        <InstrumentContext.Provider value={instrument}>
          <main className="stage">
            <PanelStatusBridge />
            <div className="stage-wrap">
              <div className={`stage-scroll${zoom > 1 ? ' is-zoomed' : ''}`} data-testid="stage-scroll">
                <div className="stage-zoom" style={{ width: `${zoom * 100}%` }}>
                  <InstrumentView />
                </div>
              </div>
            </div>
            <StatusBar zoom={zoom} onZoom={setZoom} />
          </main>
        </InstrumentContext.Provider>
      </EngineContext.Provider>
    </HardwareContext.Provider>
  )
}
