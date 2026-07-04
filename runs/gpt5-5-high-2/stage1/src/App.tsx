import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  computerKeyMap,
  createControlState,
  decorativeControls,
  getMidiNote,
  isBlackKey,
  keyboard,
  sections,
  whiteKeyCount,
  type Control,
  type ControlState,
  type KeyModel,
} from './hardware'
import { createPianoEngine, type PianoEngine, type PianoStatus } from './pianoEngine'
import './styles.css'

type PointerMap = Map<number, string>

const pressedClass = (active: boolean) => (active ? ' is-active' : '')

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

function nextControlValue(control: Control, current: number) {
  if (control.kind === 'button') return current > 0 ? 0 : 1
  if (control.kind === 'knob' || control.kind === 'wheel') return current >= 0.95 ? 0 : clamp(current + 0.12)
  if (control.kind === 'encoder') return (current + 0.14) % 1
  return current >= 0.95 ? 0 : clamp(current + 0.14)
}

function controlValueText(control: Control, value: number) {
  if (control.kind === 'button') return value > 0 ? 'on' : 'off'
  return `${Math.round(value * 100)} percent`
}

function ControlView({
  control,
  value,
  onChange,
}: {
  control: Control
  value: number
  onChange: (id: string, value: number) => void
}) {
  const style = { '--value': String(value) } as React.CSSProperties

  const activate = useCallback(() => {
    onChange(control.id, nextControlValue(control, value))
  }, [control, onChange, value])

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activate()
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault()
      onChange(control.id, clamp(value + 0.08))
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault()
      onChange(control.id, clamp(value - 0.08))
    }
    if (event.key === 'Home') {
      event.preventDefault()
      onChange(control.id, 0)
    }
    if (event.key === 'End') {
      event.preventDefault()
      onChange(control.id, 1)
    }
  }

  return (
    <button
      type="button"
      className={`control control-${control.kind}${pressedClass(value > 0.5)}`}
      style={style}
      data-control-id={control.id}
      data-section={control.section}
      aria-label={`${control.label} decorative control`}
      aria-pressed={control.kind === 'button' ? value > 0 : undefined}
      aria-valuenow={control.kind === 'button' ? undefined : Math.round(value * 100)}
      aria-valuemin={control.kind === 'button' ? undefined : 0}
      aria-valuemax={control.kind === 'button' ? undefined : 100}
      aria-valuetext={controlValueText(control, value)}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId)
        activate()
      }}
      onKeyDown={onKeyDown}
    >
      <span className="control-face" aria-hidden="true">
        {control.kind === 'fader' || control.kind === 'drawbar' ? <span className="cap" /> : null}
      </span>
      <span className="control-label">{control.label}</span>
    </button>
  )
}

function LedLadder({ count = 8, value = 0.65 }: { count?: number; value?: number }) {
  return (
    <span className="led-ladder" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className={index / count < value ? 'on' : ''} />
      ))}
    </span>
  )
}

function SectionView({
  section,
  controls,
  state,
  onChange,
}: {
  section: (typeof sections)[number]
  controls: Control[]
  state: ControlState
  onChange: (id: string, value: number) => void
}) {
  const drawbars = controls.filter((control) => control.kind === 'drawbar')
  const otherControls = controls.filter((control) => control.kind !== 'drawbar')
  return (
    <section
      className={`section section-${section.id}`}
      style={{ '--section-width': `${section.fraction * 100}%` } as React.CSSProperties}
      aria-label={section.label}
      data-section-id={section.id}
    >
      <div className="section-title">{section.label}</div>
      {section.id === 'performance' ? (
        <div className="brand-block" aria-hidden="true">
          <strong>nord stage 4</strong>
          <span>hammer action 73</span>
        </div>
      ) : null}
      {section.hasOled ? (
        <div className="oled" aria-label={`${section.label} primary OLED`}>
          {section.id === 'program' ? (
            <>
              <span>A:11</span>
              <strong>Nord Stage 4</strong>
              <span>Phase 1 Piano</span>
            </>
          ) : (
            <>
              <span>OSC SAMPLE</span>
              <strong>Decorative</strong>
              <span>No synth audio</span>
            </>
          )}
        </div>
      ) : null}
      {drawbars.length > 0 ? (
        <div className="drawbar-bank" aria-label="Nine decorative organ drawbars">
          {drawbars.map((control, index) => (
            <div className="drawbar-slot" key={control.id}>
              <LedLadder value={(9 - index) / 10} />
              <ControlView control={control} value={state[control.id] ?? 0} onChange={onChange} />
            </div>
          ))}
        </div>
      ) : null}
      <div className={`control-grid grid-${section.id}`}>
        {otherControls.map((control) => (
          <ControlView key={control.id} control={control} value={state[control.id] ?? 0} onChange={onChange} />
        ))}
      </div>
    </section>
  )
}

function KeyView({
  keyModel,
  active,
  onNoteStart,
  onNoteEnd,
  registerPointer,
}: {
  keyModel: KeyModel
  active: boolean
  onNoteStart: (keyId: string, velocity: number) => void
  onNoteEnd: (keyId: string) => void
  registerPointer: (pointerId: number, keyId: string | null) => void
}) {
  const whiteIndex = keyModel.whiteIndex ?? 0
  const style = keyModel.black
    ? ({ '--white-index': String(whiteIndex), '--black-left': `${(whiteIndex / whiteKeyCount) * 100}%` } as React.CSSProperties)
    : ({ '--white-index': String(whiteIndex) } as React.CSSProperties)

  return (
    <button
      type="button"
      className={`piano-key ${keyModel.black ? 'black' : 'white'}${pressedClass(active)}`}
      style={style}
      data-key-id={keyModel.id}
      data-midi={keyModel.midi}
      aria-label={`${keyModel.note} piano key`}
      aria-pressed={active}
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture?.(event.pointerId)
        registerPointer(event.pointerId, keyModel.id)
        const rect = event.currentTarget.getBoundingClientRect()
        const y = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5
        onNoteStart(keyModel.id, clamp(0.45 + y * 0.5, 0.2, 1))
      }}
      onPointerUp={(event) => {
        event.preventDefault()
        registerPointer(event.pointerId, null)
        onNoteEnd(keyModel.id)
      }}
      onPointerCancel={(event) => {
        registerPointer(event.pointerId, null)
        onNoteEnd(keyModel.id)
      }}
      onLostPointerCapture={(event) => {
        registerPointer(event.pointerId, null)
        onNoteEnd(keyModel.id)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onNoteStart(keyModel.id, 0.8)
        }
      }}
      onKeyUp={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onNoteEnd(keyModel.id)
        }
      }}
    />
  )
}

export default function App() {
  const engineRef = useRef<PianoEngine | null>(null)
  const pointers = useRef<PointerMap>(new Map())
  const heldComputerKeys = useRef<Map<string, string>>(new Map())
  const [controlState, setControlState] = useState<ControlState>(() => createControlState())
  const [activeKeys, setActiveKeys] = useState<Set<string>>(() => new Set())
  const [status, setStatus] = useState<PianoStatus>({ state: 'loading', message: 'Preparing generated piano voice' })
  const [midiStatus, setMidiStatus] = useState('MIDI not requested')
  const controlBySection = useMemo(
    () =>
      sections.map((section) => ({
        section,
        controls: decorativeControls.filter((control) => control.section === section.id),
      })),
    [],
  )

  useEffect(() => {
    const engine = createPianoEngine({
      onStatus: setStatus,
      maxVoices: 18,
    })
    engineRef.current = engine
    engine.prepare()
    return () => {
      engine.allNotesOff()
      engine.dispose()
      engineRef.current = null
    }
  }, [])

  const setKeyActive = useCallback((keyId: string, active: boolean) => {
    setActiveKeys((current) => {
      const next = new Set(current)
      if (active) next.add(keyId)
      else next.delete(keyId)
      return next
    })
  }, [])

  const startKey = useCallback(
    (keyId: string, velocity = 0.76) => {
      const key = keyboard.find((entry) => entry.id === keyId)
      if (!key) return
      setKeyActive(keyId, true)
      engineRef.current?.noteOn(key.midi, velocity, keyId)
    },
    [setKeyActive],
  )

  const endKey = useCallback(
    (keyId: string) => {
      const key = keyboard.find((entry) => entry.id === keyId)
      if (!key) return
      setKeyActive(keyId, false)
      engineRef.current?.noteOff(key.midi, keyId)
    },
    [setKeyActive],
  )

  const cleanupAll = useCallback(() => {
    pointers.current.clear()
    heldComputerKeys.current.clear()
    setActiveKeys(new Set())
    engineRef.current?.allNotesOff()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return
      if (event.key === 'Tab' || event.metaKey || event.ctrlKey || event.altKey) return
      const mapped = computerKeyMap[event.key.toLowerCase()]
      if (!mapped) return
      event.preventDefault()
      if (mapped === 'sustain') {
        engineRef.current?.setSustain(true)
        setStatus((current) => ({ ...current, message: 'Generated piano ready - sustain held from keyboard' }))
        return
      }
      if (heldComputerKeys.current.has(event.key)) return
      heldComputerKeys.current.set(event.key, mapped)
      startKey(mapped, 0.82)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      const mapped = computerKeyMap[event.key.toLowerCase()]
      if (!mapped) return
      event.preventDefault()
      if (mapped === 'sustain') {
        engineRef.current?.setSustain(false)
        setStatus((current) => ({ ...current, message: 'Generated piano ready' }))
        return
      }
      const keyId = heldComputerKeys.current.get(event.key)
      if (!keyId) return
      heldComputerKeys.current.delete(event.key)
      endKey(keyId)
    }
    const onBlur = () => cleanupAll()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [cleanupAll, endKey, startKey])

  useEffect(() => {
    let access: MIDIAccess | null = null
    const onMidiMessage = (event: MIDIMessageEvent) => {
      const [statusByte = 0, note = 0, value = 0] = Array.from(event.data ?? [])
      const command = statusByte & 0xf0
      if (command === 0x90 && value > 0) {
        const key = keyboard.find((entry) => entry.midi === note)
        if (key) {
          setKeyActive(key.id, true)
          engineRef.current?.noteOn(note, value / 127, `midi-${note}`)
        }
      } else if (command === 0x80 || (command === 0x90 && value === 0)) {
        const key = keyboard.find((entry) => entry.midi === note)
        if (key) setKeyActive(key.id, false)
        engineRef.current?.noteOff(note, `midi-${note}`)
      } else if (command === 0xb0 && note === 64) {
        engineRef.current?.setSustain(value >= 64)
      }
    }
    const attachInputs = () => {
      if (!access) return
      const inputs = Array.from(access.inputs.values())
      for (const input of inputs) input.onmidimessage = onMidiMessage
      setMidiStatus(inputs.length > 0 ? `${inputs.length} MIDI input${inputs.length === 1 ? '' : 's'} connected` : 'MIDI ready - no inputs connected')
    }
    if (!('requestMIDIAccess' in navigator)) {
      setMidiStatus('Web MIDI unavailable in this browser')
      return
    }
    navigator
      .requestMIDIAccess({ sysex: false })
      .then((midiAccess) => {
        access = midiAccess
        access.onstatechange = () => {
          cleanupAll()
          attachInputs()
        }
        attachInputs()
      })
      .catch(() => setMidiStatus('MIDI permission denied or unavailable'))
    return () => {
      if (access) {
        for (const input of access.inputs.values()) input.onmidimessage = null
        access.onstatechange = null
      }
      cleanupAll()
    }
  }, [cleanupAll, setKeyActive])

  const changeControl = useCallback((id: string, value: number) => {
    setControlState((current) => ({ ...current, [id]: clamp(value) }))
  }, [])

  const registerPointer = useCallback(
    (pointerId: number, keyId: string | null) => {
      const previous = pointers.current.get(pointerId)
      if (previous && previous !== keyId) endKey(previous)
      if (keyId) pointers.current.set(pointerId, keyId)
      else pointers.current.delete(pointerId)
    },
    [endKey],
  )

  return (
    <main className="stage-page">
      <div className="instrument-shell" aria-label="Nord Stage 4 73 Phase 1 recreation">
        <div className="top-rail" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="control-deck">
          {controlBySection.map(({ section, controls }) => (
            <SectionView key={section.id} section={section} controls={controls} state={controlState} onChange={changeControl} />
          ))}
        </div>
        <div className="keybed" aria-label="73 key E to E hammer action keybed">
          <div className="white-key-row">
            {keyboard
              .filter((key) => !key.black)
              .map((key) => (
                <KeyView
                  key={key.id}
                  keyModel={key}
                  active={activeKeys.has(key.id)}
                  onNoteStart={startKey}
                  onNoteEnd={endKey}
                  registerPointer={registerPointer}
                />
              ))}
          </div>
          <div className="black-key-row" aria-hidden="false">
            {keyboard
              .filter((key) => key.black)
              .map((key) => (
                <KeyView
                  key={key.id}
                  keyModel={key}
                  active={activeKeys.has(key.id)}
                  onNoteStart={startKey}
                  onNoteEnd={endKey}
                  registerPointer={registerPointer}
                />
              ))}
          </div>
        </div>
        <div className="bottom-rail" aria-hidden="true" />
      </div>
      <aside className="status-strip" aria-live="polite">
        <span data-testid="piano-status">{status.message}</span>
        <span>{status.state === 'ready' ? 'Audio: generated synthesis' : `Audio: ${status.state}`}</span>
        <span>{midiStatus}</span>
        <span>Panel controls decorative in Phase 1</span>
      </aside>
      <dl className="sr-only">
        <dt>Variant</dt>
        <dd>Nord Stage 4 73, hammer action, E to E, 73 total keys, 43 white keys, 30 black keys.</dd>
        <dt>Decorative contract</dt>
        <dd>Panel controls update presentation state only. The keybed and sustain input are the only functional audio controls.</dd>
        <dt>Black key pattern</dt>
        <dd>{keyboard.filter(isBlackKey).map((key) => key.note).join(', ')}</dd>
        <dt>Middle C MIDI note</dt>
        <dd>{getMidiNote('C4')}</dd>
      </dl>
    </main>
  )
}
