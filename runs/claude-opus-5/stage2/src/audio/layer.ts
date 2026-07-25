import { midiToFrequency } from '../model/keyboard'
import {
  AmpEqUnit,
  CompressorUnit,
  DelayUnit,
  Mod1Unit,
  Mod2Unit,
  Ramped,
  ReverbUnit,
  type EffectUnit,
} from './effects'
import type { GraphBiquad, GraphBuffer, GraphContext, GraphGain, GraphNode } from './graph'
import { pickSample, type LoadedSet } from './sampleLibrary'
import { pianoModel, pianoType } from './pianoTypes'
import {
  ATTACK_SECONDS,
  PEDAL_RELEASE_SECONDS,
  RELEASE_SECONDS,
  SOFT_RELEASE_MULTIPLIER,
  TRANSIENT_SECONDS,
  applyDynComp,
  applyKbTouch,
  partialsFor,
  synthVoiceFor,
  timbreShape,
  toneCutoff,
  unisonDetuneCents,
  unisonVoiceCount,
  velocityGain,
  voiceLifetime,
} from './pianoVoice'
import type { ChainSettings, LayerId, LayerSettings } from './settings'

/**
 * One piano layer: its voices, its timbre stage, its own effect chain in the documented order,
 * its level fader, and the switch that sends it to the shared Rotary instead of the piano bus.
 *
 *   voices -> timbre -> Mod 1 -> Mod 2 -> Delay -> Amp Sim/EQ -> Comp -> Reverb -> level
 *          -> piano bus (or the shared Rotary when "To Rotary" is selected)
 */

export interface LayerVoice {
  readonly nodes: GraphNode[]
  /** One gain per unison copy; releases ramp all of them. */
  readonly outputs: GraphGain[]
  readonly stoppables: { stop(when: number): void }[]
  readonly releaseSeconds: number
  readonly lifetimeSeconds: number
  /** True when this voice is playing recorded samples rather than synthesis. */
  readonly recorded: boolean
}

/** The six units of a layer chain, in the order the signal passes through them. */
export class LayerChain {
  readonly input: GraphGain
  readonly output: GraphGain
  readonly mod1: Mod1Unit
  readonly mod2: Mod2Unit
  readonly delay: DelayUnit
  readonly amp: AmpEqUnit
  readonly compressor: CompressorUnit
  readonly reverb: ReverbUnit
  private readonly units: EffectUnit[]

  constructor(private readonly context: GraphContext) {
    this.input = context.createGain()
    this.output = context.createGain()
    this.mod1 = new Mod1Unit(context)
    this.mod2 = new Mod2Unit(context)
    this.delay = new DelayUnit(context)
    this.amp = new AmpEqUnit(context)
    this.compressor = new CompressorUnit(context)
    this.reverb = new ReverbUnit(context)
    this.units = [this.mod1, this.mod2, this.delay, this.amp, this.compressor, this.reverb]

    let previous: GraphGain = this.input
    for (const unit of this.units) {
      previous.connect(unit.input)
      previous = unit.output
    }
    previous.connect(this.output)
  }

  /** The documented signal order, exposed so a test can assert it rather than trust a comment. */
  static readonly ORDER = ['mod1', 'mod2', 'delay', 'ampEq', 'compressor', 'reverb'] as const

  update(settings: ChainSettings, effectsOn: boolean): void {
    this.mod1.update(settings.mod1, effectsOn)
    this.mod2.update(settings.mod2, effectsOn)
    this.delay.update(settings.delay, effectsOn)
    this.amp.update(settings.amp, effectsOn)
    this.compressor.update(settings.compressor, effectsOn)
    this.reverb.update(settings.reverb, effectsOn)
  }

  dispose(): void {
    for (const unit of this.units) unit.dispose()
    this.input.disconnect()
    this.output.disconnect()
  }
}

const RESONATOR_COUNT = 4

export class PianoLayer {
  readonly voiceBus: GraphGain
  readonly chain: LayerChain
  readonly level: GraphGain
  readonly dryOut: GraphGain
  readonly rotaryOut: GraphGain
  private readonly timbreA: GraphBiquad
  private readonly timbreB: GraphBiquad
  private readonly resonanceSend: GraphGain
  private readonly levelRamp: Ramped
  private readonly dryRamp: Ramped
  private readonly rotaryRamp: Ramped
  private readonly resonanceRamp: Ramped
  private readonly resonators: { delay: ReturnType<GraphContext['createDelay']>; feedback: GraphGain }[] = []
  private readonly extraNodes: GraphNode[] = []
  private settings: LayerSettings
  private library: LoadedSet | null = null
  private timbreKey = ''

  constructor(
    readonly id: LayerId,
    private readonly context: GraphContext,
    private readonly noiseBuffer: GraphBuffer,
    initial: LayerSettings,
    effectsOn = true,
  ) {
    this.settings = initial
    this.voiceBus = context.createGain()
    this.timbreA = context.createBiquadFilter()
    this.timbreA.type = 'peaking'
    this.timbreA.frequency.value = 1000
    this.timbreA.gain.value = 0
    this.timbreB = context.createBiquadFilter()
    this.timbreB.type = 'peaking'
    this.timbreB.frequency.value = 3000
    this.timbreB.gain.value = 0
    this.chain = new LayerChain(context)
    this.level = context.createGain()
    this.dryOut = context.createGain()
    this.rotaryOut = context.createGain()
    this.levelRamp = new Ramped(this.level.gain, initial.enabled ? initial.level : 0)
    this.dryRamp = new Ramped(this.dryOut.gain, 1)
    this.rotaryRamp = new Ramped(this.rotaryOut.gain, 0)

    this.voiceBus.connect(this.timbreA)
    this.timbreA.connect(this.timbreB)
    this.timbreB.connect(this.chain.input)
    this.chain.output.connect(this.level)
    this.level.connect(this.dryOut)
    this.level.connect(this.rotaryOut)

    // Sympathetic string resonance: a small bank of damped comb resonators, tuned to the notes
    // actually being held. This is a simulation, not pedal-down recordings, and it is declared
    // as such (the piano spec allows simulation, manual p. 25).
    this.resonanceSend = context.createGain()
    this.resonanceRamp = new Ramped(this.resonanceSend.gain, 0)
    const resonanceMix = context.createGain()
    resonanceMix.gain.value = 0.5
    for (let index = 0; index < RESONATOR_COUNT; index += 1) {
      const delay = context.createDelay(0.05)
      delay.delayTime.value = 1 / midiToFrequency(45 + index * 7)
      const feedback = context.createGain()
      feedback.gain.value = 0.72
      const damper = context.createBiquadFilter()
      damper.type = 'lowpass'
      damper.frequency.value = 2400
      this.resonanceSend.connect(delay)
      delay.connect(damper)
      damper.connect(feedback)
      feedback.connect(delay)
      delay.connect(resonanceMix)
      this.resonators.push({ delay, feedback })
      this.extraNodes.push(damper)
    }
    resonanceMix.connect(this.chain.input)
    this.extraNodes.push(resonanceMix)

    this.applyTimbre()
    this.chain.update(initial.chain, effectsOn)
    this.applyRouting(initial, effectsOn)
  }

  /** Dry to the piano bus, or into the shared Rotary when "To Rotary" is the selected amp type. */
  private applyRouting(settings: LayerSettings, effectsOn: boolean): void {
    const toRotary = effectsOn && settings.chain.amp.on && settings.chain.amp.type === 'rotary'
    this.dryRamp.set(toRotary ? 0 : 1, this.context)
    this.rotaryRamp.set(toRotary ? 1 : 0, this.context)
  }

  get current(): LayerSettings {
    return this.settings
  }

  setLibrary(set: LoadedSet | null): void {
    this.library = set
  }

  /** True when this layer's selected type is a recorded set that is actually loaded. */
  get playsRecordedSamples(): boolean {
    const type = pianoType(this.settings.type)
    return type.source === 'recorded' && this.library?.id === type.sampleSet
  }

  update(settings: LayerSettings, effectsOn: boolean): void {
    const previous = this.settings
    this.settings = settings
    if (settings.level !== previous.level || settings.enabled !== previous.enabled) {
      this.levelRamp.set(settings.enabled ? settings.level : 0, this.context)
    }
    if (settings.timbre !== previous.timbre || settings.type !== previous.type) this.applyTimbre()
    this.chain.update(settings.chain, effectsOn)
    this.applyRouting(settings, effectsOn)
  }

  private applyTimbre(): void {
    const shape = timbreShape(this.settings.timbre)
    const key = `${this.settings.timbre}`
    if (key === this.timbreKey) return
    this.timbreKey = key
    if (shape.filter === 'none') {
      this.timbreA.gain.value = 0
      this.timbreB.gain.value = 0
      return
    }
    this.timbreA.type = shape.filter
    this.timbreA.frequency.value = shape.frequency
    this.timbreA.Q.value = shape.q
    this.timbreA.gain.value = shape.gainDb
    if (shape.second) {
      this.timbreB.type = shape.second.filter
      this.timbreB.frequency.value = shape.second.frequency
      this.timbreB.Q.value = shape.second.q
      this.timbreB.gain.value = shape.second.gainDb
    } else {
      this.timbreB.gain.value = 0
    }
  }

  /**
   * Sympathetic resonance follows the notes that are ringing: the resonators are tuned to the
   * lowest held notes and only opened while the pedal is down or another note is held.
   */
  updateResonance(heldNotes: readonly number[], pedalDown: boolean): void {
    const active = this.settings.stringRes && (pedalDown || heldNotes.length > 1)
    this.resonanceRamp.set(active ? 0.3 : 0, this.context, 0.05)
    if (!active) return
    const sorted = [...heldNotes].sort((a, b) => a - b)
    this.resonators.forEach((resonator, index) => {
      const midi = sorted[index % sorted.length] ?? 45 + index * 7
      const period = 1 / midiToFrequency(Math.max(24, midi + this.settings.octave))
      resonator.delay.delayTime.value = Math.min(0.049, period)
    })
  }

  /** Builds one playing voice. Returns null when the layer is off. */
  buildVoice(midi: number, velocity: number): LayerVoice | null {
    if (!this.settings.enabled) return null
    const context = this.context
    const shiftedMidi = midi + this.settings.octave
    const touched = applyKbTouch(velocity, this.settings.kbTouch)
    const level = applyDynComp(velocityGain(touched), this.settings.dynComp)
    const type = pianoType(this.settings.type)
    const model = pianoModel(this.settings.type, this.settings.model)
    const nodes: GraphNode[] = []
    const outputs: GraphGain[] = []
    const stoppables: { stop(when: number): void }[] = []
    const now = context.currentTime

    const copies = unisonVoiceCount(this.settings.unison)
    const detune = unisonDetuneCents(this.settings.unison)
    const recorded = this.playsRecordedSamples

    for (let copy = 0; copy < copies; copy += 1) {
      const offsetCents = copies === 1 ? 0 : (copy - 1) * detune
      const pan = copies === 1 ? 0 : (copy - 1) * 0.55
      const output = context.createGain()
      output.gain.value = (level / Math.sqrt(copies)) * (copy === 0 ? 1 : 0.9)
      const panner = context.createStereoPanner()
      panner.pan.value = pan
      const filter = context.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = Math.min(
        18000,
        toneCutoff(shiftedMidi, velocity) * model.brightness * (recorded ? 1.6 : 1),
      )
      filter.Q.value = 0.7
      filter.connect(output)
      output.connect(panner)
      panner.connect(this.voiceBus)
      // Sympathetic resonance is fed from the voice, before the layer's effects.
      output.connect(this.resonanceSend)
      nodes.push(output, panner, filter)
      outputs.push(output)

      if (recorded && this.library) {
        const choice = pickSample(this.library, shiftedMidi, touched)
        if (choice) {
          const source = context.createBufferSource()
          source.buffer = choice.sample.buffer
          source.playbackRate.value = choice.playbackRate * Math.pow(2, offsetCents / 1200)
          source.connect(filter)
          source.start(now)
          nodes.push(source)
          stoppables.push(source)
          continue
        }
      }

      const voiceId = synthVoiceFor(this.settings.type)
      const frequency = midiToFrequency(shiftedMidi) * Math.pow(2, offsetCents / 1200)
      for (const partial of partialsFor(shiftedMidi, velocity, voiceId)) {
        const oscillator = context.createOscillator()
        oscillator.type = partial.type
        oscillator.frequency.value = frequency * partial.ratio
        const partialGain = context.createGain()
        partialGain.gain.value = 0
        partialGain.gain.setValueAtTime(0, now)
        partialGain.gain.linearRampToValueAtTime(partial.gain, now + ATTACK_SECONDS)
        partialGain.gain.exponentialRampToValueAtTime(
          Math.max(1e-5, partial.gain * 0.001),
          now + ATTACK_SECONDS + partial.decay,
        )
        oscillator.connect(partialGain)
        partialGain.connect(filter)
        oscillator.start(now)
        nodes.push(oscillator, partialGain)
        stoppables.push(oscillator)
      }

      const hammer = context.createBufferSource()
      hammer.buffer = this.noiseBuffer
      const hammerGain = context.createGain()
      hammerGain.gain.value = 0
      hammerGain.gain.setValueAtTime(0.28 * velocity, now)
      hammerGain.gain.exponentialRampToValueAtTime(1e-4, now + TRANSIENT_SECONDS)
      hammer.connect(hammerGain)
      hammerGain.connect(filter)
      hammer.start(now)
      hammer.stop(now + 0.09)
      nodes.push(hammer, hammerGain)
      stoppables.push(hammer)
    }

    const softRelease = this.settings.softRelease && type.supportsSoftRelease
    const releaseSeconds = RELEASE_SECONDS * model.release * (softRelease ? SOFT_RELEASE_MULTIPLIER : 1)
    const sampleSeconds = recorded && this.library ? longestSampleSeconds(this.library) : 0
    const lifetimeSeconds = recorded
      ? sampleSeconds + 0.2
      : voiceLifetime(shiftedMidi, velocity, synthVoiceFor(this.settings.type)) + 0.2

    return { nodes, outputs, stoppables, releaseSeconds, lifetimeSeconds, recorded }
  }

  /** Pedal release is longer than a damper release, as it is on the instrument. */
  pedalReleaseSeconds(): number {
    const model = pianoModel(this.settings.type, this.settings.model)
    const softRelease = this.settings.softRelease && pianoType(this.settings.type).supportsSoftRelease
    return PEDAL_RELEASE_SECONDS * model.release * (softRelease ? SOFT_RELEASE_MULTIPLIER : 1)
  }

  dispose(): void {
    this.chain.dispose()
    for (const resonator of this.resonators) {
      resonator.delay.disconnect()
      resonator.feedback.disconnect()
    }
    for (const node of this.extraNodes) node.disconnect()
    this.resonanceSend.disconnect()
    this.voiceBus.disconnect()
    this.timbreA.disconnect()
    this.timbreB.disconnect()
    this.level.disconnect()
    this.dryOut.disconnect()
    this.rotaryOut.disconnect()
  }
}

function longestSampleSeconds(set: LoadedSet): number {
  let longest = 0
  for (const sample of set.samples) {
    longest = Math.max(longest, sample.buffer.length / sample.buffer.sampleRate)
  }
  return longest
}
