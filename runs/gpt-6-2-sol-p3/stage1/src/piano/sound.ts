import type { Voice, VoiceOutput } from './notes'
import sampleAssets from './upright-bank.json'

type VelocityLayer = 'soft' | 'firm'
export interface PianoSample {
  root: number
  layer: VelocityLayer
  buffer: AudioBuffer
}

export type AudioStatus = 'loading' | 'ready' | 'fallback' | 'error'

export interface AudioEngine extends VoiceOutput {
  prepare(): void
  activate(): void
  dispose(): void
}

interface AudioEnvironment {
  available?(): boolean
  createContext(): AudioContext
  loadBank(signal: AbortSignal): Promise<PianoSample[]>
}

export function velocityGain(velocity: number) {
  return 0.025 + 0.975 * (velocity / 127) ** 1.33
}

function sampleFor(bank: readonly PianoSample[], note: number, velocity: number) {
  const layer = velocity < 77 ? 'soft' : 'firm'
  let nearest: PianoSample | undefined
  for (const sample of bank) {
    if (sample.layer === layer && (!nearest || Math.abs(sample.root - note) < Math.abs(nearest.root - note))) {
      nearest = sample
    }
  }
  return nearest
}

function makeTone(context: BaseAudioContext, note: number) {
  const rate = 32000
  const seconds = Math.max(2.4, 6.2 - (note - 45) * 0.057)
  const buffer = context.createBuffer(1, Math.round(seconds * rate), rate)
  const channel = buffer.getChannelData(0)
  const frequency = 440 * 2 ** ((note - 69) / 12)
  const amplitudes = [0.40, 0.25, 0.145, 0.095, 0.056, 0.035, 0.021, 0.014, 0.008]
  for (const [index, amplitude] of amplitudes.entries()) {
    const partial = index + 1
    const hz = frequency * partial * Math.sqrt(1 + 0.00014 * (partial ** 2 - 1))
    if (hz >= rate * 0.46) break
    const angle = 2 * Math.PI * hz / rate
    const decay = Math.exp(-(0.72 + partial * 0.39 + Math.max(0, note - 57) * 0.029) / rate)
    const phase = index * 0.85
    let envelope = amplitude
    for (let i = 0; i < channel.length; i++) {
      channel[i] += envelope * Math.sin(i * angle + phase)
      envelope *= decay
    }
  }
  for (let i = 0; i < channel.length; i++) {
    const attack = Math.min(1, i / (rate * 0.006))
    const tail = Math.min(1, (channel.length - i - 1) / (rate * 0.12))
    channel[i] *= attack * tail
  }
  return buffer
}

/** Shared signal graph for live playback and offline verification. */
export class PianoRack implements VoiceOutput {
  private readonly master: GainNode
  private readonly limiter: DynamicsCompressorNode
  private readonly peakGuard: WaveShaperNode
  private readonly active = new Set<Voice>()
  private readonly tones = new Map<number, AudioBuffer>()
  private bank: readonly PianoSample[] = []

  constructor(
    private readonly context: BaseAudioContext,
    private readonly clock = () => context.currentTime,
  ) {
    this.master = context.createGain()
    this.master.gain.value = 0.22
    this.limiter = context.createDynamicsCompressor()
    this.limiter.threshold.value = -8
    this.limiter.knee.value = 8
    this.limiter.ratio.value = 12
    this.limiter.attack.value = 0.003
    this.limiter.release.value = 0.11
    this.peakGuard = context.createWaveShaper()
    this.peakGuard.curve = Float32Array.from({ length: 1025 }, (_, index) => {
      const input = index / 512 - 1
      const magnitude = Math.abs(input)
      if (magnitude <= 0.82) return input
      const excess = (magnitude - 0.82) / 0.18
      return Math.sign(input) * (0.82 + 0.18 * (1 - Math.exp(-excess)))
    })
    this.master.connect(this.limiter)
    this.limiter.connect(this.peakGuard)
    this.peakGuard.connect(context.destination)
  }

  setBank(bank: readonly PianoSample[]) {
    this.bank = bank
    this.tones.clear()
  }

  play(note: number, velocity: number, ended: () => void): Voice {
    const context = this.context
    const sample = sampleFor(this.bank, note, velocity)
    const source = context.createBufferSource()
    source.buffer = sample?.buffer ?? this.fallback(note)
    if (sample) source.playbackRate.value = 2 ** ((note - sample.root) / 12)

    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = Math.min(context.sampleRate * 0.46, 3000 + 14500 * (velocity / 127) ** 1.65)
    filter.Q.value = 0.2
    const gain = context.createGain()
    source.connect(filter)
    filter.connect(gain)
    gain.connect(this.master)
    const start = this.clock()
    const up = 0.004
    const amplitude = velocityGain(velocity)
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(amplitude, start + up)

    let releaseStart: number | undefined
    let releaseLevel = 0
    let releaseDuration = 0
    let disposed = false
    const dispose = () => {
      if (disposed) return
      disposed = true
      source.onended = null
      source.disconnect()
      filter.disconnect()
      gain.disconnect()
      this.active.delete(voice)
      ended()
    }
    const voice: Voice = {
      release: (seconds = 0.16) => {
        if (disposed) return
        const now = this.clock()
        if (releaseStart !== undefined && now + seconds >= releaseStart + releaseDuration) return
        const level = releaseStart === undefined
          ? amplitude * Math.min(1, Math.max(0, (now - start) / up))
          : releaseLevel * Math.exp(-5.5 * (now - releaseStart) / releaseDuration)
        releaseStart = now
        releaseLevel = level
        releaseDuration = seconds
        gain.gain.cancelScheduledValues(now)
        if (now < start + up) gain.gain.linearRampToValueAtTime(level, now)
        else gain.gain.setValueAtTime(level, now)
        gain.gain.setTargetAtTime(0, now, seconds / 5.5)
        source.stop(now + seconds)
      },
      stop: () => {
        if (disposed) return
        source.stop()
        dispose()
      },
    }
    this.active.add(voice)
    source.onended = dispose
    source.start(start)
    return voice
  }

  stopAll() {
    for (const voice of this.active) voice.stop()
  }

  dispose() {
    this.stopAll()
    this.tones.clear()
    this.bank = []
    this.master.disconnect()
    this.limiter.disconnect()
    this.peakGuard.disconnect()
  }

  private fallback(note: number) {
    const stored = this.tones.get(note)
    if (stored) return stored
    const tone = makeTone(this.context, note)
    if (this.tones.size >= 24) {
      const oldest = this.tones.keys().next()
      if (!oldest.done) this.tones.delete(oldest.value)
    }
    this.tones.set(note, tone)
    return tone
  }
}

const browserAudio: AudioEnvironment = {
  available: () => typeof AudioContext !== 'undefined',
  createContext: () => new AudioContext({ latencyHint: 'interactive' }),
  async loadBank(signal) {
    const decoder = new OfflineAudioContext(2, 1, 44100)
    return Promise.all(sampleAssets.map(async ({ root, layer, file }): Promise<PianoSample> => {
      const response = await fetch(`${import.meta.env.BASE_URL}samples/upright/${file}`, { signal })
      if (!response.ok) throw new Error(`Sample returned HTTP ${response.status}`)
      const buffer = await decoder.decodeAudioData(await response.arrayBuffer())
      return { root, layer: layer as VelocityLayer, buffer }
    }))
  },
}

export class PianoAudio implements AudioEngine {
  private readonly pending = new AbortController()
  private context?: AudioContext
  private rack?: PianoRack
  private bank?: readonly PianoSample[]
  private state: AudioStatus = 'loading'
  private resumePending = false
  private outputFailed = false

  constructor(
    private readonly status: (state: AudioStatus) => void,
    private readonly environment: AudioEnvironment = browserAudio,
  ) {}

  prepare() {
    if (this.environment.available?.() === false) {
      this.outputFailed = true
      this.report()
      return
    }
    this.environment.loadBank(this.pending.signal).then((bank) => {
      if (this.pending.signal.aborted) return
      this.bank = bank
      this.rack?.setBank(bank)
      this.setState('ready')
    }).catch(() => {
      if (!this.pending.signal.aborted) this.setState('fallback')
    })
  }

  activate() {
    if (this.pending.signal.aborted) return
    try {
      if (!this.context) {
        const context = this.environment.createContext()
        this.context = context
        this.rack = new PianoRack(context)
        if (this.bank) this.rack.setBank(this.bank)
      }
      if (this.context.state === 'running') {
        this.outputFailed = false
        this.report()
      } else if (!this.resumePending) {
        this.resumePending = true
        this.context.resume().then(() => {
          if (this.pending.signal.aborted) return
          this.outputFailed = false
          this.report()
        }).catch(() => {
          if (this.pending.signal.aborted) return
          this.outputFailed = true
          this.report()
        }).finally(() => { this.resumePending = false })
      }
    } catch {
      this.outputFailed = true
      this.report()
    }
  }

  play(note: number, velocity: number, ended: () => void) {
    this.activate()
    return this.rack?.play(note, velocity, ended)
  }

  stopAll() {
    this.rack?.stopAll()
  }

  dispose() {
    this.pending.abort()
    this.rack?.dispose()
    void this.context?.close().catch(() => {})
    this.bank = undefined
    this.rack = undefined
    this.context = undefined
  }

  private setState(state: AudioStatus) {
    this.state = state
    this.report()
  }

  private report() {
    this.status(this.outputFailed ? 'error' : this.state)
  }
}
