import { useEffect, useMemo, useState } from 'react'
import { browserDeps, createInstrument, type Instrument, type InstrumentDeps } from './audio/instrument'
import { bindPanel, syncPanel } from './engine/panelBindings'
import { createProgramSystem, type ProgramSystem } from './engine/programs'
import { createEngineStore } from './engine/state'
import { createUiModeStore } from './engine/uiMode'
import { CONTROLS } from './hardware/layout'
import { createHardwareStore } from './hardware/store'
import { EngineContext, HardwareContext, InstrumentContext, ProgramsContext, UiModeContext, useEngineState, useHardware, useInstrumentSnapshot } from './ui/context'
import InstrumentView from './ui/InstrumentView'
import StatusBar from './ui/StatusBar'

export interface AppProps {
  /** injectable browser boundaries (audio, MIDI, timers, storage, event targets); defaults to the real browser */
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
  const ui = useMemo(() => createUiModeStore(), [])
  // the panel starts in the canonical state, so the first paint already shows the real defaults
  const store = useMemo(() => {
    const s = createHardwareStore(CONTROLS)
    syncPanel(s, engine.get())
    return s
  }, [engine])
  const [instrument, setInstrument] = useState<Instrument | null>(null)
  const [programs, setPrograms] = useState<ProgramSystem | null>(null)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    const resolved = deps ?? browserDeps()
    const created = createInstrument(resolved, engine)
    const system = createProgramSystem({ engine, storage: resolved.storage ?? null, scheduler: resolved.scheduler })
    const unbind = bindPanel({
      store,
      engine,
      scheduler: resolved.scheduler,
      programs: system,
      ui,
      panic: () => created.panic(),
      observeNotes: (observer) => created.lifecycle.observeNotes(observer),
    })
    setInstrument(created)
    setPrograms(system)
    return () => {
      unbind()
      system.dispose()
      created.dispose()
      setInstrument(null)
      setPrograms(null)
    }
  }, [deps, engine, store, ui])

  return (
    <HardwareContext.Provider value={store}>
      <EngineContext.Provider value={engine}>
        <UiModeContext.Provider value={ui}>
          <ProgramsContext.Provider value={programs}>
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
          </ProgramsContext.Provider>
        </UiModeContext.Provider>
      </EngineContext.Provider>
    </HardwareContext.Provider>
  )
}
