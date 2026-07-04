import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { COMPUTER_KEY_TO_MIDI, GeneratedPianoEngine, WebAudioPianoAdapter } from './pianoEngine'
import { HARDWARE_CONTROLS, HardwareControl, SECTIONS, SECTION_LABELS, VARIANT, generateKeybed } from './hardware'

type ControlState = Record<string, number>
type MidiState = 'not-requested' | 'unsupported' | 'connected' | 'denied' | 'disconnected'

interface MidiInputLike {
  onmidimessage: ((event: { data: Uint8Array | number[] | null }) => void) | null
}

interface MidiAccessLike {
  inputs: {
    size: number
    values(): IterableIterator<MidiInputLike>
  }
  onstatechange: ((event: { port?: { state?: string } }) => void) | null
}

interface MidiNavigatorLike {
  requestMIDIAccess?: () => Promise<MidiAccessLike>
}

const initialControlState = HARDWARE_CONTROLS.reduce<ControlState>((state, control) => {
  state[control.id] = control.type === 'drawbar' ? 0.72 : 0
  return state
}, {})

function clamp(value: number) {
  return Math.max(0, Math.min(1, value))
}

function controlStep(control: HardwareControl, current: number, direction = 1) {
  if (control.type === 'button') return current > 0 ? 0 : 1
  if (control.type === 'stick') return direction > 0 ? 0.78 : 0.22
  return clamp(current + direction * 0.12)
}

export default function App() {
  const keybed = useMemo(() => generateKeybed(), [])
  const [controlState, setControlState] = useState<ControlState>(initialControlState)
  const [pressedKeys, setPressedKeys] = useState<Set<number>>(() => new Set())
  const [sustainOn, setSustainOn] = useState(false)
  const [voiceCount, setVoiceCount] = useState(0)
  const [midiState, setMidiState] = useState<MidiState>('not-requested')
  const engineRef = useRef<GeneratedPianoEngine | null>(null)
  const activePointerSources = useRef(new Map<number, { midi: number; source: string }>())
  const activeKeyboardSources = useRef(new Map<string, { midi: number; source: string }>())

  if (!engineRef.current) {
    const adapter = typeof window !== 'undefined' && 'AudioContext' in window ? new WebAudioPianoAdapter() : undefined
    engineRef.current = new GeneratedPianoEngine(adapter)
  }

  const syncSnapshot = useCallback(() => {
    const snapshot = engineRef.current?.snapshot()
    setVoiceCount(snapshot?.voices.filter((voice) => voice.state !== 'released').length ?? 0)
    setSustainOn(snapshot?.sustain ?? false)
  }, [])

  const noteOn = useCallback((midi: number, velocity: number, source: string) => {
    engineRef.current?.noteOn(midi, velocity, source)
    setPressedKeys((current) => new Set(current).add(midi))
    syncSnapshot()
  }, [syncSnapshot])

  const noteOff = useCallback((midi: number, source: string) => {
    engineRef.current?.noteOff(midi, source)
    setPressedKeys((current) => {
      const next = new Set(current)
      next.delete(midi)
      return next
    })
    syncSnapshot()
  }, [syncSnapshot])

  const allNotesOff = useCallback(() => {
    engineRef.current?.allNotesOff()
    activePointerSources.current.clear()
    activeKeyboardSources.current.clear()
    setPressedKeys(new Set())
    syncSnapshot()
  }, [syncSnapshot])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (event.repeat) return
      if (event.key === ' ') {
        event.preventDefault()
        engineRef.current?.setSustain(true)
        syncSnapshot()
        return
      }
      const midi = COMPUTER_KEY_TO_MIDI.get(key)
      if (!midi || activeKeyboardSources.current.has(key)) return
      const source = `computer-${key}`
      activeKeyboardSources.current.set(key, { midi, source })
      noteOn(midi, 0.78, source)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (event.key === ' ') {
        engineRef.current?.setSustain(false)
        syncSnapshot()
        return
      }
      const active = activeKeyboardSources.current.get(key)
      if (!active) return
      activeKeyboardSources.current.delete(key)
      noteOff(active.midi, active.source)
    }
    const onBlur = () => allNotesOff()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      allNotesOff()
    }
  }, [allNotesOff, noteOff, noteOn, syncSnapshot])

  const requestMidi = useCallback(async () => {
    const nav = navigator as unknown as MidiNavigatorLike
    if (!nav.requestMIDIAccess) {
      setMidiState('unsupported')
      return
    }
    try {
      const access = await nav.requestMIDIAccess()
      const handleMidi = (event: { data: Uint8Array | number[] | null }) => {
        if (!event.data) return
        const [status, note, value] = Array.from(event.data)
        const command = status & 0xf0
        if (command === 0x90 && value > 0) noteOn(note, value / 127, `midi-${note}`)
        if (command === 0x80 || (command === 0x90 && value === 0)) noteOff(note, `midi-${note}`)
        if (command === 0xb0 && note === 64) {
          engineRef.current?.setSustain(value >= 64)
          syncSnapshot()
        }
      }
      for (const input of access.inputs.values()) input.onmidimessage = handleMidi
      access.onstatechange = (event) => {
        setMidiState(event.port?.state === 'disconnected' ? 'disconnected' : 'connected')
        if (event.port?.state === 'disconnected') allNotesOff()
      }
      setMidiState(access.inputs.size > 0 ? 'connected' : 'disconnected')
    } catch {
      setMidiState('denied')
      allNotesOff()
    }
  }, [allNotesOff, noteOff, noteOn, syncSnapshot])

  const updateControl = useCallback((control: HardwareControl, direction = 1) => {
    setControlState((current) => ({ ...current, [control.id]: controlStep(control, current[control.id] ?? 0, direction) }))
  }, [])

  return (
    <main className="stage-page">
      <section
        className="instrument"
        aria-label={`${VARIANT.name}, phase 1 surface with generated basic piano voice`}
        data-variant={VARIANT.id}
      >
        <div className="top-rail" aria-hidden="true" />
        <div className="deck" style={{ gridTemplateColumns: SECTIONS.map((section) => `${section.fraction}fr`).join(' ') }}>
          {SECTIONS.map((section) => (
            <section className={`panel panel-${section.id}`} aria-label={section.label} key={section.id}>
              <PanelChrome sectionId={section.id} />
              {HARDWARE_CONTROLS.filter((control) => control.section === section.id).map((control) => (
                <DecorativeControl
                  control={control}
                  key={control.id}
                  value={controlState[control.id] ?? 0}
                  onMove={updateControl}
                />
              ))}
            </section>
          ))}
        </div>
        <div className="front-lip" aria-hidden="true" />
        <div className="keybed" aria-label={`${VARIANT.totalKeys} key hammer action keybed, ${VARIANT.range}`}>
          {keybed.filter((key) => key.color === 'white').map((key) => (
            <button
              aria-label={`${key.note} piano key`}
              className={`piano-key white-key ${pressedKeys.has(key.midi) ? 'is-pressed' : ''}`}
              data-midi={key.midi}
              data-note={key.note}
              key={key.id}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture?.(event.pointerId)
                const source = `pointer-${event.pointerId}-${key.midi}`
                activePointerSources.current.set(event.pointerId, { midi: key.midi, source })
                noteOn(key.midi, event.pressure > 0 ? event.pressure : 0.74, source)
              }}
              onPointerUp={(event) => {
                const active = activePointerSources.current.get(event.pointerId)
                if (!active) return
                activePointerSources.current.delete(event.pointerId)
                noteOff(active.midi, active.source)
              }}
              onPointerCancel={(event) => {
                const active = activePointerSources.current.get(event.pointerId)
                if (!active) return
                activePointerSources.current.delete(event.pointerId)
                noteOff(active.midi, active.source)
              }}
              style={{ left: `${key.x * 100}%`, width: `${key.width * 100}%` }}
              type="button"
            />
          ))}
          {keybed.filter((key) => key.color === 'black').map((key) => (
            <button
              aria-label={`${key.note} black piano key`}
              className={`piano-key black-key ${pressedKeys.has(key.midi) ? 'is-pressed' : ''}`}
              data-midi={key.midi}
              data-note={key.note}
              key={key.id}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture?.(event.pointerId)
                const source = `pointer-${event.pointerId}-${key.midi}`
                activePointerSources.current.set(event.pointerId, { midi: key.midi, source })
                noteOn(key.midi, event.pressure > 0 ? event.pressure : 0.82, source)
              }}
              onPointerUp={(event) => {
                const active = activePointerSources.current.get(event.pointerId)
                if (!active) return
                activePointerSources.current.delete(event.pointerId)
                noteOff(active.midi, active.source)
              }}
              onPointerCancel={(event) => {
                const active = activePointerSources.current.get(event.pointerId)
                if (!active) return
                activePointerSources.current.delete(event.pointerId)
                noteOff(active.midi, active.source)
              }}
              style={{ left: `${key.x * 100}%`, width: `${key.width * 100}%` }}
              type="button"
            />
          ))}
        </div>
        <div className="bottom-rail" aria-hidden="true" />
      </section>
      <aside className="status-strip" aria-label="Phase 1 status">
        <span>Basic piano: ready generated synthesis</span>
        <span>Voices {voiceCount}</span>
        <span>Sustain {sustainOn ? 'on' : 'off'}</span>
        <span>MIDI {midiState.replace('-', ' ')}</span>
        <button type="button" onClick={requestMidi}>Enable MIDI</button>
      </aside>
    </main>
  )
}

function PanelChrome({ sectionId }: { sectionId: string }) {
  if (sectionId === 'performance') {
    return (
      <>
        <div className="brand">nord stage 4</div>
        <div className="edition">hammer action 73</div>
      </>
    )
  }
  if (sectionId === 'program' || sectionId === 'synth') {
    return <div className="oled" aria-hidden="true">{sectionId === 'program' ? 'A:11 Nord Stage 4' : 'OSC CTRL SOFT'}</div>
  }
  return <div className="section-title">{SECTION_LABELS[sectionId as keyof typeof SECTION_LABELS]}</div>
}

function DecorativeControl({ control, value, onMove }: { control: HardwareControl; value: number; onMove: (control: HardwareControl, direction?: number) => void }) {
  const style = { left: `${control.x}%`, top: `${control.y}%` }
  const capStyle = {
    '--value': value,
    '--angle': `${value * 270 - 45}deg`,
    '--offset': `${value * 76}%`,
    '--wheel-offset': `${(1 - value) * 62}%`,
  } as CSSProperties
  const common = {
    'aria-label': `${control.label} decorative ${control.type}`,
    'data-control-id': control.id,
    'data-section': control.section,
    style,
    onPointerDown: () => onMove(control),
    onKeyDown: (event: ReactKeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onMove(control)
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
        event.preventDefault()
        onMove(control, 1)
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
        event.preventDefault()
        onMove(control, -1)
      }
    },
  }

  if (control.type === 'button') {
    return (
      <button
        {...common}
        aria-pressed={value > 0}
        className={`decor-control decor-button ${value > 0 ? 'is-on' : ''}`}
        title={`${control.label} is decorative in phase 1`}
        type="button"
      >
        <span>{control.label}</span>
      </button>
    )
  }

  return (
    <div
      {...common}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(value * 100)}
      className={`decor-control decor-${control.type}`}
      role="slider"
      tabIndex={0}
      title={`${control.label} moves visually only in phase 1`}
    >
      <span className="control-cap" style={capStyle} />
      <span className="control-label">{control.label}</span>
    </div>
  )
}
