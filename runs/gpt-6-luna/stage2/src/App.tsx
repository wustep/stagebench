import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPianoOutput, NoteLifecycle, type AudioConfiguration, type EffectUnitId, type EffectUnitState, type LayerId, type PianoOutput, type PianoType } from './audio'
import { defaultConfiguration, EFFECT_TYPE_OPTIONS } from './audio-graph'
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

const CONTROL_CYCLES: Record<string, string[]> = {
  'piano-kb-touch': ['Heavy', 'Medium', 'Light'],
  'piano-dyn-comp': ['Off', '1', '2', '3'],
  'piano-timbre': ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'],
  'piano-unison': ['Off', '1', '2', '3'],
  'effects-effect-1-type': EFFECT_TYPE_OPTIONS.mod1,
  'effects-effect-2-type': EFFECT_TYPE_OPTIONS.mod2,
  'effects-amp-mode': EFFECT_TYPE_OPTIONS.ampEq,
  'effects-delay-filter': ['Off', 'LP', 'HP', 'BP'],
  'effects-reverb-type': EFFECT_TYPE_OPTIONS.reverb,
}

const SELECTABLE_CONTROLS = new Set([
  'piano-type-grand', 'piano-type-upright', 'piano-type-electric', 'piano-type-clav', 'piano-type-digital', 'piano-type-misc',
  'piano-layer-a-focus', 'piano-layer-b-focus',
  'effects-focus-a', 'effects-focus-b', 'effects-focus-organ', 'effects-focus-piano', 'effects-focus-synth',
])

function effectHardwareState(hardware: Record<string, number>, configuration: AudioConfiguration, focus: LayerId): Record<string, number> {
  const units = configuration.effects.units[focus]
  const indexOf = (options: string[], value: string) => Math.max(0, options.indexOf(value))
  return {
    ...hardware,
    'effects-focus-a': focus === 'A' ? 1 : 0,
    'effects-focus-b': focus === 'B' ? 1 : 0,
    'piano-layer-a-focus': focus === 'A' ? 1 : 0,
    'piano-layer-b-focus': focus === 'B' ? 1 : 0,
    'effects-effect-1-rate': Math.round(units.mod1.rate * 100),
    'effects-effect-1-depth': Math.round(units.mod1.amount * 100),
    'effects-effect-1-type': indexOf(EFFECT_TYPE_OPTIONS.mod1, units.mod1.type),
    'effects-effect-1-on': units.mod1.on ? 1 : 0,
    'effects-effect-2-rate': Math.round(units.mod2.rate * 100),
    'effects-effect-2-depth': Math.round(units.mod2.amount * 100),
    'effects-effect-2-type': indexOf(EFFECT_TYPE_OPTIONS.mod2, units.mod2.type),
    'effects-effect-2-on': units.mod2.on ? 1 : 0,
    'effects-amp-mode': indexOf(EFFECT_TYPE_OPTIONS.ampEq, units.ampEq.type),
    'effects-amp-on': units.ampEq.on ? 1 : 0,
    'effects-amp-drive': Math.round(units.ampEq.drive * 100),
    'effects-eq-bass': Math.round(units.ampEq.bass * 100),
    'effects-eq-mid': Math.round(units.ampEq.mid * 100),
    'effects-eq-mid-frequency': Math.round(units.ampEq.midFrequency * 100),
    'effects-eq-treble': Math.round(units.ampEq.treble * 100),
    'effects-delay-time': Math.round(units.delay.time * 100),
    'effects-delay-feedback': Math.round(units.delay.feedback * 100),
    'effects-delay-mix': Math.round(units.delay.mix * 100),
    'effects-delay-filter': indexOf(CONTROL_CYCLES['effects-delay-filter'] ?? [], units.delay.filter),
    'effects-delay-global': units.delay.global ? 1 : 0,
    'effects-delay-on': units.delay.on ? 1 : 0,
    'effects-compressor-amount': Math.round(units.compressor.amount * 100),
    'effects-compressor-fast': units.compressor.fast ? 1 : 0,
    'effects-compressor-global': units.compressor.global ? 1 : 0,
    'effects-compressor-on': units.compressor.on ? 1 : 0,
    'effects-reverb-depth': Math.round(units.reverb.mix * 100),
    'effects-reverb-time': Math.round(units.reverb.decay * 100),
    'effects-reverb-type': indexOf(EFFECT_TYPE_OPTIONS.reverb, units.reverb.type),
    'effects-reverb-brightness': Math.round(units.reverb.brightness * 100),
    'effects-reverb-global': units.reverb.global ? 1 : 0,
    'effects-reverb-on': units.reverb.on ? 1 : 0,
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], button'))
}

function Control({
  control,
  value,
  cycleOptions,
  onChange,
}: {
  control: ControlDefinition
  value: number
  cycleOptions?: string[]
  onChange: (next: number) => void
}) {
  const isButton = control.kind === 'button'
  const cycle = cycleOptions ?? CONTROL_CYCLES[control.id]
  const cycleValue = cycle?.[Math.round(value)]
  const selectable = SELECTABLE_CONTROLS.has(control.id)
  const rotation = -138 + value * 2.76
  const shapeClass = `hardware-control hardware-${control.kind}`
  if (isButton) {
    return (
      <button
        type="button"
        className={`${shapeClass}${value ? ' is-active' : ''}`}
        data-control-id={control.id}
        data-control-kind={control.kind}
        aria-label={cycle && cycleValue ? `${control.name}: ${cycleValue}` : control.name}
        aria-pressed={value > 0}
        onClick={() => onChange(cycle ? (Math.round(value) + 1) % cycle.length : selectable ? 1 : value > 0 ? 0 : 1)}
      >
        <span className="button-lamp" aria-hidden="true" />
        <span className="control-legend">{cycleValue ?? control.legend}</span>
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
  audioConfiguration,
  onControlChange,
}: {
  section: SectionDefinition
  hardware: Record<string, number>
  audioConfiguration: AudioConfiguration
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
              cycleOptions={control.id === 'piano-timbre' && audioConfiguration.pianoType !== 'Electric' ? CONTROL_CYCLES[control.id]?.slice(0, 4) : CONTROL_CYCLES[control.id]}
              onChange={(next) => onControlChange(control, next)}
            />
          ))}
        </div>
      </div>
    )
  })

  const pianoModel = {
    Grand: 'Salamander Grand Piano', Upright: 'Upright Piano KW', Electric: 'jRhodes3d Rhodes',
    Clav: 'Synth Clav', Digital: 'Digital Piano', Misc: 'Mallet Piano',
  }[audioConfiguration.pianoType]
  const focusMessage = audioConfiguration.effects.manualSection === 'Piano'
    ? `Piano effects · Layer ${audioConfiguration.effects.focus}`
    : `${audioConfiguration.effects.manualSection} focus · engine is decorative in Phase 2`

  return (
    <section
      className={`instrument-section section-${section.id}${section.panel ? ' inset-panel' : ''}`}
      data-section-id={section.id}
      aria-label={`${section.label} section`}
      style={{ flexBasis: `${Number((section.fraction * 100).toFixed(4))}%` }}
    >
      <h2 className="section-heading">{section.label}</h2>
      {section.id === 'program' && <ProgramDisplay modelName={pianoModel} />}
      {section.id === 'synth' && <SynthDisplay />}
      {content}
      {section.id === 'piano' && <div className="piano-state-readout" aria-label={`Layer A octave ${audioConfiguration.layers.A.octave}, layer B octave ${audioConfiguration.layers.B.octave}`}>
        <span>A {audioConfiguration.layers.A.octave > 0 ? '+' : ''}{audioConfiguration.layers.A.octave} OCT</span>
        <span>B {audioConfiguration.layers.B.octave > 0 ? '+' : ''}{audioConfiguration.layers.B.octave} OCT</span>
      </div>}
      {section.id === 'effects' && <div className="effects-state-readout" role="status" aria-live="polite">{focusMessage}</div>}
      {section.id === 'performance' && <div className="nord-mark" aria-label="Nord Stage 4 branding"><strong>nord stage 4</strong><span>PERFORMANCE KEYBOARD</span></div>}
    </section>
  )
}

function ProgramDisplay({ modelName }: { modelName: string }) {
  return (
    <div className="oled-screen program-oled" data-primary-display="program" aria-label="Program OLED, piano model name shown; program controls decorative in Phase 2">
      <span>STAGE 4 · 73</span>
      <strong>{modelName}</strong>
      <small>PIANO MODEL · PROGRAM CONTROLS DECORATIVE</small>
    </div>
  )
}

function SynthDisplay() {
  return (
    <div className="oled-screen synth-oled" data-primary-display="synth" aria-label="Synth OLED, decorative in Phase 2">
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
  const [audioConfiguration, setAudioConfiguration] = useState<AudioConfiguration>(defaultConfiguration)
  const audioConfigurationRef = useRef(audioConfiguration)
  audioConfigurationRef.current = audioConfiguration
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
  const sustainLayerRouting = useRef<LayerId[]>([])
  const midiSequence = useRef(0)
  const delayTapTime = useRef<number | null>(null)
  const midiAccess = useRef<MidiAccessLike | null>(null)
  const midiHandlers = useRef(new Map<string, (event: MidiMessageLike) => void>())
  const midiStateHandler = useRef<((event: MidiStateChangeLike) => void) | null>(null)

  const enabledLayers = useCallback((): LayerId[] => {
    const current = audioConfigurationRef.current
    return current.sectionOn ? (['A', 'B'] as LayerId[]).filter((layer) => current.layers[layer].enabled) : []
  }, [])

  const applySustainRouting = useCallback((isDown: boolean) => {
    const current = audioConfigurationRef.current
    const next = isDown && current.sectionOn
      ? (['A', 'B'] as LayerId[]).filter((layer) => current.layers[layer].enabled && current.layers[layer].sustainPedal)
      : []
    const previous = sustainLayerRouting.current
    const released = previous.filter((layer) => !next.includes(layer))
    const added = next.filter((layer) => !previous.includes(layer))
    if (released.length > 0) lifecycle.setSustain(false, released)
    if (added.length > 0) lifecycle.setSustain(true, added)
    sustainLayerRouting.current = next
  }, [lifecycle])

  const startNote = useCallback((id: string, midi: number, velocity: number) => {
    sourceNotes.current.set(id, midi)
    setPressedMidi((current) => ({ ...current, [midi]: (current[midi] ?? 0) + 1 }))
    try {
      lifecycle.noteOn(id, midi, velocity, enabledLayers())
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The piano voice could not start.'
      setAudioState(/unavailable/i.test(message) ? 'fallback' : 'error')
      setAudioError(message)
    }
  }, [enabledLayers, lifecycle])

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
    applySustainRouting(down)
    setSustainDown(down)
  }, [applySustainRouting])

  const releaseAll = useCallback(() => {
    sourceNotes.current.clear()
    pointerNotes.current.clear()
    keybedNotes.current.clear()
    computerNotes.current.clear()
    midiNotes.current.clear()
    midiSourceIds.current.clear()
    midiSustainSources.current.clear()
    sustainSources.current.clear()
    sustainLayerRouting.current = []
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
    const cycle = CONTROL_CYCLES[control.id]
    const isDelayTap = control.id === 'effects-delay-tap'
    const momentary = control.id.endsWith('-octave-up') || control.id.endsWith('-octave-down') || isDelayTap
    const selectingLayerA = control.id === 'effects-focus-a' || control.id === 'piano-layer-a-focus'
    const selectingLayerB = control.id === 'effects-focus-b' || control.id === 'piano-layer-b-focus'
    const resyncEffectPanel = selectingLayerA || selectingLayerB || control.id === 'effects-focus-piano'
    let tappedDelayValue: number | undefined
    if (isDelayTap) {
      const now = Date.now()
      const previous = delayTapTime.current
      delayTapTime.current = now
      if (previous !== null) {
        const seconds = clamp((now - previous) / 1000, 0.08, 0.98)
        tappedDelayValue = Math.round(((seconds - 0.08) / 0.9) * 100)
      }
    }
    const typeSelection = control.id.startsWith('piano-type-')
      ? (['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'] as PianoType[]).find((type) => type.toLowerCase() === control.id.slice('piano-type-'.length))
      : undefined
    setHardware((current) => {
      const nextHardware = { ...current, [control.id]: cycle ? clamp(Math.round(next), 0, cycle.length - 1) : momentary ? 0 : clamp(next, control.min, control.max) }
      if (typeSelection) {
        for (const type of ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'] as const) nextHardware[`piano-type-${type.toLowerCase()}`] = type === typeSelection ? 1 : 0
      }
      if (tappedDelayValue !== undefined) nextHardware['effects-delay-time'] = tappedDelayValue
      if (control.id === 'performance-rotary-on' || control.id === 'effects-rotary-on') {
        nextHardware['performance-rotary-on'] = next > 0 ? 1 : 0
        nextHardware['effects-rotary-on'] = next > 0 ? 1 : 0
      }
      if (control.id === 'performance-rotary-fast') {
        nextHardware['performance-rotary-fast'] = next > 0 ? 1 : 0
        nextHardware['performance-rotary-stop'] = 0
        nextHardware['performance-rotary-speed'] = next > 0 ? 92 : 35
      } else if (control.id === 'performance-rotary-stop') {
        nextHardware['performance-rotary-stop'] = next > 0 ? 1 : 0
        nextHardware['performance-rotary-fast'] = 0
        nextHardware['performance-rotary-speed'] = next > 0 ? 0 : 35
      } else if (control.id === 'performance-rotary-speed') {
        nextHardware['performance-rotary-stop'] = 0
        nextHardware['performance-rotary-fast'] = next >= 60 ? 1 : 0
      }
      if (control.id === 'effects-focus-a' || control.id === 'effects-focus-b' || control.id === 'piano-layer-a-focus' || control.id === 'piano-layer-b-focus') {
        const selectingA = control.id.endsWith('-a') || control.id.endsWith('-a-focus')
        nextHardware['effects-focus-a'] = selectingA ? 1 : 0
        nextHardware['effects-focus-b'] = selectingA ? 0 : 1
        nextHardware['piano-layer-a-focus'] = selectingA ? 1 : 0
        nextHardware['piano-layer-b-focus'] = selectingA ? 0 : 1
        nextHardware['effects-focus-piano'] = 1
      }
      if (control.id === 'effects-focus-organ' || control.id === 'effects-focus-piano' || control.id === 'effects-focus-synth') {
        for (const section of ['organ', 'piano', 'synth']) nextHardware[`effects-focus-${section}`] = control.id.endsWith(section) ? 1 : 0
      }
      if (resyncEffectPanel) {
        const focus = selectingLayerA ? 'A' : selectingLayerB ? 'B' : audioConfigurationRef.current.effects.focus
        Object.assign(nextHardware, effectHardwareState(nextHardware, audioConfigurationRef.current, focus))
      }
      if (momentary) nextHardware[control.id] = 0
      return nextHardware
    })
    if (typeSelection && typeSelection !== 'Electric' && audioConfigurationRef.current.performance.timbre.startsWith('Dyno')) {
      setHardware((current) => ({ ...current, 'piano-timbre': 0 }))
    }
    const performanceAudioControl = ['performance-master-level', 'performance-pitch-stick', 'performance-rotary-on', 'performance-rotary-speed', 'performance-rotary-fast', 'performance-rotary-stop'].includes(control.id)
    if (!(control.section === 'piano' && control.id !== 'piano-model-selector') && control.section !== 'effects' && !performanceAudioControl) return
    setAudioConfiguration((current) => {
      const nextConfiguration: AudioConfiguration = {
        ...current,
        layers: { A: { ...current.layers.A }, B: { ...current.layers.B } },
        performance: { ...current.performance },
        effects: {
          ...current.effects,
          units: {
            A: Object.fromEntries(Object.entries(current.effects.units.A).map(([id, state]) => [id, { ...state }])) as AudioConfiguration['effects']['units']['A'],
            B: Object.fromEntries(Object.entries(current.effects.units.B).map(([id, state]) => [id, { ...state }])) as AudioConfiguration['effects']['units']['B'],
          },
        },
      }
      const focusedLayer = current.effects.focus
      const setLayer = (layer: LayerId, change: Partial<AudioConfiguration['layers'][LayerId]>) => {
        nextConfiguration.layers[layer] = { ...nextConfiguration.layers[layer], ...change }
      }
      const targetsFor = (unit: EffectUnitId): LayerId[] => {
        if (current.effects.manualSection !== 'Piano') return []
        return current.effects.group || current.effects.units[focusedLayer][unit].global ? ['A', 'B'] : [focusedLayer]
      }
      const setUnit = (unit: EffectUnitId, change: Partial<EffectUnitState>, targets = targetsFor(unit)) => {
        for (const layer of targets) nextConfiguration.effects.units[layer][unit] = { ...nextConfiguration.effects.units[layer][unit], ...change }
      }
      if (control.id === 'performance-master-level') nextConfiguration.masterLevel = clamp(next, 0, 100) / 100
      else if (control.id === 'performance-pitch-stick') nextConfiguration.pitchBend = ((clamp(next, 0, 100) - 50) / 50) * 2
      else if (control.id === 'piano-section-on') nextConfiguration.sectionOn = next > 0
      else if (control.id === 'piano-layer-a') setLayer('A', { enabled: next > 0 })
      else if (control.id === 'piano-layer-b') setLayer('B', { enabled: next > 0 })
      else if (control.id === 'piano-layer-a-level') setLayer('A', { level: clamp(next, 0, 100) / 100 })
      else if (control.id === 'piano-layer-b-level') setLayer('B', { level: clamp(next, 0, 100) / 100 })
      else if (control.id === 'piano-layer-a-octave-up') setLayer('A', { octave: clamp(current.layers.A.octave + 1, -1, 1) })
      else if (control.id === 'piano-layer-a-octave-down') setLayer('A', { octave: clamp(current.layers.A.octave - 1, -1, 1) })
      else if (control.id === 'piano-layer-b-octave-up') setLayer('B', { octave: clamp(current.layers.B.octave + 1, -1, 1) })
      else if (control.id === 'piano-layer-b-octave-down') setLayer('B', { octave: clamp(current.layers.B.octave - 1, -1, 1) })
      else if (control.id === 'piano-sustain-pedal') {
        setLayer('A', { sustainPedal: next > 0 })
        setLayer('B', { sustainPedal: next > 0 })
      } else if (control.id === 'piano-pitch-stick-enable') {
        setLayer('A', { pitchStick: next > 0 })
        setLayer('B', { pitchStick: next > 0 })
      } else if (typeSelection) {
        nextConfiguration.pianoType = typeSelection
        if (typeSelection !== 'Electric' && current.performance.timbre.startsWith('Dyno')) {
          nextConfiguration.performance.timbre = 'Off'
        }
      } else if (control.id === 'piano-kb-touch') nextConfiguration.performance.touch = (['Heavy', 'Medium', 'Light'] as const)[Math.round(next)] ?? 'Medium'
      else if (control.id === 'piano-dyn-comp') nextConfiguration.performance.dynComp = clamp(Math.round(next), 0, 3) as 0 | 1 | 2 | 3
      else if (control.id === 'piano-timbre') nextConfiguration.performance.timbre = (['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'] as const)[Math.round(next)] ?? 'Off'
      else if (control.id === 'piano-unison') nextConfiguration.performance.unison = clamp(Math.round(next), 0, 3) as 0 | 1 | 2 | 3
      else if (control.id === 'piano-soft-release') nextConfiguration.performance.softRelease = next > 0
      else if (control.id === 'piano-string-res') nextConfiguration.performance.stringRes = next > 0
      else if (control.id === 'effects-focus-a' || control.id === 'effects-focus-b' || control.id === 'piano-layer-a-focus' || control.id === 'piano-layer-b-focus') {
        nextConfiguration.effects.focus = control.id.endsWith('-a') || control.id.endsWith('-a-focus') ? 'A' : 'B'
        nextConfiguration.effects.manualSection = 'Piano'
      } else if (control.id === 'effects-focus-organ' || control.id === 'effects-focus-piano' || control.id === 'effects-focus-synth') {
        nextConfiguration.effects.manualSection = control.id.endsWith('organ') ? 'Organ' : control.id.endsWith('synth') ? 'Synth' : 'Piano'
      } else if (control.id === 'effects-piano-group') nextConfiguration.effects.group = next > 0
      else if (control.id === 'effects-effects-on') nextConfiguration.effects.allBypass = next === 0
      else if (control.id === 'performance-rotary-on' || control.id === 'effects-rotary-on') nextConfiguration.effects.rotaryOn = next > 0
      else if (control.id === 'performance-rotary-speed') {
        nextConfiguration.effects.rotaryRate = clamp(next, 0, 100) / 100
        nextConfiguration.effects.rotarySpeed = next >= 60 ? 'Fast' : 'Slow'
      } else if (control.id === 'performance-rotary-fast') {
        nextConfiguration.effects.rotaryRate = next > 0 ? 0.92 : 0.35
        nextConfiguration.effects.rotarySpeed = next > 0 ? 'Fast' : 'Slow'
      } else if (control.id === 'performance-rotary-stop') {
        nextConfiguration.effects.rotaryRate = next > 0 ? 0 : 0.35
        nextConfiguration.effects.rotarySpeed = next > 0 ? 'Stop' : 'Slow'
      }
      else if (control.id === 'effects-rotary-drive') nextConfiguration.effects.rotaryDrive = clamp(next, 0, 100) / 100
      else if (control.id === 'effects-effect-1-rate') setUnit('mod1', { rate: next / 100 })
      else if (control.id === 'effects-effect-1-depth') setUnit('mod1', { amount: next / 100 })
      else if (control.id === 'effects-effect-1-on') setUnit('mod1', { on: next > 0 })
      else if (control.id === 'effects-effect-1-type') setUnit('mod1', { type: EFFECT_TYPE_OPTIONS.mod1[Math.round(next)] ?? 'A-Pan' })
      else if (control.id === 'effects-effect-2-rate') setUnit('mod2', { rate: next / 100 })
      else if (control.id === 'effects-effect-2-depth') setUnit('mod2', { amount: next / 100 })
      else if (control.id === 'effects-effect-2-on') setUnit('mod2', { on: next > 0 })
      else if (control.id === 'effects-effect-2-type') setUnit('mod2', { type: EFFECT_TYPE_OPTIONS.mod2[Math.round(next)] ?? 'Chorus' })
      else if (control.id === 'effects-amp-mode') {
        const type = EFFECT_TYPE_OPTIONS.ampEq[Math.round(next)] ?? 'EQ only'
        setUnit('ampEq', { type, on: type === 'To Rotary' || current.effects.units[focusedLayer].ampEq.on })
      } else if (control.id === 'effects-amp-on') setUnit('ampEq', { on: next > 0 })
      else if (control.id === 'effects-amp-drive') setUnit('ampEq', { drive: next / 100 })
      else if (control.id === 'effects-eq-bass') setUnit('ampEq', { bass: next / 100 })
      else if (control.id === 'effects-eq-mid') setUnit('ampEq', { mid: next / 100 })
      else if (control.id === 'effects-eq-mid-frequency') setUnit('ampEq', { midFrequency: next / 100 })
      else if (control.id === 'effects-eq-treble') setUnit('ampEq', { treble: next / 100 })
      else if (control.id === 'effects-delay-time') setUnit('delay', { time: next / 100 })
      else if (control.id === 'effects-delay-tap' && tappedDelayValue !== undefined) setUnit('delay', { time: tappedDelayValue / 100 })
      else if (control.id === 'effects-delay-feedback') setUnit('delay', { feedback: next / 100 })
      else if (control.id === 'effects-delay-mix') setUnit('delay', { mix: next / 100 })
      else if (control.id === 'effects-delay-filter') setUnit('delay', { filter: (['Off', 'LP', 'HP', 'BP'] as const)[Math.round(next)] ?? 'Off' })
      else if (control.id === 'effects-delay-global') setUnit('delay', { global: next > 0 }, ['A', 'B'])
      else if (control.id === 'effects-delay-on') setUnit('delay', { on: next > 0 })
      else if (control.id === 'effects-compressor-amount') setUnit('compressor', { amount: next / 100 })
      else if (control.id === 'effects-compressor-fast') setUnit('compressor', { fast: next > 0 })
      else if (control.id === 'effects-compressor-global') setUnit('compressor', { global: next > 0 }, ['A', 'B'])
      else if (control.id === 'effects-compressor-on') setUnit('compressor', { on: next > 0 })
      else if (control.id === 'effects-reverb-depth') setUnit('reverb', { mix: next / 100 })
      else if (control.id === 'effects-reverb-time') setUnit('reverb', { decay: next / 100 })
      else if (control.id === 'effects-reverb-type') setUnit('reverb', { type: EFFECT_TYPE_OPTIONS.reverb[Math.round(next)] ?? 'Room' })
      else if (control.id === 'effects-reverb-brightness') setUnit('reverb', { brightness: next / 100 })
      else if (control.id === 'effects-reverb-global') setUnit('reverb', { global: next > 0 }, ['A', 'B'])
      else if (control.id === 'effects-reverb-on') setUnit('reverb', { on: next > 0 })
      return nextConfiguration
    })
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
    try {
      output.configure?.(audioConfiguration)
    } catch (error) {
      setAudioState('fallback')
      setAudioError(error instanceof Error ? error.message : 'Web Audio is unavailable; generated source fallback remains playable')
    }
  }, [audioConfiguration, output])

  useEffect(() => {
    let current = true
    setAudioError('')
    if (!output.prepare) {
      setAudioState('ready')
      return () => { current = false }
    }
    setAudioState('loading')
    void output.prepare(audioConfiguration.pianoType).then((result) => {
      if (!current) return
      setAudioState(result)
      if (result === 'fallback') setAudioError(`${audioConfiguration.pianoType} sample files could not load; generated synthesis remains playable`)
    }).catch((error: unknown) => {
      if (!current) return
      setAudioState('fallback')
      setAudioError(error instanceof Error ? error.message : 'Sample files could not load; generated synthesis remains playable')
    })
    return () => { current = false }
  }, [audioConfiguration.pianoType, output])

  useEffect(() => {
    applySustainRouting(sustainSources.current.size > 0)
  }, [audioConfiguration, applySustainRouting])

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
    ? output.prepare
      ? ['Grand', 'Upright', 'Electric'].includes(audioConfiguration.pianoType)
        ? `Ready · bundled ${audioConfiguration.pianoType} recordings`
        : `Ready · generated ${audioConfiguration.pianoType} synthesis`
      : 'Ready · injected test audio output'
    : audioState === 'loading'
      ? `Loading ${audioConfiguration.pianoType} sound…`
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
          {SECTIONS.map((section) => <InstrumentSection key={section.id} section={section} hardware={hardware} audioConfiguration={audioConfiguration} onControlChange={changeControl} />)}
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
      <div className="unsupported-note">Organ, Synth, and Program controls are presentation-only in Phase 2.</div>
    </main>
  )
}
