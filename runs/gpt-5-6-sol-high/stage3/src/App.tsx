import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HardwareControlView, type ControlBinding } from './components/Controls'
import { Keyboard } from './components/Keyboard'
import { HARDWARE_SECTIONS, type HardwareControl } from './model/hardware'
import { ComputerKeyboardInput } from './piano/InputController'
import { MidiInput, type MidiAccessLike, type MidiConnectionState } from './piano/MidiInput'
import { PianoEngine, type PianoSnapshot } from './piano/PianoEngine'
import { createBrowserPianoBackend } from './piano/WebAudioBackend'
import { EffectsRack, EFFECT_TYPES, type EffectType } from './instrument/Effects'
import { LayerSystem, type EngineKind, type InstrumentLayer, type LayerId } from './instrument/LayerSystem'
import { MenuController } from './instrument/MenuController'
import { MorphMatrix, type MorphSource } from './instrument/Morph'
import { OrganEngine, createBrowserOrganBackend, type OrganModel, type OrganSnapshot } from './instrument/OrganEngine'
import { PresetLibrary, type ProgramState } from './instrument/Presets'
import { SynthEngine, createBrowserSynthBackend, type SynthSnapshot, type SynthWaveform } from './instrument/SynthEngine'
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
  const [organ] = useState(() => new OrganEngine(createBrowserOrganBackend()))
  const [synth] = useState(() => new SynthEngine(createBrowserSynthBackend()))
  const [layers] = useState(() => new LayerSystem())
  const [effects] = useState(() => {
    const rack = new EffectsRack()
    rack.add('organ-a', 'drive', 0.24); rack.add('organ-a', 'rotary', 0.7); rack.add('organ-a', 'reverb', 0.28)
    rack.add('piano-a', 'chorus', 0.18); rack.add('piano-a', 'amp-sim', 0.2); rack.add('piano-a', 'delay', 0.15); rack.add('piano-a', 'compressor', 0.32); rack.add('piano-a', 'reverb', 0.31)
    rack.add('synth-a', 'ensemble', 0.42); rack.add('synth-a', 'phaser', 0.24); rack.add('synth-a', 'flanger', 0.18); rack.add('synth-a', 'tremolo', 0.2)
    rack.add('synth-b', 'ring-mod', 0.2); rack.add('synth-b', 'spin', 0.35); rack.add('synth-b', 'pump', 0.4); rack.add('synth-b', 'space-delay', 0.48)
    rack.add('synth-c', 'flam-delay', 0.34); rack.add('synth-c', 'eq', 0.5)
    return rack
  })
  const [morphs] = useState(() => {
    const matrix = new MorphMatrix()
    matrix.assign({ source: 'wheel', target: 'synth.filter', from: 800, to: 12000, min: 20, max: 20000 })
    return matrix
  })
  const [menu] = useState(() => new MenuController(['Preset Library', 'Keyboard Split', 'Layer Routing', 'Effects', 'MIDI']))
  const [snapshot, setSnapshot] = useState<PianoSnapshot>(() => engine.snapshot())
  const [organSnapshot, setOrganSnapshot] = useState<OrganSnapshot>(() => organ.snapshot())
  const [synthSnapshot, setSynthSnapshot] = useState<SynthSnapshot>(() => synth.snapshot())
  const [layerSnapshot, setLayerSnapshot] = useState(() => layers.snapshot())
  const [menuSnapshot, setMenuSnapshot] = useState(() => menu.snapshot())
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
  const [fxFocus, setFxFocus] = useState<LayerId>('piano-a')
  const [presetIndex, setPresetIndex] = useState(0)
  const [presetRevision, setPresetRevision] = useState(0)
  const [, setFxRevision] = useState(0)
  const [modWheel, setModWheel] = useState(35)
  const [pitchStick, setPitchStick] = useState(50)
  const midiRef = useRef<MidiInput | null>(null)
  const noteRoutes = useRef(new Map<number, InstrumentLayer[]>())

  const [presetLibrary] = useState(() => {
    const library = new PresetLibrary()
    const base: ProgramState = { name: 'A:11 Grand & B3', layers: layers.snapshot(), organ: organ.snapshot(), synth: synth.snapshot(), effects: effects.snapshot(), morphs: morphs.snapshot() }
    library.save(base, 'factory-1')
    library.save({ ...structuredClone(base), name: 'B:22 Sweet Layers' }, 'factory-2')
    library.save({ ...structuredClone(base), name: 'C:07 Split Horizon' }, 'factory-3')
    return library
  })

  const selectedModel = PIANO_MODELS[pianoType][Math.min(PIANO_MODELS[pianoType].length - 1, Math.floor(modelValue / 34))]

  useEffect(() => {
    const unsubscribe = engine.subscribe(setSnapshot)
    const unsubscribeOrgan = organ.subscribe(setOrganSnapshot)
    const unsubscribeSynth = synth.subscribe(setSynthSnapshot)
    void engine.prepare()
    return () => {
      unsubscribe()
      unsubscribeOrgan()
      unsubscribeSynth()
      engine.allNotesOff()
      organ.allNotesOff()
      synth.allNotesOff()
      midiRef.current?.disconnect()
    }
  }, [engine, organ, synth])

  useEffect(() => {
    engine.setMasterVolume(pianoOn ? (masterLevel / 100) * (pianoLevel / 100) : 0)
  }, [engine, masterLevel, pianoLevel, pianoOn])

  useEffect(() => {
    engine.setReverb(reverbOn ? reverbMix / 100 : 0)
  }, [engine, reverbMix, reverbOn])

  const routeNoteOn = useCallback((midi: number, velocity: number) => {
    const routes = layers.routeNote(midi)
    noteRoutes.current.set(midi, routes)
    if (routes.some((layer) => layer.engine === 'piano')) engine.noteOn(midi, velocity)
    for (const layer of routes) {
      if (layer.engine === 'organ') organ.noteOn(layer.id, midi, Math.round(velocity * layer.level))
      if (layer.engine === 'synth') synth.noteOn(layer.id, midi, Math.round(velocity * layer.level))
    }
  }, [engine, layers, organ, synth])

  const routeNoteOff = useCallback((midi: number) => {
    const routes = noteRoutes.current.get(midi) ?? layers.routeNote(midi)
    if (routes.some((layer) => layer.engine === 'piano')) engine.noteOff(midi)
    for (const layer of routes) {
      if (layer.engine === 'organ') organ.noteOff(layer.id, midi)
      if (layer.engine === 'synth') synth.noteOff(layer.id, midi)
    }
    noteRoutes.current.delete(midi)
  }, [engine, layers, organ, synth])

  const panic = useCallback(() => {
    engine.allNotesOff(); organ.allNotesOff(); synth.allNotesOff(); noteRoutes.current.clear()
  }, [engine, organ, synth])

  useEffect(() => {
    const input = new ComputerKeyboardInput({ noteOn: routeNoteOn, noteOff: routeNoteOff })
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
      panic()
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
  }, [engine, panic, routeNoteOff, routeNoteOn])

  const updateLayer = useCallback((id: LayerId, patch: Partial<Omit<InstrumentLayer, 'id'>>) => {
    layers.updateLayer(id, patch); setLayerSnapshot(layers.snapshot())
  }, [layers])

  const focusLayer = useCallback((id: LayerId) => {
    layers.focus(id); setLayerSnapshot(layers.snapshot()); setFxFocus(id)
  }, [layers])

  const setSectionEnabled = useCallback((section: EngineKind, enabled: boolean) => {
    const sectionLayers = layers.snapshot().layers.filter((layer) => layer.engine === section)
    for (const [index, layer] of sectionLayers.entries()) layers.updateLayer(layer.id, { enabled: enabled && index === 0 })
    setLayerSnapshot(layers.snapshot())
    if (section === 'piano') setPianoOn(enabled)
    if (!enabled) panic()
  }, [layers, panic])

  const cycleFocus = useCallback((section: EngineKind) => {
    const ids = layerSnapshot.layers.filter((layer) => layer.engine === section).map((layer) => layer.id)
    const index = ids.indexOf(fxFocus)
    focusLayer(ids[(index + 1 + ids.length) % ids.length])
  }, [focusLayer, fxFocus, layerSnapshot.layers])

  const touchEffects = () => setFxRevision((revision) => revision + 1)
  const effectSlot = (index: number) => effects.chain(fxFocus)[index]
  const morphActive = (source: MorphSource) => morphs.snapshot().some((assignment) => assignment.source === source)
  const toggleMorph = (source: MorphSource, active: boolean) => {
    morphs.clear(source)
    if (active && source === 'wheel') morphs.assign({ source, target: 'synth.filter', from: 800, to: 12000, min: 20, max: 20000 })
    if (active && source === 'aftertouch') morphs.assign({ source, target: 'effects.reverb', from: 0.1, to: 0.9, min: 0, max: 1 })
    if (active && source === 'pedal') morphs.assign({ source, target: 'organ.drawbar.1', from: 2, to: 8, min: 0, max: 8 })
    setFxRevision((revision) => revision + 1)
  }

  const applyWheel = (value: number) => {
    setModWheel(value)
    const values = morphs.values('wheel', value / 100)
    if (values['synth.filter'] !== undefined) synth.setFilter({ frequency: values['synth.filter'] })
    if (values['organ.drawbar.1'] !== undefined) organ.setDrawbar(0, values['organ.drawbar.1'])
  }

  const currentProgram = (name: string): ProgramState => ({ name, layers: layers.snapshot(), organ: organ.snapshot(), synth: synth.snapshot(), effects: effects.snapshot(), morphs: morphs.snapshot() })
  const presetList = presetLibrary.list()
  void presetRevision
  const loadPreset = (index: number) => {
    if (!presetList.length) return
    const normalized = (index + presetList.length) % presetList.length
    const program = presetLibrary.load(presetList[normalized].id)
    if (!program) return
    panic(); layers.restore(program.layers); organ.restore(program.organ); synth.restore(program.synth); effects.restore(program.effects); morphs.restore(program.morphs)
    setPresetIndex(normalized); setLayerSnapshot(layers.snapshot()); setFxFocus(program.layers.focusedLayer); touchEffects()
  }

  const setSplit = (active: boolean) => {
    layers.setSplitPoints(active ? [60] : [])
    if (active) {
      layers.updateLayer('organ-a', { enabled: true, zones: [1] })
      layers.updateLayer('piano-a', { enabled: true, zones: [2] })
      layers.updateLayer('synth-a', { enabled: true, zones: [2] })
    } else for (const layer of layers.snapshot().layers) layers.updateLayer(layer.id, { zones: [1, 2, 3, 4] })
    setLayerSnapshot(layers.snapshot())
  }

  const toggleMenu = () => {
    if (menu.snapshot().open) {
      const target = menu.close(); setMenuSnapshot(menu.snapshot())
      if (target) requestAnimationFrame(() => document.getElementById(target)?.focus())
    } else { menu.open('program-menu'); setMenuSnapshot(menu.snapshot()) }
  }

  const getBinding = (control: HardwareControl): ControlBinding => {
    const typeButton = PIANO_TYPES.find((type) => control.id === `piano-type-${type.toLowerCase()}`)
    if (typeButton) return { active: pianoType === typeButton, onActiveChange: () => setPianoType(typeButton) }
    const timbreName = ['Soft', 'Mid', 'Bright'].find((name) => control.id === `piano-timbre-${name.toLowerCase()}`)
    if (timbreName) return { active: timbre === timbreName, onActiveChange: () => setTimbre(timbreName) }
    const drawbar = /^organ-drawbar-(\d)$/.exec(control.id)
    if (drawbar) { const index = Number(drawbar[1]) - 1; return { value: organSnapshot.drawbars[index] * 12.5, onValueChange: (value) => organ.setDrawbar(index, value / 12.5) } }
    const organModel = ({ 'organ-model-b3': 'b3', 'organ-model-vox': 'vox', 'organ-model-farf': 'farf', 'organ-model-pipe': 'pipe1' } as Record<string, OrganModel>)[control.id]
    if (organModel) return { active: organSnapshot.model === organModel, onActiveChange: () => organ.setModel(organModel) }
    const focusId = control.id.replace('layer', '').replace(/^(organ|piano|synth)-/, '$1-') as LayerId
    if (/^(organ|piano|synth)-layer-[abc]$/.test(control.id)) {
      const [, section, letter] = /^(organ|piano|synth)-layer-([abc])$/.exec(control.id)!
      const id = `${section}-${letter}` as LayerId
      return { active: layerSnapshot.focusedLayer === id, onActiveChange: () => focusLayer(id) }
    }
    void focusId
    switch (control.id) {
      case 'piano-display': return { displayLines: [pianoType.toUpperCase(), selectedModel, `${timbre} · Dyn ${Math.round(dynamicCompression / 25)}`] }
      case 'organ-display': return { displayLines: [organSnapshot.model.toUpperCase(), `DB ${organSnapshot.drawbars.join('')}`, `${organSnapshot.percussion.enabled ? 'PERC' : 'CLEAN'} · ROT ${organSnapshot.rotary.toUpperCase()}`] }
      case 'synth-display': return { displayLines: [synthSnapshot.parameters.oscillator.waveform.toUpperCase(), `${Math.round(synthSnapshot.parameters.filter.frequency)} HZ`, `A ${synthSnapshot.parameters.envelope.attack.toFixed(1)} · R ${synthSnapshot.parameters.envelope.release.toFixed(1)}`] }
      case 'program-display': return { displayLines: menuSnapshot.open ? ['MENU', menuSnapshot.page.toUpperCase(), menuSnapshot.editing ? `VALUE ${menuSnapshot.draft}` : 'DIAL TO EDIT'] : [`${presetIndex + 1}:${String(presetList.length).padStart(2, '0')}`, presetList[presetIndex]?.name ?? 'Init Program', layerSnapshot.splitPoints.length ? `SPLIT C4 · ${layerSnapshot.focusedLayer.toUpperCase()}` : layerSnapshot.focusedLayer.toUpperCase()] }
      case 'effects-display': return { displayLines: ['FX FOCUS', fxFocus.toUpperCase(), effects.chain(fxFocus).slice(0, 2).map((slot) => slot.type.toUpperCase()).join(' · ') || 'BYPASS'] }
      case 'perf-pitch-stick': return { value: pitchStick, onValueChange: setPitchStick }
      case 'perf-mod-wheel': return { value: modWheel, onValueChange: applyWheel }
      case 'perf-master-level': return { value: masterLevel, onValueChange: setMasterLevel }
      case 'piano-level-a': return { value: pianoLevel, onValueChange: setPianoLevel }
      case 'piano-level-b': return { value: layers.getLayer('piano-b').level * 100, onValueChange: (value) => updateLayer('piano-b', { level: value / 100 }) }
      case 'piano-model': return { value: modelValue, onValueChange: setModelValue }
      case 'piano-dynamic-compression': return { value: dynamicCompression, onValueChange: setDynamicCompression }
      case 'perf-organ-enable': return { active: layerSnapshot.layers.some((layer) => layer.engine === 'organ' && layer.enabled), onActiveChange: (active) => setSectionEnabled('organ', active) }
      case 'perf-piano-enable': return { active: pianoOn, onActiveChange: (active) => setSectionEnabled('piano', active) }
      case 'perf-synth-enable': return { active: layerSnapshot.layers.some((layer) => layer.engine === 'synth' && layer.enabled), onActiveChange: (active) => setSectionEnabled('synth', active) }
      case 'organ-percussion': return { active: organSnapshot.percussion.enabled, onActiveChange: (enabled) => organ.setPercussion({ enabled }) }
      case 'organ-soft': return { active: organSnapshot.percussion.soft, onActiveChange: (soft) => organ.setPercussion({ soft }) }
      case 'organ-fast': return { active: organSnapshot.percussion.fast, onActiveChange: (fast) => organ.setPercussion({ fast }) }
      case 'organ-rotary-stop': return { active: organSnapshot.rotary === 'stop', onActiveChange: (active) => organ.setRotary(active ? 'stop' : 'slow') }
      case 'organ-rotary-speed': return { active: organSnapshot.rotary === 'fast', onActiveChange: (active) => organ.setRotary(active ? 'fast' : 'slow') }
      case 'organ-drive': return { value: organSnapshot.drive * 100, onValueChange: (value) => organ.setDrive(value / 100) }
      case 'synth-level-a': return { value: layers.getLayer('synth-a').level * 100, onValueChange: (value) => updateLayer('synth-a', { level: value / 100 }) }
      case 'synth-level-b': return { value: layers.getLayer('synth-b').level * 100, onValueChange: (value) => updateLayer('synth-b', { level: value / 100 }) }
      case 'synth-level-c': return { value: layers.getLayer('synth-c').level * 100, onValueChange: (value) => updateLayer('synth-c', { level: value / 100 }) }
      case 'synth-waveform': return { value: ['sine', 'triangle', 'sawtooth', 'square'].indexOf(synthSnapshot.parameters.oscillator.waveform) * 33, onValueChange: (value) => synth.setOscillator({ waveform: ['sine', 'triangle', 'sawtooth', 'square'][Math.min(3, Math.floor(value / 25))] as SynthWaveform }) }
      case 'synth-shape': return { value: synthSnapshot.parameters.oscillator.shape * 100, onValueChange: (value) => synth.setOscillator({ shape: value / 100 }) }
      case 'synth-pitch': return { value: (synthSnapshot.parameters.oscillator.detune + 100) / 2, onValueChange: (value) => synth.setOscillator({ detune: value * 2 - 100 }) }
      case 'synth-filter-frequency': return { value: Math.log(synthSnapshot.parameters.filter.frequency / 20) / Math.log(1000) * 100, onValueChange: (value) => synth.setFilter({ frequency: 20 * 1000 ** (value / 100) }) }
      case 'synth-filter-resonance': return { value: synthSnapshot.parameters.filter.resonance * 100, onValueChange: (value) => synth.setFilter({ resonance: value / 100 }) }
      case 'synth-filter-drive': return { value: synthSnapshot.parameters.filter.drive * 100, onValueChange: (value) => synth.setFilter({ drive: value / 100 }) }
      case 'synth-env-attack': return { value: synthSnapshot.parameters.envelope.attack * 10, onValueChange: (value) => synth.setEnvelope({ attack: value / 10 }) }
      case 'synth-env-decay': return { value: synthSnapshot.parameters.envelope.decay * 10, onValueChange: (value) => synth.setEnvelope({ decay: value / 10 }) }
      case 'synth-env-release': return { value: synthSnapshot.parameters.envelope.release * 10, onValueChange: (value) => synth.setEnvelope({ release: value / 10 }) }
      case 'synth-lfo-rate': return { value: synthSnapshot.parameters.modulation.lfoRate * 5, onValueChange: (value) => synth.setModulation({ lfoRate: Math.max(0.01, value / 5) }) }
      case 'synth-lfo-amount': return { value: synthSnapshot.parameters.modulation.lfoAmount * 100, onValueChange: (value) => synth.setModulation({ lfoAmount: value / 100 }) }
      case 'program-dial': return { value: presetList.length <= 1 ? 0 : presetIndex / (presetList.length - 1) * 100, onValueChange: (value) => { if (menuSnapshot.open) { menu.setDraft(Math.round(value)); setMenuSnapshot(menu.snapshot()) } else setPresetIndex(Math.min(presetList.length - 1, Math.round(value / 100 * (presetList.length - 1)))) } }
      case 'program-up': return { onActiveChange: () => loadPreset(presetIndex + 1) }
      case 'program-down': return { onActiveChange: () => loadPreset(presetIndex - 1) }
      case 'program-page': return { active: menuSnapshot.open, onActiveChange: () => { if (!menuSnapshot.open) menu.open('program-page'); else menu.next(); setMenuSnapshot(menu.snapshot()) } }
      case 'program-menu': return { active: menuSnapshot.open, onActiveChange: toggleMenu }
      case 'program-shift': return { onActiveChange: () => { if (menuSnapshot.editing) menu.cancel(); else menu.close(); setMenuSnapshot(menu.snapshot()) } }
      case 'program-store': return { onActiveChange: () => { const id = presetLibrary.save(currentProgram(`User ${presetLibrary.list().length + 1}`)); setPresetRevision((revision) => revision + 1); setPresetIndex(presetLibrary.list().findIndex((preset) => preset.id === id)) } }
      case 'program-split': return { active: layerSnapshot.splitPoints.length > 0, onActiveChange: setSplit }
      case 'program-morph-wheel': return { active: morphActive('wheel'), onActiveChange: (active) => toggleMorph('wheel', active) }
      case 'program-morph-aftertouch': return { active: morphActive('aftertouch'), onActiveChange: (active) => toggleMorph('aftertouch', active) }
      case 'program-morph-pedal': return { active: morphActive('pedal'), onActiveChange: (active) => toggleMorph('pedal', active) }
      case 'effects-layer-organ': return { active: fxFocus.startsWith('organ'), onActiveChange: () => cycleFocus('organ') }
      case 'effects-layer-piano': return { active: fxFocus.startsWith('piano'), onActiveChange: () => cycleFocus('piano') }
      case 'effects-layer-synth': return { active: fxFocus.startsWith('synth'), onActiveChange: () => cycleFocus('synth') }
      case 'effects-1-type': return { value: Math.max(0, EFFECT_TYPES.indexOf(effectSlot(0)?.type ?? 'chorus')) / (EFFECT_TYPES.length - 1) * 100, onValueChange: (value) => { effects.setType(fxFocus, 0, EFFECT_TYPES[Math.round(value / 100 * (EFFECT_TYPES.length - 1))] as EffectType); touchEffects() } }
      case 'effects-2-type': return { value: Math.max(0, EFFECT_TYPES.indexOf(effectSlot(1)?.type ?? 'delay')) / (EFFECT_TYPES.length - 1) * 100, onValueChange: (value) => { effects.setType(fxFocus, 1, EFFECT_TYPES[Math.round(value / 100 * (EFFECT_TYPES.length - 1))] as EffectType); touchEffects() } }
      case 'effects-1-amount': return { value: (effectSlot(0)?.mix ?? 0) * 100, onValueChange: (value) => { effects.setMix(fxFocus, 0, value / 100); touchEffects() } }
      case 'effects-2-amount': return { value: (effectSlot(1)?.mix ?? 0) * 100, onValueChange: (value) => { effects.setMix(fxFocus, 1, value / 100); touchEffects() } }
      case 'effects-1-on': return { active: !(effectSlot(0)?.bypassed ?? true), onActiveChange: (active) => { effects.setBypass(fxFocus, 0, !active); touchEffects() } }
      case 'effects-2-on': return { active: !(effectSlot(1)?.bypassed ?? true), onActiveChange: (active) => { effects.setBypass(fxFocus, 1, !active); touchEffects() } }
      case 'effects-reverb-mix': return { value: reverbMix, onValueChange: setReverbMix }
      case 'effects-reverb-on': return { active: reverbOn, onActiveChange: setReverbOn }
      default: return {}
    }
  }

  const connectMidi = async () => {
    if (midiRef.current) midiRef.current.disconnect()
    const navigatorWithMidi = navigator as Navigator & { requestMIDIAccess?: () => Promise<MidiAccessLike> }
    const request: (() => Promise<MidiAccessLike>) | null = navigatorWithMidi.requestMIDIAccess
      ? async () => navigatorWithMidi.requestMIDIAccess!() as unknown as MidiAccessLike
      : null
    midiRef.current = new MidiInput(request, {
      noteOn: routeNoteOn,
      noteOff: routeNoteOff,
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
          <Keyboard activeNotes={new Set([...snapshot.activeNotes, ...snapshot.sustainedNotes, ...organSnapshot.activeNotes.map((note) => note.midi), ...synthSnapshot.activeNotes.map((note) => note.midi)])} onNoteOn={routeNoteOn} onNoteOff={routeNoteOff} />
          <div className="right-cheek" aria-hidden="true" />
        </div>
        <div className="bottom-rail" aria-hidden="true" />
      </div>
      <div className="performance-status" role="status" aria-live="polite">
        <span className="status-light" data-active={snapshot.voiceCount > 0} aria-hidden="true" />
        <span>{selectedModel} · {snapshot.voiceCount} {snapshot.voiceCount === 1 ? 'voice' : 'voices'} · Organ {organSnapshot.model.toUpperCase()} · Synth {synthSnapshot.parameters.oscillator.waveform} · {layerSnapshot.splitPoints.length ? 'split C4' : 'full keyboard'}</span>
        <button type="button" className="status-action" onClick={() => engine.setSustain(!snapshot.sustain)} aria-pressed={snapshot.sustain}>Sustain {snapshot.sustain ? 'on' : 'off'}</button>
        <button type="button" className="status-action" onClick={() => void connectMidi()}>MIDI: {midiState}</button>
        <button type="button" className="status-action" onClick={panic}>Panic</button>
      </div>
      <p className="key-hint">Play with pointer or keys A–' · hold Space for sustain</p>
    </main>
  )
}
