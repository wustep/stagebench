import { midiToFrequency } from '../model/keyboard'
import { Ramped, driveCurve } from './effects'
import type { GraphContext, GraphGain, GraphNode, GraphParam } from './graph'
import { LayerChain, type LayerVoice } from './layer'
import type { SynthLayerId, SynthLayerSettings } from './settings'
import {
  TABLE_BASE_HZ,
  attackSeconds,
  decaySeconds,
  driveAmount,
  fillNoise,
  fillSampleHold,
  fillSyncTable,
  filterHz,
  filterStages,
  glideSecondsPerOctave,
  isSustainDecay,
  lfoHz,
  lfoOscillatorType,
  lfoPolarity,
  oscCtrlValue,
  pulseCurve,
  releaseSeconds,
  resonanceQ,
  syncedHz,
  trackedCutoff,
  unisonSpreadCents,
  unisonVoices,
  waveformName,
} from './synthVoice'

/**
 * One synth layer: its own oscillator stack per voice, its own filter and envelopes, its own LFO
 * and vibrato, and — as the synth spec's `independentEffectsPerLayer` requires — its own full
 * `LayerChain`. It hangs off the same context, the same buses and the same master path as the
 * piano and organ.
 *
 *   voices → layer voice bus → Mod 1 … Reverb → level → synth bus (or the shared Rotary)
 */

export interface SynthVoice extends LayerVoice {
  /** Retune a sounding voice, used by mono/legato and by glide. */
  retune(midi: number, glideSeconds: number): void
  readonly midi: number
}

const MAX_TABLE_FRAMES = 4096

/** A sounding voice, kept so the filter knobs move the note that is already ringing. */
interface LiveSynthVoice {
  readonly midi: number
  readonly cutoffs: GraphParam[]
  readonly resonances: GraphParam[]
}

export class SynthLayer {
  readonly voiceBus: GraphGain
  readonly chain: LayerChain
  readonly level: GraphGain
  readonly dryOut: GraphGain
  readonly rotaryOut: GraphGain
  private readonly levelRamp: Ramped
  private readonly dryRamp: Ramped
  private readonly rotaryRamp: Ramped
  private readonly lfo: ReturnType<GraphContext['createOscillator']>
  private readonly lfoOut: GraphGain
  private readonly lfoRate: Ramped
  private readonly shSource: ReturnType<GraphContext['createBufferSource']>
  private readonly shOut: GraphGain
  private readonly vibratoLfo: ReturnType<GraphContext['createOscillator']>
  private readonly vibratoOut: GraphGain
  private readonly noiseBuffer: ReturnType<GraphContext['createBuffer']>
  private readonly tableCache = new Map<string, ReturnType<GraphContext['createBuffer']>>()
  private readonly extras: GraphNode[] = []
  private readonly live = new Set<LiveSynthVoice>()
  private settings: SynthLayerSettings
  private clockBpm = 120

  constructor(
    readonly id: SynthLayerId,
    private readonly context: GraphContext,
    initial: SynthLayerSettings,
    effectsOn = true,
  ) {
    this.settings = initial
    this.voiceBus = context.createGain()
    this.chain = new LayerChain(context)
    this.level = context.createGain()
    this.dryOut = context.createGain()
    this.rotaryOut = context.createGain()
    this.voiceBus.connect(this.chain.input)
    this.chain.output.connect(this.level)
    this.level.connect(this.dryOut)
    this.level.connect(this.rotaryOut)
    this.levelRamp = new Ramped(this.level.gain, initial.enabled ? initial.level : 0)
    this.dryRamp = new Ramped(this.dryOut.gain, 1)
    this.rotaryRamp = new Ramped(this.rotaryOut.gain, 0)

    // One free-running LFO per layer, plus a stepped buffer for Sample & Hold and a separate
    // vibrato LFO. They run whether or not a destination is selected, exactly as the spec's
    // "off but keeps its settings" state describes.
    this.lfo = context.createOscillator()
    this.lfo.type = 'triangle'
    this.lfo.frequency.value = lfoHz(initial.lfo.rate)
    this.lfoRate = new Ramped(this.lfo.frequency, lfoHz(initial.lfo.rate))
    this.lfoOut = context.createGain()
    this.lfoOut.gain.value = 1
    this.lfo.connect(this.lfoOut)
    this.lfo.start(0)

    const shFrames = Math.max(64, Math.floor(context.sampleRate))
    const shBuffer = context.createBuffer(1, shFrames, context.sampleRate)
    fillSampleHold(shBuffer.getChannelData(0), 8, context.sampleRate)
    this.shSource = context.createBufferSource()
    this.shSource.buffer = shBuffer
    this.shSource.loop = true
    this.shOut = context.createGain()
    this.shOut.gain.value = 0
    this.shSource.connect(this.shOut)
    this.shSource.start(0)

    this.vibratoLfo = context.createOscillator()
    this.vibratoLfo.type = 'sine'
    this.vibratoLfo.frequency.value = initial.voice.vibrato.rate
    this.vibratoOut = context.createGain()
    this.vibratoOut.gain.value = 1
    this.vibratoLfo.connect(this.vibratoOut)
    this.vibratoLfo.start(0)

    const noiseFrames = Math.max(256, Math.floor(context.sampleRate * 0.5))
    this.noiseBuffer = context.createBuffer(1, noiseFrames, context.sampleRate)
    fillNoise(this.noiseBuffer.getChannelData(0))

    this.extras.push(this.lfo, this.lfoOut, this.shSource, this.shOut, this.vibratoLfo, this.vibratoOut)
    this.chain.update(initial.chain, effectsOn)
    this.applyRouting(initial, effectsOn)
    this.applyLfo(initial)
  }

  get current(): SynthLayerSettings {
    return this.settings
  }

  update(next: SynthLayerSettings, effectsOn: boolean, sectionOn: boolean, bpm: number): void {
    this.settings = next
    this.clockBpm = bpm
    const audible = sectionOn && next.enabled && next.mode === 'analog'
    this.levelRamp.set(audible ? next.level : 0, this.context)
    this.chain.update(next.chain, effectsOn)
    this.applyRouting(next, effectsOn)
    this.applyLfo(next)
    this.refreshFilters()
  }

  /**
   * Filter Freq and Res reach the notes that are already sounding, not only the next one. The
   * envelope has already fired by then, so its automation is cancelled before the new value is
   * set rather than fighting it.
   */
  private refreshFilters(): void {
    if (this.live.size === 0) return
    const settings = this.settings
    const now = this.context.currentTime
    const nyquist = this.context.sampleRate * 0.45
    for (const voice of this.live) {
      const cutoff = Math.min(
        nyquist,
        trackedCutoff(filterHz(settings.filter.freq), voice.midi + settings.octave, settings.filter.tracking),
      )
      for (const param of voice.cutoffs) {
        param.cancelScheduledValues(now)
        param.setValueAtTime(cutoff, now)
      }
      for (const param of voice.resonances) param.value = resonanceQ(settings.filter.res)
    }
  }

  private applyRouting(settings: SynthLayerSettings, effectsOn: boolean): void {
    const toRotary = effectsOn && settings.chain.amp.on && settings.chain.amp.type === 'rotary'
    this.dryRamp.set(toRotary ? 0 : 1, this.context)
    this.rotaryRamp.set(toRotary ? 1 : 0, this.context)
  }

  private applyLfo(settings: SynthLayerSettings): void {
    const rate = settings.lfo.clockSync ? syncedHz(this.clockBpm, settings.lfo.rate) : lfoHz(settings.lfo.rate)
    this.lfoRate.set(rate, this.context, 0.05)
    const sampleHold = settings.lfo.waveform === 'sh'
    this.lfo.type = lfoOscillatorType(settings.lfo.waveform)
    this.lfoOut.gain.value = sampleHold ? 0 : lfoPolarity(settings.lfo.waveform)
    this.shOut.gain.value = sampleHold ? 1 : 0
    this.vibratoLfo.frequency.value = settings.voice.vibrato.rate
    this.vibratoOut.gain.value = settings.voice.vibrato.amount
  }

  /** The layer's LFO output, already carrying waveform and polarity. */
  private lfoNode(): GraphNode {
    return this.settings.lfo.waveform === 'sh' ? this.shOut : this.lfoOut
  }

  private table(kind: 'saw' | 'square', ratio: number) {
    const quantised = Math.round(ratio * 8) / 8
    const key = `${kind}:${quantised}`
    const cached = this.tableCache.get(key)
    if (cached) return cached
    const frames = Math.min(MAX_TABLE_FRAMES, Math.max(32, Math.round(this.context.sampleRate / TABLE_BASE_HZ)))
    const buffer = this.context.createBuffer(1, frames, this.context.sampleRate)
    fillSyncTable(buffer.getChannelData(0), kind, quantised)
    this.tableCache.set(key, buffer)
    return buffer
  }

  /**
   * Builds one synth voice. Returns null when the layer cannot sound — including the two synth
   * modes this benchmark does not implement, which mute rather than pretend (synth spec,
   * `scope.excluded`: Extern; `scope.optional`: Samples).
   */
  buildVoice(midi: number, velocity: number, zone = 1): SynthVoice | null {
    const settings = this.settings
    if (!settings.enabled || settings.mode !== 'analog' || zone <= 0) return null
    const context = this.context
    const now = context.currentTime
    const shifted = midi + settings.octave
    const frequency = midiToFrequency(shifted)
    const nodes: GraphNode[] = []
    const stoppables: { stop(when: number): void }[] = []
    const pitchParams: GraphParam[] = []
    const pitchBases: number[] = []

    /* ---------------- amplifier envelope */

    const amp = context.createGain()
    const velocityLevels = [1, 0.72, 0.5, 0.3]
    const velocityFloor = velocityLevels[Math.min(3, Math.max(0, settings.amp.velocity))]
    const peak = 0.28 * (velocityFloor + (1 - velocityFloor) * velocity) * zone
    const ampAttack = attackSeconds(settings.amp.attack)
    amp.gain.value = 0
    amp.gain.setValueAtTime(0, now)
    amp.gain.linearRampToValueAtTime(peak, now + ampAttack)
    if (!isSustainDecay(settings.amp.decay)) {
      amp.gain.exponentialRampToValueAtTime(
        Math.max(1e-5, peak * 0.0008),
        now + ampAttack + decaySeconds(settings.amp.decay),
      )
    }
    amp.connect(this.voiceBus)
    nodes.push(amp)

    /* ---------------- filter */

    let filterInput: GraphNode = amp
    const filterFreqParams: GraphParam[] = []
    const filterQParams: GraphParam[] = []
    let cutoff = 0
    if (settings.filter.on) {
      const nyquist = context.sampleRate * 0.45
      cutoff = Math.min(nyquist, trackedCutoff(filterHz(settings.filter.freq), shifted, settings.filter.tracking))
      const stages = filterStages(settings.filter.type)
      let head: GraphNode | null = null
      let tail: GraphNode | null = null
      for (const stage of stages) {
        const biquad = context.createBiquadFilter()
        biquad.type = stage.type
        biquad.frequency.value = cutoff
        biquad.Q.value = stage.role === 'main' ? resonanceQ(settings.filter.res) : 0.7
        if (stage.role === 'main') filterQParams.push(biquad.Q)
        if (settings.filter.type === 'lphp' && stage.role === 'extra') {
          biquad.frequency.value = Math.min(nyquist, 40 + settings.filter.res * 3000)
        } else {
          filterFreqParams.push(biquad.frequency)
        }
        nodes.push(biquad)
        if (!head) head = biquad
        if (tail) tail.connect(biquad)
        tail = biquad
      }
      if (head && tail) {
        tail.connect(amp)
        filterInput = head
      }

      // Filter envelope: cutoff sweeps by Env Amt over the filter envelope's own times.
      if (filterFreqParams.length > 0 && settings.filter.envAmount > 0.001) {
        const envVelocity = settings.filter.env.velocity ? velocity : 1
        const top = Math.min(nyquist, cutoff * (1 + settings.filter.envAmount * 12 * envVelocity))
        const attack = attackSeconds(settings.filter.env.attack)
        const decay = decaySeconds(settings.filter.env.decay)
        for (const param of filterFreqParams) {
          param.cancelScheduledValues(now)
          param.setValueAtTime(cutoff, now)
          param.linearRampToValueAtTime(top, now + Math.max(0.001, attack))
          if (!isSustainDecay(settings.filter.env.decay)) {
            param.exponentialRampToValueAtTime(Math.max(20, cutoff), now + Math.max(0.001, attack) + decay)
          }
        }
      }
    }

    /* ---------------- filter drive */

    let sourceTarget: GraphNode = filterInput
    if (settings.filter.drive > 0) {
      const shaper = context.createWaveShaper()
      shaper.curve = driveCurve(1 + driveAmount(settings.filter.drive))
      const trim = context.createGain()
      trim.gain.value = 1 / (1 + driveAmount(settings.filter.drive) * 0.22)
      shaper.connect(trim)
      trim.connect(filterInput)
      nodes.push(shaper, trim)
      sourceTarget = shaper
    }

    /* ---------------- oscillator stack */

    const copies = unisonVoices(settings.voice.unison)
    const spread = unisonSpreadCents(settings.voice.unison)
    const ctrl = oscCtrlValue(settings.category, settings.oscCtrl)
    const name = waveformName(settings.category, settings.waveform)
    const fmGains: GraphParam[] = []
    const rateParams: GraphParam[] = []

    for (let copy = 0; copy < copies; copy += 1) {
      const offset = copies === 1 ? 0 : (copy - (copies - 1) / 2) * spread
      const copyGain = context.createGain()
      copyGain.gain.value = 1 / Math.sqrt(copies)
      copyGain.connect(sourceTarget)
      const panner = context.createStereoPanner()
      panner.pan.value = copies === 1 ? 0 : (copy - (copies - 1) / 2) * (1.4 / copies)
      copyGain.connect(panner)
      nodes.push(copyGain, panner)
      const target = copyGain
      const baseFrequency = frequency * Math.pow(2, offset / 1200)

      const simple = (type: string, ratio = 1, gain = 1) => {
        const oscillator = context.createOscillator()
        oscillator.type = type
        oscillator.frequency.value = baseFrequency * ratio
        const level = context.createGain()
        level.gain.value = gain
        oscillator.connect(level)
        level.connect(target)
        oscillator.start(now)
        nodes.push(oscillator, level)
        stoppables.push(oscillator)
        pitchParams.push(oscillator.frequency)
        pitchBases.push(baseFrequency * ratio)
        return oscillator
      }

      switch (settings.category) {
        case 'pure': {
          if (name === 'Sine') simple('sine')
          else if (name === 'Triangle') simple('triangle')
          else if (name === 'Saw') simple('sawtooth')
          else if (name === 'Square') simple('square')
          else if (name === 'Pulse 33' || name === 'Pulse 10') {
            const shaper = context.createWaveShaper()
            shaper.curve = pulseCurve(name === 'Pulse 33' ? 0.33 : 0.1)
            const oscillator = context.createOscillator()
            oscillator.type = 'sawtooth'
            oscillator.frequency.value = baseFrequency
            const level = context.createGain()
            level.gain.value = 0.7
            oscillator.connect(shaper)
            shaper.connect(level)
            level.connect(target)
            oscillator.start(now)
            nodes.push(oscillator, shaper, level)
            stoppables.push(oscillator)
            pitchParams.push(oscillator.frequency)
            pitchBases.push(baseFrequency)
          } else {
            const source = context.createBufferSource()
            source.buffer = this.noiseBuffer
            source.loop = true
            const level = context.createGain()
            level.gain.value = 0.5
            source.connect(level)
            level.connect(target)
            source.start(now)
            nodes.push(source, level)
            stoppables.push(source)
          }
          break
        }
        case 'sync': {
          const source = context.createBufferSource()
          source.buffer = this.table(name === 'Sync Saw' ? 'saw' : 'square', ctrl)
          source.loop = true
          source.playbackRate.value = baseFrequency / TABLE_BASE_HZ
          const level = context.createGain()
          level.gain.value = 0.6
          source.connect(level)
          level.connect(target)
          source.start(now)
          nodes.push(source, level)
          stoppables.push(source)
          rateParams.push(source.playbackRate)
          break
        }
        case 'multi': {
          const octaveUp = name === 'Multi Saw 8ve'
          simple('sawtooth', Math.pow(2, -ctrl / 1200), 0.42)
          simple('sawtooth', 1, 0.42)
          simple('sawtooth', octaveUp ? 2 : Math.pow(2, ctrl / 1200), 0.42)
          break
        }
        case 'super': {
          const type = name === 'Super Saw' ? 'sawtooth' : 'square'
          for (let index = 0; index < 7; index += 1) {
            const cents = (index - 3) * (ctrl / 3)
            simple(type, Math.pow(2, cents / 1200), index === 3 ? 0.34 : 0.22)
          }
          break
        }
        case 'fmh': {
          const carrier = simple('sine', 1, 0.8)
          const modulator = context.createOscillator()
          modulator.type = 'sine'
          modulator.frequency.value = baseFrequency * 2
          const index = context.createGain()
          index.gain.value = baseFrequency * ctrl
          modulator.connect(index)
          index.connect(carrier.frequency)
          modulator.start(now)
          nodes.push(modulator, index)
          stoppables.push(modulator)
          fmGains.push(index.gain)
          break
        }
      }
    }

    /* ---------------- modulation routing */

    const lfoDepth = settings.lfo.amount
    if (settings.lfo.destination !== 'off' && lfoDepth > 0.001) {
      const send = context.createGain()
      nodes.push(send)
      this.lfoNode().connect(send)
      if (settings.lfo.destination === 'pitch') {
        send.gain.value = frequency * 0.06 * lfoDepth
        for (const param of pitchParams) send.connect(param)
        for (const param of rateParams) {
          const scaled = context.createGain()
          scaled.gain.value = (0.06 * lfoDepth) / TABLE_BASE_HZ
          this.lfoNode().connect(scaled)
          scaled.connect(param)
          nodes.push(scaled)
        }
      } else if (settings.lfo.destination === 'filter' && filterFreqParams.length > 0) {
        send.gain.value = cutoff * 0.7 * lfoDepth
        for (const param of filterFreqParams) send.connect(param)
      } else if (settings.lfo.destination === 'ctrl') {
        // Osc Ctrl is a category-specific destination; on Pure it has no effect, which is what
        // the manual says the knob itself does (manual p. 29).
        send.gain.value = lfoDepth
        for (const param of fmGains) {
          const scaled = context.createGain()
          scaled.gain.value = frequency * 4 * lfoDepth
          this.lfoNode().connect(scaled)
          scaled.connect(param)
          nodes.push(scaled)
        }
        for (const param of rateParams) {
          const scaled = context.createGain()
          scaled.gain.value = (0.25 * lfoDepth * frequency) / TABLE_BASE_HZ
          this.lfoNode().connect(scaled)
          scaled.connect(param)
          nodes.push(scaled)
        }
      }
    }

    if (settings.voice.vibrato.mode !== 'off' && settings.voice.vibrato.amount > 0.001) {
      const send = context.createGain()
      send.gain.value = frequency * 0.03
      this.vibratoOut.connect(send)
      for (const param of pitchParams) send.connect(param)
      nodes.push(send)
    }

    // Oscillator envelope: bipolar, retargetable to pitch (synth spec, `envelopes.oscillator`).
    const oscAmount = settings.oscEnv.amount * (settings.oscEnv.velocity ? velocity : 1)
    if (Math.abs(oscAmount) > 0.001) {
      const targets: GraphParam[] = settings.oscEnv.toPitch ? pitchParams : fmGains
      const scale = settings.oscEnv.toPitch ? frequency * 0.5 : frequency * 6
      for (const param of targets) {
        const base = settings.oscEnv.toPitch ? pitchBases[targets.indexOf(param)] ?? frequency : 0
        const attack = Math.max(0.001, attackSeconds(settings.oscEnv.attack))
        const decay = decaySeconds(settings.oscEnv.decay)
        param.cancelScheduledValues(now)
        param.setValueAtTime(base + (settings.oscEnv.toPitch ? 0 : frequency * oscCtrlValue(settings.category, settings.oscCtrl)), now)
        param.linearRampToValueAtTime(base + oscAmount * scale, now + attack)
        if (!isSustainDecay(settings.oscEnv.decay)) {
          param.linearRampToValueAtTime(base, now + attack + decay)
        }
      }
    }

    const record: LiveSynthVoice = { midi: shifted - settings.octave, cutoffs: filterFreqParams, resonances: filterQParams }
    this.live.add(record)
    // A marker node: the engine disconnects every node of a voice when it destroys it, which is
    // how this registry stays exactly as long as the voice does.
    nodes.push({
      connect: () => undefined,
      disconnect: () => {
        this.live.delete(record)
      },
    })

    const release = Math.max(0.005, releaseSeconds(settings.amp.release))
    const sustaining = isSustainDecay(settings.amp.decay)
    const lifetime = sustaining ? 900 : ampAttack + decaySeconds(settings.amp.decay) + 0.3

    const retune = (nextMidi: number, glideSeconds: number) => {
      const target = midiToFrequency(nextMidi + this.settings.octave)
      const at = context.currentTime
      pitchParams.forEach((param, index) => {
        const ratio = pitchBases[index] / frequency
        param.cancelScheduledValues(at)
        param.setValueAtTime(param.value, at)
        if (glideSeconds > 0) param.linearRampToValueAtTime(target * ratio, at + glideSeconds)
        else param.setValueAtTime(target * ratio, at)
      })
      for (const param of rateParams) {
        param.cancelScheduledValues(at)
        param.setValueAtTime(param.value, at)
        const rate = target / TABLE_BASE_HZ
        if (glideSeconds > 0) param.linearRampToValueAtTime(rate, at + glideSeconds)
        else param.setValueAtTime(rate, at)
      }
    }

    return {
      nodes,
      outputs: [amp],
      stoppables,
      releaseSeconds: release,
      lifetimeSeconds: lifetime,
      recorded: false,
      midi,
      retune,
    }
  }

  /** Constant-rate portamento: a wider jump takes proportionally longer (manual p. 35). */
  glideSecondsFor(fromMidi: number, toMidi: number): number {
    const octaves = Math.abs(toMidi - fromMidi) / 12
    return glideSecondsPerOctave(this.settings.voice.glide) * octaves
  }

  dispose(): void {
    this.live.clear()
    for (const oscillator of [this.lfo, this.vibratoLfo]) {
      try {
        oscillator.stop(this.context.currentTime)
      } catch {
        // already stopped
      }
    }
    try {
      this.shSource.stop(this.context.currentTime)
    } catch {
      // already stopped
    }
    this.chain.dispose()
    for (const node of this.extras) node.disconnect()
    this.voiceBus.disconnect()
    this.level.disconnect()
    this.dryOut.disconnect()
    this.rotaryOut.disconnect()
  }
}
