import type {
  AudioBufferLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
} from './boundaries'
import { noiseBuffer, type Stoppable } from './organ'
import { synthMappings, SYNTH_WAVEFORMS, type ArpDirection, type SynthLayerState } from '../state/program-types'
import { mappings } from '../state/instrument'

/**
 * Synth voices — ALL SYNTHESIZED with real Web Audio nodes (declared in
 * IMPLEMENTATION_DETAILS.json; no recordings):
 *
 * - Pure: one oscillator (native sine/triangle/saw/square; Pulse 33/Pulse 10
 *   as Fourier-built PeriodicWaves; White Noise as a looped deterministic
 *   noise buffer). Osc Ctrl is inactive for Pure waveforms, as on the
 *   hardware.
 * - Sync: oscillator through a high-Q formant bandpass swept by Osc Ctrl
 *   (the classic oscillator-sync approximation — the formant tracks
 *   syncRatio × note frequency and is env/LFO-modulatable).
 * - Multi: four detuned saws (8ve variant: two + two an octave up);
 *   Osc Ctrl spreads the detune.
 * - Super: seven center-weighted detuned saws/squares; Osc Ctrl spreads.
 * - FM-H: two-operator FM (sine modulator at 1:1 into a sine carrier's
 *   frequency); Osc Ctrl is the modulation index.
 *
 * One mod envelope (attack/decay/release) drives Osc Ctrl or pitch, and the
 * filter cutoff via Filter Env Amt. The amp envelope runs on a per-voice
 * gain. The per-layer LFO (five waveforms, clock-syncable) connects to
 * Osc Pitch, Osc Ctrl or Filter Freq through per-voice depth gains.
 */

function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

const MIN_ENV = 0.002

/* -------------------------------------------------------- periodic waves -- */

const waveCache = new WeakMap<AudioContextLike, Map<string, unknown>>()

/** Fourier-series pulse wave with the given duty cycle (computed, not sampled). */
function pulseWave(context: AudioContextLike, duty: number): unknown | null {
  if (typeof context.createPeriodicWave !== 'function') return null
  let cache = waveCache.get(context)
  if (!cache) {
    cache = new Map()
    waveCache.set(context, cache)
  }
  const key = `pulse:${duty}`
  const cached = cache.get(key)
  if (cached) return cached
  const HARMONICS = 48
  const real = new Float32Array(HARMONICS + 1)
  const imag = new Float32Array(HARMONICS + 1)
  for (let n = 1; n <= HARMONICS; n++) {
    // Pulse wave Fourier coefficients: bn = (2/(nπ)) sin(nπ·duty).
    imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty)
  }
  const wave = context.createPeriodicWave(real, imag)
  cache.set(key, wave)
  return wave
}

/* -------------------------------------------------------------- layer LFO -- */

export interface SynthLfoUnit {
  /** Bipolar -1..1 modulation signal. */
  readonly output: GainNodeLike
  update(lfo: SynthLayerState['lfo'], bpm: number, now: number): void
  dispose(): void
}

/** Per-layer LFO with five waveforms; S&H is a looped deterministic step buffer. */
export function createSynthLfo(context: AudioContextLike): SynthLfoUnit {
  const output = context.createGain()
  output.gain.value = 1
  let source: { kind: 'osc'; node: OscillatorNodeLike; invert: GainNodeLike | null } | { kind: 'sh'; node: ReturnType<AudioContextLike['createBufferSource']> } | null = null
  let currentWave: SynthLayerState['lfo']['wave'] | null = null

  function teardown(): void {
    if (!source) return
    try {
      source.node.stop(0)
    } catch {
      /* not started */
    }
    try {
      source.node.disconnect()
    } catch {
      /* detached */
    }
    if (source.kind === 'osc' && source.invert) {
      try {
        source.invert.disconnect()
      } catch {
        /* detached */
      }
    }
    source = null
  }

  function build(wave: SynthLayerState['lfo']['wave']): void {
    teardown()
    currentWave = wave
    if (wave === 'S&H') {
      const node = context.createBufferSource()
      node.buffer = sampleHoldBuffer(context)
      node.loop = true
      node.connect(output)
      node.start(0)
      source = { kind: 'sh', node }
      return
    }
    const osc = context.createOscillator()
    osc.type = wave === 'Triangle' ? 'triangle' : wave === 'Square' ? 'square' : 'sawtooth'
    osc.frequency.value = 1
    let invert: GainNodeLike | null = null
    if (wave === 'Saw Down') {
      invert = context.createGain()
      invert.gain.value = -1
      osc.connect(invert)
      invert.connect(output)
    } else {
      osc.connect(output)
    }
    osc.start(0)
    source = { kind: 'osc', node: osc, invert }
  }

  return {
    output,
    update(lfo, bpm, now) {
      if (currentWave !== lfo.wave) build(lfo.wave)
      const hz = lfo.clockSync ? 1 / clockIntervalSecondsSafe(bpm, lfo.rate) : mappings.lfoRateHz(lfo.rate)
      if (source?.kind === 'osc') {
        source.node.frequency.cancelScheduledValues(now)
        source.node.frequency.setTargetAtTime(hz, now, 0.02)
      } else if (source?.kind === 'sh') {
        // Buffer holds 8 steps/second at rate 1 -> playbackRate = hz / 8.
        source.node.playbackRate.cancelScheduledValues(now)
        source.node.playbackRate.setTargetAtTime(hz / 8, now, 0.02)
      }
    },
    dispose() {
      teardown()
      try {
        output.disconnect()
      } catch {
        /* detached */
      }
    },
  }
}

const shCache = new WeakMap<AudioContextLike, AudioBufferLike>()

/** 64 deterministic random steps, 8 steps/second at playbackRate 1. */
function sampleHoldBuffer(context: AudioContextLike): AudioBufferLike {
  const cached = shCache.get(context)
  if (cached) return cached
  const rate = context.sampleRate
  const stepSeconds = 1 / 8
  const steps = 64
  // Size the buffer to exactly steps × stepLength so every sample is written
  // (node-web-audio-api channel data is not guaranteed zero-initialized).
  const stepLength = Math.floor(rate * stepSeconds)
  const buffer = context.createBuffer(1, steps * stepLength, rate)
  const data = buffer.getChannelData(0)
  let seed = 0x1f123bb5
  for (let s = 0; s < steps; s++) {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    seed >>>= 0
    const value = (seed / 0xffffffff) * 2 - 1
    for (let i = 0; i < stepLength; i++) data[s * stepLength + i] = value
  }
  shCache.set(context, buffer)
  return buffer
}

function clockIntervalSecondsSafe(bpm: number, value: number): number {
  const beats = [2, 4 / 3, 1, 2 / 3, 0.5, 1 / 3, 0.25][Math.min(6, Math.floor((value / 128) * 7))]!
  return Math.max(0.02, (60 / bpm) * beats)
}

/* ------------------------------------------------------------ synth voice -- */

interface OscEntry {
  osc: OscillatorNodeLike
  ratio: number
  baseDetune: number
}

interface CtrlTarget {
  param: AudioParamLike
  base: number
  /** Param change for a full-scale (+1) ctrl-envelope excursion. */
  scale: number
  /** For detune-spread targets (Multi/Super): the per-osc spread factor -1..1. */
  spreadSign?: number
}

export interface SynthVoiceHandle {
  /** Schedules envelope releases; returns seconds until silence. */
  noteOff(now: number): number
  applyBend(semitones: number, now: number): void
  /** Mono/legato pitch move without retriggering envelopes. */
  glideTo(midi: number, now: number, glideSeconds: number): void
  /** Live (morphable) parameter changes: filter freq/res, osc ctrl, LFO amount, vibrato wheel. */
  updateControls(layer: SynthLayerState, wheelValue: number, now: number): void
  readonly midi: number
}

export interface SynthVoiceOptions {
  context: AudioContextLike
  layer: SynthLayerState
  /** Already octave/transpose-shifted MIDI note. */
  midi: number
  velocity: number // 0..1
  pitchBend: number
  /** Voice start time (may be in the future for scheduled arpeggiator steps). */
  now: number
  destination: AudioNodeLike
  /** The layer's LFO output (bipolar). */
  lfoOutput: AudioNodeLike
  /** The layer's vibrato oscillator output (bipolar sine at the vibrato rate). */
  vibratoOutput: AudioNodeLike
  /** Wheel position 0..1 (drives vibrato in Wheel mode). */
  wheelValue: number
  ownedNodes: AudioNodeLike[]
  stoppables: Stoppable[]
  /** Fixed note length for scheduled arp steps: noteOff is pre-scheduled at now+holdSeconds. */
  holdSeconds?: number
}

const VOICE_TRIM = 0.16

export function buildSynthVoice(options: SynthVoiceOptions): SynthVoiceHandle {
  const { context, layer, midi, velocity, pitchBend, now, destination, ownedNodes, stoppables } = options
  const waveName = SYNTH_WAVEFORMS[layer.category][layer.wave] ?? SYNTH_WAVEFORMS[layer.category][0]!
  const isNoise = waveName === 'White Noise'
  const frequency = midiToFrequency(midi)

  const oscBus = context.createGain()
  oscBus.gain.value = VOICE_TRIM
  ownedNodes.push(oscBus)

  const oscEntries: OscEntry[] = []
  const ctrlTargets: CtrlTarget[] = []
  let formant: BiquadFilterNodeLike | null = null

  const addOsc = (type: string, ratio: number, detuneCents: number, level: number, into: AudioNodeLike): OscEntry => {
    const osc = context.createOscillator()
    osc.type = type
    osc.frequency.value = frequency * ratio
    osc.detune.value = detuneCents + pitchBend * 100
    const gain = context.createGain()
    gain.gain.value = level
    osc.connect(gain)
    gain.connect(into)
    osc.start(now)
    ownedNodes.push(gain)
    stoppables.push(osc)
    const entry = { osc, ratio, baseDetune: detuneCents }
    oscEntries.push(entry)
    return entry
  }

  /* Sources per category. */
  if (isNoise) {
    const source = context.createBufferSource()
    source.buffer = noiseBuffer(context)
    source.loop = true
    const gain = context.createGain()
    gain.gain.value = 0.8
    source.connect(gain)
    gain.connect(oscBus)
    source.start(now)
    ownedNodes.push(gain)
    stoppables.push(source)
  } else if (layer.category === 'Pure') {
    if (waveName === 'Pulse 33' || waveName === 'Pulse 10') {
      const osc = context.createOscillator()
      const wave = pulseWave(context, waveName === 'Pulse 33' ? 0.33 : 0.1)
      if (wave && typeof osc.setPeriodicWave === 'function') osc.setPeriodicWave(wave as never)
      else osc.type = 'square' // boundary without PeriodicWave: square stand-in, still a pulse family
      osc.frequency.value = frequency
      osc.detune.value = pitchBend * 100
      osc.connect(oscBus)
      osc.start(now)
      stoppables.push(osc)
      oscEntries.push({ osc, ratio: 1, baseDetune: 0 })
    } else {
      const type = waveName === 'Sine' ? 'sine' : waveName === 'Triangle' ? 'triangle' : waveName === 'Square' ? 'square' : 'sawtooth'
      addOsc(type, 1, 0, 1, oscBus)
    }
  } else if (layer.category === 'Sync') {
    // Sync approximation: source osc through a high-Q formant bandpass whose
    // center tracks syncRatio × note frequency (env/LFO-sweepable).
    const type = waveName === 'Sync Square' ? 'square' : 'sawtooth'
    const direct = context.createGain()
    direct.gain.value = 0.25
    formant = context.createBiquadFilter()
    formant.type = 'bandpass'
    formant.frequency.value = frequency * synthMappings.syncRatio(layer.oscCtrl)
    formant.Q.value = 6
    const formantGain = context.createGain()
    formantGain.gain.value = 1.4
    const entryOsc = addOsc(type, 1, 0, 1, direct)
    entryOsc.osc.connect(formant)
    formant.connect(formantGain)
    formantGain.connect(oscBus)
    direct.connect(oscBus)
    ownedNodes.push(direct, formant, formantGain)
    // Osc Ctrl target: formant detune in cents (base 0), full scale = +2 octaves.
    ctrlTargets.push({ param: formant.detune, base: 0, scale: 2400 })
  } else if (layer.category === 'Multi') {
    const octaveVariant = waveName === 'Multi Saw 8ve'
    const spread = multiSpreadCents(layer.oscCtrl, layer.voice.unison)
    const plan = octaveVariant
      ? [
          { ratio: 1, sign: -1 },
          { ratio: 1, sign: 1 },
          { ratio: 2, sign: -0.6 },
          { ratio: 2, sign: 0.6 },
        ]
      : [
          { ratio: 1, sign: -1 },
          { ratio: 1, sign: -0.33 },
          { ratio: 1, sign: 0.33 },
          { ratio: 1, sign: 1 },
        ]
    for (const p of plan) {
      const entry = addOsc('sawtooth', p.ratio, p.sign * spread, 0.45, oscBus)
      ctrlTargets.push({ param: entry.osc.detune, base: entry.baseDetune, scale: p.sign * 30, spreadSign: p.sign })
    }
  } else if (layer.category === 'Super') {
    const type = waveName === 'Super Square' ? 'square' : 'sawtooth'
    const spread = superSpreadCents(layer.oscCtrl, layer.voice.unison)
    for (let i = 0; i < 7; i++) {
      const sign = (i - 3) / 3 // -1..1, center osc undetuned
      const level = i === 3 ? 0.5 : 0.3
      const entry = addOsc(type, 1, sign * spread, level, oscBus)
      if (sign !== 0) ctrlTargets.push({ param: entry.osc.detune, base: entry.baseDetune, scale: sign * 40, spreadSign: sign })
    }
  } else {
    // FM-H: 2-op FM, sine modulator at 1:1 into the carrier's frequency.
    const carrier = addOsc('sine', 1, 0, 1, oscBus)
    const mod = context.createOscillator()
    mod.type = 'sine'
    mod.frequency.value = frequency
    mod.detune.value = pitchBend * 100
    const modGain = context.createGain()
    const indexBase = fmIndexHz(layer.oscCtrl, frequency)
    modGain.gain.value = indexBase
    mod.connect(modGain)
    modGain.connect(carrier.osc.frequency)
    mod.start(now)
    ownedNodes.push(modGain)
    stoppables.push(mod)
    oscEntries.push({ osc: mod, ratio: 1, baseDetune: 0 })
    ctrlTargets.push({ param: modGain.gain, base: indexBase, scale: frequency * 5 })
  }

  // Unison for single-oscillator categories: two extra detuned copies.
  if (layer.voice.unison > 0 && (layer.category === 'Pure' || layer.category === 'Sync') && !isNoise && oscEntries.length > 0) {
    const main = oscEntries[0]!
    const cents = 4 + layer.voice.unison * 5
    for (const side of [-1, 1]) {
      addOsc(main.osc.type === 'custom' ? 'square' : main.osc.type, 1, side * cents, 0.45, oscBus)
    }
  }

  /* Filter chain. */
  const trackAmount = [0, 1 / 3, 2 / 3, 1][layer.filter.tracking]!
  const baseCutoff = () => {
    const cutoff = mappings.filterFreqHz(layer.filter.freq) * Math.pow(frequency / 261.63, trackAmount)
    return Math.min(context.sampleRate * 0.45, Math.max(20, cutoff))
  }
  /**
   * Detune headroom in cents before base·2^(detune/1200) crosses ~0.45·rate.
   * Browsers clamp the biquad's computed frequency at Nyquist; offline
   * node-web-audio-api does NOT and its biquad goes unstable (NaN), so the
   * envelope/LFO sweep is capped to the audible range explicitly.
   */
  const filterHeadroomCents = () => Math.max(0, 1200 * Math.log2((context.sampleRate * 0.45) / baseCutoff()))
  let filterHead: AudioNodeLike = oscBus
  let filter1: BiquadFilterNodeLike | null = null
  let filter2: BiquadFilterNodeLike | null = null
  if (layer.filter.on) {
    filter1 = context.createBiquadFilter()
    filter1.type = layer.filter.type === 'HP' ? 'highpass' : layer.filter.type === 'BP' ? 'bandpass' : 'lowpass'
    filter1.frequency.value = baseCutoff()
    filter1.Q.value = synthMappings.resonanceQ(layer.filter.res)
    filterHead.connect(filter1)
    filterHead = filter1
    ownedNodes.push(filter1)
    if (layer.filter.type === 'LP24') {
      filter2 = context.createBiquadFilter()
      filter2.type = 'lowpass'
      filter2.frequency.value = baseCutoff()
      filter2.Q.value = 0.7
      filterHead.connect(filter2)
      filterHead = filter2
      ownedNodes.push(filter2)
    }
  }
  if (layer.filter.on && layer.filter.drive > 0) {
    const shaper = context.createWaveShaper()
    const k = layer.filter.drive * 4
    const curve = new Float32Array(1024)
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1
      curve[i] = Math.tanh(x * k) / Math.tanh(k)
    }
    shaper.curve = curve
    filterHead.connect(shaper)
    filterHead = shaper
    ownedNodes.push(shaper)
  }

  /* Amp envelope gain. */
  const ampGain = context.createGain()
  filterHead.connect(ampGain)
  ampGain.connect(destination)
  ownedNodes.push(ampGain)

  const velSens = [0, 0.4, 0.7, 1][layer.ampEnv.velocity]!
  const peak = Math.max(0.001, (1 - velSens) + velSens * Math.pow(velocity, 1.2))
  const attack = Math.max(MIN_ENV, synthMappings.envSeconds(layer.ampEnv.attack))
  const decay = synthMappings.envSeconds(layer.ampEnv.decay)
  const sustainDecay = synthMappings.isSustainDecay(layer.ampEnv.decay)
  ampGain.gain.setValueAtTime(0.0001, now)
  ampGain.gain.linearRampToValueAtTime(peak, now + attack)
  if (!sustainDecay) ampGain.gain.setTargetAtTime(0.0001, now + attack, Math.max(MIN_ENV, decay / 3))

  /* Oscillator envelope: Osc Ctrl or pitch (bipolar Env Amt). */
  const modAttack = Math.max(MIN_ENV, synthMappings.envSeconds(layer.oscEnv.attack))
  const modDecay = synthMappings.envSeconds(layer.oscEnv.decay)
  const modSustain = synthMappings.isSustainDecay(layer.oscEnv.decay)
  const modVel = layer.oscEnv.velocity ? Math.pow(velocity, 1.2) : 1

  const scheduleEnv = (
    param: AudioParamLike,
    base: number,
    amount: number,
    attackS: number,
    decayS: number,
    sustainMode: boolean,
  ) => {
    if (amount === 0) return
    param.setValueAtTime(base, now)
    param.linearRampToValueAtTime(base + amount, now + attackS)
    if (!sustainMode) param.setTargetAtTime(base, now + attackS, Math.max(MIN_ENV, decayS / 3))
  }

  /* Dedicated filter envelope (own A/D/R + velocity toggle) onto cutoff cents. */
  const filterVel = layer.filterEnv.velocity ? Math.pow(velocity, 1.2) : 1
  const fEnvAttack = Math.max(MIN_ENV, synthMappings.envSeconds(layer.filterEnv.attack))
  const fEnvDecay = synthMappings.envSeconds(layer.filterEnv.decay)
  const fEnvSustain = synthMappings.isSustainDecay(layer.filterEnv.decay)
  const filterEnvCents = Math.min(filterHeadroomCents(), (layer.filter.envAmt / 127) * 4800 * filterVel)
  if (filter1) scheduleEnv(filter1.detune, 0, filterEnvCents, fEnvAttack, fEnvDecay, fEnvSustain)
  if (filter2) scheduleEnv(filter2.detune, 0, filterEnvCents, fEnvAttack, fEnvDecay, fEnvSustain)

  const modAmount = ((layer.oscEnv.amount - 64) / 63.5) * modVel // bipolar -1..1
  if (layer.oscEnv.toPitch) {
    for (const entry of oscEntries)
      scheduleEnv(entry.osc.detune, entry.baseDetune + pitchBend * 100, modAmount * 1200, modAttack, modDecay, modSustain)
  } else {
    for (const target of ctrlTargets) scheduleEnv(target.param, target.base, modAmount * target.scale, modAttack, modDecay, modSustain)
  }

  /* LFO connections through per-voice depth gains. */
  const lfoGains: GainNodeLike[] = []
  const connectLfo = (target: AudioParamLike, depth: number) => {
    const gain = context.createGain()
    gain.gain.value = depth
    options.lfoOutput.connect(gain)
    gain.connect(target)
    ownedNodes.push(gain)
    lfoGains.push(gain)
  }
  const lfoDepths = (l: SynthLayerState): number[] => {
    const amount = l.lfo.amount / 127
    if (l.lfo.dest === 'Osc Pitch') return oscEntries.map(() => amount * 200)
    if (l.lfo.dest === 'Filter Freq') return [Math.min(filterHeadroomCents(), amount * 3600)]
    if (l.lfo.dest === 'Osc Ctrl') return ctrlTargets.map((t) => amount * t.scale)
    return []
  }
  if (layer.lfo.dest === 'Osc Pitch') {
    for (const entry of oscEntries) connectLfo(entry.osc.detune, 0)
  } else if (layer.lfo.dest === 'Filter Freq' && filter1) {
    connectLfo(filter1.detune, 0)
  } else if (layer.lfo.dest === 'Osc Ctrl') {
    for (const target of ctrlTargets) connectLfo(target.param, 0)
  }
  const applyLfoDepths = (l: SynthLayerState, when: number) => {
    const depths = lfoDepths(l)
    lfoGains.forEach((gain, i) => {
      gain.gain.cancelScheduledValues(when)
      gain.gain.setTargetAtTime(depths[i] ?? 0, when, 0.02)
    })
  }
  applyLfoDepths(layer, now)

  /* Vibrato: layer vibrato oscillator into every osc detune. */
  const vibratoGains: GainNodeLike[] = []
  if (layer.voice.vibrato !== 'Off') {
    for (const entry of oscEntries) {
      const gain = context.createGain()
      gain.gain.value = vibratoDepthCents(layer, options.wheelValue)
      options.vibratoOutput.connect(gain)
      gain.connect(entry.osc.detune)
      ownedNodes.push(gain)
      vibratoGains.push(gain)
    }
  }

  const releaseSeconds = () => Math.max(0.01, synthMappings.envSeconds(layer.ampEnv.release))

  // Scheduled arp steps: pre-schedule the note end at build time.
  if (options.holdSeconds !== undefined) {
    const end = now + options.holdSeconds
    const release = releaseSeconds()
    ampGain.gain.setTargetAtTime(0.0001, end, Math.max(MIN_ENV, release / 4))
  }

  let currentMidi = midi

  return {
    midi,
    noteOff(when: number): number {
      const release = releaseSeconds()
      ampGain.gain.cancelScheduledValues(when)
      ampGain.gain.setTargetAtTime(0.0001, when, Math.max(MIN_ENV, release / 4))
      const modRelease = Math.max(MIN_ENV, synthMappings.envSeconds(layer.filterEnv.release) / 4)
      if (filter1) {
        filter1.detune.cancelScheduledValues(when)
        filter1.detune.setTargetAtTime(0, when, modRelease)
      }
      if (filter2) {
        filter2.detune.cancelScheduledValues(when)
        filter2.detune.setTargetAtTime(0, when, modRelease)
      }
      return release
    },
    applyBend(semitones: number, when: number) {
      for (const entry of oscEntries) {
        entry.osc.detune.cancelScheduledValues(when)
        entry.osc.detune.setTargetAtTime(entry.baseDetune + semitones * 100, when, 0.015)
      }
    },
    glideTo(nextMidi: number, when: number, glideSeconds: number) {
      const target = midiToFrequency(nextMidi)
      const seconds = Math.max(0.005, glideSeconds)
      for (const entry of oscEntries) {
        const targetHz = target * entry.ratio
        entry.osc.frequency.cancelScheduledValues(when)
        entry.osc.frequency.setValueAtTime(Math.max(0.01, midiToFrequency(currentMidi) * entry.ratio), when)
        entry.osc.frequency.exponentialRampToValueAtTime(Math.max(0.01, targetHz), when + seconds)
      }
      if (formant) {
        formant.frequency.cancelScheduledValues(when)
        formant.frequency.setTargetAtTime(target * synthMappings.syncRatio(layer.oscCtrl), when, seconds / 3)
      }
      if (filter1 && trackAmount > 0) {
        const cutoff = Math.min(context.sampleRate * 0.45, mappings.filterFreqHz(layer.filter.freq) * Math.pow(target / 261.63, trackAmount))
        filter1.frequency.setTargetAtTime(cutoff, when, seconds / 3)
        filter2?.frequency.setTargetAtTime(cutoff, when, seconds / 3)
      }
      currentMidi = nextMidi
    },
    updateControls(next: SynthLayerState, wheelValue: number, when: number) {
      // Filter cutoff/resonance (morphable).
      if (filter1) {
        const cutoff = Math.min(
          context.sampleRate * 0.45,
          Math.max(20, mappings.filterFreqHz(next.filter.freq) * Math.pow(midiToFrequency(currentMidi) / 261.63, trackAmount)),
        )
        filter1.frequency.cancelScheduledValues(when)
        filter1.frequency.setTargetAtTime(cutoff, when, 0.02)
        filter1.Q.cancelScheduledValues(when)
        filter1.Q.setTargetAtTime(synthMappings.resonanceQ(next.filter.res), when, 0.02)
        if (filter2) {
          filter2.frequency.cancelScheduledValues(when)
          filter2.frequency.setTargetAtTime(cutoff, when, 0.02)
        }
      }
      // Osc Ctrl (morphable): retarget the ctrl bases.
      if (formant) {
        formant.frequency.cancelScheduledValues(when)
        formant.frequency.setTargetAtTime(midiToFrequency(currentMidi) * synthMappings.syncRatio(next.oscCtrl), when, 0.02)
      } else if (next.category === 'Multi' || next.category === 'Super') {
        const spread = next.category === 'Multi' ? multiSpreadCents(next.oscCtrl, next.voice.unison) : superSpreadCents(next.oscCtrl, next.voice.unison)
        for (const target of ctrlTargets) {
          if (target.spreadSign === undefined) continue
          const base = target.spreadSign * spread
          target.param.cancelScheduledValues(when)
          target.param.setTargetAtTime(base, when, 0.02)
          target.base = base
        }
      } else if (next.category === 'FM-H') {
        for (const target of ctrlTargets) {
          const base = fmIndexHz(next.oscCtrl, midiToFrequency(currentMidi))
          target.param.cancelScheduledValues(when)
          target.param.setTargetAtTime(base, when, 0.02)
          target.base = base
        }
      }
      applyLfoDepths(next, when)
      for (const gain of vibratoGains) {
        gain.gain.cancelScheduledValues(when)
        gain.gain.setTargetAtTime(vibratoDepthCents(next, wheelValue), when, 0.02)
      }
    },
  }
}

function multiSpreadCents(oscCtrl: number, unison: number): number {
  return (4 + (oscCtrl / 127) * 26) * (1 + unison * 0.4)
}

function superSpreadCents(oscCtrl: number, unison: number): number {
  return (6 + (oscCtrl / 127) * 44) * (1 + unison * 0.35)
}

function fmIndexHz(oscCtrl: number, frequency: number): number {
  return Math.pow(oscCtrl / 127, 1.5) * frequency * 5
}

function vibratoDepthCents(layer: SynthLayerState, wheelValue: number): number {
  const base = (layer.voice.vibAmount / 127) * 50
  if (layer.voice.vibrato === 'On') return base
  if (layer.voice.vibrato === 'Wheel') return base * wheelValue
  return 0
}

/* ------------------------------------------------------------ arpeggiator -- */

/**
 * Deterministic arpeggiator step sequence for one full cycle: held notes
 * expanded across the octave range, ordered by direction. Random uses a
 * seeded xorshift so the same held set always produces the same pattern.
 */
export function arpSequence(held: number[], direction: ArpDirection, range: 1 | 2 | 3 | 4): number[] {
  if (held.length === 0) return []
  const base = [...new Set(held)].sort((a, b) => a - b)
  const expanded: number[] = []
  for (let octave = 0; octave < range; octave++) {
    for (const note of base) expanded.push(note + octave * 12)
  }
  switch (direction) {
    case 'Up':
      return expanded
    case 'Down':
      return [...expanded].reverse()
    case 'Up/Down': {
      if (expanded.length <= 2) return expanded
      const down = [...expanded].reverse().slice(1, -1)
      return [...expanded, ...down]
    }
    case 'Random': {
      let seed = 0x9e3779b9 ^ expanded.reduce((sum, n) => (sum * 31 + n) >>> 0, 7)
      const shuffled = [...expanded]
      for (let i = shuffled.length - 1; i > 0; i--) {
        seed ^= seed << 13
        seed ^= seed >>> 17
        seed ^= seed << 5
        seed >>>= 0
        const j = seed % (i + 1)
        const tmp = shuffled[i]!
        shuffled[i] = shuffled[j]!
        shuffled[j] = tmp
      }
      return shuffled
    }
  }
}

export function synthVoiceWaveName(layer: SynthLayerState): string {
  return SYNTH_WAVEFORMS[layer.category][layer.wave] ?? SYNTH_WAVEFORMS[layer.category][0]!
}
