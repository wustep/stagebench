import { useCallback, useState } from 'react'
import { Keybed } from './hardware/Keybed'
import { variant } from './hardware/model'
import { ControlDeck } from './hardware/Surface'
import { isRecorded, models } from './piano/settings'
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
  const { keys, press, release, tap, audio, midi, settings, pedal, configure, togglePedal } = useInstrument(environment)
  const now = useCallback(() => (environment?.window ?? window).performance.now(), [environment])
  const type = settings.layers[settings.focus].type
  const model = models[type]
  const audioLabel = type === 'Upright' || audio === 'error' ? audioLabels[audio] : {
    ready: `${model} ready${isRecorded(type) ? '' : ' · Synthesis'}`,
    loading: `Loading ${model} · Synth fallback`,
    fallback: `${model} samples unavailable · Synth fallback`,
  }[audio]
  return (
    <main className="studio">
      <div className={`instrument-view${zoomed ? ' instrument-view--zoomed' : ''}`}>
        <div id="instrument" className="instrument" data-instrument={variant.id} role="group" aria-label={variant.name}>
          <ControlDeck settings={settings} status={audio} configure={configure} now={now} />
          <Keybed state={keys} press={press} release={release} tap={tap} />
        </div>
      </div>
      <div className="instrument-tools">
        <div className="instrument-tools__status" role="status" data-audio-state={audio}>
          <i aria-hidden="true" />{audioLabel}
        </div>
        <div className="instrument-tools__midi" role="status" data-midi-state={midi}>{midiLabels[midi]}</div>
        <button className="instrument-tools__pedal" type="button" aria-pressed={pedal}
          onClick={togglePedal}>Sustain pedal</button>
        <button className="instrument-tools__zoom" type="button" aria-controls="instrument" aria-pressed={zoomed}
          onClick={() => setZoomed(!zoomed)}>{zoomed ? 'Fit instrument' : 'Inspect controls'}</button>
        {zoomed && <span className="instrument-tools__pan">Swipe left or right to move along the panel.</span>}
        <details className="instrument-tools__help">
          <summary>Playing &amp; credits</summary>
          <p>Play with a mouse, touch, MIDI, or your computer keyboard. Use Z through / starting at C3 and Q through ] starting at C4. The row above each set adds sharps. Hold Space, use a MIDI pedal, or toggle Sustain pedal for notes routed through SUSTPED.</p>
          <p>Use Tab to focus controls, arrow keys to move sliders, and Enter or Space to press buttons. The amber buttons beneath the Piano faders focus each layer. Pitch Stick springs back when released with a pointer. Each of the six types has one model.</p>
          <p>Piano layer focus also targets the effects. Use FX Shift with the Piano focus button to group the chains. Use FX Shift with Delay, Compressor, or Reverb On to switch that unit to Global. Tap twice to set the FX clock for Delay and Mod 1 sync. Select To Rotary and enable both Amp and Rotary to use the shared speaker.</p>
          <p>Organ, Synth, Program, and secondary controls marked with ▾ are decorative in this phase, except for the Piano and Layer Effects gestures described above.</p>
          <p>Salamander Grand Piano V3 by Alexander Holm. Stereo recordings trimmed, levelled and encoded for this instrument. <a href="https://creativecommons.org/licenses/by/3.0/">CC BY 3.0</a> · <a href="https://archive.org/details/SalamanderGrandPianoV3">Source</a></p>
          <p>Upright Piano KW recordings by Gonzalo and Roberto, FreePats project. CC0 1.0. Rhodes Mark I samples (jRhodes GM version) by Jeff Learman. CC0 1.0.</p>
        </details>
      </div>
    </main>
  )
}
