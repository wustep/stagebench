export type PianoType = 'Grand' | 'Upright' | 'Electric' | 'Clav' | 'Digital' | 'Misc'
export type LayerName = 'A' | 'B'
export type SectionName = 'piano' | 'organ' | 'synth'
export type EffectUnitName = 'mod1' | 'mod2' | 'delay' | 'ampEq' | 'compressor' | 'reverb'
export type OrganModel = 'B3' | 'Vox' | 'Farf' | 'Pipe 1'
export type SynthWaveform = 'Sine' | 'Triangle' | 'Saw' | 'Square' | 'Pulse 33' | 'Pulse 10' | 'White Noise' | 'Sync Saw' | 'Sync Square' | 'Multi Saw' | 'Multi Saw 8ve' | 'Super Saw' | 'Super Square' | 'FM 2-op (algorithm A)'
export type SynthCategory = 'Pure' | 'Sync' | 'Multi' | 'Super' | 'FM-H'
export type FilterType = 'LP12' | 'LP24' | 'HP' | 'BP'

export type LayerSettings = {
  enabled: boolean
  focus: boolean
  level: number
  octave: -1 | 0 | 1
  sustainPed: boolean
  pitchStick: boolean
  zoneStart: number
  zoneEnd: number
}

export type EffectSettings = {
  on: boolean
  type?: string
  amount: number
  rate: number
  dryWet: number
  feedback: number
  bright: number
  drive: number
  global: boolean
  fast: boolean
  toRotary?: boolean
}

export type OrganLayer = LayerSettings & {
  model: OrganModel
  drawbars: number[]
  percussion: boolean
  percussionSoft: boolean
  percussionFast: boolean
  percussionThird: boolean
  keyClick: boolean
  vibrato: 'Off' | 'C1' | 'C2' | 'C3' | 'V1' | 'V2' | 'V3'
  rotary: boolean
}

export type SynthLayer = LayerSettings & {
  category: SynthCategory
  waveform: SynthWaveform
  oscCtrl: number
  filter: FilterType
  filterFreq: number
  resonance: number
  filterDrive: number
  filterTracking: 'Off' | '1/3' | '2/3' | '1'
  oscAttack: number
  oscDecay: number
  oscRelease: number
  filterAttack: number
  filterDecay: number
  filterRelease: number
  ampAttack: number
  ampDecay: number
  ampSustain: number
  ampRelease: number
  velocityToFilter: boolean
  velocityToAmp: 0 | 1 | 2 | 3
  lfoWave: 'Triangle' | 'Saw down' | 'Saw up' | 'Square' | 'Sample & Hold'
  lfoDestination: 'Off' | 'Osc Pitch' | 'Osc Ctrl' | 'Filter Freq'
  lfoRate: number
  lfoAmount: number
  voiceMode: 'Poly' | 'Mono' | 'Legato'
  priority: 'Off' | 'Low' | 'High'
  glide: number
  unison: 0 | 1 | 2 | 3
  vibrato: 'Off' | 'On' | 'Wheel'
  arpMode: 'Arp' | 'Poly' | 'Gate'
  arpRate: number
  arpRange: 1 | 2 | 3 | 4
  arpDirection: 'Up' | 'Down' | 'Up/Down' | 'Random'
  arpHold: boolean
  arpRun: boolean
}

export type MorphDestination = { path: string; start: number; end: number }
export type ProgramState = Omit<EngineState, 'programs' | 'livePrograms' | 'dirty' | 'selectedProgram' | 'storeMode' | 'storeName' | 'liveMode' | 'activeScene' | 'morphSources' | 'morphValues' | 'clock' | 'transpose'>
export type ProgramSlot = { name: string; state: ProgramState }
export type EngineState = {
  sectionOn: boolean
  type: PianoType
  kbTouch: 'Heavy' | 'Medium' | 'Light'
  dynComp: 0 | 1 | 2 | 3
  timbre: number
  unison: 0 | 1 | 2 | 3
  softRelease: boolean
  stringRes: boolean
  masterLevel: number
  pianoGroup: boolean
  effectsBypass: boolean
  rotaryOn: boolean
  rotaryDrive: number
  layers: Record<LayerName, LayerSettings>
  effects: Record<LayerName, Record<EffectUnitName, EffectSettings>>
  organOn: boolean
  organLayers: Record<LayerName, OrganLayer>
  synthOn: boolean
  synthLayers: Record<'A' | 'B' | 'C', SynthLayer>
  programs: ProgramSlot[]
  livePrograms: ProgramSlot[]
  selectedProgram: number
  liveMode: boolean
  dirty: boolean
  storeMode: 'idle' | 'store' | 'store-as'
  storeName: string
  activeScene: 'I' | 'II'
  scenes: { I: { piano: boolean[]; organ: boolean[]; synth: boolean[] }; II: { piano: boolean[]; organ: boolean[]; synth: boolean[] } }
  morphSources: { wheel: MorphDestination[]; pedal: MorphDestination[] }
  morphValues: { wheel: number; pedal: number }
  clock: { bpm: number; tapTimes: number[]; sync: boolean }
  transpose: number
  split: { enabled: boolean; points: [number, number, number]; crossfade: 0 | 6 | 12; zones: number[] }
}

const makeEffect = (overrides: Partial<EffectSettings> = {}): EffectSettings => ({ on: false, amount: 0.35, rate: 0.3, dryWet: 0.35, feedback: 0.25, bright: 0.5, drive: 0.2, global: false, fast: false, ...overrides })
export const MOD1_TYPES = ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump'] as const
export const MOD2_TYPES = ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin'] as const
export const AMP_TYPES = ['EQ only', 'Twin', 'JC', 'Small', 'LP24 Filter', 'HP24 Filter', 'To Rotary'] as const
export const REVERB_TYPES = ['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral'] as const
export const ORGAN_MODELS: OrganModel[] = ['B3', 'Vox', 'Farf', 'Pipe 1']
export const SYNTH_CATEGORIES: SynthCategory[] = ['Pure', 'Sync', 'Multi', 'Super', 'FM-H']
export const WAVEFORMS: Record<SynthCategory, SynthWaveform[]> = {
  Pure: ['Sine', 'Triangle', 'Saw', 'Square', 'Pulse 33', 'Pulse 10', 'White Noise'],
  Sync: ['Sync Saw', 'Sync Square'], Multi: ['Multi Saw', 'Multi Saw 8ve'], Super: ['Super Saw', 'Super Square'], 'FM-H': ['FM 2-op (algorithm A)'],
}
export const SPLIT_POSITIONS = [40, 45, 48, 53, 60, 65, 72, 77, 84, 89, 96]

const defaultLayer = (enabled: boolean, focus: boolean): LayerSettings => ({ enabled, focus, level: enabled ? 0.8 : 0.55, octave: 0, sustainPed: true, pitchStick: false, zoneStart: 0, zoneEnd: 3 })
const defaultOrgan = (enabled: boolean, focus: boolean, model: OrganModel): OrganLayer => ({ ...defaultLayer(enabled, focus), model, drawbars: [0.8, 0.4, 0.7, 0.55, 0.2, 0.3, 0.12, 0.1, 0.08], percussion: false, percussionSoft: false, percussionFast: false, percussionThird: false, keyClick: false, vibrato: 'Off', rotary: false })
const defaultSynth = (enabled: boolean, focus: boolean): SynthLayer => ({ ...defaultLayer(enabled, focus), category: 'Pure', waveform: 'Saw', oscCtrl: 0.3, filter: 'LP24', filterFreq: 0.7, resonance: 0.2, filterDrive: 0, filterTracking: '2/3', oscAttack: 0.02, oscDecay: 0.2, oscRelease: 0.2, filterAttack: 0.02, filterDecay: 0.3, filterRelease: 0.3, ampAttack: 0.01, ampDecay: 0.2, ampSustain: 0.75, ampRelease: 0.28, velocityToFilter: true, velocityToAmp: 2, lfoWave: 'Triangle', lfoDestination: 'Filter Freq', lfoRate: 0.35, lfoAmount: 0.25, voiceMode: 'Poly', priority: 'Off', glide: 0.15, unison: 0, vibrato: 'Off', arpMode: 'Arp', arpRate: 0.25, arpRange: 1, arpDirection: 'Up', arpHold: false, arpRun: false })

const defaultEffects = () => ({ A: { mod1: makeEffect({ type: 'A-Pan' }), mod2: makeEffect({ type: 'Chorus' }), delay: makeEffect({ dryWet: 0.28 }), ampEq: makeEffect({ type: 'EQ only' }), compressor: makeEffect({ dryWet: 0.5 }), reverb: makeEffect({ type: 'Room', dryWet: 0.22 }) }, B: { mod1: makeEffect({ type: 'A-Pan' }), mod2: makeEffect({ type: 'Chorus' }), delay: makeEffect({ dryWet: 0.28 }), ampEq: makeEffect({ type: 'EQ only' }), compressor: makeEffect({ dryWet: 0.5 }), reverb: makeEffect({ type: 'Room', dryWet: 0.22 }) } })

export const createInitialEngineState = (): EngineState => {
  const state: EngineState = { sectionOn: true, type: 'Grand' as PianoType, kbTouch: 'Medium' as const, dynComp: 0 as 0 | 1 | 2 | 3, timbre: 0.5, unison: 0 as 0 | 1 | 2 | 3, softRelease: false, stringRes: false, masterLevel: 0.72, pianoGroup: false, effectsBypass: false, rotaryOn: false, rotaryDrive: 0.25, layers: { A: defaultLayer(true, true), B: defaultLayer(false, false) }, effects: defaultEffects(), organOn: true, organLayers: { A: defaultOrgan(true, true, 'B3'), B: defaultOrgan(false, false, 'Vox') }, synthOn: true, synthLayers: { A: defaultSynth(true, true), B: defaultSynth(false, false), C: defaultSynth(false, false) }, programs: [], livePrograms: [], selectedProgram: 0, liveMode: false, dirty: false, storeMode: 'idle', storeName: '', activeScene: 'I', scenes: { I: { piano: [true, false], organ: [true, false], synth: [true, false, false] }, II: { piano: [true, false], organ: [true, false], synth: [true, false, false] } }, morphSources: { wheel: [], pedal: [] }, morphValues: { wheel: 0, pedal: 0 }, clock: { bpm: 120, tapTimes: [], sync: false }, transpose: 0, split: { enabled: false, points: [60, 72, 84], crossfade: 0, zones: [0, 3, 0, 3, 0] } }
  const names = ['Grand Stack', 'Tine Stack', 'B3 + Piano', 'Vox Split', 'Pipe Atmos', 'FM Motion', 'Farf + Synth', 'Stage Layers']
  state.programs = Array.from({ length: 32 }, (_, index) => ({ name: names[index] ?? `Program ${index + 1}`, state: cloneProgramState(state) }))
  state.livePrograms = Array.from({ length: 8 }, (_, index) => ({ name: `Live ${index + 1}`, state: cloneProgramState(state) }))
  return state
}

export function cloneProgramState(state: EngineState): ProgramState {
  const { programs: _p, livePrograms: _l, dirty: _d, selectedProgram: _s, storeMode: _m, storeName: _n, liveMode: _lm, activeScene: _a, morphSources: _ms, morphValues: _mv, clock: _c, transpose: _t, ...program } = structuredClone(state)
  return program
}
export function applyProgramState(state: EngineState, program: ProgramState): EngineState { return { ...structuredClone(state), ...structuredClone(program), dirty: false } }

type RuntimeVoice = { id: number; note: number; oscillators: OscillatorNode[]; gain: GainNode; released: boolean; sustained: boolean }
type UnitRuntime = { dry: GainNode; wet: GainNode; mix: GainNode; processor: AudioNode; delayFeedback?: GainNode; delayFilter?: BiquadFilterNode }

const PROFILE: Record<PianoType, { harmonics: number[]; wave: OscillatorType; brightness: number }> = { Grand: { harmonics: [1, .22, .08, .025], wave: 'triangle', brightness: 1 }, Upright: { harmonics: [1, .34, .16, .06], wave: 'triangle', brightness: .72 }, Electric: { harmonics: [1, .08, .3, .18], wave: 'sine', brightness: 1.2 }, Clav: { harmonics: [1, .6, .42, .2], wave: 'square', brightness: 1.6 }, Digital: { harmonics: [1, .18, .02, .1], wave: 'sine', brightness: 1.45 }, Misc: { harmonics: [1, .42, .12, .3], wave: 'sine', brightness: 1.8 } }
const ORGAN_PARTIALS: Record<OrganModel, number[]> = { B3: [1, .8, .5, .35, .22, .15, .1, .07, .05], Vox: [1, .15, .65, .04, .36, .03, .24, .02, .16], Farf: [1, .02, .8, .02, .6, .02, .4, .02, .25], 'Pipe 1': [1, .72, .36, .2, .12, .08, .045, .025, .015] }
const waveType = (wave: SynthWaveform): OscillatorType => wave.includes('Square') || wave.includes('Pulse') ? 'square' : wave.includes('Saw') ? 'sawtooth' : wave === 'Triangle' ? 'triangle' : 'sine'

function curveFor(kind: string, amount: number) { const curve = new Float32Array(256); for (let i = 0; i < curve.length; i += 1) { const x = i / 127.5 - 1; curve[i] = Math.tanh(x * (1 + amount * 8)) } return curve }
function impulse(context: BaseAudioContext, seconds: number, bright: number) { const length = Math.max(256, Math.floor(context.sampleRate * seconds)); const buffer = context.createBuffer(2, length, context.sampleRate); for (let c = 0; c < 2; c += 1) { const data = buffer.getChannelData(c); for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.4) * (c ? bright : 1) } return buffer }

export class PianoAudioEngine {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private limiter: DynamicsCompressorNode | null = null
  private readonly inputs = new Map<string, GainNode>()
  private readonly levels = new Map<string, GainNode>()
  private readonly units = new Map<LayerName, Map<EffectUnitName, UnitRuntime>>()
  private readonly voices: RuntimeVoice[] = []
  private nextVoiceId = 1
  private sustain = false
  private state: EngineState
  private readonly onStatus: (message: string) => void

  constructor(state: EngineState, onStatus: (message: string) => void) { this.state = state; this.onStatus = onStatus }
  private ensureGraph() {
    if (this.context) return this.context
    const Ctor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) throw new Error('Web Audio is not available; playable fallback remains available.')
    const context = new Ctor(); this.context = context; this.master = context.createGain(); this.limiter = context.createDynamicsCompressor(); this.limiter.threshold.value = -1; this.limiter.ratio.value = 20; this.master.connect(this.limiter).connect(context.destination)
    for (const key of ['piano-A', 'piano-B', 'organ-A', 'organ-B', 'synth-A', 'synth-B', 'synth-C']) { const input = context.createGain(); const level = context.createGain(); input.connect(level); level.connect(this.master); this.inputs.set(key, input); this.levels.set(key, level) }
    for (const layer of ['A', 'B'] as LayerName[]) this.units.set(layer, this.buildUnits(context, this.inputs.get(`piano-${layer}`)!, this.levels.get(`piano-${layer}`)!))
    this.applyState(); this.onStatus('library ready · one context / program system online'); return context
  }
  private buildUnits(context: AudioContext, input: GainNode, level: GainNode) { const names: EffectUnitName[] = ['mod1', 'mod2', 'delay', 'ampEq', 'compressor', 'reverb']; const map = new Map<EffectUnitName, UnitRuntime>(); let current: AudioNode = input; for (const name of names) { const dry = context.createGain(); const wet = context.createGain(); const mix = context.createGain(); const processor: AudioNode = name === 'delay' ? context.createDelay(2.5) : name === 'compressor' ? context.createDynamicsCompressor() : name === 'reverb' ? context.createConvolver() : name === 'mod1' || name === 'mod2' || name === 'ampEq' ? context.createWaveShaper() : context.createGain(); current.connect(dry); current.connect(processor); processor.connect(wet); dry.connect(mix); wet.connect(mix); current = mix; const runtime: UnitRuntime = { dry, wet, mix, processor }; if (name === 'delay') { const feedback = context.createGain(); const filter = context.createBiquadFilter(); filter.type = 'lowpass'; processor.connect(filter).connect(feedback).connect(processor); runtime.delayFeedback = feedback; runtime.delayFilter = filter } map.set(name, runtime) } current.connect(level); return map }
  setState(state: EngineState) { this.state = state; if (this.context) this.applyState() }
  private applyState() { if (!this.context || !this.master) return; const now = this.context.currentTime; this.master.gain.setTargetAtTime(Math.max(.0001, this.state.masterLevel), now, .02); for (const section of ['piano', 'organ', 'synth'] as SectionName[]) { const layers = section === 'piano' ? this.state.layers : section === 'organ' ? this.state.organLayers : this.state.synthLayers; for (const layer of Object.keys(layers) as string[]) { const settings = layers[layer as keyof typeof layers] as LayerSettings; this.levels.get(`${section}-${layer}`)?.gain.setTargetAtTime(settings.enabled && (section !== 'piano' || this.state.sectionOn) && (section !== 'organ' || this.state.organOn) && (section !== 'synth' || this.state.synthOn) ? settings.level : 0, now, .02) } } for (const layer of ['A', 'B'] as LayerName[]) { const map = this.units.get(layer); if (!map) continue; for (const name of Object.keys(this.state.effects[layer]) as EffectUnitName[]) { const effect = this.state.effects[layer][name]; const runtime = map.get(name); if (!runtime) continue; const wet = this.state.effectsBypass || !effect.on ? 0 : Math.max(0, Math.min(1, effect.dryWet || effect.amount)); runtime.dry.gain.setTargetAtTime(this.state.effectsBypass || !effect.on ? 1 : 1 - wet, now, .01); runtime.wet.gain.setTargetAtTime(wet, now, .01); if (runtime.processor instanceof WaveShaperNode) { runtime.processor.curve = curveFor(effect.type ?? name, effect.amount); runtime.processor.oversample = '2x' } if (name === 'delay' && runtime.processor instanceof DelayNode) { runtime.processor.delayTime.setTargetAtTime(.08 + effect.rate * .72, now, .01); runtime.delayFeedback?.gain.setTargetAtTime(effect.feedback * .78, now, .02) } if (name === 'reverb' && runtime.processor instanceof ConvolverNode) runtime.processor.buffer = impulse(this.context, ({ Booth: .18, Room: .45, Spring: .72, Stage: 1.1, Hall: 1.8, Cathedral: 3.2 }[effect.type ?? 'Room'] ?? .45), effect.bright > .5 ? 1 : .55) } } }
  private zoneAllows(note: number, settings: LayerSettings) { if (!this.state.split.enabled) return true; const index = SPLIT_POSITIONS.findIndex((position) => note < position); const zone = Math.max(0, Math.min(3, index < 0 ? 3 : index)); return zone >= settings.zoneStart && zone <= settings.zoneEnd }
  noteOn(note: number, velocity: number) { try { const context = this.ensureGraph(); void context.resume(); while (this.voices.length >= 36) this.releaseVoice(this.voices[0], .018); const now = context.currentTime; const transpose = this.state.transpose; const pianoProfile = PROFILE[this.state.type]; const touch = this.state.kbTouch === 'Heavy' ? Math.pow(velocity / 127, 1.35) : this.state.kbTouch === 'Light' ? Math.sqrt(velocity / 127) : velocity / 127; const dyn = this.state.dynComp ? .56 + (touch * .44) / (1 + this.state.dynComp * .32) : touch; for (const layer of ['A', 'B'] as LayerName[]) { const s = this.state.layers[layer]; if (this.state.sectionOn && s.enabled && this.zoneAllows(note, s)) this.createTone(`piano-${layer}`, note + s.octave * 12 + transpose, dyn * s.level, pianoProfile, now, layer) } for (const layer of ['A', 'B'] as LayerName[]) { const s = this.state.organLayers[layer]; if (this.state.organOn && s.enabled && this.zoneAllows(note, s)) this.createOrgan(`organ-${layer}`, note + s.octave * 12 + transpose, dyn * s.level, s, now) } for (const layer of ['A', 'B', 'C'] as const) { const s = this.state.synthLayers[layer]; if (this.state.synthOn && s.enabled && this.zoneAllows(note, s)) this.createSynth(`synth-${layer}`, note + s.octave * 12 + transpose, dyn * s.level, s, now) } } catch (error) { this.onStatus(error instanceof Error ? `fallback active · ${error.message}` : 'fallback active · audio unavailable') } }
  private createTone(key: string, note: number, level: number, profile: { harmonics: number[]; wave: OscillatorType; brightness: number }, now: number, layer: LayerName) { if (!this.context) return; const gain = this.context.createGain(); gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(Math.max(.012, level * .15), now + .012); gain.connect(this.inputs.get(key)!); const detunes = this.state.unison ? [-1, 1, 0].slice(0, this.state.unison + 1) : [0]; const oscillators = detunes.flatMap((detune) => profile.harmonics.map((harmonic, index) => { const oscillator = this.context!.createOscillator(); const partial = this.context!.createGain(); oscillator.type = profile.wave; oscillator.frequency.value = 440 * Math.pow(2, (note - 69) / 12) * (index + 1) * Math.pow(2, detune / 1200); partial.gain.value = harmonic * profile.brightness / (detune ? 2.7 : 1); oscillator.connect(partial).connect(gain); oscillator.start(now); return oscillator })); this.voices.push({ id: this.nextVoiceId++, note: note - this.state.transpose, oscillators, gain, released: false, sustained: false }); void layer }
  private createOrgan(key: string, note: number, level: number, settings: OrganLayer, now: number) { if (!this.context) return; const gain = this.context.createGain(); gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(Math.max(.01, level * .12), now + .015); gain.connect(this.inputs.get(key)!); const partials = ORGAN_PARTIALS[settings.model]; const oscillators = partials.map((partial, index) => { const oscillator = this.context!.createOscillator(); const partialGain = this.context!.createGain(); oscillator.type = settings.model === 'Farf' ? 'square' : 'sine'; oscillator.frequency.value = 440 * Math.pow(2, (note - 69) / 12) * (index + 1); partialGain.gain.value = partial * (settings.drawbars[index] ?? .5) / 3; oscillator.connect(partialGain).connect(gain); oscillator.start(now); return oscillator }); if (settings.keyClick) { const click = this.context.createOscillator(); const clickGain = this.context.createGain(); click.type = 'square'; click.frequency.value = 2400; clickGain.gain.setValueAtTime(.02, now); clickGain.gain.exponentialRampToValueAtTime(.0001, now + .025); click.connect(clickGain).connect(gain); click.start(now); click.stop(now + .03) } this.voices.push({ id: this.nextVoiceId++, note, oscillators, gain, released: false, sustained: false }) }
  private createSynth(key: string, note: number, level: number, settings: SynthLayer, now: number) { if (!this.context) return; const gain = this.context.createGain(); const filter = this.context.createBiquadFilter(); filter.type = settings.filter === 'LP12' ? 'lowpass' : settings.filter === 'LP24' ? 'lowpass' : settings.filter === 'HP' ? 'highpass' : 'bandpass'; filter.frequency.setValueAtTime(120 + settings.filterFreq * 9000, now); filter.Q.setValueAtTime(settings.resonance * 18, now); gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(Math.max(.01, level * .16), now + Math.max(.005, settings.ampAttack * .1)); gain.connect(filter).connect(this.inputs.get(key)!); const count = settings.unison ? settings.unison + 1 : 1; const oscillators: OscillatorNode[] = []; for (let i = 0; i < count; i += 1) { const oscillator = this.context.createOscillator(); oscillator.type = waveType(settings.waveform); const frequency = 440 * Math.pow(2, (note - 69) / 12) * (settings.waveform.includes('8ve') ? 2 : 1); oscillator.frequency.value = frequency * Math.pow(2, (i - (count - 1) / 2) * settings.oscCtrl * .015); if (settings.waveform === 'White Noise') { const buffer = this.context.createBuffer(1, this.context.sampleRate, this.context.sampleRate); const data = buffer.getChannelData(0); for (let j = 0; j < data.length; j += 1) data[j] = Math.random() * 2 - 1; const source = this.context.createBufferSource(); source.buffer = buffer; source.loop = true; source.connect(gain); source.start(now); continue } oscillator.connect(gain); oscillator.start(now); oscillators.push(oscillator) } if (settings.lfoDestination !== 'Off' && settings.lfoAmount > 0) { const lfo = this.context.createOscillator(); const lfoGain = this.context.createGain(); lfo.type = settings.lfoWave === 'Square' ? 'square' : settings.lfoWave.includes('Saw') ? 'sawtooth' : 'triangle'; lfo.frequency.value = settings.lfoRate * 10; lfoGain.gain.value = settings.lfoAmount * (settings.lfoDestination === 'Filter Freq' ? 2000 : 8); if (settings.lfoDestination === 'Filter Freq') lfo.connect(lfoGain).connect(filter.frequency); else oscillators.forEach((oscillator) => lfo.connect(lfoGain).connect(oscillator.frequency)); lfo.start(now); lfo.stop(now + 4) } this.voices.push({ id: this.nextVoiceId++, note, oscillators, gain, released: false, sustained: false }) }
  noteOff(note: number) { this.voices.filter((voice) => voice.note === note && !voice.released).forEach((voice) => { if (this.sustain) voice.sustained = true; else this.releaseVoice(voice, this.state.softRelease ? .58 : .35) }) }
  setSustain(pressed: boolean) { this.sustain = pressed; if (!pressed) this.voices.filter((voice) => voice.sustained && !voice.released).forEach((voice) => this.releaseVoice(voice, .35)) }
  allNotesOff() { this.sustain = false; this.voices.slice().forEach((voice) => this.releaseVoice(voice, .025)) }
  dispose() { this.allNotesOff(); const context = this.context; this.context = null; this.master = null; if (context) void context.close() }
  private releaseVoice(voice: RuntimeVoice | undefined, duration: number) { if (!voice || voice.released || !this.context) return; voice.released = true; const now = this.context.currentTime; voice.gain.gain.cancelScheduledValues(now); voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, .0001), now); voice.gain.gain.exponentialRampToValueAtTime(.0001, now + duration); voice.oscillators.forEach((oscillator) => oscillator.stop(now + duration + .02)); window.setTimeout(() => { voice.oscillators.forEach((oscillator) => oscillator.disconnect()); voice.gain.disconnect(); const index = this.voices.findIndex((candidate) => candidate.id === voice.id); if (index >= 0) this.voices.splice(index, 1) }, (duration + .04) * 1000) }
}
