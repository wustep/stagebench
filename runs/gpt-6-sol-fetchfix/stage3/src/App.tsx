import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { hardwareControls, initialHardwareState, pianoKeys, sections } from './hardware'
import type { Control, SectionId } from './hardware'
import type { VoiceBackend } from './piano'
import { StageAudio, StagePianoEngine, cycle, initialStageState, pianoTypes, routeStageMidi, timbres, unitTypes } from './stage'
import type { LayerId, StageAudioStatus, StageState, UnitId, UnitState } from './stage'
import { filterTypes, lfoWaves, loadPrograms, programSnapshot, splitNotes, voiceKeys, waveforms } from './system'
import type { OrganLayer, SynthLayer } from './system'

const unsupported = ['performance.rotary-select', 'organ.organ-preset-1', 'organ.organ-preset-2', 'piano.piano-model', 'program.morph-assign-aftertouch', 'synth.mode-sample', 'synth.mode-wave', 'synth.synth-preset']

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
          <input type="range" min="0" max="100" step="1" value={value} aria-label={control.name} aria-valuetext={`${value} percent${unsupported.includes(control.id) ? ', unsupported' : ''}`} onChange={event => update(control.id, Number(event.target.value))} />
        </>}
    <span className="control-label" aria-hidden="true">{control.name.replace(/^Organ |^Piano |^Synth |^Effect [12] |^Program /, '')}</span>
  </div>
}

function Section({ id, label, width, state, update, stage, audioStatus, programLabel }: { id: SectionId; label: string; width: number; state: Record<string, number>; update: (id: string, value: number, shifted?: boolean) => void; stage: StageState; audioStatus: StageAudioStatus; programLabel: string }) {
  return <section className={`deck-section section-${id}`} style={{ width: `${width}%` }} aria-label={`${label} controls`} data-section={id}>
    {id !== 'performance' && <div className="inset-panel" />}
    <div className="section-heading" aria-hidden="true">{label.toUpperCase()}</div>
    {id === 'performance' && <div className="brand" aria-hidden="true"><span>nord</span> stage 4<small>HAMMER ACTION</small></div>}
    {id === 'organ' && <div className="organ-legends" aria-hidden="true">B3&nbsp; VOX&nbsp; FARF&nbsp; PIPE <span>DRAWBARS</span></div>}
    {id === 'program' && <div className="oled program-oled" role="img" aria-label={`Program display: ${programLabel}, ${audioStatus}`}><strong>{programLabel.toUpperCase()}</strong><span>{audioStatus === 'fallback' ? 'SAMPLE ERROR · FALLBACK' : `SCENE ${stage.scene ? 'II' : 'I'} · ${stage.tempo} BPM`}</span><small>73 KEY HAMMER ACTION</small></div>}
    {id === 'synth' && <div className="oled synth-oled" role="img" aria-label={`Synth display: ${stage.synth[stage.synthFocus].waveform}`}><strong>SYNTH {stage.synthFocus}</strong><span>{stage.synth[stage.synthFocus].waveform}</span></div>}
    {id === 'effects' && <div className="effects-divider" aria-hidden="true" />}
    {hardwareControls.filter(control => control.section === id).map(control => <HardwareInput key={control.id} control={control} value={state[control.id]} update={update} detail={id === 'piano' ? `${stage.layers[stage.focus].type} · Piano ${stage.focus}` : id === 'effects' ? `Piano ${stage.fxFocus}` : undefined} />)}
  </section>
}

export default function App({ backend, requestMidi }: AppProps) {
  const [hardware, setHardware] = useState(initialHardwareState)
  const [stage, setStage] = useState(initialStageState)
  const stageRef = useRef(stage)
  const [bank, setBank] = useState(() => loadPrograms(initialStageState(), typeof localStorage === 'undefined' ? undefined : localStorage))
  const bankRef = useRef(bank)
  const [slot, setSlot] = useState(0)
  const [liveMode, setLiveMode] = useState(false)
  const [listView, setListView] = useState(false)
  const [storeStep, setStoreStep] = useState<'idle' | 'name' | 'destination'>('idle')
  const [storeName, setStoreName] = useState('')
  const [storeSlot, setStoreSlot] = useState(0)
  const storeSource = useRef<StageState | null>(null)
  const [morphLatch, setMorphLatch] = useState<'Wheel' | 'Control Pedal' | null>(null)
  const [page, setPage] = useState(0)
  const [audioStatus, setAudioStatus] = useState<StageAudioStatus>('idle')
  const [midiStatus, setMidiStatus] = useState('Checking MIDI')
  const [activeNotes, setActiveNotes] = useState<number[]>([])
  const [sustain, setSustain] = useState(false)
  const audioRef = useRef<StageAudio | null>(null)
  const engineRef = useRef<StagePianoEngine | null>(null)
  if (!engineRef.current) {
    const sound = backend ?? new StageAudio(() => stageRef.current, setAudioStatus)
    if (!backend) audioRef.current = sound as StageAudio
    engineRef.current = new StagePianoEngine((layer, note, velocity) => backend ? backend.start(note, velocity) : (sound as StageAudio).startLayer(layer, note, velocity), () => stageRef.current, 24, (layer, note, velocity) => backend ? backend.start(note, velocity) : (sound as StageAudio).startLayer(layer, note, velocity))
  }
  const engine = engineRef.current
  const pointerNotes = useRef(new Map<number, number>())
  const heldComputer = useRef(new Set<string>())
  const heldFocus = useRef(new Set<number>())
  const lastTap = useRef<number | null>(null)
  const clockTaps = useRef<number[]>([])
  const refresh = () => { setActiveNotes(engine.activeNotes); setSustain(engine.sustainDown) }
  const commitStage = (next: StageState, persistLive = true) => { const previous = stageRef.current; if (next.scene === previous.scene) { const changes = voiceKeys.filter(key => { const [section, layer] = key.split(':') as ['Piano' | 'Organ' | 'Synth', 'A' | 'B' | 'C']; const before = section === 'Piano' ? previous.layers[layer as LayerId].enabled : section === 'Organ' ? previous.organ[layer as LayerId].enabled : previous.synth[layer].enabled; const after = section === 'Piano' ? next.layers[layer as LayerId].enabled : section === 'Organ' ? next.organ[layer as LayerId].enabled : next.synth[layer].enabled; return before !== after }); if (changes.length) { const scenes = structuredClone(next.scenes); for (const key of changes) { const [section, layer] = key.split(':') as ['Piano' | 'Organ' | 'Synth', 'A' | 'B' | 'C']; scenes[next.scene][key] = section === 'Piano' ? next.layers[layer as LayerId].enabled : section === 'Organ' ? next.organ[layer as LayerId].enabled : next.synth[layer].enabled } next = { ...next, scenes } } } stageRef.current = next; setStage(next); audioRef.current?.applyState(); if (liveMode && persistLive) { const updated = { ...bankRef.current, live: [...bankRef.current.live] }; updated.live[slot % 8] = { ...updated.live[slot % 8], state: programSnapshot(next) as Record<string, unknown> }; bankRef.current = updated; setBank(updated); try { localStorage.setItem('stage4-programs-v3', JSON.stringify(updated)) } catch { /* unavailable */ } } }
  const dirty = !liveMode && JSON.stringify(programSnapshot(stage)) !== JSON.stringify(bank.slots[slot].state)
  const chooseProgram = (index: number, live = liveMode) => { engine.allNotesOff(); const document = live ? bankRef.current.live[index % 8] : bankRef.current.slots[index]; const current = stageRef.current; commitStage({ ...initialStageState(), ...structuredClone(document.state) as unknown as StageState, master: current.master, pitch: current.pitch, wheel: current.wheel, pedal: current.pedal }, false); setSlot(index); setPage(Math.floor(index / 8)); setLiveMode(live); setStoreStep('idle'); refresh() }
  const beginStore = (as = false) => { storeSource.current = structuredClone(stageRef.current); setStoreName((liveMode ? bankRef.current.live[slot % 8] : bankRef.current.slots[slot]).name); setStoreSlot(slot); setStoreStep(as ? 'name' : 'destination') }
  const auditionStore = (index: number) => { setStoreSlot(index); const current = stageRef.current; commitStage({ ...initialStageState(), ...structuredClone(bankRef.current.slots[index].state) as unknown as StageState, master: current.master, pitch: current.pitch, wheel: current.wheel, pedal: current.pedal }, false) }
  const cancelStore = () => { if (storeSource.current) commitStage(storeSource.current, false); storeSource.current = null; setStoreStep('idle') }
  const confirmStore = () => { const source = storeSource.current ?? stageRef.current, updated = { ...bankRef.current, slots: [...bankRef.current.slots] }; updated.slots[storeSlot] = { name: storeName.trim() || updated.slots[storeSlot].name, state: programSnapshot(source) as Record<string, unknown> }; bankRef.current = updated; setBank(updated); try { localStorage.setItem('stage4-programs-v3', JSON.stringify(updated)) } catch { /* unavailable */ } commitStage(source, false); storeSource.current = null; setStoreStep('idle'); setSlot(storeSlot); setPage(Math.floor(storeSlot / 8)); setLiveMode(false) }
  const editOrgan = (change: Partial<OrganLayer>) => { const s = stageRef.current, id = s.organFocus; commitStage({ ...s, organ: { ...s.organ, [id]: { ...s.organ[id], ...change } } }); if (change.enabled === false) engine.stopLayer(`Organ:${id}`) }
  const editSynth = (change: Partial<SynthLayer>) => { const s = stageRef.current, id = s.synthFocus; commitStage({ ...s, synth: { ...s.synth, [id]: { ...s.synth[id], ...change } } }); if (change.enabled === false) engine.stopLayer(`Synth:${id}`) }
  const editMorphable = (path: string, value: number, edit: () => void) => { if (morphLatch) { const s = stageRef.current; const raw = Number(path.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown>)?.[p], s) ?? 0); const from = path.includes('drawbars') ? raw / 8 : raw; const source = { ...s.morphs[morphLatch] }; if (Math.abs(from - value) < .001) delete source[path]; else source[path] = { from, to: value }; commitStage({ ...s, morphs: { ...s.morphs, [morphLatch]: source } }) } else edit() }
  const editLayer = (layer: LayerId, change: Partial<StageState['layers']['A']>) => {
    const next = { ...stageRef.current, layers: { ...stageRef.current.layers, [layer]: { ...stageRef.current.layers[layer], ...change } } }
    commitStage(next)
    if (change.enabled === false) engine.stopLayer(layer)
    if (change.sustped === false) engine.releaseUnrouted(layer)
  }
  const editUnit = (unit: UnitId, change: Partial<UnitState>) => {
    const current = stageRef.current
    if (current.fxSection === 'Organ') { commitStage({ ...current, organUnits: { ...current.organUnits, [unit]: { ...current.organUnits[unit], ...change } } }); return }
    if (current.fxSection === 'Synth') { const id = current.synthFocus; commitStage({ ...current, synth: { ...current.synth, [id]: { ...current.synth[id], units: { ...current.synth[id].units, [unit]: { ...current.synth[id].units[unit], ...change } } } } }); return }
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
    else if (id === 'performance.rotary-speed') editMorphable('rotarySpeed', value / 100, () => commitStage({ ...s, rotarySpeed: value / 100 }))
    else if (id === 'performance.rotary-drive') commitStage({ ...s, rotaryDrive: value / 100 })
    else if (id === 'performance.rotary-on') commitStage({ ...s, rotaryOn: !s.rotaryOn })
    else if (id === 'performance.rotary-fast') commitStage({ ...s, rotaryFast: true })
    else if (id === 'performance.rotary-slow-stop') commitStage({ ...s, rotaryFast: false })
    else if (id === 'performance.modulation-wheel') commitStage({ ...s, wheel: value / 100 })
    else if (id === 'organ.organ-on') { commitStage({ ...s, organOn: !s.organOn, organ: { ...s.organ, A: { ...s.organ.A, enabled: !s.organOn } } }); if (s.organOn) { engine.stopLayer('Organ:A'); engine.stopLayer('Organ:B') } }
    else if (id === 'organ.organ-level-a' || id === 'organ.organ-level-b') { const layer = id.endsWith('-a') ? 'A' : 'B'; editMorphable(`organ.${layer}.level`, value / 100, () => { commitStage({ ...s, organFocus: layer, organ: { ...s.organ, [layer]: { ...s.organ[layer], level: value / 100 } } }) }) }
    else if (id.startsWith('organ.model-')) { const models = { 'organ.model-b3': 'B3', 'organ.model-vox': 'Vox', 'organ.model-farf': 'Farf', 'organ.model-pipe': 'Pipe 1' } as const; const model = models[id as keyof typeof models]; if (model) editOrgan({ model }) }
    else if (id.startsWith('organ.drawbar-')) { const index = Number(id.match(/drawbar-(\d+)/)?.[1]) - 1; if (index >= 0) { const bars = [...s.organ[s.organFocus].drawbars]; bars[index] = Math.round(value * .08); editMorphable(`organ.${s.organFocus}.drawbars.${index}`, bars[index] / 8, () => editOrgan({ drawbars: bars })) } }
    else if (id === 'organ.vibrato') editOrgan({ vibrato: !s.organ[s.organFocus].vibrato })
    else if (id === 'organ.chorus') editOrgan({ chorus: cycle(['C1','C2','C3','V1','V2','V3'] as const, s.organ[s.organFocus].chorus) })
    else if (id === 'organ.percussion') editOrgan({ percussion: !s.organ[s.organFocus].percussion })
    else if (id === 'organ.soft') editOrgan({ percussionSoft: !s.organ[s.organFocus].percussionSoft })
    else if (id === 'organ.fast') editOrgan({ percussionFast: !s.organ[s.organFocus].percussionFast })
    else if (id === 'organ.third') editOrgan({ percussionThird: !s.organ[s.organFocus].percussionThird })
    else if (id === 'program.live-mode') { chooseProgram(slot % 8, !liveMode) }
    else if (id === 'program.store') { if (storeStep === 'destination') confirmStore(); else beginStore(shifted) }
    else if (id === 'program.page-left') { const next = (page + 3) % 4; setPage(next); if (!liveMode) chooseProgram(next * 8 + slot % 8) }
    else if (id === 'program.page-right') { const next = (page + 1) % 4; setPage(next); if (!liveMode) chooseProgram(next * 8 + slot % 8) }
    else if (/^program\.program-[1-8]$/.test(id)) { const index = Number(id.slice(-1)) - 1; if (storeStep === 'destination') auditionStore(page * 8 + index); else chooseProgram(liveMode ? index : page * 8 + index) }
    else if (id === 'program.program-dial') { if (shifted) setListView(!listView); else if (storeStep === 'destination') auditionStore(Math.max(0, Math.min(31, Math.round(value * .31)))); else chooseProgram(Math.max(0, Math.min(liveMode ? 7 : 31, Math.round(value * (liveMode ? .07 : .31))))) }
    else if (id === 'program.split') commitStage({ ...s, splits: [{ ...s.splits[0] }, { ...s.splits[1], on: !s.splits[1].on }, { ...s.splits[2] }] })
    else if (id === 'program.layer-scene-1' || id === 'program.layer-scene-2') { const scene = id.endsWith('1') ? 0 : 1; const enabled = s.scenes[scene]; commitStage({ ...s, scene, layers: Object.fromEntries((['A','B'] as const).map(k => [k, { ...s.layers[k], enabled: enabled[`Piano:${k}`] }])) as StageState['layers'], organ: Object.fromEntries((['A','B'] as const).map(k => [k, { ...s.organ[k], enabled: enabled[`Organ:${k}`] }])) as StageState['organ'], synth: Object.fromEntries((['A','B','C'] as const).map(k => [k, { ...s.synth[k], enabled: enabled[`Synth:${k}`] }])) as StageState['synth'] }) }
    else if (id === 'program.morph-assign-wheel' || id === 'program.morph-assign-control-pedal') { const source = id.endsWith('wheel') ? 'Wheel' : 'Control Pedal'; if (shifted) commitStage({ ...s, morphs: { ...s.morphs, [source]: {} } }); else setMorphLatch(morphLatch === source ? null : source) }
    else if (id === 'synth.synth-on') { commitStage({ ...s, synthOn: !s.synthOn, synth: { ...s.synth, A: { ...s.synth.A, enabled: !s.synthOn } } }); if (s.synthOn) { engine.stopLayer('Synth:A'); engine.stopLayer('Synth:B'); engine.stopLayer('Synth:C') } }
    else if (id === 'synth.synth-layer-a' || id === 'synth.synth-layer-b') commitStage({ ...s, synthFocus: id.endsWith('a') ? 'A' : 'B' })
    else if (id.startsWith('synth.synth-level-')) { const layer = id.endsWith('a') ? 'A' : 'B'; editMorphable(`synth.${layer}.level`, value / 100, () => { commitStage({ ...s, synthFocus: layer, synth: { ...s.synth, [layer]: { ...s.synth[layer], level: value / 100 } } }) }) }
    else if (id === 'synth.mode-analog') editSynth({ waveform: 'Saw' })
    else if (id === 'synth.mode-fm') editSynth({ waveform: 'FM 2-op (algorithm A)' })
    else if (id === 'synth.osc-shape') editMorphable(`synth.${s.synthFocus}.oscCtrl`, value / 100, () => editSynth({ oscCtrl: value / 100 }))
    else if (id === 'synth.osc-tune') editSynth({ coarse: Math.round(value * .48 - 24) })
    else if (id === 'synth.mix') editSynth({ level: value / 100 })
    else if (id === 'synth.filter-freq') editMorphable(`synth.${s.synthFocus}.cutoff`, value / 100, () => editSynth({ cutoff: value / 100 }))
    else if (id === 'synth.filter-resonance') editMorphable(`synth.${s.synthFocus}.resonance`, value / 100, () => editSynth({ resonance: value / 100 }))
    else if (id === 'synth.env-attack') editSynth({ ampEnv: { ...s.synth[s.synthFocus].ampEnv, attack: value / 100 } })
    else if (id === 'synth.env-decay') editSynth({ ampEnv: { ...s.synth[s.synthFocus].ampEnv, decay: value / 100 } })
    else if (id === 'synth.lfo-rate') editMorphable(`synth.${s.synthFocus}.lfoRate`, value / 100, () => editSynth({ lfoRate: value / 100 }))
    else if (id === 'synth.arp-rate') editMorphable(`synth.${s.synthFocus}.arpRate`, value / 100, () => editSynth({ arpRate: value / 100 }))
    else if (id === 'synth.vibrato') editSynth({ vibratoAmount: value / 100 })
    else if (id === 'synth.osc-sync') editSynth({ waveform: cycle(['Sync Saw', 'Sync Square'] as const, s.synth[s.synthFocus].waveform as 'Sync Saw' | 'Sync Square') })
    else if (id === 'synth.pitch-env') editSynth({ oscEnv: { ...s.synth[s.synthFocus].oscEnv, amount: value > 0 ? 1 : 0 } })
    else if (id === 'synth.filter-type') editSynth({ filterType: cycle(filterTypes, s.synth[s.synthFocus].filterType) })
    else if (id === 'synth.filter-drive') editSynth({ drive: ((s.synth[s.synthFocus].drive + 1) % 4) as SynthLayer['drive'] })
    else if (id === 'synth.lfo-target') editSynth({ lfoTarget: cycle(['Off', 'Osc Pitch', 'Osc Ctrl', 'Filter Freq'] as const, s.synth[s.synthFocus].lfoTarget) })
    else if (id === 'synth.arp-on') editSynth({ arpRun: !s.synth[s.synthFocus].arpRun })
    else if (id === 'synth.arp-direction') editSynth({ arpDirection: cycle(['Up', 'Down', 'Up/Down', 'Random'] as const, s.synth[s.synthFocus].arpDirection) })
    else if (id === 'synth.voice-mode') editSynth({ voiceMode: cycle(['Poly', 'Mono', 'Legato'] as const, s.synth[s.synthFocus].voiceMode) })
    else if (id === 'synth.glide') editSynth({ glide: s.synth[s.synthFocus].glide ? 0 : .4 })
    else if (id === 'piano.piano-on') { commitStage({ ...s, pianoOn: !s.pianoOn }); if (s.pianoOn) engine.allNotesOff() }
    else if (id === 'piano.piano-layer-a' || id === 'piano.piano-layer-b') { const selected = id.endsWith('-a') ? 'A' : 'B'; commitStage({ ...s, focus: selected, fxFocus: selected }) }
    else if (id === 'piano.piano-level-a' || id === 'piano.piano-level-b') { const layer = id.endsWith('-a') ? 'A' : 'B'; editMorphable(`layers.${layer}.level`, value / 100, () => editLayer(layer, { level: value / 100 })) }
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
          if (event.data) { routeStageMidi(engine, `midi:${input.id}`, event.data); if ((event.data[0] & 0xf0) === 0xb0 && event.data[1] === 11) commitStage({ ...stageRef.current, pedal: event.data[2] / 127 }) }
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
        <div className="control-deck">{sections.map(section => <Section key={section.id} {...section} state={hardware} update={update} stage={stage} audioStatus={audioStatus} programLabel={`${liveMode ? `LIVE ${slot % 8 + 1}` : `${Math.floor(slot / 8) + 1}.${slot % 8 + 1}`} ${liveMode ? bank.live[slot % 8].name : bank.slots[slot].name}${dirty ? ' E' : ''}`} />)}</div>
        <div className="keybed" aria-label="73 key E1 to E7 piano keybed">
          <div className="back-rail" />
          <div className="split-leds" aria-label="Active split points">{stage.splits.filter(point => point.on).map((point, i) => <span key={`${point.note}-${i}`} title={`Split ${point.note}`} style={{ left: `${(point.note - 28) / 72 * 100}%` }} />)}</div>
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
      <span><b>STAGE 4 73</b> · {liveMode ? `LIVE ${slot % 8 + 1}` : `${Math.floor(slot / 8) + 1}.${slot % 8 + 1}`} {liveMode ? bank.live[slot % 8].name : bank.slots[slot].name}{dirty ? ' E' : ''}</span>
      <span>{audioStatus === 'idle' ? 'Audio not started · play a key to enable' : audioStatus === 'loading' ? 'Loading recorded pianos… synthesized fallback playable' : audioStatus === 'ready' ? 'Recorded pianos ready · offline' : audioStatus === 'fallback' ? 'Sample error · synthesized fallback playable' : 'Audio error'}</span>
      <span>{midiStatus}</span>
      <span>Space: sustain {sustain ? '●' : '○'} · Keys A–;: play</span>
      <span>Scene {stage.scene ? 'II' : 'I'} · {stage.tempo} BPM · transpose {stage.transpose >= 0 ? '+' : ''}{stage.transpose}</span>
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
        <strong>FX {stage.fxSection.toUpperCase()} {stage.fxSection === 'Piano' ? stage.fxFocus : stage.fxSection === 'Organ' ? 'A+B' : stage.synthFocus}</strong>
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
      <div className="settings-group system-settings" aria-label="Program and performance settings">
        <strong>PROGRAM {liveMode ? `LIVE ${slot % 8 + 1}` : `${Math.floor(slot / 8) + 1}.${slot % 8 + 1}`} {dirty ? 'E' : ''}</strong>
        <span>{liveMode ? bank.live[slot % 8].name : bank.slots[slot].name}</span>
        <button type="button" aria-label="Live Mode" aria-pressed={liveMode} onClick={() => chooseProgram(slot % 8, !liveMode)}>Live</button>
        <button type="button" aria-label="Store" onClick={() => storeStep === 'destination' ? confirmStore() : beginStore()}>Store</button>
        <button type="button" aria-label="Store As" onClick={() => beginStore(true)}>Store As</button>
        {storeStep !== 'idle' && <div className="store-panel"><label>Name <input aria-label="Program name" value={storeName} onChange={event => setStoreName(event.target.value)} /></label><label>Destination <select aria-label="Store destination" value={storeSlot} onChange={event => auditionStore(Number(event.target.value))}>{bank.slots.map((_, i) => <option key={i} value={i}>{Math.floor(i / 8) + 1}.{i % 8 + 1}</option>)}</select></label><button type="button" onClick={confirmStore}>Confirm Store</button><button type="button" onClick={cancelStore}>Cancel Store</button></div>}
        <button type="button" aria-label="Program list" aria-pressed={listView} onClick={() => setListView(!listView)}>List</button>
        {listView && <select aria-label="Numeric program list" value={slot} onChange={event => chooseProgram(Number(event.target.value), false)}>{bank.slots.map((doc, i) => <option key={i} value={i}>{Math.floor(i / 8) + 1}.{i % 8 + 1} {doc.name}</option>)}</select>}
        <button type="button" aria-label="Previous program" onClick={() => chooseProgram((slot + (liveMode ? 7 : 31)) % (liveMode ? 8 : 32))}>◀</button><button type="button" aria-label="Next program" onClick={() => chooseProgram((slot + 1) % (liveMode ? 8 : 32))}>▶</button>
        <label>Master Clock <input aria-label="Master Clock BPM" type="number" min="30" max="300" value={stage.tempo} onChange={event => commitStage({ ...stageRef.current, tempo: Math.max(30, Math.min(300, Number(event.target.value))) })} /></label>
        <button type="button" aria-label="Clock sync effects" aria-pressed={stage.clockSync} onClick={() => commitStage({ ...stageRef.current, clockSync: !stage.clockSync })}>Clock Sync</button>
        <button type="button" aria-label="Tap Master Clock" onClick={() => { const now = performance.now(); clockTaps.current = [...clockTaps.current.filter(time => now - time < 4000), now].slice(-4); if (clockTaps.current.length >= 4) { const taps = clockTaps.current; const average = (taps[3] - taps[0]) / 3; commitStage({ ...stageRef.current, tempo: Math.round(Math.max(30, Math.min(300, 60000 / average))) }) } }}>Tap</button>
        <label>Transpose <input aria-label="Transpose" type="number" min="-6" max="6" value={stage.transpose} onChange={event => commitStage({ ...stageRef.current, transpose: Math.max(-6, Math.min(6, Number(event.target.value))) })} /></label>
        <button type="button" aria-label="Panic" onClick={() => { engine.allNotesOff(); setActiveNotes([]); setSustain(false); commitStage({ ...stageRef.current, wheel: 0, pedal: 0 }) }}>Panic</button>
        <button type="button" aria-label="Scene I" aria-pressed={stage.scene === 0} onClick={() => update('program.layer-scene-1', 100)}>I</button><button type="button" aria-label="Scene II" aria-pressed={stage.scene === 1} onClick={() => update('program.layer-scene-2', 100)}>II</button>
        <button type="button" aria-label="Morph Wheel assign" aria-pressed={morphLatch === 'Wheel'} onClick={() => setMorphLatch(morphLatch === 'Wheel' ? null : 'Wheel')}>Wheel assign</button><button type="button" aria-label="Clear Wheel morph" onClick={() => commitStage({ ...stageRef.current, morphs: { ...stageRef.current.morphs, Wheel: {} } })}>Clear Wheel</button>
        <button type="button" aria-label="Morph Control Pedal assign" aria-pressed={morphLatch === 'Control Pedal'} onClick={() => setMorphLatch(morphLatch === 'Control Pedal' ? null : 'Control Pedal')}>Pedal assign</button><button type="button" aria-label="Clear Control Pedal morph" onClick={() => commitStage({ ...stageRef.current, morphs: { ...stageRef.current.morphs, 'Control Pedal': {} } })}>Clear Pedal</button>
        <label>Wheel <input aria-label="Morph Wheel" type="range" min="0" max="100" value={Math.round(stage.wheel * 100)} onChange={event => commitStage({ ...stageRef.current, wheel: Number(event.target.value) / 100 })} /></label><label>Control Pedal <input aria-label="Control Pedal" type="range" min="0" max="100" value={Math.round(stage.pedal * 100)} onChange={event => commitStage({ ...stageRef.current, pedal: Number(event.target.value) / 100 })} /></label>
      </div>
      <div className="settings-group system-settings" aria-label="Split and zone settings">
        <strong>SPLIT / ZONES</strong>
        {stage.splits.map((point, i) => <span key={i}><button type="button" aria-label={`${['Low','Mid','High'][i]} split on`} aria-pressed={point.on} onClick={() => { const splits = structuredClone(stageRef.current.splits); splits[i].on = !splits[i].on; commitStage({ ...stageRef.current, splits }) }}>{['Low','Mid','High'][i]}</button><select aria-label={`${['Low','Mid','High'][i]} split position`} value={point.note} onChange={event => { const splits = structuredClone(stageRef.current.splits); splits[i].note = Number(event.target.value); commitStage({ ...stageRef.current, splits }) }}>{splitNotes.map(note => <option key={note} value={note}>{['C','F'][splitNotes.indexOf(note) % 2]}{Math.floor(note / 12) - 1}</option>)}</select><select aria-label={`${['Low','Mid','High'][i]} split crossfade`} value={point.fade} onChange={event => { const splits = structuredClone(stageRef.current.splits); splits[i].fade = Number(event.target.value) as 0 | 6 | 12; commitStage({ ...stageRef.current, splits }) }}><option value={0}>Off</option><option value={6}>±6</option><option value={12}>±12</option></select></span>)}
        {voiceKeys.map(key => { const [section, layer] = key.split(':') as ['Piano' | 'Organ' | 'Synth', 'A' | 'B' | 'C']; const current = section === 'Piano' ? stage.layers[layer as LayerId] : section === 'Organ' ? stage.organ[layer as LayerId] : stage.synth[layer]; return <span key={key}><label>{key} zones <select aria-label={`${key} zone start`} value={current.zones[0]} onChange={event => { const zones = [Number(event.target.value), current.zones[1]] as typeof current.zones; if (section === 'Piano') editLayer(layer as LayerId, { zones }); else if (section === 'Organ') { commitStage({ ...stageRef.current, organ: { ...stageRef.current.organ, [layer]: { ...stageRef.current.organ[layer as LayerId], zones } } }) } else { commitStage({ ...stageRef.current, synth: { ...stageRef.current.synth, [layer]: { ...stageRef.current.synth[layer], zones } } }) } }}>{[0,1,2,3].map(n => <option key={n} value={n}>{n + 1}</option>)}</select><select aria-label={`${key} zone end`} value={current.zones[1]} onChange={event => { const zones = [current.zones[0], Number(event.target.value)] as typeof current.zones; if (section === 'Piano') editLayer(layer as LayerId, { zones }); else if (section === 'Organ') commitStage({ ...stageRef.current, organ: { ...stageRef.current.organ, [layer]: { ...stageRef.current.organ[layer as LayerId], zones } } }); else commitStage({ ...stageRef.current, synth: { ...stageRef.current.synth, [layer]: { ...stageRef.current.synth[layer], zones } } }) }}>{[0,1,2,3].map(n => <option key={n} value={n}>{n + 1}</option>)}</select></label></span> })}
      </div>
      <div className="settings-group system-settings" aria-label="Organ settings">
        <strong>ORGAN {stage.organFocus}</strong><button type="button" aria-label="Organ on" aria-pressed={stage.organOn} onClick={() => commitStage({ ...stageRef.current, organOn: !stage.organOn })}>Organ</button>
        {(['A','B'] as const).map(id => <button type="button" key={id} aria-label={`Focus Organ ${id}`} aria-pressed={stage.organFocus === id} onClick={() => commitStage({ ...stageRef.current, organFocus: id, fxSection: 'Organ' })}>{id}</button>)}
        <button type="button" aria-label={`Enable Organ ${stage.organFocus}`} aria-pressed={stage.organ[stage.organFocus].enabled} onClick={() => editOrgan({ enabled: !stage.organ[stage.organFocus].enabled })}>Layer {stage.organ[stage.organFocus].enabled ? 'On' : 'Off'}</button>
        <label>Model <select aria-label="Organ model" value={stage.organ[stage.organFocus].model} onChange={event => editOrgan({ model: event.target.value as OrganLayer['model'] })}>{['B3','Vox','Farf','Pipe 1','B3 Bass','Pipe 2'].map(m => <option key={m}>{m}</option>)}</select></label>
        <label>Octave <select aria-label="Organ octave" value={stage.organ[stage.organFocus].octave} onChange={event => editOrgan({ octave: Number(event.target.value) })}>{[-12,0,12].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        <label>Level <input aria-label="Organ level" type="range" min="0" max="100" value={Math.round(stage.organ[stage.organFocus].level * 100)} onChange={event => editOrgan({ level: Number(event.target.value) / 100 })} /></label>
        {stage.organ[stage.organFocus].drawbars.map((bar, i) => <label key={i}>D{i + 1} <input aria-label={`Organ drawbar ${i + 1}`} type="range" min="0" max="8" value={bar} onChange={event => { const bars = [...stage.organ[stage.organFocus].drawbars]; bars[i] = Number(event.target.value); editOrgan({ drawbars: bars }) }} /></label>)}
        {(['percussion','percussionSoft','percussionFast','percussionThird','keyClick','vibrato'] as const).map(field => <button type="button" key={field} aria-label={`Organ ${field}`} aria-pressed={stage.organ[stage.organFocus][field]} onClick={() => editOrgan({ [field]: !stage.organ[stage.organFocus][field] })}>{field}</button>)}
        <label>Chorus <select aria-label="Organ chorus" value={stage.organ[stage.organFocus].chorus} onChange={event => editOrgan({ chorus: event.target.value as OrganLayer['chorus'] })}>{['C1','C2','C3','V1','V2','V3'].map(v => <option key={v}>{v}</option>)}</select></label>
        <button type="button" aria-label="Organ to rotary" aria-pressed={stage.rotaryOn} onClick={() => commitStage({ ...stageRef.current, rotaryOn: !stage.rotaryOn })}>To Rotary</button>
      </div>
      <div className="settings-group system-settings" aria-label="Synth settings">
        <strong>SYNTH {stage.synthFocus}</strong><button type="button" aria-label="Synth on" aria-pressed={stage.synthOn} onClick={() => commitStage({ ...stageRef.current, synthOn: !stage.synthOn })}>Synth</button>
        {(['A','B','C'] as const).map(id => <button type="button" key={id} aria-label={`Focus Synth ${id}`} aria-pressed={stage.synthFocus === id} onClick={() => commitStage({ ...stageRef.current, synthFocus: id, fxSection: 'Synth' })}>{id}</button>)}
        <button type="button" aria-label={`Enable Synth ${stage.synthFocus}`} aria-pressed={stage.synth[stage.synthFocus].enabled} onClick={() => editSynth({ enabled: !stage.synth[stage.synthFocus].enabled })}>Layer {stage.synth[stage.synthFocus].enabled ? 'On' : 'Off'}</button>
        <label>Waveform <select aria-label="Synth waveform" value={stage.synth[stage.synthFocus].waveform} onChange={event => editSynth({ waveform: event.target.value as SynthLayer['waveform'] })}>{waveforms.map(w => <option key={w}>{w}</option>)}</select></label>
        <label>Octave <select aria-label="Synth octave" value={stage.synth[stage.synthFocus].octave} onChange={event => editSynth({ octave: Number(event.target.value) })}>{[-12,0,12].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        <label>Level <input aria-label="Synth level" type="range" min="0" max="100" value={Math.round(stage.synth[stage.synthFocus].level * 100)} onChange={event => editSynth({ level: Number(event.target.value) / 100 })} /></label>
        <label>Osc Ctrl <input aria-label="Synth Osc Ctrl" type="range" min="0" max="100" value={Math.round(stage.synth[stage.synthFocus].oscCtrl * 100)} onChange={event => editSynth({ oscCtrl: Number(event.target.value) / 100 })} /></label>
        <label>Coarse <input aria-label="Synth coarse" type="number" min="-24" max="24" value={stage.synth[stage.synthFocus].coarse} onChange={event => editSynth({ coarse: Math.max(-24, Math.min(24, Number(event.target.value))) })} /></label>
        <label>Fine <input aria-label="Synth fine" type="number" min="-50" max="50" value={stage.synth[stage.synthFocus].fine} onChange={event => editSynth({ fine: Math.max(-50, Math.min(50, Number(event.target.value))) })} /></label>
        <label>Filter <select aria-label="Synth filter type" value={stage.synth[stage.synthFocus].filterType} onChange={event => editSynth({ filterType: event.target.value as SynthLayer['filterType'] })}>{filterTypes.map(v => <option key={v}>{v}</option>)}</select></label>
        {(['cutoff','resonance','lfoRate','lfoAmount','arpRate','glide'] as const).map(field => <label key={field}>{field}<input aria-label={`Synth ${field}`} type="range" min="0" max="100" value={Math.round(stage.synth[stage.synthFocus][field] * 100)} onChange={event => editSynth({ [field]: Number(event.target.value) / 100 })} /></label>)}
        <label>Tracking <select aria-label="Synth tracking" value={stage.synth[stage.synthFocus].tracking} onChange={event => editSynth({ tracking: Number(event.target.value) as SynthLayer['tracking'] })}>{[0,1,2,3].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        <label>Drive <select aria-label="Synth drive" value={stage.synth[stage.synthFocus].drive} onChange={event => editSynth({ drive: Number(event.target.value) as SynthLayer['drive'] })}>{[0,1,2,3].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        {(['oscEnv','filterEnv','ampEnv'] as const).map(env => <span key={env}>{(['attack','decay','release','amount'] as const).map(field => <label key={field}>{env} {field}<input aria-label={`${env} ${field}`} type="range" min="0" max="100" value={Math.round(stage.synth[stage.synthFocus][env][field] * 100)} onChange={event => editSynth({ [env]: { ...stage.synth[stage.synthFocus][env], [field]: Number(event.target.value) / 100 } })} /></label>)}<button type="button" aria-label={`${env} velocity`} aria-pressed={stage.synth[stage.synthFocus][env].velocity} onClick={() => editSynth({ [env]: { ...stage.synth[stage.synthFocus][env], velocity: !stage.synth[stage.synthFocus][env].velocity } })}>Velocity</button></span>)}
        <button type="button" aria-label="Osc envelope to pitch" aria-pressed={stage.synth[stage.synthFocus].oscEnvToPitch} onClick={() => editSynth({ oscEnvToPitch: !stage.synth[stage.synthFocus].oscEnvToPitch })}>Osc Env To Pitch</button>
        <label>LFO waveform <select aria-label="Synth LFO waveform" value={stage.synth[stage.synthFocus].lfoWave} onChange={event => editSynth({ lfoWave: event.target.value as SynthLayer['lfoWave'] })}>{lfoWaves.map(v => <option key={v}>{v}</option>)}</select></label>
        <label>LFO target <select aria-label="Synth LFO target" value={stage.synth[stage.synthFocus].lfoTarget} onChange={event => editSynth({ lfoTarget: event.target.value as SynthLayer['lfoTarget'] })}>{['Off','Osc Pitch','Osc Ctrl','Filter Freq'].map(v => <option key={v}>{v}</option>)}</select></label>
        <button type="button" aria-label="Synth LFO sync" aria-pressed={stage.synth[stage.synthFocus].lfoSync} onClick={() => editSynth({ lfoSync: !stage.synth[stage.synthFocus].lfoSync })}>LFO Sync</button>
        <label>Voice mode <select aria-label="Synth voice mode" value={stage.synth[stage.synthFocus].voiceMode} onChange={event => editSynth({ voiceMode: event.target.value as SynthLayer['voiceMode'] })}>{['Poly','Mono','Legato'].map(v => <option key={v}>{v}</option>)}</select></label>
        <label>Priority <select aria-label="Synth priority" value={stage.synth[stage.synthFocus].priority} onChange={event => editSynth({ priority: event.target.value as SynthLayer['priority'] })}>{['Off','Low','High'].map(v => <option key={v}>{v}</option>)}</select></label>
        <label>Vibrato <select aria-label="Synth vibrato" value={stage.synth[stage.synthFocus].vibrato} onChange={event => editSynth({ vibrato: event.target.value as SynthLayer['vibrato'] })}>{['Off','On','Wheel'].map(v => <option key={v}>{v}</option>)}</select></label>
        <label>Vibrato rate <input aria-label="Synth vibrato rate" type="range" min="20" max="80" value={Math.round(stage.synth[stage.synthFocus].vibratoRate * 10)} onChange={event => editSynth({ vibratoRate: Number(event.target.value) / 10 })} /></label><label>Vibrato amount <input aria-label="Synth vibrato amount" type="range" min="0" max="100" value={Math.round(stage.synth[stage.synthFocus].vibratoAmount * 100)} onChange={event => editSynth({ vibratoAmount: Number(event.target.value) / 100 })} /></label>
        <label>Unison <select aria-label="Synth unison" value={stage.synth[stage.synthFocus].unison} onChange={event => editSynth({ unison: Number(event.target.value) as SynthLayer['unison'] })}>{[0,1,2,3].map(v => <option key={v}>{v}</option>)}</select></label>
        <button type="button" aria-label="Synth arp run" aria-pressed={stage.synth[stage.synthFocus].arpRun} onClick={() => editSynth({ arpRun: !stage.synth[stage.synthFocus].arpRun })}>Arp Run</button>
        <label>Arp mode <select aria-label="Synth arp mode" value={stage.synth[stage.synthFocus].arpMode} onChange={event => editSynth({ arpMode: event.target.value as SynthLayer['arpMode'] })}>{['Arp','Poly','Gate'].map(v => <option key={v}>{v}</option>)}</select></label>
        <label>Arp range <select aria-label="Synth arp range" value={stage.synth[stage.synthFocus].arpRange} onChange={event => editSynth({ arpRange: Number(event.target.value) as SynthLayer['arpRange'] })}>{[1,2,3,4].map(v => <option key={v}>{v}</option>)}</select></label>
        <label>Arp direction <select aria-label="Synth arp direction" value={stage.synth[stage.synthFocus].arpDirection} onChange={event => editSynth({ arpDirection: event.target.value as SynthLayer['arpDirection'] })}>{['Up','Down','Up/Down','Random'].map(v => <option key={v}>{v}</option>)}</select></label>
        <button type="button" aria-label="Synth arp hold" aria-pressed={stage.synth[stage.synthFocus].arpHold} onClick={() => editSynth({ arpHold: !stage.synth[stage.synthFocus].arpHold })}>Hold</button><button type="button" aria-label="Synth arp sync" aria-pressed={stage.synth[stage.synthFocus].arpSync} onClick={() => editSynth({ arpSync: !stage.synth[stage.synthFocus].arpSync })}>Arp Sync</button>
      </div>
      <div className="settings-group system-settings" aria-label="Unsupported controls"><strong>UNSUPPORTED</strong><span>{unsupported.join(' · ')}</span></div>
    </div>
  </main>
}
