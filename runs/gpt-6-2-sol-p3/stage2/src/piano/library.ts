import electricAssets from './electric-bank.json'
import grandAssets from './grand-bank.json'
import uprightAssets from './upright-bank.json'
import type { PianoType, RecordedType } from './settings'

const assets = { Grand: grandAssets, Upright: uprightAssets, Electric: electricAssets }
interface Asset {
  root: number
  layer: string
  file: string
  loop?: number[]
}

export interface PianoSample {
  root: number
  layer: string
  buffer: AudioBuffer
  loop?: readonly number[]
}

export async function loadLibraryBank(context: AudioContext, model: RecordedType, signal: AbortSignal) {
  const directory = model.toLowerCase()
  const queue: Asset[] = [...assets[model]]
  const cancel = new AbortController()
  const request = AbortSignal.any([signal, cancel.signal])
  const decoded: PianoSample[] = []
  const worker = async () => {
    for (let asset = queue.shift(); asset; asset = queue.shift()) {
      const response = await fetch(`${import.meta.env.BASE_URL}samples/${directory}/${asset.file}`, { signal: request })
      if (!response.ok) throw new Error(`${asset.file} returned HTTP ${response.status}`)
      const buffer = await context.decodeAudioData(await response.arrayBuffer())
      request.throwIfAborted()
      decoded.push({ ...asset, buffer })
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(queue.length, 8) }, worker))
  } catch (error) {
    cancel.abort()
    throw error
  }
  return decoded
}

const dynamics: Record<string, number> = { soft: 38, firm: 113, v1: 15, v4: 38, v7: 66, v10: 92, v16: 122, single: 64 }

export class SampleBank {
  private readonly recordings = new Map<string, PianoSample[]>()
  private readonly dynamics: string[]

  constructor(bank: readonly PianoSample[]) {
    for (const sample of bank) {
      const takes = this.recordings.get(sample.layer) ?? []
      takes.push(sample)
      this.recordings.set(sample.layer, takes)
    }
    this.dynamics = [...this.recordings.keys()].sort((a, b) => dynamics[a] - dynamics[b])
  }

  private nearest(takes: PianoSample[], note: number) {
    return takes.reduce((nearest, sample) => {
      const distance = Math.abs(sample.root - note)
      const closest = Math.abs(nearest.root - note)
      return distance < closest || (distance === closest && sample.root < nearest.root) ? sample : nearest
    })
  }

  strike(note: number, velocity: number) {
    if (this.recordings.has('soft') && this.recordings.has('firm')) {
      const layer = velocity < 77 ? 'soft' : 'firm'
      return [{ sample: this.nearest(this.recordings.get(layer)!, note), weight: 1 }]
    }
    const recorded = this.dynamics.map((layer) => this.nearest(this.recordings.get(layer)!, note))
    if (!recorded.length) return []
    const index = recorded.findIndex(({ layer }) => velocity <= dynamics[layer])
    if (index <= 0) return [{ sample: recorded[index === -1 ? recorded.length - 1 : 0], weight: 1 }]
    const low = recorded[index - 1]
    const high = recorded[index]
    const fade = (velocity - dynamics[low.layer]) / (dynamics[high.layer] - dynamics[low.layer])
    return [{ sample: low, weight: 1 - fade }, { sample: high, weight: fade }].filter(({ weight }) => weight > 0.015)
  }
}

type Tone = Extract<PianoType, 'Clav' | 'Digital' | 'Misc'> | 'Fallback'

const partials = {
  Fallback: [0.40, 0.25, 0.145, 0.095, 0.056, 0.035, 0.021, 0.014, 0.008],
  Clav: [0.33, 0.25, 0.23, 0.18, 0.16, 0.12, 0.10, 0.068, 0.056, 0.04, 0.03, 0.022],
  Misc: [0.65, 0.22, 0.12, 0.048, 0.03],
}
const marimbaRatios = [1, 3.98, 9.1, 14.2, 18.1]

function makeTone(context: BaseAudioContext, tone: Tone, note: number) {
  const rate = 32000
  const seconds = tone === 'Clav' ? 2.25 : tone === 'Misc' ? 3.4 : Math.max(2.4, 6.2 - (note - 45) * 0.057)
  const buffer = context.createBuffer(1, Math.round(seconds * rate), rate)
  const channel = buffer.getChannelData(0)
  const frequency = 440 * 2 ** ((note - 69) / 12)
  if (tone === 'Digital') {
    const angle = 2 * Math.PI * frequency / rate
    for (let i = 0; i < channel.length; i++) {
      const time = i / rate
      const tine = 2.85 * Math.exp(-4.6 * time) * Math.sin(i * angle * 2)
      const bell = frequency * 5 < rate * 0.45 ? 0.15 * Math.sin(i * angle * 4.002) * Math.exp(-5.9 * time) : 0
      channel[i] = (0.57 * Math.sin(i * angle + tine) + bell) * Math.exp(-1.43 * time)
    }
  } else {
    for (const [index, amplitude] of partials[tone].entries()) {
      const partial = index + 1
      const ratio = tone === 'Misc' ? marimbaRatios[index] : partial * Math.sqrt(1 + 0.00014 * (partial ** 2 - 1))
      const hz = frequency * ratio
      if (hz >= rate * 0.46) break
      const angle = 2 * Math.PI * hz / rate
      const slope = tone === 'Misc' ? 1.9 + index * 5.1
        : tone === 'Clav' ? 2.15 + partial * 0.24
          : 0.72 + partial * 0.39 + Math.max(0, note - 57) * 0.029
      const decay = Math.exp(-slope / rate)
      let envelope = amplitude
      for (let i = 0; i < channel.length; i++) {
        channel[i] += envelope * Math.sin(i * angle + index * 0.85)
        envelope *= decay
      }
    }
  }
  for (let i = 0; i < channel.length; i++) {
    const attack = Math.min(1, i / (rate * (tone === 'Clav' || tone === 'Misc' ? 0.002 : 0.006)))
    const tail = Math.min(1, (channel.length - i - 1) / (rate * 0.12))
    channel[i] *= attack * tail
  }
  return buffer
}

export class Tones {
  private readonly stored = new Map<string, AudioBuffer>()

  constructor(private readonly context: BaseAudioContext) {}

  get(type: Tone, note: number) {
    const key = `${type}:${note}`
    const cached = this.stored.get(key)
    if (cached) return cached
    const tone = makeTone(this.context, type, note)
    if (this.stored.size >= 24) {
      const oldest = this.stored.keys().next()
      if (!oldest.done) this.stored.delete(oldest.value)
    }
    this.stored.set(key, tone)
    return tone
  }

  clear() {
    this.stored.clear()
  }
}
