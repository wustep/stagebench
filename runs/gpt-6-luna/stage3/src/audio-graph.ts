import type {
  AudioConfiguration,
  EffectUnitId,
  EffectUnitState,
  LayerId,
  PianoOutput,
  PianoType,
} from './audio'
import { effectiveReleaseSeconds, midiFrequency, renderPianoWave, velocityAmplitude } from './audio'
import { zoneGainsForNote, type InstrumentPatch, type OrganLayerState, type SynthLayerState } from './stage3'

type AudioContextConstructor = new () => AudioContext

interface ProcessorNetwork {
  input: AudioNode
  output: AudioNode
  nodes: AudioNode[]
  oscillators: OscillatorNode[]
  update?: (context: AudioContext, state: EffectUnitState) => void
}

interface EffectUnitGraph {
  input: GainNode
  output: GainNode
  dryGain: GainNode
  wetInput: GainNode
  wetGain: GainNode
  network: ProcessorNetwork | null
  type: string
  reverbSettings: string
}

interface LayerGraph {
  input: GainNode
  timbre: BiquadFilterNode
  units: Record<EffectUnitId, EffectUnitGraph>
  rotary: StereoPannerNode
  rotaryDrive: WaveShaperNode
  rotaryBass: GainNode
  level: GainNode
  rotaryMotion: GainNode
  bassMotion: GainNode
  voices: Map<string, ActiveVoice[]>
}

type BusLayerId = LayerId | 'organ' | 'synthA' | 'synthB' | 'synthC'

interface Stage3Voice {
  route: string
  bus: BusLayerId
  sources: AudioScheduledSourceNode[]
  nodes: AudioNode[]
  envelopes: GainNode[]
  stopped: boolean
  releaseSeconds: number
}

interface ActiveVoice {
  sources: AudioBufferSourceNode[]
  gains: GainNode[]
  nodes: AudioNode[]
  basePlaybackRate: number
  stopped: boolean
  releasedLayers: Set<LayerId>
}

const LAYERS: LayerId[] = ['A', 'B']
const ENGINE_LAYERS: BusLayerId[] = ['A', 'B', 'organ', 'synthA', 'synthB', 'synthC']
const UNIT_ORDER: EffectUnitId[] = ['mod1', 'mod2', 'delay', 'ampEq', 'compressor', 'reverb']
export const SAMPLE_ROOTS: Record<PianoType, Array<{ note: string; midi: number }>> = {
  Grand: [
    { note: 'C2', midi: 36 }, { note: 'F#2', midi: 42 }, { note: 'C3', midi: 48 }, { note: 'F#3', midi: 54 },
    { note: 'C4', midi: 60 }, { note: 'F#4', midi: 66 }, { note: 'C5', midi: 72 }, { note: 'F#5', midi: 78 },
    { note: 'C6', midi: 84 }, { note: 'F#6', midi: 90 }, { note: 'C7', midi: 96 }, { note: 'C8', midi: 108 },
  ],
  Upright: [
    { note: 'C2', midi: 36 }, { note: 'F#2', midi: 42 }, { note: 'C3', midi: 48 }, { note: 'F#3', midi: 54 },
    { note: 'D#4', midi: 63 }, { note: 'F#4', midi: 66 }, { note: 'C5', midi: 72 }, { note: 'F#5', midi: 78 },
    { note: 'C6', midi: 84 }, { note: 'F#6', midi: 90 }, { note: 'C7', midi: 96 }, { note: 'C8', midi: 108 },
  ],
  Electric: [
    { note: 'F1', midi: 29 }, { note: 'B1', midi: 35 }, { note: 'E2', midi: 40 }, { note: 'A2', midi: 45 },
    { note: 'D3', midi: 50 }, { note: 'G3', midi: 55 }, { note: 'B3', midi: 59 }, { note: 'D4', midi: 62 },
    { note: 'F4', midi: 65 }, { note: 'B4', midi: 71 }, { note: 'E5', midi: 76 }, { note: 'A5', midi: 81 },
    { note: 'D6', midi: 86 }, { note: 'G6', midi: 91 }, { note: 'C7', midi: 96 },
  ],
  Clav: [],
  Digital: [],
  Misc: [],
}

export const VELOCITY_FILES: Record<'Grand' | 'Upright' | 'Electric', string[]> = {
  Grand: ['3', '8', '13'],
  Upright: ['soft', 'hard'],
  Electric: ['1', '3', '5'],
}

const MOD1_TYPES = ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump']
const MOD2_TYPES = ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin']
const AMP_TYPES = ['EQ only', 'Twin', 'JC', 'Small', 'LP24 Filter', 'HP24 Filter', 'To Rotary']
const REVERB_TYPES = ['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral']

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function browserAudioContext(): AudioContext {
  const audioWindow = window as Window & { webkitAudioContext?: AudioContextConstructor }
  const Constructor = window.AudioContext ?? audioWindow.webkitAudioContext
  if (!Constructor) throw new Error('Web Audio is unavailable in this browser')
  return new Constructor()
}

function ramp(context: AudioContext, param: AudioParam, value: number, seconds = 0.025): void {
  const now = context.currentTime
  param.cancelScheduledValues(now)
  param.setValueAtTime(Number.isFinite(param.value) ? param.value : 0, now)
  param.linearRampToValueAtTime(value, now + seconds)
}

function sineOscillator(context: AudioContext, rate: number, type: OscillatorType = 'sine'): OscillatorNode {
  const oscillator = context.createOscillator()
  oscillator.type = type
  oscillator.frequency.value = clamp(rate, 0.1, 1800)
  oscillator.start()
  return oscillator
}

function oscillatorDepth(context: AudioContext, oscillator: OscillatorNode, amount: number): GainNode {
  const depth = context.createGain()
  depth.gain.value = amount
  oscillator.connect(depth)
  return depth
}

function makeNetwork(input: AudioNode, output: AudioNode, nodes: AudioNode[], oscillators: OscillatorNode[] = []): ProcessorNetwork {
  return { input, output, nodes, oscillators }
}

function makeMod1(context: AudioContext, type: string, state: EffectUnitState): ProcessorNetwork {
  const nodes: AudioNode[] = []
  const oscillators: OscillatorNode[] = []
  const amount = clamp(state.amount, 0, 1)
  const rate = 0.15 + state.rate * 9
  if (type === 'A-Pan') {
    const pan = context.createStereoPanner()
    const lfo = sineOscillator(context, rate)
    const depth = oscillatorDepth(context, lfo, amount)
    depth.connect(pan.pan)
    nodes.push(pan, depth)
    oscillators.push(lfo)
    return { ...makeNetwork(pan, pan, nodes, oscillators), update: (nextContext, nextState) => {
      ramp(nextContext, lfo.frequency, 0.15 + nextState.rate * 9)
      ramp(nextContext, depth.gain, nextState.amount)
    } }
  }
  if (type === 'Tremolo' || type === 'Pump') {
    const gain = context.createGain()
    const lfo = sineOscillator(context, rate, type === 'Pump' ? 'square' : 'sine')
    gain.gain.value = 1 - amount * 0.48
    const depth = oscillatorDepth(context, lfo, amount * 0.48)
    depth.connect(gain.gain)
    nodes.push(gain, depth)
    oscillators.push(lfo)
    return { ...makeNetwork(gain, gain, nodes, oscillators), update: (nextContext, nextState) => {
      ramp(nextContext, lfo.frequency, 0.15 + nextState.rate * 9)
      ramp(nextContext, gain.gain, 1 - nextState.amount * 0.48)
      ramp(nextContext, depth.gain, nextState.amount * 0.48)
    } }
  }
  if (type === 'Ring Mod') {
    const gain = context.createGain()
    gain.gain.value = 0
    const lfo = sineOscillator(context, 22 + state.rate * 480)
    const depth = oscillatorDepth(context, lfo, amount)
    depth.connect(gain.gain)
    nodes.push(gain, depth)
    oscillators.push(lfo)
    return { ...makeNetwork(gain, gain, nodes, oscillators), update: (nextContext, nextState) => {
      ramp(nextContext, lfo.frequency, 22 + nextState.rate * 480)
      ramp(nextContext, depth.gain, nextState.amount)
    } }
  }
  const filter = context.createBiquadFilter()
  filter.type = type === 'A-Wah' ? 'bandpass' : 'lowpass'
  filter.Q.value = type === 'A-Wah' ? 1.5 + amount * 9 : 0.8 + amount * 12
  filter.frequency.value = type === 'A-Wah' ? 800 : 2200
  const lfo = sineOscillator(context, rate * (type === 'A-Wah' ? 0.6 : 1))
  const depth = oscillatorDepth(context, lfo, type === 'A-Wah' ? 1400 * amount : 2100 * amount)
  depth.connect(filter.frequency)
  nodes.push(filter, depth)
  oscillators.push(lfo)
  return { ...makeNetwork(filter, filter, nodes, oscillators), update: (nextContext, nextState) => {
    ramp(nextContext, lfo.frequency, 0.15 + nextState.rate * 9 * (type === 'A-Wah' ? 0.6 : 1))
    ramp(nextContext, depth.gain, (type === 'A-Wah' ? 1400 : 2100) * nextState.amount)
    ramp(nextContext, filter.Q, type === 'A-Wah' ? 1.5 + nextState.amount * 9 : 0.8 + nextState.amount * 12)
  } }
}

function makeMod2(context: AudioContext, type: string, state: EffectUnitState): ProcessorNetwork {
  const nodes: AudioNode[] = []
  const oscillators: OscillatorNode[] = []
  const rate = 0.08 + state.rate * 6
  const amount = clamp(state.amount, 0.01, 1)
  if (type === 'Phaser' || type === 'Vibe') {
    const count = type === 'Phaser' ? 4 : 6
    const filters = Array.from({ length: count }, () => {
      const filter = context.createBiquadFilter()
      filter.type = 'allpass'
      filter.Q.value = type === 'Phaser' ? 0.7 + amount * 2.5 : 1.8 + amount * 3.5
      filter.frequency.value = type === 'Phaser' ? 850 : 360
      nodes.push(filter)
      return filter
    })
    const lfo = sineOscillator(context, rate, type === 'Vibe' ? 'triangle' : 'sine')
    const depth = oscillatorDepth(context, lfo, type === 'Phaser' ? amount * 1100 : amount * 1750)
    filters.forEach((filter, index) => {
      depth.connect(filter.frequency)
      if (index > 0) filters[index - 1]?.connect(filter)
    })
    nodes.push(depth)
    oscillators.push(lfo)
    return { ...makeNetwork(filters[0]!, filters.at(-1)!, nodes, oscillators), update: (nextContext, nextState) => {
      const nextAmount = clamp(nextState.amount, 0.01, 1)
      ramp(nextContext, lfo.frequency, 0.08 + nextState.rate * 6)
      ramp(nextContext, depth.gain, nextAmount * (type === 'Phaser' ? 1100 : 1750))
      filters.forEach((filter) => ramp(nextContext, filter.Q, type === 'Phaser' ? 0.7 + nextAmount * 2.5 : 1.8 + nextAmount * 3.5))
    } }
  }
  if (type === 'Ensemble') {
    const sum = context.createGain()
    const delays: DelayNode[] = []
    const gains: GainNode[] = []
    const depths: GainNode[] = []
    const lfos: OscillatorNode[] = []
    const taps = [0.012, 0.021, 0.032].map((delayTime, index) => {
      const delay = context.createDelay(0.2)
      delay.delayTime.value = delayTime
      const gain = context.createGain()
      gain.gain.value = 0.34
      const lfo = sineOscillator(context, rate * (index + 0.8))
      const depth = oscillatorDepth(context, lfo, 0.002 + amount * 0.004)
      depth.connect(delay.delayTime)
      delay.connect(gain)
      gain.connect(sum)
      delays.push(delay)
      gains.push(gain)
      depths.push(depth)
      lfos.push(lfo)
      nodes.push(delay, gain, depth)
      oscillators.push(lfo)
      return delay
    })
    const input = context.createGain()
    for (const tap of taps) input.connect(tap)
    nodes.push(input, sum)
    return { ...makeNetwork(input, sum, nodes, oscillators), update: (nextContext, nextState) => {
      const nextAmount = clamp(nextState.amount, 0.01, 1)
      lfos.forEach((lfo, index) => ramp(nextContext, lfo.frequency, (0.08 + nextState.rate * 6) * ((index + 0.8) / 1.8)))
      delays.forEach((delay, index) => ramp(nextContext, delay.delayTime, [0.012, 0.021, 0.032][index]!))
      depths.forEach((depth) => ramp(nextContext, depth.gain, 0.002 + nextAmount * 0.004))
      gains.forEach((gain) => ramp(nextContext, gain.gain, 0.24 + nextAmount * 0.2))
    } }
  }
  const delay = context.createDelay(0.1)
  delay.delayTime.value = type === 'Flanger' ? 0.004 : 0.024
  const lfo = sineOscillator(context, rate)
  const depth = oscillatorDepth(context, lfo, type === 'Flanger' ? amount * 0.0035 : amount * 0.005)
  depth.connect(delay.delayTime)
  if (type === 'Flanger') {
    const feedback = context.createGain()
    feedback.gain.value = 0.2 + amount * 0.58
    delay.connect(feedback)
    feedback.connect(delay)
    nodes.push(feedback)
  }
  if (type === 'Spin') {
    const pan = context.createStereoPanner()
    const panLfo = sineOscillator(context, rate * 0.55)
    const panDepth = oscillatorDepth(context, panLfo, 0.35 + amount * 0.6)
    panDepth.connect(pan.pan)
    delay.connect(pan)
    nodes.push(pan, panDepth)
    oscillators.push(panLfo)
    nodes.push(delay, depth)
    oscillators.push(lfo)
    return { ...makeNetwork(delay, pan, nodes, oscillators), update: (nextContext, nextState) => {
      const nextAmount = clamp(nextState.amount, 0.01, 1)
      ramp(nextContext, lfo.frequency, 0.08 + nextState.rate * 6)
      ramp(nextContext, depth.gain, 0.002 + nextAmount * 0.005)
      ramp(nextContext, panLfo.frequency, (0.08 + nextState.rate * 6) * 0.55)
      ramp(nextContext, panDepth.gain, 0.35 + nextAmount * 0.6)
    } }
  }
  nodes.push(delay, depth)
  oscillators.push(lfo)
  const feedbackNode = nodes.find((node): node is GainNode => node instanceof GainNode)
  return { ...makeNetwork(delay, delay, nodes, oscillators), update: (nextContext, nextState) => {
    const nextAmount = clamp(nextState.amount, 0.01, 1)
    ramp(nextContext, lfo.frequency, 0.08 + nextState.rate * 6)
    ramp(nextContext, delay.delayTime, type === 'Flanger' ? 0.004 : 0.024)
    ramp(nextContext, depth.gain, type === 'Flanger' ? nextAmount * 0.0035 : nextAmount * 0.005)
    if (feedbackNode) ramp(nextContext, feedbackNode.gain, 0.2 + nextAmount * 0.58)
  } }
}

function makeDelay(context: AudioContext, state: EffectUnitState): ProcessorNetwork {
  const delay = context.createDelay(4)
  delay.delayTime.value = 0.08 + state.time * 0.9
  const feedback = context.createGain()
  feedback.gain.value = clamp(state.feedback, 0, 0.88)
  const filter = context.createBiquadFilter()
  filter.type = state.filter === 'LP' ? 'lowpass' : state.filter === 'HP' ? 'highpass' : state.filter === 'BP' ? 'bandpass' : 'allpass'
  filter.frequency.value = state.filter === 'LP' ? 4200 : state.filter === 'HP' ? 700 : 1800
  filter.Q.value = 0.7
  delay.connect(filter)
  filter.connect(feedback)
  feedback.connect(delay)
  return makeNetwork(delay, delay, [delay, filter, feedback])
}

export function driveCurve(amount: number, style: 'soft' | 'bright' | 'small'): Float32Array<ArrayBuffer> {
  const samples = 512
  const curve = new Float32Array(samples)
  const drive = 1 + amount * (style === 'small' ? 17 : 9)
  for (let index = 0; index < samples; index += 1) {
    const x = (index * 2) / (samples - 1) - 1
    const shaped = Math.tanh(x * drive)
    curve[index] = style === 'bright' ? Math.tanh(shaped * 1.7) : style === 'small' ? shaped * 0.8 : shaped
  }
  return curve
}

function makeAmpEq(context: AudioContext, type: string, state: EffectUnitState): ProcessorNetwork {
  const nodes: AudioNode[] = []
  const filters: BiquadFilterNode[] = []
  if (type === 'To Rotary') {
    const pass = context.createGain()
    return makeNetwork(pass, pass, [pass])
  }
  if (type === 'Twin' || type === 'JC' || type === 'Small') {
    const drive = context.createWaveShaper()
    const amount = type === 'JC' ? Math.min(state.drive, 0.5) : type === 'Small' ? Math.min(1, state.drive + 0.2) : state.drive
    drive.curve = driveCurve(amount, type === 'JC' ? 'bright' : type === 'Small' ? 'small' : 'soft')
    drive.oversample = '2x'
    nodes.push(drive)
    const speaker = context.createBiquadFilter()
    speaker.type = type === 'Small' ? 'lowpass' : 'highpass'
    speaker.frequency.value = type === 'Small' ? 3600 : 80
    nodes.push(speaker)
    drive.connect(speaker)
    return makeNetwork(drive, speaker, nodes)
  }
  if (type === 'LP24 Filter' || type === 'HP24 Filter') {
    const filterType = type === 'LP24 Filter' ? 'lowpass' : 'highpass'
    for (let index = 0; index < 2; index += 1) {
      const filter = context.createBiquadFilter()
      filter.type = filterType
      filter.frequency.value = 80 * 200 ** clamp(state.midFrequency, 0, 1)
      filter.Q.value = 0.7 + state.mid * 2.4
      filters.push(filter)
      nodes.push(filter)
      if (index > 0) filters[index - 1]?.connect(filter)
    }
    return makeNetwork(filters[0]!, filters[1]!, nodes)
  }
  const bass = context.createBiquadFilter()
  bass.type = 'lowshelf'
  bass.frequency.value = 100
  bass.gain.value = state.bass * 18 - 9
  const mid = context.createBiquadFilter()
  mid.type = 'peaking'
  mid.frequency.value = clamp(state.midFrequency, 200, 8000)
  mid.Q.value = 0.8
  mid.gain.value = state.mid * 18 - 9
  const treble = context.createBiquadFilter()
  treble.type = 'highshelf'
  treble.frequency.value = 4000
  treble.gain.value = state.treble * 18 - 9
  bass.connect(mid)
  mid.connect(treble)
  nodes.push(bass, mid, treble)
  return makeNetwork(bass, treble, nodes)
}

function seededNoise(seed: number): number {
  let value = seed | 0
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b)
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b)
  value = (value ^ (value >>> 16)) >>> 0
  return value / 0xffffffff * 2 - 1
}

function makeReverb(context: AudioContext, type: string, state: EffectUnitState): ProcessorNetwork {
  if (type === 'Spring') {
    const delay = context.createDelay(0.1)
    delay.delayTime.value = 0.023
    const feedback = context.createGain()
    feedback.gain.value = 0.58 + state.decay * 0.22
    const resonator = context.createBiquadFilter()
    resonator.type = 'bandpass'
    resonator.frequency.value = 900 + state.brightness * 4000
    resonator.Q.value = 5.5
    delay.connect(resonator)
    resonator.connect(feedback)
    feedback.connect(delay)
    return makeNetwork(delay, resonator, [delay, resonator, feedback])
  }
  const seconds = type === 'Booth' ? 0.18 : type === 'Room' ? 0.55 : type === 'Stage' ? 1.5 : type === 'Hall' ? 3.1 : 5.2
  const convolver = context.createConvolver()
  convolver.buffer = makeReverbImpulse(context, seconds, state)
  return makeNetwork(convolver, convolver, [convolver])
}

function makeReverbImpulse(context: AudioContext, seconds: number, state: EffectUnitState): AudioBuffer {
  const frameCount = Math.round(context.sampleRate * seconds)
  const impulse = context.createBuffer(2, frameCount, context.sampleRate)
  for (let channel = 0; channel < 2; channel += 1) {
    const samples = impulse.getChannelData(channel)
    for (let frame = 0; frame < frameCount; frame += 1) {
      const time = frame / frameCount
      const decay = (1 - time) ** (2.1 + state.decay * 2.4)
      const damping = 0.32 + state.brightness * 0.68
      samples[frame] = seededNoise(frame + channel * 1867) * decay * damping * (0.75 + 0.25 * Math.sin(time * 1900))
    }
  }
  return impulse
}

function makeCompressor(context: AudioContext, state: EffectUnitState): ProcessorNetwork {
  const compressor = context.createDynamicsCompressor()
  compressor.threshold.value = -2 - state.amount * 32
  compressor.knee.value = 10 + state.amount * 22
  compressor.ratio.value = 1 + state.amount * 11
  compressor.attack.value = state.fast ? 0.003 : 0.025
  compressor.release.value = state.fast ? 0.08 : 0.22
  return makeNetwork(compressor, compressor, [compressor])
}

function createProcessor(context: AudioContext, id: EffectUnitId, type: string, state: EffectUnitState): ProcessorNetwork {
  if (id === 'mod1') return makeMod1(context, type || MOD1_TYPES[0]!, state)
  if (id === 'mod2') return makeMod2(context, type || MOD2_TYPES[0]!, state)
  if (id === 'delay') return makeDelay(context, state)
  if (id === 'ampEq') return makeAmpEq(context, type || AMP_TYPES[0]!, state)
  if (id === 'compressor') return makeCompressor(context, state)
  return makeReverb(context, type || REVERB_TYPES[0]!, state)
}

function disposeNetwork(network: ProcessorNetwork | null): void {
  if (!network) return
  for (const oscillator of network.oscillators) {
    try { oscillator.stop() } catch { /* An oscillator may already have stopped. */ }
  }
  for (const node of network.nodes) node.disconnect()
}

function makeEffectUnit(context: AudioContext, _id: EffectUnitId): EffectUnitGraph {
  const input = context.createGain()
  const output = context.createGain()
  const dryGain = context.createGain()
  const wetInput = context.createGain()
  const wetGain = context.createGain()
  dryGain.gain.value = 1
  wetGain.gain.value = 0
  input.connect(dryGain)
  dryGain.connect(output)
  input.connect(wetInput)
  wetInput.gain.value = 1
  return { input, output, dryGain, wetInput, wetGain, network: null, type: '', reverbSettings: '' }
}

function typeFor(id: EffectUnitId, fallback: string): string {
  if (id === 'mod1') return MOD1_TYPES.includes(fallback) ? fallback : MOD1_TYPES[0]!
  if (id === 'mod2') return MOD2_TYPES.includes(fallback) ? fallback : MOD2_TYPES[0]!
  if (id === 'ampEq') return AMP_TYPES.includes(fallback) ? fallback : AMP_TYPES[0]!
  if (id === 'reverb') return REVERB_TYPES.includes(fallback) ? fallback : REVERB_TYPES[0]!
  return fallback
}

function generatedToneType(type: PianoType, midi: number, sampleRate: number): Float32Array {
  const base = renderPianoWave(midi, Math.round(sampleRate * 3), sampleRate)
  if (type === 'Clav') {
    const frequency = midiFrequency(midi)
    return Float32Array.from(base, (value, index) => value * Math.exp(-index / sampleRate * 2.7) + Math.sin(2 * Math.PI * frequency * 3.08 * index / sampleRate) * Math.exp(-index / sampleRate * 4.8) * 0.11)
  }
  if (type === 'Digital') {
    const frequency = midiFrequency(midi)
    return Float32Array.from(base, (value, index) => value * 0.68 + Math.sin(2 * Math.PI * frequency * 2 * index / sampleRate) * Math.exp(-index / sampleRate * 2.1) * 0.2)
  }
  if (type === 'Misc') {
    const frequency = midiFrequency(midi)
    return Float32Array.from(base, (value, index) => value * 0.2 + Math.sin(2 * Math.PI * frequency * 2.76 * index / sampleRate) * Math.exp(-index / sampleRate * 3.2) * 0.72)
  }
  return base
}

export function closestSampleRoot(type: PianoType, midi: number): { note: string; midi: number } {
  const roots = SAMPLE_ROOTS[type]
  return roots.reduce((best, candidate) => Math.abs(candidate.midi - midi) < Math.abs(best.midi - midi) ? candidate : best, roots[0]!)
}

export function selectedVelocityFile(type: PianoType, velocity: number): string {
  if (type === 'Grand') return velocity < 46 ? '3' : velocity < 91 ? '8' : '13'
  if (type === 'Upright') return velocity < 80 ? 'soft' : 'hard'
  if (type === 'Electric') return velocity < 48 ? '1' : velocity < 92 ? '3' : '5'
  return 'synth'
}

export function touchVelocity(velocity: number, touch: AudioConfiguration['performance']['touch']): number {
  const input = clamp(velocity / 127, 0, 1)
  const shaped = touch === 'Heavy' ? input ** 1.35 : touch === 'Light' ? input ** 0.76 : input
  return clamp(Math.round(shaped * 127), 1, 127)
}

export function applyDynComp(velocity: number, amount: number): number {
  if (amount === 0) return velocity
  const normalized = velocity / 127
  const ratio = 1 + amount * 0.42
  return clamp(Math.round((normalized ** (1 / ratio)) * 127), 1, 127)
}

export function dryWetGains(mix: number, enabled: boolean): { dry: number; wet: number } {
  const wet = enabled ? clamp(mix, 0, 1) : 0
  return { dry: enabled ? 1 - wet : 1, wet }
}

export class WebAudioPianoGraph implements PianoOutput {
  private context: AudioContext | null = null
  private masterGain: GainNode | null = null
  private limiter: DynamicsCompressorNode | null = null
  private rotaryLfo: OscillatorNode | null = null
  private rotaryDepth: GainNode | null = null
  private rotaryBassLfo: OscillatorNode | null = null
  private rotaryBassDepth: GainNode | null = null
  private readonly layerGraphs = new Map<BusLayerId, LayerGraph>()
  private readonly sampleBuffers = new Map<string, AudioBuffer>()
  private readonly loadingSamples = new Map<string, Promise<AudioBuffer>>()
  private readonly active = new Map<string, Map<LayerId, ActiveVoice>>()
  private readonly generatedBuffers = new Map<string, AudioBuffer>()
  private readonly stage3Voices = new Map<string, Stage3Voice[]>()
  private readonly lastStage3Midi = new Map<string, number>()
  private stage3Patch: InstrumentPatch | null = null
  private b3PercussionLatched = false
  private configuration: AudioConfiguration | null = null
  private loadSequence = 0
  private disposed = false

  constructor(private readonly contextFactory: () => AudioContext = browserAudioContext) {}

  async prepare(type: PianoType): Promise<'ready' | 'fallback'> {
    this.disposed = false
    if (!SAMPLE_ROOTS[type].length) return 'ready'
    const sequence = ++this.loadSequence
    try {
      await Promise.all(SAMPLE_ROOTS[type].flatMap((root) => VELOCITY_FILES[type as 'Grand' | 'Upright' | 'Electric'].map((velocity) => this.loadSample(type, root.note, velocity))))
      return sequence === this.loadSequence ? 'ready' : 'fallback'
    } catch {
      return 'fallback'
    }
  }

  configure(configuration: AudioConfiguration): void {
    this.disposed = false
    this.configuration = configuration
    const context = this.getContext()
    this.applyConfiguration(configuration, context)
  }

  configureStage3(patch: InstrumentPatch): void {
    this.disposed = false
    this.stage3Patch = structuredClone(patch)
    const context = this.getContext()
    this.applyStage3Buses(patch, context)
  }

  noteOn(id: string, midi: number, velocity: number, layerIds: LayerId[] = ['A'], layerGains: Partial<Record<LayerId, number>> = {}): void {
    if (this.disposed) return
    const context = this.getContext()
    const configuration = this.configuration ?? defaultConfiguration()
    this.noteOff(id, 0.006)
    const voiceMap = new Map<LayerId, ActiveVoice>()
    const shapedVelocity = applyDynComp(touchVelocity(velocity, configuration.performance.touch), configuration.performance.dynComp)
    const amplitude = velocityAmplitude(shapedVelocity)
    for (const layerId of layerIds) {
      const layerState = configuration.layers[layerId]
      if (!configuration.sectionOn || !layerState.enabled) continue
      const graph = this.layerGraphs.get(layerId)
      if (!graph) continue
      const shiftedMidi = clamp(midi + layerState.octave * 12, 0, 127)
      const sample = this.getVoiceBuffer(configuration.pianoType, shiftedMidi, shapedVelocity)
      const root = SAMPLE_ROOTS[configuration.pianoType].length ? closestSampleRoot(configuration.pianoType, shiftedMidi) : null
      const playbackRate = root ? midiFrequency(shiftedMidi) / midiFrequency(root.midi) : 1
      const voice: ActiveVoice = { sources: [], gains: [], nodes: [], basePlaybackRate: playbackRate, stopped: false, releasedLayers: new Set() }
      const unison = configuration.performance.unison
      const voiceCount = unison === 0 ? 1 : unison + 1
      for (let voiceIndex = 0; voiceIndex < voiceCount; voiceIndex += 1) {
        const source = context.createBufferSource()
        source.buffer = sample
        source.playbackRate.value = playbackRate
        if (voiceIndex > 0) source.detune.value = (voiceIndex % 2 === 0 ? 1 : -1) * unison * 3.5
        const gain = context.createGain()
        const panner = context.createStereoPanner()
        const routeGain = clamp(layerGains[layerId] ?? 1, 0, 1)
        gain.gain.value = voiceIndex === 0 ? amplitude * routeGain : amplitude * (0.16 / unison) * routeGain
        panner.pan.value = voiceIndex === 0 ? 0 : voiceIndex % 2 === 0 ? 0.72 : -0.72
        source.connect(gain)
        gain.connect(panner)
        panner.connect(graph.input)
        voice.sources.push(source)
        voice.gains.push(gain)
        voice.nodes.push(source, gain, panner)
      }
      voiceMap.set(layerId, voice)
      graph.voices.set(id, [...(graph.voices.get(id) ?? []), voice])
      for (const source of voice.sources) {
        source.onended = () => {
          source.disconnect()
          for (const node of voice.nodes) node.disconnect()
        }
        source.start()
      }
      if (configuration.performance.stringRes && graph.voices.size > 1) {
        const resonance = context.createOscillator()
        const resonanceGain = context.createGain()
        resonance.frequency.value = midiFrequency(clamp(shiftedMidi + 12, 0, 127))
        resonance.type = 'sine'
        resonanceGain.gain.value = amplitude * 0.035
        resonance.connect(resonanceGain)
        resonanceGain.connect(graph.input)
        resonance.start()
        voice.gains.push(resonanceGain)
        voice.nodes.push(resonance, resonanceGain)
      }
    }
    if (voiceMap.size > 0) this.active.set(id, voiceMap)
    void context.resume().catch(() => undefined)
  }

  noteOnStage3(id: string, midi: number, velocity: number, routes: string[], patch: InstrumentPatch): void {
    if (this.disposed) return
    const context = this.getContext()
    this.noteOffStage3(id, 0.004)
    const level = velocityAmplitude(velocity)
    const zoneGains = zoneGainsForNote(midi + patch.transpose, patch.splits)
    for (const route of routes) {
      if (route.startsWith('organ-')) {
        const layerId = route.endsWith('-B') ? 'B' : 'A'
        const state = patch.organ.layers[layerId]
        if (!patch.organ.sectionOn || !state.enabled) continue
        const zoneGain = Math.max(0, ...Object.entries(zoneGains).filter(([index]) => Number(index) >= state.zoneStart && Number(index) <= state.zoneEnd).map(([, gain]) => gain))
        const percussionTrigger = state.percussionOn && state.model === 'B3' && !this.b3PercussionLatched
        if (percussionTrigger) this.b3PercussionLatched = true
        const voice = this.makeOrganVoice(context, midi + state.octave * 12 + patch.transpose, level * state.level * zoneGain, state, percussionTrigger)
        if (voice) {
          voice.route = route
          voice.bus = 'organ'
          this.stage3Voices.set(id, [...(this.stage3Voices.get(id) ?? []), voice])
        }
        continue
      }
      if (!route.startsWith('synth-')) continue
      const layerId = route.endsWith('-C') ? 'C' : route.endsWith('-B') ? 'B' : 'A'
      const state = patch.synth.layers[layerId]
      if (!state.enabled) continue
      const zoneGain = Math.max(0, ...Object.entries(zoneGains).filter(([index]) => Number(index) >= state.zoneStart && Number(index) <= state.zoneEnd).map(([, gain]) => gain))
      const velocityGain = state.amplifierEnvelope.velocity ? level : 0.36
      let wasLegato = false
      if (state.voiceMode !== 'Poly') {
        for (const [voiceId, activeVoices] of this.stage3Voices) {
          const matching = activeVoices.some((activeVoice) => activeVoice.route === route && !activeVoice.stopped)
          if (matching && voiceId !== id) {
            wasLegato ||= state.voiceMode === 'Legato'
            this.noteOffStage3(voiceId, 0.008, [route])
          }
        }
      }
      const voice = this.makeSynthVoice(context, midi + state.octave * 12 + state.pitch + patch.transpose, velocityGain * state.level * zoneGain, state, route, patch.clockBpm, patch.clockSync, wasLegato)
      if (voice) {
        voice.route = route
        voice.bus = layerId === 'A' ? 'synthA' : layerId === 'B' ? 'synthB' : 'synthC'
        this.stage3Voices.set(id, [...(this.stage3Voices.get(id) ?? []), voice])
      }
    }
    this.applyStage3Buses(patch, context)
    void context.resume().catch(() => undefined)
  }

  noteOffStage3(id: string, releaseSeconds = 0.24, routes?: string[]): void {
    const voices = this.stage3Voices.get(id)
    const context = this.context
    if (!voices || !context) return
    const keep: Stage3Voice[] = []
    for (const voice of voices) {
      if ((routes && !routes.includes(voice.route)) || voice.stopped) { keep.push(voice); continue }
      voice.stopped = true
      const release = Math.max(0.008, releaseSeconds || voice.releaseSeconds)
      const now = context.currentTime
      for (const envelopeNode of voice.envelopes) {
        envelopeNode.gain.cancelScheduledValues(now)
        envelopeNode.gain.setValueAtTime(Math.max(envelopeNode.gain.value, 0.0001), now)
        envelopeNode.gain.exponentialRampToValueAtTime(0.0001, now + release)
      }
      let finalized = false
      const finishVoice = () => {
        if (finalized) return
        finalized = true
        for (const node of voice.nodes) node.disconnect()
        const activeVoices = this.stage3Voices.get(id) ?? []
        const remaining = activeVoices.filter((activeVoice) => activeVoice !== voice)
        if (remaining.length) this.stage3Voices.set(id, remaining)
        else this.stage3Voices.delete(id)
      }
      for (const source of voice.sources) {
        source.onended = finishVoice
        try { source.stop(now + release + 0.02) } catch { source.disconnect() }
      }
    }
    if (keep.length) this.stage3Voices.set(id, keep)
    else this.stage3Voices.delete(id)
    if (![...this.stage3Voices.values()].flat().some((voice) => voice.route.startsWith('organ-') && !voice.stopped)) this.b3PercussionLatched = false
  }

  private makeOrganVoice(context: AudioContext, midi: number, amplitude: number, state: OrganLayerState, percussionTrigger: boolean): Stage3Voice | null {
    const bus = this.layerGraphs.get('organ')
    if (!bus) return null
    const noteFrequency = midiFrequency(clamp(midi, 0, 127))
    const envelope = context.createGain()
    envelope.gain.setValueAtTime(0.0001, context.currentTime)
    envelope.gain.linearRampToValueAtTime(Math.max(0.0001, amplitude * 0.42), context.currentTime + 0.012)
    const nodes: AudioNode[] = [envelope]
    envelope.connect(bus.input)
    const sources: AudioScheduledSourceNode[] = []
    const spectra: Record<OrganLayerState['model'], number[]> = {
      B3: [0.5, 1, 1.5, 2, 3, 4, 5, 6, 8],
      Vox: [0.5, 1, 2, 3, 4, 5, 6, 8, 10],
      Farf: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      'Pipe 1': [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6],
    }
    const modelWeights: Record<OrganLayerState['model'], number[]> = {
      B3: [0.74, 1, 0.6, 0.43, 0.34, 0.27, 0.2, 0.15, 0.12],
      Vox: [0.88, 0.78, 0.74, 0.66, 0.53, 0.43, 0.33, 0.22, 0.13],
      Farf: [0.48, 0.85, 0.8, 0.72, 0.63, 0.55, 0.45, 0.36, 0.27],
      'Pipe 1': [0.62, 1, 0.72, 0.55, 0.4, 0.32, 0.21, 0.14, 0.09],
    }
    const drawbars = state.model === 'Farf' ? state.drawbars.map((value) => value >= 4 ? 8 : 0) : state.drawbars
    for (let index = 0; index < 9; index += 1) {
      const level = (drawbars[index] ?? 0) / 8 * (modelWeights[state.model]![index] ?? 0.1)
      if (level < 0.012) continue
      const oscillator = context.createOscillator()
      oscillator.type = state.model === 'Farf' ? 'square' : 'sine'
      oscillator.frequency.value = Math.min(18_000, noteFrequency * (spectra[state.model]![index] ?? 1))
      const partial = context.createGain()
      partial.gain.value = level / 5.5
      oscillator.connect(partial)
      partial.connect(envelope)
      sources.push(oscillator)
      nodes.push(oscillator, partial)
      oscillator.start()
      if (state.vibratoOn && state.vibratoMode.startsWith('C')) {
        const chorus = context.createOscillator()
        const chorusGain = context.createGain()
        chorus.type = oscillator.type
        chorus.frequency.value = oscillator.frequency.value
        chorus.detune.value = 4 + (Number(state.vibratoMode.slice(1)) || 1) * 2
        chorusGain.gain.value = level * 0.28 / 5.5
        chorus.connect(chorusGain)
        chorusGain.connect(envelope)
        chorus.start()
        sources.push(chorus)
        nodes.push(chorus, chorusGain)
      }
    }
    if (percussionTrigger) {
      const transient = context.createOscillator()
      transient.type = 'sine'
      transient.frequency.value = noteFrequency * (state.percussionThird ? 3 : 2)
      const transientGain = context.createGain()
      const duration = state.percussionFast ? 0.12 : 0.42
      transientGain.gain.setValueAtTime(state.percussionSoft ? 0.055 : 0.12, context.currentTime)
      transientGain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration)
      transient.connect(transientGain)
      transientGain.connect(bus.input)
      sources.push(transient)
      nodes.push(transient, transientGain)
      transient.start()
    }
    if (state.keyClick) {
      const click = context.createOscillator()
      click.type = 'square'
      click.frequency.value = 2800 + (midi % 7) * 90
      const clickGain = context.createGain()
      clickGain.gain.setValueAtTime(0.035, context.currentTime)
      clickGain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.018)
      click.connect(clickGain)
      clickGain.connect(bus.input)
      sources.push(click)
      nodes.push(click, clickGain)
      click.start()
    }
    if (state.vibratoOn) {
      const lfo = context.createOscillator()
      const depth = context.createGain()
      const modeIndex = Number(state.vibratoMode.slice(1)) || 1
      lfo.type = state.vibratoMode.startsWith('C') ? 'sine' : 'triangle'
      lfo.frequency.value = 4.5 + modeIndex * 0.62
      depth.gain.value = (state.vibratoMode.startsWith('C') ? 4 : 7) * modeIndex
      lfo.connect(depth)
      for (const source of sources) if (source instanceof OscillatorNode) depth.connect(source.detune)
      sources.push(lfo)
      nodes.push(lfo, depth)
      lfo.start()
    }
    return { route: '', bus: 'organ', sources, nodes, envelopes: [envelope], stopped: false, releaseSeconds: 0.18 }
  }

  private makeSynthVoice(context: AudioContext, midi: number, amplitude: number, state: SynthLayerState, route: string, clockBpm: number, clockSync: boolean, legato = false): Stage3Voice | null {
    const bus = this.layerGraphs.get(route.endsWith('-C') ? 'synthC' : route.endsWith('-B') ? 'synthB' : 'synthA')
    if (!bus) return null
    const now = context.currentTime
    const frequency = midiFrequency(clamp(midi + state.fine / 100, 0, 127))
    const previousMidi = this.lastStage3Midi.get(`mono:${route}`)
    const glideFrom = state.voiceMode !== 'Poly' && state.glide > 0 && previousMidi !== undefined ? midiFrequency(previousMidi + state.fine / 100) : frequency
    const filter = context.createBiquadFilter()
    filter.type = ({ LP12: 'lowpass', LP24: 'lowpass', HP: 'highpass', BP: 'bandpass' } as const)[state.filterType]
    const tracking = [0, 1 / 3, 2 / 3, 1][state.tracking] ?? 0
    const trackedCutoff = 55 * (19_000 / 55) ** clamp(state.cutoff, 0, 1) * 2 ** ((midi - 60) * tracking / 12)
    filter.frequency.value = clamp(trackedCutoff, 30, 19_000)
    filter.Q.value = 0.3 + clamp(state.resonance, 0, 1) * 14
    let outputFilter: AudioNode = filter
    const filterStages: BiquadFilterNode[] = [filter]
    if (state.filterType === 'LP24') {
      const secondFilter = context.createBiquadFilter()
      secondFilter.type = 'lowpass'
      secondFilter.frequency.value = filter.frequency.value
      secondFilter.Q.value = filter.Q.value
      filter.connect(secondFilter)
      outputFilter = secondFilter
      filterStages.push(secondFilter)
    }
    const drive = context.createWaveShaper()
    drive.curve = driveCurve(state.drive / 3 * 0.55, 'soft')
    const envelope = context.createGain()
    const ampEnvelope = state.amplifierEnvelope
    const attack = 0.003 + ampEnvelope.attack * 1.8
    const decay = 0.01 + ampEnvelope.decay * 1.6
    const sustain = clamp(ampEnvelope.sustain, 0.01, 1)
    envelope.gain.setValueAtTime(legato ? Math.max(0.0001, amplitude * 0.48) : 0.0001, now)
    if (!legato) envelope.gain.linearRampToValueAtTime(Math.max(0.0001, amplitude * 0.48), now + attack)
    envelope.gain.linearRampToValueAtTime(Math.max(0.0001, amplitude * 0.48 * sustain), now + (legato ? 0 : attack) + decay)
    outputFilter.connect(drive)
    drive.connect(envelope)
    envelope.connect(bus.input)
    const sources: AudioScheduledSourceNode[] = []
    const audioNodes: AudioNode[] = [...filterStages, drive, envelope]
    const waveform = state.waveform
    const oscillators: OscillatorNode[] = []
    let oscCtrlParam: AudioParam | null = null
    const makeOscillator = (type: OscillatorType, detune = 0, octave = 0) => {
      const oscillator = context.createOscillator()
      oscillator.type = type
      if (glideFrom !== frequency && state.glide > 0) {
        oscillator.frequency.setValueAtTime(glideFrom * 2 ** octave, now)
        oscillator.frequency.linearRampToValueAtTime(frequency * 2 ** octave, now + state.glide * 1.2)
      } else oscillator.frequency.value = frequency * 2 ** octave
      oscillator.detune.value = detune
      oscillator.connect(filter)
      oscillator.start(now)
      oscillators.push(oscillator)
      sources.push(oscillator)
      audioNodes.push(oscillator)
      return oscillator
    }
    let baseType: OscillatorType = 'sawtooth'
    if (waveform === 'Sine') baseType = 'sine'
    else if (waveform === 'Triangle') baseType = 'triangle'
    else if (waveform === 'Square' || waveform === 'Sync Square' || waveform === 'Super Square') baseType = 'square'
    else if (waveform === 'FM 2-op (algorithm A)') baseType = 'sine'
    if (waveform === 'White Noise') {
      const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate)
      const channel = buffer.getChannelData(0)
      let seed = (midi + 1) * 176
      for (let index = 0; index < channel.length; index += 1) { seed = (seed * 16807) % 2147483647; channel[index] = (seed / 1073731823.5) - 1 }
      const noise = context.createBufferSource()
      noise.buffer = buffer
      noise.loop = true
      noise.connect(filter)
      noise.start(now)
      sources.push(noise)
      audioNodes.push(noise)
    } else if (state.category === 'Multi') {
      const count = waveform === 'Multi Saw 8ve' ? 3 : 5
      for (let index = 0; index < count; index += 1) {
        const octave = waveform === 'Multi Saw 8ve' && index === 2 ? 1 : 0
        makeOscillator('sawtooth', (index - (count - 1) / 2) * (2 + state.oscCtrl * 28), octave)
      }
    } else if (state.category === 'Super') {
      const type: OscillatorType = waveform === 'Super Square' ? 'square' : 'sawtooth'
      for (let index = 0; index < 7; index += 1) makeOscillator(type, (index - 3) * (3 + state.oscCtrl * 40))
    } else if (state.category === 'Sync') {
      makeOscillator(baseType)
      makeOscillator(baseType, 15 + state.oscCtrl * 700)
    } else if (state.category === 'FM-H') {
      const carrier = makeOscillator('sine')
      const modulator = context.createOscillator()
      const modDepth = context.createGain()
      modulator.type = 'sine'
      modulator.frequency.value = frequency * 2
      modDepth.gain.value = frequency * state.oscCtrl * 5
      oscCtrlParam = modDepth.gain
      modulator.connect(modDepth)
      modDepth.connect(carrier.frequency)
      modulator.start(now)
      sources.push(modulator)
      audioNodes.push(modulator, modDepth)
    } else {
      makeOscillator(baseType)
      if (waveform.startsWith('Pulse')) {
        const pulse = context.createOscillator()
        pulse.type = 'square'
        pulse.frequency.value = frequency
        pulse.detune.value = waveform === 'Pulse 10' ? -125 : -35
        pulse.connect(filter)
        pulse.start(now)
        oscillators.push(pulse)
        sources.push(pulse)
        audioNodes.push(pulse)
      }
    }
    if (state.subLevel > 0) {
      const sub = context.createOscillator()
      const subGain = context.createGain()
      sub.type = 'sine'
      if (glideFrom !== frequency && state.glide > 0) {
        sub.frequency.setValueAtTime(glideFrom / 2, now)
        sub.frequency.linearRampToValueAtTime(frequency / 2, now + state.glide * 1.2)
      } else sub.frequency.value = frequency / 2
      subGain.gain.value = state.subLevel * 0.55
      sub.connect(subGain)
      subGain.connect(filter)
      sub.start(now)
      sources.push(sub)
      audioNodes.push(sub, subGain)
    }
    if (state.noiseLevel > 0) {
      const noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate)
      const noiseData = noiseBuffer.getChannelData(0)
      let seed = (midi + 97) * 231
      for (let index = 0; index < noiseData.length; index += 1) { seed = (seed * 16807) % 2147483647; noiseData[index] = (seed / 1073731823.5) - 1 }
      const noise = context.createBufferSource()
      const noiseGain = context.createGain()
      noise.buffer = noiseBuffer
      noise.loop = true
      noiseGain.gain.value = state.noiseLevel * 0.28
      noise.connect(noiseGain)
      noiseGain.connect(filter)
      noise.start(now)
      sources.push(noise)
      audioNodes.push(noise, noiseGain)
    }
    if (state.unison > 0 && state.category !== 'Multi' && state.category !== 'Super') {
      for (let index = 0; index < state.unison; index += 1) makeOscillator(baseType, (index % 2 ? -1 : 1) * (7 + index * 4))
    }
    if (state.filterEnvelope.amount > 0) {
      const velocityAmount = state.filterEnvelope.velocity ? amplitude / 0.48 : 0.7
      const baseCutoff = filter.frequency.value
      const peak = Math.min(18_000, baseCutoff + state.filterEnvelope.amount * velocityAmount * 8_000)
      filter.frequency.setValueAtTime(peak, now + state.filterEnvelope.attack * 0.8)
      filter.frequency.exponentialRampToValueAtTime(Math.max(50, baseCutoff), now + state.filterEnvelope.attack * 0.8 + 0.08 + state.filterEnvelope.decay * 0.7)
    }
    const oscillatorEnvelope = state.oscillatorEnvelope
    if (oscillatorEnvelope.amount > 0) {
      const envelopeSource = context.createGain()
      const velocityAmount = oscillatorEnvelope.velocity ? amplitude / 0.48 : 0.7
      const depth = oscillatorEnvelope.amount * velocityAmount * (oscillatorEnvelope.toPitch ? 1_400 : 420)
      envelopeSource.gain.setValueAtTime(0.0001, now)
      envelopeSource.gain.linearRampToValueAtTime(depth, now + oscillatorEnvelope.attack)
      envelopeSource.gain.exponentialRampToValueAtTime(0.0001, now + oscillatorEnvelope.attack + Math.max(0.04, oscillatorEnvelope.decay))
      if (oscillatorEnvelope.toPitch) for (const oscillator of oscillators) envelopeSource.connect(oscillator.detune)
      else if (state.category === 'FM-H' && oscCtrlParam) envelopeSource.connect(oscCtrlParam)
      else if (state.category === 'Sync' || state.category === 'Multi' || state.category === 'Super') {
        for (const oscillator of oscillators.slice(1)) envelopeSource.connect(oscillator.detune)
      }
      audioNodes.push(envelopeSource)
    }
    const lfoActive = state.lfoDestination !== 'Off' && state.lfoAmount > 0
    if (lfoActive) {
      const depth = context.createGain()
      const lfoRate = clockSync && state.lfoSync ? clockBpm / 60 * Math.max(0.125, state.lfoRate * 2) : 0.1 + state.lfoRate * 14
      let lfo: OscillatorNode | AudioBufferSourceNode
      if (state.lfoWaveform === 'Sample & Hold') {
        const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate)
        const samples = buffer.getChannelData(0)
        const holdSamples = Math.max(1, Math.round(context.sampleRate / lfoRate))
        let seed = (midi + 71) * 419
        let held = 0
        for (let index = 0; index < samples.length; index += 1) {
          if (index % holdSamples === 0) { seed = (seed * 16807) % 2147483647; held = (seed / 1073731823.5) - 1 }
          samples[index] = held
        }
        const sampleHold = context.createBufferSource()
        sampleHold.buffer = buffer
        sampleHold.loop = true
        lfo = sampleHold
      } else {
        const oscillator = context.createOscillator()
        oscillator.type = state.lfoWaveform === 'Saw down' || state.lfoWaveform === 'Saw up' ? 'sawtooth' : state.lfoWaveform === 'Square' ? 'square' : 'triangle'
        oscillator.frequency.value = lfoRate
        lfo = oscillator
      }
      const sawDown = state.lfoWaveform === 'Saw down'
      depth.gain.value = (sawDown ? -1 : 1) * state.lfoAmount * (state.lfoDestination === 'Filter Freq' ? 2_400 : 80)
      lfo.connect(depth)
      if (state.lfoDestination === 'Filter Freq') depth.connect(filter.frequency)
      else if (state.lfoDestination === 'Osc Pitch') for (const oscillator of oscillators) depth.connect(oscillator.detune)
      else if (state.category === 'FM-H' && oscCtrlParam) depth.connect(oscCtrlParam)
      else if (state.category !== 'Pure') for (const oscillator of oscillators.slice(1)) depth.connect(oscillator.detune)
      lfo.start(now)
      sources.push(lfo)
      audioNodes.push(lfo, depth)
    }
    const monoKey = `mono:${route}`
    this.lastStage3Midi.set(monoKey, midi)
    const release = 0.02 + ampEnvelope.release * 2.4
    return { route: '', bus: 'synthA', sources, nodes: audioNodes, envelopes: [envelope], stopped: false, releaseSeconds: release }
  }

  noteOff(id: string, releaseSeconds = 0.24, layerIds?: LayerId[]): void {
    const voices = this.active.get(id)
    if (!voices) return
    const context = this.context
    if (!context) return
    const targets = layerIds ?? [...voices.keys()]
    const configuration = this.configuration ?? defaultConfiguration()
    for (const layerId of targets) {
      const voice = voices.get(layerId)
      if (!voice || voice.stopped) continue
      voice.stopped = true
      voice.releasedLayers.add(layerId)
      const release = effectiveReleaseSeconds(releaseSeconds, configuration.performance.softRelease, configuration.pianoType)
      for (const gain of voice.gains) {
        const now = context.currentTime
        gain.gain.cancelScheduledValues(now)
        gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + release)
      }
      for (const source of voice.sources) {
        try { source.stop(context.currentTime + release + 0.025) } catch { source.disconnect() }
      }
      for (const oscillator of voice.nodes.filter((node): node is OscillatorNode => node instanceof OscillatorNode)) {
        try { oscillator.stop(context.currentTime + release + 0.025) } catch { oscillator.disconnect() }
      }
      voices.delete(layerId)
      this.layerGraphs.get(layerId)?.voices.delete(id)
    }
    if (voices.size === 0) this.active.delete(id)
  }

  setSustain(_isDown: boolean, _layers: LayerId[]): void {
    // NoteLifecycle routes pedal-down and pedal-up per layer and owns held note IDs.
  }

  allNotesOff(): void {
    for (const id of this.active.keys()) this.noteOff(id, 0.012)
    for (const id of this.stage3Voices.keys()) this.noteOffStage3(id, 0.012)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.loadSequence += 1
    this.allNotesOff()
    for (const voices of this.stage3Voices.values()) for (const voice of voices) for (const node of voice.nodes) node.disconnect()
    this.stage3Voices.clear()
    this.lastStage3Midi.clear()
    this.b3PercussionLatched = false
    const context = this.context
    this.context = null
    this.masterGain?.disconnect()
    this.limiter?.disconnect()
    this.rotaryDepth?.disconnect()
    this.rotaryBassDepth?.disconnect()
    try { this.rotaryLfo?.stop() } catch { /* A closed context may already have stopped it. */ }
    try { this.rotaryBassLfo?.stop() } catch { /* A closed context may already have stopped it. */ }
    this.rotaryLfo?.disconnect()
    this.rotaryBassLfo?.disconnect()
    this.masterGain = null
    this.limiter = null
    this.rotaryLfo = null
    this.rotaryDepth = null
    this.rotaryBassLfo = null
    this.rotaryBassDepth = null
    for (const graph of this.layerGraphs.values()) {
      for (const unit of Object.values(graph.units)) {
        disposeNetwork(unit.network)
        unit.input.disconnect()
        unit.output.disconnect()
        unit.dryGain.disconnect()
        unit.wetInput.disconnect()
        unit.wetGain.disconnect()
      }
      graph.input.disconnect()
      graph.timbre.disconnect()
      graph.rotary.disconnect()
      graph.rotaryDrive.disconnect()
      graph.rotaryBass.disconnect()
      graph.level.disconnect()
      graph.rotaryMotion.disconnect()
      graph.bassMotion.disconnect()
    }
    this.layerGraphs.clear()
    this.sampleBuffers.clear()
    this.generatedBuffers.clear()
    this.loadingSamples.clear()
    if (context && context.state !== 'closed') void context.close().catch(() => undefined)
  }

  private getContext(): AudioContext {
    if (!this.context || this.context.state === 'closed') {
      const context = this.contextFactory()
      const master = context.createGain()
      const limiter = context.createDynamicsCompressor()
      limiter.threshold.value = -3
      limiter.knee.value = 0
      limiter.ratio.value = 20
      limiter.attack.value = 0.003
      limiter.release.value = 0.12
      master.connect(limiter)
      limiter.connect(context.destination)
      this.context = context
      this.masterGain = master
      this.limiter = limiter
      this.makeRotary(context)
      for (const layerId of ENGINE_LAYERS) this.makeLayer(layerId, context)
      this.applyConfiguration(this.configuration ?? defaultConfiguration(), context)
    }
    return this.context
  }

  private makeRotary(context: AudioContext): void {
    const lfo = sineOscillator(context, 0.7)
    const depth = context.createGain()
    depth.gain.value = 1
    lfo.connect(depth)
    const bassLfo = sineOscillator(context, 0.58)
    const bassDepth = context.createGain()
    bassDepth.gain.value = 1
    bassLfo.connect(bassDepth)
    this.rotaryLfo = lfo
    this.rotaryDepth = depth
    this.rotaryBassLfo = bassLfo
    this.rotaryBassDepth = bassDepth
  }

  private makeLayer(layerId: BusLayerId, context: AudioContext): void {
    const input = context.createGain()
    const timbre = context.createBiquadFilter()
    const units = Object.fromEntries(UNIT_ORDER.map((unit) => [unit, makeEffectUnit(context, unit)])) as Record<EffectUnitId, EffectUnitGraph>
    const rotaryDrive = context.createWaveShaper()
    rotaryDrive.curve = driveCurve(0.1, 'soft')
    rotaryDrive.oversample = '2x'
    const rotaryBass = context.createGain()
    const rotary = context.createStereoPanner()
    const level = context.createGain()
    const rotaryMotion = context.createGain()
    const bassMotion = context.createGain()
    rotaryMotion.gain.value = 0
    bassMotion.gain.value = 0
    input.connect(timbre)
    let cursor: AudioNode = timbre
    for (const unit of UNIT_ORDER) {
      const graph = units[unit]
      cursor.connect(graph.input)
      cursor = graph.output
    }
    cursor.connect(rotaryDrive)
    rotaryDrive.connect(rotaryBass)
    rotaryBass.connect(rotary)
    rotary.connect(level)
    level.connect(this.masterGain!)
    this.rotaryDepth?.connect(rotaryMotion)
    rotaryMotion.connect(rotary.pan)
    this.rotaryBassDepth?.connect(bassMotion)
    bassMotion.connect(rotaryBass.gain)
    this.layerGraphs.set(layerId, { input, timbre, units, rotary, rotaryDrive, rotaryBass, level, rotaryMotion, bassMotion, voices: new Map() })
  }

  private applyConfiguration(configuration: AudioConfiguration, context: AudioContext): void {
    if (!this.masterGain) return
    ramp(context, this.masterGain.gain, clamp(configuration.masterLevel, 0, 1) ** 1.7 * 0.86)
    if (this.rotaryLfo) ramp(context, this.rotaryLfo.frequency, configuration.effects.rotarySpeed === 'Stop' ? 0.05 : 0.15 + clamp(configuration.effects.rotaryRate, 0, 1) * 7.4, 0.72)
    if (this.rotaryBassLfo) ramp(context, this.rotaryBassLfo.frequency, configuration.effects.rotarySpeed === 'Stop' ? 0.05 : 0.12 + clamp(configuration.effects.rotaryRate, 0, 1) * 5.8, 0.72)
    for (const layerId of LAYERS) {
      const layer = this.layerGraphs.get(layerId)
      const state = configuration.layers[layerId]
      if (!layer) continue
      const unitSettings = structuredClone(configuration.effects.units[layerId])
      if (this.stage3Patch?.clockSync) {
        const beatSeconds = 60 / clamp(this.stage3Patch.clockBpm, 30, 300)
        unitSettings.delay.time = clamp((beatSeconds - 0.08) / 0.9, 0, 1)
        unitSettings.mod1.rate = clamp((this.stage3Patch.clockBpm / 60 - 0.15) / 9, 0, 1)
      }
      ramp(context, layer.level.gain, configuration.sectionOn && state.enabled ? clamp(state.level, 0, 1) : 0)
      layer.timbre.type = 'peaking'
      const variantFrequency = [2200, 1450, 3500][configuration.modelVariant] ?? 2200
      layer.timbre.frequency.value = configuration.pianoType === 'Electric' && configuration.performance.timbre.startsWith('Dyno') ? 1700 : variantFrequency
      const timbre = configuration.performance.timbre
      const voiceGain = [0, -2.5, 2.5][configuration.modelVariant] ?? 0
      const gain = voiceGain + (timbre === 'Soft' ? -7 : timbre === 'Mid' ? 3.5 : timbre === 'Bright' ? 8 : timbre === 'Dyno 1' ? 5 : timbre === 'Dyno 2' ? 10 : 0)
      ramp(context, layer.timbre.gain, gain)
      const rotaryEnabled = configuration.effects.rotaryOn && !configuration.effects.allBypass && unitSettings.ampEq.on && unitSettings.ampEq.type === 'To Rotary'
      ramp(context, layer.rotary.pan, 0, 0.02)
      layer.rotaryDrive.curve = driveCurve(rotaryEnabled ? configuration.effects.rotaryDrive : 0, 'soft')
      for (const unitId of UNIT_ORDER) {
        const state = unitSettings[unitId]
        this.updateUnit(context, unitId, layer.units[unitId]!, state, !configuration.effects.allBypass && state.on)
      }
      for (const voice of layer.voices.values()) {
        for (const activeVoice of voice) {
          const playbackRate = state.pitchStick ? activeVoice.basePlaybackRate * 2 ** (clamp(configuration.pitchBend, -2, 2) / 12) : activeVoice.basePlaybackRate
          for (const source of activeVoice.sources) ramp(context, source.playbackRate, playbackRate)
        }
      }
      const rotaryMoving = rotaryEnabled && configuration.effects.rotarySpeed !== 'Stop'
      ramp(context, layer.rotaryMotion.gain, rotaryMoving ? 0.35 + configuration.effects.rotaryDrive * 0.65 : 0)
      ramp(context, layer.bassMotion.gain, rotaryMoving ? 0.08 + configuration.effects.rotaryDrive * 0.06 : 0)
    }
    if (this.stage3Patch) this.applyStage3Buses(this.stage3Patch, context)
  }

  private applyStage3Buses(patch: InstrumentPatch, context: AudioContext): void {
    const configuration = this.configuration ?? defaultConfiguration()
    const organ = this.layerGraphs.get('organ')
    if (organ) this.applyEngineBus(organ, configuration, 'A', patch.organ.sectionOn && (patch.organ.layers.A.enabled || patch.organ.layers.B.enabled), Math.max(patch.organ.layers.A.level, patch.organ.layers.B.level), patch.organ.rotaryRoute, patch, context)
    const synthBuses: Array<{ bus: BusLayerId; layer: 'A' | 'B' | 'C'; effect: LayerId }> = [
      { bus: 'synthA', layer: 'A', effect: 'A' }, { bus: 'synthB', layer: 'B', effect: 'B' }, { bus: 'synthC', layer: 'C', effect: 'A' },
    ]
    for (const target of synthBuses) {
      const graph = this.layerGraphs.get(target.bus)
      const layer = patch.synth.layers[target.layer]
      if (graph) this.applyEngineBus(graph, configuration, target.effect, layer.enabled, layer.level, false, patch, context, layer.effects)
    }
  }

  private applyEngineBus(graph: LayerGraph, configuration: AudioConfiguration, effectLayer: LayerId, enabled: boolean, level: number, rotaryRoute: boolean, patch: InstrumentPatch, context: AudioContext, effectUnits?: AudioConfiguration['effects']['units']['A']): void {
    const units = structuredClone(effectUnits ?? configuration.effects.units[effectLayer])
    if (patch.clockSync) {
      const beatSeconds = 60 / clamp(patch.clockBpm, 30, 300)
      units.delay.time = clamp((beatSeconds - 0.08) / 0.9, 0, 1)
      units.mod1.rate = clamp((patch.clockBpm / 60 - 0.15) / 9, 0, 1)
    }
    ramp(context, graph.level.gain, enabled ? clamp(level, 0, 1) : 0)
    graph.timbre.gain.value = 0
    const rotaryEnabled = rotaryRoute && configuration.effects.rotaryOn && !configuration.effects.allBypass && units.ampEq.on && units.ampEq.type === 'To Rotary'
    graph.rotaryDrive.curve = driveCurve(rotaryEnabled ? configuration.effects.rotaryDrive : 0, 'soft')
    for (const unitId of UNIT_ORDER) this.updateUnit(context, unitId, graph.units[unitId]!, units[unitId], !configuration.effects.allBypass && units[unitId].on)
    const rotaryMoving = rotaryEnabled && configuration.effects.rotarySpeed !== 'Stop'
    ramp(context, graph.rotaryMotion.gain, rotaryMoving ? 0.35 + configuration.effects.rotaryDrive * 0.65 : 0)
    ramp(context, graph.bassMotion.gain, rotaryMoving ? 0.08 + configuration.effects.rotaryDrive * 0.06 : 0)
  }

  private updateUnit(context: AudioContext, id: EffectUnitId, graph: EffectUnitGraph, state: EffectUnitState, enabled: boolean): void {
    const nextType = typeFor(id, state.type)
    if (!graph.network || graph.type !== nextType) {
      disposeNetwork(graph.network)
      const network = createProcessor(context, id, nextType, state)
      graph.network = network
      graph.type = nextType
      if (id === 'reverb') graph.reverbSettings = `${state.brightness}:${state.decay}`
      graph.wetInput.connect(network.input)
      network.output.connect(graph.wetGain)
    } else {
      this.updateProcessorParams(id, graph.network, state)
      if (id === 'reverb') {
        const settings = `${state.brightness}:${state.decay}`
        if (settings !== graph.reverbSettings) {
          if (nextType === 'Spring') {
            const resonator = graph.network.nodes[1]
            const feedback = graph.network.nodes[2]
            if (resonator instanceof BiquadFilterNode) ramp(context, resonator.frequency, 900 + state.brightness * 4000)
            if (feedback instanceof GainNode) ramp(context, feedback.gain, 0.58 + state.decay * 0.22)
          } else {
            const convolver = graph.network.nodes[0]
            if (convolver instanceof ConvolverNode) {
              const seconds = nextType === 'Booth' ? 0.18 : nextType === 'Room' ? 0.55 : nextType === 'Stage' ? 1.5 : nextType === 'Hall' ? 3.1 : 5.2
              convolver.buffer = makeReverbImpulse(context, seconds, state)
            }
          }
          graph.reverbSettings = settings
        }
      }
    }
    const levels = dryWetGains(state.mix, enabled)
    ramp(context, graph.dryGain.gain, levels.dry)
    ramp(context, graph.wetGain.gain, levels.wet)
    if (id === 'delay' && graph.network) {
      const delay = graph.network.nodes[0]
      if (delay instanceof DelayNode) ramp(context, delay.delayTime, 0.08 + state.time * 0.9)
    }
  }

  private updateProcessorParams(id: EffectUnitId, network: ProcessorNetwork, state: EffectUnitState): void {
    const context = this.context
    if (!context) return
    if (id === 'compressor') {
      const compressor = network.nodes[0]
      if (compressor instanceof DynamicsCompressorNode) {
        ramp(context, compressor.threshold, -2 - state.amount * 32)
        ramp(context, compressor.ratio, 1 + state.amount * 11)
        ramp(context, compressor.attack, state.fast ? 0.003 : 0.025)
        ramp(context, compressor.release, state.fast ? 0.08 : 0.22)
      }
    } else if (id === 'delay') {
      const delay = network.nodes[0]
      const filter = network.nodes[1]
      const feedback = network.nodes[2]
      if (delay instanceof DelayNode) ramp(context, delay.delayTime, 0.08 + state.time * 0.9)
      if (feedback instanceof GainNode) ramp(context, feedback.gain, clamp(state.feedback, 0, 0.88))
      if (filter instanceof BiquadFilterNode) {
        filter.type = state.filter === 'LP' ? 'lowpass' : state.filter === 'HP' ? 'highpass' : state.filter === 'BP' ? 'bandpass' : 'allpass'
      }
    } else if (id === 'mod1' || id === 'mod2') {
      network.update?.(context, state)
    } else if (id === 'ampEq') {
      for (const node of network.nodes) {
        if (node instanceof WaveShaperNode && (state.type === 'Twin' || state.type === 'JC' || state.type === 'Small')) {
          const amount = state.type === 'JC' ? Math.min(state.drive, 0.5) : state.type === 'Small' ? Math.min(1, state.drive + 0.2) : state.drive
          node.curve = driveCurve(amount, state.type === 'JC' ? 'bright' : state.type === 'Small' ? 'small' : 'soft')
        }
        if (!(node instanceof BiquadFilterNode)) continue
        if (node.type === 'lowshelf') ramp(context, node.gain, state.bass * 18 - 9)
        else if (node.type === 'highshelf') ramp(context, node.gain, state.treble * 18 - 9)
        else if (node.type === 'peaking') {
          ramp(context, node.gain, state.mid * 18 - 9)
          ramp(context, node.frequency, 200 * 40 ** clamp(state.midFrequency, 0, 1))
        } else if (node.type === 'lowpass' || node.type === 'highpass') {
          ramp(context, node.frequency, 80 * 200 ** clamp(state.midFrequency, 0, 1))
          ramp(context, node.Q, 0.7 + state.mid * 2.4)
        }
      }
    } else if (id === 'reverb' && state.type === 'Spring') {
      const resonator = network.nodes[1]
      const feedback = network.nodes[2]
      if (resonator instanceof BiquadFilterNode) ramp(context, resonator.frequency, 900 + state.brightness * 4000)
      if (feedback instanceof GainNode) ramp(context, feedback.gain, 0.58 + state.decay * 0.22)
    }
  }

  private getVoiceBuffer(type: PianoType, midi: number, velocity: number): AudioBuffer {
    const context = this.context!
    if (SAMPLE_ROOTS[type].length > 0) {
      const root = closestSampleRoot(type, midi)
      const velocityLayer = selectedVelocityFile(type as 'Grand' | 'Upright' | 'Electric', velocity)
      const key = `${type}:${root.note}:v${velocityLayer}`
      const recorded = this.sampleBuffers.get(key)
      if (recorded) return recorded
    }
    const cacheKey = `${type}:${midi}`
    const cached = this.generatedBuffers.get(cacheKey)
    if (cached) return cached
    const wave = generatedToneType(type, midi, context.sampleRate)
    const buffer = context.createBuffer(1, wave.length, context.sampleRate)
    buffer.getChannelData(0).set(wave)
    this.generatedBuffers.set(cacheKey, buffer)
    return buffer
  }

  private loadSample(type: PianoType, note: string, velocity: string): Promise<AudioBuffer> {
    const key = `${type}:${note}:v${velocity}`
    const cached = this.sampleBuffers.get(key)
    if (cached) return Promise.resolve(cached)
    const loading = this.loadingSamples.get(key)
    if (loading) return loading
    const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`
    const file = `${base}samples/${type.toLowerCase()}/${encodeURIComponent(note)}-v${velocity}.ogg`
    const request = fetch(file).then(async (response) => {
      if (!response.ok) throw new Error(`Could not load ${type} sample ${note}`)
      const bytes = await response.arrayBuffer()
      if (this.disposed) throw new Error('The audio graph was disposed while loading samples')
      const context = this.getContext()
      const decoded = await context.decodeAudioData(bytes)
      if (this.disposed || context !== this.context) throw new Error('The audio graph changed while decoding samples')
      this.sampleBuffers.set(key, decoded)
      return decoded
    }).finally(() => this.loadingSamples.delete(key))
    this.loadingSamples.set(key, request)
    return request
  }
}

export function defaultConfiguration(): AudioConfiguration {
  const unit = (type: string, overrides: Partial<EffectUnitState> = {}): EffectUnitState => ({
    type, on: false, rate: 0.34, amount: 0.42, mix: 0.56, time: 0.42, feedback: 0.32,
    filter: 'Off', drive: 0.2, bass: 0.5, mid: 0.5, midFrequency: 0.5, treble: 0.5,
    fast: false, brightness: 0.6, decay: 0.4, global: false, ...overrides,
  })
  return {
    pianoType: 'Grand',
    modelVariant: 0,
    sectionOn: true,
    masterLevel: 0.72,
    pitchBend: 0,
    layers: {
      A: { enabled: true, level: 0.72, octave: 0, sustainPedal: true, pitchStick: true },
      B: { enabled: false, level: 0.48, octave: 0, sustainPedal: true, pitchStick: true },
    },
    performance: { touch: 'Medium', dynComp: 0, timbre: 'Off', unison: 0, softRelease: false, stringRes: false },
    effects: {
      focus: 'A', manualSection: 'Piano', group: false, allBypass: false, rotaryOn: false, rotarySpeed: 'Slow', rotaryRate: 0.35, rotaryDrive: 0.16,
      units: {
        A: { mod1: unit('A-Pan', { rate: 0.38, amount: 0.44 }), mod2: unit('Chorus', { rate: 0.31, amount: 0.41 }), delay: unit('Delay', { time: 0.4, feedback: 0.38, mix: 0.35 }), ampEq: unit('EQ only', { drive: 0.22, bass: 0.48, treble: 0.51 }), compressor: unit('Compressor', { amount: 0.37 }), reverb: unit('Room', { mix: 0.45, decay: 0.58, brightness: 0.6 }) },
        B: { mod1: unit('A-Pan', { rate: 0.38, amount: 0.44 }), mod2: unit('Chorus', { rate: 0.31, amount: 0.41 }), delay: unit('Delay', { time: 0.4, feedback: 0.38, mix: 0.35 }), ampEq: unit('EQ only', { drive: 0.22, bass: 0.48, treble: 0.51 }), compressor: unit('Compressor', { amount: 0.37 }), reverb: unit('Room', { mix: 0.45, decay: 0.58, brightness: 0.6 }) },
      },
    },
  }
}

export const EFFECT_TYPE_OPTIONS: Record<EffectUnitId, string[]> = {
  mod1: MOD1_TYPES,
  mod2: MOD2_TYPES,
  delay: ['Delay'],
  ampEq: AMP_TYPES,
  compressor: ['Compressor'],
  reverb: REVERB_TYPES,
}
