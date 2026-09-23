import { useMemo, useState } from 'react'
import type { PianoStatus } from './audio/pianoAudio'
import { HardwareContext } from './components/hardwareContext'
import { Instrument, Stage } from './components/Instrument'
import type { OledContent } from './components/PanelSection'
import { usePiano } from './hooks/usePiano'
import { noteName } from './model/keys'
import { HardwareStore } from './model/hardwareStore'
import { PANEL } from './model/panel'
import type { MidiStatus } from './input/midi'
import { browserRuntime, RuntimeContext, type Runtime } from './runtime'

const UI_SUSTAIN = 'ui:sustain'
const ZOOMS = [1, 2, 3] as const

function voiceLabel(status: PianoStatus): string {
  switch (status.voice) {
    case 'loading':
      return `Loading ${Math.round(status.progress * 100)}%`
    case 'ready':
      return 'Ready'
    case 'fallback':
      return 'Fallback tone'
    case 'error':
      return 'Error — no sound'
  }
}

function audioLabel(status: PianoStatus): string {
  switch (status.audio) {
    case 'not-started':
      return 'Audio starts on your first key press'
    case 'running':
      return 'Audio output running'
    case 'suspended':
      return 'Audio suspended by the browser — press a key to resume'
    case 'unavailable':
      return 'Web Audio unavailable'
    case 'closed':
      return 'Audio closed'
  }
}

function midiLabel(midi: MidiStatus): string {
  switch (midi.state) {
    case 'unsupported':
      return 'Web MIDI is not supported in this browser.'
    case 'idle':
      return 'MIDI input off.'
    case 'requesting':
      return 'Requesting MIDI access…'
    case 'denied':
      return `MIDI access denied (${midi.message}).`
    case 'no-inputs':
      return 'MIDI enabled — no input devices connected.'
    case 'connected':
      return `MIDI connected: ${midi.inputs.join(', ')} (notes, velocity, CC64 sustain).`
    case 'disconnected':
      return midi.message
  }
}

function programOled(status: PianoStatus): OledContent {
  const line =
    status.voice === 'loading'
      ? `Generating ${Math.round(status.progress * 100)}%`
      : status.voice === 'ready'
        ? 'Synth piano: ready'
        : status.voice === 'fallback'
          ? 'Fallback tone only'
          : 'No Web Audio'
  return { title: 'PHASE 1 · KEYBED', lines: ['Basic Piano', line, 'Panel: decorative'] }
}

const SYNTH_OLED: OledContent = { title: 'SYNTH', lines: ['Inactive', 'Not built in Phase 1'] }

function InstrumentApp() {
  const runtime = useMemo<Runtime>(() => browserRuntime(), [])
  return <Workbench runtime={runtime} />
}

export function Workbench({ runtime }: { runtime: Runtime }) {
  const store = useMemo(() => new HardwareStore(PANEL.controls), [])
  const piano = usePiano(runtime)
  const [zoom, setZoom] = useState<number>(1)
  const [uiSustain, setUiSustain] = useState(false)
  const oledContent = useMemo(() => ({ 'program-oled': programOled(piano.status), 'synth-oled': SYNTH_OLED }), [piano.status])
  const voices = piano.snapshot.voices.length
  const setSustainUi = (down: boolean) => {
    setUiSustain(down)
    piano.setSustain(down, UI_SUSTAIN)
  }
  const { midi } = piano
  const midiActive = midi.state === 'connected' || midi.state === 'no-inputs' || midi.state === 'requesting'

  return (
    <RuntimeContext.Provider value={runtime}>
      <HardwareContext.Provider value={store}>
        <div className="app">
          <header className="topbar">
            <h1>
              Nord Stage 4 73 <span className="subtitle">Stagebench · Phase 1 — surface + basic piano</span>
            </h1>
            <div className="zoom" role="group" aria-label="Instrument zoom">
              {ZOOMS.map((z) => (
                <button key={z} type="button" className={`chip${zoom === z ? ' is-active' : ''}`} aria-pressed={zoom === z} onClick={() => setZoom(z)}>
                  {z === 1 ? 'Fit' : `${z}×`}
                </button>
              ))}
            </div>
          </header>
          <main className="main">
            <Stage zoom={zoom}>
              <Instrument oledContent={oledContent} held={piano.snapshot.held} noteOn={piano.noteOn} noteOff={piano.noteOff} />
            </Stage>
            <section className="status-panel" aria-label="Piano status and inputs">
              <div className="status-item">
                <span className="status-key">Piano voice</span>
                <span className={`badge badge-${piano.status.voice}`} data-testid="voice-status">
                  {voiceLabel(piano.status)}
                </span>
                <span role="status" aria-live="polite" className="status-detail" data-testid="voice-detail">
                  {piano.status.detail}
                </span>
                <span className="status-detail" data-testid="audio-status">
                  {audioLabel(piano.status)}
                </span>
              </div>
              <div className="status-item">
                <span className="status-key">Playing</span>
                <span className="status-detail" data-testid="voice-count">
                  {voices} / 24 voices{piano.snapshot.sustain ? ' · sustain down' : ''}
                  {piano.snapshot.held.length ? ` · held: ${piano.snapshot.held.map(noteName).join(' ')}` : ''}
                </span>
                <div className="status-actions">
                  <button
                    type="button"
                    className={`chip${uiSustain ? ' is-active' : ''}`}
                    aria-pressed={uiSustain}
                    onClick={() => setSustainUi(!uiSustain)}
                  >
                    Sustain pedal {uiSustain ? 'down' : 'up'}
                  </button>
                  <button type="button" className="chip" onClick={() => { setSustainUi(false); piano.allNotesOff() }}>
                    All notes off
                  </button>
                </div>
              </div>
              <div className="status-item">
                <span className="status-key">MIDI</span>
                <span className="status-detail" data-testid="midi-status">
                  {midiLabel(midi)}
                </span>
                {midi.state !== 'unsupported' && !midiActive ? (
                  <div className="status-actions">
                    <button type="button" className="chip" onClick={piano.enableMidi}>
                      {midi.state === 'idle' ? 'Enable MIDI input' : 'Retry MIDI'}
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="status-item">
                <span className="status-key">Computer keys</span>
                <span className="status-detail">
                  <kbd>A</kbd>–<kbd>&#39;</kbd> white keys, <kbd>W E T Y U O P</kbd> black keys from {noteName(piano.baseNote)} · <kbd>Z</kbd>/<kbd>X</kbd> octave · <kbd>Space</kbd> sustain · velocity 100. Click or touch keys: strike nearer the front for louder notes.
                </span>
              </div>
              <p className="honesty">
                Only the keybed and sustain make sound in Phase 1. Every panel knob, button, fader, drawbar and wheel moves or lights,
                but changes no sound, program, effect or display. The piano is a synthesized tone generated in the browser, not a recording.
              </p>
            </section>
          </main>
        </div>
      </HardwareContext.Provider>
    </RuntimeContext.Provider>
  )
}

export default InstrumentApp
