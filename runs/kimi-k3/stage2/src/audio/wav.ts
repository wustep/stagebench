/**
 * Minimal 16-bit PCM mono WAV decoder for the bundled sample library.
 * Used by tests (fetch is injectable there) and as a fallback decoder.
 */

export interface DecodedSample {
  sampleRate: number
  data: Float32Array
}

export function decodeWav(buffer: ArrayBuffer): DecodedSample {
  const view = new DataView(buffer)
  if (view.byteLength < 44) throw new Error('WAV too short')
  const tag = (off: number) => String.fromCharCode(view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a RIFF/WAVE file')
  let offset = 12
  let sampleRate = 0
  let channels = 0
  let bits = 0
  let dataStart = -1
  let dataLen = 0
  while (offset + 8 <= view.byteLength) {
    const id = tag(offset)
    const size = view.getUint32(offset + 4, true)
    if (id === 'fmt ') {
      const format = view.getUint16(offset + 8, true)
      if (format !== 1) throw new Error(`unsupported WAV format ${format} (only PCM)`)
      channels = view.getUint16(offset + 10, true)
      sampleRate = view.getUint32(offset + 12, true)
      bits = view.getUint16(offset + 22, true)
    } else if (id === 'data') {
      dataStart = offset + 8
      dataLen = Math.min(size, view.byteLength - dataStart)
    }
    offset += 8 + size + (size % 2)
  }
  if (!sampleRate || dataStart < 0 || bits !== 16) throw new Error('missing fmt/data chunk or non-16-bit WAV')
  const frames = Math.floor(dataLen / 2 / channels)
  const out = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    out[i] = view.getInt16(dataStart + i * 2 * channels, true) / 32768
  }
  return { sampleRate, data: out }
}

/** Minimal resample (linear) when the context rate differs from the take rate. */
export function resampleLinear(data: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return data
  const ratio = fromRate / toRate
  const n = Math.max(1, Math.floor(data.length / ratio))
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const pos = i * ratio
    const a = Math.floor(pos)
    const b = Math.min(data.length - 1, a + 1)
    const frac = pos - a
    out[i] = data[a] * (1 - frac) + data[b] * frac
  }
  return out
}
