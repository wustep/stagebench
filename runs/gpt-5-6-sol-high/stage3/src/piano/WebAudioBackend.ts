import type { PianoAudioBackend, VoiceHandle } from './PianoEngine'

type AudioContextConstructor = new (options?: AudioContextOptions) => AudioContext
type SampleLoader = (context: AudioContext) => Promise<Map<number, AudioBuffer>>

const ROOT_NOTES = [36, 48, 60, 72, 84, 96]

function createPianoSample(context: AudioContext, midi: number) {
  const duration = 3.2
  const sampleRate = context.sampleRate
  const buffer = context.createBuffer(1, Math.ceil(duration * sampleRate), sampleRate)
  const channel = buffer.getChannelData(0)
  const frequency = 440 * (2 ** ((midi - 69) / 12))
  for (let index = 0; index < channel.length; index += 1) {
    const time = index / sampleRate
    const attack = Math.min(1, time / 0.006)
    const decay = Math.exp(-time * (1.25 + frequency / 1800))
    const body =
      Math.sin(Math.PI * 2 * frequency * time) * 0.64
      + Math.sin(Math.PI * 2 * frequency * 2.01 * time + 0.2) * 0.23
      + Math.sin(Math.PI * 2 * frequency * 3.98 * time + 0.5) * 0.09
      + Math.sin(Math.PI * 2 * frequency * 7.96 * time) * 0.04
    channel[index] = body * attack * decay * 0.72
  }
  return buffer
}

function createImpulse(context: AudioContext) {
  const length = Math.ceil(context.sampleRate * 1.7)
  const impulse = context.createBuffer(2, length, context.sampleRate)
  let seed = 0x5f3759df
  for (let channelIndex = 0; channelIndex < 2; channelIndex += 1) {
    const channel = impulse.getChannelData(channelIndex)
    for (let index = 0; index < length; index += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0
      const noise = (seed / 0xffffffff) * 2 - 1
      channel[index] = noise * ((1 - index / length) ** 2.4) * 0.4
    }
  }
  return impulse
}

export class WebAudioPianoBackend implements PianoAudioBackend {
  private readonly master: GainNode
  private readonly dry: GainNode
  private readonly wet: GainNode
  private readonly convolver: ConvolverNode
  private readonly voices = new Map<string, { source: AudioBufferSourceNode; gain: GainNode }>()
  private samples = new Map<number, AudioBuffer>()
  private id = 0

  constructor(private readonly context: AudioContext, private readonly sampleLoader?: SampleLoader) {
    this.master = context.createGain()
    this.dry = context.createGain()
    this.wet = context.createGain()
    this.convolver = context.createConvolver()
    this.convolver.buffer = createImpulse(context)
    this.dry.connect(this.master)
    this.convolver.connect(this.wet)
    this.wet.connect(this.master)
    this.master.connect(context.destination)
    this.samples = this.createBuiltInBank()
    this.setMasterVolume(0.72)
    this.setReverb(0.31)
  }

  async prepare() {
    if (!this.sampleLoader) return 'sampled' as const
    try {
      const loaded = await this.sampleLoader(this.context)
      if (!loaded.size) throw new Error('The sample bank was empty')
      this.samples = loaded
      return 'sampled' as const
    } catch {
      this.samples = this.createBuiltInBank()
      return 'fallback' as const
    }
  }

  async resume() {
    if (this.context.state === 'suspended') await this.context.resume()
  }

  startVoice(midi: number, gainValue: number): VoiceHandle {
    const source = this.context.createBufferSource()
    const gain = this.context.createGain()
    const root = this.nearestRoot(midi)
    source.buffer = this.samples.get(root) ?? this.samples.values().next().value ?? null
    source.playbackRate.value = 2 ** ((midi - root) / 12)
    const now = this.context.currentTime
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainValue), now + 0.008)
    source.connect(gain)
    gain.connect(this.dry)
    gain.connect(this.convolver)
    const id = `sample-${this.id++}`
    this.voices.set(id, { source, gain })
    source.onended = () => this.voices.delete(id)
    source.start(now)
    return { id, midi, gain: gainValue }
  }

  releaseVoice(voice: VoiceHandle, releaseSeconds: number) {
    const nodes = this.voices.get(voice.id)
    if (!nodes) return
    const now = this.context.currentTime
    const end = now + Math.max(0.015, releaseSeconds)
    nodes.gain.gain.cancelScheduledValues(now)
    nodes.gain.gain.setTargetAtTime(0.0001, now, Math.max(0.005, releaseSeconds / 5))
    nodes.source.stop(end)
  }

  stopVoice(voice: VoiceHandle) {
    const nodes = this.voices.get(voice.id)
    if (!nodes) return
    try { nodes.source.stop() } catch { /* The voice may already have ended. */ }
    this.voices.delete(voice.id)
  }

  setMasterVolume(value: number) {
    this.master.gain.setTargetAtTime(value ** 1.5, this.context.currentTime, 0.012)
  }

  setReverb(value: number) {
    const clamped = Math.min(1, Math.max(0, value))
    this.dry.gain.setTargetAtTime(Math.cos(clamped * Math.PI * 0.5), this.context.currentTime, 0.015)
    this.wet.gain.setTargetAtTime(Math.sin(clamped * Math.PI * 0.5), this.context.currentTime, 0.015)
  }

  private createBuiltInBank() {
    return new Map(ROOT_NOTES.map((midi) => [midi, createPianoSample(this.context, midi)]))
  }

  private nearestRoot(midi: number) {
    return ROOT_NOTES.reduce((nearest, root) => Math.abs(root - midi) < Math.abs(nearest - midi) ? root : nearest)
  }
}

class SilentPianoBackend implements PianoAudioBackend {
  private id = 0
  async prepare() { return 'fallback' as const }
  async resume() {}
  startVoice(midi: number, gain: number) { return { id: `silent-${this.id++}`, midi, gain } }
  releaseVoice() {}
  stopVoice() {}
  setMasterVolume() {}
  setReverb() {}
}

export function createBrowserPianoBackend() {
  const AudioContextClass = (globalThis as typeof globalThis & { webkitAudioContext?: AudioContextConstructor }).AudioContext
    ?? (globalThis as typeof globalThis & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext
  return AudioContextClass ? new WebAudioPianoBackend(new AudioContextClass({ latencyHint: 'interactive' })) : new SilentPianoBackend()
}
