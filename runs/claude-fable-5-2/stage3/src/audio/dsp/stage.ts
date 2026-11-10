import { FX_BLOCK, FxChain, RotaryPath, Rotor, TimbreEq } from './effects'
import { softLimit, type VoiceStateValue } from './kernel'
import { OrganVoices } from './organ'
import {
  CHAIN_COUNT,
  Chain,
  LAYER_COUNT,
  ORGAN_LAYER_COUNT,
  SYNTH_LAYER_COUNT,
  defaultSoundState,
  layerGain,
  masterGain,
  zoneGain,
  type SampleSet,
  type SampleSetId,
  type SoundState,
} from './params'
import { SynthVoices } from './synth'
import { LayerVoices } from './voices'

/**
 * The whole instrument as one block of arithmetic. Six buses, each with its own effect chain:
 *
 *   Piano A voices ─ timbre ─┐
 *   Piano B voices ─ timbre ─┤
 *   Organ A ─ level ─┐       │      (the two organ layers share one chain,
 *   Organ B ─ level ─┴───────┤       so their levels are applied before it)
 *   Synth A voices ──────────┤
 *   Synth B voices ──────────┤
 *   Synth C voices ──────────┘
 *        each:  ─ Mod 1 ─ Mod 2 ─ Delay ─ Amp/EQ ─ Comp ─ Reverb ─ [Rotary] ─ level ─┐
 *                                                                                     ▼
 *                                                 sum ─ master gain ─ soft limiter ─ out
 *
 * Every Rotary path turns with the one shared rotor. Keys reach a layer only inside its
 * keyboard zones, scaled across a split crossfade, and transposed. Nothing reaches the output
 * except through the master stage.
 *
 * Like the Phase 1 kernel it has no dependency on Web Audio, so the same code runs in the
 * AudioWorklet, in the ScriptProcessor fallback, and in the tests.
 */

export interface StageKernelOptions {
  sampleRate: number
}

export interface StageVoiceInfo {
  layer: number
  key: number
  note: number
  state: VoiceStateValue
  order: number
  velocity: number
  /** True for a recorded sample, false for synthesized partials. */
  sampled: boolean
}

/** Blocks of silence after which an idle bus's effect memory is cleared and the bus sleeps. */
const SLEEP_BLOCKS = 8
const QUIET = 1e-7

/** How much hotter than its bus level the organ drives the rotary's amplifier. */
const ORGAN_ROTARY_GAIN = 4

function scale(left: Float32Array, right: Float32Array, frames: number, gain: number): void {
  for (let i = 0; i < frames; i += 1) {
    left[i] *= gain
    right[i] *= gain
  }
}

/** One bus: an effect chain, a path through the shared rotor, and the level that follows them. */
class Bus {
  readonly chain: FxChain
  readonly rotary: RotaryPath
  gain = 0
  quiet = 0
  asleep = true

  constructor(sampleRate: number, rotor: Rotor) {
    this.chain = new FxChain(sampleRate)
    this.rotary = new RotaryPath(sampleRate, rotor)
  }

  flush(): void {
    this.chain.flush()
    this.rotary.hardReset()
  }
}

class LayerUnit extends Bus {
  readonly voices: LayerVoices
  readonly timbre: TimbreEq
  timbreOn = false

  constructor(sampleRate: number, rotor: Rotor) {
    super(sampleRate, rotor)
    this.voices = new LayerVoices(sampleRate)
    this.timbre = new TimbreEq(sampleRate)
  }

  override flush(): void {
    this.timbre.hardReset()
    super.flush()
  }
}

class OrganUnit extends Bus {
  readonly layers: OrganVoices[]
  /** Each layer's own level, applied before the shared chain. */
  readonly levels: number[]

  constructor(sampleRate: number, rotor: Rotor) {
    super(sampleRate, rotor)
    this.layers = Array.from({ length: ORGAN_LAYER_COUNT }, () => new OrganVoices(sampleRate))
    this.levels = this.layers.map(() => 0)
    this.gain = 1
  }
}

class SynthUnit extends Bus {
  readonly voices: SynthVoices

  constructor(sampleRate: number, rotor: Rotor) {
    super(sampleRate, rotor)
    this.voices = new SynthVoices(sampleRate)
  }
}

export class StageKernel {
  readonly sampleRate: number
  private readonly layers: LayerUnit[]
  private readonly organ: OrganUnit
  private readonly synths: SynthUnit[]
  /** Every bus, in chain order: Piano A, Piano B, Organ, Synth A, Synth B, Synth C. */
  private readonly buses: Bus[]
  private readonly rotor: Rotor
  private readonly sets = new Map<SampleSetId, SampleSet>()
  private sound: SoundState = defaultSoundState()
  private master: number
  private readonly busL = new Float32Array(FX_BLOCK)
  private readonly busR = new Float32Array(FX_BLOCK)
  private readonly mixL = new Float32Array(FX_BLOCK)
  private readonly mixR = new Float32Array(FX_BLOCK)
  /** Panic duck: output gain and the frames left before effect memory is cleared. */
  private duck = 1
  private duckFrames = 0

  constructor(options: StageKernelOptions) {
    this.sampleRate = options.sampleRate
    this.rotor = new Rotor(this.sampleRate)
    this.layers = Array.from({ length: LAYER_COUNT }, () => new LayerUnit(this.sampleRate, this.rotor))
    this.organ = new OrganUnit(this.sampleRate, this.rotor)
    this.synths = Array.from({ length: SYNTH_LAYER_COUNT }, () => new SynthUnit(this.sampleRate, this.rotor))
    this.buses = [...this.layers, this.organ, ...this.synths]
    this.master = masterGain(this.sound.master)
    this.setState(this.sound)
    this.layers.forEach((unit, index) => {
      unit.gain = layerGain(this.sound.layers[index].level)
    })
    this.organ.layers.forEach((_, index) => {
      this.organ.levels[index] = layerGain(this.sound.organ.layers[index].level)
    })
    this.synths.forEach((unit, index) => {
      unit.gain = layerGain(this.sound.synth.layers[index].level)
    })
  }

  // ── State ───────────────────────────────────────────────────────────────────

  setState(next: SoundState): void {
    const previous = this.sound
    this.sound = next
    const transpose = next.keyboard.transpose
    this.layers.forEach((unit, index) => {
      const layer = next.layers[index]
      const { voices } = unit
      voices.octave = layer.octave
      voices.transpose = transpose
      voices.kbTouch = layer.kbTouch
      voices.dynComp = layer.dynComp
      voices.unison = layer.unison
      voices.softRelease = layer.softRelease
      voices.stringRes = layer.stringRes
      voices.setSustainEnabled(layer.sustain)
      voices.setBend(layer.bend)
      // A layer (or the whole section) switched off lets go of its own notes, and only its own.
      if (previous.layers[index].on && !layer.on) voices.releaseAll()
      unit.timbreOn = unit.timbre.configure(layer.family, layer.timbre)
      unit.chain.configure(layer.fx)
      this.resolveSource(index)
    })

    const { organ, synth } = next
    this.organ.layers.forEach((voices, index) => {
      voices.transpose = transpose
      voices.setSustainEnabled(organ.sustain)
      voices.setBend(organ.bend)
      voices.configure(organ.layers[index], organ.vibType)
    })
    this.organ.chain.configure(organ.fx)

    const shared = { sustain: synth.sustain, bend: synth.bend, hold: synth.hold, wheel: synth.wheel, pedal: synth.pedal }
    this.synths.forEach((unit, index) => {
      unit.voices.transpose = transpose
      unit.voices.configure(synth.layers[index], shared)
      unit.chain.configure(synth.layers[index].fx)
    })

    this.rotor.configure(next.rotary.fast, next.rotary.stop, next.rotary.drive, next.rotary.speed)
  }

  getState(): SoundState {
    return this.sound
  }

  /** Install a decoded sample set, or remove one (null) so its layers fall back to synthesis. */
  loadSampleSet(id: SampleSetId, set: SampleSet | null): void {
    if (set) this.sets.set(id, set)
    else this.sets.delete(id)
    this.layers.forEach((_, index) => this.resolveSource(index))
  }

  hasSampleSet(id: SampleSetId): boolean {
    return this.sets.has(id)
  }

  private resolveSource(index: number): void {
    const { source } = this.sound.layers[index]
    const { voices } = this.layers[index]
    if (source.kind === 'samples') {
      // No recordings (still loading, or failed): the labelled fallback voice plays instead.
      voices.set = this.sets.get(source.set) ?? null
      voices.recipe = 'basic'
    } else {
      voices.set = null
      voices.recipe = source.recipe
    }
  }

  /** What layer `index` would play for a new note right now. */
  layerSource(index: number): 'samples' | 'synthesis' | 'fallback' {
    const { source } = this.sound.layers[index]
    if (source.kind === 'partials') return 'synthesis'
    return this.sets.has(source.set) ? 'samples' : 'fallback'
  }

  /** True when the bus's layer is routed into the Rotary. The Organ also has its own Rotary button. */
  private routed(index: number): boolean {
    const bus = this.buses[index]
    if (index === Chain.Organ && this.sound.organ.toRotary) return true
    return bus.chain.routesToRotary(this.sound.fxOn)
  }

  /** A bus waking from silence takes up its settings at once: there is nothing to click. */
  private wake(index: number, level: number): void {
    const bus = this.buses[index]
    if (!bus.asleep) return
    bus.gain = level
    bus.chain.snap(this.sound.fxOn)
    bus.rotary.snap(this.routed(index))
    bus.asleep = false
  }

  // ── Notes ───────────────────────────────────────────────────────────────────

  /** `note` is the key that was pressed; zones are decided on the key, transpose is added after. */
  noteOn(note: number, velocity: number): void {
    if (!(velocity > 0)) {
      this.noteOff(note)
      return
    }
    const { sound } = this
    const { points } = sound.keyboard
    // A note played while a panic is still clearing the effects ends the clearing at once.
    if (this.duckFrames > 0) {
      this.duckFrames = 0
      for (const bus of this.buses) bus.flush()
    }
    // From complete silence the master starts at the knob's position; only sound in progress ramps.
    if (this.buses.every((bus) => bus.asleep)) this.master = masterGain(sound.master)

    this.layers.forEach((unit, index) => {
      const layer = sound.layers[index]
      if (!layer.on) return
      const scale = zoneGain(points, layer.zone, note)
      if (!(scale > 0)) return
      // A layer waking from silence starts at its fader's level; only a sounding layer ramps.
      if (unit.asleep) unit.timbre.snap(unit.timbreOn)
      this.wake(index, layerGain(layer.level))
      unit.voices.noteOn(note, velocity, scale)
    })

    this.organ.layers.forEach((voices, index) => {
      const layer = sound.organ.layers[index]
      if (!layer.on) return
      const scale = zoneGain(points, layer.zone, note)
      if (!(scale > 0)) return
      if (this.organ.asleep) {
        this.organ.layers.forEach((_, each) => {
          this.organ.levels[each] = layerGain(sound.organ.layers[each].level)
        })
      }
      this.wake(Chain.Organ, 1)
      voices.noteOn(note, scale)
    })

    this.synths.forEach((unit, index) => {
      const layer = sound.synth.layers[index]
      if (!layer.on) return
      const scale = zoneGain(points, layer.zone, note)
      if (!(scale > 0)) return
      this.wake(Chain.SynthA + index, layerGain(layer.level))
      unit.voices.noteOn(note, velocity, scale)
    })
  }

  noteOff(note: number): void {
    for (const unit of this.layers) unit.voices.noteOff(note)
    for (const voices of this.organ.layers) voices.noteOff(note)
    for (const unit of this.synths) unit.voices.noteOff(note)
  }

  setSustain(down: boolean): void {
    for (const unit of this.layers) unit.voices.setPedal(down)
    for (const voices of this.organ.layers) voices.setPedal(down)
    for (const unit of this.synths) unit.voices.setPedal(down)
  }

  get sustainDown(): boolean {
    return this.layers.some((unit) => unit.voices.pedalActive)
  }

  /** Panic: pedal up, every voice fades within tens of milliseconds, every effect tail is dropped. */
  allNotesOff(): void {
    let tails = false
    for (const unit of this.layers) {
      unit.voices.allNotesOff()
      if (!unit.asleep && unit.timbre.engaged) tails = true
    }
    for (const voices of this.organ.layers) voices.allNotesOff()
    for (const unit of this.synths) unit.voices.allNotesOff()
    for (const bus of this.buses) {
      if (!bus.asleep && (bus.chain.engaged || bus.rotary.engaged)) tails = true
    }
    // The output is held down until the voices have finished fading, then every effect is cleared,
    // so nothing that was still dying away can start a new tail.
    if (tails) this.duckFrames = Math.round(0.2 * this.sampleRate)
  }

  // ── Inspection ──────────────────────────────────────────────────────────────

  /** Everything that still produces signal: piano and synth voices, and organ keys. */
  get voiceCount(): number {
    let count = 0
    for (const unit of this.layers) count += unit.voices.voiceCount
    for (const voices of this.organ.layers) count += voices.keyCount
    for (const unit of this.synths) count += unit.voices.voiceCount
    return count
  }

  soundingCount(): number {
    let count = 0
    for (const unit of this.layers) count += unit.voices.soundingCount()
    return count
  }

  get resonanceCount(): number {
    let count = 0
    for (const unit of this.layers) count += unit.voices.resonanceCount
    return count
  }

  /** Voices of Piano layer `index`. */
  layerVoiceCount(index: number): number {
    return this.layers[index].voices.voiceCount
  }

  /** Piano voices. */
  describeVoices(): StageVoiceInfo[] {
    return this.layers.flatMap((unit, layer) => unit.voices.describe().map((voice) => ({ layer, ...voice })))
  }

  /** The engine of Organ layer `index` (0 = A, 1 = B). */
  organLayer(index: number): OrganVoices {
    return this.organ.layers[index]
  }

  /** The engine of Synth layer `index` (0 = A, 1 = B, 2 = C). */
  synthLayer(index: number): SynthVoices {
    return this.synths[index].voices
  }

  /** True while chain `index`'s compressor is turning the signal down by more than 1 dB. */
  compressorActive(index: number): boolean {
    const { chain } = this.buses[index]
    return chain.comp.engaged && chain.comp.active
  }

  /** True when bus `index` is asleep: no voices, no tails, effect memory cleared. */
  layerAsleep(index: number): boolean {
    return this.buses[index].asleep
  }

  /** Number of buses (effect chains). */
  get busCount(): number {
    return this.buses.length
  }

  get rotorSpeed(): { horn: number; drum: number } {
    return { horn: this.rotor.hornSpeed, drum: this.rotor.drumSpeed }
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  /** Render one block, overwriting both channels. */
  process(left: Float32Array, right: Float32Array, frames: number = left.length): void {
    for (let offset = 0; offset < frames; offset += FX_BLOCK) {
      this.processBlock(left, right, offset, Math.min(FX_BLOCK, frames - offset))
    }
  }

  /** Effects, Rotary, level, and the sum into the mix for one bus whose source is already in busL/busR. */
  private finish(index: number, frames: number, target: number, busy: boolean): void {
    const { busL, busR, mixL, mixR, sound } = this
    const bus = this.buses[index]
    bus.chain.process(busL, busR, frames, sound.fxOn)
    // Reverb has already run: the Rotary is the last effect a routed layer passes through.
    const routed = this.routed(index)
    // The organ reaches the rotary's amplifier hotter than the other sections, so that Drive
    // overdrives it the way it does on the instrument; the level is given back afterwards.
    const hot = index === Chain.Organ && (routed || bus.rotary.engaged)
    if (hot) scale(busL, busR, frames, ORGAN_ROTARY_GAIN)
    bus.rotary.process(busL, busR, frames, routed)
    if (hot) scale(busL, busR, frames, 1 / ORGAN_ROTARY_GAIN)

    // Layer level, ramped across the block so fader moves never click.
    const step = (target - bus.gain) / frames
    let gain = bus.gain
    let peak = 0
    for (let i = 0; i < frames; i += 1) {
      gain += step
      const l = busL[i]
      const r = busR[i]
      if (l > peak) peak = l
      else if (-l > peak) peak = -l
      if (r > peak) peak = r
      else if (-r > peak) peak = -r
      mixL[i] += l * gain
      mixR[i] += r * gain
    }
    bus.gain = target

    if (busy || peak >= QUIET) {
      bus.quiet = 0
    } else {
      bus.quiet += 1
      if (bus.quiet >= SLEEP_BLOCKS) {
        bus.flush()
        bus.asleep = true
        bus.quiet = 0
      }
    }
  }

  private processBlock(left: Float32Array, right: Float32Array, offset: number, frames: number): void {
    const { busL, busR, mixL, mixR, sound } = this
    this.rotor.advance(frames)
    mixL.fill(0, 0, frames)
    mixR.fill(0, 0, frames)

    for (let index = 0; index < this.layers.length; index += 1) {
      const unit = this.layers[index]
      const target = layerGain(sound.layers[index].level)
      const busy = unit.voices.busy
      if (busy) unit.asleep = false
      if (unit.asleep) {
        unit.gain = target
        continue
      }
      busL.fill(0, 0, frames)
      busR.fill(0, 0, frames)
      unit.voices.render(busL, busR, frames)
      unit.timbre.process(busL, busR, frames, unit.timbreOn)
      this.finish(index, frames, target, busy)
    }

    {
      const unit = this.organ
      const busy = unit.layers.some((voices) => voices.busy)
      if (busy) unit.asleep = false
      if (unit.asleep) {
        unit.layers.forEach((_, index) => {
          unit.levels[index] = layerGain(sound.organ.layers[index].level)
        })
      } else {
        busL.fill(0, 0, frames)
        busR.fill(0, 0, frames)
        unit.layers.forEach((voices, index) => {
          const target = layerGain(sound.organ.layers[index].level)
          if (voices.busy) voices.render(busL, busR, frames, unit.levels[index], target)
          unit.levels[index] = target
        })
        this.finish(Chain.Organ, frames, 1, busy)
      }
    }

    for (let index = 0; index < this.synths.length; index += 1) {
      const unit = this.synths[index]
      const target = layerGain(sound.synth.layers[index].level)
      const busy = unit.voices.busy
      if (busy) unit.asleep = false
      if (unit.asleep) {
        unit.gain = target
        continue
      }
      busL.fill(0, 0, frames)
      busR.fill(0, 0, frames)
      unit.voices.render(busL, busR, frames)
      this.finish(Chain.SynthA + index, frames, target, busy)
    }

    // Master gain and limiter: the only way out.
    const masterTarget = masterGain(sound.master)
    const masterStep = (masterTarget - this.master) / frames
    let master = this.master
    let duck = this.duck
    const duckTarget = this.duckFrames > 0 ? 0 : 1
    const duckStep = (duckTarget > duck ? 1 : -1) / (0.008 * this.sampleRate)
    for (let i = 0; i < frames; i += 1) {
      master += masterStep
      if (duck !== duckTarget) duck = Math.min(1, Math.max(0, duck + duckStep))
      const gain = master * duck
      left[offset + i] = softLimit(mixL[i] * gain)
      right[offset + i] = softLimit(mixR[i] * gain)
    }
    this.master = masterTarget
    this.duck = duck
    if (this.duckFrames > 0) {
      this.duckFrames -= frames
      if (this.duckFrames <= 0) {
        this.duckFrames = 0
        for (const bus of this.buses) bus.flush()
      }
    }
  }
}

export { CHAIN_COUNT }
