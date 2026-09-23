import type { Voice, VoiceBackend } from './piano'

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
export interface LayerState { enabled: boolean; level: number; octave: number; sustped: boolean; pstick: boolean; type: PianoType; kbTouch: 'Heavy' | 'Medium' | 'Light'; dynComp: 0 | 1 | 2 | 3; timbre: string; unison: 0 | 1 | 2 | 3; softRelease: boolean; stringRes: boolean; units: Record<UnitId, UnitState> }
export interface StageState { pianoOn: boolean; focus: LayerId; fxFocus: LayerId; fxSection: 'Piano' | 'Organ' | 'Synth'; group: boolean; effectsOn: boolean; master: number; pitch: number; rotaryOn: boolean; rotaryFast: boolean; rotarySpeed: number; rotaryDrive: number; layers: Record<LayerId, LayerState> }

const freshUnits = (): Record<UnitId, UnitState> => Object.fromEntries((Object.keys(unitTypes) as UnitId[]).map(id => [id, { on: false, type: unitTypes[id][0], amount: 0.5, rate: 0.5, feedback: 0.35, wet: 0.35, filter: 'Off', fast: false, bright: true, global: false }])) as Record<UnitId, UnitState>
const freshLayer = (enabled: boolean): LayerState => ({ enabled, level: 0.68, octave: 0, sustped: true, pstick: false, type: 'Grand', kbTouch: 'Medium', dynComp: 0, timbre: 'Off', unison: 0, softRelease: false, stringRes: false, units: freshUnits() })
export function initialStageState(): StageState { return { pianoOn: true, focus: 'A', fxFocus: 'A', fxSection: 'Piano', group: false, effectsOn: true, master: 0.68, pitch: 0.5, rotaryOn: false, rotaryFast: false, rotarySpeed: 0.5, rotaryDrive: 0.25, layers: { A: freshLayer(true), B: freshLayer(false) } } }
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

interface LayerVoice { voice: Voice; layer: LayerId; released: boolean }
interface Press { source: string; note: number; held: boolean; voices: LayerVoice[] }

/** Owns a voice per layer for each physical press. Sustain only retains voices routed by SUSTPED. */
export class StagePianoEngine {
  private presses: Press[] = []
  private sustain = new Set<string>()
  constructor(private backend: (layer: LayerId, note: number, velocity: number) => Voice, private state: () => StageState, readonly maxVoices = 24) {}
  noteOn(source: string, note: number, velocity = 100): void {
    if (!Number.isInteger(note) || note < 0 || note > 127 || velocity <= 0) return
    if (this.presses.length >= this.maxVoices) this.stopPress(this.presses.shift()!)
    const voices: LayerVoice[] = []
    for (const layer of ['A', 'B'] as const) {
      const setting = this.state().layers[layer]
      if (this.state().pianoOn && setting.enabled) voices.push({ voice: this.backend(layer, Math.max(0, Math.min(127, note + setting.octave)), velocity), layer, released: false })
    }
    if (voices.length) this.presses.push({ source, note, held: true, voices })
  }
  noteOff(source: string, note: number): void {
    const press = this.presses.find(p => p.source === source && p.note === note && p.held)
    if (!press) return
    press.held = false
    for (const voice of press.voices) if (!this.sustain.size || !this.state().layers[voice.layer].sustped) this.releaseVoice(voice)
    this.prune()
  }
  setSustain(source: string, down: boolean): void {
    if (down) this.sustain.add(source); else this.sustain.delete(source)
    if (!this.sustain.size) { for (const press of this.presses) if (!press.held) press.voices.forEach(v => this.releaseVoice(v)); this.prune() }
  }
  disconnectSource(prefix: string): void { this.presses = this.presses.filter(p => { if (!p.source.startsWith(prefix)) return true; this.stopPress(p); return false }); for (const source of this.sustain) if (source.startsWith(prefix)) this.sustain.delete(source) }
  allNotesOff(): void { this.presses.forEach(p => this.stopPress(p)); this.presses = []; this.sustain.clear() }
  stopLayer(layer: LayerId): void { for (const press of this.presses) for (const v of press.voices) if (v.layer === layer && !v.released) { v.voice.stop(); v.released = true }; this.prune() }
  releaseUnrouted(layer: LayerId): void { for (const press of this.presses) if (!press.held) for (const v of press.voices) if (v.layer === layer) this.releaseVoice(v); this.prune() }
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
function makeChain(ctx: AudioContext, layer: LayerState, effectsOn: boolean): Chain {
  const input = ctx.createGain(), output = ctx.createGain(), units: Graph[] = []
  let tail: AudioNode = input
  if (effectsOn) for (const id of Object.keys(unitTypes) as UnitId[]) if (layer.units[id].on) { const unit = createEffectUnit(ctx, id, layer.units[id]); tail.connect(unit.input); tail = unit.output; units.push(unit) }
  tail.connect(output)
  return { input, output, dispose() { units.forEach(u => u.dispose()); input.disconnect(); output.disconnect() } }
}

export type StageAudioStatus = 'idle' | 'loading' | 'ready' | 'fallback' | 'error'
/** The production graph uses one context and stable buses; graph replacements crossfade on parameter changes. */
export class StageAudio implements VoiceBackend {
  private ctx: AudioContext | null = null
  private buses: Record<LayerId, GainNode> | null = null
  private levels: Record<LayerId, GainNode> | null = null
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
  private timers = new Set<number>()
  constructor(private state: () => StageState, private status: (s: StageAudioStatus) => void, private fetchAsset: typeof fetch = fetch, private contextFactory: () => AudioContext = () => new AudioContext()) {}
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
  startLayer(layerId: LayerId, note: number, velocity: number): Voice {
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
  applyState(): void {
    const ctx = this.ctx, buses = this.buses, levels = this.levels; if (!ctx || !buses || !levels || !this.master) return
    const state = this.state(); ramp(this.master.gain, state.master, ctx.currentTime)
    for (const item of this.pitched) ramp(item.source.detune, item.base + (state.layers[item.layer].pstick ? (state.pitch - .5) * 400 : 0), ctx.currentTime)
    if (this.rotary) { ramp(this.rotary.lfo.frequency, state.rotaryFast ? 5.8 : .7 + state.rotarySpeed * 1.1, ctx.currentTime, .3); const drive = this.rotary.nodes[3] as WaveShaperNode; const curve = new Float32Array(512); for (let i = 0; i < 512; i++) curve[i] = Math.tanh(((i / 255.5) - 1) * (1 + state.rotaryDrive * 5)); drive.curve = curve as Float32Array<ArrayBuffer> }
    for (const id of ['A', 'B'] as const) {
      ramp(levels[id].gain, state.layers[id].enabled && state.pianoOn ? state.layers[id].level : 0, ctx.currentTime)
      const old = this.chains[id], fresh = makeChain(ctx, state.layers[id], state.effectsOn)
      fresh.output.gain.setValueAtTime(0, ctx.currentTime); ramp(fresh.output.gain, 1, ctx.currentTime, .04)
      buses[id].connect(fresh.input)
      const toRotary = state.rotaryOn && state.effectsOn && state.layers[id].units.ampEq.on && state.layers[id].units.ampEq.type === 'To Rotary'
      if (toRotary && this.rotary) { fresh.output.connect(levels[id]); levels[id].disconnect(); levels[id].connect(this.rotary.input) }
      else { fresh.output.connect(levels[id]); levels[id].disconnect(); levels[id].connect(this.master) }
      this.chains[id] = fresh
      if (old) { ramp(old.output.gain, 0, ctx.currentTime, .04); const timer = window.setTimeout(() => { buses[id].disconnect(old.input); old.dispose(); this.timers.delete(timer) }, 80); this.timers.add(timer) }
    }
  }
  get liveVoiceCount(): number { return this.live.size }
  get contextCount(): number { return this.ctx ? 1 : 0 }
  async whenLoaded(): Promise<void> { await this.loading }
  async close(): Promise<void> { this.closed = true; for (const voice of this.live) voice.stop(); for (const timer of this.timers) clearTimeout(timer); this.timers.clear(); Object.values(this.chains).forEach(c => c?.dispose()); this.rotary?.lfo.stop(); this.rotary?.nodes.forEach(n => n.disconnect()); if (this.buses) Object.values(this.buses).forEach(n => n.disconnect()); if (this.levels) Object.values(this.levels).forEach(n => n.disconnect()); this.master?.disconnect(); this.limiter?.disconnect(); await this.ctx?.close(); this.ctx = null; this.live.clear(); this.pitched.clear() }
}
