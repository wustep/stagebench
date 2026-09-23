// Bundled recorded-sample packs (public/samples/*.nspk). A pack is a small binary container
// built offline by scripts/build-sample-packs.mjs from the recorded WAV zones: a JSON header
// (provenance, root notes, velocity layers) followed by block IMA-ADPCM mono audio. Decoding is
// plain TypeScript, so the browser and the tests read the exact same bytes without a codec.

export interface PackZone {
  /** MIDI root note of the recording. */
  root: number
  /** Velocity layer label (v1 = softest). */
  layer: string
  velLo: number
  velHi: number
  /** Samples in the zone. */
  length: number
  /** Byte offset into the data section. */
  offset: number
  bytes: number
  /** Original file inside the source distribution. */
  source: string
}

export interface PackHeader {
  format: 'nspk'
  version: 1
  id: string
  name: string
  recordedInstrument: string
  author: string
  license: string
  sourceUrl: string
  sampleRate: number
  codec: 'ima-adpcm-block'
  blockSamples: number
  zones: PackZone[]
}

export interface ParsedPack {
  header: PackHeader
  data: Uint8Array
}

const MAGIC = 0x4b50534e // 'NSPK' little-endian

export function parsePack(buffer: ArrayBuffer): ParsedPack {
  if (buffer.byteLength < 12) throw new Error('sample pack truncated')
  const view = new DataView(buffer)
  if (view.getUint32(0, true) !== MAGIC) throw new Error('not a sample pack')
  const version = view.getUint32(4, true)
  if (version !== 1) throw new Error(`unsupported sample pack version ${version}`)
  const headerLength = view.getUint32(8, true)
  if (12 + headerLength > buffer.byteLength) throw new Error('sample pack header truncated')
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, headerLength))) as PackHeader
  if (header.codec !== 'ima-adpcm-block' || !Array.isArray(header.zones) || header.zones.length === 0) throw new Error('sample pack header invalid')
  const data = new Uint8Array(buffer, 12 + headerLength)
  for (const z of header.zones) if (z.offset + z.bytes > data.length) throw new Error(`sample pack zone ${z.root}/${z.layer} truncated`)
  return { header, data }
}

const STEPS = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230,
  253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024,
  3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086,
  29794, 32767,
]
const INDEX_ADJUST = [-1, -1, -1, -1, 2, 4, 6, 8]

export function blockBytes(blockSamples: number): number {
  return 4 + Math.ceil((blockSamples - 1) / 2)
}

/** Decode one zone to float PCM. `maxSamples` truncates (tests use short excerpts). */
export function decodeZone(pack: ParsedPack, zone: PackZone, maxSamples = Infinity): Float32Array {
  const { data, header } = pack
  const bs = header.blockSamples
  const total = Math.min(zone.length, Math.max(1, Math.floor(maxSamples)))
  const out = new Float32Array(total)
  let pos = zone.offset
  let n = 0
  while (n < total) {
    let pred = (data[pos] | (data[pos + 1] << 8)) << 16 >> 16
    let index = Math.min(88, data[pos + 2])
    pos += 4
    out[n++] = pred / 32768
    const inBlock = Math.min(bs - 1, zone.length - (n - 1) - 1)
    for (let i = 0; i < inBlock; i++) {
      const byte = data[pos + (i >> 1)]
      const code = i & 1 ? byte >> 4 : byte & 15
      const step = STEPS[index]
      let diff = step >> 3
      if (code & 4) diff += step
      if (code & 2) diff += step >> 1
      if (code & 1) diff += step >> 2
      pred = code & 8 ? Math.max(-32768, pred - diff) : Math.min(32767, pred + diff)
      index = Math.min(88, Math.max(0, index + INDEX_ADJUST[code & 7]))
      if (n < total) out[n++] = pred / 32768
    }
    pos += Math.ceil(inBlock / 2)
    if (inBlock < bs - 1) break
  }
  return out
}

/** The zone for a note and velocity: its velocity layer, nearest root (ties → lower root). */
export function pickZone(zones: readonly PackZone[], note: number, velocity: number): PackZone {
  const inLayer = zones.filter((z) => velocity >= z.velLo && velocity <= z.velHi)
  const pool = inLayer.length ? inLayer : zones
  let best = pool[0]
  for (const z of pool) {
    const d = Math.abs(z.root - note)
    const bd = Math.abs(best.root - note)
    if (d < bd || (d === bd && z.root < best.root)) best = z
  }
  return best
}
