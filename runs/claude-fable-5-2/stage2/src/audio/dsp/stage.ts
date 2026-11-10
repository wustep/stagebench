import { FX_BLOCK, FxChain, RotaryPath, Rotor, TimbreEq } from './effects'
import { softLimit, type VoiceStateValue } from './kernel'
import {
  LAYER_COUNT,
  defaultSoundState,
  layerGain,
  masterGain,
  type SampleSet,
  type SampleSetId,
  type SoundState,
} from './params'
import { LayerVoices } from './voices'

/**
 * The whole instrument as one block of arithmetic:
 *
 *   layer A voices ─ timbre ─ Mod 1 ─ Mod 2 ─ Delay ─ Amp/EQ ─ Comp ─ Reverb ─ [Rotary] ─ level ─┐
 *   layer B voices ─ timbre ─ Mod 1 ─ Mod 2 ─ Delay ─ Amp/EQ ─ Comp ─ Reverb ─ [Rotary] ─ level ─┤
 *                                                                                                 ▼
 *                                                             sum ─ master gain ─ soft limiter ─ out
 *
 * Each layer has its own bus, its own voices, and its own effect chain. The two Rotary paths
 * turn with one shared rotor. Nothing reaches the output except through the master stage.
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

/** Blocks of silence after which an idle layer's effect memory is cleared and the layer sleeps. */
const SLEEP_BLOCKS = 8
const QUIET = 1e-7

class LayerUnit {
  readonly voices: LayerVoices
  readonly timbre: TimbreEq
  readonly chain: FxChain
  readonly rotary: RotaryPath
  timbreOn = false
  gain = 0
  quiet = 0
  asleep = true

  constructor(sampleRate: number, rotor: Rotor) {
    this.voices = new LayerVoices(sampleRate)
    this.timbre = new TimbreEq(sampleRate)
    this.chain = new FxChain(sampleRate)
    this.rotary = new RotaryPath(sampleRate, rotor)
  }

  flush(): void {
    this.timbre.hardReset()
    this.chain.flush()
    this.rotary.hardReset()
  }
}

export class StageKernel {
  readonly sampleRate: number
  private readonly layers: LayerUnit[]
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
    this.master = masterGain(this.sound.master)
    this.setState(this.sound)
    this.layers.forEach((unit, index) => {
      unit.gain = layerGain(this.sound.layers[index].level)
    })
  }

  // ── State ───────────────────────────────────────────────────────────────────

  setState(next: SoundState): void {
    const previous = this.sound
    this.sound = next
    this.layers.forEach((unit, index) => {
      const layer = next.layers[index]
      const { voices } = unit
      voices.octave = layer.octave
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
    this.rotor.configure(next.rotary.fast, next.rotary.stop, next.rotary.drive)
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

  // ── Notes ───────────────────────────────────────────────────────────────────

  noteOn(note: number, velocity: number): void {
    if (!(velocity > 0)) {
      this.noteOff(note)
      return
    }
    // A note played while a panic is still clearing the effects ends the clearing at once.
    if (this.duckFrames > 0) {
      this.duckFrames = 0
      for (const unit of this.layers) unit.flush()
    }
    // From complete silence the master starts at the knob's position; only sound in progress ramps.
    if (this.layers.every((unit) => unit.asleep)) this.master = masterGain(this.sound.master)
    this.layers.forEach((unit, index) => {
      if (!this.sound.layers[index].on) return
      // A layer waking from silence starts at its fader's level; only a sounding layer ramps.
      if (unit.asleep) {
        unit.gain = layerGain(this.sound.layers[index].level)
        unit.timbre.snap(unit.timbreOn)
        unit.chain.snap(this.sound.fxOn)
        unit.rotary.snap(unit.chain.routesToRotary(this.sound.fxOn))
      }
      unit.asleep = false
      unit.voices.noteOn(note, velocity)
    })
  }

  noteOff(note: number): void {
    for (const unit of this.layers) unit.voices.noteOff(note)
  }

  setSustain(down: boolean): void {
    for (const unit of this.layers) unit.voices.setPedal(down)
  }

  get sustainDown(): boolean {
    return this.layers.some((unit) => unit.voices.pedalActive)
  }

  /** Panic: pedal up, every voice fades within tens of milliseconds, every effect tail is dropped. */
  allNotesOff(): void {
    let tails = false
    for (const unit of this.layers) {
      unit.voices.allNotesOff()
      if (!unit.asleep && (unit.chain.engaged || unit.rotary.engaged || unit.timbre.engaged)) tails = true
    }
    // The output is held down until the voices have finished fading, then every effect is cleared,
    // so nothing that was still dying away can start a new tail.
    if (tails) this.duckFrames = Math.round(0.2 * this.sampleRate)
  }

  // ── Inspection ──────────────────────────────────────────────────────────────

  /** Every voice that still produces signal, across both layers. */
  get voiceCount(): number {
    let count = 0
    for (const unit of this.layers) count += unit.voices.voiceCount
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

  layerVoiceCount(index: number): number {
    return this.layers[index].voices.voiceCount
  }

  describeVoices(): StageVoiceInfo[] {
    return this.layers.flatMap((unit, layer) => unit.voices.describe().map((voice) => ({ layer, ...voice })))
  }

  /** True while layer `index`'s compressor is turning the signal down by more than 1 dB. */
  compressorActive(index: number): boolean {
    const { chain } = this.layers[index]
    return chain.comp.engaged && chain.comp.active
  }

  /** True when layer `index` is asleep: no voices, no tails, effect memory cleared. */
  layerAsleep(index: number): boolean {
    return this.layers[index].asleep
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
      unit.chain.process(busL, busR, frames, sound.fxOn)
      // Reverb has already run: the Rotary is the last effect a routed layer passes through.
      unit.rotary.process(busL, busR, frames, unit.chain.routesToRotary(sound.fxOn))

      // Layer level, ramped across the block so fader moves never click.
      const step = (target - unit.gain) / frames
      let gain = unit.gain
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
      unit.gain = target

      if (busy || peak >= QUIET) {
        unit.quiet = 0
      } else {
        unit.quiet += 1
        if (unit.quiet >= SLEEP_BLOCKS) {
          unit.flush()
          unit.asleep = true
          unit.quiet = 0
        }
      }
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
        for (const unit of this.layers) unit.flush()
      }
    }
  }
}
