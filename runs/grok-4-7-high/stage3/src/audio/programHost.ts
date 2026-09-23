import type { AudioContextLike, TimerBoundary } from './boundaries'
import type { InstrumentGraph } from './graph'
import { OrganPlayer, type OrganMix } from './organ'
import {
  MORPH_DESTINATIONS,
  ProgramBank,
  SPLIT_NAMES,
  SPLIT_POSITIONS,
  bpmFromTaps,
  cloneDoc,
  clockHz,
  defaultOrganLayer,
  defaultSynthLayer,
  emptyEnables,
  fullZone,
  layerZoneGain,
  morphMix,
  signature,
  type Enables,
  type FxDocument,
  type OrganLayerDocument,
  type PianoLayerDocument,
  type ProgramDocument,
  type SplitName,
  type SplitPoint,
  type StorageLike,
  type SynthLayerDocument,
  type ZoneRange,
} from './performance'
import { WAVEFORMS, SynthPlayer, type SynthLayerId, type SynthMix } from './synth'
import { AMP_TYPES, DELAY_FILTERS, MOD1_TYPES, MOD2_TYPES, REVERB_TYPES, type LayerId } from './labels'

export interface PianoPart {
  sectionOn: boolean
  focus: 'A' | 'B'
  kbTouch: number
  dynComp: number
  effectsOn: boolean
  pianoGroup: boolean
  manualFocus: 'organ' | 'piano' | 'synth'
  layers: { A: PianoLayerDocument; B: PianoLayerDocument }
  fx: { A: FxDocument; B: FxDocument; organ: FxDocument; synthA: FxDocument; synthB: FxDocument; synthC: FxDocument }
  pitch: number
  sustainDown: boolean
}

export interface HostHooks {
  capturePiano(): PianoPart
  applyPiano(part: PianoPart): void
  now(): number
  context(): AudioContextLike | null
  graph(): InstrumentGraph | null
  timers(): TimerBoundary
  emit(): void
  allNotesOff(): void
}

const ORGAN_LAYER = { A: 'organA', B: 'organB' } as const
const SYNTH_LAYER = { A: 'synthA', B: 'synthB', C: 'synthC' } as const

function defaultDocument(piano: PianoPart): ProgramDocument {
  const enables = emptyEnables()
  enables.pianoA = piano.layers.A.enabled
  enables.pianoB = piano.layers.B.enabled
  return {
    name: 'Grand Piano',
    piano: {
      sectionOn: piano.sectionOn,
      focus: piano.focus,
      kbTouch: piano.kbTouch,
      dynComp: piano.dynComp,
      effectsOn: piano.effectsOn,
      pianoGroup: piano.pianoGroup,
      layers: { A: cloneDoc(piano.layers.A), B: cloneDoc(piano.layers.B) },
      fx: { A: cloneDoc(piano.fx.A), B: cloneDoc(piano.fx.B) },
      zones: { A: fullZone(), B: fullZone() },
    },
    organ: {
      sectionOn: false,
      focus: 'A',
      vibIndex: 0,
      vibOn: { A: false, B: false },
      percOn: false,
      percSoft: false,
      percFast: false,
      percThird: false,
      rotarySource: false,
      effectsOn: false,
      layers: { A: defaultOrganLayer(), B: defaultOrganLayer() },
      fx: cloneDoc(piano.fx.organ),
    },
    synth: {
      sectionOn: false,
      focus: 'A',
      dialTarget: 'amp',
      layers: { A: defaultSynthLayer(), B: defaultSynthLayer(), C: defaultSynthLayer() },
      fx: { A: cloneDoc(piano.fx.synthA), B: cloneDoc(piano.fx.synthB), C: cloneDoc(piano.fx.synthC) },
    },
    split: { points: [{ enabled: false, position: 2, crossfade: 0 }, { enabled: false, position: 4, crossfade: 0 }, { enabled: false, position: 8, crossfade: 0 }] },
    scenes: { active: 'I', I: enables, II: cloneDoc(enables) },
    morph: { wheel: [], pedal: [] },
    clockBpm: 120,
    clockSync: { arp: true, lfo: true, delay: false, mod1: false },
    transpose: 0,
    transposeOn: false,
    manualFocus: piano.manualFocus,
  }
}

/**
 * Programs, splits, scenes, morphs, organ, and synth.
 * Piano remains on the engine; this host round-trips it through the same document.
 */
export class ProgramController {
  private bank: ProgramBank
  private doc: ProgramDocument
  private organPlayer: OrganPlayer | null = null
  private synthPlayer: SynthPlayer | null = null
  private modWheel = 0
  private controlPedal = 0
  private pitch = 0
  private sustainDown = false
  private morphHold: 'wheel' | 'pedal' | null = null
  private morphLatched: 'wheel' | 'pedal' | null = null
  private clockTaps: number[] = []
  private rotaryAmount = 0
  private rotaryStop = false
  private rotaryDrive = 64
  /** All FX Off forces every chain, including the organ rotary send, to dry. */
  private bypassAll = false
  private origin: { space: 'program' | 'live'; index: number } | null = null
  private view: Record<string, unknown> | null = null

  constructor(
    private readonly hooks: HostHooks,
    storage: StorageLike | null,
  ) {
    const initial = defaultDocument(hooks.capturePiano())
    this.doc = initial
    this.bank = new ProgramBank(initial, storage)
    this.doc = cloneDoc(this.bank.current())
    this.bank.clean = signature(this.doc)
  }

  private invalidate() {
    this.view = null
    this.hooks.emit()
  }

  snapshot(): Record<string, unknown> {
    if (this.view) return this.view
    const index = this.bank.index
    this.view = {
      label: this.bank.label(),
      name: this.doc.name,
      dirty: this.isDirty(),
      live: this.bank.space === 'live',
      index,
      page: Math.floor(index / 8),
      button: index % 8,
      listOpen: this.bank.listOpen,
      storeMode: this.bank.mode,
      nameDraft: this.bank.nameDraft,
      names: this.bank.programs.map((program) => program.name),
      liveNames: this.bank.live.map((program) => program.name),
      scene: this.doc.scenes.active,
      split: this.doc.split.points.map((point) => (point.enabled ? SPLIT_POSITIONS[point.position]!.midi : 0)),
      tempo: this.doc.clockBpm,
      transpose: this.doc.transposeOn ? this.doc.transpose : 0,
      waveform: WAVEFORMS[this.focusedSynth().waveform]?.name ?? 'Saw',
      waveformCategory: WAVEFORMS[this.focusedSynth().waveform]?.category ?? 'Pure',
      samples: this.focusedSynth().samples,
      organModel: this.doc.organ.layers[this.doc.organ.focus].model,
      morphWheel: this.doc.morph.wheel.map((item) => item.id),
      morphPedal: this.doc.morph.pedal.map((item) => item.id),
      pedal: this.controlPedal,
      splitEdit: SPLIT_NAMES[this.bank.splitEdit],
    }
    return this.view
  }

  isDirty(): boolean {
    if (this.bank.space === 'live') return false
    this.capture()
    return signature(this.doc) !== this.bank.clean
  }

  capture(): ProgramDocument {
    const piano = this.hooks.capturePiano()
    this.doc.piano.sectionOn = piano.sectionOn
    this.doc.piano.focus = piano.focus
    this.doc.piano.kbTouch = piano.kbTouch
    this.doc.piano.dynComp = piano.dynComp
    this.doc.piano.effectsOn = piano.effectsOn
    this.doc.piano.pianoGroup = piano.pianoGroup
    this.doc.piano.layers = { A: cloneDoc(piano.layers.A), B: cloneDoc(piano.layers.B) }
    this.doc.piano.fx = { A: cloneDoc(piano.fx.A), B: cloneDoc(piano.fx.B) }
    this.doc.organ.fx = cloneDoc(piano.fx.organ)
    this.doc.synth.fx = { A: cloneDoc(piano.fx.synthA), B: cloneDoc(piano.fx.synthB), C: cloneDoc(piano.fx.synthC) }
    this.doc.manualFocus = piano.manualFocus
    this.pitch = piano.pitch
    this.sustainDown = piano.sustainDown
    this.mirrorEnables()
    return cloneDoc(this.doc)
  }

  private mirrorEnables() {
    const scene = this.doc.scenes[this.doc.scenes.active]
    scene.pianoA = this.doc.piano.layers.A.enabled
    scene.pianoB = this.doc.piano.layers.B.enabled
    scene.organA = this.doc.scenes[this.doc.scenes.active].organA
    scene.organB = this.doc.scenes[this.doc.scenes.active].organB
  }

  private apply(doc: ProgramDocument, rememberClean: boolean) {
    this.doc = cloneDoc(doc)
    const scene = this.doc.scenes[this.doc.scenes.active]
    this.doc.piano.layers.A.enabled = scene.pianoA
    this.doc.piano.layers.B.enabled = scene.pianoB
    this.hooks.applyPiano({
      sectionOn: this.doc.piano.sectionOn,
      focus: this.doc.piano.focus,
      kbTouch: this.doc.piano.kbTouch,
      dynComp: this.doc.piano.dynComp,
      effectsOn: this.doc.piano.effectsOn,
      pianoGroup: this.doc.piano.pianoGroup,
      manualFocus: this.doc.manualFocus,
      layers: cloneDoc(this.doc.piano.layers),
      fx: {
        A: cloneDoc(this.doc.piano.fx.A),
        B: cloneDoc(this.doc.piano.fx.B),
        organ: cloneDoc(this.doc.organ.fx),
        synthA: cloneDoc(this.doc.synth.fx.A),
        synthB: cloneDoc(this.doc.synth.fx.B),
        synthC: cloneDoc(this.doc.synth.fx.C),
      },
      pitch: this.pitch,
      sustainDown: this.sustainDown,
    })
    this.hooks.allNotesOff()
    this.organPlayer?.allNotesOff()
    this.synthPlayer?.allNotesOff()
    if (rememberClean) this.bank.clean = signature(this.capture())
    this.pushAudio()
    this.invalidate()
  }

  touch() {
    const current = this.capture()
    if (this.bank.space === 'live' && this.bank.mode === 'play') {
      this.bank.live[this.bank.index] = current
      this.bank.clean = signature(current)
      this.bank.persist()
    }
    this.invalidate()
  }

  attach(ctx: AudioContextLike, graph: InstrumentGraph, timers: TimerBoundary) {
    if (this.organPlayer) return
    this.organPlayer = new OrganPlayer(ctx, graph.extraInput('organ'), timers)
    this.synthPlayer = new SynthPlayer(
      ctx,
      { A: graph.extraInput('synthA'), B: graph.extraInput('synthB'), C: graph.extraInput('synthC') },
      timers,
    )
    this.pushAudio()
  }

  dispose() {
    this.organPlayer?.dispose()
    this.synthPlayer?.dispose()
    this.organPlayer = null
    this.synthPlayer = null
  }

  pushAudio() {
    this.capture()
    const graph = this.hooks.graph()
    if (!graph) return
    const time = this.hooks.now()
    const organFx = this.doc.organ.fx
    graph.setExtraChain('organ', this.chain(organFx, this.doc.organ.effectsOn, this.doc.organ.rotarySource, 100), time)
    for (const layer of ['A', 'B', 'C'] as const) {
      const state = this.doc.synth.layers[layer]
      const id = SYNTH_LAYER[layer]
      graph.setExtraChain(id, this.chain(this.doc.synth.fx[layer], state.effectsOn, false, 100), time)
    }
    this.organPlayer?.setLevel('A', this.effectiveLevel('organ-level-a', this.doc.organ.layers.A.level))
    this.organPlayer?.setLevel('B', this.effectiveLevel('organ-level-b', this.doc.organ.layers.B.level))
    this.synthPlayer?.setLevel('A', this.effectiveLevel('synth-level-a', this.doc.synth.layers.A.level))
    this.synthPlayer?.setLevel('B', this.effectiveLevel('synth-level-b', this.doc.synth.layers.B.level))
    this.synthPlayer?.setLevel('C', this.effectiveLevel('synth-level-c', this.doc.synth.layers.C.level))
    const amount = this.effective('rotary-speed', this.rotaryAmount > 0.5 ? 127 : 0) / 127
    graph.setRotaryAmount(amount, this.rotaryStop, this.effective('rotary-drive', this.rotaryDrive), time)
  }

  private chain(fx: FxDocument, effectsOn: boolean, toRotary: boolean, level: number) {
    const delaySeconds = this.doc.clockSync.delay ? (60 / this.doc.clockBpm) * (0.5 + (fx.delay.tempo / 127) * 1.5) : undefined
    const modRate = this.doc.clockSync.mod1 ? Math.max(0, Math.min(127, ((clockHz(this.doc.clockBpm, fx.mod1Rate, [0.5, 1, 2, 4]) - 0.2) / 11) * 127)) : fx.mod1Rate
    return {
      effectsOn: this.bypassAll ? false : effectsOn,
      mod1Type: MOD1_TYPES[fx.mod1Type] ?? 'A-Pan',
      mod1Rate: modRate / 127,
      mod1Amount: fx.mod1Amount / 127,
      mod1On: fx.mod1On,
      mod2Type: MOD2_TYPES[fx.mod2Type] ?? 'Chorus',
      mod2Rate: fx.mod2Rate / 127,
      mod2Amount: fx.mod2Amount / 127,
      mod2On: fx.mod2On,
      delayTempo: fx.delay.tempo / 127,
      delayFeedback: fx.delay.feedback / 127,
      delayMix: fx.delay.mix / 127,
      delayFilter: DELAY_FILTERS[fx.delay.filter] ?? 'Off',
      delayOn: fx.delay.on,
      delaySeconds,
      ampType: AMP_TYPES[fx.ampType] ?? 'EQ',
      ampDrive: fx.ampDrive / 127,
      ampBass: fx.ampBass / 127,
      ampMid: fx.ampMid / 127,
      ampFreq: fx.ampFreq / 127,
      ampTreble: fx.ampTreble / 127,
      ampOn: fx.ampOn,
      compAmount: fx.comp.amount / 127,
      compFast: fx.comp.fast || fx.comp.amount >= 110,
      compOn: fx.comp.on,
      reverbType: REVERB_TYPES[fx.reverb.type] ?? 'Room',
      reverbMix: fx.reverb.mix / 127,
      reverbBright: fx.reverb.bright,
      reverbOn: fx.reverb.on,
      toRotary: this.bypassAll ? false : toRotary,
      level: level / 100,
    }
  }

  transposeOf(): number {
    return this.doc.transposeOn ? this.doc.transpose : 0
  }

  pianoZone(layer: LayerId, midi: number): number {
    return layerZoneGain(midi, this.doc.piano.zones[layer], this.doc.split.points)
  }

  private organMix(layer: 'A' | 'B'): OrganMix {
    return {
      sectionOn: this.doc.organ.sectionOn && this.doc.scenes[this.doc.scenes.active][ORGAN_LAYER[layer]],
      vibIndex: this.doc.organ.vibIndex,
      vibOn: this.doc.organ.vibOn[layer],
      percOn: this.doc.organ.percOn,
      percSoft: this.doc.organ.percSoft,
      percFast: this.doc.organ.percFast,
      percThird: this.doc.organ.percThird,
      transpose: this.transposeOf(),
      stick: this.pitch,
    }
  }

  private synthMix(): SynthMix {
    return {
      sectionOn: this.doc.synth.sectionOn,
      transpose: this.transposeOf(),
      stick: this.pitch,
      wheel: this.modWheel,
      bpm: this.doc.clockBpm,
      lfoSync: this.doc.clockSync.lfo,
      arpSync: this.doc.clockSync.arp,
    }
  }

  private focusedSynth(): SynthLayerDocument {
    return this.doc.synth.layers[this.doc.synth.focus]
  }

  synthFxKey(): 'synthA' | 'synthB' | 'synthC' {
    return synthFocusKey(this.doc.synth.focus)
  }

  noteOn(midi: number, velocity: number, at?: number) {
    const scene = this.doc.scenes[this.doc.scenes.active]
    for (const layer of ['A', 'B'] as const) {
      if (!scene[ORGAN_LAYER[layer]]) continue
      const gain = layerZoneGain(midi, this.doc.organ.layers[layer].zone, this.doc.split.points)
      this.organPlayer?.noteOn(layer, midi, velocity, gain, this.morphedOrgan(layer), this.organMix(layer), at)
    }
    if (!this.doc.synth.sectionOn) return
    for (const layer of ['A', 'B', 'C'] as const) {
      if (!scene[SYNTH_LAYER[layer]]) continue
      const gain = layerZoneGain(midi, this.doc.synth.layers[layer].zone, this.doc.split.points)
      this.synthPlayer?.noteOn(layer, midi, velocity, gain, this.morphedSynth(layer), this.synthMix(), at)
    }
  }

  noteOff(midi: number, at?: number) {
    for (const layer of ['A', 'B'] as const) {
      const sustained = this.sustainDown && this.doc.organ.layers[layer].sustped
      this.organPlayer?.noteOff(layer, midi, sustained, at)
    }
    for (const layer of ['A', 'B', 'C'] as const) {
      this.synthPlayer?.noteOff(layer, midi, this.sustainDown, this.doc.synth.layers[layer], this.synthMix(), at)
    }
  }

  setSustain(down: boolean) {
    this.sustainDown = down
    this.organPlayer?.setSustain(down, { A: this.doc.organ.layers.A.sustped, B: this.doc.organ.layers.B.sustped })
    this.synthPlayer?.setSustain(down, this.doc.synth.layers)
  }

  silence() {
    this.organPlayer?.allNotesOff()
    this.synthPlayer?.allNotesOff()
  }

  setPitch(value: number) {
    this.pitch = value
    this.organPlayer?.applyBend(value, { A: this.doc.organ.layers.A.pstick, B: this.doc.organ.layers.B.pstick })
    this.synthPlayer?.applyBend(value, {
      A: this.doc.synth.layers.A.pstick,
      B: this.doc.synth.layers.B.pstick,
      C: this.doc.synth.layers.C.pstick,
    })
  }

  setModWheel(value: number) {
    this.modWheel = value
    this.applyMorphSource('wheel', value)
  }

  setControlPedal(value: number) {
    this.controlPedal = Math.max(0, Math.min(127, value))
    this.applyMorphSource('pedal', this.controlPedal)
    this.invalidate()
  }

  private applyMorphSource(source: 'wheel' | 'pedal', value: number) {
    if (this.morphHold === source || this.morphLatched === source) return
    if (source === 'wheel') this.modWheel = value
    this.pushAudio()
    for (const layer of ['A', 'B', 'C'] as const) this.synthPlayer?.updateLayer(layer, this.morphedSynth(layer), this.synthMix())
    this.invalidate()
  }

  private effective(id: string, base: number): number {
    const wheel = this.doc.morph.wheel.find((item) => item.id === id)
    const pedal = this.doc.morph.pedal.find((item) => item.id === id)
    const wheeled = morphMix(this.modWheel, wheel, base)
    return morphMix(this.controlPedal, pedal, wheeled)
  }

  private effectiveLevel(id: string, base: number): number {
    return this.effective(id, base)
  }

  private morphedOrgan(layer: 'A' | 'B'): OrganLayerDocument {
    const state = cloneDoc(this.doc.organ.layers[layer])
    state.level = this.effective(`organ-level-${layer.toLowerCase()}`, state.level)
    state.drawbars = state.drawbars.map((value, index) => this.effective(`organ-drawbar-${index + 1}`, value))
    return state
  }

  private morphedSynth(layer: SynthLayerId): SynthLayerDocument {
    const state = cloneDoc(this.doc.synth.layers[layer])
    if (this.doc.synth.focus !== layer) return state
    state.level = this.effective(`synth-level-${layer.toLowerCase()}`, state.level)
    state.lfoRate = this.effective('lfo-rate', state.lfoRate)
    state.oscCtrl = this.effective('osc-ctrl', state.oscCtrl)
    state.lfoAmount = this.effective('lfo-mod-amt', state.lfoAmount)
    state.filterFreq = this.effective('filter-freq', state.filterFreq)
    state.filterRes = this.effective('filter-res', state.filterRes)
    state.arpRate = this.effective('arp-rate', state.arpRate)
    return state
  }

  organVoiceCount(): number {
    return this.organPlayer?.activeCount() ?? 0
  }

  synthVoiceCount(): number {
    return this.synthPlayer?.activeCount() ?? 0
  }

  setOrganSection(on: boolean) {
    this.doc.organ.sectionOn = on
    if (!on) this.organPlayer?.allNotesOff()
    this.touch()
  }

  pressOrganLayer(layer: 'A' | 'B') {
    const scene = this.doc.scenes[this.doc.scenes.active]
    const key = ORGAN_LAYER[layer]
    if (!scene[key]) {
      scene[key] = true
      this.doc.organ.focus = layer
    } else if (this.doc.organ.focus !== layer) this.doc.organ.focus = layer
    else {
      scene[key] = false
      this.organPlayer?.allNotesOff()
    }
    this.touch()
  }

  setOrganFocus(layer: 'A' | 'B') {
    this.doc.organ.focus = layer
    this.touch()
  }

  setOrganModel(index: number) {
    this.doc.organ.layers[this.doc.organ.focus].model = index
    this.touch()
  }

  setDrawbar(index: number, value: number) {
    const drawbars = this.doc.organ.layers[this.doc.organ.focus].drawbars
    drawbars[index] = Math.max(0, Math.min(8, value))
    this.touch()
  }

  setOrganLevel(layer: 'A' | 'B', value: number) {
    this.doc.organ.layers[layer].level = value
    this.organPlayer?.setLevel(layer, this.effectiveLevel(`organ-level-${layer.toLowerCase()}`, value))
    this.touch()
  }

  nudgeOrganOctave(direction: -1 | 1) {
    const layer = this.doc.organ.layers[this.doc.organ.focus]
    layer.octave = Math.max(-12, Math.min(12, layer.octave + direction * 12))
    this.touch()
  }

  setOrganVib(index: number) {
    this.doc.organ.vibIndex = index
    this.touch()
  }

  setOrganVibOn(on: boolean) {
    this.doc.organ.vibOn[this.doc.organ.focus] = on
    this.touch()
  }

  setPerc(partial: Partial<Pick<ProgramDocument['organ'], 'percOn' | 'percSoft' | 'percFast' | 'percThird'>>) {
    Object.assign(this.doc.organ, partial)
    this.touch()
  }

  setRotarySource(on: boolean) {
    this.doc.organ.rotarySource = on
    this.pushAudio()
    this.touch()
  }

  setRotaryPerformance(fast: boolean, stopped: boolean, drive: number) {
    this.rotaryAmount = fast ? 1 : 0
    this.rotaryStop = stopped
    this.rotaryDrive = drive
    this.pushAudio()
  }

  setOrganEffects(on: boolean) {
    if (on) this.bypassAll = false
    this.doc.organ.effectsOn = on
    this.pushAudio()
    this.touch()
  }

  /** Drop the All FX Off latch without changing the section that the caller is about to enable. */
  clearBypass() {
    if (!this.bypassAll) return
    this.bypassAll = false
    this.pushAudio()
  }

  /** Bypass piano is handled by the engine; this silences organ and synth chains and the organ rotary send. */
  setBypassAll() {
    this.bypassAll = true
    this.doc.organ.effectsOn = false
    this.doc.synth.layers.A.effectsOn = false
    this.doc.synth.layers.B.effectsOn = false
    this.doc.synth.layers.C.effectsOn = false
    this.pushAudio()
    this.touch()
  }

  setSynthSection(on: boolean) {
    this.doc.synth.sectionOn = on
    if (!on) this.synthPlayer?.allNotesOff()
    this.touch()
  }

  pressSynthLayer(layer: SynthLayerId) {
    const scene = this.doc.scenes[this.doc.scenes.active]
    const key = SYNTH_LAYER[layer]
    if (!scene[key]) {
      scene[key] = true
      this.doc.synth.focus = layer
    } else if (this.doc.synth.focus !== layer) this.doc.synth.focus = layer
    else {
      scene[key] = false
      this.synthPlayer?.allNotesOff()
    }
    this.touch()
  }

  setSynthFocus(layer: SynthLayerId) {
    this.doc.synth.focus = layer
    this.touch()
  }

  patchSynth(patch: Partial<SynthLayerDocument>) {
    Object.assign(this.focusedSynth(), patch)
    this.synthPlayer?.updateLayer(this.doc.synth.focus, this.morphedSynth(this.doc.synth.focus), this.synthMix())
    this.touch()
  }

  setSynthLevel(layer: SynthLayerId, value: number) {
    this.doc.synth.layers[layer].level = value
    this.synthPlayer?.setLevel(layer, value)
    this.touch()
  }

  nudgeSynthOctave(direction: -1 | 1) {
    const layer = this.focusedSynth()
    layer.octave = Math.max(-12, Math.min(12, layer.octave + direction * 12))
    this.touch()
  }

  setSynthEffects(on: boolean) {
    if (on) this.bypassAll = false
    this.focusedSynth().effectsOn = on
    this.pushAudio()
    this.touch()
  }

  focusSplit(which: SplitName) {
    this.bank.splitEdit = SPLIT_NAMES.indexOf(which) as 0 | 1 | 2
    this.invalidate()
  }

  setDialTarget(target: ProgramDocument['synth']['dialTarget']) {
    this.doc.synth.dialTarget = target
    this.touch()
  }

  setEnvelope(which: 'osc' | 'filter' | 'amp', partial: Partial<SynthLayerDocument['ampEnv']>) {
    const layer = this.focusedSynth()
    const env = which === 'osc' ? layer.oscEnv : which === 'filter' ? layer.filterEnv : layer.ampEnv
    Object.assign(env, partial)
    this.touch()
  }

  setSplitEnabled(on: boolean) {
    if (on) this.doc.split.points[1] = { enabled: true, position: 4, crossfade: this.doc.split.points[1].crossfade }
    else this.doc.split.points = this.doc.split.points.map((point) => ({ ...point, enabled: false })) as ProgramDocument['split']['points']
    this.touch()
  }

  setSplitPoint(which: SplitName, position: number, crossfade: 0 | 6 | 12, enabled = true) {
    const index = SPLIT_NAMES.indexOf(which)
    this.doc.split.points[index] = {
      enabled,
      position: Math.max(0, Math.min(SPLIT_POSITIONS.length - 1, position)),
      crossfade,
    }
    this.touch()
  }

  cycleSplitEdit() {
    this.bank.splitEdit = ((this.bank.splitEdit + 1) % 3) as 0 | 1 | 2
    const point = this.doc.split.points[this.bank.splitEdit]!
    point.enabled = true
    this.touch()
  }

  nudgeSplitPosition(delta: number) {
    const point = this.doc.split.points[this.bank.splitEdit]!
    point.enabled = true
    point.position = Math.max(0, Math.min(SPLIT_POSITIONS.length - 1, point.position + delta))
    this.touch()
  }

  cycleCrossfade() {
    const point = this.doc.split.points[this.bank.splitEdit]!
    point.enabled = true
    point.crossfade = point.crossfade === 0 ? 6 : point.crossfade === 6 ? 12 : 0
    this.touch()
  }

  setLayerZone(section: 'organ' | 'piano' | 'synth', layer: 'A' | 'B' | 'C', zone: ZoneRange) {
    const next = { lo: Math.max(0, Math.min(3, zone.lo)), hi: Math.max(0, Math.min(3, zone.hi)) }
    if (section === 'piano' && layer !== 'C') this.doc.piano.zones[layer] = next
    if (section === 'organ' && layer !== 'C') this.doc.organ.layers[layer].zone = next
    if (section === 'synth') this.doc.synth.layers[layer].zone = next
    this.touch()
  }

  zoneGainFor(section: 'organ' | 'piano' | 'synth', layer: 'A' | 'B' | 'C', midi: number): number {
    if (section === 'piano' && layer !== 'C') return layerZoneGain(midi, this.doc.piano.zones[layer], this.doc.split.points)
    if (section === 'organ' && layer !== 'C') return layerZoneGain(midi, this.doc.organ.layers[layer].zone, this.doc.split.points)
    if (section === 'synth') return layerZoneGain(midi, this.doc.synth.layers[layer].zone, this.doc.split.points)
    return 0
  }

  setScene(scene: 'I' | 'II') {
    this.mirrorEnables()
    this.doc.scenes.active = scene
    const enables: Enables = this.doc.scenes[scene]
    this.doc.piano.layers.A.enabled = enables.pianoA
    this.doc.piano.layers.B.enabled = enables.pianoB
    const part = this.hooks.capturePiano()
    part.layers.A.enabled = enables.pianoA
    part.layers.B.enabled = enables.pianoB
    this.hooks.applyPiano(part)
    this.hooks.allNotesOff()
    this.organPlayer?.allNotesOff()
    this.synthPlayer?.allNotesOff()
    this.touch()
  }

  getScene(): 'I' | 'II' {
    return this.doc.scenes.active
  }

  beginMorph(source: 'wheel' | 'pedal') {
    this.morphHold = source
    this.invalidate()
  }

  latchMorph(source: 'wheel' | 'pedal') {
    this.morphLatched = this.morphLatched === source ? null : source
    this.morphHold = null
    this.invalidate()
  }

  endMorph() {
    this.morphHold = null
    this.invalidate()
  }

  morphSource(): 'wheel' | 'pedal' | null {
    return this.morphLatched ?? this.morphHold
  }

  assignMorph(source: 'wheel' | 'pedal', id: string, from: number, to: number) {
    if (!MORPH_DESTINATIONS.has(id)) return
    const list = this.doc.morph[source]
    const existing = list.find((item) => item.id === id)
    if (Math.abs(to - from) < 0.5) {
      this.doc.morph[source] = list.filter((item) => item.id !== id)
    } else if (existing) existing.to = to
    else list.push({ id, from, to })
    this.touch()
  }

  clearMorph(source: 'wheel' | 'pedal') {
    this.doc.morph[source] = []
    this.touch()
  }

  morphIds(): string[] {
    return [...this.doc.morph.wheel, ...this.doc.morph.pedal].map((item) => item.id)
  }

  baseValue(id: string): number {
    if (id === 'organ-level-a') return this.doc.organ.layers.A.level
    if (id === 'organ-level-b') return this.doc.organ.layers.B.level
    if (id.startsWith('organ-drawbar-')) return this.doc.organ.layers[this.doc.organ.focus].drawbars[Number(id.slice(14)) - 1] ?? 0
    if (id === 'rotary-speed') return this.rotaryAmount > 0.5 ? 127 : 0
    if (id === 'piano-level-a') return this.doc.piano.layers.A.level
    if (id === 'piano-level-b') return this.doc.piano.layers.B.level
    if (id === 'synth-level-a') return this.doc.synth.layers.A.level
    if (id === 'synth-level-b') return this.doc.synth.layers.B.level
    if (id === 'synth-level-c') return this.doc.synth.layers.C.level
    const synth = this.focusedSynth()
    if (id === 'lfo-rate') return synth.lfoRate
    if (id === 'osc-ctrl') return synth.oscCtrl
    if (id === 'lfo-mod-amt') return synth.lfoAmount
    if (id === 'filter-freq') return synth.filterFreq
    if (id === 'filter-res') return synth.filterRes
    if (id === 'arp-rate') return synth.arpRate
    const fx = this.doc.manualFocus === 'organ' ? this.doc.organ.fx : this.doc.manualFocus === 'synth' ? this.doc.synth.fx[this.doc.synth.focus] : this.doc.piano.fx[this.doc.piano.focus]
    if (id === 'mod1-rate') return fx.mod1Rate
    if (id === 'mod1-amount') return fx.mod1Amount
    if (id === 'mod2-amount') return fx.mod2Amount
    if (id === 'delay-tempo') return fx.delay.tempo
    if (id === 'delay-feedback') return fx.delay.feedback
    if (id === 'delay-mix') return fx.delay.mix
    if (id === 'amp-freq') return fx.ampFreq
    if (id === 'amp-drive') return fx.ampDrive
    if (id === 'reverb-mix') return fx.reverb.mix
    return 0
  }

  setTempo(bpm: number) {
    this.doc.clockBpm = Math.max(30, Math.min(300, Math.round(bpm)))
    this.pushAudio()
    this.touch()
  }

  tapClock(time: number) {
    this.clockTaps.push(time)
    if (this.clockTaps.length > 6) this.clockTaps.shift()
    const bpm = bpmFromTaps(this.clockTaps)
    if (bpm) this.setTempo(bpm)
  }

  setClockSync(target: 'arp' | 'lfo' | 'delay' | 'mod1', on: boolean) {
    this.doc.clockSync[target] = on
    this.pushAudio()
    this.touch()
  }

  toggleEffectSync() {
    const on = !(this.doc.clockSync.delay && this.doc.clockSync.mod1)
    this.doc.clockSync.delay = on
    this.doc.clockSync.mod1 = on
    this.pushAudio()
    this.touch()
  }

  setTranspose(semitones: number, enabled = true) {
    this.doc.transpose = Math.max(-6, Math.min(6, Math.round(semitones)))
    this.doc.transposeOn = enabled
    this.touch()
  }

  toggleTranspose() {
    this.doc.transposeOn = !this.doc.transposeOn
    this.touch()
  }

  panic() {
    this.sustainDown = false
    this.pitch = 0
    this.modWheel = 0
    this.controlPedal = 0
    this.morphHold = null
    this.morphLatched = null
    this.hooks.allNotesOff()
    this.organPlayer?.allNotesOff()
    this.synthPlayer?.allNotesOff()
    this.invalidate()
  }

  selectProgram(index: number) {
    this.select('program', Math.max(0, Math.min(31, index)))
  }

  selectLive(index: number) {
    this.select('live', Math.max(0, Math.min(7, index)))
  }

  private select(space: 'program' | 'live', index: number) {
    if (this.bank.mode === 'dest') {
      this.bank.space = space
      this.bank.index = index
      this.apply(this.bank.current(), false)
      return
    }
    if (space === this.bank.space && index === this.bank.index && this.bank.mode === 'play') return
    if (this.bank.space !== 'live' && this.isDirty()) this.bank.undo = this.capture()
    this.bank.space = space
    this.bank.index = index
    this.apply(this.bank.current(), true)
  }

  setLiveMode(on: boolean) {
    if (on === (this.bank.space === 'live') && this.bank.mode === 'play') return
    if (this.bank.mode === 'dest') {
      this.bank.space = on ? 'live' : 'program'
      this.bank.index = Math.min(this.bank.index, on ? 7 : 31)
      this.apply(this.bank.current(), false)
      return
    }
    this.select(on ? 'live' : 'program', 0)
  }

  nudge(delta: number) {
    if (this.bank.mode === 'name') {
      this.nudgeName(delta)
      return
    }
    const count = this.bank.space === 'live' ? 8 : 32
    const next = (this.bank.index + delta + count) % count
    this.select(this.bank.space, next)
  }

  setPage(page: number) {
    const next = Math.max(0, Math.min(3, page)) * 8 + (this.bank.index % 8)
    this.select('program', next)
  }

  setListOpen(on: boolean) {
    this.bank.listOpen = on
    this.invalidate()
  }

  armStore() {
    if (this.bank.mode === 'dest') {
      this.confirmStore()
      return
    }
    if (this.bank.mode === 'name') {
      this.doc.name = this.bank.nameDraft.trim() || this.doc.name
      this.bank.mode = 'dest'
      this.bank.captured = this.capture()
      this.invalidate()
      return
    }
    this.origin = { space: this.bank.space, index: this.bank.index }
    this.bank.captured = this.capture()
    this.bank.mode = 'dest'
    this.invalidate()
  }

  armStoreAs() {
    this.origin = { space: this.bank.space, index: this.bank.index }
    this.bank.nameDraft = this.doc.name
    this.bank.nameCursor = this.bank.nameDraft.length
    this.bank.mode = 'name'
    this.invalidate()
  }

  confirmStore() {
    if (!this.bank.captured || !this.origin) {
      this.bank.mode = 'play'
      this.invalidate()
      return
    }
    const stored = cloneDoc(this.bank.captured)
    stored.name = this.bank.mode === 'name' ? this.bank.nameDraft.trim() || stored.name : stored.name
    if (this.bank.space === 'live') this.bank.live[this.bank.index] = stored
    else this.bank.programs[this.bank.index] = stored
    this.bank.persist()
    this.bank.mode = 'play'
    this.bank.captured = null
    this.origin = null
    this.apply(stored, true)
  }

  cancelStore() {
    const captured = this.bank.captured
    const origin = this.origin
    this.bank.mode = 'play'
    this.bank.captured = null
    this.origin = null
    if (captured && origin) {
      this.bank.space = origin.space
      this.bank.index = origin.index
      this.apply(captured, false)
      this.bank.clean = signature(this.bank.current())
    }
    this.invalidate()
  }

  undo() {
    if (!this.bank.undo) return
    const doc = this.bank.undo
    this.bank.undo = null
    this.apply(doc, false)
  }

  private nudgeName(delta: number) {
    const alphabet = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.'
    const chars = this.bank.nameDraft.split('')
    const cursor = Math.max(0, Math.min(chars.length, this.bank.nameCursor))
    const current = chars[cursor] ?? ' '
    const index = Math.max(0, alphabet.indexOf(current.toUpperCase()))
    const next = alphabet[(index + delta + alphabet.length) % alphabet.length]!
    if (cursor >= chars.length) chars.push(next)
    else chars[cursor] = next
    this.bank.nameDraft = chars.join('').slice(0, 16)
    this.invalidate()
  }

  nameDelete() {
    this.bank.nameDraft = this.bank.nameDraft.slice(0, -1)
    this.bank.nameCursor = this.bank.nameDraft.length
    this.invalidate()
  }

  nameInsert() {
    this.bank.nameCursor = Math.min(16, this.bank.nameCursor + 1)
    if (this.bank.nameCursor > this.bank.nameDraft.length) this.bank.nameDraft += ' '
    this.invalidate()
  }

  document(): ProgramDocument {
    return this.capture()
  }

  organLayer(layer: 'A' | 'B'): OrganLayerDocument {
    return this.doc.organ.layers[layer]
  }

  synthLayer(layer: SynthLayerId): SynthLayerDocument {
    return this.doc.synth.layers[layer]
  }

  get organ() {
    return this.doc.organ
  }

  get synth() {
    return this.doc.synth
  }

  get splitPoints(): [SplitPoint, SplitPoint, SplitPoint] {
    return this.doc.split.points
  }

  enables(): Enables {
    return this.doc.scenes[this.doc.scenes.active]
  }

  tempo(): number {
    return this.doc.clockBpm
  }

  clockSync() {
    return this.doc.clockSync
  }

  bankMode(): string {
    return this.bank.mode
  }

  programIndex(): number {
    return this.bank.index
  }

  space(): 'program' | 'live' {
    return this.bank.space
  }

  loadFactoriesForTest() {
    return this.bank.programs.map((program) => program.name)
  }
}

export function synthFocusKey(focus: SynthLayerId): 'synthA' | 'synthB' | 'synthC' {
  if (focus === 'B') return 'synthB'
  if (focus === 'C') return 'synthC'
  return 'synthA'
}
