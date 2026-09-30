import { useEffect, useMemo, useState } from 'react'
import { browserDeps, createInstrument, type Instrument, type InstrumentDeps } from './audio/instrument'
import { CONTROLS } from './hardware/layout'
import { createHardwareStore } from './hardware/store'
import { HardwareContext, InstrumentContext } from './ui/context'
import InstrumentView from './ui/InstrumentView'
import StatusBar from './ui/StatusBar'

export interface AppProps {
  /** injectable browser boundaries (audio, MIDI, timers, event targets); defaults to the real browser */
  deps?: InstrumentDeps
}

export default function App({ deps }: AppProps) {
  const store = useMemo(() => createHardwareStore(CONTROLS), [])
  const [instrument, setInstrument] = useState<Instrument | null>(null)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    const created = createInstrument(deps ?? browserDeps())
    setInstrument(created)
    return () => {
      created.dispose()
      setInstrument(null)
    }
  }, [deps])

  return (
    <HardwareContext.Provider value={store}>
      <InstrumentContext.Provider value={instrument}>
        <main className="stage">
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
    </HardwareContext.Provider>
  )
}
