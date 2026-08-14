import { createAudioContext } from './software-context'
import type { AudioContextFactory, AudioContextLike, AudioStatus, GainNodeLike } from './types'

export const MAX_VOICES = 32
export const PARTIAL_COUNT = 6
const ATTACK = 0.005
const DECAY = 0.45
const SUSTAIN_RATIO = 0.28
const RELEASE = 0.28
const MAX_NOTE_SEC = 8
const STEAL_FADE = 0.008

export interface PianoEngineOptions {
  createAudioContext?: AudioContextFactory
  context?: AudioContextLike
  maxVoices?: number
}

interface Voice {
  id: number
  note: number
  velocity: number
  startTime: number
  released: boolean
  sustained: boolean
  peak: number
  nodes: { stop: (time: number) => void; disconnect: () => void }[]
  gain: GainNodeLike
}

let nextVoiceId = 1

export class PianoEngine {
  readonly maxVoices: number
  private readonly createContext: AudioContextFactory
  private ctx: AudioContextLike | null = null
  private master: GainNodeLike | null = null
  private voices: Voice[] = []
  private sustainDown = false
  private status: AudioStatus = 'loading'
  private statusDetail = 'Initializing audio'
  private disposed = false
  private heldNotes = new Map<number, number>()

  constructor(options: PianoEngineOptions = {}) {
    this.createContext = options.createAudioContext ?? createAudioContext
    this.maxVoices = options.maxVoices ?? MAX_VOICES
    if (options.context) {
      this.ctx = options.context
      this.setupGraph(options.context)
      this.status = 'ready'
      this.statusDetail = 'Audio ready'
    }
  }

  getStatus(): AudioStatus {
    return this.status
  }

  getStatusDetail(): string {
    return this.statusDetail
  }

  getContext(): AudioContextLike | null {
    return this.ctx
  }

  getActiveVoiceCount(): number {
    return this.voices.length
  }

  getHeldNoteCount(): number {
    return this.heldNotes.size
  }

  isSustainDown(): boolean {
    return this.sustainDown
  }

  async init(): Promise<void> {
    if (this.disposed) return
    if (this.ctx) {
      this.status = 'ready'
      this.statusDetail = 'Audio ready'
      await this.ctx.resume()
      return
    }
    this.status = 'loading'
    this.statusDetail = 'Initializing audio'
    try {
      const ctx = this.createContext()
      this.ctx = ctx
      this.setupGraph(ctx)
      await ctx.resume()
      this.status = 'ready'
      this.statusDetail = 'Audio ready'
    } catch (error) {
      this.status = 'error'
      this.statusDetail = 'Audio error — labeled fallback is playable (keys still track)'
      console.warn('PianoEngine init failed', error)
    }
  }

  noteOn(note: number, velocity: number, time?: number): void {
    if (this.disposed) return
    const ctx = this.ctx
    const when = time ?? ctx?.currentTime ?? 0
    const vel = clamp(velocity, 0, 1)
    if (vel <= 0) {
      this.noteOff(note, when)
      return
    }

    const existing = this.voices.filter((voice) => voice.note === note && !voice.released)
    for (const voice of existing) this.releaseVoice(voice, when, 0.02)

    this.heldNotes.set(note, vel)
    this.ensureVoiceCapacity(when)
    if (!ctx || !this.master) return

    const freq = midiToFreq(note)
    const peak = 0.045 + vel ** 1.45 * 0.22
    const filterFreq = 700 + vel * 9200
    const voiceGain = ctx.createGain()
    voiceGain.gain.setValueAtTime(0.0001, when)
    voiceGain.gain.linearRampToValueAtTime(peak, when + ATTACK)
    voiceGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * SUSTAIN_RATIO), when + ATTACK + DECAY)

    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(filterFreq, when)
    filter.Q.setValueAtTime(0.7, when)
    filter.connect(voiceGain)
    voiceGain.connect(this.master)

    const nodes: Voice['nodes'] = [oscAdapter(filter), oscAdapter(voiceGain)]
    for (let partial = 1; partial <= PARTIAL_COUNT; partial++) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      const inharmonic = 1 + 0.00035 * partial * partial
      osc.frequency.setValueAtTime(freq * partial * inharmonic, when)
      const partialGain = ctx.createGain()
      const brightness = vel * 0.55 + 0.45
      const amp = (1 / partial ** 1.18) * brightness * (partial === 1 ? 1 : 0.85)
      partialGain.gain.setValueAtTime(amp, when)
      osc.connect(partialGain)
      partialGain.connect(filter)
      osc.start(when)
      osc.stop(when + MAX_NOTE_SEC)
      nodes.push(oscAdapter(osc), oscAdapter(partialGain))
    }

    this.voices.push({
      id: nextVoiceId++,
      note,
      velocity: vel,
      startTime: when,
      released: false,
      sustained: false,
      peak,
      nodes,
      gain: voiceGain,
    })
  }

  noteOff(note: number, time?: number): void {
    const ctx = this.ctx
    const when = time ?? ctx?.currentTime ?? 0
    this.heldNotes.delete(note)
    for (const voice of this.voices) {
      if (voice.note !== note || voice.released) continue
      if (this.sustainDown) {
        voice.sustained = true
        continue
      }
      this.releaseVoice(voice, when, RELEASE)
    }
  }

  setSustain(down: boolean, time?: number): void {
    const ctx = this.ctx
    const when = time ?? ctx?.currentTime ?? 0
    this.sustainDown = down
    if (down) return
    for (const voice of this.voices) {
      if (voice.sustained && !this.heldNotes.has(voice.note)) {
        this.releaseVoice(voice, when, RELEASE)
      } else {
        voice.sustained = false
      }
    }
  }

  allNotesOff(time?: number): void {
    const ctx = this.ctx
    const when = time ?? ctx?.currentTime ?? 0
    this.heldNotes.clear()
    this.sustainDown = false
    const current = this.voices
    this.voices = []
    for (const voice of current) this.killVoice(voice, when)
  }

  dispose(): void {
    this.disposed = true
    this.allNotesOff()
    const ctx = this.ctx
    this.ctx = null
    this.master = null
    void ctx?.close()
  }

  private setupGraph(ctx: AudioContextLike): void {
    const master = ctx.createGain()
    master.gain.setValueAtTime(0.85, ctx.currentTime)
    master.connect(ctx.destination)
    this.master = master
  }

  private ensureVoiceCapacity(time: number): void {
    while (this.voices.length >= this.maxVoices) {
      const stolen = pickStolenVoice(this.voices)
      if (!stolen) break
      this.releaseVoice(stolen, time, STEAL_FADE)
      this.voices = this.voices.filter((item) => item.id !== stolen.id)
    }
  }

  private releaseVoice(voice: Voice, time: number, release: number): void {
    if (voice.released && release > STEAL_FADE) return
    voice.released = true
    voice.sustained = false
    const current = Math.max(0.0001, voice.peak * SUSTAIN_RATIO)
    try {
      voice.gain.gain.cancelScheduledValues(time)
      voice.gain.gain.setValueAtTime(current, time)
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, time + release)
    } catch {
      /* param scheduling unavailable */
    }
    windowSetTimeout(() => this.killVoice(voice, time + release), (release + 0.04) * 1000)
  }

  private killVoice(voice: Voice, time: number): void {
    for (const node of voice.nodes) {
      try {
        node.stop(time)
      } catch {
        /* already stopped */
      }
      try {
        node.disconnect()
      } catch {
        /* already disconnected */
      }
    }
    this.voices = this.voices.filter((item) => item.id !== voice.id)
  }
}

function oscAdapter(node: {
  stop?: (time: number) => void
  disconnect: () => void
}): Voice['nodes'][number] {
  return {
    stop: (time: number) => {
      node.stop?.(time)
    },
    disconnect: () => node.disconnect(),
  }
}

function pickStolenVoice(voices: Voice[]): Voice | null {
  if (voices.length === 0) return null
  const released = voices.filter((voice) => voice.released)
  const pool = released.length > 0 ? released : voices
  let oldest = pool[0]
  for (const voice of pool) {
    if (voice.startTime < oldest.startTime) oldest = voice
    else if (voice.startTime === oldest.startTime && voice.id < oldest.id) oldest = voice
  }
  return oldest
}

function midiToFreq(note: number): number {
  return 440 * 2 ** ((note - 69) / 12)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function windowSetTimeout(fn: () => void, ms: number): void {
  const timer = globalThis.setTimeout
  timer(fn, ms)
}

export function rms(samples: ArrayLike<number>, start = 0, end = samples.length): number {
  let sum = 0
  const from = Math.max(0, start)
  const to = Math.min(samples.length, end)
  const n = to - from
  if (n <= 0) return 0
  for (let i = from; i < to; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / n)
}

export function lastAudibleIndex(samples: ArrayLike<number>, threshold = 0.0008): number {
  for (let i = samples.length - 1; i >= 0; i--) {
    if (Math.abs(samples[i]) >= threshold) return i
  }
  return 0
}

export async function renderPianoScript(
  durationSec: number,
  script: (engine: PianoEngine) => void,
  sampleRate = 44100,
): Promise<Float32Array> {
  const ctx = createAudioContext({ offline: true, durationSec, sampleRate })
  const engine = new PianoEngine({ context: ctx })
  script(engine)
  if (!ctx.startRendering) throw new Error('offline context cannot render')
  const buffer = await ctx.startRendering()
  engine.dispose()
  return buffer.getChannelData(0)
}
