import { useState } from 'react'
import { Keybed } from './hardware/Keybed'
import { variant } from './hardware/model'
import { ControlDeck } from './hardware/Surface'
import { useInstrument } from './piano/useInstrument'
import type { InstrumentEnvironment } from './piano/useInstrument'

const audioLabels = {
  loading: 'Loading upright piano · Synth fallback',
  ready: 'Upright Piano KW ready',
  fallback: 'Upright samples unavailable · Synth fallback',
  error: 'Audio unavailable',
}

const midiLabels = {
  connecting: 'Checking MIDI',
  connected: 'MIDI connected',
  disconnected: 'No MIDI input',
  denied: 'MIDI permission denied',
  unavailable: 'MIDI unavailable',
  error: 'MIDI connection error',
}

export default function App({ environment }: { environment?: InstrumentEnvironment } = {}) {
  const [zoomed, setZoomed] = useState(false)
  const { keys, press, release, tap, audio, midi } = useInstrument(environment)
  return (
    <main className="studio">
      <div className={`instrument-view${zoomed ? ' instrument-view--zoomed' : ''}`}>
        <div id="instrument" className="instrument" data-instrument={variant.id} role="group" aria-label={variant.name}>
          <ControlDeck />
          <Keybed state={keys} press={press} release={release} tap={tap} />
        </div>
      </div>
      <div className="instrument-tools">
        <div className="instrument-tools__status" role="status" data-audio-state={audio}>
          <i aria-hidden="true" />{audioLabels[audio]}
        </div>
        <div className="instrument-tools__midi" role="status" data-midi-state={midi}>{midiLabels[midi]}</div>
        <button className="instrument-tools__zoom" type="button" aria-controls="instrument" aria-pressed={zoomed}
          onClick={() => setZoomed(!zoomed)}>{zoomed ? 'Fit instrument' : 'Inspect controls'}</button>
        {zoomed && <span className="instrument-tools__pan">Swipe left or right to move along the panel.</span>}
        <details className="instrument-tools__help">
          <summary>Playing &amp; credits</summary>
          <p>Play with a mouse, touch, MIDI, or your computer keyboard. Use Z through / starting at C3 and Q through ] starting at C4. The row above each set adds sharps. Hold Space or a MIDI sustain pedal to sustain.</p>
          <p>Use Tab to focus the panel controls, arrow keys to move the dials and sliders, and Enter or Space to press a button. Panel controls and OLEDs are for demonstration.</p>
          <p>Upright Piano KW recordings by Gonzalo and Roberto, FreePats project. CC0 1.0.</p>
        </details>
      </div>
    </main>
  )
}
