import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HardwareControlView, type ControlBinding } from './components/Controls'
import { Keyboard } from './components/Keyboard'
import { HARDWARE_SECTIONS, type HardwareControl } from './model/hardware'
import { ComputerKeyboardInput } from './piano/InputController'
import { MidiInput, type MidiAccessLike, type MidiConnectionState } from './piano/MidiInput'
import { PianoEngine, type PianoSnapshot } from './piano/PianoEngine'
import { createBrowserPianoBackend } from './piano/WebAudioBackend'
import './styles.css'

const PIANO_TYPES = ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'] as const
const PIANO_MODELS: Record<(typeof PIANO_TYPES)[number], string[]> = {
  Grand: ['Royal Grand 3D', 'White Grand', 'Grand Imperial'],
  Upright: ['Pearl Upright', 'Amber Upright', 'Studio Grand 2'],
  Electric: ['Nefertiti Mk I', 'Bright Tines', 'Wurlitzer 2'],
  Clav: ['Clavinet D6', 'Harpsichord', 'Clav Model A'],
  Digital: ['Digital Grand', 'Layer Piano', 'DX Crystal'],
  Misc: ['Marimba', 'Vibraphone', 'Celeste'],
}

function groupControls(controls: HardwareControl[]) {
  const groups = new Map<string, HardwareControl[]>()
  for (const control of controls) {
    const group = groups.get(control.group) ?? []
    group.push(control)
    groups.set(control.group, group)
  }
  return [...groups.entries()]
}

function PanelSection({ section, getBinding }: { section: (typeof HARDWARE_SECTIONS)[number]; getBinding: (control: HardwareControl) => ControlBinding }) {
  const groups = useMemo(() => groupControls(section.controls), [section.controls])
  return (
    <section
      className={`panel-section section-${section.id}`}
      data-section={section.id}
      aria-label={`${section.label} section`}
    >
      <div className="section-title"><span>{section.label}</span><i aria-hidden="true" /></div>
      <div className="section-groups">
        {groups.map(([name, controls]) => (
          <div className={`section-group group-${name}`} data-group={name.replaceAll('-', ' ')} key={name}>
            {controls.map((control) => <HardwareControlView control={control} binding={getBinding(control)} key={control.id} />)}
          </div>
        ))}
      </div>
      {section.id === 'performance' && (
        <div className="brand-lockup" aria-label="Nord Stage 4 Hammer Action 73">
          <span className="brand-nord">nord</span><span className="brand-stage">stage 4</span>
          <small>HAMMER ACTION 73</small>
        </div>
      )}
    </section>
  )
}

export default function App() {
  const [engine] = useState(() => new PianoEngine(createBrowserPianoBackend()))
  const [snapshot, setSnapshot] = useState<PianoSnapshot>(() => engine.snapshot())
  const [midiState, setMidiState] = useState<MidiConnectionState>('idle')
  const [pianoType, setPianoType] = useState<(typeof PIANO_TYPES)[number]>('Grand')
  const [modelValue, setModelValue] = useState(44)
  const [timbre, setTimbre] = useState('Mid')
  const [dynamicCompression, setDynamicCompression] = useState(28)
  const [masterLevel, setMasterLevel] = useState(67)
  const [pianoLevel, setPianoLevel] = useState(76)
  const [reverbMix, setReverbMix] = useState(31)
  const [reverbOn, setReverbOn] = useState(true)
  const [pianoOn, setPianoOn] = useState(true)
  const midiRef = useRef<MidiInput | null>(null)

  const selectedModel = PIANO_MODELS[pianoType][Math.min(PIANO_MODELS[pianoType].length - 1, Math.floor(modelValue / 34))]

  useEffect(() => {
    const unsubscribe = engine.subscribe(setSnapshot)
    void engine.prepare()
    return () => {
      unsubscribe()
      engine.allNotesOff()
      midiRef.current?.disconnect()
    }
  }, [engine])

  useEffect(() => {
    engine.setMasterVolume(pianoOn ? (masterLevel / 100) * (pianoLevel / 100) : 0)
  }, [engine, masterLevel, pianoLevel, pianoOn])

  useEffect(() => {
    engine.setReverb(reverbOn ? reverbMix / 100 : 0)
  }, [engine, reverbMix, reverbOn])

  useEffect(() => {
    const input = new ComputerKeyboardInput({ noteOn: (midi, velocity) => engine.noteOn(midi, velocity), noteOff: (midi) => engine.noteOff(midi) })
    const keyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target
      const editingControl = target instanceof HTMLElement && (target.matches('button, input, [role="slider"]') || target.isContentEditable)
      if (event.code === 'Space' && !editingControl) {
        if (!event.repeat) engine.setSustain(true)
        event.preventDefault()
        return
      }
      if (!editingControl && input.keyDown(event.key, event.repeat)) event.preventDefault()
    }
    const keyUp = (event: globalThis.KeyboardEvent) => {
      if (event.code === 'Space') engine.setSustain(false)
      if (input.keyUp(event.key)) event.preventDefault()
    }
    const blur = () => {
      input.releaseAll()
      engine.allNotesOff()
    }
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('blur', blur)
      input.releaseAll()
    }
  }, [engine])

  const getBinding = useCallback((control: HardwareControl): ControlBinding => {
    const typeButton = PIANO_TYPES.find((type) => control.id === `piano-type-${type.toLowerCase()}`)
    if (typeButton) return { active: pianoType === typeButton, onActiveChange: () => setPianoType(typeButton) }
    const timbreName = ['Soft', 'Mid', 'Bright'].find((name) => control.id === `piano-timbre-${name.toLowerCase()}`)
    if (timbreName) return { active: timbre === timbreName, onActiveChange: () => setTimbre(timbreName) }
    switch (control.id) {
      case 'piano-display': return { displayLines: [pianoType.toUpperCase(), selectedModel, `${timbre} · Dyn ${Math.round(dynamicCompression / 25)}`] }
      case 'program-display': return { displayLines: [`${snapshot.voiceCount.toString().padStart(2, '0')} VOICES`, selectedModel, snapshot.sustain ? 'SUSTAIN PEDAL' : snapshot.mode.toUpperCase()] }
      case 'effects-display': return { displayLines: ['FX FOCUS', 'PIANO A', reverbOn ? `REVERB ${reverbMix}%` : 'REVERB OFF'] }
      case 'perf-master-level': return { value: masterLevel, onValueChange: setMasterLevel }
      case 'piano-level-a': return { value: pianoLevel, onValueChange: setPianoLevel }
      case 'piano-model': return { value: modelValue, onValueChange: setModelValue }
      case 'piano-dynamic-compression': return { value: dynamicCompression, onValueChange: setDynamicCompression }
      case 'perf-piano-enable': return { active: pianoOn, onActiveChange: setPianoOn }
      case 'effects-reverb-mix': return { value: reverbMix, onValueChange: setReverbMix }
      case 'effects-reverb-on': return { active: reverbOn, onActiveChange: setReverbOn }
      default: return {}
    }
  }, [dynamicCompression, masterLevel, modelValue, pianoLevel, pianoOn, pianoType, reverbMix, reverbOn, selectedModel, snapshot.mode, snapshot.sustain, snapshot.voiceCount, timbre])

  const connectMidi = async () => {
    if (midiRef.current) midiRef.current.disconnect()
    const navigatorWithMidi = navigator as Navigator & { requestMIDIAccess?: () => Promise<MidiAccessLike> }
    const request: (() => Promise<MidiAccessLike>) | null = navigatorWithMidi.requestMIDIAccess
      ? async () => navigatorWithMidi.requestMIDIAccess!() as unknown as MidiAccessLike
      : null
    midiRef.current = new MidiInput(request, {
      noteOn: (midi, velocity) => engine.noteOn(midi, velocity),
      noteOff: (midi) => engine.noteOff(midi),
      sustain: (down) => engine.setSustain(down),
    }, setMidiState)
    await midiRef.current.connect()
  }

  return (
    <main className="product-study">
      <div className="instrument-shadow" aria-hidden="true" />
      <div
        className="instrument"
        data-chassis
        role="region"
        aria-label="Nord Stage 4 73 hardware"
      >
        <div className="top-rail" aria-hidden="true">
          <span>PROGRAM</span><span>OUTPUTS</span><span>MIDI</span><span>USB</span><span>MONITOR IN</span><span>POWER</span>
        </div>
        <div className="control-deck" data-testid="control-deck">
          <div
            className="section-strip"
            style={{ gridTemplateColumns: HARDWARE_SECTIONS.map((section) => `${section.fraction}fr`).join(' ') }}
          >
            {HARDWARE_SECTIONS.map((section) => <PanelSection section={section} getBinding={getBinding} key={section.id} />)}
          </div>
        </div>
        <div className="keybed" data-testid="keybed">
          <div className="left-cheek" aria-hidden="true" />
          <Keyboard activeNotes={new Set([...snapshot.activeNotes, ...snapshot.sustainedNotes])} onNoteOn={(midi, velocity) => engine.noteOn(midi, velocity)} onNoteOff={(midi) => engine.noteOff(midi)} />
          <div className="right-cheek" aria-hidden="true" />
        </div>
        <div className="bottom-rail" aria-hidden="true" />
      </div>
      <div className="performance-status" role="status" aria-live="polite">
        <span className="status-light" data-active={snapshot.voiceCount > 0} aria-hidden="true" />
        <span>{selectedModel} · {snapshot.voiceCount} {snapshot.voiceCount === 1 ? 'voice' : 'voices'} · {snapshot.mode === 'loading' ? 'preparing samples' : snapshot.mode === 'sampled' ? 'sample piano ready' : 'offline piano ready'}</span>
        <button type="button" className="status-action" onClick={() => engine.setSustain(!snapshot.sustain)} aria-pressed={snapshot.sustain}>Sustain {snapshot.sustain ? 'on' : 'off'}</button>
        <button type="button" className="status-action" onClick={() => void connectMidi()}>MIDI: {midiState}</button>
        <button type="button" className="status-action" onClick={() => engine.allNotesOff()}>Panic</button>
      </div>
      <p className="key-hint">Play with pointer or keys A–' · hold Space for sustain</p>
    </main>
  )
}
