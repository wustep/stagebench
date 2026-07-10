import { useEffect, useMemo, useReducer, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import {
  EFFECTS_CONTROLS, INITIAL_HARDWARE_STATE, KEYS, ORGAN_CONTROLS, ORGAN_DRAWBARS,
  PERFORMANCE_CONTROLS, PIANO_CONTROLS, PROGRAM_CONTROLS, SECTION_WIDTHS,
  SYNTH_CONTROLS, type HardwareControl, type HardwareState, type SectionId,
} from './hardware'
import { PianoInputController, type MidiAccessLike, type MidiInputLike } from './inputs'
import { BrowserPianoBackend, PianoNoteEngine, type NoteSnapshot, type PianoStatus } from './piano'

interface AppProps {
  engine?: PianoNoteEngine
  requestMidiAccess?: () => Promise<MidiAccessLike>
}

const EMPTY_NOTES: NoteSnapshot = { activeNotes: [], activeVoiceCount: 0, sustain: false }

function hardwareReducer(state: HardwareState, action: { id: string; value: number }): HardwareState {
  return { ...state, [action.id]: action.value }
}

function DecorativeControl({ control, value, onChange, compact = false }: {
  control: HardwareControl
  value: number
  onChange: (id: string, value: number) => void
  compact?: boolean
}) {
  if (control.kind === 'button') {
    const pressed = value === 1
    return (
      <button
        type="button"
        id={control.id}
        className={`panel-button ${pressed ? 'is-on' : ''} ${compact ? 'compact' : ''}`}
        aria-label={`${control.label} (decorative)`}
        aria-pressed={pressed}
        data-control-id={control.id}
        data-functional="false"
        onClick={() => onChange(control.id, pressed ? 0 : 1)}
      >
        <span className="button-led" aria-hidden="true" />
        <span>{control.label.replace(/^(Organ|Piano|Synth|Effects) /, '')}</span>
      </button>
    )
  }

  const rotation = -138 + (value / control.max) * 276
  return (
    <label className={`continuous-control ${control.kind} ${compact ? 'compact' : ''}`} htmlFor={control.id}>
      <span>{control.label.replace(/^(Organ|Piano|Synth|Effects) /, '')}</span>
      <span className="control-shell" style={{
        '--control-turn': `${rotation}deg`,
        '--control-position': `${82 - value * 0.72}%`,
        '--wheel-position': `${(50 - value) * 0.055}em`,
      } as CSSProperties}>
        <input
          id={control.id}
          type="range"
          min={control.min}
          max={control.max}
          step={control.step}
          value={value}
          aria-label={`${control.label} (decorative)`}
          data-control-id={control.id}
          data-functional="false"
          onChange={(event) => onChange(control.id, Number(event.currentTarget.value))}
        />
        {(control.kind === 'knob' || control.kind === 'encoder') && <span className="knob-face" aria-hidden="true" />}
        {control.kind === 'wheel' && <span className="wheel-face" aria-hidden="true" />}
      </span>
    </label>
  )
}

function Controls({ items, state, onChange, compact }: {
  items: HardwareControl[]
  state: HardwareState
  onChange: (id: string, value: number) => void
  compact?: boolean
}) {
  return <>{items.map((item) => <DecorativeControl key={item.id} control={item} value={state[item.id]} onChange={onChange} compact={compact} />)}</>
}

function Section({ id, title, children }: { id: SectionId; title: string; children: React.ReactNode }) {
  return (
    <section
      className={`instrument-section section-${id}`}
      data-section={id}
      aria-label={`${title} section`}
      style={{ '--section-width': `${SECTION_WIDTHS[id]}%` } as CSSProperties}
    >
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function PerformanceSection({ state, onChange }: { state: HardwareState; onChange: (id: string, value: number) => void }) {
  return (
    <Section id="performance" title="Performance">
      <div className="brand-lockup" aria-label="Nord Stage 4 73"><strong>nord</strong><span>STAGE 4</span><small>73</small></div>
      <div className="performance-knobs"><Controls items={[PERFORMANCE_CONTROLS[0], PERFORMANCE_CONTROLS[3], PERFORMANCE_CONTROLS[4]]} state={state} onChange={onChange} /></div>
      <div className="performance-wheels"><Controls items={[PERFORMANCE_CONTROLS[1], PERFORMANCE_CONTROLS[2]]} state={state} onChange={onChange} /></div>
    </Section>
  )
}

function OrganSection({ state, onChange }: { state: HardwareState; onChange: (id: string, value: number) => void }) {
  return (
    <Section id="organ" title="Organ">
      <div className="section-top-row"><Controls items={ORGAN_CONTROLS.slice(0, 8)} state={state} onChange={onChange} compact /></div>
      <div className="drawbar-bank" aria-label="Nine organ drawbars">
        <Controls items={ORGAN_DRAWBARS} state={state} onChange={onChange} compact />
      </div>
      <div className="section-bottom-row organ-bottom"><Controls items={ORGAN_CONTROLS.slice(8)} state={state} onChange={onChange} compact /></div>
    </Section>
  )
}

function PianoSection({ state, onChange }: { state: HardwareState; onChange: (id: string, value: number) => void }) {
  return (
    <Section id="piano" title="Piano">
      <div className="piano-levels"><Controls items={PIANO_CONTROLS.slice(0, 4)} state={state} onChange={onChange} compact /></div>
      <div className="type-stack" aria-label="Piano type selectors"><Controls items={PIANO_CONTROLS.slice(4, 10)} state={state} onChange={onChange} compact /></div>
      <div className="piano-detail"><Controls items={PIANO_CONTROLS.slice(10)} state={state} onChange={onChange} compact /></div>
    </Section>
  )
}

function ProgramSection({ state, onChange }: { state: HardwareState; onChange: (id: string, value: number) => void }) {
  return (
    <Section id="program" title="Program · Morph">
      <div className="primary-oled program-oled" data-primary-oled="program" aria-label="Program OLED, decorative">
        <span>PANEL ONLY</span><strong>— — —</strong><small>PROGRAM ENGINE OFF</small>
      </div>
      <div className="program-dial"><Controls items={PROGRAM_CONTROLS.slice(0, 1)} state={state} onChange={onChange} /></div>
      <div className="program-bank"><Controls items={PROGRAM_CONTROLS.slice(1, 9)} state={state} onChange={onChange} compact /></div>
      <div className="program-actions"><Controls items={PROGRAM_CONTROLS.slice(9)} state={state} onChange={onChange} compact /></div>
    </Section>
  )
}

function SynthSection({ state, onChange }: { state: HardwareState; onChange: (id: string, value: number) => void }) {
  return (
    <Section id="synth" title="Synth">
      <div className="synth-head">
        <div className="primary-oled synth-oled" data-primary-oled="synth" aria-label="Synth OLED, decorative"><span>SYNTH</span><strong>ENGINE OFF</strong><small>DECORATIVE PANEL</small></div>
        <div className="synth-layers"><Controls items={SYNTH_CONTROLS.slice(0, 6)} state={state} onChange={onChange} compact /></div>
      </div>
      <div className="synth-groups">
        <div><b>OSC</b><Controls items={SYNTH_CONTROLS.slice(6, 12)} state={state} onChange={onChange} compact /></div>
        <div><b>FILTER · LFO</b><Controls items={SYNTH_CONTROLS.slice(12, 20)} state={state} onChange={onChange} compact /></div>
        <div><b>ENVELOPES</b><Controls items={SYNTH_CONTROLS.slice(20, 27)} state={state} onChange={onChange} compact /></div>
        <div><b>ARP · VOICE</b><Controls items={SYNTH_CONTROLS.slice(27)} state={state} onChange={onChange} compact /></div>
      </div>
    </Section>
  )
}

function EffectsSection({ state, onChange }: { state: HardwareState; onChange: (id: string, value: number) => void }) {
  return (
    <Section id="effects" title="Layer Effects">
      <div className="effects-focus"><span>FOCUS</span><Controls items={EFFECTS_CONTROLS.slice(0, 3)} state={state} onChange={onChange} compact /></div>
      <div className="effects-matrix">
        <div><b>MOD 1</b><Controls items={EFFECTS_CONTROLS.slice(3, 6)} state={state} onChange={onChange} compact /></div>
        <div><b>MOD 2</b><Controls items={EFFECTS_CONTROLS.slice(6, 9)} state={state} onChange={onChange} compact /></div>
        <div><b>AMP · EQ</b><Controls items={EFFECTS_CONTROLS.slice(9, 14)} state={state} onChange={onChange} compact /></div>
        <div><b>DELAY</b><Controls items={EFFECTS_CONTROLS.slice(14, 18)} state={state} onChange={onChange} compact /></div>
        <div><b>COMP</b><Controls items={EFFECTS_CONTROLS.slice(18, 20)} state={state} onChange={onChange} compact /></div>
        <div><b>REVERB</b><Controls items={EFFECTS_CONTROLS.slice(20, 24)} state={state} onChange={onChange} compact /></div>
      </div>
      <div className="effects-footer"><Controls items={EFFECTS_CONTROLS.slice(24)} state={state} onChange={onChange} compact /></div>
    </Section>
  )
}

function Keybed({ controller, activeNotes }: { controller: PianoInputController; activeNotes: number[] }) {
  const active = new Set(activeNotes)
  const whiteKeys = KEYS.filter((key) => !key.black)
  const blackKeys = KEYS.filter((key) => key.black)

  const accessibilityDown = (event: KeyboardEvent<HTMLButtonElement>, midi: number) => {
    if ((event.code === 'Enter' || event.code === 'Space') && !event.repeat) {
      event.preventDefault()
      controller.pointerDown(10_000 + midi, midi, 0.76)
    }
  }
  const accessibilityUp = (event: KeyboardEvent<HTMLButtonElement>, midi: number) => {
    if (event.code === 'Enter' || event.code === 'Space') {
      event.preventDefault()
      controller.pointerUp(10_000 + midi)
    }
  }
  const pointerDown = (event: PointerEvent<HTMLButtonElement>, midi: number) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const rect = event.currentTarget.getBoundingClientRect()
    const velocity = Math.max(0.2, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)))
    controller.pointerDown(event.pointerId, midi, velocity)
  }
  const pointerUp = (event: PointerEvent<HTMLButtonElement>) => controller.pointerUp(event.pointerId)

  return (
    <div className="keybed" data-key-count={KEYS.length} data-range="E1–E7" aria-label="73 key hammer-action keybed">
      <div className="white-keys">
        {whiteKeys.map((key) => (
          <button
            type="button" key={key.id} id={key.id}
            className={`piano-key white-key ${active.has(key.midi) ? 'is-active' : ''}`}
            aria-label={`${key.note}${key.octave} piano key`}
            aria-pressed={active.has(key.midi)}
            data-midi={key.midi}
            onPointerDown={(event) => pointerDown(event, key.midi)}
            onPointerUp={pointerUp} onPointerCancel={pointerUp} onLostPointerCapture={pointerUp}
            onKeyDown={(event) => accessibilityDown(event, key.midi)} onKeyUp={(event) => accessibilityUp(event, key.midi)}
            onBlur={() => controller.pointerUp(10_000 + key.midi)}
          />
        ))}
      </div>
      <div className="black-keys" aria-hidden="false">
        {blackKeys.map((key) => (
          <button
            type="button" key={key.id} id={key.id}
            className={`piano-key black-key ${active.has(key.midi) ? 'is-active' : ''}`}
            style={{ left: `${((key.blackOffset ?? 0) / 43) * 100}%` }}
            aria-label={`${key.note}${key.octave} piano key`}
            aria-pressed={active.has(key.midi)}
            data-midi={key.midi}
            onPointerDown={(event) => pointerDown(event, key.midi)}
            onPointerUp={pointerUp} onPointerCancel={pointerUp} onLostPointerCapture={pointerUp}
            onKeyDown={(event) => accessibilityDown(event, key.midi)} onKeyUp={(event) => accessibilityUp(event, key.midi)}
            onBlur={() => controller.pointerUp(10_000 + key.midi)}
          />
        ))}
      </div>
    </div>
  )
}

function connectedMidiLabel(inputs: MidiInputLike[]): string {
  if (inputs.length === 0) return 'MIDI disconnected'
  return `MIDI connected · ${inputs.map((input) => input.name || input.id).join(', ')}`
}

export default function App({ engine: suppliedEngine, requestMidiAccess }: AppProps) {
  const engine = useMemo(() => suppliedEngine ?? new PianoNoteEngine(new BrowserPianoBackend()), [suppliedEngine])
  const [notes, setNotes] = useState<NoteSnapshot>(EMPTY_NOTES)
  const [pianoStatus, setPianoStatus] = useState<PianoStatus>(() => engine.getStatus())
  const [midiStatus, setMidiStatus] = useState('MIDI not connected')
  const [hardware, dispatchHardware] = useReducer(hardwareReducer, INITIAL_HARDWARE_STATE)
  const controller = useMemo(
    () => new PianoInputController(engine, (inputs) => setMidiStatus(connectedMidiLabel(inputs))),
    [engine],
  )

  useEffect(() => engine.subscribe(setNotes), [engine])
  useEffect(() => engine.subscribeStatus(setPianoStatus), [engine])
  useEffect(() => {
    const keyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target
      if (target instanceof Element && target.matches('button, input, select, textarea')) return
      if (controller.keyDown(event.code, event.repeat)) event.preventDefault()
    }
    const keyUp = (event: globalThis.KeyboardEvent) => {
      const target = event.target
      if (target instanceof Element && target.matches('button, input, select, textarea')) return
      if (controller.keyUp(event.code)) event.preventDefault()
    }
    const cleanup = () => controller.allNotesOff()
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', cleanup)
    document.addEventListener('visibilitychange', cleanup)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('blur', cleanup)
      document.removeEventListener('visibilitychange', cleanup)
      controller.dispose()
    }
  }, [controller])

  const connectMidi = async () => {
    const request = requestMidiAccess ?? (navigator as Navigator & { requestMIDIAccess?: () => Promise<MidiAccessLike> }).requestMIDIAccess?.bind(navigator)
    if (!request) {
      setMidiStatus('Web MIDI unsupported in this browser')
      controller.allNotesOff()
      return
    }
    setMidiStatus('Requesting MIDI access…')
    try {
      controller.attachMidiAccess(await request())
    } catch {
      controller.allNotesOff()
      setMidiStatus('MIDI access denied')
    }
  }

  const changeHardware = (id: string, value: number) => dispatchHardware({ id, value })

  return (
    <main className="app-shell">
      <header className="utility-bar">
        <div><span className={`status-dot ${pianoStatus.state}`} /> <strong>{pianoStatus.label}</strong></div>
        <div><span>{notes.activeVoiceCount} voices</span><span>{notes.sustain ? 'Sustain on' : 'Sustain off'}</span></div>
        <button type="button" onClick={connectMidi}>{midiStatus}</button>
        <p>A–' and Z–, play · Space sustains · Panel controls are tactile demonstrations only</p>
      </header>

      <div className="instrument-stage">
        <article className="instrument" aria-label="Nord Stage 4 73 browser instrument" data-variant="stage-4-73">
          <div className="top-rail"><span>NORD STAGE 4</span><span>73 · HAMMER ACTION</span></div>
          <div className="control-deck" data-deck-ratio="0.54">
            <PerformanceSection state={hardware} onChange={changeHardware} />
            <OrganSection state={hardware} onChange={changeHardware} />
            <PianoSection state={hardware} onChange={changeHardware} />
            <ProgramSection state={hardware} onChange={changeHardware} />
            <SynthSection state={hardware} onChange={changeHardware} />
            <EffectsSection state={hardware} onChange={changeHardware} />
          </div>
          <div className="keybed-deck" data-keybed-ratio="0.46">
            <div className="keybed-cheek left-cheek"><span>NS4</span></div>
            <Keybed controller={controller} activeNotes={notes.activeNotes} />
            <div className="keybed-cheek right-cheek"><span>73</span></div>
          </div>
          <div className="front-lip"><span>STAGE 4</span></div>
        </article>
      </div>

      <footer className="phase-note">PHASE 1 · One modeled piano voice is active. Organ, Piano panel, Program, Synth, and Effects controls are decorative.</footer>
    </main>
  )
}
