// Organ engines (organ spec models): live synthesis in the shared AudioContext, one oscillator set
// per key. Four distinct engines, not renamed copies of one oscillator:
//   B3    tonewheel — nine pure sines at the drawbar footages, top-octave foldback, key click,
//         single-triggered 2nd/3rd harmonic percussion, scanner vibrato/chorus.
//   Vox   transistor — square-wave divider tones, mixture drawbars II/III/IV, and drawbar 9 mixing
//         a filtered (∿) and unfiltered (–) tone at layer level.
//   Farf  transistor — nine on/off tab registers with their own waveforms (flute, strings, oboe,
//         trumpet), pulled past half = on.
//   Pipe  flue pipes — slow "speech" attack, chiff noise, release tail; chorus = celeste detuning.
// B3 Bass reuses B3 limited to 16'/8'; Pipe 2 reuses Pipe with a brighter principal wave.
import { holdParam, rampTo } from './fx/common'
import { midiToHz } from './instruments'
import type { AudioContextLike, BiquadLike, BufferLike, DelayLike, GainLike, NodeLike, OscillatorLike, PeriodicWaveLike, ScheduledSourceLike } from './webAudioTypes'
import { farfRegisterOn, type OrganLayerState, type OrganModel, type VibType } from '../model/organState'

/** Drawbar footage ratios to the 8' fundamental: 16', 5⅓', 8', 4', 2⅔', 2', 1⅗', 1⅓', 1'. */
export const B3_RATIOS = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8]
/** Vox drawbars: 16', 8', 4', 2', mixtures II/III/IV (bar 8 unused, bar 9 = tone mix). */
export const VOX_RATIOS: number[][] = [[0.5], [1], [2], [4], [3, 5], [4, 6, 8], [8, 10, 12, 16], [], []]
/** Farf registers: Bass 16, Strings 16, Flute 8, Oboe 8, Trumpet 8, Strings 8, Flute 4, Strings 4, 2⅔. */
export const FARF_REGISTERS: { ratio: number; wave: FarfWave; gain: number }[] = [
  { ratio: 0.5, wave: 'flute', gain: 1 },
  { ratio: 0.5, wave: 'strings', gain: 0.7 },
  { ratio: 1, wave: 'flute', gain: 0.9 },
  { ratio: 1, wave: 'oboe', gain: 0.8 },
  { ratio: 1, wave: 'trumpet', gain: 0.8 },
  { ratio: 1, wave: 'strings', gain: 0.6 },
  { ratio: 2, wave: 'flute', gain: 0.7 },
  { ratio: 2, wave: 'strings', gain: 0.5 },
  { ratio: 3, wave: 'flute', gain: 0.5 },
]
type FarfWave = 'flute' | 'strings' | 'oboe' | 'trumpet'
type CustomWave = FarfWave | 'pipe' | 'principal'

/** Harmonic amplitudes (1-based) of the custom organ waveforms. */
const HARMONICS: Record<CustomWave, number[]> = {
  flute: [1, 0.12, 0.05],
  strings: Array.from({ length: 24 }, (_, i) => (i === 0 ? 0.6 : 1 / (i + 1) ** 0.85)),
  oboe: Array.from({ length: 16 }, (_, i) => [0.35, 0.5, 1, 0.8, 0.55, 0.3][i] ?? 0.3 / (i + 1)),
  trumpet: Array.from({ length: 20 }, (_, i) => 1 / (i + 1) ** 0.55),
  pipe: [1, 0.22, 0.09, 0.05, 0.02],
  principal: [1, 0.5, 0.33, 0.25, 0.18, 0.12, 0.08, 0.05],
}

/** Drawbar position 0…8 → amplitude (−3 dB per step, 0 = silent). */
export const drawbarAmp = (v: number) => (v <= 0 ? 0 : Math.pow(10, (-(8 - v) * 3) / 20))

/** Vibrato/chorus scanner depth (s of delay modulation) for depth 1…3. */
export const SCANNER_DEPTH = [0.00022, 0.00045, 0.0008]
export const SCANNER_HZ = 6.9
/** Pipe chorus = celeste: a second rank detuned by these cents for C1…C3. */
export const CELESTE_CENTS = [4, 8, 14]

const VOICE_GAIN = 0.075
const TONEWHEEL_FOLDBACK_HZ = 5900

export interface OrganShared {
  waves: Map<CustomWave, PeriodicWaveLike>
  click: BufferLike
}

/** Per-context shared material: custom periodic waves and the generated key-click/chiff noise. */
export function organShared(ctx: AudioContextLike): OrganShared {
  const waves = new Map<CustomWave, PeriodicWaveLike>()
  for (const [name, amps] of Object.entries(HARMONICS) as [CustomWave, number[]][]) {
    const real = new Float32Array(amps.length + 1)
    const imag = new Float32Array(amps.length + 1)
    amps.forEach((a, i) => (imag[i + 1] = a))
    waves.set(name, ctx.createPeriodicWave(real, imag))
  }
  // 25 ms of decaying deterministic noise (a generated buffer, not a recording).
  const n = Math.round(ctx.sampleRate * 0.025)
  const click = ctx.createBuffer(1, n, ctx.sampleRate)
  const data = new Float32Array(n)
  let seed = 0x2545f491
  for (let i = 0; i < n; i++) {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    data[i] = ((seed >>> 0) / 0xffffffff - 0.5) * 2 * Math.exp(-i / (n / 5))
  }
  click.copyToChannel(data, 0)
  return { waves, click }
}

const isB3 = (m: OrganModel) => m === 'b3' || m === 'b3bass'
const isPipe = (m: OrganModel) => m === 'pipe1' || m === 'pipe2'

/** Effective drawbar level of bar i for a model (B3 Bass: 16' and 8' only; Farf: switches; Vox bar 8 unused). */
export function barLevel(model: OrganModel, bars: readonly number[], i: number): number {
  if (model === 'b3bass') return i === 0 || i === 2 ? drawbarAmp(bars[i]) : 0
  if (model === 'farf') return farfRegisterOn(bars[i]) ? 0.6 : 0
  if (model === 'vox') return i >= 7 ? 0 : drawbarAmp(bars[i])
  return drawbarAmp(bars[i])
}

const depthIndex = (t: VibType) => Number(t[1]) - 1
const isChorus = (t: VibType) => t[0] === 'C'

/**
 * One organ layer's pre-chain: voices → Vox tone mix (filtered/unfiltered, drawbar 9) → scanner
 * vibrato/chorus → layer level → the shared organ chain.
 */
export class OrganLayerGraph {
  readonly input: GainLike
  readonly output: GainLike
  readonly level: GainLike
  private readonly raw: GainLike
  private readonly filtered: GainLike
  private readonly lp: BiquadLike
  private readonly dry: GainLike
  private readonly wet: GainLike
  private readonly scanner: DelayLike
  private readonly lfo: OscillatorLike
  private readonly depth: GainLike
  private readonly nodes: NodeLike[]

  constructor(ctx: AudioContextLike) {
    const g = (v: number) => {
      const n = ctx.createGain()
      n.gain.value = v
      return n
    }
    this.input = g(1)
    this.raw = g(1)
    this.filtered = g(0)
    this.lp = ctx.createBiquadFilter()
    this.lp.type = 'lowpass'
    this.lp.frequency.value = 900
    this.lp.Q.value = 0.8
    const tone = g(1)
    this.input.connect(this.raw)
    this.input.connect(this.lp)
    this.lp.connect(this.filtered)
    this.raw.connect(tone)
    this.filtered.connect(tone)
    this.dry = g(1)
    this.wet = g(0)
    this.scanner = ctx.createDelay(0.02)
    this.scanner.delayTime.value = 0.003
    this.lfo = ctx.createOscillator()
    this.lfo.type = 'sine'
    this.lfo.frequency.value = SCANNER_HZ
    this.depth = g(0)
    this.lfo.connect(this.depth)
    this.depth.connect(this.scanner.delayTime)
    this.lfo.start(ctx.currentTime)
    tone.connect(this.dry)
    tone.connect(this.scanner)
    this.scanner.connect(this.wet)
    this.level = g(1)
    this.dry.connect(this.level)
    this.wet.connect(this.level)
    this.output = this.level
    this.nodes = [this.input, this.raw, this.filtered, this.lp, tone, this.dry, this.wet, this.scanner, this.lfo, this.depth, this.level]
  }

  /** Apply the layer's model tone mix and vibrato/chorus (per-layer on/off). */
  apply(layer: OrganLayerState, vibType: VibType, levelGain: number, now: number, initial: boolean): void {
    const set = (p: GainLike['gain'], v: number) => (initial ? p.setValueAtTime(v, now) : rampTo(p, v, now))
    set(this.level.gain, levelGain)
    // Vox drawbar 9: 0 = unfiltered (–), 8 = filtered (∿).
    const mix = layer.model === 'vox' ? layer.drawbars[8] / 8 : 0
    set(this.raw.gain, 1 - mix)
    set(this.filtered.gain, mix * 1.6)
    // B3/Vox/Farf: scanner vibrato (V) or vibrato mixed with dry (C). Pipe: V = vibrato, C = celeste
    // detuning in the voices. B3 Bass has no vibrato (organ spec models).
    const pipeChorus = (layer.model === 'pipe1' || layer.model === 'pipe2') && isChorus(vibType)
    const on = layer.vibOn && layer.model !== 'b3bass' && !pipeChorus
    // Vox and Farf only have vibrato: their C positions use the same depths as V (documented).
    const chorus = isChorus(vibType) && isB3(layer.model)
    const d = SCANNER_DEPTH[depthIndex(vibType)]
    set(this.depth.gain, on ? d : 0)
    set(this.dry.gain, !on ? 1 : chorus ? 0.72 : 0)
    set(this.wet.gain, !on ? 0 : chorus ? 0.72 : 1)
  }

  dispose(): void {
    try {
      this.lfo.stop()
    } catch {
      // already stopped
    }
    for (const n of this.nodes) n.disconnect()
  }
}

export interface OrganVoice {
  sources: ScheduledSourceLike[]
  nodes: NodeLike[]
  gain: GainLike
  model: OrganModel
  /** Live drawbar changes reach sounding notes. */
  setDrawbars(bars: readonly number[], now: number): void
  /** Pitch stick bend (cents) for layers with PSTICK on. */
  setBend(cents: number, now: number): void
  release(fast: boolean, now: number): number
}

export interface OrganVoiceOptions {
  layer: OrganLayerState
  vibType: VibType
  note: number
  gain: number
  /** Percussion fires only when no other key of the layer is held (single trigger, manual p. 20). */
  percussion: boolean
  bend: number
  dest: NodeLike
}

/** Build one organ key's oscillators. The caller owns lifecycle (onended, cleanup). */
export function startOrganVoice(ctx: AudioContextLike, shared: OrganShared, o: OrganVoiceOptions): OrganVoice {
  const t = ctx.currentTime
  const model = o.layer.model
  const f0 = midiToHz(o.note)
  const bendCents = 1200 * Math.log2(o.bend)
  const detunable: { o: OscillatorLike; base: number }[] = []
  const sources: ScheduledSourceLike[] = []
  const nodes: NodeLike[] = []
  const out = ctx.createGain()
  out.gain.setValueAtTime(0, t)
  const peak = VOICE_GAIN * o.gain
  if (isPipe(model)) out.gain.setTargetAtTime(peak, t, 0.028)
  else out.gain.linearRampToValueAtTime(peak, t + 0.004)
  out.connect(o.dest)
  nodes.push(out)

  const osc = (freq: number, wave: string | CustomWave, cents = 0): OscillatorLike => {
    const n = ctx.createOscillator()
    if (wave === 'sine' || wave === 'square' || wave === 'sawtooth' || wave === 'triangle') n.type = wave
    else n.setPeriodicWave(shared.waves.get(wave as CustomWave)!)
    n.frequency.value = freq
    n.detune.value = cents + bendCents
    detunable.push({ o: n, base: cents })
    sources.push(n)
    nodes.push(n)
    return n
  }
  const bars: GainLike[] = []
  const celeste = isPipe(model) && o.layer.vibOn && isChorus(o.vibType) ? CELESTE_CENTS[depthIndex(o.vibType)] : 0
  for (let i = 0; i < 9; i++) {
    const bar = ctx.createGain()
    bar.gain.value = barLevel(model, o.layer.drawbars, i)
    bar.connect(out)
    nodes.push(bar)
    bars.push(bar)
    let freqs: number[]
    let wave: string | CustomWave
    if (model === 'vox') {
      freqs = VOX_RATIOS[i].map((r) => f0 * r)
      wave = 'square'
    } else if (model === 'farf') {
      freqs = [f0 * FARF_REGISTERS[i].ratio]
      wave = FARF_REGISTERS[i].wave
      bar.gain.value *= FARF_REGISTERS[i].gain
    } else {
      let f = f0 * B3_RATIOS[i]
      // Tonewheel foldback: the top wheels repeat the octave below (B3); pipes simply stop.
      if (isB3(model)) while (f > TONEWHEEL_FOLDBACK_HZ) f /= 2
      freqs = f > ctx.sampleRate / 2 ? [] : [f]
      wave = isB3(model) ? 'sine' : model === 'pipe2' ? 'principal' : 'pipe'
    }
    for (const f of freqs) {
      const n = osc(f, wave)
      n.connect(bar)
      if (celeste) {
        const c = osc(f, wave, celeste)
        const cg = ctx.createGain()
        cg.gain.value = 0.7
        c.connect(cg)
        cg.connect(bar)
        nodes.push(cg)
      }
    }
  }

  // Key click (B3, B3 Bass) or pipe chiff: generated noise through a band-pass, fixed level with a
  // small random colour per key (organ spec b3.keyClick).
  if (isB3(model) || isPipe(model)) {
    const click = ctx.createBufferSource()
    click.buffer = shared.click
    click.playbackRate.value = 0.8 + 0.45 * pseudoRandom(o.note * 7919 + Math.round(t * 1000))
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = isB3(model) ? 2600 : Math.min(ctx.sampleRate / 2.5, f0 * 4)
    bp.Q.value = isB3(model) ? 0.8 : 3
    const cg = ctx.createGain()
    cg.gain.value = (isB3(model) ? 0.9 : 0.5) * o.gain
    click.connect(bp)
    bp.connect(cg)
    cg.connect(out)
    click.start(t)
    nodes.push(click, bp, cg)
  }

  // B3 percussion: a decaying 2nd (4') or 3rd (2⅔') harmonic from one shared envelope.
  if (model === 'b3' && o.layer.perc.on && o.percussion) {
    const p = o.layer.perc
    const n = osc(f0 * (p.third ? 3 : 2), 'sine')
    const pg = ctx.createGain()
    const level = p.soft ? 0.5 : 1.1
    pg.gain.setValueAtTime(level, t)
    pg.gain.setTargetAtTime(0, t + 0.002, p.fast ? 0.2 : 0.75)
    n.connect(pg)
    pg.connect(out)
    nodes.push(pg)
  }

  for (const s of sources) s.start(t)

  return {
    sources,
    nodes,
    gain: out,
    model,
    setBend(cents, now) {
      for (const d of detunable) rampTo(d.o.detune, d.base + cents, now, 0.01)
    },
    setDrawbars(next, now) {
      bars.forEach((b, i) => rampTo(b.gain, barLevel(model, next, i) * (model === 'farf' ? FARF_REGISTERS[i].gain : 1), now))
    },
    release(fast, now) {
      holdParam(out.gain, now)
      const tau = fast ? 0.008 : isPipe(model) ? 0.09 : 0.006
      out.gain.setTargetAtTime(0, now, tau)
      return now + tau * 8
    },
  }
}

function pseudoRandom(seed: number): number {
  let x = (seed ^ 0x9e3779b9) >>> 0
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  return (x >>> 0) / 0xffffffff
}
