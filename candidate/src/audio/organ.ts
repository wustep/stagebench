import type { AudioContextLike, AudioNodeLike, GainNodeLike, OscillatorNodeLike, TimerBoundary } from './boundaries'
import type { OrganLayerDocument } from './performance'
import { clampMidi } from './performance'

const B3_RATIOS = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8]
const VOX_RATIOS = [1, 3, 5, 7, 9, 2, 4]
const PIPE_RATIOS = [0.5, 1, 1.5, 2, 2.67, 4, 5.33, 8, 1]
const FARF_RATIOS = [0.5, 1, 2, 3, 4, 6, 8, 1.5, 2.5]

const VIBRATO = [
  { chorus: false, depth: 0.004, rate: 6.2 },
  { chorus: false, depth: 0.009, rate: 6.7 },
  { chorus: false, depth: 0.016, rate: 7.2 },
  { chorus: true, depth: 0.0045, rate: 1.05 },
  { chorus: true, depth: 0.009, rate: 1.2 },
  { chorus: true, depth: 0.015, rate: 1.4 },
] as const

export const ORGAN_MODELS = ['B3', 'Vox', 'Farf', 'Pipe 1', 'Pipe 2', 'B3 Bass'] as const

interface BendTarget {
  param: { value: number; setValueAtTime: (value: number, time: number) => void }
  base: number
}

interface OrganVoice {
  layer: 'A' | 'B'
  key: number
  nodes: AudioNodeLike[]
  oscs: OscillatorNodeLike[]
  bend: BendTarget[]
  timer: number | null
  held: boolean
  sustained: boolean
}

export interface OrganMix {
  sectionOn: boolean
  vibIndex: number
  vibOn: boolean
  percOn: boolean
  percSoft: boolean
  percFast: boolean
  percThird: boolean
  transpose: number
  stick: number
}

function midiFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

function hashNoise(length: number, seed: number): Float32Array {
  let state = seed >>> 0 || 1
  const data = new Float32Array(length)
  for (let index = 0; index < length; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    data[index] = (state / 4294967296) * 2 - 1
  }
  return data
}

/**
 * Two organ layers sum into one effect-chain input.
 * B3, Vox, Farf, and Pipe use different waveforms and drawbar laws.
 * Pipe 2 reuses the pipe ranks with a brighter principal. B3 Bass reuses B3 on 16' and 8'.
 */
export class OrganPlayer {
  private readonly voices: OrganVoice[] = []
  private readonly held = { A: 0, B: 0 }
  private readonly percArmed = { A: true, B: true }
  readonly levelA: GainNodeLike
  readonly levelB: GainNodeLike

  constructor(
    private readonly ctx: AudioContextLike,
    private readonly output: GainNodeLike,
    private readonly timers: TimerBoundary,
  ) {
    this.levelA = ctx.createGain()
    this.levelB = ctx.createGain()
    this.levelA.gain.value = 0.8
    this.levelB.gain.value = 0.8
    this.levelA.connect(output)
    this.levelB.connect(output)
  }

  setLevel(layer: 'A' | 'B', knob: number) {
    const node = layer === 'A' ? this.levelA : this.levelB
    const value = Math.max(0, knob) / 100
    try {
      node.gain.cancelScheduledValues(this.ctx.currentTime)
      node.gain.setValueAtTime(node.gain.value, this.ctx.currentTime)
      node.gain.linearRampToValueAtTime(value, this.ctx.currentTime + 0.02)
    } catch {
      node.gain.value = value
    }
  }

  noteOn(
    layer: 'A' | 'B',
    key: number,
    velocity: number,
    zoneGain: number,
    layerState: OrganLayerDocument,
    mix: OrganMix,
    at?: number,
  ) {
    if (!mix.sectionOn || zoneGain <= 0.001) return
    const start = at ?? this.ctx.currentTime
    this.noteOff(layer, key, false, start)
    const sounding = clampMidi(key + layerState.octave + mix.transpose)
    const freq = midiFreq(sounding)
    const destination = layer === 'A' ? this.levelA : this.levelB
    const voiceGain = this.ctx.createGain()
    const peak = (0.08 + 0.18 * velocity) * zoneGain
    const model = layerState.model
    const pipe = model === 3 || model === 4
    const attack = pipe ? (model === 4 ? 0.035 : 0.09) : 0.006
    voiceGain.gain.setValueAtTime(0.0001, start)
    voiceGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + attack)
    voiceGain.connect(destination)
    const nodes: AudioNodeLike[] = [voiceGain]
    const oscs: OscillatorNodeLike[] = []
    const bend: BendTarget[] = []
    const factor = layerState.pstick ? 2 ** ((mix.stick / 100) * 2 / 12) : 1
    const drawbars = layerState.drawbars
    this.addRanks(model, drawbars, freq, factor, start, voiceGain, nodes, oscs, bend, key)
    this.addVibrato(model, mix, freq, factor, start, voiceGain, oscs, nodes)
    if ((model === 0 || model === 5) && mix.percOn && this.percArmed[layer]) {
      this.addPercussion(mix, freq, factor, start, peak, voiceGain, nodes, oscs, bend)
    }
    if (model === 0 || model === 5) this.addClick(key, start, voiceGain, nodes)
    if (pipe) this.addChiff(key + model, start, voiceGain, nodes)
    const voice: OrganVoice = { layer, key, nodes, oscs, bend, timer: null, held: true, sustained: false }
    this.voices.push(voice)
    this.held[layer] += 1
    this.percArmed[layer] = false
  }

  private addRanks(
    model: number,
    drawbars: number[],
    freq: number,
    factor: number,
    start: number,
    voiceGain: GainNodeLike,
    nodes: AudioNodeLike[],
    oscs: OscillatorNodeLike[],
    bend: BendTarget[],
    key: number,
  ) {
    if (model === 1) {
      this.addVox(drawbars, freq, factor, start, voiceGain, nodes, oscs, bend)
      return
    }
    const ratios = model === 2 ? FARF_RATIOS : model === 3 || model === 4 ? PIPE_RATIOS : B3_RATIOS
    const type: OscillatorType = model === 2 ? 'square' : 'sine'
    let energy = 0
    const amps = ratios.map((ratio, index) => {
      let amount = (drawbars[index] ?? 0) / 8
      if (model === 5 && index !== 0 && index !== 2) amount = 0
      if (model === 2) amount = amount >= 0.5 ? 1 : 0
      if (model === 4 && index >= 3) amount *= 1.35
      energy += amount
      return { ratio, amount }
    })
    const scale = energy > 0 ? 1 / Math.sqrt(energy) : 0
    for (const rank of amps) {
      if (rank.amount <= 0) continue
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = type
      const base = freq * rank.ratio * (model === 4 && rank.ratio >= 4 ? 1.004 : 1)
      osc.frequency.setValueAtTime(base * factor, start)
      bend.push({ param: osc.frequency, base })
      gain.gain.value = rank.amount * scale * (model === 2 ? 0.45 : 0.7)
      osc.connect(gain)
      if (model === 2) {
        const shaper = this.ctx.createWaveShaper()
        const curve = new Float32Array(64)
        for (let index = 0; index < curve.length; index++) {
          const x = (index / (curve.length - 1)) * 2 - 1
          curve[index] = Math.tanh(3.2 * x)
        }
        shaper.curve = curve
        gain.connect(shaper)
        shaper.connect(voiceGain)
        nodes.push(shaper)
      } else {
        gain.connect(voiceGain)
      }
      osc.start(start)
      oscs.push(osc)
      nodes.push(osc, gain)
    }
    if (model === 2 && energy === 0) {
      const osc = this.ctx.createOscillator()
      osc.type = 'square'
      osc.frequency.setValueAtTime(freq * factor, start)
      const gain = this.ctx.createGain()
      gain.gain.value = 0.0001
      osc.connect(gain)
      gain.connect(voiceGain)
      osc.start(start)
      oscs.push(osc)
      nodes.push(osc, gain)
      void key
    }
  }

  private addVox(
    drawbars: number[],
    freq: number,
    factor: number,
    start: number,
    voiceGain: GainNodeLike,
    nodes: AudioNodeLike[],
    oscs: OscillatorNodeLike[],
    bend: BendTarget[],
  ) {
    const dry = this.ctx.createGain()
    const tone = this.ctx.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = 900
    const mix = (drawbars[7] ?? 0) / 8
    const high = (drawbars[8] ?? 0) / 8
    dry.gain.value = 1 - mix * 0.85
    const wet = this.ctx.createGain()
    wet.gain.value = mix
    let energy = 0
    const partials = VOX_RATIOS.map((ratio, index) => {
      const amount = (drawbars[index] ?? 0) / 8
      energy += amount
      return { ratio, amount }
    })
    const scale = energy > 0 ? 0.55 / Math.sqrt(Math.max(1, energy)) : 0
    for (const partial of partials) {
      if (partial.amount <= 0) continue
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = 'square'
      const base = freq * partial.ratio
      osc.frequency.setValueAtTime(base * factor, start)
      bend.push({ param: osc.frequency, base })
      gain.gain.value = partial.amount * scale
      osc.connect(gain)
      gain.connect(dry)
      gain.connect(tone)
      osc.start(start)
      oscs.push(osc)
      nodes.push(osc, gain)
    }
    dry.connect(voiceGain)
    tone.connect(wet)
    wet.connect(voiceGain)
    nodes.push(dry, tone, wet)
    if (high > 0) {
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = 'triangle'
      const base = freq * 12
      osc.frequency.setValueAtTime(base * factor, start)
      bend.push({ param: osc.frequency, base })
      gain.gain.value = high * 0.18
      osc.connect(gain)
      gain.connect(voiceGain)
      osc.start(start)
      oscs.push(osc)
      nodes.push(osc, gain)
    }
  }

  private addVibrato(
    model: number,
    mix: OrganMix,
    freq: number,
    factor: number,
    start: number,
    voiceGain: GainNodeLike,
    oscs: OscillatorNodeLike[],
    nodes: AudioNodeLike[],
  ) {
    if (!mix.vibOn || oscs.length === 0) return
    const setting = VIBRATO[Math.max(0, Math.min(VIBRATO.length - 1, mix.vibIndex))]!
    const lfo = this.ctx.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.value = setting.rate
    const depth = this.ctx.createGain()
    depth.gain.value = freq * setting.depth * (model === 3 || model === 4 ? 0.65 : 1)
    lfo.connect(depth)
    for (const osc of oscs) depth.connect(osc.frequency)
    lfo.start(start)
    oscs.push(lfo)
    nodes.push(lfo, depth)
    if (setting.chorus) {
      const dry = this.ctx.createOscillator()
      const dryGain = this.ctx.createGain()
      dry.type = 'sine'
      dry.frequency.setValueAtTime(freq * factor, start)
      dryGain.gain.value = 0.35
      dry.connect(dryGain)
      dryGain.connect(voiceGain)
      dry.start(start)
      oscs.push(dry)
      nodes.push(dry, dryGain)
    }
  }

  private addPercussion(
    mix: OrganMix,
    freq: number,
    factor: number,
    start: number,
    peak: number,
    voiceGain: GainNodeLike,
    nodes: AudioNodeLike[],
    oscs: OscillatorNodeLike[],
    bend: BendTarget[],
  ) {
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    osc.type = 'sine'
    const ratio = mix.percThird ? 3 : 2
    const base = freq * ratio
    osc.frequency.setValueAtTime(base * factor, start)
    bend.push({ param: osc.frequency, base })
    const level = (mix.percSoft ? 0.22 : 0.7) * peak
    const decay = mix.percFast ? 0.16 : 0.62
    gain.gain.setValueAtTime(level, start)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + decay)
    osc.connect(gain)
    gain.connect(voiceGain)
    osc.start(start)
    osc.stop(start + decay + 0.05)
    oscs.push(osc)
    nodes.push(osc, gain)
  }

  private addClick(key: number, start: number, voiceGain: GainNodeLike, nodes: AudioNodeLike[]) {
    const length = Math.max(8, Math.floor(this.ctx.sampleRate * 0.012))
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate)
    const data = buffer.getChannelData(0)
    data.set(hashNoise(length, key * 97 + 3))
    for (let index = 0; index < length; index++) data[index] = (data[index] ?? 0) * Math.exp(-index / (length * 0.22))
    const noise = this.ctx.createBufferSource()
    const gain = this.ctx.createGain()
    noise.buffer = buffer
    gain.gain.setValueAtTime(0.28, start)
    noise.connect(gain)
    gain.connect(voiceGain)
    noise.start(start)
    nodes.push(noise, gain)
  }

  private addChiff(seed: number, start: number, voiceGain: GainNodeLike, nodes: AudioNodeLike[]) {
    const length = Math.max(8, Math.floor(this.ctx.sampleRate * 0.08))
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate)
    const data = buffer.getChannelData(0)
    data.set(hashNoise(length, seed * 13 + 9))
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 1800
    filter.Q.value = 0.7
    const noise = this.ctx.createBufferSource()
    const gain = this.ctx.createGain()
    noise.buffer = buffer
    gain.gain.setValueAtTime(0.16, start)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.09)
    noise.connect(filter)
    filter.connect(gain)
    gain.connect(voiceGain)
    noise.start(start)
    nodes.push(noise, filter, gain)
  }

  noteOff(layer: 'A' | 'B', key: number, sustained: boolean, at?: number) {
    const voice = this.voices.find((item) => item.layer === layer && item.key === key && item.held)
    if (!voice) return
    voice.held = false
    if (sustained) {
      voice.sustained = true
      return
    }
    this.release(voice, at)
  }

  setSustain(down: boolean, sustains: { A: boolean; B: boolean }) {
    if (down) return
    for (const voice of [...this.voices]) {
      if (voice.sustained && !voice.held && sustains[voice.layer]) this.release(voice)
    }
  }

  private release(voice: OrganVoice, at?: number) {
    const start = at ?? this.ctx.currentTime
    const gain = voice.nodes[0]
    const param = gain && 'gain' in gain ? (gain as GainNodeLike).gain : null
    if (param) {
      try {
        param.cancelScheduledValues(start)
        param.setValueAtTime(Math.max(0.0001, param.value), start)
        param.exponentialRampToValueAtTime(0.0001, start + 0.18)
      } catch {
        param.value = 0.0001
      }
    }
    voice.timer = this.timers.setTimeout(() => this.drop(voice), 220)
    voice.sustained = false
    this.held[voice.layer] = Math.max(0, this.held[voice.layer] - 1)
    if (this.held[voice.layer] === 0) this.percArmed[voice.layer] = true
  }

  allNotesOff() {
    for (const voice of [...this.voices]) this.drop(voice)
    this.held.A = 0
    this.held.B = 0
    this.percArmed.A = true
    this.percArmed.B = true
  }

  applyBend(stick: number, pstick: { A: boolean; B: boolean }) {
    const factorFor = (layer: 'A' | 'B') => (pstick[layer] ? 2 ** ((stick / 100) * 2 / 12) : 1)
    for (const voice of this.voices) {
      const factor = factorFor(voice.layer)
      for (const target of voice.bend) {
        try {
          target.param.setValueAtTime(target.base * factor, this.ctx.currentTime)
        } catch {
          target.param.value = target.base * factor
        }
      }
    }
  }

  activeCount(): number {
    return this.voices.length
  }

  private drop(voice: OrganVoice) {
    if (voice.timer !== null) this.timers.clearTimeout(voice.timer)
    for (const osc of voice.oscs) {
      try {
        osc.stop()
      } catch {
        /* stopped */
      }
    }
    for (const node of voice.nodes) {
      try {
        node.disconnect()
      } catch {
        /* disconnected */
      }
    }
    const index = this.voices.indexOf(voice)
    if (index >= 0) this.voices.splice(index, 1)
  }

  dispose() {
    this.allNotesOff()
    try {
      this.levelA.disconnect()
      this.levelB.disconnect()
    } catch {
      /* closed */
    }
  }
}
