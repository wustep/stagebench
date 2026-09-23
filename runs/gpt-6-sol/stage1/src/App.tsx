import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { hardwareControls, initialHardwareState, pianoKeys, sections } from './hardware'
import type { Control, SectionId } from './hardware'
import { PianoEngine, routeMidiMessage, WebPianoBackend } from './piano'
import type { AudioStatus, VoiceBackend } from './piano'

const computerKeys = 'awsedftgyhujkolp;'.split('')
const computerNotes = new Map(computerKeys.map((key, index) => [key, 48 + index]))
export interface AppProps { backend?: VoiceBackend; requestMidi?: () => Promise<MIDIAccess> }

function HardwareInput({ control, value, update }: { control: Control; value: number; update: (id: string, value: number) => void }) {
  const style = { left: `${control.x}%`, top: `${control.y}%`, width: `${control.w}%`, height: `${control.h}%` }
  return <div className={`hardware-control ${control.kind} ${control.accent ? 'accent' : ''}`} style={style} data-control-id={control.id}>
    {control.kind === 'button'
      ? <button type="button" aria-label={control.name} aria-pressed={value > 0} onClick={() => update(control.id, value ? 0 : 100)}><span className="button-led" /><span className="button-face" /></button>
      : <>
          {control.kind === 'knob' || control.kind === 'encoder'
            ? <span className="knob-face" style={{ transform: `rotate(${(value / 100) * 270 - 135}deg)` }} />
            : <span className="slider-track"><span className="slider-leds" /><span className="slider-cap" style={{ bottom: `${Math.max(0, Math.min(83, value * .83))}%` }} /></span>}
          <input type="range" min="0" max="100" step="1" value={value} aria-label={control.name} aria-valuetext={`${value} percent, decorative`} onChange={event => update(control.id, Number(event.target.value))} />
        </>}
    <span className="control-label" aria-hidden="true">{control.name.replace(/^Organ |^Piano |^Synth |^Effect [12] |^Program /, '')}</span>
  </div>
}

function Section({ id, label, width, state, update }: { id: SectionId; label: string; width: number; state: Record<string, number>; update: (id: string, value: number) => void }) {
  return <section className={`deck-section section-${id}`} style={{ width: `${width}%` }} aria-label={`${label} controls`} data-section={id}>
    {id !== 'performance' && <div className="inset-panel" />}
    <div className="section-heading" aria-hidden="true">{label.toUpperCase()}</div>
    {id === 'performance' && <div className="brand" aria-hidden="true"><span>nord</span> stage 4<small>HAMMER ACTION</small></div>}
    {id === 'organ' && <div className="organ-legends" aria-hidden="true">B3&nbsp; VOX&nbsp; FARF&nbsp; PIPE <span>DRAWBARS</span></div>}
    {id === 'program' && <div className="oled program-oled" role="img" aria-label="Program display: basic piano voice; panel functions inactive"><strong>BASIC PIANO</strong><span>Panel functions inactive</span><small>73 KEY HAMMER ACTION</small></div>}
    {id === 'synth' && <div className="oled synth-oled" role="img" aria-label="Synth display: inactive"><strong>SYNTH</strong><span>INACTIVE</span></div>}
    {id === 'effects' && <div className="effects-divider" aria-hidden="true" />}
    {hardwareControls.filter(control => control.section === id).map(control => <HardwareInput key={control.id} control={control} value={state[control.id]} update={update} />)}
  </section>
}

export default function App({ backend, requestMidi }: AppProps) {
  const [hardware, setHardware] = useState(initialHardwareState)
  const [audioStatus, setAudioStatus] = useState<AudioStatus>('idle')
  const [midiStatus, setMidiStatus] = useState('Checking MIDI')
  const [activeNotes, setActiveNotes] = useState<number[]>([])
  const [sustain, setSustain] = useState(false)
  const audioRef = useRef<WebPianoBackend | null>(null)
  const engineRef = useRef<PianoEngine | null>(null)
  if (!engineRef.current) {
    const sound = backend ?? new WebPianoBackend(setAudioStatus)
    if (!backend) audioRef.current = sound as WebPianoBackend
    engineRef.current = new PianoEngine(sound)
  }
  const engine = engineRef.current
  const pointerNotes = useRef(new Map<number, number>())
  const heldComputer = useRef(new Set<string>())
  const heldFocus = useRef(new Set<number>())
  const refresh = () => { setActiveNotes(engine.activeNotes); setSustain(engine.sustainDown) }
  const update = (id: string, value: number) => setHardware(previous => ({ ...previous, [id]: value }))

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.closest('input:not([type="range"]), select, textarea'))) return
      if (event.code === 'Space') {
        if (event.target instanceof HTMLElement && event.target.closest('button')) return
        event.preventDefault()
        if (!event.repeat) { engine.setSustain('keyboard:sustain', true); setSustain(true) }
        return
      }
      const key = event.key.toLowerCase()
      const note = computerNotes.get(key)
      if (note === undefined || event.repeat || heldComputer.current.has(key)) return
      event.preventDefault()
      heldComputer.current.add(key)
      engine.noteOn(`keyboard:${key}`, note, 95)
      setActiveNotes(engine.activeNotes)
    }
    const keyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') { engine.setSustain('keyboard:sustain', false); refresh(); return }
      const key = event.key.toLowerCase()
      const note = computerNotes.get(key)
      if (note === undefined || !heldComputer.current.has(key)) return
      heldComputer.current.delete(key)
      engine.noteOff(`keyboard:${key}`, note)
      refresh()
    }
    const blur = () => {
      heldComputer.current.clear()
      pointerNotes.current.clear()
      heldFocus.current.clear()
      engine.allNotesOff()
      refresh()
    }
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('blur', blur)
      engine.allNotesOff()
      void audioRef.current?.close()
    }
  }, [engine])

  useEffect(() => {
    let cancelled = false
    let access: MIDIAccess | undefined
    const attached = new Map<MIDIInput, (event: MIDIMessageEvent) => void>()
    const syncInputs = () => {
      if (!access || cancelled) return
      for (const [input, listener] of attached) {
        if (input.state !== 'connected' || !access.inputs.has(input.id)) {
          input.removeEventListener('midimessage', listener)
          attached.delete(input)
          engine.disconnectSource(`midi:${input.id}`)
        }
      }
      for (const input of access.inputs.values()) {
        if (input.state !== 'connected' || attached.has(input)) continue
        const listener = (event: MIDIMessageEvent) => {
          if (event.data) routeMidiMessage(engine, `midi:${input.id}`, { data: event.data })
          refresh()
        }
        input.addEventListener('midimessage', listener)
        attached.set(input, listener)
      }
      refresh()
      setMidiStatus(attached.size ? `${attached.size} MIDI input${attached.size === 1 ? '' : 's'} connected` : 'MIDI disconnected')
    }
    const factory = requestMidi ?? (navigator.requestMIDIAccess ? () => navigator.requestMIDIAccess() : undefined)
    if (!factory) setMidiStatus('MIDI unavailable')
    else void factory().then(result => {
      if (cancelled) return
      access = result
      access.addEventListener('statechange', syncInputs)
      syncInputs()
    }).catch(() => { if (!cancelled) setMidiStatus('MIDI denied or unavailable') })
    return () => {
      cancelled = true
      access?.removeEventListener('statechange', syncInputs)
      for (const [input, listener] of attached) {
        input.removeEventListener('midimessage', listener)
        engine.disconnectSource(`midi:${input.id}`)
      }
    }
  }, [engine, requestMidi])

  const pointerDown = (event: ReactPointerEvent<HTMLButtonElement>, note: number) => {
    if (pointerNotes.current.has(event.pointerId)) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerNotes.current.set(event.pointerId, note)
    engine.noteOn(`pointer:${event.pointerId}`, note, 105)
    refresh()
  }
  const pointerEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const note = pointerNotes.current.get(event.pointerId)
    if (note === undefined) return
    pointerNotes.current.delete(event.pointerId)
    engine.noteOff(`pointer:${event.pointerId}`, note)
    refresh()
  }
  const focusedKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, note: number) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    if (event.repeat || heldFocus.current.has(note)) return
    heldFocus.current.add(note)
    engine.noteOn(`focus:${note}`, note, 95)
    refresh()
  }
  const focusedKeyUp = (event: ReactKeyboardEvent<HTMLButtonElement>, note: number) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    heldFocus.current.delete(note)
    engine.noteOff(`focus:${note}`, note)
    refresh()
  }

  return <main className="page">
    <div className="instrument-scroll">
      <div className="instrument" aria-label="Nord Stage 4 73 keyboard">
        <div className="top-rail" />
        <div className="control-deck">{sections.map(section => <Section key={section.id} {...section} state={hardware} update={update} />)}</div>
        <div className="keybed" aria-label="73 key E1 to E7 piano keybed">
          <div className="back-rail" />
          {pianoKeys.map(key => <button key={key.midi} type="button" className={`piano-key ${key.isBlack ? 'black' : 'white'} ${activeNotes.includes(key.midi) ? 'pressed' : ''}`}
            style={{ left: `${((key.whiteIndex + (key.isBlack ? .68 : 0)) / 43) * 100}%` }}
            aria-label={`${key.name} piano key`} aria-pressed={activeNotes.includes(key.midi)} data-midi={key.midi}
            onPointerDown={event => pointerDown(event, key.midi)} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd}
            onKeyDown={event => focusedKeyDown(event, key.midi)} onKeyUp={event => focusedKeyUp(event, key.midi)} />)}
        </div>
        <div className="bottom-rail" />
      </div>
    </div>
    <div className="status-strip" role="status">
      <span><b>STAGE 4 73</b> · Synthesized basic piano</span>
      <span>{audioStatus === 'idle' ? 'Audio not started · play a key to enable' : audioStatus === 'loading' ? 'Starting audio…' : audioStatus === 'ready' ? 'Audio ready' : 'Audio error · keys remain visual'}</span>
      <span>{midiStatus}</span>
      <span>Space: sustain {sustain ? '●' : '○'} · Keys A–;: play</span>
      <span className="decorative-hint">Panel controls are decorative in Phase 1</span>
    </div>
  </main>
}
