export type PianoStatusState = 'loading' | 'ready' | 'fallback' | 'error'
export type LayerId = 'A' | 'B'
export type PianoType = 'Grand' | 'Upright' | 'Electric' | 'Clav' | 'Digital' | 'Misc'
export type KbTouch = 'Heavy' | 'Medium' | 'Light'
export type DynComp = 'Off' | '1' | '2' | '3'
export type Unison = 'Off' | '1' | '2' | '3'
export type Timbre = 'Off' | 'Soft' | 'Mid' | 'Bright' | 'Dyno 1' | 'Dyno 2'
export type EffectUnit = 'mod1' | 'mod2' | 'delay' | 'ampEq' | 'compressor' | 'reverb'

export interface PianoStatus {
  state: PianoStatusState
  message: string
}

export interface PianoLayerState {
  enabled: boolean
  focused: boolean
  level: number
  octave: number
  sustainPedal: boolean
  pitchStick: boolean
  type: PianoType
}

export interface PianoPerformanceState {
  kbTouch: KbTouch
  dynComp: DynComp
  timbre: Timbre
  unison: Unison
  softRelease: boolean
  stringRes: boolean
  masterLevel: number
}

export interface EffectState {
  on: boolean
  typeIndex: number
  rate: number
  amount: number
  mix: number
  feedback: number
  filter: 'Off' | 'LP' | 'HP' | 'BP'
  global: boolean
}

export interface AmpEqState extends EffectState {
  drive: number
  bass: number
  mid: number
  treble: number
}

export interface LayerEffectChain {
  mod1: EffectState
  mod2: EffectState
  delay: EffectState
  ampEq: AmpEqState
  compressor: EffectState
  reverb: EffectState
}

export interface EffectsState {
  focusedLayer: LayerId
  pianoGroup: boolean
  allBypass: boolean
  rotaryOn: boolean
  rotaryFast: boolean
  rotaryDrive: number
  chains: Record<LayerId, LayerEffectChain>
}

interface Voice {
  id: number
  midi: number
  owner: string
  layer: LayerId
  velocity: number
  startedAt: number
  released: boolean
  releaseTimer?: number
  oscillator?: OscillatorNode
  gain?: GainNode
  filter?: BiquadFilterNode
  delay?: DelayNode
  destination?: AudioNode
}

interface PianoEngineOptions {
  maxVoices?: number
  onStatus?: (status: PianoStatus) => void
  context?: AudioContext
}

export interface RenderOptions {
  midi?: number
  velocity?: number
  layer?: LayerId
  seconds?: number
  sampleRate?: number
  state?: Partial<PianoPerformanceState>
  effects?: Partial<EffectsState>
}

export interface PianoEngine {
  prepare: () => void
  noteOn: (midi: number, velocity: number, owner: string) => void
  noteOff: (midi: number, owner: string) => void
  setSustain: (enabled: boolean) => void
  allNotesOff: () => void
  dispose: () => void
  updateLayer: (layer: LayerId, patch: Partial<PianoLayerState>) => void
  updatePerformance: (patch: Partial<PianoPerformanceState>) => void
  updateEffects: (updater: (current: EffectsState) => EffectsState) => void
  renderProbe: (options?: RenderOptions) => Float32Array
  getSnapshot: () => {
    activeVoices: number
    sustain: boolean
    status: PianoStatus
    stolenVoices: number
    layers: Record<LayerId, PianoLayerState>
    performance: PianoPerformanceState
    effects: EffectsState
    graph: { contextCount: number; destinationCount: number; layerBuses: number; masterLimiter: boolean; order: string[] }
  }
}

export const pianoTypes: PianoType[] = ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc']
export const mod1Types = ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump']
export const mod2Types = ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin']
export const ampEqTypes = ['EQ only', 'Twin', 'JC', 'Small', 'LP24 Filter', 'HP24 Filter', 'To Rotary']
export const reverbTypes = ['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral']

export const sampleLibrary = [
  {
    type: 'Grand',
    model: 'Generated Studio Grand',
    source: 'offline generated multi-root approximation, not a recording',
    roots: ['E2', 'A2', 'D3', 'G3', 'C4', 'F4', 'B4', 'E5', 'A5'],
    velocities: ['soft', 'medium', 'hard'],
    license: 'Candidate-authored generated buffers',
  },
  {
    type: 'Upright',
    model: 'Generated Felt Upright',
    source: 'offline generated multi-root approximation, not a recording',
    roots: ['E2', 'A2', 'D3', 'G3', 'C4', 'F4', 'B4', 'E5', 'A5'],
    velocities: ['soft', 'medium', 'hard'],
    license: 'Candidate-authored generated buffers',
  },
  {
    type: 'Electric',
    model: 'Generated Tine Electric',
    source: 'offline generated multi-root approximation, not a recording',
    roots: ['E2', 'G2', 'C3', 'E3', 'A3', 'C4', 'E4', 'A4', 'C5', 'E5'],
    velocities: ['soft', 'medium', 'hard'],
    license: 'Candidate-authored generated buffers',
  },
] as const

const AudioContextCtor = () => window.AudioContext ?? window.webkitAudioContext

const initialLayerState = (): Record<LayerId, PianoLayerState> => ({
  A: { enabled: true, focused: true, level: 0.82, octave: 0, sustainPedal: true, pitchStick: true, type: 'Grand' },
  B: { enabled: false, focused: false, level: 0.24, octave: 0, sustainPedal: true, pitchStick: true, type: 'Upright' },
})

const effect = (mix = 0.25): EffectState => ({
  on: false,
  typeIndex: 0,
  rate: 0.45,
  amount: 0.35,
  mix,
  feedback: 0.25,
  filter: 'Off',
  global: false,
})

const effectChain = (): LayerEffectChain => ({
  mod1: effect(),
  mod2: effect(),
  delay: { ...effect(0.2), feedback: 0.32 },
  ampEq: { ...effect(), on: false, drive: 0.25, bass: 0.5, mid: 0.5, treble: 0.58 },
  compressor: effect(),
  reverb: effect(0.28),
})

const initialEffects = (): EffectsState => ({
  focusedLayer: 'A',
  pianoGroup: false,
  allBypass: false,
  rotaryOn: false,
  rotaryFast: false,
  rotaryDrive: 0.32,
  chains: { A: effectChain(), B: effectChain() },
})

const initialPerformance = (): PianoPerformanceState => ({
  kbTouch: 'Medium',
  dynComp: 'Off',
  timbre: 'Off',
  unison: 'Off',
  softRelease: false,
  stringRes: false,
  masterLevel: 0.72,
})

function midiToFrequency(midi: number) {
  return 440 * 2 ** ((midi - 69) / 12)
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

function now(context?: AudioContext) {
  return context?.currentTime ?? performance.now() / 1000
}

function cloneEffects(effects: EffectsState): EffectsState {
  return {
    ...effects,
    chains: {
      A: { ...effects.chains.A, ampEq: { ...effects.chains.A.ampEq } },
      B: { ...effects.chains.B, ampEq: { ...effects.chains.B.ampEq } },
    },
  }
}

function typeHarmonics(type: PianoType) {
  switch (type) {
    case 'Grand':
      return [1, 0.42, 0.18, 0.09, 0.045]
    case 'Upright':
      return [1, 0.28, 0.26, 0.13, 0.04]
    case 'Electric':
      return [1, 0.12, 0.46, 0.08, 0.21]
    case 'Clav':
      return [1, 0.75, 0.38, 0.24, 0.1]
    case 'Digital':
      return [1, 0.2, 0.32, 0.18, 0.22]
    case 'Misc':
      return [0.9, 0.08, 0.04, 0.35, 0.16]
  }
}

function velocityForTouch(velocity: number, touch: KbTouch) {
  if (touch === 'Heavy') return velocity ** 1.7
  if (touch === 'Light') return velocity ** 0.62
  return velocity ** 1.05
}

function applyDynComp(value: number, dyn: DynComp) {
  const amount = dyn === 'Off' ? 0 : Number(dyn) * 0.14
  return value * (1 - amount) + Math.sqrt(Math.max(value, 0)) * amount
}

function timbreFactor(timbre: Timbre, harmonicIndex: number, type: PianoType) {
  if (timbre === 'Soft') return harmonicIndex === 0 ? 1 : 0.48
  if (timbre === 'Mid') return harmonicIndex === 1 || harmonicIndex === 2 ? 1.45 : 0.85
  if (timbre === 'Bright') return 1 + harmonicIndex * 0.26
  if (timbre === 'Dyno 1' && type === 'Electric') return harmonicIndex === 2 || harmonicIndex === 4 ? 1.75 : 0.82
  if (timbre === 'Dyno 2' && type === 'Electric') return harmonicIndex > 1 ? 1.95 : 0.72
  return 1
}

function renderBase(layer: PianoLayerState, performanceState: PianoPerformanceState, options: Required<Pick<RenderOptions, 'midi' | 'velocity' | 'seconds' | 'sampleRate'>>) {
  const length = Math.floor(options.seconds * options.sampleRate)
  const output = new Float32Array(length)
  if (!layer.enabled) return output
  const frequency = midiToFrequency(options.midi + layer.octave)
  const velocity = applyDynComp(velocityForTouch(options.velocity, performanceState.kbTouch), performanceState.dynComp)
  const harmonics = typeHarmonics(layer.type)
  const release = performanceState.softRelease && layer.type !== 'Clav' ? 0.84 : 0.54
  const unisonCount = performanceState.unison === 'Off' ? 1 : Number(performanceState.unison) + 1
  const detuneSpread = performanceState.unison === 'Off' ? 0 : Number(performanceState.unison) * 0.0019
  for (let i = 0; i < length; i += 1) {
    const t = i / options.sampleRate
    const attack = Math.min(1, t / 0.012)
    const decay = Math.exp(-t * (layer.type === 'Electric' ? 1.5 : 1.95))
    const tail = Math.exp(-Math.max(0, t - options.seconds * 0.48) / release)
    let sample = 0
    for (let u = 0; u < unisonCount; u += 1) {
      const detune = 1 + (u - (unisonCount - 1) / 2) * detuneSpread
      for (let h = 0; h < harmonics.length; h += 1) {
        const amp = harmonics[h] * timbreFactor(performanceState.timbre, h, layer.type)
        sample += Math.sin(Math.PI * 2 * frequency * (h + 1) * detune * t) * amp
      }
    }
    const resonance = performanceState.stringRes ? Math.sin(Math.PI * 2 * frequency * 1.5 * t) * 0.06 * Math.exp(-t * 0.5) : 0
    output[i] = ((sample / (harmonics.length * unisonCount)) * attack * decay * tail + resonance) * velocity * layer.level
  }
  return output
}

function applyMod1(input: Float32Array, state: EffectState, sampleRate: number) {
  const out = new Float32Array(input.length)
  const type = mod1Types[state.typeIndex % mod1Types.length]
  for (let i = 0; i < input.length; i += 1) {
    const t = i / sampleRate
    const lfo = Math.sin(Math.PI * 2 * (0.4 + state.rate * 8) * t)
    let wet = input[i]
    if (type === 'A-Pan') wet *= 0.72 + 0.28 * lfo
    else if (type === 'Tremolo') wet *= 1 - state.amount * 0.72 * (0.5 + lfo * 0.5)
    else if (type === 'Ring Mod') wet *= Math.sin(Math.PI * 2 * (24 + state.rate * 220) * t)
    else if (type === 'A-Wah') wet *= 0.72 + Math.abs(input[i]) * (0.8 + state.amount)
    else if (type === 'Wah') wet *= 0.75 + 0.25 * Math.sin(Math.PI * 2 * (1.2 + state.rate * 5) * t + input[i] * 8)
    else wet *= 1 - state.amount * Math.max(0, Math.sin(Math.PI * 2 * (0.8 + state.rate * 3) * t))
    out[i] = input[i] * (1 - state.amount) + wet * state.amount
  }
  return out
}

function applyMod2(input: Float32Array, state: EffectState, sampleRate: number) {
  const out = new Float32Array(input.length)
  const type = mod2Types[state.typeIndex % mod2Types.length]
  const baseDelay = type === 'Flanger' ? 2 : type === 'Ensemble' ? 17 : 9
  for (let i = 0; i < input.length; i += 1) {
    const t = i / sampleRate
    const sweep = Math.round((baseDelay + Math.sin(Math.PI * 2 * (0.15 + state.rate * 2.4) * t) * baseDelay * 0.7) * (sampleRate / 1000))
    const delayed = input[Math.max(0, i - sweep)] ?? 0
    let wet = delayed
    if (type === 'Phaser') wet = input[i] - delayed * 0.65
    if (type === 'Vibe') wet = delayed * Math.sin(Math.PI * 2 * 5.5 * t)
    if (type === 'Spin') wet = input[i] * (0.65 + 0.35 * Math.sin(Math.PI * 2 * (state.rate * 5 + 0.6) * t)) + delayed * 0.4
    out[i] = input[i] * (1 - state.amount * 0.72) + wet * state.amount * 0.72
  }
  return out
}

function applyDelay(input: Float32Array, state: EffectState, sampleRate: number) {
  const out = new Float32Array(input)
  const delaySamples = Math.max(20, Math.round((0.08 + state.rate * 0.52) * sampleRate))
  let lp = 0
  for (let i = delaySamples; i < input.length; i += 1) {
    let repeat = out[i - delaySamples] * state.feedback
    if (state.filter === 'LP') {
      lp += (repeat - lp) * 0.18
      repeat = lp
    } else if (state.filter === 'HP') {
      lp += (repeat - lp) * 0.08
      repeat -= lp
    } else if (state.filter === 'BP') {
      lp += (repeat - lp) * 0.15
      repeat = repeat - (repeat - lp) * 0.45
    }
    out[i] += repeat * state.mix
  }
  return out.map((sample, index) => input[index] * (1 - state.mix) + sample * state.mix)
}

function applyAmpEq(input: Float32Array, state: AmpEqState) {
  const out = new Float32Array(input.length)
  const type = ampEqTypes[state.typeIndex % ampEqTypes.length]
  let previous = 0
  for (let i = 0; i < input.length; i += 1) {
    const driven = Math.tanh(input[i] * (1 + state.drive * (type === 'EQ only' ? 0.8 : 4.8)))
    previous += (driven - previous) * (type === 'LP24 Filter' ? 0.08 + state.mid * 0.24 : 0.42)
    let sample = type === 'LP24 Filter' ? previous : driven
    if (type === 'HP24 Filter') sample = driven - previous * (0.8 + state.mid * 0.7)
    if (type === 'Twin') sample = sample * (0.9 + state.treble * 0.42) + Math.tanh(sample * 3) * 0.09
    if (type === 'JC') sample = sample * (0.8 + state.mid * 0.28) - previous * 0.12
    if (type === 'Small') sample = Math.tanh(sample * 2.8) * (0.7 + state.bass * 0.3)
    out[i] = sample * (0.75 + state.bass * 0.16 + state.treble * 0.18)
  }
  return out
}

function applyCompressor(input: Float32Array, state: EffectState) {
  const threshold = 0.16 - state.amount * 0.09
  const ratio = 1 + state.amount * 7
  return input.map((sample) => {
    const sign = Math.sign(sample)
    const abs = Math.abs(sample)
    if (abs <= threshold) return sample * (1 + state.amount * 0.22)
    return sign * (threshold + (abs - threshold) / ratio)
  })
}

function applyReverb(input: Float32Array, state: EffectState, sampleRate: number) {
  const out = new Float32Array(input)
  const type = reverbTypes[state.typeIndex % reverbTypes.length]
  const decay = [0.12, 0.07, 0.28, 0.36, 0.58, 0.9][state.typeIndex % reverbTypes.length]
  const taps = type === 'Spring' ? [0.023, 0.047, 0.091, 0.119] : [0.031, 0.073, 0.149, 0.211, 0.319]
  for (const tap of taps) {
    const offset = Math.round(tap * sampleRate)
    for (let i = offset; i < out.length; i += 1) {
      out[i] += input[i - offset] * state.mix * decay * Math.exp(-tap * 2.4)
    }
  }
  return out.map((sample, index) => input[index] * (1 - state.mix) + sample * state.mix)
}

function applyRotary(input: Float32Array, effects: EffectsState, sampleRate: number) {
  const out = new Float32Array(input.length)
  const rate = effects.rotaryFast ? 6.4 : 1.1
  for (let i = 0; i < input.length; i += 1) {
    const t = i / sampleRate
    const amp = 0.72 + 0.28 * Math.sin(Math.PI * 2 * rate * t)
    out[i] = Math.tanh(input[i] * (1 + effects.rotaryDrive * 3.2)) * amp
  }
  return out
}

function applyLimiter(input: Float32Array) {
  return input.map((sample) => Math.tanh(sample * 1.25) * 0.82)
}

function processEffects(input: Float32Array, chain: LayerEffectChain, effects: EffectsState, sampleRate: number) {
  let output = input
  if (!effects.allBypass && chain.mod1.on) output = applyMod1(output, chain.mod1, sampleRate)
  if (!effects.allBypass && chain.mod2.on) output = applyMod2(output, chain.mod2, sampleRate)
  if (!effects.allBypass && chain.delay.on) output = applyDelay(output, chain.delay, sampleRate)
  if (!effects.allBypass && chain.ampEq.on) output = applyAmpEq(output, chain.ampEq)
  if (!effects.allBypass && chain.compressor.on) output = applyCompressor(output, chain.compressor)
  if (!effects.allBypass && chain.reverb.on) output = applyReverb(output, chain.reverb, sampleRate)
  if (!effects.allBypass && effects.rotaryOn && ampEqTypes[chain.ampEq.typeIndex % ampEqTypes.length] === 'To Rotary') {
    output = applyRotary(output, effects, sampleRate)
  }
  return output
}

export function createPianoEngine(options: PianoEngineOptions = {}): PianoEngine {
  const maxVoices = options.maxVoices ?? 24
  let status: PianoStatus = { state: 'loading', message: 'Preparing Stage 4 piano library' }
  let context = options.context
  let masterGain: GainNode | undefined
  let limiter: DynamicsCompressorNode | undefined
  const layerBuses: Partial<Record<LayerId, GainNode>> = {}
  let sustain = false
  let nextVoiceId = 1
  let stolenVoices = 0
  const voices = new Map<number, Voice>()
  const sustained = new Set<number>()
  const layers = initialLayerState()
  let performanceState = initialPerformance()
  let effects = initialEffects()

  const setStatus = (next: PianoStatus) => {
    status = next
    options.onStatus?.(next)
  }

  const ensureContext = () => {
    if (!context) {
      const Constructor = AudioContextCtor()
      if (!Constructor) {
        setStatus({ state: 'fallback', message: 'Playable fallback: generated piano approximations, no browser AudioContext' })
        return null
      }
      try {
        context = new Constructor()
      } catch {
        setStatus({ state: 'fallback', message: 'Playable fallback: generated piano approximations, AudioContext failed' })
        return null
      }
    }
    if (!masterGain) {
      masterGain = context.createGain()
      masterGain.gain.value = performanceState.masterLevel
      limiter = context.createDynamicsCompressor?.()
      if (limiter) {
        limiter.threshold.value = -8
        limiter.knee.value = 8
        limiter.ratio.value = 12
        limiter.attack.value = 0.004
        limiter.release.value = 0.11
        masterGain.connect(limiter)
        limiter.connect(context.destination)
      } else {
        masterGain.connect(context.destination)
      }
      for (const layerId of ['A', 'B'] as LayerId[]) {
        const bus = context.createGain()
        bus.gain.value = layers[layerId].level
        bus.connect(masterGain)
        layerBuses[layerId] = bus
      }
    }
    setStatus({ state: 'ready', message: 'Stage 4 piano library ready - generated offline approximations declared' })
    return context
  }

  const finishVoice = (voice: Voice, releaseSeconds = 0.18) => {
    const ctx = context
    voice.released = true
    if (voice.releaseTimer) window.clearTimeout(voice.releaseTimer)
    if (ctx && voice.gain) {
      const at = now(ctx)
      voice.gain.gain.cancelScheduledValues(at)
      voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), at)
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, at + releaseSeconds)
      voice.oscillator?.stop(at + releaseSeconds + 0.02)
    }
    voice.releaseTimer = window.setTimeout(() => {
      voice.oscillator?.disconnect()
      voice.gain?.disconnect()
      voice.filter?.disconnect()
      voice.delay?.disconnect()
      voices.delete(voice.id)
      sustained.delete(voice.id)
    }, (releaseSeconds + 0.06) * 1000)
  }

  const stealIfNeeded = () => {
    if (voices.size < maxVoices) return
    const voice = [...voices.values()].sort((left, right) => {
      if (left.released !== right.released) return left.released ? -1 : 1
      return left.startedAt - right.startedAt
    })[0]
    if (voice) {
      stolenVoices += 1
      finishVoice(voice, 0.05)
    }
  }

  const activeLayerIds = () => (['A', 'B'] as LayerId[]).filter((layerId) => layers[layerId].enabled)

  const noteOnLayer = (layerId: LayerId, midi: number, velocity: number, owner: string) => {
    const ctx = ensureContext()
    if (!ctx) return
    const layer = layers[layerId]
    if (!layer.enabled) return
    stealIfNeeded()
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    const filter = ctx.createBiquadFilter()
    const destination = layerBuses[layerId] ?? masterGain ?? ctx.destination
    const frequency = midiToFrequency(midi + layer.octave)
    const adjustedVelocity = applyDynComp(velocityForTouch(clamp(velocity, 0.01, 1), performanceState.kbTouch), performanceState.dynComp)
    const at = now(ctx)
    const level = (0.035 + adjustedVelocity ** 1.35 * 0.2) * layer.level
    oscillator.type = layer.type === 'Electric' ? 'sine' : layer.type === 'Clav' ? 'sawtooth' : layer.type === 'Misc' ? 'square' : 'triangle'
    oscillator.frequency.setValueAtTime(frequency, at)
    oscillator.detune.setValueAtTime((velocity - 0.5) * (performanceState.unison === 'Off' ? 3 : 9), at)
    filter.type = performanceState.timbre === 'Soft' ? 'lowpass' : performanceState.timbre === 'Bright' ? 'highshelf' : 'peaking'
    filter.frequency.setValueAtTime(performanceState.timbre === 'Soft' ? 1900 : 3600, at)
    filter.Q.setValueAtTime(performanceState.timbre === 'Mid' ? 2.8 : 0.8, at)
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(Math.max(level, 0.0001), at + 0.012)
    gain.gain.exponentialRampToValueAtTime(Math.max(level * 0.58, 0.0001), at + 0.42)
    oscillator.connect(filter)
    filter.connect(gain)
    gain.connect(destination)
    oscillator.start(at)
    voices.set(nextVoiceId, { id: nextVoiceId, midi, owner, layer: layerId, velocity, startedAt: at, released: false, oscillator, gain, filter, destination })
    nextVoiceId += 1
  }

  return {
    prepare() {
      ensureContext()
    },
    noteOn(midi, velocity, owner) {
      void ensureContext()?.resume?.()
      for (const layerId of activeLayerIds()) noteOnLayer(layerId, midi, velocity, owner)
    },
    noteOff(midi, owner) {
      for (const voice of voices.values()) {
        if (voice.midi === midi && voice.owner === owner && !voice.released) {
          if (sustain && layers[voice.layer].sustainPedal) {
            sustained.add(voice.id)
          } else {
            const release = performanceState.softRelease && layers[voice.layer].type !== 'Clav' ? 0.52 : 0.24
            finishVoice(voice, release + voice.velocity * 0.12)
          }
        }
      }
    },
    setSustain(enabled) {
      sustain = enabled
      if (!enabled) {
        for (const voiceId of sustained) {
          const voice = voices.get(voiceId)
          if (voice) finishVoice(voice, 0.28)
        }
        sustained.clear()
      }
    },
    allNotesOff() {
      sustain = false
      sustained.clear()
      for (const voice of voices.values()) finishVoice(voice, 0.03)
    },
    dispose() {
      this.allNotesOff()
      for (const bus of Object.values(layerBuses)) bus?.disconnect()
      masterGain?.disconnect()
      limiter?.disconnect()
      if (options.context === undefined) {
        void context?.close?.()
      }
    },
    updateLayer(layerId, patch) {
      Object.assign(layers[layerId], patch)
      layers.A.focused = layerId === 'A' ? (patch.focused ?? layers.A.focused) : layers.A.focused
      layers.B.focused = layerId === 'B' ? (patch.focused ?? layers.B.focused) : layers.B.focused
      if (patch.focused) {
        layers.A.focused = layerId === 'A'
        layers.B.focused = layerId === 'B'
        effects.focusedLayer = layerId
      }
      layerBuses[layerId]?.gain.setTargetAtTime?.(layers[layerId].level, now(context), 0.01)
    },
    updatePerformance(patch) {
      performanceState = { ...performanceState, ...patch }
      if (masterGain && patch.masterLevel !== undefined) {
        masterGain.gain.setTargetAtTime(clamp(patch.masterLevel), now(context), 0.01)
      }
    },
    updateEffects(updater) {
      effects = updater(cloneEffects(effects))
    },
    renderProbe(renderOptions: RenderOptions = {}) {
      const sampleRate = renderOptions.sampleRate ?? 22050
      const seconds = renderOptions.seconds ?? 0.65
      const midi = renderOptions.midi ?? 60
      const velocity = renderOptions.velocity ?? 0.8
      const layerId = renderOptions.layer ?? effects.focusedLayer
      const layer = layers[layerId]
      const perf = { ...performanceState, ...renderOptions.state }
      const fx = renderOptions.effects ? { ...effects, ...renderOptions.effects } : effects
      const base = renderBase(layer, perf, { midi, velocity, seconds, sampleRate })
      const chain = fx.pianoGroup ? fx.chains.A : fx.chains[layerId]
      const processed = processEffects(base, chain, fx, sampleRate)
      return applyLimiter(processed.map((sample) => sample * perf.masterLevel))
    },
    getSnapshot() {
      return {
        activeVoices: voices.size,
        sustain,
        status,
        stolenVoices,
        layers: { A: { ...layers.A }, B: { ...layers.B } },
        performance: { ...performanceState },
        effects: cloneEffects(effects),
        graph: {
          contextCount: context ? 1 : 0,
          destinationCount: context ? 1 : 0,
          layerBuses: Object.keys(layerBuses).length,
          masterLimiter: Boolean(limiter) || Boolean(masterGain),
          order: ['Layer source', 'Mod 1', 'Mod 2', 'Delay', 'Amp Sim/EQ or Filter', 'Compressor', 'Reverb', 'Rotary when routed', 'Layer level', 'Master gain/limiter', 'Destination'],
        },
      }
    },
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
  }
}
