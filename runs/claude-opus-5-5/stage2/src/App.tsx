import { useMemo, useState } from 'react'
import type { SourceInfo } from './audio/library'
import type { StageStatus } from './audio/stageAudio'
import { HardwareContext } from './components/hardwareContext'
import { Instrument, Stage } from './components/Instrument'
import type { OledContent } from './components/PanelSection'
import { usePiano } from './hooks/usePiano'
import { noteName } from './model/keys'
import { HardwareStore } from './model/hardwareStore'
import { PANEL } from './model/panel'
import { pianoDisplay } from './model/panelBindings'
import type { SoundState } from './model/sound'
import type { MidiStatus } from './input/midi'
import { browserRuntime, RuntimeContext, type Runtime } from './runtime'

const UI_SUSTAIN = 'ui:sustain'
const ZOOMS = [1, 2, 3] as const

function voiceLabel(status: StageStatus): string {
  switch (status.voice) {
    case 'loading':
      return `Loading ${Math.round(status.progress * 100)}%`
    case 'ready':
      return 'Ready'
    case 'fallback':
      return 'Fallback (labelled)'
    case 'error':
      return 'Error — no sound'
  }
}

function audioLabel(status: StageStatus): string {
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

function programOled(status: StageStatus, sound: SoundState): OledContent {
  const focus = sound.piano.focus
  const title = `PIANO ${focus}${sound.piano.on ? '' : ' · OFF'}`
  if (status.voice === 'error') return { title, lines: ['No Web Audio', 'Keybed silent'] }
  if (status.voice === 'loading') return { title, lines: [`Loading ${Math.round(status.progress * 100)}%`, pianoDisplay(sound, false)[0]] }
  const failed = status.fallbackModels.length > 0 && status.fallbackModels.includes(pianoDisplayName(sound))
  return { title, lines: pianoDisplay(sound, failed) }
}

function pianoDisplayName(sound: SoundState): string {
  return pianoDisplay(sound, false)[0].replace(/ \(\d+\/\d+\)$/, '')
}

const SYNTH_OLED: OledContent = { title: 'SYNTH', lines: ['Inactive', 'Not built until Phase 3'] }

function sourceLabel(s: SourceInfo): string {
  const kind = s.kind === 'recorded' ? 'recorded samples' : 'synthesized'
  return `${s.label} (${kind}): ${s.status}${s.error ? ` — ${s.error}` : ''}`
}

function InstrumentApp() {
  const runtime = useMemo<Runtime>(() => browserRuntime(), [])
  return <Workbench runtime={runtime} />
}

export function Workbench({ runtime }: { runtime: Runtime }) {
  const store = useMemo(() => new HardwareStore(PANEL.controls), [])
  const piano = usePiano(runtime, store)
  const [zoom, setZoom] = useState<number>(1)
  const [uiSustain, setUiSustain] = useState(false)
  const oledContent = useMemo(() => ({ 'program-oled': programOled(piano.status, piano.sound), 'synth-oled': SYNTH_OLED }), [piano.status, piano.sound])
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
              Nord Stage 4 73 <span className="subtitle">Stagebench · Phase 2 — piano library + layer effects</span>
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
                <details className="status-detail source-details">
                  <summary>
                    Library: {piano.sources.filter((s) => s.status === 'ready').length}/{piano.sources.length} sources ready
                  </summary>
                  <ul className="source-list" data-testid="library-sources">
                    {piano.sources.map((s) => (
                      <li key={s.key} data-status={s.status}>
                        {sourceLabel(s)}
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
              <div className="status-item">
                <span className="status-key">Playing</span>
                <span className="status-detail" data-testid="voice-count">
                  {voices} / 24 voices per layer (A {piano.snapshot.perLayer.A} · B {piano.snapshot.perLayer.B}){piano.snapshot.sustain ? ' · sustain down' : ''}
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
                Phase 2: Piano, Layer Effects, Rotary speed/drive, pitch stick and Master Level work. Grand, Upright and Electric play bundled recorded samples; Clav, Digital
                and Misc are synthesized in the browser; reverb impulse responses are generated. Organ, Synth, Program and spec-excluded controls only move.
              </p>
            </section>
          </main>
        </div>
      </HardwareContext.Provider>
    </RuntimeContext.Provider>
  )
}

export default InstrumentApp
