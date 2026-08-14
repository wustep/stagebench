export type SampledType = 'grand' | 'upright' | 'electric'
export type PianoType = SampledType | 'clav' | 'digital' | 'misc'
export type LayerId = 'A' | 'B'

export interface SampleZone {
  midi: number
  vel: number
  rate: number
  pcm: Float32Array
}

export interface SampleBanks {
  grand: SampleZone[]
  upright: SampleZone[]
  electric: SampleZone[]
}

interface PackedZone {
  midi: number
  vel: number
  rate: number
  pcm: string
}

interface PackedFile {
  grand: PackedZone[]
  upright: PackedZone[]
  electric: PackedZone[]
}

import packedJson from './recorded-pcm.json'

let cached: SampleBanks | null = null
let loadError: string | null = null

function decodePcm16(b64: string): Float32Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2))
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] / 32768
  return out
}

function decodePacked(packed: PackedFile): SampleBanks {
  const map = (zones: PackedZone[]) =>
    zones.map((zone) => ({ midi: zone.midi, vel: zone.vel, rate: zone.rate, pcm: decodePcm16(zone.pcm) }))
  return { grand: map(packed.grand), upright: map(packed.upright), electric: map(packed.electric) }
}

function readPackedFromNode(): PackedFile | null {
  try {
    if (typeof process === 'undefined' || !process.versions?.node) return null
    const fs = globalThis.process.getBuiltinModule?.('fs') as { readFileSync: (p: string, e: string) => string } | undefined
    if (!fs?.readFileSync) return null
    const url = new URL('./recorded-pcm.json', import.meta.url)
    const path = decodeURIComponent(url.pathname)
    return JSON.parse(fs.readFileSync(path, 'utf8')) as PackedFile
  } catch {
    return null
  }
}

export function recordedLibraryStatus(): { ready: boolean; error: string | null; counts: Record<SampledType, number> } {
  const banks = tryLoadRecordedBanks()
  return {
    ready: !!(banks && banks.grand.length && banks.upright.length && banks.electric.length),
    error: loadError,
    counts: {
      grand: banks?.grand.length ?? 0,
      upright: banks?.upright.length ?? 0,
      electric: banks?.electric.length ?? 0,
    },
  }
}

export function tryLoadRecordedBanks(): SampleBanks | null {
  if (cached) return cached
  try {
    const packed = (packedJson as PackedFile | null) ?? readPackedFromNode()
    if (!packed?.grand?.length) {
      loadError = 'recorded library missing'
      return null
    }
    cached = decodePacked(packed)
    return cached
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'sample decode failed'
    return null
  }
}

export async function loadRecordedBanks(): Promise<SampleBanks> {
  const sync = tryLoadRecordedBanks()
  if (sync && sync.grand.length && sync.upright.length && sync.electric.length) return sync
  const urls = ['./samples/recorded-pcm.json', new URL('./recorded-pcm.json', import.meta.url).href]
  let last = 'sample fetch failed'
  for (const url of urls) {
    try {
      const res = await fetch(url)
      if (!res.ok) {
        last = `HTTP ${res.status}`
        continue
      }
      cached = decodePacked((await res.json()) as PackedFile)
      return cached
    } catch (error) {
      last = error instanceof Error ? error.message : 'sample fetch failed'
    }
  }
  loadError = last
  throw new Error(last)
}

export function pickZone(zones: SampleZone[], midi: number, velocity: number): { zone: SampleZone; playbackRate: number } {
  if (zones.length === 0) throw new Error('empty sample bank')
  const wantVel = velocity < 0.55 ? 0 : 1
  let best = zones[0]
  let bestScore = Number.POSITIVE_INFINITY
  for (const zone of zones) {
    const score = Math.abs(zone.midi - midi) * 10 + Math.abs(zone.vel - wantVel) * 3
    if (score < bestScore) {
      best = zone
      bestScore = score
    }
  }
  return { zone: best, playbackRate: 2 ** ((midi - best.midi) / 12) }
}

export const PIANO_TYPES: PianoType[] = ['grand', 'upright', 'electric', 'clav', 'digital', 'misc']
export const PIANO_TYPE_LABELS: Record<PianoType, string> = {
  grand: 'Concert Grand',
  upright: 'Kawai Upright',
  electric: 'Tine EP',
  clav: 'Clavinet',
  digital: 'Digital',
  misc: 'Marimba',
}
