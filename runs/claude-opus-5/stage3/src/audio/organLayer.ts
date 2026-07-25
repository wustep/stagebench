import { midiToFrequency } from '../model/keyboard'
import { Ramped } from './effects'
import type { GraphBuffer, GraphContext, GraphGain, GraphNode, GraphOscillator } from './graph'
import { LayerChain, type LayerVoice } from './layer'
import {
  modelHasPercussion,
  organVoiceShape,
  percussionShape,
  vibChorusShape,
  type OrganModelId,
} from './organVoice'
import type { OrganLayerId, OrganLayerSettings, OrganSettings } from './settings'
import { ORGAN_LAYER_IDS } from './settings'

/**
 * The Organ section's audio.
 *
 *   layer A voices ─┐                                 ┌─ vibrato / chorus stage ─┐
 *                   ├─ per-layer level gain ─ routed ─┤                          ├─ shared chain
 *   layer B voices ─┘                                 └─ dry ────────────────────┘   (Mod 1 …
 *                                                                                     Reverb)
 *                                                     → organ output → organ bus or shared rotary
 *
 * Layers A and B have their own voices, level, octave shift and model, and share **one** effect
 * chain and one output — exactly what the organ spec's `layersShareOneEffectChain` requires. The
 * vibrato/chorus stage is shared too, but each B3 layer decides whether it is routed into it.
 */

const ORGAN_LIFETIME_SECONDS = 900

/** A sounding voice, kept so a drawbar move is heard on the note that is already ringing. */
interface LiveOrganVoice {
  readonly layer: OrganLayerId
  readonly frequency: number
  readonly gains: GraphGain[]
}

export class OrganSection {
  readonly chain: LayerChain
  readonly output: GraphGain
  readonly dryOut: GraphGain
  readonly rotaryOut: GraphGain
  private readonly voiceBuses: Record<OrganLayerId, GraphGain>
  private readonly levels: Record<OrganLayerId, GraphGain>
  private readonly levelRamps: Record<OrganLayerId, Ramped>
  private readonly vibSends: Record<OrganLayerId, GraphGain>
  private readonly drySends: Record<OrganLayerId, GraphGain>
  private readonly vibSendRamps: Record<OrganLayerId, Ramped>
  private readonly drySendRamps: Record<OrganLayerId, Ramped>
  private readonly vibDelay: ReturnType<GraphContext['createDelay']>
  private readonly vibLfo: GraphOscillator
  private readonly vibDepth: GraphGain
  private readonly vibWet: GraphGain
  private readonly vibDry: GraphGain
  private readonly vibRate: Ramped
  private readonly extras: GraphNode[] = []
  private readonly live = new Set<LiveOrganVoice>()
  private readonly dryRamp: Ramped
  private readonly rotaryRamp: Ramped
  private settings: OrganSettings

  constructor(
    private readonly context: GraphContext,
    private readonly noiseBuffer: GraphBuffer,
    initial: OrganSettings,
    effectsOn = true,
  ) {
    this.settings = initial
    this.chain = new LayerChain(context)
    this.output = context.createGain()
    this.dryOut = context.createGain()
    this.rotaryOut = context.createGain()

    const mix = context.createGain()
    this.vibDelay = context.createDelay(0.05)
    this.vibDelay.delayTime.value = 0.009
    this.vibLfo = context.createOscillator()
    this.vibLfo.type = 'sine'
    this.vibLfo.frequency.value = 6.1
    this.vibRate = new Ramped(this.vibLfo.frequency, 6.1)
    this.vibDepth = context.createGain()
    this.vibDepth.gain.value = 0.0016
    this.vibWet = context.createGain()
    this.vibWet.gain.value = 1
    this.vibDry = context.createGain()
    this.vibDry.gain.value = 0
    this.vibLfo.connect(this.vibDepth)
    this.vibDepth.connect(this.vibDelay.delayTime)
    this.vibLfo.start(0)

    this.voiceBuses = { a: context.createGain(), b: context.createGain() }
    this.levels = { a: context.createGain(), b: context.createGain() }
    this.vibSends = { a: context.createGain(), b: context.createGain() }
    this.drySends = { a: context.createGain(), b: context.createGain() }
    this.levelRamps = {
      a: new Ramped(this.levels.a.gain, initial.layers.a.enabled ? initial.layers.a.level : 0),
      b: new Ramped(this.levels.b.gain, initial.layers.b.enabled ? initial.layers.b.level : 0),
    }
    this.vibSendRamps = {
      a: new Ramped(this.vibSends.a.gain, 0),
      b: new Ramped(this.vibSends.b.gain, 0),
    }
    this.drySendRamps = {
      a: new Ramped(this.drySends.a.gain, 1),
      b: new Ramped(this.drySends.b.gain, 1),
    }

    for (const id of ORGAN_LAYER_IDS) {
      this.voiceBuses[id].connect(this.levels[id])
      this.levels[id].connect(this.vibSends[id])
      this.levels[id].connect(this.drySends[id])
      this.vibSends[id].connect(this.vibDelay)
      this.vibSends[id].connect(this.vibDry)
      this.drySends[id].connect(mix)
    }
    this.vibDelay.connect(this.vibWet)
    this.vibWet.connect(mix)
    this.vibDry.connect(mix)
    mix.connect(this.chain.input)
    this.chain.output.connect(this.output)
    this.output.connect(this.dryOut)
    this.output.connect(this.rotaryOut)
    this.dryRamp = new Ramped(this.dryOut.gain, initial.toRotary ? 0 : 1)
    this.rotaryRamp = new Ramped(this.rotaryOut.gain, initial.toRotary ? 1 : 0)

    this.extras.push(mix, this.vibDelay, this.vibLfo, this.vibDepth, this.vibWet, this.vibDry)
    this.chain.update(initial.chain, effectsOn)
    this.applyVibrato(initial)
  }

  get current(): OrganSettings {
    return this.settings
  }

  voiceBus(id: OrganLayerId): GraphGain {
    return this.voiceBuses[id]
  }

  update(next: OrganSettings, effectsOn: boolean): void {
    this.settings = next
    for (const id of ORGAN_LAYER_IDS) {
      const layer = next.layers[id]
      this.levelRamps[id].set(next.sectionOn && layer.enabled ? layer.level : 0, this.context)
    }
    this.chain.update(next.chain, effectsOn)
    this.applyVibrato(next)
    this.dryRamp.set(next.toRotary ? 0 : 1, this.context)
    this.rotaryRamp.set(next.toRotary ? 1 : 0, this.context)
    this.refreshDrawbars()
  }

  /**
   * Every sounding voice follows the drawbars: the oscillators already exist (one per drawbar the
   * model reads, silent ones included), so a drawbar move is a gain change on a ringing note,
   * exactly as it is on the instrument (organ spec, `drawbars.interaction`).
   */
  private refreshDrawbars(): void {
    for (const voice of this.live) {
      const layer = this.settings.layers[voice.layer]
      const shape = organVoiceShape(layer.model, layer.drawbars, voice.frequency)
      voice.gains.forEach((gain, index) => {
        const partial = shape.partials[index]
        if (partial) gain.gain.value = partial.gain
      })
    }
  }

  /**
   * Vibrato modulates pitch only; chorus mixes the modulated signal back with the original. Each
   * layer is routed into the stage or straight past it, which is the B3 per-layer on/off.
   */
  private applyVibrato(next: OrganSettings): void {
    const shape = vibChorusShape(next.vibChorus)
    this.vibDepth.gain.value = shape.depth
    this.vibRate.set(shape.rate, this.context, 0.08)
    this.vibWet.gain.value = 1
    this.vibDry.gain.value = shape.dryMix
    for (const id of ORGAN_LAYER_IDS) {
      const routed = next.layers[id].vibratoOn
      this.vibSendRamps[id].set(routed ? 1 : 0, this.context, 0.03)
      this.drySendRamps[id].set(routed ? 0 : 1, this.context, 0.03)
    }
  }

  /**
   * Builds one organ voice. `percussionAllowed` is false while another key is already down, which
   * is the B3's single-triggered percussion (manual p. 20).
   */
  buildVoice(
    id: OrganLayerId,
    midi: number,
    velocity: number,
    percussionAllowed: boolean,
    zone = 1,
  ): LayerVoice | null {
    const layer = this.settings.layers[id]
    if (!this.settings.sectionOn || !layer.enabled || zone <= 0) return null
    void velocity
    const context = this.context
    const now = context.currentTime
    const frequency = midiToFrequency(midi + layer.octave)
    const shape = organVoiceShape(layer.model, layer.drawbars, frequency)
    const nodes: GraphNode[] = []
    const stoppables: { stop(when: number): void }[] = []

    const output = context.createGain()
    // An organ has no velocity response: key contact is on or off (manual p. 18).
    output.gain.value = 0.9 * zone
    output.connect(this.voiceBuses[id])
    nodes.push(output)

    const envelope = context.createGain()
    envelope.gain.value = 0
    envelope.gain.setValueAtTime(0, now)
    envelope.gain.linearRampToValueAtTime(1, now + shape.attack)
    envelope.connect(output)
    nodes.push(envelope)

    const partialGains: GraphGain[] = []
    for (const partial of shape.partials) {
      const oscillator = context.createOscillator()
      oscillator.type = partial.type
      oscillator.frequency.value = frequency * partial.ratio * Math.pow(2, partial.detuneCents / 1200)
      const gain = context.createGain()
      gain.gain.value = partial.gain
      oscillator.connect(gain)
      gain.connect(envelope)
      oscillator.start(now)
      nodes.push(oscillator, gain)
      partialGains.push(gain)
      stoppables.push(oscillator)
    }
    const record: LiveOrganVoice = { layer: id, frequency, gains: partialGains }
    this.live.add(record)
    // A marker node in the voice's node list: the engine disconnects every node when it destroys
    // a voice, which is how this registry stays exactly as long as the voice does.
    nodes.push({
      connect: () => undefined,
      disconnect: () => {
        this.live.delete(record)
      },
    })

    // Tonewheel leakage: two quiet, slightly mistuned neighbours bleeding through the manual.
    if (shape.leakage > 0) {
      for (const [ratio, cents] of [
        [0.5, 7],
        [4, -6],
      ] as const) {
        const oscillator = context.createOscillator()
        oscillator.type = 'sine'
        oscillator.frequency.value = frequency * ratio * Math.pow(2, cents / 1200)
        const gain = context.createGain()
        gain.gain.value = shape.leakage
        oscillator.connect(gain)
        gain.connect(envelope)
        oscillator.start(now)
        nodes.push(oscillator, gain)
        stoppables.push(oscillator)
      }
    }

    if (shape.click > 0) {
      const { source, gain, filter } = this.transient(shape.click, 2400, 0.008, now)
      gain.connect(output)
      nodes.push(source, gain, filter)
      stoppables.push(source)
    }

    if (shape.chiff > 0) {
      const { source, gain, filter } = this.transient(shape.chiff, 3200, 0.05, now)
      gain.connect(output)
      nodes.push(source, gain, filter)
      stoppables.push(source)
    }

    const percussion = modelHasPercussion(layer.model) ? percussionShape(layer.percussion) : null
    if (percussion && percussionAllowed) {
      const oscillator = context.createOscillator()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency * percussion.ratio
      const gain = context.createGain()
      gain.gain.value = 0
      gain.gain.setValueAtTime(percussion.gain, now)
      gain.gain.exponentialRampToValueAtTime(1e-4, now + percussion.decay)
      oscillator.connect(gain)
      gain.connect(output)
      oscillator.start(now)
      oscillator.stop(now + percussion.decay + 0.05)
      nodes.push(oscillator, gain)
      stoppables.push(oscillator)
    }

    return {
      nodes,
      outputs: [output],
      stoppables,
      releaseSeconds: shape.release,
      lifetimeSeconds: ORGAN_LIFETIME_SECONDS,
      recorded: false,
    }
  }

  /** A short filtered noise burst: the B3 key click and the pipe chiff. */
  private transient(level: number, centre: number, decay: number, now: number) {
    const context = this.context
    const source = context.createBufferSource()
    source.buffer = this.noiseBuffer
    const filter = context.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = centre
    filter.Q.value = 1.1
    const gain = context.createGain()
    gain.gain.value = 0
    gain.gain.setValueAtTime(level, now)
    gain.gain.exponentialRampToValueAtTime(1e-4, now + decay)
    source.connect(filter)
    filter.connect(gain)
    source.start(now)
    source.stop(now + Math.min(0.09, decay + 0.02))
    return { source, gain, filter }
  }

  dispose(): void {
    this.live.clear()
    try {
      this.vibLfo.stop(this.context.currentTime)
    } catch {
      // already stopped
    }
    this.chain.dispose()
    for (const node of this.extras) node.disconnect()
    for (const id of ORGAN_LAYER_IDS) {
      this.voiceBuses[id].disconnect()
      this.levels[id].disconnect()
      this.vibSends[id].disconnect()
      this.drySends[id].disconnect()
    }
    this.output.disconnect()
    this.dryOut.disconnect()
    this.rotaryOut.disconnect()
  }
}

/** Convenience for tests and the UI: does this model read this drawbar at all? */
export function drawbarIsActive(model: OrganModelId, index: number): boolean {
  return model === 'b3bass' ? index === 0 || index === 2 : true
}

export type { OrganLayerSettings }
