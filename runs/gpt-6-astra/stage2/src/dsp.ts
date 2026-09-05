import { initialState, unitIds, type ChainSettings, type EffectSettings, type InstrumentState, type LayerId, type PianoLayer, type UnitId } from './phase2-state'
import type { RecordedSample } from './library'
const TAU = Math.PI * 2
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
export class DelayLine {
  data: Float32Array; cursor = 0
  constructor(size: number) { this.data = new Float32Array(Math.ceil(size) + 2) }
  read(delay: number) { const p = (this.cursor - clamp(delay, 1, this.data.length - 2) + this.data.length) % this.data.length; const i = Math.floor(p); const f = p - i; return this.data[i] * (1 - f) + this.data[(i + 1) % this.data.length] * f }
  write(x: number) { this.data[this.cursor] = x; this.cursor = (this.cursor + 1) % this.data.length }
}
export class Filter {
  z1 = 0; z2 = 0; b0 = 1; b1 = 0; b2 = 0; a1 = 0; a2 = 0
  set(type: 'lp' | 'hp' | 'bp' | 'ap' | 'peak' | 'low' | 'high', hz: number, q: number, sr: number, db = 0) {
    const w = TAU * clamp(hz, 15, sr * .44) / sr, c = Math.cos(w), s = Math.sin(w), alpha = s / (2 * Math.max(.1, q)), A = 10 ** (db / 40)
    let b0 = 1, b1 = 0, b2 = 0, a0 = 1 + alpha, a1 = -2 * c, a2 = 1 - alpha
    if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0 }
    if (type === 'hp') { b0 = (1 + c) / 2; b1 = -1 - c; b2 = b0 }
    if (type === 'bp') { b0 = alpha; b2 = -alpha }
    if (type === 'ap') { b0 = 1 - alpha; b1 = -2 * c; b2 = 1 + alpha }
    if (type === 'peak') { b0 = 1 + alpha * A; b1 = -2 * c; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a2 = 1 - alpha / A }
    if (type === 'low' || type === 'high') {
      const beta = 2 * Math.sqrt(A) * alpha, sign = type === 'low' ? 1 : -1
      b0 = A * ((A + 1) - sign * (A - 1) * c + beta)
      b1 = 2 * sign * A * ((A - 1) - sign * (A + 1) * c)
      b2 = A * ((A + 1) - sign * (A - 1) * c - beta)
      a0 = (A + 1) + sign * (A - 1) * c + beta
      a1 = -2 * sign * ((A - 1) + sign * (A + 1) * c)
      a2 = (A + 1) + sign * (A - 1) * c - beta
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0
  }
  tick(x: number) { const y = this.b0 * x + this.z1; this.z1 = this.b1 * x - this.a1 * y + this.z2; this.z2 = this.b2 * x - this.a2 * y; return y }
}
class Unit {
  filters = Array.from({ length: 8 }, () => new Filter())
  lines: DelayLine[]; phase = 0; envelope = 0; count = 0; wet = 0; speed = .5
  combDamp = [0, 0, 0, 0]; parameters: EffectSettings; smoothing: number
  constructor(readonly id: UnitId, readonly sr: number, settings: EffectSettings, readonly channel: number) {
    this.smoothing = 1 - Math.exp(-1 / (.01 * sr)); this.parameters = { ...settings }; this.wet = settings.on ? 1 : 0
    const capacity = id === 'delay' ? sr * 2.1 : sr * .25
    this.lines = Array.from({ length: id === 'reverb' ? 6 : 3 }, () => new DelayLine(capacity))
  }
  tick(x: number, target: EffectSettings, enabled: boolean, bpm: number) {
    if (!target.on && this.wet < .000001) return x
    const p = this.parameters
    // 10 ms parameter and bypass smoothing, shared by real-time and offline render.
    for (const key of ['rate', 'amount', 'wet', 'feedback', 'bass', 'mid', 'treble', 'tone'] as const) p[key] += (target[key] - p[key]) * this.smoothing
    p.type = target.type; p.sync = target.sync
    this.wet += ((target.on && enabled ? 1 : 0) - this.wet) * this.smoothing
    const rate = p.sync ? bpm / 60 : .1 + p.rate * 9.9
    this.speed += (rate - this.speed) / (this.sr * .3)
    this.phase = (this.phase + TAU * (this.id === 'mod2' && p.type === 5 ? this.speed : rate) / this.sr) % TAU
    const sin = Math.sin(this.phase + this.channel * .9), depth = p.amount
    let y = x
    if (this.id === 'mod1') {
      if (p.type === 0) y = x * Math.sqrt(1 + depth * Math.sin(this.phase + this.channel * Math.PI))
      if (p.type === 1) y = x * (1 - depth * (.5 + .5 * sin))
      if (p.type === 2) y = x * (1 - depth + depth * Math.sin(this.count * TAU * (20 + p.rate * 1800) / this.sr))
      if (p.type === 3 || p.type === 4) {
        this.envelope += (Math.abs(x) - this.envelope) * (Math.abs(x) > this.envelope ? .02 : .0008)
        if (this.count % 16 === 0) this.filters[0].set(p.type === 3 ? 'bp' : 'lp', p.type === 3 ? 220 + clamp(this.envelope * (2 + p.rate * 30), 0, 1) * 6000 : 200 + (sin + 1) * 2200, 2.5, this.sr)
        y = x * (1 - depth) + this.filters[0].tick(x) * depth
      }
      if (p.type === 5) y = x * (1 - depth * (.5 + .5 * Math.cos(this.phase)) ** 4)
    } else if (this.id === 'mod2') {
      if (p.type === 2 || p.type === 3) {
        let z = x
        for (let i = 0; i < (p.type === 2 ? 4 : 6); i++) {
          if (this.count % 16 === 0) this.filters[i].set('ap', 180 * 1.65 ** i * (1.2 + .7 * Math.sin(this.phase + (p.type === 3 ? i * .65 : 0))), .6, this.sr)
          z = this.filters[i].tick(z)
        }
        y = x * (1 - depth * .5) + z * depth * .5
      } else {
        const voices = p.type === 4 ? 3 : p.type === 0 && depth > .65 ? 2 : 1
        let z = 0
        for (let i = 0; i < voices; i++) {
          const mod = Math.sin(this.phase + i * TAU / 3 + this.channel * 1.7)
          const delay = p.type === 1 ? .0018 + .0015 * mod : p.type === 5 ? .004 + .002 * mod : .016 + i * .004 + .006 * mod
          const read = this.lines[i].read(delay * this.sr)
          this.lines[i].write(x + (p.type === 1 ? .72 * depth : 0) * read)
          z += read / voices
        }
        y = x * (1 - depth * .5) + z * depth * .6
      }
    } else if (this.id === 'delay') {
      const seconds = p.sync ? 60 / bpm : .06 + p.rate * 1.44
      let repeat = this.lines[0].read(seconds * this.sr)
      if (p.type) {
        if (this.count % 32 === 0) this.filters[0].set((['lp', 'lp', 'hp', 'bp'] as const)[p.type], p.type === 2 ? 1200 : 2200, .707, this.sr)
        repeat = this.filters[0].tick(repeat)
      }
      // The filter is inside the feedback loop: every repeat passes it again.
      this.lines[0].write(x + repeat * Math.min(.92, p.feedback))
      y = x * (1 - p.wet) + repeat * p.wet
    } else if (this.id === 'ampEq') {
      if (this.count % 32 === 0) {
        this.filters[0].set('low', 100, .707, this.sr, p.bass)
        this.filters[1].set('peak', 200 * 40 ** p.rate, .8, this.sr, p.mid)
        this.filters[2].set('high', 4000, .707, this.sr, p.treble)
        if (p.type === 4 || p.type === 5) for (const i of [3, 4]) this.filters[i].set(p.type === 4 ? 'lp' : 'hp', 30 * 500 ** p.rate, .707 + (p.mid + 15) / 10, this.sr)
        else { this.filters[3].set('hp', [20, 80, 45, 240][p.type] ?? 20, .707, this.sr); this.filters[4].set('lp', [19000, 5500, 9500, 3200][p.type] ?? 19000, .707, this.sr) }
      }
      y = this.filters[2].tick(this.filters[1].tick(this.filters[0].tick(x)))
      if (p.type >= 1 && p.type <= 3) {
        const drive = 1 + depth * [0, 12, 4, 20][p.type]
        y = p.type === 2 ? Math.atan(y * drive) / Math.sqrt(drive) : Math.tanh(y * drive + (p.type === 3 ? .08 : 0)) / Math.sqrt(drive) - (p.type === 3 ? Math.tanh(.08) / Math.sqrt(drive) : 0)
      }
      if (p.type !== 0 && p.type !== 6) y = this.filters[4].tick(this.filters[3].tick(y))
    } else if (this.id === 'compressor') {
      const abs = Math.abs(x), attack = p.type ? .001 : .015, release = p.type ? .045 : .25
      this.envelope += (abs - this.envelope) * (1 - Math.exp(-1 / (this.sr * (abs > this.envelope ? attack : release))))
      const threshold = 10 ** ((-4 - depth * 30) / 20), ratio = 1 + depth * 11
      const gain = this.envelope > threshold ? (threshold / this.envelope) ** (1 - 1 / ratio) : 1
      y = x * gain
    } else if (this.id === 'reverb') {
      const decay = [.9, .3, 1.7, 2.3, 3.8, 6.5][p.type]
      const lengths = [.0297, .0371, .0411, .0437]
      let sum = 0
      for (let i = 0; i < 4; i++) {
        const duration = lengths[i] * (p.type === 1 ? .5 : p.type === 5 ? 1.9 : 1) + this.channel * .0013
        const d = this.lines[i].read(duration * this.sr + (p.type === 2 ? Math.sin(this.phase * 3 + i) * 12 : 0))
        this.combDamp[i] += (d - this.combDamp[i]) * (.04 + p.tone * .8)
        this.lines[i].write(x * .3 + this.combDamp[i] * 10 ** (-3 * duration / decay))
        sum += d * .25
      }
      for (let i = 4; i < 6; i++) { const d = this.lines[i].read((i === 4 ? .005 : .0017) * this.sr); const z = d - sum * .6; this.lines[i].write(sum + z * .6); sum = z }
      y = x * (1 - p.wet) + sum * p.wet
    }
    this.count++
    return x + (y - x) * this.wet
  }
}
export class EffectChain {
  units: Unit[][]
  constructor(readonly sr: number, settings: ChainSettings) { this.units = [0, 1].map(channel => unitIds.map(id => new Unit(id, sr, settings[id], channel))) }
  tick(x: number, channel: number, settings: ChainSettings, on: boolean, bpm: number) { for (let i = 0; i < unitIds.length; i++) x = this.units[channel][i].tick(x, settings[unitIds[i]], on, bpm); return x }
}
export class Rotary {
  phase = 0; bassPhase = 0; speed = .7; filters = Array.from({ length: 4 }, () => new Filter()); lines: DelayLine[]; mix = 0; drive = 0
  constructor(readonly sr: number) { this.lines = Array.from({ length: 4 }, () => new DelayLine(sr * .03)); this.filters.forEach(f => f.set('lp', 800, .707, sr)) }
  advance(fast: boolean) { this.speed += ((fast ? 6.5 : .7) - this.speed) / (this.sr * .65); this.phase = (this.phase + TAU * this.speed / this.sr) % TAU; this.bassPhase = (this.bassPhase + TAU * this.speed * .78 / this.sr) % TAU }
  tick(x: number, layer: number, channel: number, drive: number) {
    // One shared rotor phase/speed, with separate layer history preserving post-rotary levels.
    const index = layer * 2 + channel
    const low = this.filters[index].tick(x), high = x - low
    const modulation = Math.sin(this.phase + channel * Math.PI)
    const d = this.lines[index].read((.008 + .002 * modulation) * this.sr)
    this.lines[index].write(high)
    const z = low * (.8 + .2 * Math.sin(this.bassPhase + channel * Math.PI)) + d * (.65 + .35 * modulation)
    return Math.tanh(z * (1 + drive * 8)) / (1 + drive * 2)
  }
}
interface DSPVoice { id: number; layer: LayerId; midi: number; velocity: number; age: number; phase: number; releaseAge: number; releaseSeconds: number; stopped: boolean; filter: number[]; sample?: RecordedSample; sample2?: RecordedSample; sampleMix: number; sourceType: PianoLayer['type'] }
export type DSPMessage = { kind: 'state'; state: InstrumentState } | { kind: 'on'; id: number; layer: LayerId; midi: number; velocity: number } | { kind: 'off' | 'stop'; id: number } | { kind: 'pedal'; layer: LayerId; down: boolean } | { kind: 'samples'; samples: RecordedSample[] } | { kind: 'clear' }
export class InstrumentDSP {
  state = initialState(); voices = new Map<number, DSPVoice>(); samples: RecordedSample[] = []; pedals = { A: false, B: false }
  chains: Record<LayerId, EffectChain>; rotary: Rotary; levels = { A: .75, B: .75 }; master = .7; frame = 0; finished: number[] = []; rotaryMix = { A: 0, B: 0 }; transitions: Partial<Record<LayerId, { chain: EffectChain; settings: ChainSettings; remaining: number }>> = {}
  constructor(readonly sr: number) { this.chains = { A: new EffectChain(sr, this.state.layers.A.effects), B: new EffectChain(sr, this.state.layers.B.effects) }; this.rotary = new Rotary(sr) }
  message(message: DSPMessage) {
    if (message.kind === 'state') {
      for (const id of ['A', 'B'] as const) if (unitIds.some(unit => this.state.layers[id].effects[unit].type !== message.state.layers[id].effects[unit].type)) {
        this.transitions[id] = { chain: this.chains[id], settings: this.state.layers[id].effects, remaining: Math.round(this.sr * .02) }
        this.chains[id] = new EffectChain(this.sr, message.state.layers[id].effects)
      }
      this.state = message.state; return
    }
    if (message.kind === 'samples') { this.samples = message.samples; return }
    if (message.kind === 'pedal') { this.pedals[message.layer] = message.down; return }
    if (message.kind === 'clear') { this.finished.push(...this.voices.keys()); this.voices.clear(); this.transitions = {}; this.chains = { A: new EffectChain(this.sr, this.state.layers.A.effects), B: new EffectChain(this.sr, this.state.layers.B.effects) }; this.rotary = new Rotary(this.sr); return }
    if (message.kind === 'on') {
      const p = this.state.layers[message.layer], vel = clamp(message.velocity / 127, 0, 1) ** [1.6, 1, .65][p.touch]
      const candidates = this.samples.filter(s => s.type === p.type).sort((a, b) => Math.abs(a.root - message.midi) - Math.abs(b.root - message.midi))
      const rootSamples = candidates.filter(s => s.root === candidates[0]?.root).sort((a, b) => a.velocity - b.velocity)
      const sample = rootSamples.filter(s => s.velocity <= vel * 127).at(-1) ?? rootSamples[0], sample2 = rootSamples.find(s => s.velocity >= vel * 127) ?? sample
      this.voices.set(message.id, { ...message, age: 0, phase: 0, releaseAge: -1, releaseSeconds: .22, stopped: false, velocity: vel, filter: [0, 0], sample, sample2, sampleMix: sample && sample2 && sample !== sample2 ? (vel * 127 - sample.velocity) / (sample2.velocity - sample.velocity) : 0, sourceType: p.type })
      return
    }
    const voice = this.voices.get(message.id)
    if (voice) { voice.releaseAge = 0; const p = this.state.layers[voice.layer]; voice.releaseSeconds = message.kind === 'stop' ? .005 : p.softRelease && voice.sourceType !== 'Clav' ? .48 : .22; voice.stopped = message.kind === 'stop' }
  }
  private source(v: DSPVoice, p: PianoLayer, channel: number, count: number) {
    const t = v.age / this.sr, hz = 440 * 2 ** ((v.midi - 69 + (p.pstick ? this.state.bend * 2 : 0)) / 12)
    let x = 0
    const copies = p.unison ? 3 : 1
    for (let i = 0; i < copies; i++) {
      const detune = p.unison ? (i - 1) * p.unison * (channel ? 5.7 : 4.3) : 0
      const f = hz * 2 ** (detune / 1200)
      if (v.sample) {
        const read = (s: RecordedSample) => { const pos = t * s.sampleRate * f / (440 * 2 ** ((s.root - 69) / 12)); const k = Math.floor(pos); return (s.data[k] ?? 0) * (1 - pos + k) + (s.data[k + 1] ?? 0) * (pos - k) }
        x += (read(v.sample) * (1 - v.sampleMix) + read(v.sample2 ?? v.sample) * v.sampleMix) / copies
      } else {
        const phase = v.phase * f / hz
        let z = 0
        if (v.sourceType === 'Digital') z = Math.sin(phase + Math.sin(phase * 2) * (1 + v.velocity * 3) * Math.exp(-t * 3)) * Math.exp(-t * 1.1)
        else if (v.sourceType === 'Electric') z = (Math.sin(phase) + .45 * v.velocity * Math.sin(phase * 7) * Math.exp(-t * 6)) * Math.exp(-t * 1.3)
        else if (v.sourceType === 'Misc') z = (Math.sin(phase) * Math.exp(-t * 3) + .45 * Math.sin(phase * 2.756) * Math.exp(-t * 7) + .2 * Math.sin(phase * 5.404) * Math.exp(-t * 13))
        else for (let h = 1; h <= 6; h++) if (f * h < this.sr * .44) z += Math.sin(phase * h * (v.sourceType === 'Upright' ? 1 + .00035 * h : 1 + .00006 * h * h)) * Math.exp(-t * (v.sourceType === 'Clav' ? 2.8 + h * .7 : .65 + h * .38)) / h ** (v.sourceType === 'Clav' ? .8 : v.sourceType === 'Upright' ? 1.05 : 1.2)
        x += z * .5 / copies
      }
    }
    const dynamicGain = v.velocity ** 1.6 + (1 - v.velocity ** 1.6) * p.dynComp * .19
    if (p.stringRes && (count > 1 || this.pedals[v.layer])) x += .08 * Math.sin(v.phase * 2.001) * Math.exp(-t * .6)
    const coefficient = p.timbre === 1 ? .09 : p.timbre === 2 ? .3 : .8
    v.filter[channel] += (x - v.filter[channel]) * coefficient
    x = p.timbre === 0 ? x : p.timbre === 3 ? x + .8 * (x - v.filter[channel]) : p.timbre >= 4 ? Math.tanh((x + (p.timbre === 5 ? 1.4 : .5) * (x - v.filter[channel])) * 2) * .65 : v.filter[channel]
    const release = v.releaseAge < 0 ? 1 : Math.max(0, 1 - v.releaseAge / (v.releaseSeconds * this.sr))
    return x * dynamicGain * Math.min(1, t / .004) * release
  }
  render(left: Float32Array, right: Float32Array) {
    for (let n = 0; n < left.length; n++) {
      const buses = { A: [0, 0], B: [0, 0] }
      for (const v of this.voices.values()) {
        const p = this.state.layers[v.layer]
        for (let c = 0; c < 2; c++) buses[v.layer][c] += this.source(v, p, c, this.voices.size)
        v.phase += TAU * 440 * 2 ** ((v.midi - 69 + (p.pstick ? this.state.bend * 2 : 0)) / 12) / this.sr
        v.age++; if (v.releaseAge >= 0) v.releaseAge++
        if (v.age > this.sr * 12 || v.releaseAge >= v.releaseSeconds * this.sr) { this.voices.delete(v.id); this.finished.push(v.id) }
      }
      this.rotary.advance(this.state.rotary.fast)
      const out = [0, 0]
      for (const [index, layer] of (['A', 'B'] as const).entries()) {
        const p = this.state.layers[layer]
        this.levels[layer] += ((p.enabled && this.state.sectionOn ? p.level : 0) - this.levels[layer]) / (this.sr * .01)
        const routed = this.state.effectsOn && p.effects.ampEq.on && p.effects.ampEq.type === 6 && this.state.rotary.on
        this.rotaryMix[layer] += ((routed ? 1 : 0) - this.rotaryMix[layer]) / (this.sr * .01)
        for (let c = 0; c < 2; c++) {
          let x = this.chains[layer].tick(buses[layer][c], c, p.effects, this.state.effectsOn, this.state.bpm)
          const transition = this.transitions[layer]
          if (transition) { const old = transition.chain.tick(buses[layer][c], c, transition.settings, this.state.effectsOn, this.state.bpm); x += (old - x) * transition.remaining / Math.round(this.sr * .02) }
          const rotary = this.rotary.tick(x, index, c, this.state.rotary.drive)
          x += (rotary - x) * this.rotaryMix[layer]
          out[c] += x * this.levels[layer]
        }
        if (this.transitions[layer] && --this.transitions[layer]!.remaining <= 0) delete this.transitions[layer]
      }
      this.master += (this.state.master - this.master) / (this.sr * .01)
      // A bounded soft limiter is the only path to the destination.
      left[n] = Math.tanh(out[0] * this.master * .6); right[n] = Math.tanh(out[1] * this.master * .6)
      this.frame++
    }
  }
}
