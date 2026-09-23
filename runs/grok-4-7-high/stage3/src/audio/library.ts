import type { AudioBufferLike, AudioContextLike } from './boundaries'
import type { SampledType } from './labels'

export interface SampleZone {
  rootMidi: number
  velocityLayer: number
  buffer: AudioBufferLike
  sourceFile?: string
}

export interface RecordedSet {
  type: SampledType
  name: string
  zones: SampleZone[]
}

export interface ManifestZone {
  file: string
  rootMidi: number
  velocityLayer: number
  sourceFile?: string
}

export interface ManifestSet {
  type: SampledType
  name: string
  zones: ManifestZone[]
}

export interface SampleManifest {
  version: number
  sets: ManifestSet[]
}

export interface EncodedZone extends ManifestZone {
  bytes: ArrayBuffer
}

export interface EncodedSet {
  type: SampledType
  name: string
  zones: EncodedZone[]
}

export function pickZone(zones: SampleZone[], midi: number, velocity: number): SampleZone | null {
  if (zones.length === 0) return null
  let best = zones[0]!
  let bestDistance = Math.abs(best.rootMidi - midi)
  for (const zone of zones) {
    const distance = Math.abs(zone.rootMidi - midi)
    if (distance < bestDistance) {
      best = zone
      bestDistance = distance
    }
  }
  const sameRoot = zones.filter((zone) => zone.rootMidi === best.rootMidi)
  const layers = [...sameRoot].sort((left, right) => left.velocityLayer - right.velocityLayer)
  const index = Math.min(layers.length - 1, Math.max(0, Math.floor(velocity * layers.length)))
  return layers[index] ?? best
}

export async function fetchEncodedLibrary(baseHref: string, fetchImpl: typeof fetch = fetch): Promise<EncodedSet[]> {
  const manifestUrl = new URL('samples/manifest.json', baseHref).toString()
  const response = await fetchImpl(manifestUrl)
  if (!response.ok) throw new Error(`sample manifest ${response.status}`)
  const manifest = (await response.json()) as SampleManifest
  const sets: EncodedSet[] = []
  for (const set of manifest.sets) {
    const zones: EncodedZone[] = []
    for (const zone of set.zones) {
      const fileUrl = new URL(`samples/${zone.file}`, baseHref).toString()
      const file = await fetchImpl(fileUrl)
      if (!file.ok) throw new Error(`sample ${zone.file} ${file.status}`)
      zones.push({ ...zone, bytes: await file.arrayBuffer() })
    }
    sets.push({ type: set.type, name: set.name, zones })
  }
  return sets
}

export async function decodeEncodedLibrary(ctx: AudioContextLike, sets: EncodedSet[]): Promise<RecordedSet[]> {
  if (!ctx.decodeAudioData) throw new Error('decodeAudioData is not available')
  const decoded: RecordedSet[] = []
  for (const set of sets) {
    const zones: SampleZone[] = []
    for (const zone of set.zones) {
      const copy = zone.bytes.slice(0)
      const buffer = await ctx.decodeAudioData(copy)
      zones.push({
        rootMidi: zone.rootMidi,
        velocityLayer: zone.velocityLayer,
        buffer,
        sourceFile: zone.sourceFile,
      })
    }
    decoded.push({ type: set.type, name: set.name, zones })
  }
  return decoded
}
