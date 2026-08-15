import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
} from './boundaries'
import type { OrganLayerState, OrganModel, OrganState, VibratoChorusMode } from '../state/program-types'

/**
 * Organ voices — ALL SYNTHESIZED with real Web Audio oscillators/noise
 * (declared in IMPLEMENTATION_DETAILS.json; no recordings):
 *
 * - B3 / B3 Bass: additive tonewheel model — one sine partial per drawbar at
 *   the classic footage ratios, with high-frequency foldback, drawbar gains
 *   live-updatable while notes sound, single-triggered percussion (2nd/3rd
 *   harmonic, soft/normal, slow/fast decay) and a key-click noise transient.
 * - Vox: sine partial bank on drawbars 1–7 plus a sawtooth "bright" bank
 *   blended by drawbar 9 (the Vox tone control). Drawbar 8 is unused and
 *   documented as such.
 * - Farf: register tabs — each drawbar switches a characteristic buzzy
 *   oscillator (saw/square/triangle at 16'/8'/4'/2⅔' pitches) on or off.
 * - Pipe 1 / Pipe 2: flute-ish triangle ranks per drawbar footage with a
 *   filtered-noise chiff transient; Pipe 2 is the brighter principal
 *   registration (sawtooth ranks, stronger upper work).
 *
 * The vibrato/chorus scanner is a modulated-delay unit shared per organ
 *   layer: V1–V3 replace the signal (vibrato), C1–C3 blend it (chorus).
 */

/** Drawbar footage ratios relative to the played note: 16' 5⅓' 8' 4' 2⅔' 2' 1⅗' 1⅓' 1'. */
export const FOOTAGE_RATIOS = [0.5, 1.4983, 1, 2, 2.9966, 4, 5.0397, 5.9932, 8] as const

/** Drawbar position 0..8 -> linear gain (~3 dB per step, like real drawbars). */
export function drawbarGain(position: number): number {
  if (position <= 0) return 0
  return Math.pow(10, (-3 * (8 - position)) / 20)
}

/** Tonewheel foldback: partials above the top wheel fold down an octave. */
function foldback(frequency: number): number {
  let f = frequency
  while (f > 5924) f /= 2
  return f
}

function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/* --------------------------------------------------------------- noise -- */

const noiseCache = new WeakMap<AudioContextLike, AudioBufferLike>()

/** Deterministic xorshift white-noise buffer (shared per context). */
export function noiseBuffer(context: AudioContextLike): AudioBufferLike {
  const cached = noiseCache.get(context)
  if (cached) return cached
  const rate = context.sampleRate
  const length = Math.max(1, Math.floor(rate * 1.0))
  const buffer = context.createBuffer(1, length, rate)
  const data = buffer.getChannelData(0)
  let seed = 0x2545f491
  for (let i = 0; i < length; i++) {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    seed >>>= 0
    data[i] = (seed / 0xffffffff) * 2 - 1
  }
  noiseCache.set(context, buffer)
  return buffer
}

/* ------------------------------------------------------- organ voices -- */

export interface Stoppable {
  stop(when?: number): void
  disconnect(): void
}

export interface OrganVoiceHandle {
  /** Live drawbar/registration changes retune the sounding spectrum. */
  updateDrawbars(layer: OrganLayerState, now: number): void
  /** Pitch-stick bend in semitones. */
  applyBend(semitones: number, now: number): void
}

interface Partial {
  osc: OscillatorNodeLike
  gain: GainNodeLike
  drawbarIndex: number
  /** Scales the drawbar gain (bright banks, rank voicing). */
  weight: number
  baseDetune: number
}

export interface OrganVoiceOptions {
  context: AudioContextLike
  /** Already octave/transpose-shifted MIDI note. */
  midi: number
  layer: OrganLayerState
  percussion: OrganState['percussion']
  /** True when this note should (re)trigger percussion (single-trigger rule). */
  percussionTrigger: boolean
  pitchBend: number
  now: number
  /** Voice entry node (the engine-owned per-voice gain). */
  destination: AudioNodeLike
  ownedNodes: AudioNodeLike[]
  stoppables: Stoppable[]
}

/** Per-model partial plans. Farf entries are register tabs, not drawbars. */
function partialPlan(model: OrganModel): Array<{ ratio: number; type: string; drawbarIndex: number; weight: number; detune?: number }> {
  switch (model) {
    case 'B3':
      return FOOTAGE_RATIOS.map((ratio, i) => ({ ratio, type: 'sine', drawbarIndex: i, weight: 1 }))
    case 'B3 Bass':
      // Manual: B3 Bass uses the 16' and 8' drawbars only (first two).
      return [
        { ratio: 0.5, type: 'sine', drawbarIndex: 0, weight: 1.2 },
        { ratio: 1, type: 'sine', drawbarIndex: 1, weight: 1.2 },
      ]
    case 'Vox':
      // Sine bank on drawbars 1..7; the bright saw bank is added separately.
      return [0.5, 1, 2, 3, 4, 6, 8].map((ratio, i) => ({ ratio, type: 'sine', drawbarIndex: i, weight: 1 }))
    case 'Farf':
      return [
        { ratio: 0.5, type: 'sawtooth', drawbarIndex: 0, weight: 0.9 },
        { ratio: 0.5, type: 'square', drawbarIndex: 1, weight: 0.7 },
        { ratio: 1, type: 'triangle', drawbarIndex: 2, weight: 1 },
        { ratio: 1, type: 'sawtooth', drawbarIndex: 3, weight: 0.8 },
        { ratio: 1, type: 'square', drawbarIndex: 4, weight: 0.6 },
        { ratio: 1, type: 'sawtooth', drawbarIndex: 5, weight: 0.8, detune: 7 },
        { ratio: 2, type: 'triangle', drawbarIndex: 6, weight: 0.9 },
        { ratio: 2, type: 'sawtooth', drawbarIndex: 7, weight: 0.7 },
        { ratio: 3, type: 'sawtooth', drawbarIndex: 8, weight: 0.6 },
      ]
    case 'Pipe 1':
      return FOOTAGE_RATIOS.map((ratio, i) => ({ ratio, type: 'triangle', drawbarIndex: i, weight: 1 }))
    case 'Pipe 2':
      // Principal registration: brighter saw ranks with stronger upper work.
      return FOOTAGE_RATIOS.map((ratio, i) => ({ ratio, type: 'sawtooth', drawbarIndex: i, weight: i >= 3 ? 0.85 : 0.6 }))
  }
}

/** Normalization so full registrations do not clip (per model). */
function modelTrim(model: OrganModel): number {
  switch (model) {
    case 'B3':
    case 'B3 Bass':
      return 0.16
    case 'Vox':
      return 0.15
    case 'Farf':
      return 0.11
    case 'Pipe 1':
      return 0.15
    case 'Pipe 2':
      return 0.12
  }
}

export function buildOrganVoice(options: OrganVoiceOptions): OrganVoiceHandle {
  const { context, midi, layer, percussion, percussionTrigger, pitchBend, now, destination, ownedNodes, stoppables } = options
  const model = layer.model
  const frequency = midiToFrequency(midi)
  const trim = modelTrim(model)
  // Deterministic per-note pipe detune (pipes are never perfectly in tune).
  const pipeDetune = model === 'Pipe 1' || model === 'Pipe 2' ? ((midi * 7) % 5) - 2 : 0

  const partials: Partial[] = []
  for (const plan of partialPlan(model)) {
    const target = foldback(frequency * plan.ratio)
    if (target > context.sampleRate / 2) continue
    const osc = context.createOscillator()
    osc.type = plan.type
    osc.frequency.value = target
    const baseDetune = (plan.detune ?? 0) + pipeDetune
    osc.detune.value = baseDetune + pitchBend * 100
    const gain = context.createGain()
    gain.gain.value = drawbarGain(layer.drawbars[plan.drawbarIndex] ?? 0) * plan.weight * trim
    osc.connect(gain)
    gain.connect(destination)
    osc.start(now)
    ownedNodes.push(gain)
    stoppables.push(osc)
    partials.push({ osc, gain, drawbarIndex: plan.drawbarIndex, weight: plan.weight * trim, baseDetune })
  }

  // Vox bright bank: sawtooths at 8' and 4' blended by drawbar 9 (index 8).
  const brightBank: Partial[] = []
  if (model === 'Vox') {
    for (const ratio of [1, 2]) {
      const osc = context.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.value = frequency * ratio
      osc.detune.value = pitchBend * 100
      const gain = context.createGain()
      gain.gain.value = voxBrightGain(layer, ratio) * trim
      osc.connect(gain)
      gain.connect(destination)
      osc.start(now)
      ownedNodes.push(gain)
      stoppables.push(osc)
      brightBank.push({ osc, gain, drawbarIndex: 8, weight: trim, baseDetune: 0 })
    }
  }

  // B3 percussion: a decaying 2nd/3rd-harmonic sine, single-triggered.
  if (model === 'B3' && percussion.on && percussionTrigger) {
    const osc = context.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = foldback(frequency * (percussion.third ? 3 : 2))
    osc.detune.value = pitchBend * 100
    const gain = context.createGain()
    const peak = (percussion.soft ? 0.35 : 0.8) * trim * 4
    gain.gain.setValueAtTime(peak, now)
    gain.gain.setTargetAtTime(0.0001, now + 0.002, percussion.fast ? 0.08 : 0.25)
    osc.connect(gain)
    gain.connect(destination)
    osc.start(now)
    osc.stop(now + 1.6)
    ownedNodes.push(gain)
    stoppables.push(osc)
  }

  // B3 key click: a short bright noise transient at note start.
  if (model === 'B3' || model === 'B3 Bass') {
    addNoiseBurst(context, destination, ownedNodes, stoppables, now, {
      duration: 0.012,
      filterType: 'highpass',
      filterFreq: 2200,
      peak: 0.05,
    })
  }

  // Pipe chiff: a filtered-noise attack transient scaled by registration.
  if (model === 'Pipe 1' || model === 'Pipe 2') {
    const registration = layer.drawbars.reduce((sum, v) => sum + v, 0) / (8 * 9)
    if (registration > 0.01) {
      addNoiseBurst(context, destination, ownedNodes, stoppables, now, {
        duration: 0.07,
        filterType: 'bandpass',
        filterFreq: Math.min(8000, frequency * 2),
        peak: 0.12 * registration + 0.02,
      })
    }
  }

  return {
    updateDrawbars(next: OrganLayerState, when: number) {
      for (const partial of partials) {
        const value = drawbarGain(next.drawbars[partial.drawbarIndex] ?? 0) * partial.weight
        partial.gain.gain.cancelScheduledValues(when)
        partial.gain.gain.setTargetAtTime(value, when, 0.015)
      }
      for (const bright of brightBank) {
        const ratio = bright.osc.frequency.value / frequency
        const value = voxBrightGain(next, ratio) * bright.weight
        bright.gain.gain.cancelScheduledValues(when)
        bright.gain.gain.setTargetAtTime(value, when, 0.015)
      }
    },
    applyBend(semitones: number, when: number) {
      for (const partial of [...partials, ...brightBank]) {
        partial.osc.detune.cancelScheduledValues(when)
        partial.osc.detune.setTargetAtTime(partial.baseDetune + semitones * 100, when, 0.015)
      }
    },
  }
}

function voxBrightGain(layer: OrganLayerState, ratio: number): number {
  const mix = (layer.drawbars[8] ?? 0) / 8
  const registration = drawbarGain(layer.drawbars[ratio === 1 ? 1 : 2] ?? 0)
  return mix * (0.25 + 0.5 * registration) * (ratio === 1 ? 1 : 0.6)
}

function addNoiseBurst(
  context: AudioContextLike,
  destination: AudioNodeLike,
  ownedNodes: AudioNodeLike[],
  stoppables: Stoppable[],
  now: number,
  spec: { duration: number; filterType: string; filterFreq: number; peak: number },
): void {
  const source: AudioBufferSourceNodeLike = context.createBufferSource()
  source.buffer = noiseBuffer(context)
  const filter = context.createBiquadFilter()
  filter.type = spec.filterType
  filter.frequency.value = spec.filterFreq
  filter.Q.value = 1.2
  const gain = context.createGain()
  gain.gain.setValueAtTime(spec.peak, now)
  gain.gain.setTargetAtTime(0.0001, now + spec.duration * 0.4, spec.duration * 0.4)
  source.connect(filter)
  filter.connect(gain)
  gain.connect(destination)
  source.start(now)
  source.stop(now + spec.duration + 0.1)
  ownedNodes.push(filter, gain)
  stoppables.push(source)
}

/* --------------------------------------------------- vibrato / chorus -- */

export interface OrganVibratoUnit {
  readonly input: AudioNodeLike
  readonly output: AudioNodeLike
  update(mode: VibratoChorusMode, on: boolean, now: number): void
  dispose(): void
}

/**
 * Scanner vibrato/chorus: a delay line frequency-modulated at ~6.9 Hz.
 * V modes pass only the modulated signal (pitch vibrato); C modes blend it
 * with the dry signal (chorus). Depth grows with the mode number.
 */
export function createOrganVibrato(context: AudioContextLike): OrganVibratoUnit {
  const input = context.createGain()
  const output = context.createGain()
  const dry = context.createGain()
  const wet = context.createGain()
  const delay = context.createDelay(0.05)
  delay.delayTime.value = 0.004
  const lfo = context.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.value = 6.9
  const depth = context.createGain()
  depth.gain.value = 0
  lfo.connect(depth)
  depth.connect(delay.delayTime)
  lfo.start(0)

  input.connect(dry)
  dry.connect(output)
  input.connect(delay)
  delay.connect(wet)
  wet.connect(output)
  dry.gain.value = 1
  wet.gain.value = 0

  return {
    input,
    output,
    update(mode, on, now) {
      const level = Number(mode.slice(1)) // 1..3
      const isVibrato = mode.startsWith('V')
      const depthSeconds = on ? [0.0012, 0.0022, 0.0034][level - 1]! : 0
      depth.gain.cancelScheduledValues(now)
      depth.gain.setTargetAtTime(depthSeconds, now, 0.02)
      const dryLevel = !on ? 1 : isVibrato ? 0 : 1
      const wetLevel = !on ? 0 : isVibrato ? 1 : 0.55 + 0.15 * level
      dry.gain.cancelScheduledValues(now)
      dry.gain.setTargetAtTime(dryLevel, now, 0.02)
      wet.gain.cancelScheduledValues(now)
      wet.gain.setTargetAtTime(wetLevel, now, 0.02)
    },
    dispose() {
      for (const node of [lfo, depth, delay, dry, wet, input, output]) {
        try {
          ;(node as OscillatorNodeLike).stop?.(0)
        } catch {
          /* not startable */
        }
        try {
          node.disconnect()
        } catch {
          /* detached */
        }
      }
    },
  }
}
