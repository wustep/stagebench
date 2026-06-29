export type PianoType = 'Grand' | 'Upright' | 'E.Piano' | 'Clav / Hps' | 'Digital' | 'Misc'
export type PianoTimbre = 'Soft' | 'Mid' | 'Bright'
export type ReverbType = 'Stage' | 'Chorale'

export type PianoLayerSettings = {
  enabled: boolean
  level: number
  sustain: boolean
  type: PianoType
  variation: number
}

export type PianoAudioSettings = {
  layers: [PianoLayerSettings, PianoLayerSettings]
  masterLevel: number
  mono: boolean
  stringResonance: boolean
  dynComp: boolean
  pedalNoise: boolean
  softRelease: boolean
  timbre: PianoTimbre
  unison: number
  reverbOn: boolean
  reverbMix: number
  reverbSize: number
  reverbType: ReverbType
}

type Voice = {
  source: AudioBufferSourceNode
  gain: GainNode
  filter: BiquadFilterNode
  note: number
  layer: number
  sourceId: string
  startedAt: number
  released: boolean
  keyReleased: boolean
}

const SAMPLE_ROOTS = [28, 36, 48, 60, 72, 84, 96]
const MAX_VOICES = 48

const midiFrequency = (note: number) => 440 * 2 ** ((note - 69) / 12)
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))

/**
 * A compact, network-free sampled piano. A small multisample bank is rendered once
 * into AudioBuffers, then every performance voice uses low-latency buffer playback.
 * This avoids an external sample dependency while retaining per-note envelopes,
 * velocity, polyphony, pedal behaviour and realistic pitched decay.
 */
export class PianoEngine {
  readonly context: AudioContext

  private settings: PianoAudioSettings
  private readonly samples = new Map<number, AudioBuffer>()
  private readonly voices = new Set<Voice>()
  private readonly sourceVoices = new Map<string, Set<Voice>>()
  private readonly master: GainNode
  private readonly compressor: DynamicsCompressorNode
  private readonly dry: GainNode
  private readonly reverbSend: GainNode
  private readonly reverb: ConvolverNode
  private readonly reverbReturn: GainNode
  private sustainDown = false
  private reverbTimer: number | null = null

  constructor(settings: PianoAudioSettings) {
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext
    if (!AudioContextClass) throw new Error('Web Audio is not supported in this browser')
    this.context = new AudioContextClass({ latencyHint: 'interactive' })
    this.settings = settings

    this.master = this.context.createGain()
    this.compressor = this.context.createDynamicsCompressor()
    this.dry = this.context.createGain()
    this.reverbSend = this.context.createGain()
    this.reverb = this.context.createConvolver()
    this.reverbReturn = this.context.createGain()

    this.dry.connect(this.compressor)
    this.reverbSend.connect(this.reverb)
    this.reverb.connect(this.reverbReturn)
    this.reverbReturn.connect(this.compressor)
    this.compressor.connect(this.master)
    this.master.connect(this.context.destination)

    this.createSampleBank()
    this.rebuildReverb()
    this.updateSettings(settings)
  }

  async resume() {
    if (this.context.state !== 'running') await this.context.resume()
  }

  updateSettings(settings: PianoAudioSettings) {
    const prior = this.settings
    this.settings = settings
    const now = this.context.currentTime
    const master = (settings.masterLevel / 100) ** 1.65 * 0.74
    this.master.gain.setTargetAtTime(master, now, 0.018)

    const wet = settings.reverbOn ? clamp(settings.reverbMix / 100) : 0
    this.dry.gain.setTargetAtTime(1 - wet * 0.34, now, 0.025)
    this.reverbSend.gain.setTargetAtTime(wet * 0.82, now, 0.025)
    this.reverbReturn.gain.setTargetAtTime(0.9, now, 0.025)

    this.compressor.threshold.setTargetAtTime(settings.dynComp ? -28 : -8, now, 0.02)
    this.compressor.ratio.setTargetAtTime(settings.dynComp ? 5 : 1.5, now, 0.02)
    this.compressor.attack.setTargetAtTime(settings.dynComp ? 0.006 : 0.02, now, 0.02)
    this.compressor.release.setTargetAtTime(settings.dynComp ? 0.18 : 0.35, now, 0.02)

    if (prior.reverbSize !== settings.reverbSize || prior.reverbType !== settings.reverbType) this.scheduleReverbRebuild()
  }

  noteOn(note: number, velocity: number, sourceId: string) {
    const now = this.context.currentTime
    const prior = this.sourceVoices.get(sourceId)
    if (prior) for (const voice of prior) this.releaseVoice(voice, 0.025)
    if (this.settings.mono) {
      for (const voice of this.voices) this.releaseVoice(voice, 0.045)
    }

    this.stealVoicesIfNeeded()
    const newVoices = new Set<Voice>()
    this.settings.layers.forEach((layer, layerIndex) => {
      if (!layer.enabled || layer.level <= 0) return
      const voice = this.startVoice(note, velocity, sourceId, layerIndex)
      newVoices.add(voice)
      this.voices.add(voice)
    })
    if (newVoices.size > 0) this.sourceVoices.set(sourceId, newVoices)
    if (this.settings.stringResonance) this.addResonance(note, velocity, now)
  }

  noteOff(sourceId: string) {
    const sourceSet = this.sourceVoices.get(sourceId)
    if (!sourceSet) return
    for (const voice of sourceSet) {
      const sustains = this.settings.layers[voice.layer]?.sustain ?? true
      if (this.sustainDown && sustains) voice.keyReleased = true
      else this.releaseVoice(voice)
    }
    this.sourceVoices.delete(sourceId)
  }

  setSustain(down: boolean) {
    if (down === this.sustainDown) return
    this.sustainDown = down
    if (!down) {
      for (const voice of this.voices) {
        if (voice.keyReleased) this.releaseVoice(voice)
      }
      if (this.settings.pedalNoise) this.playPedalNoise()
    }
  }

  allNotesOff(immediate = false) {
    this.sustainDown = false
    for (const voice of this.voices) this.releaseVoice(voice, immediate ? 0.012 : 0.08)
    this.sourceVoices.clear()
  }

  destroy() {
    this.allNotesOff(true)
    if (this.reverbTimer !== null) window.clearTimeout(this.reverbTimer)
    void this.context.close()
  }

  private startVoice(note: number, velocity: number, sourceId: string, layerIndex: number) {
    const now = this.context.currentTime
    const root = this.nearestSample(note)
    const source = this.context.createBufferSource()
    const filter = this.context.createBiquadFilter()
    const gain = this.context.createGain()
    const layer = this.settings.layers[layerIndex]
    const normalizedVelocity = clamp(velocity)
    const timbreMultiplier = this.settings.timbre === 'Soft' ? 0.67 : this.settings.timbre === 'Bright' ? 1.32 : 1
    const typeMultiplier: Record<PianoType, number> = {
      Grand: 1,
      Upright: 0.86,
      'E.Piano': 0.72,
      'Clav / Hps': 1.42,
      Digital: 1.2,
      Misc: 0.58,
    }
    const variation = (layer.variation - 50) / 50
    const cutoff = clamp((0.23 + normalizedVelocity * 0.77) * timbreMultiplier * typeMultiplier[layer.type], 0.12, 1)
    const attack = layer.type === 'Misc' ? 0.018 : 0.0025 + (1 - normalizedVelocity) * 0.004
    const peak = (0.025 + normalizedVelocity ** 1.55 * 0.34) * (layer.level / 100)

    source.buffer = this.samples.get(root) ?? null
    source.playbackRate.value = 2 ** ((note - root) / 12)
    source.detune.value = variation * 5 + (layerIndex === 1 ? this.settings.unison * 0.035 : -this.settings.unison * 0.02)
    filter.type = 'lowpass'
    filter.frequency.value = 900 + cutoff * 11800
    filter.Q.value = layer.type === 'Upright' ? 1.1 : 0.38
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + attack)

    source.connect(filter)
    filter.connect(gain)
    gain.connect(this.dry)
    gain.connect(this.reverbSend)

    const voice: Voice = { source, gain, filter, note, layer: layerIndex, sourceId, startedAt: now, released: false, keyReleased: false }
    source.onended = () => this.cleanupVoice(voice)
    source.start(now)
    return voice
  }

  private releaseVoice(voice: Voice, forcedRelease?: number) {
    if (voice.released) return
    voice.released = true
    const now = this.context.currentTime
    const release = forcedRelease ?? (this.settings.softRelease ? 1.25 : 0.48)
    voice.gain.gain.cancelScheduledValues(now)
    voice.gain.gain.setTargetAtTime(0.0001, now, Math.max(0.006, release / 5))
    try {
      voice.source.stop(now + release + 0.08)
    } catch {
      // A voice can already have naturally ended; cleanup remains idempotent.
    }
  }

  private cleanupVoice(voice: Voice) {
    this.voices.delete(voice)
    const sourceSet = this.sourceVoices.get(voice.sourceId)
    sourceSet?.delete(voice)
    if (sourceSet?.size === 0) this.sourceVoices.delete(voice.sourceId)
    voice.source.disconnect()
    voice.filter.disconnect()
    voice.gain.disconnect()
  }

  private stealVoicesIfNeeded() {
    if (this.voices.size < MAX_VOICES) return
    let oldest: Voice | undefined
    for (const voice of this.voices) {
      if (!oldest || voice.startedAt < oldest.startedAt || (voice.released && !oldest.released)) oldest = voice
    }
    if (oldest) this.releaseVoice(oldest, 0.018)
  }

  private nearestSample(note: number) {
    let nearest = SAMPLE_ROOTS[0]
    for (const root of SAMPLE_ROOTS) {
      if (Math.abs(root - note) < Math.abs(nearest - note)) nearest = root
    }
    return nearest
  }

  private createSampleBank() {
    const sampleRate = this.context.sampleRate
    SAMPLE_ROOTS.forEach((root, rootIndex) => {
      const duration = Math.max(3.4, 6.5 - rootIndex * 0.43)
      const frames = Math.floor(sampleRate * duration)
      const buffer = this.context.createBuffer(2, frames, sampleRate)
      const frequency = midiFrequency(root)
      for (let channel = 0; channel < 2; channel += 1) {
        const data = buffer.getChannelData(channel)
        let noise = 0
        for (let index = 0; index < frames; index += 1) {
          const time = index / sampleRate
          const bodyDecay = Math.exp(-time * (0.36 + rootIndex * 0.045))
          const hammer = Math.exp(-time * 34)
          noise = noise * 0.72 + (Math.random() * 2 - 1) * 0.28
          let value = noise * hammer * 0.105
          const harmonicLimit = Math.min(11, Math.floor((sampleRate * 0.46) / frequency))
          for (let harmonic = 1; harmonic <= harmonicLimit; harmonic += 1) {
            const inharmonicity = 1 + 0.000055 * harmonic * harmonic * (1 + rootIndex * 0.13)
            const amplitude = 1 / harmonic ** 1.32
            const harmonicDecay = Math.exp(-time * harmonic * 0.105)
            const panPhase = channel === 0 ? harmonic * 0.007 : -harmonic * 0.009
            value += Math.sin(Math.PI * 2 * frequency * harmonic * inharmonicity * time + panPhase) * amplitude * harmonicDecay
          }
          const attack = Math.min(1, time / 0.0032)
          data[index] = Math.tanh(value * 0.55) * bodyDecay * attack * 0.62
        }
      }
      this.samples.set(root, buffer)
    })
  }

  private rebuildReverb() {
    const seconds = 0.75 + (this.settings.reverbSize / 100) * (this.settings.reverbType === 'Chorale' ? 4.4 : 2.8)
    const rate = this.context.sampleRate
    const frames = Math.floor(rate * seconds)
    const impulse = this.context.createBuffer(2, frames, rate)
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel)
      for (let index = 0; index < frames; index += 1) {
        const progress = index / frames
        const earlyReflection = index % Math.max(97, Math.floor(rate * (0.011 + channel * 0.002))) === 0 ? 0.34 : 0
        data[index] = ((Math.random() * 2 - 1) * 0.34 + earlyReflection) * (1 - progress) ** (2.2 - this.settings.reverbSize / 160)
      }
    }
    this.reverb.buffer = impulse
  }

  private scheduleReverbRebuild() {
    if (this.reverbTimer !== null) window.clearTimeout(this.reverbTimer)
    this.reverbTimer = window.setTimeout(() => {
      this.reverbTimer = null
      this.rebuildReverb()
    }, 90)
  }

  private addResonance(note: number, velocity: number, now: number) {
    const oscillator = this.context.createOscillator()
    const gain = this.context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = midiFrequency(note - 12)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.011 * clamp(velocity), now + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.35)
    oscillator.connect(gain)
    gain.connect(this.reverbSend)
    oscillator.start(now)
    oscillator.stop(now + 1.4)
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
  }

  private playPedalNoise() {
    const now = this.context.currentTime
    const buffer = this.context.createBuffer(1, Math.floor(this.context.sampleRate * 0.07), this.context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let index = 0; index < data.length; index += 1) data[index] = (Math.random() * 2 - 1) * (1 - index / data.length)
    const source = this.context.createBufferSource()
    const filter = this.context.createBiquadFilter()
    const gain = this.context.createGain()
    source.buffer = buffer
    filter.type = 'bandpass'
    filter.frequency.value = 520
    filter.Q.value = 0.8
    gain.gain.value = 0.018
    source.connect(filter).connect(gain).connect(this.dry)
    source.start(now)
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect() }
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
  }
}
