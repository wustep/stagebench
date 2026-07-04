import type { PianoType } from './types'

export interface SampleEntry {
  rootMidi: number
  velocity: number
  buffer: AudioBuffer
}

export interface SampleSet {
  type: PianoType
  entries: SampleEntry[]
  /** Programmatically synthesized — not field recordings. */
  provenance: 'synthesized'
}

const ROOTS = [36, 48, 60, 72, 84]
const VELOCITIES = [64, 100]

async function renderTone(
  sampleRate: number,
  freq: number,
  profile: { harmonics: number[]; decay: number; brightness: number; inharmonic?: number },
  velocity: number,
  duration = 2,
): Promise<AudioBuffer> {
  const length = Math.ceil(duration * sampleRate)
  const offline = new OfflineAudioContext(1, length, sampleRate)
  const osc = offline.createOscillator()
  const gain = offline.createGain()
  const filter = offline.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 800 + profile.brightness * 6000
  filter.Q.value = 0.7

  osc.type = 'sine'
  osc.frequency.value = freq
  const amp = (velocity / 127) ** 1.3 * 0.5
  gain.gain.setValueAtTime(0, 0)
  gain.gain.linearRampToValueAtTime(amp, 0.005)
  gain.gain.exponentialRampToValueAtTime(0.0001, profile.decay)

  osc.connect(filter)
  filter.connect(gain)
  gain.connect(offline.destination)
  osc.start(0)
  osc.stop(duration)

  const harmonics = profile.harmonics
  for (let h = 0; h < harmonics.length; h++) {
    const o = offline.createOscillator()
    const g = offline.createGain()
    o.type = h % 2 === 0 ? 'sine' : 'triangle'
    const ratio = profile.inharmonic ? h + 1 + profile.inharmonic * (h + 1) * 0.02 : h + 1
    o.frequency.value = freq * ratio
    g.gain.setValueAtTime(0, 0)
    g.gain.linearRampToValueAtTime(amp * harmonics[h]!, 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, profile.decay * (0.85 + h * 0.05))
    o.connect(g)
    g.connect(offline.destination)
    o.start(0)
    o.stop(duration)
  }

  return offline.startRendering()
}

async function buildSet(sampleRate: number, type: PianoType): Promise<SampleSet> {
  const profiles: Record<PianoType, { harmonics: number[]; decay: number; brightness: number; inharmonic?: number }> = {
    Grand: { harmonics: [0.35, 0.2, 0.12, 0.08, 0.05], decay: 2.8, brightness: 0.85 },
    Upright: { harmonics: [0.28, 0.15, 0.08, 0.04], decay: 1.6, brightness: 0.45 },
    Electric: { harmonics: [0.22, 0.18, 0.14], decay: 1.2, brightness: 0.65, inharmonic: 0.4 },
    Clav: { harmonics: [0.5, 0.3, 0.1], decay: 0.35, brightness: 0.9 },
    Digital: { harmonics: [0.3, 0.25, 0.15, 0.1], decay: 1.8, brightness: 0.55 },
    Misc: { harmonics: [0.4, 0.25, 0.15, 0.08], decay: 1.4, brightness: 0.7 },
  }
  const profile = profiles[type]
  const entries: SampleEntry[] = []
  for (const rootMidi of ROOTS) {
    const freq = 440 * 2 ** ((rootMidi - 69) / 12)
    for (const velocity of VELOCITIES) {
      const buffer = await renderTone(sampleRate, freq, profile, velocity, profile.decay + 0.5)
      entries.push({ rootMidi, velocity, buffer })
    }
  }
  return { type, entries, provenance: 'synthesized' }
}

export class SampleLibrary {
  private sets = new Map<PianoType, SampleSet>()
  private loading: Promise<void> | null = null
  readonly forceFail: boolean

  constructor(forceFail = false) {
    this.forceFail = forceFail
  }

  async load(ctx: BaseAudioContext): Promise<void> {
    if (this.loading) return this.loading
    if (this.forceFail) {
      this.loading = Promise.reject(new Error('forced sample load failure'))
      return this.loading
    }
    this.loading = (async () => {
      for (const type of ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'] as PianoType[]) {
        this.sets.set(type, await buildSet(ctx.sampleRate, type))
      }
    })()
    return this.loading
  }

  getSet(type: PianoType): SampleSet | undefined {
    return this.sets.get(type)
  }

  findSample(type: PianoType, midi: number, velocity: number): { buffer: AudioBuffer; playbackRate: number } | null {
    const set = this.sets.get(type)
    if (!set) return null
    let best = set.entries[0]!
    let bestDist = Infinity
    for (const e of set.entries) {
      const dist = Math.abs(e.rootMidi - midi) + Math.abs(e.velocity - velocity) * 0.05
      if (dist < bestDist) {
        bestDist = dist
        best = e
      }
    }
    const playbackRate = 2 ** ((midi - best.rootMidi) / 12)
    return { buffer: best.buffer, playbackRate }
  }
}

export async function synthesizeFallbackBuffer(ctx: BaseAudioContext): Promise<AudioBuffer> {
  const offline = new OfflineAudioContext(1, ctx.sampleRate * 2, ctx.sampleRate)
  const osc = offline.createOscillator()
  const gain = offline.createGain()
  osc.type = 'triangle'
  osc.frequency.value = 261.63
  gain.gain.setValueAtTime(0, 0)
  gain.gain.linearRampToValueAtTime(0.3, 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, 1.5)
  osc.connect(gain)
  gain.connect(offline.destination)
  osc.start(0)
  osc.stop(2)
  return offline.startRendering()
}
