import type { Voice, VoiceBackend } from './piano'
import { arpStep, initialSystemState, morphed, zoneGain } from './system'
import type { VoiceKey, SystemState, OrganLayer, SynthLayer } from './system'

export type LayerId = 'A' | 'B'
export type PianoType = 'Grand' | 'Upright' | 'Electric' | 'Clav' | 'Digital' | 'Misc'
export type UnitId = 'mod1' | 'mod2' | 'delay' | 'ampEq' | 'compressor' | 'reverb'
export const pianoTypes: PianoType[] = ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc']
export const unitTypes: Record<UnitId, string[]> = {
  mod1: ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump'],
  mod2: ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin'],
  delay: ['Delay'],
  ampEq: ['EQ only', 'Twin', 'JC', 'Small', 'LP24 Filter', 'HP24 Filter', 'To Rotary'],
  compressor: ['Compressor'],
  reverb: ['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral'],
}
export interface UnitState { on: boolean; type: string; amount: number; rate: number; feedback: number; wet: number; filter: 'Off' | 'LP' | 'HP' | 'BP'; fast: boolean; bright: boolean; global: boolean }
export interface LayerState { enabled: boolean; level: number; octave: number; zones: [0 | 1 | 2 | 3, 0 | 1 | 2 | 3]; sustped: boolean; pstick: boolean; type: PianoType; kbTouch: 'Heavy' | 'Medium' | 'Light'; dynComp: 0 | 1 | 2 | 3; timbre: string; unison: 0 | 1 | 2 | 3; softRelease: boolean; stringRes: boolean; units: Record<UnitId, UnitState> }
export interface StageState extends SystemState { pianoOn: boolean; focus: LayerId; fxFocus: LayerId; fxSection: 'Piano' | 'Organ' | 'Synth'; group: boolean; effectsOn: boolean; master: number; pitch: number; rotaryOn: boolean; rotaryFast: boolean; rotarySpeed: number; rotaryDrive: number; layers: Record<LayerId, LayerState> }

const freshUnits = (): Record<UnitId, UnitState> => Object.fromEntries((Object.keys(unitTypes) as UnitId[]).map(id => [id, { on: false, type: unitTypes[id][0], amount: 0.5, rate: 0.5, feedback: 0.35, wet: 0.35, filter: 'Off', fast: false, bright: true, global: false }])) as Record<UnitId, UnitState>
const freshLayer = (enabled: boolean): LayerState => ({ enabled, level: 0.68, octave: 0, zones: [0, 3], sustped: true, pstick: false, type: 'Grand', kbTouch: 'Medium', dynComp: 0, timbre: 'Off', unison: 0, softRelease: false, stringRes: false, units: freshUnits() })
export function initialStageState(): StageState { return { ...initialSystemState(freshUnits()), pianoOn: true, focus: 'A', fxFocus: 'A', fxSection: 'Piano', group: false, effectsOn: true, master: 0.68, pitch: 0.5, rotaryOn: false, rotaryFast: false, rotarySpeed: 0.5, rotaryDrive: 0.25, layers: { A: freshLayer(true), B: freshLayer(false) } } }
export function cycle<T>(values: readonly T[], current: T): T { return values[(values.indexOf(current) + 1) % values.length] }
export const timbres = (type: PianoType) => type === 'Electric' ? ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'] : ['Off', 'Soft', 'Mid', 'Bright']

export interface SampleRoot { note: number; soft: string; hard: string; softNote?: number; hardNote?: number }
export const sampleRoots: Record<'Grand' | 'Upright' | 'Electric', SampleRoot[]> = {
  Grand: [
    [36, 'PP-C2', 'FF-C2'], [45, 'PP-A2', 'FF-A2'], [48, 'PP-C3', 'FF-C3'], [57, 'PP-A3', 'FF-A3'],
    [60, 'PP-C4', 'FF-C4'], [69, 'PP-A4', 'FF-A4'], [71, 'PP-B4', 'FF-B4'], [81, 'PP-A5', 'FF-A5'], [83, 'PP-B5', 'PP-B5'], [84, 'PP-C6', 'PP-C6'], [96, 'PP-C7', 'PP-C7'],
  ].map(([note, soft, hard]) => ({ note: Number(note), soft: `samples/grand/${soft}.ogg`, hard: `samples/grand/${hard}.ogg` })),
  Upright: [
    [36, 'C2-L', 'C2-H'], [42, 'Fs2-L', 'Fs2-H'], [48, 'C3-L', 'C3-H'], [54, 'Fs3-L', 'Fs3-H'],
    [60, 'C4-L', 'B3-H'], [63, 'C4-L', 'Ds4-H'], [66, 'Fs4-L', 'Fs4-H'], [72, 'C5-L', 'C5-H'], [78, 'Fs5-L', 'Fs5-H'], [84, 'C6-L', 'C6-H'], [96, 'C7-L', 'C7-H'],
  ].map(([note, soft, hard]) => ({ note: Number(note), soft: `samples/upright/${soft}.ogg`, hard: `samples/upright/${hard}.ogg`, softNote: soft === 'C4-L' ? 60 : Number(note), hardNote: hard === 'B3-H' ? 59 : Number(note) })),
  Electric: [
    [33, 'a1pp', 'a1ff'], [36, 'c2f', 'c2ff'], [47, 'b2f', 'b2ff'], [56, 'ab3pp', 'ab3ff'],
    [61, 'db4pp', 'db4ff'], [73, 'db5pp', 'db5ff'], [79, 'g5mp', 'g5ff'], [92, 'ab6mp', 'ab6f'],
  ].map(([note, soft, hard]) => ({ note: Number(note), soft: `samples/electric/${soft}.ogg`, hard: `samples/electric/${hard}.ogg` })),
}
export const recordedTypes = ['Grand', 'Upright', 'Electric'] as const
export function nearestRoot(type: keyof typeof sampleRoots, note: number): SampleRoot { return sampleRoots[type].reduce((a, b) => Math.abs(a.note - note) <= Math.abs(b.note - note) ? a : b) }
export function velocityGain(velocity: number, layer: LayerState): number {
  const normalized = Math.max(0.01, Math.min(1, velocity / 127))
  const exponent = layer.kbTouch === 'Heavy' ? 2 : layer.kbTouch === 'Light' ? 0.7 : 1.25
  const shaped = normalized ** exponent
  return Math.min(1, shaped + (1 - shaped) * layer.dynComp * 0.14)
}

interface LayerVoice { voice: Voice; layer: VoiceKey; released: boolean }
interface Press { source: string; note: number; held: boolean; voices: LayerVoice[] }

/** Owns a voice per layer for each physical press. Sustain only retains voices routed by SUSTPED. */
export class StagePianoEngine {
  private presses: Press[] = []
  private sustain = new Set<string>()
  private arpNotes = new Map<VoiceKey, number[]>()
  private arpTimers = new Map<VoiceKey, number>()
  private arpVoices = new Map<VoiceKey, Voice[]>()
  private arpStepCount = new Map<VoiceKey, number>()
  constructor(private backend: (layer: LayerId, note: number, velocity: number) => Voice, private state: () => StageState, readonly maxVoices = 24, private otherBackend?: (layer: VoiceKey, note: number, velocity: number) => Voice) {}
  noteOn(source: string, note: number, velocity = 100): void {
    if (!Number.isInteger(note) || note < 0 || note > 127 || velocity <= 0) return
    if (this.presses.length >= this.maxVoices) this.stopPress(this.presses.shift()!)
    const voices: LayerVoice[] = []
    const state = this.state()
    for (const layer of ['A', 'B'] as const) { const setting = state.layers[layer]; const gain = zoneGain(note, setting.zones, state.splits); if (state.pianoOn && setting.enabled && gain > 0) voices.push({ voice: this.backend(layer, Math.max(0, Math.min(127, note + setting.octave + state.transpose)), Math.round(velocity * gain)), layer: `Piano:${layer}`, released: false }) }
    for (const layer of ['A', 'B'] as const) { const setting = state.organ[layer]; const gain = zoneGain(note, setting.zones, state.splits); if (state.organOn && setting.enabled && gain > 0 && this.otherBackend) voices.push({ voice: this.otherBackend(`Organ:${layer}`, Math.max(0, Math.min(127, note + setting.octave + state.transpose)), Math.round(velocity * gain)), layer: `Organ:${layer}`, released: false }) }
    let arpeggiated = false
    for (const layer of ['A', 'B', 'C'] as const) { const setting = state.synth[layer]; const gain = zoneGain(note, setting.zones, state.splits); const key = `Synth:${layer}` as VoiceKey; if (!state.synthOn || !setting.enabled || gain <= 0 || !this.otherBackend) continue; const pitched = Math.max(0, Math.min(127, note + setting.octave + state.transpose)); if (setting.arpRun) { const held = this.arpNotes.get(key) ?? []; held.push(pitched); this.arpNotes.set(key, held); this.runArp(key, velocity); arpeggiated = true } else { if (setting.voiceMode !== 'Poly') { const active = this.presses.filter(p => p.voices.some(v => v.layer === key && !v.released)); const high = Math.max(...active.map(p => p.note), note), low = Math.min(...active.map(p => p.note), note); if ((setting.priority === 'Low' && note > low) || (setting.priority === 'High' && note < high)) continue; this.stopLayer(key) } voices.push({ voice: this.otherBackend(key, pitched, Math.round(velocity * gain)), layer: key, released: false }) } }
    if (voices.length || arpeggiated) this.presses.push({ source, note, held: true, voices })
  }
  private runArp(key: VoiceKey, velocity: number): void {
    if (this.arpTimers.has(key) || !this.otherBackend) return
    const tick = () => { const state = this.state(), layer = state.synth[key.split(':')[1] as 'A' | 'B' | 'C']; const notes = this.arpNotes.get(key) ?? []; if (!layer.arpRun || !notes.length) { this.arpTimers.delete(key); return } const step = this.arpStepCount.get(key) ?? 0; this.arpStepCount.set(key, step + 1); const rate = morphed(layer.arpRate, state.morphs, `synth.${key.split(':')[1]}.arpRate`, state.wheel, state.pedal); const interval = layer.arpSync ? 60000 / state.tempo / (1 + rate * 3) : 800 - rate * 680; const next = layer.arpMode === 'Poly' ? notes : [arpStep(notes, step, layer.arpDirection, layer.arpRange)!]; const old = this.arpVoices.get(key) ?? []; old.forEach(v => v.release()); const fresh = next.map(n => this.otherBackend!(key, n, velocity)); this.arpVoices.set(key, fresh); if (layer.arpMode === 'Gate') window.setTimeout(() => fresh.forEach(v => v.release()), interval * .45); this.arpTimers.set(key, window.setTimeout(tick, interval)) }
    tick()
  }
  noteOff(source: string, note: number): void {
    for (const [key, held] of this.arpNotes) { const layer = this.state().synth[key.split(':')[1] as 'A' | 'B' | 'C']; if (!layer.arpHold) this.arpNotes.set(key, held.filter(n => n !== note + layer.octave + this.state().transpose)) }
    const press = this.presses.find(p => p.source === source && p.note === note && p.held)
    if (!press) return
    press.held = false
    for (const voice of press.voices) { const [section, layer] = voice.layer.split(':') as ['Piano' | 'Organ' | 'Synth', 'A' | 'B' | 'C']; const setting = section === 'Piano' ? this.state().layers[layer as LayerId] : section === 'Organ' ? this.state().organ[layer as LayerId] : this.state().synth[layer]; if (!this.sustain.size || !('sustped' in setting && setting.sustped)) this.releaseVoice(voice) }
    this.prune()
  }
  setSustain(source: string, down: boolean): void {
    if (down) this.sustain.add(source); else this.sustain.delete(source)
    if (!this.sustain.size) { for (const press of this.presses) if (!press.held) press.voices.forEach(v => this.releaseVoice(v)); this.prune() }
  }
  disconnectSource(prefix: string): void { this.presses = this.presses.filter(p => { if (!p.source.startsWith(prefix)) return true; this.stopPress(p); return false }); for (const source of this.sustain) if (source.startsWith(prefix)) this.sustain.delete(source) }
  allNotesOff(): void { this.presses.forEach(p => this.stopPress(p)); this.presses = []; this.sustain.clear(); for (const timer of this.arpTimers.values()) clearTimeout(timer); this.arpTimers.clear(); this.arpNotes.clear(); for (const voices of this.arpVoices.values()) voices.forEach(v => v.stop()); this.arpVoices.clear() }
  stopLayer(layer: LayerId | VoiceKey): void { for (const press of this.presses) for (const v of press.voices) if ((v.layer === layer || v.layer === `Piano:${layer}`) && !v.released) { v.voice.stop(); v.released = true }; const timer = this.arpTimers.get(layer as VoiceKey); if (timer) clearTimeout(timer); this.arpTimers.delete(layer as VoiceKey); this.arpNotes.delete(layer as VoiceKey); this.arpVoices.get(layer as VoiceKey)?.forEach(v => v.stop()); this.arpVoices.delete(layer as VoiceKey); this.prune() }
  releaseUnrouted(layer: LayerId | VoiceKey): void { for (const press of this.presses) if (!press.held) for (const v of press.voices) if (v.layer === layer || v.layer === `Piano:${layer}`) this.releaseVoice(v); this.prune() }
  get activeNotes(): number[] { return this.presses.map(p => p.note) }
  get sustainDown(): boolean { return this.sustain.size > 0 }
  get soundingCount(): number { return this.presses.reduce((n, p) => n + p.voices.filter(v => !v.released).length, 0) }
  private releaseVoice(v: LayerVoice) { if (!v.released) { v.voice.release(); v.released = true } }
  private stopPress(p: Press) { p.voices.forEach(v => { if (!v.released) v.voice.stop(); v.released = true }) }
  private prune() { this.presses = this.presses.filter(p => p.held || p.voices.some(v => !v.released)) }
}

export function routeStageMidi(engine: StagePianoEngine, source: string, data: Uint8Array | number[]): void {
  const [status, note, value] = data; const owner = `${source}:ch${status & 15}`; const kind = status & 0xf0
  if (kind === 0x90 && value > 0) engine.noteOn(owner, note, value)
  else if (kind === 0x80 || (kind === 0x90 && value === 0)) engine.noteOff(owner, note)
  else if (kind === 0xb0 && note === 64) engine.setSustain(owner, value >= 64)
  else if (kind === 0xb0 && (note === 120 || note === 123)) engine.disconnectSource(owner)
}

const ramp = (param: AudioParam, value: number, now: number, seconds = 0.025) => { param.cancelScheduledValues(now); param.setValueAtTime(param.value, now); param.linearRampToValueAtTime(value, now + seconds) }
interface Graph { input: GainNode; output: GainNode; dispose(): void }
function graph(ctx: AudioContext, first: AudioNode, last: AudioNode, nodes: AudioNode[], oscillators: OscillatorNode[] = []): Graph {
  const input = ctx.createGain(), output = ctx.createGain(); input.connect(first); last.connect(output)
  return { input, output, dispose() { oscillators.forEach(o => { try { o.stop() } catch { /* already stopped */ } }); [input, output, ...nodes].forEach(n => n.disconnect()) } }
}
export function createEffectUnit(ctx: AudioContext, id: UnitId, s: UnitState): Graph {
  const n = ctx.currentTime, a = Math.max(0.02, s.amount), rate = 0.1 + s.rate * 8
  if (id === 'mod1') {
    if (s.type === 'A-Pan') { const pan = ctx.createStereoPanner(), lfo = ctx.createOscillator(), depth = ctx.createGain(); lfo.type = 'sine'; lfo.frequency.value = rate; depth.gain.value = a; lfo.connect(depth).connect(pan.pan); lfo.start(n); return graph(ctx, pan, pan, [pan, depth], [lfo]) }
    if (s.type === 'A-Wah' || s.type === 'Wah') { const filter = ctx.createBiquadFilter(), lfo = ctx.createOscillator(), depth = ctx.createGain(); filter.type = s.type === 'A-Wah' ? 'bandpass' : 'lowpass'; filter.frequency.value = 700 + s.rate * 1500; filter.Q.value = 1 + a * 8; lfo.frequency.value = s.type === 'A-Wah' ? .5 + s.rate * 2 : rate; depth.gain.value = a * 1300; lfo.connect(depth).connect(filter.frequency); lfo.start(n); return graph(ctx, filter, filter, [filter, depth], [lfo]) }
    const gain = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain()
    lfo.type = s.type === 'Pump' ? 'sawtooth' : s.type === 'Ring Mod' ? 'sine' : 'triangle'
    lfo.frequency.value = s.type === 'Ring Mod' ? 20 + s.rate * 800 : rate
    gain.gain.value = s.type === 'Ring Mod' ? 0 : s.type === 'Tremolo' ? 1 - a * .45 : s.type === 'Pump' ? 1 - a * .6 : .75
    depth.gain.value = s.type === 'Ring Mod' ? a : s.type === 'Tremolo' ? a * .45 : a * .5
    lfo.connect(depth).connect(gain.gain); lfo.start(n)
    return graph(ctx, gain, gain, [gain, depth], [lfo])
  }
  if (id === 'mod2') {
    const input = ctx.createGain(), output = ctx.createGain(), delay = ctx.createDelay(.1), wet = ctx.createGain(), dry = ctx.createGain(), feedback = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain(), filter = ctx.createBiquadFilter()
    const index = unitTypes.mod2.indexOf(s.type)
    delay.delayTime.value = [.018, .004, .012, .025, .032, .009][index] || .02
    wet.gain.value = a * [.55, .8, .7, .65, .7, .45][index]
    dry.gain.value = 1; feedback.gain.value = [0, .55, .35, .18, .2, .08][index] * a
    filter.type = ['lowpass', 'highpass', 'allpass', 'allpass', 'lowpass', 'bandpass'][index] as BiquadFilterType
    filter.frequency.value = [9000, 450, 1400, 800, 5000, 2200][index]
    lfo.frequency.value = .1 + s.rate * (s.type === 'Spin' ? 5 : 3); depth.gain.value = .001 + a * .004
    lfo.connect(depth).connect(delay.delayTime); lfo.start(n)
    input.connect(dry).connect(output); input.connect(delay).connect(filter).connect(wet).connect(output); filter.connect(feedback).connect(delay)
    return { input, output, dispose() { lfo.stop(); [input, output, delay, wet, dry, feedback, depth, filter].forEach(x => x.disconnect()) } }
  }
  if (id === 'delay') {
    const input = ctx.createGain(), output = ctx.createGain(), delay = ctx.createDelay(2), feedback = ctx.createGain(), filter = ctx.createBiquadFilter(), dry = ctx.createGain(), wet = ctx.createGain()
    delay.delayTime.value = .08 + (1 - s.rate) * .72; feedback.gain.value = Math.min(.8, s.feedback * .8); dry.gain.value = 1 - s.wet; wet.gain.value = s.wet
    filter.type = s.filter === 'LP' ? 'lowpass' : s.filter === 'HP' ? 'highpass' : s.filter === 'BP' ? 'bandpass' : 'allpass'; filter.frequency.value = s.filter === 'LP' ? 1100 : s.filter === 'HP' ? 1200 : 1800
    input.connect(dry).connect(output); input.connect(delay).connect(wet).connect(output); if (s.filter === 'Off') delay.connect(feedback).connect(delay); else delay.connect(filter).connect(feedback).connect(delay)
    return { input, output, dispose() { [input, output, delay, feedback, filter, dry, wet].forEach(x => x.disconnect()) } }
  }
  if (id === 'ampEq') {
    const input = ctx.createGain(), output = ctx.createGain(), low = ctx.createBiquadFilter(), mid = ctx.createBiquadFilter(), high = ctx.createBiquadFilter(), drive = ctx.createWaveShaper()
    low.type = 'lowshelf'; low.frequency.value = 100; low.gain.value = (s.feedback - .5) * 24
    mid.type = 'peaking'; mid.frequency.value = 200 + s.rate * 7800; mid.Q.value = 1.2; mid.gain.value = (s.amount - .5) * 24
    high.type = 'highshelf'; high.frequency.value = 4000; high.gain.value = (s.wet - .5) * 24
    const type = s.type; if (type === 'LP24 Filter' || type === 'HP24 Filter') { low.type = type === 'LP24 Filter' ? 'lowpass' : 'highpass'; mid.type = low.type; low.frequency.value = mid.frequency.value = 180 + s.rate * 7500; low.Q.value = mid.Q.value = 1 + s.amount * 10 }
    const curve = new Float32Array(1024); const grit = type === 'Twin' ? 2.8 : type === 'JC' ? 1.3 : type === 'Small' ? 6 : 0
    for (let i = 0; i < curve.length; i++) { const x = (i / 511.5) - 1; curve[i] = grit ? Math.tanh(x * grit * (1 + s.amount * 4)) / Math.tanh(grit * (1 + s.amount * 4)) : x }
    drive.curve = curve as Float32Array<ArrayBuffer>; drive.oversample = '2x'
    input.connect(low).connect(mid).connect(high).connect(drive).connect(output)
    return { input, output, dispose() { [input, output, low, mid, high, drive].forEach(x => x.disconnect()) } }
  }
  if (id === 'compressor') { const compressor = ctx.createDynamicsCompressor(); compressor.threshold.value = -8 - s.amount * 42; compressor.ratio.value = 1 + s.amount * 13; compressor.attack.value = s.fast ? .002 : .03; compressor.release.value = s.fast ? .08 : .3; return graph(ctx, compressor, compressor, [compressor]) }
  const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain(), convolver = ctx.createConvolver(), tone = ctx.createBiquadFilter()
  const index = unitTypes.reverb.indexOf(s.type); const seconds = [.7, .35, 1.1, 1.6, 2.7, 4.2][index]
  const buffer = ctx.createBuffer(2, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate)
  for (let channel = 0; channel < 2; channel++) { const data = buffer.getChannelData(channel); for (let i = 0; i < data.length; i++) { const t = i / data.length; const noise = Math.sin(i * (channel ? 7.31 : 9.73)) * Math.sin(i * 2.17); data[i] = noise * Math.pow(1 - t, s.type === 'Spring' ? 2.2 : 1.4) * (s.type === 'Spring' ? Math.sin(i / 190) : 1) } }
  convolver.buffer = buffer; dry.gain.value = 1 - s.wet; wet.gain.value = s.wet; tone.type = 'lowpass'; tone.frequency.value = s.bright ? 9000 : 1800
  input.connect(dry).connect(output); input.connect(convolver).connect(tone).connect(wet).connect(output)
  return { input, output, dispose() { [input, output, dry, wet, convolver, tone].forEach(x => x.disconnect()) } }
}

interface Chain { input: GainNode; output: GainNode; dispose(): void }
function makeChain(ctx: AudioContext, layer: LayerState, effectsOn: boolean, tempo?: number): Chain {
  const input = ctx.createGain(), output = ctx.createGain(), units: Graph[] = []
  let tail: AudioNode = input
  if (effectsOn) for (const id of Object.keys(unitTypes) as UnitId[]) if (layer.units[id].on) { const settings = tempo && (id === 'delay' || id === 'mod1') ? { ...layer.units[id], rate: Math.max(0, Math.min(1, (tempo / 60 - .1) / 8)) } : layer.units[id]; const unit = createEffectUnit(ctx, id, settings); tail.connect(unit.input); tail = unit.output; units.push(unit) }
  tail.connect(output)
  return { input, output, dispose() { units.forEach(u => u.dispose()); input.disconnect(); output.disconnect() } }
}

export type StageAudioStatus = 'idle' | 'loading' | 'ready' | 'fallback' | 'error'
/** The production graph uses one context and stable buses; graph replacements crossfade on parameter changes. */
export class StageAudio implements VoiceBackend {
  private ctx: AudioContext | null = null
  private buses: Record<LayerId, GainNode> | null = null
  private levels: Record<LayerId, GainNode> | null = null
  private extraBuses: Partial<Record<VoiceKey, GainNode>> = {}
  private extraLevels: Partial<Record<VoiceKey, GainNode>> = {}
  private extraChains: Partial<Record<VoiceKey, Chain>> = {}
  private organChain: Chain | null = null
  private chains: Partial<Record<LayerId, Chain>> = {}
  private master: GainNode | null = null
  private limiter: DynamicsCompressorNode | null = null
  private rotary: { input: GainNode; output: GainNode; lfo: OscillatorNode; nodes: AudioNode[] } | null = null
  private buffers = new Map<string, AudioBuffer>()
  private failed = false
  private closed = false
  private loading: Promise<void> | null = null
  private live = new Set<Voice>()
  private pitched = new Set<{ source: OscillatorNode | AudioBufferSourceNode; layer: LayerId; base: number }>()
  private synthLastFrequency = new Map<VoiceKey, number>()
  private timers = new Set<number>()
  constructor(private state: () => StageState, private status: (s: StageAudioStatus) => void, private fetchAsset: typeof fetch = (...args: Parameters<typeof fetch>) => fetch(...args), private contextFactory: () => AudioContext = () => new AudioContext()) {}
  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx
    this.status('loading')
    try {
      this.closed = false
      const ctx = this.contextFactory(); this.ctx = ctx
      const master = ctx.createGain(), limiter = ctx.createDynamicsCompressor(); this.master = master; this.limiter = limiter
      master.gain.value = this.state().master; limiter.threshold.value = -4; limiter.ratio.value = 18; limiter.attack.value = .002; limiter.release.value = .09
      master.connect(limiter).connect(ctx.destination)
      const buses = { A: ctx.createGain(), B: ctx.createGain() }, levels = { A: ctx.createGain(), B: ctx.createGain() }
      this.buses = buses; this.levels = levels
      for (const key of ['Organ:A', 'Organ:B', 'Synth:A', 'Synth:B', 'Synth:C'] as VoiceKey[]) { this.extraBuses[key] = ctx.createGain(); this.extraLevels[key] = ctx.createGain(); this.extraLevels[key]!.connect(master) }
      const rotaryIn = ctx.createGain(), rotaryOut = ctx.createGain(), pan = ctx.createStereoPanner(), drive = ctx.createWaveShaper(), lfo = ctx.createOscillator(), depth = ctx.createGain()
      const curve = new Float32Array(512); for (let i = 0; i < 512; i++) curve[i] = Math.tanh(((i / 255.5) - 1) * 2)
      drive.curve = curve as Float32Array<ArrayBuffer>; lfo.frequency.value = this.state().rotaryFast ? 5.8 : .8; depth.gain.value = .75; lfo.connect(depth).connect(pan.pan); lfo.start()
      rotaryIn.connect(drive).connect(pan).connect(rotaryOut).connect(master)
      this.rotary = { input: rotaryIn, output: rotaryOut, lfo, nodes: [rotaryIn, rotaryOut, pan, drive, depth] }
      for (const id of ['A', 'B'] as const) { levels[id].gain.value = this.state().layers[id].level; levels[id].connect(master) }
      this.applyState()
      void ctx.resume().catch(() => this.status('error'))
      this.loading = this.loadSamples(ctx)
      return ctx
    } catch { this.status('error'); return null }
  }
  private async loadSamples(ctx: AudioContext): Promise<void> {
    const paths = new Set<string>()
    for (const type of recordedTypes) for (const root of sampleRoots[type]) { paths.add(root.soft); paths.add(root.hard) }
    const results = await Promise.allSettled([...paths].map(async path => {
      const response = await this.fetchAsset(`${import.meta.env.BASE_URL}${path}`)
      if (!response.ok) throw new Error(path)
      this.buffers.set(path, await ctx.decodeAudioData(await response.arrayBuffer()))
    }))
    if (this.closed) return
    this.failed = results.some(r => r.status === 'rejected')
    this.status(this.failed ? 'fallback' : 'ready')
  }
  start(note: number, velocity: number): Voice { return this.startLayer('A', note, velocity) }
  startLayer(layerId: LayerId | VoiceKey, note: number, velocity: number): Voice {
    if (layerId.startsWith('Organ:') || layerId.startsWith('Synth:')) return this.startOther(layerId as VoiceKey, note, velocity)
    layerId = layerId.replace('Piano:', '') as LayerId
    const ctx = this.ensure(); if (!ctx || !this.buses) return { release() {}, stop() {} }
    const layer = this.state().layers[layerId], now = ctx.currentTime, output = ctx.createGain(), shape = ctx.createBiquadFilter()
    const amplitude = velocityGain(velocity, layer)
    output.gain.setValueAtTime(.0001, now); output.gain.exponentialRampToValueAtTime(Math.max(.0002, amplitude * .38), now + .008)
    output.gain.exponentialRampToValueAtTime(Math.max(.0002, amplitude * .24), now + .16)
    shape.type = layer.timbre.startsWith('Dyno') ? 'peaking' : 'lowpass'; shape.frequency.value = layer.timbre === 'Soft' ? 1800 : layer.timbre === 'Mid' ? 4500 : layer.timbre === 'Bright' ? 12000 : layer.timbre === 'Dyno 1' ? 2200 : layer.timbre === 'Dyno 2' ? 5100 : 9500
    shape.Q.value = layer.timbre === 'Mid' ? 2 : layer.timbre.startsWith('Dyno') ? 1.5 : 0.7; shape.gain.value = layer.timbre === 'Dyno 1' ? 8 : layer.timbre === 'Dyno 2' ? 12 : 0; output.connect(shape).connect(this.buses[layerId])
    const sources: (OscillatorNode | AudioBufferSourceNode)[] = []
    const voiceNodes: AudioNode[] = []
    const voices = layer.unison ? layer.unison + 1 : 1
    const recorded = recordedTypes.includes(layer.type as typeof recordedTypes[number])
    const root = recorded ? nearestRoot(layer.type as keyof typeof sampleRoots, note) : null
    const path = root ? (velocity <= 80 ? root.soft : root.hard) : ''
    const sample = path ? this.buffers.get(path) : undefined
    for (let i = 0; i < voices; i++) {
      const detune = (voices === 1 ? 0 : (i - (voices - 1) / 2) * (2 + layer.unison * 3)) + (layer.pstick ? (this.state().pitch - .5) * 400 : 0)
      const source = sample ? ctx.createBufferSource() : ctx.createOscillator()
      if (sample) { const player = source as AudioBufferSourceNode; player.buffer = sample; const sourceNote = velocity <= 80 ? root!.softNote ?? root!.note : root!.hardNote ?? root!.note; player.playbackRate.value = 2 ** ((note - sourceNote) / 12); player.detune.value = detune }
      else { const oscillator = source as OscillatorNode; oscillator.type = layer.type === 'Clav' ? 'sawtooth' : layer.type === 'Digital' ? 'triangle' : layer.type === 'Misc' ? 'sine' : 'sine'; oscillator.frequency.value = 440 * 2 ** ((note - 69) / 12); oscillator.detune.value = detune }
      const unitGain = ctx.createGain(), pan = ctx.createStereoPanner(); unitGain.gain.value = 1 / voices; pan.pan.value = voices === 1 ? 0 : ((i / (voices - 1)) * 2 - 1) * (.18 + layer.unison * .16); source.connect(unitGain).connect(pan).connect(output); source.start(now); sources.push(source); voiceNodes.push(unitGain, pan)
      this.pitched.add({ source, layer: layerId, base: detune - (layer.pstick ? (this.state().pitch - .5) * 400 : 0) })
    }
    if (layer.stringRes) { const resonance = ctx.createOscillator(), g = ctx.createGain(); resonance.frequency.value = 440 * 2 ** ((note - 57) / 12); g.gain.value = this.live.size ? .028 : .012; resonance.connect(g).connect(output); resonance.start(now); sources.push(resonance); voiceNodes.push(g) }
    let done = false
    const finish = (seconds: number) => { if (done) return; done = true; ramp(output.gain, .0001, ctx.currentTime, seconds); sources.forEach(source => { try { source.stop(ctx.currentTime + seconds + .02) } catch { /* already ended */ } }); const timer = window.setTimeout(() => { sources.forEach(source => source.disconnect()); voiceNodes.forEach(node => node.disconnect()); for (const p of this.pitched) if (sources.includes(p.source)) this.pitched.delete(p); output.disconnect(); shape.disconnect(); this.live.delete(voice); this.timers.delete(timer) }, Math.ceil((seconds + .08) * 1000)); this.timers.add(timer) }
    const voice: Voice = { release: () => finish(layer.softRelease && layer.type !== 'Clav' ? .6 : .24), stop: () => finish(.008) }
    this.live.add(voice); return voice
  }
  private startOther(key: VoiceKey, note: number, velocity: number): Voice {
    const ctx = this.ensure(), bus = this.extraBuses[key]; if (!ctx || !bus) return { release() {}, stop() {} }
    const state = this.state(), now = ctx.currentTime, output = ctx.createGain(), filter = ctx.createBiquadFilter(), sources: OscillatorNode[] = [], nodes: AudioNode[] = []
    const base = 440 * 2 ** ((note - 69) / 12), isOrgan = key.startsWith('Organ:'), id = key.split(':')[1] as LayerId
    const organ: OrganLayer | undefined = isOrgan ? { ...state.organ[id], drawbars: state.organ[id].drawbars.map((bar, i) => morphed(bar / 8, state.morphs, `${key}.drawbars.${i}`, state.wheel, state.pedal) * 8) } : undefined
    const synth: SynthLayer | undefined = !isOrgan ? { ...state.synth[id as 'A' | 'B' | 'C'], oscCtrl: morphed(state.synth[id as 'A' | 'B' | 'C'].oscCtrl, state.morphs, `${key}.oscCtrl`, state.wheel, state.pedal), cutoff: morphed(state.synth[id as 'A' | 'B' | 'C'].cutoff, state.morphs, `${key}.cutoff`, state.wheel, state.pedal), resonance: morphed(state.synth[id as 'A' | 'B' | 'C'].resonance, state.morphs, `${key}.resonance`, state.wheel, state.pedal), lfoRate: morphed(state.synth[id as 'A' | 'B' | 'C'].lfoRate, state.morphs, `${key}.lfoRate`, state.wheel, state.pedal) } : undefined
    const add = (frequency: number, amplitude: number, type: OscillatorType = 'sine', detune = 0) => { const osc = ctx.createOscillator(), gain = ctx.createGain(); osc.type = type; osc.frequency.value = Math.min(18000, frequency); if (synth && synth.glide > 0 && synth.voiceMode !== 'Poly' && this.synthLastFrequency.has(key)) { osc.frequency.setValueAtTime(this.synthLastFrequency.get(key)!, now); osc.frequency.linearRampToValueAtTime(frequency, now + synth.glide) } osc.detune.value = detune; gain.gain.value = amplitude; osc.connect(gain).connect(output); osc.start(now); sources.push(osc); nodes.push(gain); return osc }
    if (organ) {
      const model = organ.model, ratios = model.startsWith('Pipe') ? [.5, 1, 2, 3, 4, 5, 6, 7, 8] : model === 'Vox' ? [.5, 1, 2, 3, 4, 5, 6, 8, 10] : [.5, 1.5, 1, 2, 3, 4, 5, 6, 8]
      organ.drawbars.forEach((drawbar, i) => { if (!drawbar || (model === 'B3 Bass' && i > 2)) return; const amp = model === 'Farf' ? (drawbar >= 4 ? 1 : 0) : drawbar / 8; const tone = model === 'Vox' ? 'square' : model === 'Farf' ? 'sawtooth' : 'sine'; add(base * ratios[i] * (model.startsWith('Pipe') ? 1 + i * .0008 : 1), amp * (model === 'Vox' ? .055 : model === 'Farf' ? .035 : .095) / (1 + i * .13), tone) })
      if (organ.percussion && model === 'B3') { const p = add(base * (organ.percussionThird ? 3 : 2), organ.percussionSoft ? .035 : .09); const g = nodes[nodes.length - 1] as GainNode; g.gain.setValueAtTime(g.gain.value, now); g.gain.exponentialRampToValueAtTime(.0001, now + (organ.percussionFast ? .15 : .7)); p.onended = null }
      if (organ.keyClick && model === 'B3') { const g = ctx.createGain(); g.gain.setValueAtTime(.04, now); g.gain.exponentialRampToValueAtTime(.0001, now + .025); add(base * 16, .5, 'square').disconnect(); sources[sources.length - 1].connect(g).connect(output); nodes.push(g) }
      if (organ.vibrato) { const lfo = ctx.createOscillator(), depth = ctx.createGain(); lfo.frequency.value = 4 + Number(organ.chorus[1]); depth.gain.value = organ.chorus.startsWith('C') ? 2 + Number(organ.chorus[1]) * 2 : 4 + Number(organ.chorus[1]) * 4; lfo.connect(depth); sources.forEach(source => depth.connect(source.detune)); lfo.start(now); sources.push(lfo); nodes.push(depth) }
      filter.type = model === 'Vox' ? 'bandpass' : model === 'Farf' ? 'highpass' : 'lowpass'; filter.frequency.value = model === 'Vox' ? 2800 : model === 'Farf' ? 500 : 12000
      output.gain.setValueAtTime(.0001, now); output.gain.exponentialRampToValueAtTime(Math.max(.001, velocity / 127), now + .015)
    } else if (synth) {
      const wave = synth.waveform, ctrl = synth.oscCtrl, freq = base * 2 ** ((synth.coarse + synth.fine / 100) / 12)
      const kind: OscillatorType = wave.includes('Triangle') ? 'triangle' : wave.includes('Square') || wave.includes('Pulse') ? 'square' : wave.includes('Saw') ? 'sawtooth' : 'sine'
      if (wave === 'White Noise') { const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), data = buffer.getChannelData(0); for (let i = 0; i < data.length; i++) data[i] = Math.sin(i * 78.233) * Math.cos(i * 12.9898); const noise = ctx.createBufferSource(); noise.buffer = buffer; noise.loop = true; noise.connect(output); noise.start(now); nodes.push(noise); sources.push(noise as unknown as OscillatorNode) }
      else if (wave.startsWith('FM')) { const carrier = add(freq, .28), mod = ctx.createOscillator(), depth = ctx.createGain(); mod.frequency.value = freq * 2; depth.gain.value = ctrl * freq * 3; mod.connect(depth).connect(carrier.frequency); mod.start(now); sources.push(mod); nodes.push(depth) }
      else if (wave.startsWith('Sync')) { add(freq, .2, kind); add(freq * (1.05 + ctrl * 2), .12, kind) }
      else if (wave.startsWith('Multi') || wave.startsWith('Super')) { const count = wave.startsWith('Super') ? 5 : 3; for (let i = 0; i < count; i++) add(freq * (wave.includes('8ve') && i === count - 1 ? 2 : 1), .34 / count, kind, (i - (count - 1) / 2) * ctrl * (wave.startsWith('Super') ? 38 : 22)) }
      else if (wave.startsWith('Pulse')) { add(freq, .3, kind); add(freq * (wave === 'Pulse 10' ? 3 : 2), wave === 'Pulse 10' ? .2 : .1, kind) }
      else add(freq, .3, kind)
      for (let i = 0; i < synth.unison; i++) add(freq, .12 / (i + 1), kind, (i + 1) * 9)
      this.synthLastFrequency.set(key, freq)
      filter.type = synth.filterType === 'HP' ? 'highpass' : synth.filterType === 'BP' ? 'bandpass' : 'lowpass'; filter.frequency.value = 80 + 15000 * synth.cutoff ** 2 + note * synth.tracking * 8; filter.Q.value = .5 + synth.resonance * 18 + synth.drive * .5
      if (synth.filterType === 'LP24') { const second = ctx.createBiquadFilter(); second.type = 'lowpass'; second.frequency.value = filter.frequency.value; second.Q.value = filter.Q.value; filter.connect(second).connect(bus); nodes.push(second) }
      if (synth.drive) { const drive = ctx.createWaveShaper(), curve = new Float32Array(512); for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((i / 255.5 - 1) * (1 + synth.drive * 2)); drive.curve = curve as Float32Array<ArrayBuffer>; output.connect(drive).connect(filter); nodes.push(drive) }
      const attack = .005 + synth.ampEnv.attack * 2, decay = .02 + synth.ampEnv.decay * 2, ampVelocity = synth.ampEnv.velocity ? velocity / 127 : .75
      output.gain.setValueAtTime(.0001, now); output.gain.exponentialRampToValueAtTime(Math.max(.001, ampVelocity * .7), now + attack); output.gain.exponentialRampToValueAtTime(Math.max(.001, ampVelocity * .4), now + attack + decay)
      filter.frequency.setValueAtTime(Math.max(30, filter.frequency.value * (1 + synth.filterEnv.amount * 2 * (synth.filterEnv.velocity ? velocity / 127 : 1))), now); filter.frequency.linearRampToValueAtTime(80 + 15000 * synth.cutoff ** 2, now + synth.filterEnv.attack + synth.filterEnv.decay + .02)
      if (synth.oscEnv.amount) { const env = synth.oscEnv, targets = synth.oscEnvToPitch ? sources : sources.slice(1); targets.forEach(source => { source.detune.setValueAtTime(env.amount * 2400 * (env.velocity ? velocity / 127 : 1), now); source.detune.linearRampToValueAtTime(0, now + env.attack + env.decay + .02) }) }
      if (synth.lfoTarget !== 'Off') { const lfo = ctx.createOscillator(), depth = ctx.createGain(); lfo.type = synth.lfoWave === 'Triangle' ? 'triangle' : synth.lfoWave === 'Square' || synth.lfoWave === 'Sample & Hold' ? 'square' : 'sawtooth'; lfo.frequency.value = synth.lfoSync ? state.tempo / 60 : .2 + synth.lfoRate * 12; depth.gain.value = synth.lfoAmount * (synth.lfoTarget === 'Filter Freq' ? 3000 : synth.lfoTarget === 'Osc Ctrl' ? 300 : 80); lfo.connect(depth); if (synth.lfoTarget === 'Filter Freq') depth.connect(filter.frequency); else sources.forEach(source => depth.connect(source.detune)); lfo.start(now); sources.push(lfo); nodes.push(depth) }
      if (synth.vibrato !== 'Off') { const lfo = ctx.createOscillator(), depth = ctx.createGain(); lfo.frequency.value = synth.vibratoRate; depth.gain.value = synth.vibratoAmount * (synth.vibrato === 'Wheel' ? state.wheel : 1) * 45; lfo.connect(depth); sources.forEach(source => depth.connect(source.detune)); lfo.start(now); sources.push(lfo); nodes.push(depth) }
    }
    if (!synth?.drive) output.connect(filter)
    if (synth?.filterType !== 'LP24') filter.connect(bus)
    let done = false
    const finish = (seconds: number) => { if (done) return; done = true; ramp(output.gain, .0001, ctx.currentTime, seconds); sources.forEach(source => { try { source.stop(ctx.currentTime + seconds + .02) } catch { /* ended */ } }); const timer = window.setTimeout(() => { sources.forEach(source => source.disconnect()); nodes.forEach(node => node.disconnect()); output.disconnect(); filter.disconnect(); this.live.delete(voice); this.timers.delete(timer) }, Math.ceil((seconds + .08) * 1000)); this.timers.add(timer) }
    const voice: Voice = { release: () => finish(synth ? .02 + synth.ampEnv.release * 3 : .05), stop: () => finish(.008) }; this.live.add(voice); return voice
  }
  applyState(): void {
    const ctx = this.ctx, buses = this.buses, levels = this.levels; if (!ctx || !buses || !levels || !this.master) return
    const state = this.state(); ramp(this.master.gain, state.master, ctx.currentTime)
    for (const item of this.pitched) ramp(item.source.detune, item.base + (state.layers[item.layer].pstick ? (state.pitch - .5) * 400 : 0), ctx.currentTime)
    if (this.rotary) { const speed = morphed(state.rotarySpeed, state.morphs, 'rotarySpeed', state.wheel, state.pedal); ramp(this.rotary.lfo.frequency, state.rotaryFast ? 5.8 : .7 + speed * 1.1, ctx.currentTime, .3); const drive = this.rotary.nodes[3] as WaveShaperNode; const curve = new Float32Array(512); for (let i = 0; i < 512; i++) curve[i] = Math.tanh(((i / 255.5) - 1) * (1 + state.rotaryDrive * 5)); drive.curve = curve as Float32Array<ArrayBuffer> }
    for (const id of ['A', 'B'] as const) {
      ramp(levels[id].gain, state.layers[id].enabled && state.pianoOn ? morphed(state.layers[id].level, state.morphs, `layers.${id}.level`, state.wheel, state.pedal) : 0, ctx.currentTime)
      const old = this.chains[id], fresh = makeChain(ctx, state.layers[id], state.effectsOn, state.clockSync ? state.tempo : undefined)
      fresh.output.gain.setValueAtTime(0, ctx.currentTime); ramp(fresh.output.gain, 1, ctx.currentTime, .04)
      buses[id].connect(fresh.input)
      const toRotary = state.rotaryOn && state.effectsOn && state.layers[id].units.ampEq.on && state.layers[id].units.ampEq.type === 'To Rotary'
      if (toRotary && this.rotary) { fresh.output.connect(levels[id]); levels[id].disconnect(); levels[id].connect(this.rotary.input) }
      else { fresh.output.connect(levels[id]); levels[id].disconnect(); levels[id].connect(this.master) }
      this.chains[id] = fresh
      if (old) { ramp(old.output.gain, 0, ctx.currentTime, .04); const timer = window.setTimeout(() => { buses[id].disconnect(old.input); old.dispose(); this.timers.delete(timer) }, 80); this.timers.add(timer) }
    }
    for (const key of ['Organ:A', 'Organ:B', 'Synth:A', 'Synth:B', 'Synth:C'] as VoiceKey[]) {
      const bus = this.extraBuses[key], level = this.extraLevels[key]; if (!bus || !level) continue
      const [section, layer] = key.split(':') as ['Organ' | 'Synth', 'A' | 'B' | 'C']
      const setting = section === 'Organ' ? state.organ[layer as LayerId] : state.synth[layer]
      const units = section === 'Organ' ? state.organUnits : state.synth[layer].units
      const amount = morphed(setting.level, state.morphs, `${key}.level`, state.wheel, state.pedal)
      ramp(level.gain, setting.enabled && (section === 'Organ' ? state.organOn : state.synthOn) ? amount : 0, ctx.currentTime)
      if (section === 'Organ') { bus.disconnect(); bus.connect(level); level.disconnect(); continue }
      const old = this.extraChains[key], fresh = makeChain(ctx, { units } as LayerState, state.effectsOn, state.clockSync ? state.tempo : undefined); fresh.output.gain.setValueAtTime(0, ctx.currentTime); ramp(fresh.output.gain, 1, ctx.currentTime, .04); bus.connect(fresh.input); fresh.output.connect(level)
      level.disconnect(); level.connect(this.master)
      this.extraChains[key] = fresh
      if (old) { ramp(old.output.gain, 0, ctx.currentTime, .04); const timer = window.setTimeout(() => { bus.disconnect(old.input); old.dispose(); this.timers.delete(timer) }, 80); this.timers.add(timer) }
    }
    const oldOrgan = this.organChain, organChain = makeChain(ctx, { units: state.organUnits } as LayerState, state.effectsOn, state.clockSync ? state.tempo : undefined)
    organChain.output.gain.setValueAtTime(0, ctx.currentTime); ramp(organChain.output.gain, 1, ctx.currentTime, .04)
    this.extraLevels['Organ:A']?.connect(organChain.input); this.extraLevels['Organ:B']?.connect(organChain.input)
    organChain.output.connect(state.rotaryOn && this.rotary ? this.rotary.input : this.master)
    this.organChain = organChain
    if (oldOrgan) { ramp(oldOrgan.output.gain, 0, ctx.currentTime, .04); const timer = window.setTimeout(() => { this.extraLevels['Organ:A']?.disconnect(oldOrgan.input); this.extraLevels['Organ:B']?.disconnect(oldOrgan.input); oldOrgan.dispose(); this.timers.delete(timer) }, 80); this.timers.add(timer) }
  }
  get liveVoiceCount(): number { return this.live.size }
  get contextCount(): number { return this.ctx ? 1 : 0 }
  async whenLoaded(): Promise<void> { await this.loading }
  async close(): Promise<void> { this.closed = true; for (const voice of this.live) voice.stop(); for (const timer of this.timers) clearTimeout(timer); this.timers.clear(); Object.values(this.chains).forEach(c => c?.dispose()); Object.values(this.extraChains).forEach(c => c?.dispose()); this.organChain?.dispose(); this.rotary?.lfo.stop(); this.rotary?.nodes.forEach(n => n.disconnect()); if (this.buses) Object.values(this.buses).forEach(n => n.disconnect()); if (this.levels) Object.values(this.levels).forEach(n => n.disconnect()); Object.values(this.extraBuses).forEach(n => n?.disconnect()); Object.values(this.extraLevels).forEach(n => n?.disconnect()); this.master?.disconnect(); this.limiter?.disconnect(); await this.ctx?.close(); this.ctx = null; this.live.clear(); this.pitched.clear(); this.synthLastFrequency.clear() }
}
