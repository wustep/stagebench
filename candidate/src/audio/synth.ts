import type {
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
  TimerBoundary,
} from './boundaries'
import { ARP_BEATS, LFO_RATIOS, clampMidi, clockHz, type SynthLayerDocument } from './performance'

export const WAVEFORMS = [
  { name: 'Sine', category: 'Pure' },
  { name: 'Triangle', category: 'Pure' },
  { name: 'Saw', category: 'Pure' },
  { name: 'Square', category: 'Pure' },
  { name: 'Pulse 33', category: 'Pure' },
  { name: 'Pulse 10', category: 'Pure' },
  { name: 'White Noise', category: 'Pure' },
  { name: 'Sync Saw', category: 'Sync' },
  { name: 'Sync Square', category: 'Sync' },
  { name: 'Multi Saw', category: 'Multi' },
  { name: 'Multi Saw 8ve', category: 'Multi' },
  { name: 'Super Saw', category: 'Super' },
  { name: 'Super Square', category: 'Super' },
  { name: 'FM 2-op', category: 'FM-H' },
] as const

export type SynthLayerId = 'A' | 'B' | 'C'

interface BendTarget {
  param: AudioParamLike
  base: number
}

interface SynthVoice {
  layer: SynthLayerId
  key: number
  nodes: AudioNodeLike[]
  oscs: OscillatorNodeLike[]
  bend: BendTarget[]
  timer: number | null
  held: boolean
  sustained: boolean
  freq: number
  scheduled: boolean
}

export interface SynthMix {
  sectionOn: boolean
  transpose: number
  stick: number
  wheel: number
  bpm: number
  lfoSync: boolean
  arpSync: boolean
}

function midiFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

function envSeconds(knob: number, max: number): number {
  const t = Math.max(0, Math.min(127, knob)) / 127
  return 0.004 + t * t * max
}

function mulberry32(seed: number) {
  let state = seed >>> 0 || 1
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

function categoryOf(index: number): string {
  return WAVEFORMS[Math.max(0, Math.min(WAVEFORMS.length - 1, index))]!.category
}

/**
 * Three synth layers, each into its own effect bus.
 * Waveforms, filters, envelopes, LFO, voice modes, and the arpeggiator are synthesized.
 * Samples mode is unsupported and stays silent.
 */
export class SynthPlayer {
  private readonly voices: SynthVoice[] = []
  private readonly held = new Map<SynthLayerId, number[]>()
  private readonly last = new Map<SynthLayerId, number>()
  private readonly mono: Partial<Record<SynthLayerId, SynthVoice>> = {}
  private readonly lfos: Record<
    SynthLayerId,
    { osc: OscillatorNodeLike; depth: GainNodeLike; sample: AudioNodeLike | null; mode: 'osc' | 'sh' }
  >
  private readonly gates: Record<SynthLayerId, GainNodeLike>
  readonly levels: Record<SynthLayerId, GainNodeLike>

  constructor(
    private readonly ctx: AudioContextLike,
    outputs: Record<SynthLayerId, GainNodeLike>,
    private readonly timers: TimerBoundary,
  ) {
    this.levels = {
      A: ctx.createGain(),
      B: ctx.createGain(),
      C: ctx.createGain(),
    }
    this.gates = {
      A: ctx.createGain(),
      B: ctx.createGain(),
      C: ctx.createGain(),
    }
    this.lfos = {
      A: this.makeLfo(),
      B: this.makeLfo(),
      C: this.makeLfo(),
    }
    for (const layer of ['A', 'B', 'C'] as const) {
      this.levels[layer].gain.value = 0.8
      this.gates[layer].gain.value = 1
      this.levels[layer].connect(this.gates[layer])
      this.gates[layer].connect(outputs[layer])
      this.held.set(layer, [])
    }
  }

  private makeLfo() {
    const osc = this.ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = 2
    const depth = this.ctx.createGain()
    depth.gain.value = 0
    osc.connect(depth)
    osc.start(0)
    return { osc, depth, sample: null as AudioNodeLike | null, mode: 'osc' as 'osc' | 'sh' }
  }

  setLevel(layer: SynthLayerId, knob: number) {
    const node = this.levels[layer]
    const value = Math.max(0, knob) / 100
    try {
      node.gain.setValueAtTime(value, this.ctx.currentTime)
    } catch {
      node.gain.value = value
    }
  }

  updateLayer(layer: SynthLayerId, state: SynthLayerDocument, mix: SynthMix) {
    const lfo = this.lfos[layer]
    const hz = mix.lfoSync ? clockHz(mix.bpm, state.lfoRate, LFO_RATIOS) : 0.15 + (state.lfoRate / 127) * 12
    const wave = state.lfoWave
    this.wireLfo(lfo, wave, Math.max(0.05, hz))
    const span = state.lfoAmount / 127
    const amount = state.lfoDest === 0 ? 0 : state.lfoDest === 3 ? span * 1800 : state.lfoDest === 2 ? span * 8 : span * 40
    const signed = wave === 2 ? -Math.abs(amount) : amount
    lfo.depth.gain.setValueAtTime(signed, this.ctx.currentTime)
  }

  /** Triangle, saw down, saw up (inverted depth), square, and a stepped Sample & Hold buffer. */
  private wireLfo(
    lfo: { osc: OscillatorNodeLike; depth: GainNodeLike; sample: AudioNodeLike | null; mode: 'osc' | 'sh' },
    wave: number,
    hz: number,
  ) {
    if (wave === 4) {
      if (lfo.mode !== 'sh') {
        try {
          lfo.osc.disconnect()
        } catch {
          /* already free */
        }
        const length = 64
        const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate)
        const data = buffer.getChannelData(0)
        const next = mulberry32(0x5a11)
        for (let index = 0; index < length; index++) data[index] = next() * 2 - 1
        const source = this.ctx.createBufferSource()
        source.buffer = buffer
        source.loop = true
        source.connect(lfo.depth)
        source.start(0)
        lfo.sample = source
        lfo.mode = 'sh'
      }
      const source = lfo.sample as { playbackRate?: { setValueAtTime: (value: number, time: number) => void } } | null
      source?.playbackRate?.setValueAtTime(Math.max(1, hz * 4), this.ctx.currentTime)
      return
    }
    if (lfo.mode !== 'osc') {
      try {
        lfo.sample?.disconnect()
      } catch {
        /* already free */
      }
      lfo.osc.connect(lfo.depth)
      lfo.mode = 'osc'
    }
    lfo.osc.type = wave === 1 || wave === 2 ? 'sawtooth' : wave === 3 ? 'square' : 'triangle'
    lfo.osc.frequency.setValueAtTime(hz, this.ctx.currentTime)
  }

  noteOn(
    layer: SynthLayerId,
    key: number,
    velocity: number,
    zoneGain: number,
    state: SynthLayerDocument,
    mix: SynthMix,
    at?: number,
  ) {
    if (!mix.sectionOn || zoneGain <= 0.001 || state.samples) return
    const start = at ?? this.ctx.currentTime
    const notes = this.held.get(layer) ?? []
    if (!notes.includes(key)) notes.push(key)
    this.held.set(layer, notes)
    this.last.set(layer, key)
    this.updateLayer(layer, state, mix)
    if (state.arpRun && state.arpMode !== 2) {
      this.scheduleArp(layer, state, mix, zoneGain, velocity, start)
      return
    }
    if (state.arpRun && state.arpMode === 2) this.scheduleGate(layer, state, mix, start)
    if (state.voiceMode === 0) this.startVoice(layer, key, velocity, zoneGain, state, mix, start, false, false)
    else this.playMono(layer, key, velocity, zoneGain, state, mix, start)
  }

  noteOff(layer: SynthLayerId, key: number, sustained: boolean, state: SynthLayerDocument, mix: SynthMix, at?: number) {
    const notes = this.held.get(layer) ?? []
    if (!state.arpHold) {
      this.held.set(layer, notes.filter((note) => note !== key))
    }
    if (state.arpRun && state.arpMode !== 2) {
      if (!state.arpHold) this.scheduleArp(layer, state, mix, 1, 0.8, at ?? this.ctx.currentTime)
      return
    }
    if (state.voiceMode === 0) {
      const voice = this.voices.find((item) => item.layer === layer && item.key === key && item.held && !item.scheduled)
      if (!voice) return
      voice.held = false
      if (sustained && state.sustped) {
        voice.sustained = true
        return
      }
      this.release(voice, state, at)
      return
    }
    const remaining = this.held.get(layer) ?? []
    if (remaining.length === 0) {
      const voice = this.mono[layer]
      if (!voice) return
      voice.held = false
      if (sustained && state.sustped) {
        voice.sustained = true
        return
      }
      this.release(voice, state, at)
      this.mono[layer] = undefined
      return
    }
    const next = this.pick(remaining, state.priority, this.last.get(layer) ?? remaining[0]!)
    this.glideTo(layer, next, state, mix, at ?? this.ctx.currentTime, true)
  }

  private playMono(
    layer: SynthLayerId,
    key: number,
    velocity: number,
    zoneGain: number,
    state: SynthLayerDocument,
    mix: SynthMix,
    start: number,
  ) {
    const notes = this.held.get(layer) ?? [key]
    const chosen = this.pick(notes, state.priority, key)
    const existing = this.mono[layer]
    const legato = state.voiceMode === 2 && existing && existing.held
    if (existing && legato) {
      this.glideTo(layer, chosen, state, mix, start, true)
      return
    }
    if (existing) this.release(existing, state, start)
    const voice = this.startVoice(layer, chosen, velocity, zoneGain, state, mix, start, false, state.glide > 0 && notes.length > 1)
    if (voice) this.mono[layer] = voice
  }

  private pick(notes: number[], priority: number, last: number): number {
    if (notes.length === 0) return last
    if (priority === 1) return Math.min(...notes)
    if (priority === 2) return Math.max(...notes)
    return notes.includes(last) ? last : notes[notes.length - 1]!
  }

  private glideTo(layer: SynthLayerId, key: number, state: SynthLayerDocument, mix: SynthMix, start: number, legato: boolean) {
    const voice = this.mono[layer]
    if (!voice) return
    const sounding = clampMidi(key + state.octave + state.coarse + mix.transpose)
    const freq = midiFreq(sounding) * 2 ** (state.fine / 100 / 12)
    const semis = Math.abs(12 * Math.log2(Math.max(1, freq) / Math.max(1, voice.freq)))
    const speed = 1 + (1 - state.glide / 127) * 36
    const duration = state.glide > 0 && legato ? Math.max(0.01, semis / speed) : 0.01
    for (const target of voice.bend) {
      const next = (freq / voice.freq) * target.base
      try {
        target.param.setValueAtTime(target.param.value || target.base, start)
        target.param.linearRampToValueAtTime?.(next, start + duration)
      } catch {
        target.param.value = next
      }
      target.base = next
    }
    voice.freq = freq
    voice.key = key
    voice.held = true
  }

  private startVoice(
    layer: SynthLayerId,
    key: number,
    velocity: number,
    zoneGain: number,
    state: SynthLayerDocument,
    mix: SynthMix,
    start: number,
    scheduled: boolean,
    glide: boolean,
    stopAt?: number,
  ): SynthVoice | null {
    const sounding = clampMidi(key + state.octave + state.coarse + mix.transpose)
    const freq = midiFreq(sounding) * 2 ** (state.fine / 100 / 12)
    const amp = this.ctx.createGain()
    const velCurve = [1, 0.55, 1, 1.45][Math.max(0, Math.min(3, state.ampEnv.velocity))] ?? 1
    const shaped = Math.max(0.05, Math.min(1, velocity)) ** velCurve
    const peak = (0.12 + 0.28 * shaped) * zoneGain * (state.unison > 0 ? 0.7 : 1)
    const attack = envSeconds(state.ampEnv.attack, 1.4)
    const decay = envSeconds(state.ampEnv.decay, 1.6)
    const sustainMode = state.ampEnv.decay >= 124
    amp.gain.setValueAtTime(0.0001, start)
    amp.gain.linearRampToValueAtTime(peak, start + attack)
    if (!sustainMode) amp.gain.linearRampToValueAtTime(Math.max(0.0002, peak * 0.35), start + attack + decay)
    amp.connect(this.levels[layer])
    const filter = this.buildFilter(state, sounding, start)
    const drive = this.buildDrive(state)
    drive.output.connect(filter.input)
    filter.output.connect(amp)
    const nodes: AudioNodeLike[] = [amp, filter.input, filter.output, drive.input, drive.output]
    const oscs: OscillatorNodeLike[] = []
    const bend: BendTarget[] = []
    const factor = state.pstick ? 2 ** ((mix.stick / 100) * 2 / 12) : 1
    this.buildSource(state, freq * factor, start, drive.input, nodes, oscs, bend, mix.wheel)
    this.routeLfo(layer, state, filter.input, bend)
    this.routeVibrato(state, freq, mix.wheel, start, bend, nodes, oscs)
    const voice: SynthVoice = { layer, key, nodes, oscs, bend, timer: null, held: !scheduled, sustained: false, freq, scheduled }
    this.voices.push(voice)
    if (glide && state.glide > 0) {
      /* frequency already at target; glide from a neighbor is handled by playMono */
    }
    if (stopAt !== undefined) {
      this.release(voice, state, stopAt)
    }
    return voice
  }

  private buildDrive(state: SynthLayerDocument): { input: GainNodeLike; output: AudioNodeLike } {
    const input = this.ctx.createGain()
    if (state.filterDrive <= 0) return { input, output: input }
    const shaper = this.ctx.createWaveShaper()
    const curve = new Float32Array(256)
    const k = [0, 2.2, 5, 9][state.filterDrive] ?? 2
    const norm = Math.tanh(k)
    for (let index = 0; index < curve.length; index++) {
      const x = (index / (curve.length - 1)) * 2 - 1
      curve[index] = Math.tanh(k * x) / norm
    }
    shaper.curve = curve
    const makeup = this.ctx.createGain()
    makeup.gain.value = 0.8
    input.connect(shaper)
    shaper.connect(makeup)
    return { input, output: makeup }
  }

  private buildFilter(state: SynthLayerDocument, midi: number, start: number): { input: BiquadFilterNodeLike; output: BiquadFilterNodeLike } {
    const filter = this.ctx.createBiquadFilter()
    const types = ['lowpass', 'lowpass', 'highpass', 'bandpass'] as const
    filter.type = types[Math.max(0, Math.min(3, state.filterType))] ?? 'lowpass'
    const track = [0, 1 / 3, 2 / 3, 1][state.filterTrack] ?? 0
    const base = 70 + (state.filterFreq / 127) * 7200
    const cutoff = state.filterOn ? base * 2 ** (((midi - 60) / 12) * track) : 18000
    filter.frequency.setValueAtTime(cutoff, start)
    filter.Q.setValueAtTime(0.4 + (state.filterRes / 127) * (state.filterType === 0 ? 14 : 8), start)
    const env = state.filterEnv
    const attack = envSeconds(env.attack, 1.2)
    const decay = envSeconds(env.decay, 1.4)
    const amount = state.filterOn ? (state.filterEnvAmt / 127) * (env.velocity ? 1 : 0.7) : 0
    const open = Math.min(16000, cutoff * (1 + amount * 4))
    const ramp = (node: BiquadFilterNodeLike) => {
      if (amount <= 0.01) return
      node.frequency.setValueAtTime(cutoff, start)
      node.frequency.linearRampToValueAtTime(open, start + attack)
      if (env.decay < 124) node.frequency.linearRampToValueAtTime(cutoff, start + attack + decay)
    }
    ramp(filter)
    if (state.filterType === 0) {
      const second = this.ctx.createBiquadFilter()
      second.type = 'lowpass'
      second.frequency.setValueAtTime(cutoff, start)
      second.Q.value = filter.Q.value
      ramp(second)
      filter.connect(second)
      return { input: filter, output: second }
    }
    return { input: filter, output: filter }
  }

  private buildSource(
    state: SynthLayerDocument,
    freq: number,
    start: number,
    destination: AudioNodeLike,
    nodes: AudioNodeLike[],
    oscs: OscillatorNodeLike[],
    bend: BendTarget[],
    wheel: number,
  ) {
    const index = state.waveform
    const category = categoryOf(index)
    const ctrl = state.oscCtrl / 127
    const spreads = state.unison === 0 ? [0] : state.unison === 1 ? [-6, 6] : state.unison === 2 ? [-12, 0, 12] : [-18, -7, 7, 18]
    const addOsc = (type: OscillatorType, ratio: number, gainValue: number, detuneCents: number) => {
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = type
      const base = freq * ratio * 2 ** (detuneCents / 1200)
      osc.frequency.setValueAtTime(base, start)
      bend.push({ param: osc.frequency, base })
      gain.gain.value = gainValue
      osc.connect(gain)
      gain.connect(destination)
      osc.start(start)
      oscs.push(osc)
      nodes.push(osc, gain)
      return osc
    }
    if (category === 'Pure') {
      if (index === 6) {
        const length = Math.floor(this.ctx.sampleRate * 0.5)
        const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate)
        const data = buffer.getChannelData(0)
        const next = mulberry32(99)
        for (let sample = 0; sample < length; sample++) data[sample] = next() * 2 - 1
        const source = this.ctx.createBufferSource()
        const gain = this.ctx.createGain()
        source.buffer = buffer
        source.loop = true
        gain.gain.value = 0.35
        source.connect(gain)
        gain.connect(destination)
        source.start(start)
        nodes.push(source, gain)
        return
      }
      if (index === 4 || index === 5) {
        this.addPulse(index === 4 ? 0.33 : 0.1, freq, start, destination, nodes, bend)
        return
      }
      const type: OscillatorType = index === 0 ? 'sine' : index === 1 ? 'triangle' : index === 2 ? 'sawtooth' : 'square'
      for (const cents of spreads) addOsc(type, 1, 1 / spreads.length, cents)
      void ctrl
      void wheel
      return
    }
    if (category === 'Sync') {
      const type: OscillatorType = index === 8 ? 'square' : 'sawtooth'
      addOsc(type, 1, 0.6, 0)
      addOsc(type, 1.2 + ctrl * 6, 0.45, 0)
      return
    }
    if (category === 'Multi') {
      const detune = 2 + ctrl * 28
      const ratios = index === 10 ? [1, 2] : [1, 1, 1]
      const cents = index === 10 ? [-detune, detune] : [-detune, 0, detune]
      ratios.forEach((ratio, slot) => addOsc('sawtooth', ratio, 0.45, cents[slot] ?? 0))
      return
    }
    if (category === 'Super') {
      const detune = 4 + ctrl * 40
      const type: OscillatorType = index === 12 ? 'square' : 'sawtooth'
      const cents = [-detune * 1.4, -detune * 0.6, 0, detune * 0.6, detune * 1.4]
      for (const cent of cents) addOsc(type, 1, 0.28, cent)
      return
    }
    const carrier = addOsc('sine', 1, 0.8, 0)
    const mod = this.ctx.createOscillator()
    const modGain = this.ctx.createGain()
    mod.frequency.setValueAtTime(freq * 2, start)
    bend.push({ param: mod.frequency, base: freq * 2 })
    modGain.gain.setValueAtTime(freq * ctrl * 4, start)
    mod.connect(modGain)
    modGain.connect(carrier.frequency)
    mod.start(start)
    oscs.push(mod)
    nodes.push(mod, modGain)
    const oscEnv = state.oscEnv
    if (Math.abs(state.oscEnvAmt) > 1) {
      const depth = ((state.oscEnvAmt - 64) / 64) * freq * 0.5
      const attack = envSeconds(oscEnv.attack, 0.8)
      const param = state.envToPitch ? carrier.frequency : modGain.gain
      const base = param.value || (state.envToPitch ? freq : freq * ctrl * 4)
      param.setValueAtTime(base, start)
      param.linearRampToValueAtTime(base + depth, start + attack)
    }
  }

  private addPulse(
    duty: number,
    freq: number,
    start: number,
    destination: AudioNodeLike,
    nodes: AudioNodeLike[],
    bend: BendTarget[],
  ) {
    const length = 1024
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let index = 0; index < length; index++) data[index] = index / length < duty ? 0.8 : -0.8
    const source = this.ctx.createBufferSource()
    const gain = this.ctx.createGain()
    source.buffer = buffer
    source.loop = true
    const rate = (freq * length) / this.ctx.sampleRate
    source.playbackRate.setValueAtTime(rate, start)
    bend.push({ param: source.playbackRate, base: rate })
    gain.gain.value = 0.7
    source.connect(gain)
    gain.connect(destination)
    source.start(start)
    nodes.push(source, gain)
  }

  private routeLfo(layer: SynthLayerId, state: SynthLayerDocument, filter: BiquadFilterNodeLike, bend: BendTarget[]) {
    if (state.lfoDest === 0 || state.lfoAmount <= 0) return
    const depth = this.lfos[layer].depth
    if (state.lfoDest === 3) depth.connect(filter.frequency)
    else if (state.lfoDest === 2) depth.connect(filter.Q)
    else {
      for (const target of bend) depth.connect(target.param)
    }
  }

  private routeVibrato(
    state: SynthLayerDocument,
    freq: number,
    wheel: number,
    start: number,
    bend: BendTarget[],
    nodes: AudioNodeLike[],
    oscs: OscillatorNodeLike[],
  ) {
    if (state.vibratoMode === 0 || state.vibratoAmount <= 0 || bend.length === 0) return
    const lfo = this.ctx.createOscillator()
    const depth = this.ctx.createGain()
    const hz = 2 + (state.vibratoRate / 127) * 6
    lfo.frequency.value = hz
    const full = freq * (state.vibratoAmount / 127) * 0.04
    const amount = state.vibratoMode === 2 ? full * (wheel / 127) : full
    if (state.vibratoMode === 1) {
      depth.gain.setValueAtTime(0, start)
      depth.gain.linearRampToValueAtTime(amount, start + 0.55)
    } else depth.gain.setValueAtTime(amount, start)
    lfo.connect(depth)
    for (const target of bend) depth.connect(target.param)
    lfo.start(start)
    oscs.push(lfo)
    nodes.push(lfo, depth)
  }

  private scheduleArp(
    layer: SynthLayerId,
    state: SynthLayerDocument,
    mix: SynthMix,
    zoneGain: number,
    velocity: number,
    start: number,
  ) {
    for (const voice of [...this.voices]) {
      if (voice.layer === layer && voice.scheduled) this.drop(voice)
    }
    const notes = [...(this.held.get(layer) ?? [])].sort((left, right) => left - right)
    if (!state.arpRun || notes.length === 0) return
    const step = mix.arpSync ? clockHz(mix.bpm, state.arpRate, ARP_BEATS.map((beat) => 1 / beat)) : 60 / (40 + (state.arpRate / 127) * 240)
    const stepSec = mix.arpSync ? (60 / mix.bpm) * ARP_BEATS[Math.round((state.arpRate / 127) * (ARP_BEATS.length - 1))]! : 60 / (40 + (state.arpRate / 127) * 240)
    void step
    const range = 1 + Math.round((state.arpRange / 127) * 3)
    const seed = notes.reduce((sum, note) => sum + note * 17, 11) + state.arpDirection * 100
    const random = mulberry32(seed)
    const sequence = this.sequence(notes, state.arpDirection, range, random)
    const count = Math.max(4, Math.ceil(4 / stepSec))
    for (let index = 0; index < count; index++) {
      const when = start + index * stepSec
      if (state.arpMode === 1) {
        const oct = index % range
        for (const note of notes) this.startVoice(layer, note + oct * 12, velocity, zoneGain, state, mix, when, true, false, when + stepSec * 0.45)
      } else {
        const note = sequence[index % sequence.length]!
        this.startVoice(layer, note, velocity, zoneGain, state, mix, when, true, false, when + stepSec * 0.48)
      }
    }
  }

  private sequence(notes: number[], direction: number, range: number, random: () => number): number[] {
    const up: number[] = []
    for (let oct = 0; oct < range; oct++) for (const note of notes) up.push(note + oct * 12)
    if (direction === 1) return [...up].reverse()
    if (direction === 2) {
      const down = [...up].reverse().slice(1, -1)
      return [...up, ...down]
    }
    if (direction === 3) {
      return Array.from({ length: Math.max(8, up.length * 2) }, () => up[Math.floor(random() * up.length)]!)
    }
    return up
  }

  private scheduleGate(layer: SynthLayerId, state: SynthLayerDocument, mix: SynthMix, start: number) {
    const stepSec = mix.arpSync
      ? (60 / mix.bpm) * ARP_BEATS[Math.round((state.arpRate / 127) * (ARP_BEATS.length - 1))]!
      : 60 / (40 + (state.arpRate / 127) * 240)
    const hardness = state.arpRange / 127
    const attack = 0.004 + (1 - hardness) * 0.08
    const gate = this.gates[layer].gain
    const count = Math.ceil(4 / stepSec)
    try {
      gate.cancelScheduledValues(start)
      gate.setValueAtTime(0, start)
      for (let index = 0; index < count; index++) {
        const when = start + index * stepSec
        gate.setValueAtTime(0.0001, when)
        gate.linearRampToValueAtTime(1, when + attack)
        gate.setValueAtTime(1, when + stepSec * 0.45)
        gate.linearRampToValueAtTime(0.0001, when + stepSec * 0.45 + 0.02)
      }
    } catch {
      gate.value = 1
    }
  }

  setSustain(down: boolean, layers: Record<SynthLayerId, SynthLayerDocument>) {
    if (down) return
    for (const voice of [...this.voices]) {
      if (voice.sustained && !voice.held) this.release(voice, layers[voice.layer])
    }
  }

  private release(voice: SynthVoice, state: SynthLayerDocument, at?: number) {
    const start = at ?? this.ctx.currentTime
    const release = envSeconds(state.ampEnv.release, 2.2)
    const gain = voice.nodes[0]
    const param = gain && 'gain' in gain ? (gain as GainNodeLike).gain : null
    if (param) {
      try {
        param.cancelScheduledValues(start)
        param.setValueAtTime(Math.max(0.0001, param.value), start)
        param.linearRampToValueAtTime(0.0001, start + release)
      } catch {
        param.value = 0.0001
      }
    }
    voice.timer = this.timers.setTimeout(() => this.drop(voice), Math.max(30, release * 1000 + 40))
    voice.sustained = false
    voice.held = false
  }

  allNotesOff() {
    for (const voice of [...this.voices]) this.drop(voice)
    this.held.clear()
    for (const layer of ['A', 'B', 'C'] as const) {
      this.held.set(layer, [])
      this.mono[layer] = undefined
      this.gates[layer].gain.value = 1
    }
  }

  applyBend(stick: number, pstick: Record<SynthLayerId, boolean>) {
    for (const voice of this.voices) {
      const factor = pstick[voice.layer] ? 2 ** ((stick / 100) * 2 / 12) : 1
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

  private drop(voice: SynthVoice) {
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
    if (this.mono[voice.layer] === voice) this.mono[voice.layer] = undefined
  }

  dispose() {
    this.allNotesOff()
    for (const layer of ['A', 'B', 'C'] as const) {
      try {
        this.lfos[layer].osc.stop()
      } catch {
        /* stopped */
      }
      try {
        this.levels[layer].disconnect()
        this.gates[layer].disconnect()
      } catch {
        /* closed */
      }
    }
  }
}
