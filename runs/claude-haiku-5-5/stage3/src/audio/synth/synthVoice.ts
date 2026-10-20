// One synth note: the source members (with unison copies), a filter, a drive stage, three envelopes,
// an LFO, and vibrato. Everything the note needs is built here and disposed in one call, so a released
// note leaves no nodes behind.
//
// Envelopes: attack, decay, and release come from the panel knobs. A decay at its maximum holds the
// level until release (the spec's sustain mode). The amplifier scales with velocity by the level the
// panel selects (Off, 1, 2, 3). The filter envelope and the oscillator (pitch) envelope move the cutoff
// and the pitch by their amounts.

import type { AudioContextLike, AudioNodeLike, AudioParamLike, BiquadFilterNodeLike, GainNodeLike, OscillatorNodeLike } from '../audioBoundary'
import { gainNode, NodeBag, softClipCurve } from '../effects/nodes'
import type { VoiceHandle } from '../voice'
import { ctrlAmount, pulseCoefficients, sampleHoldCoefficients, sourceRecipe, type SourceMember } from './sources'

export const FILTER_TYPES = ['LP12', 'LP24', 'HP', 'BP'] as const
export const TRACKING = [0, 1 / 3, 2 / 3, 1] as const
export const DRIVE = [0, 0.33, 0.66, 1] as const
/** Unison copies: detune in cents for each copy, by panel level Off, 1, 2, 3. */
export const UNISON_CENTS = [[0], [-6, 6], [-10, 0, 10], [-14, -5, 5, 14]] as const
/** Velocity sensitivity by panel level Off, 1, 2, 3. */
const VELOCITY_SENSITIVITY = [0, 0.33, 0.66, 1] as const
export const LFO_WAVES = ['triangle', 'sawtooth-down', 'sawtooth-up', 'square', 'sample-hold'] as const
/**
 * Level a finite decay settles to while the key is held. Decay at its maximum holds at the peak (sustain
 * mode, manual p. 33). The panel has no separate sustain knob, so these are fixed fractions of the peak.
 */
const AMP_SUSTAIN = 0.7
const FILTER_SUSTAIN = 0.5
const OSC_SUSTAIN = 0.5
const VIBRATO_CENTS = 40
const LFO_PITCH_CENTS = 100
const LFO_CTRL_CENTS = 14

export interface EnvelopeShape {
  /** Knob positions 0..1. */
  attack: number
  decay: number
  release: number
  /** Velocity level: 0 to 3 for the amplifier, 0 or 1 for the filter and oscillator envelopes. */
  velocity: number
}

export interface SynthVoiceSettings {
  source: number
  ctrl: number
  filterType: number
  filterTrack: number
  filterDrive: number
  cutoff: number
  resonance: number
  filterEnvAmount: number
  amp: EnvelopeShape
  filterEnv: EnvelopeShape
  oscEnv: EnvelopeShape & { pitch: number }
  lfo: { rateHz: number; amount: number; wave: number; toPitch: boolean; toCtrl: boolean; toFilter: boolean }
  vibrato: { on: boolean; rateHz: number; depth: number }
  unison: number
}

export interface SynthVoiceHandle extends VoiceHandle {
  /** Moves the note to a new pitch over `glideSeconds`, keeping the envelopes running (legato, glide). */
  retune(note: number, glideSeconds: number): void
  /** Restarts the amplifier envelope from silence, for mono notes that are not legato. */
  retrigger(): void
}

/** Attack in seconds: 2 ms at the bottom of the knob, about 2 s at the top. */
export function attackSeconds(knob: number): number {
  return 0.002 * Math.pow(1000, clamp01(knob))
}

/** Decay and release in seconds: 20 ms to 4 s. */
export function decaySeconds(knob: number): number {
  return 0.02 * Math.pow(200, clamp01(knob))
}

/** Cutoff in Hz: 40 Hz at the bottom of the knob, about 11 kHz at the top. */
export function cutoffHz(knob: number): number {
  return 40 * Math.pow(2, clamp01(knob) * 8.1)
}

/** Keyboard tracking: the cutoff moves by `track` of an octave for each octave of pitch above middle C. */
export function trackingFactor(note: number, track: number): number {
  return Math.pow(2, (track * (note - 60)) / 12)
}

/** Amplitude at a velocity: full at 127 and quieter below it by the panel's sensitivity. */
export function velocityPeak(velocity: number, level: number): number {
  const sensitivity = VELOCITY_SENSITIVITY[Math.min(3, Math.max(0, level))]
  const v = Math.min(127, Math.max(1, velocity)) / 127
  return 1 - sensitivity * (1 - v)
}

export function midiToHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12)
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

const noiseCache = new WeakMap<AudioContextLike, unknown>()

/** A two-second loop of deterministic white noise, shared by every noise voice on one context. */
function noiseBuffer(context: AudioContextLike) {
  const cached = noiseCache.get(context)
  if (cached) return cached as ReturnType<AudioContextLike['createBuffer']>
  const length = Math.round(context.sampleRate * 2)
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const data = buffer.getChannelData(0)
  let state = 0x1234567
  for (let i = 0; i < length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    data[i] = state / 0x80000000 - 1
  }
  noiseCache.set(context, buffer)
  return buffer
}

/** Anything that starts, stops, and reports its end: an oscillator or a looping noise source. */
interface Stoppable {
  stop(when?: number): void
  onended: (() => void) | null
}

interface PitchedMember {
  osc: OscillatorNodeLike
  /** Interval of this oscillator above the played note, in semitones. */
  semitones: number
  /** Detune of this oscillator before pitch-stick, envelope, and vibrato. */
  cents: number
}

export function startSynthVoice(
  context: AudioContextLike,
  destination: AudioNodeLike,
  settings: SynthVoiceSettings,
  note: number,
  velocity: number,
  gain: number,
  onEnded: () => void,
  startTime = context.currentTime,
): SynthVoiceHandle {
  const bag = new NodeBag()
  const now = startTime
  const recipe = sourceRecipe(settings.source, ctrlAmount(settings.ctrl))
  const copies = UNISON_CENTS[Math.min(3, Math.max(0, settings.unison))]
  const copyGain = 1 / Math.sqrt(copies.length)

  const ampGain = gainNode(context, bag, 0)
  ampGain.connect(destination)

  // Source mixer, then drive, then the filter chain, then the amplifier.
  const mixer = gainNode(context, bag, gain)
  let head: AudioNodeLike = mixer
  if (settings.filterDrive > 0) {
    const shaper = bag.add(context.createWaveShaper())
    shaper.curve = softClipCurve(DRIVE[Math.min(3, settings.filterDrive)])
    shaper.oversample = '2x'
    mixer.connect(shaper)
    head = shaper
  }
  const filters = filterChain(context, bag, settings.filterType)
  head.connect(filters[0])
  for (let i = 0; i + 1 < filters.length; i += 1) filters[i].connect(filters[i + 1])
  filters[filters.length - 1].connect(ampGain)

  // Every source that must be stopped, including the LFO, vibrato, and FM modulators.
  const stoppables: Stoppable[] = []
  const pitched: PitchedMember[] = []
  const baseHz = midiToHz(note)

  const lfoWave = LFO_WAVES[Math.min(LFO_WAVES.length - 1, settings.lfo.wave)]
  const lfo = settings.lfo.amount > 0 ? lfoOsc(context, bag, lfoWave, settings.lfo.rateHz, now) : undefined
  if (lfo) stoppables.push(lfo)
  const lfoSign = lfoWave === 'sawtooth-up' ? -1 : 1
  const vibrato = settings.vibrato.on ? lfoOsc(context, bag, 'sine', settings.vibrato.rateHz, now) : undefined
  if (vibrato) stoppables.push(vibrato)
  const vibratoCents = settings.vibrato.depth * VIBRATO_CENTS

  for (const copy of copies) {
    for (const member of recipe.members) {
      if (member.kind === 'noise') {
        const source = bag.add(context.createBufferSource())
        source.buffer = noiseBuffer(context)
        source.loop = true
        const level = gainNode(context, bag, member.gain * copyGain)
        source.connect(level)
        level.connect(mixer)
        source.start(now)
        stoppables.push(source)
        continue
      }
      const osc = pitchedOscillator(context, bag, member, copy, note, copyGain, mixer, now)
      pitched.push({ osc, semitones: member.semitones, cents: member.cents + copy })
      stoppables.push(osc)
      if (vibrato) connectScaled(context, bag, vibrato, osc.detune, vibratoCents)
      if (lfo && settings.lfo.toPitch) connectScaled(context, bag, lfo, osc.detune, LFO_PITCH_CENTS * settings.lfo.amount * lfoSign)
      if (lfo && settings.lfo.toCtrl) connectScaled(context, bag, lfo, osc.detune, LFO_CTRL_CENTS * settings.lfo.amount)
      if (recipe.fmDepthHz > 0 && member.kind === 'osc') {
        // Harmonic FM: a modulator at twice the carrier, its depth in Hz scaled to the pitch.
        const modulator = bag.add(context.createOscillator())
        modulator.type = 'sine'
        modulator.frequency.setValueAtTime(baseHz * 2, now)
        const depth = gainNode(context, bag, recipe.fmDepthHz * baseHz)
        modulator.connect(depth)
        depth.connect(osc.frequency)
        modulator.start(now)
        stoppables.push(modulator)
      }
    }
  }

  // Filter cutoff: tracked to the note, and moved by the LFO when it is routed to the filter.
  const cutoffBase = cutoffHz(settings.cutoff) * trackingFactor(note, TRACKING[Math.min(3, settings.filterTrack)])
  const resonance = 0.7 + clamp01(settings.resonance) * 12
  for (const filter of filters) {
    filter.Q.setValueAtTime(resonance, now)
    filter.frequency.setValueAtTime(cutoffBase, now)
    if (lfo && settings.lfo.toFilter) connectScaled(context, bag, lfo, filter.frequency, settings.lfo.amount * cutoffBase * 0.6)
  }

  scheduleAmp(ampGain.gain, settings.amp, velocity, now)
  scheduleFilterEnvelope(filters, cutoffBase, settings, velocity, now)
  scheduleOscEnvelope(pitched, settings.oscEnv, velocity, now)

  // The voice ends when its last source has stopped. A voice with no sources ends at once.
  let remaining = stoppables.length
  let ended = false
  const finish = () => {
    if (ended) return
    ended = true
    bag.dispose()
    onEnded()
  }
  for (const source of stoppables) {
    source.onended = () => {
      remaining -= 1
      if (remaining === 0) finish()
    }
  }
  if (remaining === 0) queueMicrotask(finish)

  const releaseTau = decaySeconds(settings.amp.release) / 4
  let released = false
  return {
    release() {
      if (released) return
      released = true
      const at = Math.max(now, context.currentTime)
      ampGain.gain.cancelScheduledValues(at)
      ampGain.gain.setTargetAtTime(0, at, releaseTau)
      for (const filter of filters) filter.frequency.setTargetAtTime(cutoffBase, at, releaseTau)
      for (const source of stoppables) source.stop(at + 6 * releaseTau)
    },
    stop() {
      if (released) return
      released = true
      const at = context.currentTime
      ampGain.gain.setTargetAtTime(0, at, 0.004)
      for (const source of stoppables) source.stop(at + 0.03)
    },
    setBend(cents: number) {
      for (const entry of pitched) entry.osc.detune.setTargetAtTime(entry.cents + cents, context.currentTime, 0.01)
    },
    retune(next: number, glideSeconds: number) {
      if (released) return
      const at = context.currentTime
      for (const entry of pitched) {
        const target = midiToHz(next) * Math.pow(2, entry.semitones / 12)
        entry.osc.frequency.cancelScheduledValues(at)
        entry.osc.frequency.setValueAtTime(entry.osc.frequency.value, at)
        if (glideSeconds > 0) entry.osc.frequency.linearRampToValueAtTime(target, at + glideSeconds)
        else entry.osc.frequency.setValueAtTime(target, at)
      }
      const cutoff = cutoffHz(settings.cutoff) * trackingFactor(next, TRACKING[Math.min(3, settings.filterTrack)])
      for (const filter of filters) filter.frequency.setTargetAtTime(cutoff, at, Math.max(0.005, glideSeconds / 3))
    },
    retrigger() {
      if (released) return
      const at = context.currentTime
      ampGain.gain.cancelScheduledValues(at)
      ampGain.gain.setValueAtTime(0, at)
      scheduleAmp(ampGain.gain, settings.amp, velocity, at)
    },
  }
}

/** One pitched oscillator of a source recipe, with its gain, unison copy, and pulse or sine shape. */
function pitchedOscillator(
  context: AudioContextLike,
  bag: NodeBag,
  member: Exclude<SourceMember, { kind: 'noise' }>,
  copyCents: number,
  note: number,
  copyGain: number,
  mixer: GainNodeLike,
  now: number,
): OscillatorNodeLike {
  const osc = bag.add(context.createOscillator())
  if (member.kind === 'pulse') {
    const coefficients = pulseCoefficients(member.duty)
    osc.setPeriodicWave(context.createPeriodicWave(coefficients, new Float32Array(coefficients.length)))
  } else {
    osc.type = member.type
  }
  osc.frequency.setValueAtTime(midiToHz(note) * Math.pow(2, member.semitones / 12), now)
  osc.detune.setValueAtTime(member.cents + copyCents, now)
  const level = gainNode(context, bag, member.gain * copyGain)
  osc.connect(level)
  level.connect(mixer)
  osc.start(now)
  return osc
}

function lfoOsc(context: AudioContextLike, bag: NodeBag, wave: string, rateHz: number, now: number): OscillatorNodeLike {
  const osc = bag.add(context.createOscillator())
  if (wave === 'sample-hold') {
    const coefficients = sampleHoldCoefficients()
    osc.setPeriodicWave(context.createPeriodicWave(coefficients, new Float32Array(coefficients.length)))
  } else {
    osc.type = wave === 'square' ? 'square' : wave === 'triangle' ? 'triangle' : 'sawtooth'
  }
  osc.frequency.setValueAtTime(rateHz, now)
  osc.start(now)
  return osc
}

/** Scales a source's output by `amount` and routes it into a parameter. */
function connectScaled(context: AudioContextLike, bag: NodeBag, source: OscillatorNodeLike, target: AudioParamLike, amount: number): void {
  const scale = gainNode(context, bag, amount)
  source.connect(scale)
  scale.connect(target)
}

function filterChain(context: AudioContextLike, bag: NodeBag, type: number): BiquadFilterNodeLike[] {
  const make = (filterType: 'lowpass' | 'highpass' | 'bandpass') => {
    const filter = bag.add(context.createBiquadFilter())
    filter.type = filterType
    return filter
  }
  switch (FILTER_TYPES[Math.min(3, Math.max(0, type))]) {
    case 'LP24':
      return [make('lowpass'), make('lowpass')]
    case 'HP':
      return [make('highpass')]
    case 'BP':
      return [make('bandpass')]
    default:
      return [make('lowpass')]
  }
}

/** Amplifier envelope: attack to the velocity peak, then decay to silence, or hold at the peak at maximum decay. */
function scheduleAmp(param: AudioParamLike, env: EnvelopeShape, velocity: number, now: number): void {
  const peak = velocityPeak(velocity, env.velocity)
  const attack = attackSeconds(env.attack)
  param.setValueAtTime(0, now)
  param.linearRampToValueAtTime(peak, now + attack)
  if (env.decay < 0.98) param.linearRampToValueAtTime(peak * AMP_SUSTAIN, now + attack + decaySeconds(env.decay))
}

/** Filter envelope: the cutoff rises by up to four octaves at the peak, scaled by the envelope amount. */
function scheduleFilterEnvelope(filters: BiquadFilterNodeLike[], base: number, settings: SynthVoiceSettings, velocity: number, now: number): void {
  const env = settings.filterEnv
  const scale = env.velocity >= 1 ? velocityPeak(velocity, 3) : 1
  const peak = base * Math.pow(2, 4 * clamp01(settings.filterEnvAmount) * scale)
  const attack = attackSeconds(env.attack)
  const hold = env.decay >= 0.98
  const sustain = hold ? peak : base * Math.pow(2, 4 * clamp01(settings.filterEnvAmount) * scale * FILTER_SUSTAIN)
  for (const filter of filters) {
    filter.frequency.setValueAtTime(base, now)
    filter.frequency.linearRampToValueAtTime(peak, now + attack)
    filter.frequency.linearRampToValueAtTime(sustain, now + attack + decaySeconds(env.decay))
  }
}

/** Oscillator envelope: pitch moves by up to an octave either way, in cents, following the bipolar amount. */
function scheduleOscEnvelope(pitched: PitchedMember[], env: EnvelopeShape & { pitch: number }, velocity: number, now: number): void {
  const scale = env.velocity >= 1 ? velocityPeak(velocity, 3) : 1
  const amount = (clamp01(env.pitch) - 0.5) * 2 * 1200 * scale
  const attack = attackSeconds(env.attack)
  const hold = env.decay >= 0.98
  for (const entry of pitched) {
    entry.osc.detune.setValueAtTime(entry.cents, now)
    entry.osc.detune.linearRampToValueAtTime(entry.cents + amount, now + attack)
    entry.osc.detune.linearRampToValueAtTime(entry.cents + (hold ? amount : amount * OSC_SUSTAIN), now + attack + decaySeconds(env.decay))
  }
}
