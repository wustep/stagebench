/**
 * Minimal RIFF/WAVE decoder for the bundled sample sets.
 *
 * The instrument decodes its own samples instead of calling `decodeAudioData` so that the
 * browser and the tests take exactly the same path: the same bytes, the same float conversion,
 * the same buffers. That is what lets a test assert "the recorded Grand and the recorded Upright
 * do not render identically" on the files that actually ship.
 *
 * `tools/build-samples.py` writes 16-bit PCM mono, so that is what is supported here; anything
 * else raises instead of guessing, which is what puts the engine into its labelled fallback.
 */

export interface DecodedAudio {
  readonly sampleRate: number
  readonly channels: readonly Float32Array[]
}

export function decodeWav(data: ArrayBuffer): DecodedAudio {
  const view = new DataView(data)
  if (data.byteLength < 44) throw new Error('wav file is too short')
  if (readTag(view, 0) !== 'RIFF' || readTag(view, 8) !== 'WAVE') throw new Error('not a RIFF/WAVE file')

  let offset = 12
  let format = 0
  let channelCount = 0
  let sampleRate = 0
  let bitsPerSample = 0
  let dataStart = -1
  let dataLength = 0

  while (offset + 8 <= view.byteLength) {
    const id = readTag(view, offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ') {
      format = view.getUint16(body, true)
      channelCount = view.getUint16(body + 2, true)
      sampleRate = view.getUint32(body + 4, true)
      bitsPerSample = view.getUint16(body + 14, true)
    } else if (id === 'data') {
      dataStart = body
      dataLength = Math.min(size, view.byteLength - body)
    }
    offset = body + size + (size % 2)
  }

  if (dataStart < 0 || !channelCount || !sampleRate) throw new Error('wav file has no usable data chunk')
  if (format !== 1 && format !== 0xfffe) throw new Error(`unsupported wav format ${format}`)
  if (bitsPerSample !== 16) throw new Error(`unsupported wav bit depth ${bitsPerSample}`)

  const frames = Math.floor(dataLength / (2 * channelCount))
  const channels = Array.from({ length: channelCount }, () => new Float32Array(frames))
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = view.getInt16(dataStart + (frame * channelCount + channel) * 2, true)
      channels[channel][frame] = sample / 32768
    }
  }
  return { sampleRate, channels }
}

function readTag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  )
}
