import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { hardwareControls, initialHardwareState, pianoKeys, sections } from './hardware'
import type { Control, SectionId } from './hardware'
import type { VoiceBackend } from './piano'
import { StageAudio, StagePianoEngine, cycle, initialStageState, pianoTypes, routeStageMidi, timbres, unitTypes } from './stage'
import type { LayerId, StageAudioStatus, StageState, UnitId, UnitState } from './stage'

const computerKeys = 'awsedftgyhujkolp;'.split('')
const computerNotes = new Map(computerKeys.map((key, index) => [key, 48 + index]))
export interface AppProps { backend?: VoiceBackend; requestMidi?: () => Promise<MIDIAccess> }

function HardwareInput({ control, value, update, detail }: { control: Control; value: number; update: (id: string, value: number, shifted?: boolean) => void; detail?: string }) {
  const style = { left: `${control.x}%`, top: `${control.y}%`, width: `${control.w}%`, height: `${control.h}%` }
  return <div className={`hardware-control ${control.kind} ${control.accent ? 'accent' : ''}`} style={style} data-control-id={control.id}>
    {control.kind === 'button'
      ? <button type="button" aria-label={control.name} aria-pressed={value > 0} title={detail} onClick={event => update(control.id, value ? 0 : 100, event.shiftKey)}><span className="button-led" /><span className="button-face" /></button>
      : <>
          {control.kind === 'knob' || control.kind === 'encoder'
            ? <span className="knob-face" style={{ transform: `rotate(${(value / 100) * 270 - 135}deg)` }} />
            : <span className="slider-track"><span className="slider-leds" /><span className="slider-cap" style={{ bottom: `${Math.max(0, Math.min(83, value * .83))}%` }} /></span>}
          <input type="range" min="0" max="100" step="1" value={value} aria-label={control.name} aria-valuetext={`${value} percent${control.section === 'organ' || control.section === 'synth' || control.section === 'program' ? ', decorative' : ''}`} onChange={event => update(control.id, Number(event.target.value))} />
        </>}
    <span className="control-label" aria-hidden="true">{control.name.replace(/^Organ |^Piano |^Synth |^Effect [12] |^Program /, '')}</span>
  </div>
}

function Section({ id, label, width, state, update, stage, audioStatus }: { id: SectionId; label: string; width: number; state: Record<string, number>; update: (id: string, value: number, shifted?: boolean) => void; stage: StageState; audioStatus: StageAudioStatus }) {
  return <section className={`deck-section section-${id}`} style={{ width: `${width}%` }} aria-label={`${label} controls`} data-section={id}>
    {id !== 'performance' && <div className="inset-panel" />}
    <div className="section-heading" aria-hidden="true">{label.toUpperCase()}</div>
    {id === 'performance' && <div className="brand" aria-hidden="true"><span>nord</span> stage 4<small>HAMMER ACTION</small></div>}
    {id === 'organ' && <div className="organ-legends" aria-hidden="true">B3&nbsp; VOX&nbsp; FARF&nbsp; PIPE <span>DRAWBARS</span></div>}
    {id === 'program' && <div className="oled program-oled" role="img" aria-label={`Program display: ${stage.layers[stage.focus].type} piano, ${audioStatus}`}><strong>{stage.layers[stage.focus].type.toUpperCase()}</strong><span>{audioStatus === 'fallback' ? 'SAMPLE ERROR · FALLBACK' : `PIANO ${stage.focus} · ${audioStatus.toUpperCase()}`}</span><small>73 KEY HAMMER ACTION</small></div>}
    {id === 'synth' && <div className="oled synth-oled" role="img" aria-label="Synth display: inactive"><strong>SYNTH</strong><span>INACTIVE</span></div>}
    {id === 'effects' && <div className="effects-divider" aria-hidden="true" />}
    {hardwareControls.filter(control => control.section === id).map(control => <HardwareInput key={control.id} control={control} value={state[control.id]} update={update} detail={id === 'piano' ? `${stage.layers[stage.focus].type} · Piano ${stage.focus}` : id === 'effects' ? `Piano ${stage.fxFocus}` : undefined} />)}
  </section>
}

export default function App({ backend, requestMidi }: AppProps) {
  const [hardware, setHardware] = useState(initialHardwareState)
  const [stage, setStage] = useState(initialStageState)
  const stageRef = useRef(stage)
  const [audioStatus, setAudioStatus] = useState<StageAudioStatus>('idle')
  const [midiStatus, setMidiStatus] = useState('Checking MIDI')
  const [activeNotes, setActiveNotes] = useState<number[]>([])
  const [sustain, setSustain] = useState(false)
  const audioRef = useRef<StageAudio | null>(null)
  const engineRef = useRef<StagePianoEngine | null>(null)
  if (!engineRef.current) {
    const sound = backend ?? new StageAudio(() => stageRef.current, setAudioStatus)
    if (!backend) audioRef.current = sound as StageAudio
    engineRef.current = new StagePianoEngine((layer, note, velocity) => backend ? backend.start(note, velocity) : (sound as StageAudio).startLayer(layer, note, velocity), () => stageRef.current)
  }
  const engine = engineRef.current
  const pointerNotes = useRef(new Map<number, number>())
  const heldComputer = useRef(new Set<string>())
  const heldFocus = useRef(new Set<number>())
  const lastTap = useRef<number | null>(null)
  const refresh = () => { setActiveNotes(engine.activeNotes); setSustain(engine.sustainDown) }
  const commitStage = (next: StageState) => { stageRef.current = next; setStage(next); audioRef.current?.applyState() }
  const editLayer = (layer: LayerId, change: Partial<StageState['layers']['A']>) => {
    const next = { ...stageRef.current, layers: { ...stageRef.current.layers, [layer]: { ...stageRef.current.layers[layer], ...change } } }
    commitStage(next)
    if (change.enabled === false) engine.stopLayer(layer)
    if (change.sustped === false) engine.releaseUnrouted(layer)
  }
  const editUnit = (unit: UnitId, change: Partial<UnitState>) => {
    const current = stageRef.current
    if (current.fxSection !== 'Piano') return
    const targets: LayerId[] = current.group || current.layers[current.fxFocus].units[unit].global || change.global === true ? ['A', 'B'] : [current.fxFocus]
    const layers = { ...current.layers }
    for (const id of targets) layers[id] = { ...layers[id], units: { ...layers[id].units, [unit]: { ...layers[id].units[unit], ...change } } }
    commitStage({ ...current, layers })
  }
  const update = (id: string, value: number, shifted = false) => {
    setHardware(previous => ({ ...previous, [id]: value }))
    const s = stageRef.current, focus = s.focus, fx = s.fxFocus
    if (id === 'performance.master-level') commitStage({ ...s, master: value / 100 })
    else if (id === 'performance.pitch-stick') commitStage({ ...s, pitch: value / 100 })
    else if (id === 'performance.rotary-speed') commitStage({ ...s, rotarySpeed: value / 100 })
    else if (id === 'performance.rotary-drive') commitStage({ ...s, rotaryDrive: value / 100 })
    else if (id === 'performance.rotary-on') commitStage({ ...s, rotaryOn: !s.rotaryOn })
    else if (id === 'performance.rotary-fast') commitStage({ ...s, rotaryFast: true })
    else if (id === 'performance.rotary-slow-stop') commitStage({ ...s, rotaryFast: false })
    else if (id === 'piano.piano-on') { commitStage({ ...s, pianoOn: !s.pianoOn }); if (s.pianoOn) engine.allNotesOff() }
    else if (id === 'piano.piano-layer-a' || id === 'piano.piano-layer-b') { const selected = id.endsWith('-a') ? 'A' : 'B'; commitStage({ ...s, focus: selected, fxFocus: selected }) }
    else if (id === 'piano.piano-level-a' || id === 'piano.piano-level-b') editLayer(id.endsWith('-a') ? 'A' : 'B', { level: value / 100 })
    else if (id === 'piano.piano-type') editLayer(focus, { type: cycle(pianoTypes, s.layers[focus].type), timbre: 'Off' })
    else if (id === 'piano.kb-touch') editLayer(focus, { kbTouch: cycle(['Heavy', 'Medium', 'Light'] as const, s.layers[focus].kbTouch) })
    else if (id === 'piano.timbre') editLayer(focus, { timbre: cycle(timbres(s.layers[focus].type), s.layers[focus].timbre) })
    else if (id === 'piano.string-res') editLayer(focus, { stringRes: !s.layers[focus].stringRes })
    else if (id === 'piano.soft-release') editLayer(focus, { softRelease: !s.layers[focus].softRelease })
    else if (id === 'piano.sustain-pedal') { engine.setSustain('ui:pedal', value > 0); setSustain(engine.sustainDown) }
    else if (id === 'effects.layer-focus-piano') commitStage({ ...s, fxSection: 'Piano', fxFocus: s.focus })
    else if (id === 'effects.layer-focus-organ') commitStage({ ...s, fxSection: 'Organ' })
    else if (id === 'effects.layer-focus-synth') commitStage({ ...s, fxSection: 'Synth' })
    else if (id.startsWith('effects.')) {
      const onUnit: Record<string, UnitId> = { 'effect-1-on': 'mod1', 'effect-2-on': 'mod2', 'delay-on': 'delay', 'amp-sim-on': 'ampEq', 'eq-on': 'ampEq', 'compressor-on': 'compressor', 'reverb-on': 'reverb' }
      const suffix = id.slice('effects.'.length)
      if (onUnit[suffix]) {
        const unit = onUnit[suffix]
        if (shifted && (unit === 'delay' || unit === 'compressor' || unit === 'reverb')) editUnit(unit, { global: !s.layers[fx].units[unit].global })
        else editUnit(unit, { on: !s.layers[fx].units[unit].on })
      }
      else {
        const controls: Record<string, [UnitId, keyof UnitState]> = { 'effect-1-rate': ['mod1', 'rate'], 'effect-1-amount': ['mod1', 'amount'], 'effect-2-rate': ['mod2', 'rate'], 'effect-2-amount': ['mod2', 'amount'], 'delay-time': ['delay', 'rate'], 'delay-feedback': ['delay', 'feedback'], 'amp-drive': ['ampEq', 'amount'], 'eq-treble': ['ampEq', 'wet'], 'eq-mid': ['ampEq', 'rate'], 'eq-bass': ['ampEq', 'feedback'], 'compressor-amount': ['compressor', 'amount'], 'reverb-amount': ['reverb', 'wet'] }
        const target = controls[suffix]; if (target) editUnit(target[0], { [target[1]]: value / 100 })
      }
    }
  }

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
          if (event.data) routeStageMidi(engine, `midi:${input.id}`, event.data)
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
        <div className="control-deck">{sections.map(section => <Section key={section.id} {...section} state={hardware} update={update} stage={stage} audioStatus={audioStatus} />)}</div>
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
      <span><b>STAGE 4 73</b> · {stage.layers[stage.focus].type} · Piano {stage.focus}</span>
      <span>{audioStatus === 'idle' ? 'Audio not started · play a key to enable' : audioStatus === 'loading' ? 'Loading recorded pianos… synthesized fallback playable' : audioStatus === 'ready' ? 'Recorded pianos ready · offline' : audioStatus === 'fallback' ? 'Sample error · synthesized fallback playable' : 'Audio error'}</span>
      <span>{midiStatus}</span>
      <span>Space: sustain {sustain ? '●' : '○'} · Keys A–;: play</span>
      <span className="decorative-hint">Organ, Synth, and Program controls are decorative</span>
    </div>
    <div className="settings-panel" aria-label="Piano and layer effects settings">
      <div className="settings-group" aria-label="Piano layer settings">
        <strong>PIANO {stage.focus}</strong>
        {(['A', 'B'] as const).map(id => <button key={id} type="button" aria-label={`Focus Piano ${id}`} aria-pressed={stage.focus === id} onClick={() => commitStage({ ...stageRef.current, focus: id, fxFocus: id })}>{id}</button>)}
        <button type="button" aria-label={`Enable Piano ${stage.focus}`} aria-pressed={stage.layers[stage.focus].enabled} onClick={() => editLayer(stage.focus, { enabled: !stage.layers[stage.focus].enabled })}>Layer {stage.layers[stage.focus].enabled ? 'On' : 'Off'}</button>
        <label>Type <select aria-label="Piano type" value={stage.layers[stage.focus].type} onChange={event => editLayer(stage.focus, { type: event.target.value as StageState['layers']['A']['type'], timbre: 'Off' })}>{pianoTypes.map(type => <option key={type}>{type}</option>)}</select></label>
        <label>Octave <select aria-label="Piano octave shift" value={stage.layers[stage.focus].octave} onChange={event => editLayer(stage.focus, { octave: Number(event.target.value) })}><option value={-12}>−12</option><option value={0}>0</option><option value={12}>+12</option></select></label>
        <button type="button" aria-label="SUSTPED" aria-pressed={stage.layers[stage.focus].sustped} onClick={() => editLayer(stage.focus, { sustped: !stage.layers[stage.focus].sustped })}>SUSTPED</button>
        <button type="button" aria-label="PSTICK" aria-pressed={stage.layers[stage.focus].pstick} onClick={() => editLayer(stage.focus, { pstick: !stage.layers[stage.focus].pstick })}>PSTICK</button>
        <label>Dyn Comp <select aria-label="Dyn Comp" value={stage.layers[stage.focus].dynComp} onChange={event => editLayer(stage.focus, { dynComp: Number(event.target.value) as 0 | 1 | 2 | 3 })}>{[0,1,2,3].map(n => <option key={n} value={n}>{n || 'Off'}</option>)}</select></label>
        <label>Unison <select aria-label="Unison" value={stage.layers[stage.focus].unison} onChange={event => editLayer(stage.focus, { unison: Number(event.target.value) as 0 | 1 | 2 | 3 })}>{[0,1,2,3].map(n => <option key={n} value={n}>{n || 'Off'}</option>)}</select></label>
        <span>Touch {stage.layers[stage.focus].kbTouch} · Timbre {stage.layers[stage.focus].timbre}</span>
      </div>
      <div className="settings-group" aria-label="Layer effects settings">
        <strong>FX {stage.fxSection.toUpperCase()} {stage.fxSection === 'Piano' ? stage.fxFocus : '· decorative'}</strong>
        <button type="button" aria-label="All effects" aria-pressed={stage.effectsOn} onClick={() => commitStage({ ...stageRef.current, effectsOn: !stage.effectsOn })}>FX {stage.effectsOn ? 'On' : 'Bypass'}</button>
        <button type="button" aria-label="Piano effect group" aria-pressed={stage.group} onClick={() => { const current = stageRef.current; const source = current.layers[current.fxFocus].units; const other: LayerId = current.fxFocus === 'A' ? 'B' : 'A'; commitStage({ ...current, group: !current.group, layers: !current.group ? { ...current.layers, [other]: { ...current.layers[other], units: structuredClone(source) } } : current.layers }) }}>Group</button>
        {(['A', 'B'] as const).map(id => <button key={id} type="button" aria-label={`Focus effects Piano ${id}`} aria-pressed={stage.fxFocus === id && stage.fxSection === 'Piano'} onClick={() => commitStage({ ...stageRef.current, fxSection: 'Piano', fxFocus: id })}>FX {id}</button>)}
        {(Object.keys(unitTypes) as UnitId[]).map(unit => <div className="unit-settings" key={unit}>
          <button type="button" aria-label={`${unit} bypass`} aria-pressed={stage.layers[stage.fxFocus].units[unit].on} onClick={() => editUnit(unit, { on: !stage.layers[stage.fxFocus].units[unit].on })}>{unit}</button>
          {unitTypes[unit].length > 1 && <select aria-label={`${unit} type`} value={stage.layers[stage.fxFocus].units[unit].type} onChange={event => editUnit(unit, { type: event.target.value })}>{unitTypes[unit].map(type => <option key={type}>{type}</option>)}</select>}
          {(unit === 'delay' || unit === 'reverb') && <label>Wet <input aria-label={`${unit} dry wet`} type="range" min="0" max="100" value={Math.round(stage.layers[stage.fxFocus].units[unit].wet * 100)} onChange={event => editUnit(unit, { wet: Number(event.target.value) / 100 })} /></label>}
          {unit === 'delay' && <select aria-label="Delay feedback filter" value={stage.layers[stage.fxFocus].units.delay.filter} onChange={event => editUnit('delay', { filter: event.target.value as UnitState['filter'] })}>{['Off','LP','HP','BP'].map(v => <option key={v}>{v}</option>)}</select>}
          {unit === 'delay' && <button type="button" aria-label="Delay tap tempo" onClick={() => { const time = performance.now(); if (lastTap.current !== null) { const delta = Math.max(80, Math.min(800, time - lastTap.current)); editUnit('delay', { rate: 1 - (delta / 1000 - .08) / .72 }) } lastTap.current = time }}>Tap</button>}
          {(unit === 'delay' || unit === 'compressor' || unit === 'reverb') && <button type="button" aria-label={`${unit} global`} aria-pressed={stage.layers[stage.fxFocus].units[unit].global} onClick={() => editUnit(unit, { global: !stage.layers[stage.fxFocus].units[unit].global })}>Global</button>}
          {unit === 'compressor' && <button type="button" aria-label="Compressor fast" aria-pressed={stage.layers[stage.fxFocus].units.compressor.fast} onClick={() => editUnit(unit, { fast: !stage.layers[stage.fxFocus].units.compressor.fast })}>Fast</button>}
          {unit === 'reverb' && <button type="button" aria-label="Reverb bright" aria-pressed={stage.layers[stage.fxFocus].units.reverb.bright} onClick={() => editUnit(unit, { bright: !stage.layers[stage.fxFocus].units.reverb.bright })}>Bright</button>}
        </div>)}
      </div>
    </div>
  </main>
}
