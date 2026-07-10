import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type ControlKind = 'knob' | 'button' | 'fader' | 'drawbar' | 'wheel'
type HardwareState = Record<string, number | boolean>

const START_NOTE = 28 // E1
const KEY_COUNT = 73
const MAX_VOICES = 16
const keyboardNotes: Record<string, number> = {
  z: 48, s: 49, x: 50, d: 51, c: 52, v: 53, g: 54, b: 55, h: 56, n: 57,
  j: 58, m: 59, ',': 60, l: 61, '.': 62, ';': 63, '/': 64,
}
const blackPitchClasses = new Set([1, 3, 6, 8, 10])

function noteName(midi: number) {
  return `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][midi % 12]}${Math.floor(midi / 12) - 1}`
}

interface Voice { note: number; started: number; release: () => void }

class PianoAudio {
  private context: AudioContext | null = null
  private gain: GainNode | null = null
  private voices = new Map<number, Voice[]>()
  private sustained = new Set<number>()
  private sustain = false
  private counter = 0

  private ensure() {
    if (this.context) return
    const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtor) return
    this.context = new AudioCtor()
    this.gain = this.context.createGain()
    this.gain.gain.value = 0.16
    this.gain.connect(this.context.destination)
  }

  noteOn(note: number, velocity = 0.78) {
    this.ensure()
    if (!this.context || !this.gain) return
    void this.context.resume()
    const all = [...this.voices.values()].flat()
    if (all.length >= MAX_VOICES) all.sort((a, b) => a.started - b.started)[0]?.release()
    const now = this.context.currentTime
    const envelope = this.context.createGain()
    const fundamental = this.context.createOscillator()
    const overtone = this.context.createOscillator()
    const frequency = 440 * 2 ** ((note - 69) / 12)
    fundamental.type = 'triangle'; fundamental.frequency.value = frequency
    overtone.type = 'sine'; overtone.frequency.value = frequency * 2.01
    envelope.gain.setValueAtTime(0.0001, now)
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.025, velocity) * 0.46, now + 0.012)
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.012, velocity) * 0.2, now + 0.35)
    fundamental.connect(envelope); overtone.connect(envelope); envelope.connect(this.gain)
    fundamental.start(now); overtone.start(now)
    let ended = false
    const release = () => {
      if (ended) return
      ended = true
      const at = this.context!.currentTime
      envelope.gain.cancelScheduledValues(at)
      envelope.gain.setTargetAtTime(0.0001, at, 0.13)
      fundamental.stop(at + 0.7); overtone.stop(at + 0.7)
      const instances = this.voices.get(note) ?? []
      this.voices.set(note, instances.filter((voice) => voice.release !== release))
    }
    const voice = { note, started: ++this.counter, release }
    this.voices.set(note, [...(this.voices.get(note) ?? []), voice])
  }

  noteOff(note: number) {
    if (this.sustain) { this.sustained.add(note); return }
    ;(this.voices.get(note) ?? []).forEach((voice) => voice.release())
  }

  setSustain(down: boolean) {
    this.sustain = down
    if (!down) { [...this.sustained].forEach((note) => { this.sustained.delete(note); this.noteOff(note) }) }
  }

  allNotesOff() {
    this.sustained.clear(); this.sustain = false
    ;[...this.voices.values()].flat().forEach((voice) => voice.release())
    this.voices.clear()
  }

  dispose() { this.allNotesOff(); void this.context?.close(); this.context = null }
}

const control = (id: string, label: string, kind: ControlKind, value = kind === 'button' ? false : 50) => ({ id, label, kind, value })
const sections = [
  { id: 'performance', title: 'PERFORMANCE', controls: [control('master-level', 'Master Level', 'knob', 68), control('pitch-stick', 'Pitch Stick', 'wheel', 50), control('mod-wheel', 'Modulation Wheel', 'wheel', 50), control('performance-octave-down', 'Octave Down', 'button'), control('performance-octave-up', 'Octave Up', 'button')] },
  { id: 'organ', title: 'ORGAN', controls: [...Array.from({ length: 9 }, (_, i) => control(`organ-drawbar-${i + 1}`, `Organ drawbar ${i + 1}`, 'drawbar', 28 + (i % 4) * 14)), control('organ-layer-a', 'Organ Layer A', 'button'), control('organ-layer-b', 'Organ Layer B', 'button'), control('organ-model', 'Organ Model', 'button'), control('organ-percussion', 'Organ Percussion', 'button'), control('organ-rotary', 'Organ Rotary', 'knob', 42)] },
  { id: 'piano', title: 'PIANO', controls: [control('piano-layer-a', 'Piano Layer A', 'button'), control('piano-layer-b', 'Piano Layer B', 'button'), control('piano-level-a', 'Piano Layer A Level', 'fader', 62), control('piano-level-b', 'Piano Layer B Level', 'fader', 48), control('piano-type', 'Piano Type', 'button'), control('piano-model', 'Piano Model', 'knob', 45), control('piano-timbre', 'Piano Timbre', 'button'), control('piano-kb-touch', 'Piano Keyboard Touch', 'button'), control('piano-sustain-pedal', 'Piano Sustain Pedal Routing', 'button')] },
  { id: 'program', title: 'PROGRAM', controls: [control('program-dial', 'Program Dial', 'knob', 36), ...Array.from({ length: 8 }, (_, i) => control(`program-button-${i + 1}`, `Program button ${i + 1}`, 'button')), control('program-page-up', 'Program Page Up', 'button'), control('program-page-down', 'Program Page Down', 'button'), control('program-live', 'Live Mode', 'button'), control('program-store', 'Store', 'button'), control('program-split', 'Split', 'button'), control('morph-wheel', 'Wheel Morph Assign', 'button'), control('morph-pedal', 'Control Pedal Morph Assign', 'button'), control('morph-aftertouch', 'Aftertouch Morph Assign', 'button')] },
  { id: 'synth', title: 'SYNTH', controls: [control('synth-layer-a', 'Synth Layer A', 'button'), control('synth-layer-b', 'Synth Layer B', 'button'), control('synth-layer-c', 'Synth Layer C', 'button'), control('synth-level-a', 'Synth Layer A Level', 'fader', 57), control('synth-level-b', 'Synth Layer B Level', 'fader', 47), ...['Oscillator Shape', 'Oscillator Control', 'Filter Frequency', 'Filter Resonance', 'Filter Drive', 'Amp Attack', 'Amp Decay', 'Amp Release', 'LFO Rate', 'LFO Amount', 'Arpeggiator Rate'].map((label, i) => control(`synth-${i}`, label, 'knob', 30 + i * 5)), control('synth-filter-type', 'Synth Filter Type', 'button'), control('synth-arp', 'Synth Arpeggiator', 'button')] },
  { id: 'effects', title: 'LAYER EFFECTS', controls: [control('effects-focus-a', 'Effects Focus A', 'button'), control('effects-focus-b', 'Effects Focus B', 'button'), ...['Modulation One', 'Modulation Two', 'Amp Simulator', 'Equalizer', 'Delay', 'Compressor', 'Reverb', 'Rotary'].map((label, i) => control(`effects-${i}`, label, 'knob', 35 + i * 4)), ...['Mod 1 On', 'Mod 2 On', 'Delay On', 'Compressor On', 'Reverb On', 'To Rotary'].map((label, i) => control(`effects-button-${i}`, label, 'button'))] },
]

function PanelControl({ item, value, update }: { item: ReturnType<typeof control>; value: number | boolean; update: (value: number | boolean) => void }) {
  if (item.kind === 'button') return <button id={item.id} className={`hardware-button ${value ? 'lit' : ''}`} aria-pressed={Boolean(value)} onClick={() => update(!value)}><i />{item.label}</button>
  if (item.kind === 'drawbar' || item.kind === 'fader') return <label className={`${item.kind} control-label`} htmlFor={item.id}><span>{item.kind === 'drawbar' ? '' : item.label}</span><input id={item.id} aria-label={item.label} type="range" min="0" max="100" value={Number(value)} onChange={(event) => update(Number(event.target.value))} /></label>
  if (item.kind === 'wheel') return <label className="wheel control-label" htmlFor={item.id}><span>{item.label}</span><input id={item.id} aria-label={item.label} type="range" min="0" max="100" value={Number(value)} onChange={(event) => update(Number(event.target.value))} /></label>
  return <label className="knob control-label" htmlFor={item.id} title={item.label}><span className="knob-face" style={{ '--turn': `${Number(value) * 2.7 - 135}deg` } as React.CSSProperties} /><input id={item.id} aria-label={item.label} type="range" min="0" max="100" value={Number(value)} onChange={(event) => update(Number(event.target.value))} /><small>{item.label}</small></label>
}

export default function App() {
  const [hardware, setHardware] = useState<HardwareState>(() => Object.fromEntries(sections.flatMap((section) => section.controls.map((item) => [item.id, item.value]))))
  const [pressed, setPressed] = useState<Set<number>>(new Set())
  const [status, setStatus] = useState('Ready · synthesized piano')
  const [sustain, setSustain] = useState(false)
  const audio = useRef<PianoAudio | null>(null)
  const activePointers = useRef(new Map<number, number>())
  const pressedKeyboard = useRef(new Set<string>())
  const notes = useMemo(() => Array.from({ length: KEY_COUNT }, (_, index) => START_NOTE + index), [])
  const update = useCallback((id: string, value: number | boolean) => setHardware((previous) => ({ ...previous, [id]: value })), [])
  const getAudio = useCallback(() => (audio.current ??= new PianoAudio()), [])
  const play = useCallback((note: number, velocity = 0.78) => { if (note < START_NOTE || note >= START_NOTE + KEY_COUNT) return; setPressed((old) => new Set(old).add(note)); getAudio().noteOn(note, velocity) }, [getAudio])
  const release = useCallback((note: number) => { setPressed((old) => { const next = new Set(old); next.delete(note); return next }); audio.current?.noteOff(note) }, [])
  const setPedal = useCallback((down: boolean) => { setSustain(down); getAudio().setSustain(down) }, [getAudio])

  useEffect(() => {
    const stop = () => { pressedKeyboard.current.clear(); activePointers.current.clear(); setPressed(new Set()); audio.current?.allNotesOff(); setSustain(false) }
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space') { event.preventDefault(); if (!event.repeat) setPedal(true); return }
      const note = keyboardNotes[event.key.toLowerCase()]
      if (note === undefined || event.repeat || pressedKeyboard.current.has(event.code)) return
      event.preventDefault(); pressedKeyboard.current.add(event.code); play(note, 0.74)
    }
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') { setPedal(false); return }
      const note = keyboardNotes[event.key.toLowerCase()]
      if (note !== undefined) { pressedKeyboard.current.delete(event.code); release(note) }
    }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', stop)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', stop); stop(); audio.current?.dispose() }
  }, [play, release, setPedal])

  useEffect(() => {
    const midi = navigator.requestMIDIAccess
    if (!midi) { setStatus('Ready · synthesized piano · MIDI unavailable'); return }
    let access: MIDIAccess | undefined
    const onMessage = (event: MIDIMessageEvent) => {
      if (!event.data) return
      const [command, note, rawVelocity] = event.data
      if ((command & 0xf0) === 0x90 && rawVelocity > 0) play(note, rawVelocity / 127)
      else if ((command & 0xf0) === 0x80 || ((command & 0xf0) === 0x90 && rawVelocity === 0)) release(note)
      else if ((command & 0xf0) === 0xb0 && note === 64) setPedal(rawVelocity >= 64)
    }
    void midi.call(navigator).then((result) => { access = result; result.inputs.forEach((input) => { input.onmidimessage = onMessage }); result.onstatechange = () => { if ([...result.inputs.values()].some((input) => input.state === 'connected')) setStatus('Ready · synthesized piano · MIDI connected'); else { setStatus('Ready · synthesized piano · MIDI disconnected'); audio.current?.allNotesOff() } }; setStatus('Ready · synthesized piano · MIDI enabled') }).catch(() => setStatus('Ready · synthesized piano · MIDI permission denied'))
    return () => { if (access) { access.inputs.forEach((input) => { input.onmidimessage = null }); access.onstatechange = null } }
  }, [play, release, setPedal])

  return <main className="product-study">
    <div className="instrument-shell" aria-label="Nord Stage 4 73 virtual instrument">
      <div className="top-rail" />
      <section className="deck" aria-label="Nord Stage 4 control deck">
        {sections.map((section) => <section className={`panel panel-${section.id}`} key={section.id} aria-label={section.title}>
          {section.id === 'performance' && <><div className="brand"><strong>nord stage 4</strong><span>HAMMER ACTION 73</span></div><div className="status-dot">{status}</div></>}
          <h2>{section.title}</h2>
          {section.id === 'program' && <div className="oled program-oled" role="status"><b>A:11</b><span>Nord Stage 4</span><small>Panel controls decorative</small></div>}
          {section.id === 'synth' && <div className="oled synth-oled" role="status"><b>OSC SHAPE</b><span>Analog · Saw</span></div>}
          {section.id === 'organ' && <div className="led-ladders" aria-label="Organ level LED ladders">{Array.from({ length: 9 }, (_, i) => <span key={i}>{Array.from({ length: 6 }, (_, led) => <i className={led < 3 + (i % 3) ? 'on' : ''} key={led} />)}</span>)}</div>}
          <div className={`control-bank ${section.id}`}>{section.controls.map((item) => <PanelControl key={item.id} item={item} value={hardware[item.id]} update={(value) => update(item.id, value)} />)}</div>
        </section>)}
      </section>
      <section className="keybed" aria-label="73 key E to E hammer action keyboard">
        <div className="sustain-bar"><button id="sustain-pedal" className={sustain ? 'lit' : ''} aria-pressed={sustain} onPointerDown={() => setPedal(true)} onPointerUp={() => setPedal(false)} onPointerCancel={() => setPedal(false)} onKeyDown={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); setPedal(!sustain) } }}>SUSTAIN · SPACE</button><span>Computer keys: Z–M</span></div>
        <div className="keys" role="group" aria-label="Playable piano keys">
          {notes.filter((note) => !blackPitchClasses.has(note % 12)).map((note) => <button key={note} id={`key-${note}`} className={`key white ${pressed.has(note) ? 'pressed' : ''}`} aria-label={`${noteName(note)} piano key`} aria-pressed={pressed.has(note)} onPointerDown={(event) => { event.currentTarget.setPointerCapture?.(event.pointerId); activePointers.current.set(event.pointerId, note); const offset = event.nativeEvent.offsetY; play(note, Number.isFinite(offset) ? Math.max(0.2, 1 - offset / Math.max(1, event.currentTarget.clientHeight)) : 0.78) }} onPointerUp={(event) => { release(activePointers.current.get(event.pointerId) ?? note); activePointers.current.delete(event.pointerId) }} onPointerCancel={(event) => { release(activePointers.current.get(event.pointerId) ?? note); activePointers.current.delete(event.pointerId) }} onKeyDown={(event) => { if (!event.repeat && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); play(note) } }} onKeyUp={(event) => { if (event.key === ' ' || event.key === 'Enter') release(note) }}>{noteName(note)}</button>)}
          {notes.filter((note) => blackPitchClasses.has(note % 12)).map((note) => { const whiteBefore = notes.filter((candidate) => candidate < note && !blackPitchClasses.has(candidate % 12)).length; return <button key={note} id={`key-${note}`} className={`key black ${pressed.has(note) ? 'pressed' : ''}`} style={{ left: `calc(${whiteBefore} * (100% / 43) - 1.14%)` }} aria-label={`${noteName(note)} piano key`} aria-pressed={pressed.has(note)} onPointerDown={(event) => { event.currentTarget.setPointerCapture?.(event.pointerId); activePointers.current.set(event.pointerId, note); play(note, 0.82) }} onPointerUp={(event) => { release(activePointers.current.get(event.pointerId) ?? note); activePointers.current.delete(event.pointerId) }} onPointerCancel={(event) => { release(activePointers.current.get(event.pointerId) ?? note); activePointers.current.delete(event.pointerId) }} onKeyDown={(event) => { if (!event.repeat && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); play(note) } }} onKeyUp={(event) => { if (event.key === ' ' || event.key === 'Enter') release(note) }} /> })}
        </div>
      </section>
    </div>
  </main>
}
