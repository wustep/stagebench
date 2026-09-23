import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPianoOutput, NoteLifecycle, type PianoOutput } from './audio'
import {
  COMPUTER_KEY_MAP,
  CONTROL_GROUPS,
  HARDWARE_CONTROLS,
  INITIAL_HARDWARE_STATE,
  KEY_MODEL,
  SECTIONS,
  type ControlDefinition,
  type KeyDefinition,
  type SectionDefinition,
} from './hardware'

interface MidiMessageLike {
  data: Uint8Array
}

interface MidiPortLike {
  id?: string
  name?: string
  state?: string
  onmidimessage: ((event: MidiMessageLike) => void) | null
}

interface MidiStateChangeLike {
  port?: { id?: string; state?: string; type?: string }
}

export interface MidiAccessLike {
  inputs: Map<string, MidiPortLike>
  addEventListener?(type: 'statechange', listener: (event: MidiStateChangeLike) => void): void
  removeEventListener?(type: 'statechange', listener: (event: MidiStateChangeLike) => void): void
}

export interface AppProps {
  audioOutputFactory?: () => PianoOutput
  midiAccessFactory?: () => Promise<MidiAccessLike>
}

type AudioState = 'loading' | 'ready' | 'error' | 'fallback'
type MidiState = 'disconnected' | 'connecting' | 'connected' | 'denied' | 'unavailable'

const midiFactoryFromBrowser = (): Promise<MidiAccessLike> => {
  const navigatorWithMidi = navigator as Navigator & { requestMIDIAccess?: () => Promise<MidiAccessLike> }
  if (!navigatorWithMidi.requestMIDIAccess) return Promise.reject(new Error('Web MIDI is not supported by this browser'))
  return navigatorWithMidi.requestMIDIAccess().then((access) => access as unknown as MidiAccessLike)
}

const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value))

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], button'))
}

function Control({
  control,
  value,
  onChange,
}: {
  control: ControlDefinition
  value: number
  onChange: (next: number) => void
}) {
  const isButton = control.kind === 'button'
  const rotation = -138 + value * 2.76
  const shapeClass = `hardware-control hardware-${control.kind}`
  if (isButton) {
    return (
      <button
        type="button"
        className={`${shapeClass}${value ? ' is-active' : ''}`}
        data-control-id={control.id}
        data-control-kind={control.kind}
        aria-label={control.name}
        aria-pressed={value > 0}
        onClick={() => onChange(value > 0 ? 0 : 1)}
      >
        <span className="button-lamp" aria-hidden="true" />
        <span className="control-legend">{control.legend}</span>
      </button>
    )
  }

  return (
    <label
      className={shapeClass}
      data-control-id={control.id}
      data-control-kind={control.kind}
      style={{ '--control-rotation': `${rotation}deg`, '--control-position': `${100 - value}%` } as CSSProperties}
    >
      <span className="control-name">{control.legend}</span>
      {control.kind === 'drawbar' && <span className="drawbar-leds" aria-hidden="true">{Array.from({ length: 8 }, (_, index) => <i className={index >= 7 - Math.round(value / 100 * 7) ? 'lit' : ''} key={index} />)}</span>}
      <span className="control-visual" aria-hidden="true"><i /></span>
      <input
        type="range"
        min={control.min}
        max={control.max}
        step={control.step}
        value={value}
        aria-label={control.name}
        aria-valuetext={`${Math.round(value)} percent`}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <span className="control-value" aria-hidden="true">{Math.round(value)}</span>
    </label>
  )
}

function InstrumentSection({
  section,
  hardware,
  onControlChange,
}: {
  section: SectionDefinition
  hardware: Record<string, number>
  onControlChange: (control: ControlDefinition, next: number) => void
}) {
  const groups = CONTROL_GROUPS(section.id)
  const sectionControls = HARDWARE_CONTROLS.filter((control) => control.section === section.id)
  const content = groups.map((group) => {
    const controls = sectionControls.filter((control) => control.group === group)
    return (
      <div className={`control-group group-${group.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`} key={group}>
        <h3>{group}</h3>
        <div className="group-controls">
          {controls.map((control) => (
            <Control
              key={control.id}
              control={control}
              value={hardware[control.id] ?? control.initial}
              onChange={(next) => onControlChange(control, next)}
            />
          ))}
        </div>
      </div>
    )
  })

  return (
    <section
      className={`instrument-section section-${section.id}${section.panel ? ' inset-panel' : ''}`}
      data-section-id={section.id}
      aria-label={`${section.label} section`}
      style={{ flexBasis: `${Number((section.fraction * 100).toFixed(4))}%` }}
    >
      <h2 className="section-heading">{section.label}</h2>
      {section.id === 'program' && <ProgramDisplay />}
      {section.id === 'synth' && <SynthDisplay />}
      {content}
      {section.id === 'performance' && <div className="nord-mark" aria-label="Nord Stage 4 branding"><strong>nord stage 4</strong><span>PERFORMANCE KEYBOARD</span></div>}
    </section>
  )
}

function ProgramDisplay() {
  return (
    <div className="oled-screen program-oled" data-primary-display="program" aria-label="Program OLED, decorative in Phase 1">
      <span>STAGE 4 · 73</span>
      <strong>PHASE 1</strong>
      <small>DECORATIVE DISPLAY</small>
    </div>
  )
}

function SynthDisplay() {
  return (
    <div className="oled-screen synth-oled" data-primary-display="synth" aria-label="Synth OLED, decorative in Phase 1">
      <span>SYNTH</span>
      <strong>INACTIVE</strong>
    </div>
  )
}

function PianoKey({
  keyDefinition,
  pressed,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onKeyboardDown,
  onKeyboardUp,
}: {
  keyDefinition: KeyDefinition
  pressed: boolean
  onPointerDown: (key: KeyDefinition, event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onKeyboardDown: (key: KeyDefinition, event: ReactKeyboardEvent<HTMLButtonElement>) => void
  onKeyboardUp: (event: ReactKeyboardEvent<HTMLButtonElement>) => void
}) {
  const style = keyDefinition.color === 'black'
    ? { left: `${(keyDefinition.blackKeyOffset ?? 0) / 43 * 100}%` }
    : { left: `${keyDefinition.whiteIndex / 43 * 100}%`, width: `${100 / 43}%` }

  return (
    <button
      type="button"
      className={`piano-key key-${keyDefinition.color}${pressed ? ' is-pressed' : ''}`}
      data-key-id={keyDefinition.id}
      data-midi={keyDefinition.midi}
      data-key-color={keyDefinition.color}
      aria-label={`${keyDefinition.note} piano key`}
      aria-pressed={pressed}
      style={style}
      onPointerDown={(event) => onPointerDown(keyDefinition, event)}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onKeyDown={(event) => onKeyboardDown(keyDefinition, event)}
      onKeyUp={onKeyboardUp}
      onContextMenu={(event) => event.preventDefault()}
    />
  )
}

function PianoKeybed({
  pressedMidi,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onKeyboardDown,
  onKeyboardUp,
}: {
  pressedMidi: Record<number, number>
  onPointerDown: (key: KeyDefinition, event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onKeyboardDown: (key: KeyDefinition, event: ReactKeyboardEvent<HTMLButtonElement>) => void
  onKeyboardUp: (event: ReactKeyboardEvent<HTMLButtonElement>) => void
}) {
  return (
    <section className="keybed" aria-label="73-key hammer action keybed, E2 to E8" data-key-count={KEY_MODEL.length}>
      <div className="keybed-inner" role="group" aria-label="73-key keyboard, E2 to E8">
        {KEY_MODEL.filter((key) => key.color === 'white').map((key) => (
          <PianoKey key={key.id} keyDefinition={key} pressed={(pressedMidi[key.midi] ?? 0) > 0} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onKeyboardDown={onKeyboardDown} onKeyboardUp={onKeyboardUp} />
        ))}
        {KEY_MODEL.filter((key) => key.color === 'black').map((key) => (
          <PianoKey key={key.id} keyDefinition={key} pressed={(pressedMidi[key.midi] ?? 0) > 0} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onKeyboardDown={onKeyboardDown} onKeyboardUp={onKeyboardUp} />
        ))}
      </div>
    </section>
  )
}

function midiFactoryErrorIsDenied(error: unknown): boolean {
  return error instanceof DOMException ? error.name === 'NotAllowedError' || error.name === 'SecurityError' : error instanceof Error && /denied|not allowed|permission/i.test(error.message)
}

export default function App({ audioOutputFactory = createPianoOutput, midiAccessFactory = midiFactoryFromBrowser }: AppProps) {
  const output = useMemo(audioOutputFactory, [audioOutputFactory])
  const lifecycle = useMemo(() => new NoteLifecycle(output, 32), [output])
  const [hardware, setHardware] = useState(INITIAL_HARDWARE_STATE)
  const [pressedMidi, setPressedMidi] = useState<Record<number, number>>({})
  const [audioState, setAudioState] = useState<AudioState>('loading')
  const [audioError, setAudioError] = useState('')
  const [midiState, setMidiState] = useState<MidiState>('disconnected')
  const [midiError, setMidiError] = useState('')
  const [sustainDown, setSustainDown] = useState(false)
  const sourceNotes = useRef(new Map<string, number>())
  const pointerNotes = useRef(new Map<number, string>())
  const keybedNotes = useRef(new Map<string, string>())
  const computerNotes = useRef(new Map<string, string>())
  const midiNotes = useRef(new Map<string, string[]>())
  const midiSourceIds = useRef(new Map<string, Set<string>>())
  const midiSustainSources = useRef(new Set<string>())
  const sustainSources = useRef(new Set<string>())
  const midiSequence = useRef(0)
  const midiAccess = useRef<MidiAccessLike | null>(null)
  const midiHandlers = useRef(new Map<string, (event: MidiMessageLike) => void>())
  const midiStateHandler = useRef<((event: MidiStateChangeLike) => void) | null>(null)

  const startNote = useCallback((id: string, midi: number, velocity: number) => {
    sourceNotes.current.set(id, midi)
    setPressedMidi((current) => ({ ...current, [midi]: (current[midi] ?? 0) + 1 }))
    try {
      lifecycle.noteOn(id, midi, velocity)
      setAudioState('ready')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The piano voice could not start.'
      setAudioState(/unavailable/i.test(message) ? 'fallback' : 'error')
      setAudioError(message)
    }
  }, [lifecycle])

  const releaseNote = useCallback((id: string) => {
    const midi = sourceNotes.current.get(id)
    if (midi === undefined) return
    sourceNotes.current.delete(id)
    lifecycle.noteOff(id)
    setPressedMidi((current) => {
      const nextCount = (current[midi] ?? 1) - 1
      if (nextCount <= 0) {
        const next = { ...current }
        delete next[midi]
        return next
      }
      return { ...current, [midi]: nextCount }
    })
  }, [lifecycle])

  const setSustainSource = useCallback((id: string, isDown: boolean) => {
    if (isDown) sustainSources.current.add(id)
    else sustainSources.current.delete(id)
    const down = sustainSources.current.size > 0
    lifecycle.setSustain(down)
    setSustainDown(down)
  }, [lifecycle])

  const releaseAll = useCallback(() => {
    sourceNotes.current.clear()
    pointerNotes.current.clear()
    keybedNotes.current.clear()
    computerNotes.current.clear()
    midiNotes.current.clear()
    midiSourceIds.current.clear()
    midiSustainSources.current.clear()
    sustainSources.current.clear()
    setPressedMidi({})
    setSustainDown(false)
    lifecycle.allNotesOff()
  }, [lifecycle])

  const disconnectMidiPort = useCallback((portId: string) => {
    const prefix = `${portId}:`
    for (const [key, ids] of midiNotes.current) {
      if (!key.startsWith(prefix)) continue
      ids.forEach(releaseNote)
      midiNotes.current.delete(key)
    }
    midiSourceIds.current.delete(portId)
    for (const source of midiSustainSources.current) {
      if (source.startsWith(`midi:${portId}:`)) {
        midiSustainSources.current.delete(source)
        setSustainSource(source, false)
      }
    }
    let connected = false
    for (const [id, input] of midiAccess.current?.inputs ?? []) {
      if (id !== portId && input.state === 'connected') connected = true
    }
    if (!connected) setMidiState('disconnected')
  }, [releaseNote, setSustainSource])

  const handleMidiMessage = useCallback((portId: string, event: MidiMessageLike) => {
    const [status = 0, data1 = 0, data2 = 0] = event.data
    const command = status & 0xf0
    const channel = status & 0x0f
    if (command === 0x90 && data2 > 0) {
      const key = `${portId}:${channel}:${data1}`
      const id = `midi:${key}:${midiSequence.current++}`
      const notes = midiNotes.current.get(key) ?? []
      notes.push(id)
      midiNotes.current.set(key, notes)
      const portNotes = midiSourceIds.current.get(portId) ?? new Set<string>()
      portNotes.add(id)
      midiSourceIds.current.set(portId, portNotes)
      startNote(id, data1, data2)
    } else if (command === 0x80 || (command === 0x90 && data2 === 0)) {
      const key = `${portId}:${channel}:${data1}`
      const notes = midiNotes.current.get(key)
      const id = notes?.shift()
      if (id) {
        releaseNote(id)
        midiSourceIds.current.get(portId)?.delete(id)
      }
      if (notes && notes.length === 0) midiNotes.current.delete(key)
    } else if (command === 0xb0 && data1 === 64) {
      const source = `midi:${portId}:${channel}`
      const down = data2 >= 64
      if (down) midiSustainSources.current.add(source)
      else midiSustainSources.current.delete(source)
      setSustainSource(source, down)
    }
  }, [releaseNote, setSustainSource, startNote])

  const connectMidi = useCallback(async () => {
    setMidiState('connecting')
    setMidiError('')
    try {
      const access = await midiAccessFactory()
      midiAccess.current = access
      for (const [id, input] of access.inputs) {
        if (input.state === 'disconnected') continue
        const handler = (event: MidiMessageLike) => handleMidiMessage(id, event)
        input.onmidimessage = handler
        midiHandlers.current.set(id, handler)
      }
      const stateHandler = (event: MidiStateChangeLike) => {
        const port = event.port
        if (!port || port.type === 'output') return
        const id = port.id ?? ''
        if (port.state === 'disconnected') disconnectMidiPort(id)
        else if (port.state === 'connected') setMidiState('connected')
      }
      access.addEventListener?.('statechange', stateHandler)
      midiStateHandler.current = stateHandler
      setMidiState('connected')
    } catch (error) {
      if (midiFactoryErrorIsDenied(error)) setMidiState('denied')
      else if (error instanceof Error && /not supported/i.test(error.message)) setMidiState('unavailable')
      else setMidiState('unavailable')
      setMidiError(error instanceof Error ? error.message : 'Web MIDI connection failed.')
    }
  }, [disconnectMidiPort, handleMidiMessage, midiAccessFactory])

  const changeControl = useCallback((control: ControlDefinition, next: number) => {
    setHardware((current) => ({ ...current, [control.id]: clamp(next, control.min, control.max) }))
  }, [])

  const onPointerDown = useCallback((key: KeyDefinition, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const pointerId = event.pointerId ?? 0
    const old = pointerNotes.current.get(pointerId)
    if (old) releaseNote(old)
    const id = `pointer:${pointerId}`
    pointerNotes.current.set(pointerId, id)
    try { event.currentTarget.setPointerCapture(pointerId) } catch { /* Pointer capture is not available in every browser. */ }
    startNote(id, key.midi, 96)
  }, [releaseNote, startNote])

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const pointerId = event.pointerId ?? 0
    const id = pointerNotes.current.get(pointerId)
    if (id) releaseNote(id)
    pointerNotes.current.delete(pointerId)
  }, [releaseNote])

  const onPointerCancel = onPointerUp

  const onKeybedDown = useCallback((key: KeyDefinition, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.repeat || (event.key !== ' ' && event.key !== 'Enter')) return
    event.preventDefault()
    const token = `${key.id}:${event.key}`
    if (keybedNotes.current.has(token)) return
    const id = `keybed:${token}`
    keybedNotes.current.set(token, id)
    startNote(id, key.midi, 96)
  }, [startNote])

  const onKeybedUp = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const token = `${(event.currentTarget as HTMLButtonElement).dataset.keyId}:${event.key}`
    const id = keybedNotes.current.get(token)
    if (id) releaseNote(id)
    keybedNotes.current.delete(token)
  }, [releaseNote])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return
      if (event.code === 'Space') {
        event.preventDefault()
        if (!event.repeat) setSustainSource('computer-sustain', true)
        return
      }
      const midi = COMPUTER_KEY_MAP[event.code]
      if (midi === undefined || event.repeat || computerNotes.current.has(event.code)) return
      const id = `computer:${event.code}`
      computerNotes.current.set(event.code, id)
      startNote(id, midi, 88)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        setSustainSource('computer-sustain', false)
        return
      }
      const id = computerNotes.current.get(event.code)
      if (id) releaseNote(id)
      computerNotes.current.delete(event.code)
    }
    const onBlur = () => releaseAll()
    const onVisibility = () => { if (document.visibilityState === 'hidden') releaseAll() }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    setAudioState('ready')
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      for (const [id, handler] of midiHandlers.current) {
        const input = midiAccess.current?.inputs.get(id)
        if (input?.onmidimessage === handler) input.onmidimessage = null
      }
      if (midiStateHandler.current) midiAccess.current?.removeEventListener?.('statechange', midiStateHandler.current)
      lifecycle.allNotesOff()
      output.dispose()
    }
  }, [lifecycle, output, releaseAll, releaseNote, setSustainSource, startNote])

  const toggleUiSustain = () => setSustainSource('ui-sustain', !sustainSources.current.has('ui-sustain'))
  const audioLabel = audioState === 'ready'
    ? 'Ready · generated piano synthesis'
    : audioState === 'loading'
      ? 'Loading piano voice…'
    : audioState === 'fallback'
        ? `Fallback · ${audioError || 'Web Audio is unavailable; note keys still respond'}`
        : `Audio error · ${audioError || 'check browser audio permission'}`
  const midiLabel: Record<MidiState, string> = {
    disconnected: 'MIDI disconnected', connecting: 'MIDI connecting…', connected: 'MIDI connected', denied: 'MIDI permission denied', unavailable: 'MIDI unavailable',
  }

  return (
    <main className="stage-page">
      <header className="page-heading">
        <span className="page-model">NORD STAGE 4</span>
        <span className="variant-tag">73 · HAMMER ACTION</span>
      </header>
      <div className="instrument" data-instrument="stage-4-73" aria-label="Nord Stage 4 73">
        <div className="instrument-top-rail" aria-hidden="true">
          <span>PROGRAM</span><span>ORGAN</span><span>PIANO</span><span>PERFORMANCE</span><span>SYNTH</span><span>LAYER EFFECTS</span>
        </div>
        <div className="deck-sections">
          {SECTIONS.map((section) => <InstrumentSection key={section.id} section={section} hardware={hardware} onControlChange={changeControl} />)}
        </div>
        <div className="deck-front-rail" aria-hidden="true"><span>NORD STAGE 4</span><span>73</span></div>
        <PianoKeybed
          pressedMidi={pressedMidi}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onKeyboardDown={onKeybedDown}
          onKeyboardUp={onKeybedUp}
        />
      </div>
      <footer className="instrument-status">
        <span className={`status-light audio-${audioState}`} aria-label={`Audio status: ${audioState}`} />
        <span className="audio-status" role="status" aria-live="polite">{audioLabel}</span>
        <button type="button" className={`pedal-switch${sustainDown ? ' is-active' : ''}`} aria-label="Sustain pedal" aria-pressed={sustainDown} onClick={toggleUiSustain}>
          <span className="button-lamp" aria-hidden="true" />
          <span>SUSTAIN</span>
        </button>
        <span className={`midi-status midi-${midiState}`} role="status" aria-live="polite">{midiLabel[midiState]}</span>
        <button type="button" className="midi-connect" onClick={() => void connectMidi()} disabled={midiState === 'connecting'}>
          {midiState === 'connected' ? 'Reconnect MIDI' : 'Connect MIDI'}
        </button>
        {midiError && <span className="midi-error" aria-live="polite">{midiError}</span>}
        <span className="keyboard-hint">A W S E D F T G H U J I K · hold Space for sustain</span>
      </footer>
      <div className="unsupported-note">Panel controls are presentation-only in Phase 1.</div>
    </main>
  )
}
