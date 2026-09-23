import { useCallback, useMemo, useState } from 'react'
import type { SourceInfo } from './audio/library'
import type { StageStatus } from './audio/stageAudio'
import { HardwareContext } from './components/hardwareContext'
import { Instrument, Stage } from './components/Instrument'
import type { OledContent } from './components/PanelSection'
import { usePiano } from './hooks/usePiano'
import { noteName } from './model/keys'
import { HardwareStore } from './model/hardwareStore'
import { PANEL } from './model/panel'
import { UNSUPPORTED, UNSUPPORTED_SHIFT } from './model/bindings/audit'
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

function programOled(status: StageStatus, content: OledContent | undefined): OledContent {
  const base = content ?? { title: '', lines: [] }
  if (status.voice === 'error') return { ...base, lines: ['No Web Audio', 'Keybed silent'] }
  if (status.voice === 'loading') return { ...base, lines: [`Loading ${Math.round(status.progress * 100)}%`, ...base.lines] }
  return base
}

const CONTROL_LABELS = new Map(PANEL.controls.map((c) => [c.id, c.label]))

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
  const [uiSustain, setUiSustain] = useState(false)
  // Panic also releases the UI's own held inputs (the sustain chip).
  const onPanic = useCallback(() => setUiSustain(false), [])
  const piano = usePiano(runtime, store, onPanic)
  const [zoom, setZoom] = useState<number>(1)
  const [pedal, setPedalUi] = useState(0)
  const view = piano.view
  const oledContent = useMemo(
    () => ({ 'program-oled': programOled(piano.status, view?.programOled), 'synth-oled': view?.synthOled ?? { title: 'SYNTH', lines: [] } }),
    [piano.status, view],
  )
  const voices = piano.snapshot.voices.length
  const setSustainUi = (down: boolean) => {
    setUiSustain(down)
    piano.setSustain(down, UI_SUSTAIN)
  }
  const perSlot = piano.snapshot.perSlot
  const naming = view?.mode.kind === 'name' ? view.mode.name : null
  const { midi } = piano
  const midiActive = midi.state === 'connected' || midi.state === 'no-inputs' || midi.state === 'requesting'

  return (
    <RuntimeContext.Provider value={runtime}>
      <HardwareContext.Provider value={store}>
        <div className="app">
          <header className="topbar">
            <h1>
              Nord Stage 4 73 <span className="subtitle">Stagebench · Phase 3 — complete system: organ, synth, programs</span>
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
            <section className="status-panel" aria-label="Instrument status and inputs">
              <div className="status-item">
                <span className="status-key">Program</span>
                <span className="status-detail" data-testid="program-status">
                  {view ? `${view.location.live ? `Live ${view.location.index + 1}` : `${Math.floor(view.location.index / 8) + 1}.${(view.location.index % 8) + 1}`} ${view.name}` : '—'}
                  {view?.dirty ? (
                    <span className="badge badge-fallback" data-testid="program-dirty" title="Edited: selecting another program discards the edits">
                      E
                    </span>
                  ) : null}
                  {view ? ` · Scene ${view.sound.scenes.active} · ${view.sound.clock.bpm} BPM${view.sound.split.on ? ' · Split' : ''}${view.solo ? ` · Solo ${view.solo}` : ''}` : ''}
                </span>
                {naming !== null ? (
                  <label className="status-detail">
                    Program name (Store As){' '}
                    <input
                      type="text"
                      data-testid="program-name-input"
                      maxLength={16}
                      value={naming}
                      onChange={(e) => piano.setProgramName(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </label>
                ) : null}
                <div className="status-actions">
                  <label className="status-detail pedal-control">
                    Control pedal{' '}
                    <input
                      type="range"
                      min={0}
                      max={127}
                      value={pedal}
                      data-testid="control-pedal"
                      aria-label="Control pedal (morph source, also MIDI CC11)"
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        setPedalUi(v)
                        piano.setPedal(v)
                      }}
                    />
                  </label>
                  <button type="button" className="chip" data-testid="panic" onClick={() => piano.panic()}>
                    Panic
                  </button>
                </div>
              </div>
              <div className="status-item">
                <span className="status-key">Sound engines</span>
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
                  {voices} / 24 voices per layer (A {piano.snapshot.perLayer.A} · B {piano.snapshot.perLayer.B}) · organ {perSlot.organA + perSlot.organB} · synth{' '}
                  {perSlot.synthA + perSlot.synthB + perSlot.synthC}
                  {piano.snapshot.sustain ? ' · sustain down' : ''}
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
                Phase 3: Organ, Piano, Synth, Layer Effects, Rotary and the Program section work. Grand, Upright and Electric play bundled recorded samples; Clav, Digital
                and Misc are synthesized in the browser, as are every organ model and the synth (live oscillators); reverb impulse responses and the organ click/synth
                noise buffers are generated.
              </p>
              <details className="status-detail unsupported-notes" data-testid="unsupported-notes">
                <summary>Unsupported controls (spec-excluded or optional, not implemented)</summary>
                <ul>
                  {Object.entries(UNSUPPORTED).map(([id, why]) => (
                    <li key={id} data-control={id}>
                      <strong>{CONTROL_LABELS.get(id)}</strong>: {why}
                    </li>
                  ))}
                  {Object.entries(UNSUPPORTED_SHIFT).map(([id, why]) => (
                    <li key={`shift-${id}`} data-control={id} data-shift="true">
                      Shift + {CONTROL_LABELS.get(id)}: {why}
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          </main>
        </div>
      </HardwareContext.Provider>
    </RuntimeContext.Provider>
  )
}

export default InstrumentApp
