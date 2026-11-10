/**
 * A small FLAC decoder (subset: mono, up to 16 bits per sample), written for this app.
 *
 * The bundled piano recordings are FLAC so they stay lossless at a fraction of WAV size.
 * Decoding here, in plain TypeScript, means the app does not depend on the browser's
 * `decodeAudioData`: the same bytes produce the same samples in every browser, in the
 * ScriptProcessor fallback, and in the test suite.
 *
 * Format reference: RFC 9639.
 */

export interface DecodedFlac {
  sampleRate: number
  /** Mono PCM, 16-bit. */
  samples: Int16Array
}

class BitReader {
  private readonly bytes: Uint8Array
  private position: number
  private buffer = 0
  private count = 0

  constructor(bytes: Uint8Array, position: number) {
    this.bytes = bytes
    this.position = position
  }

  get bytePosition(): number {
    return this.position - (this.count >> 3)
  }

  get exhausted(): boolean {
    return this.position >= this.bytes.length && this.count === 0
  }

  /** Unsigned, 0..24 bits. */
  bits(n: number): number {
    if (n === 0) return 0
    while (this.count < n) {
      if (this.position >= this.bytes.length) throw new Error('FLAC data ends unexpectedly')
      this.buffer = (this.buffer << 8) | this.bytes[this.position]
      this.position += 1
      this.count += 8
    }
    this.count -= n
    const value = this.buffer >>> this.count
    this.buffer &= (1 << this.count) - 1
    return value
  }

  /** Two's-complement signed, 1..24 bits. */
  signed(n: number): number {
    const value = this.bits(n)
    return value >= 1 << (n - 1) ? value - (1 << n) : value
  }

  /** Number of zero bits before the next one bit; consumes the one bit. */
  unary(): number {
    let zeros = 0
    for (;;) {
      if (this.count === 0) {
        if (this.position >= this.bytes.length) throw new Error('FLAC data ends unexpectedly')
        this.buffer = this.bytes[this.position]
        this.position += 1
        this.count = 8
      }
      if (this.buffer === 0) {
        zeros += this.count
        this.count = 0
        continue
      }
      const lead = Math.clz32(this.buffer) - (32 - this.count)
      zeros += lead
      this.count -= lead + 1
      this.buffer &= (1 << this.count) - 1
      return zeros
    }
  }

  alignToByte(): void {
    this.count -= this.count & 7
    this.buffer &= (1 << this.count) - 1
  }
}

const FIXED_COEFFICIENTS: ReadonlyArray<readonly number[]> = [[], [1], [2, -1], [3, -3, 1], [4, -6, 4, -1]]

function blockSizeFor(code: number, reader: BitReader): number {
  if (code === 1) return 192
  if (code >= 2 && code <= 5) return 576 << (code - 2)
  if (code === 6) return reader.bits(8) + 1
  if (code === 7) return reader.bits(16) + 1
  if (code >= 8) return 256 << (code - 8)
  throw new Error('FLAC: reserved block size')
}

function readResidual(reader: BitReader, out: Int32Array, order: number, blockSize: number): void {
  const method = reader.bits(2)
  if (method > 1) throw new Error('FLAC: reserved residual coding method')
  const parameterBits = method === 0 ? 4 : 5
  const escape = method === 0 ? 15 : 31
  const partitions = 1 << reader.bits(4)
  const perPartition = blockSize >> Math.log2(partitions)
  let index = order
  for (let partition = 0; partition < partitions; partition += 1) {
    const count = partition === 0 ? perPartition - order : perPartition
    const parameter = reader.bits(parameterBits)
    if (parameter === escape) {
      const width = reader.bits(5)
      for (let i = 0; i < count; i += 1) out[index + i] = width === 0 ? 0 : reader.signed(width)
    } else {
      const scale = 1 << parameter
      for (let i = 0; i < count; i += 1) {
        const folded = reader.unary() * scale + reader.bits(parameter)
        out[index + i] = (folded >>> 1) ^ -(folded & 1)
      }
    }
    index += count
  }
}

function readSubframe(reader: BitReader, out: Int32Array, blockSize: number, bitsPerSample: number): void {
  if (reader.bits(1) !== 0) throw new Error('FLAC: lost sync in subframe header')
  const type = reader.bits(6)
  let wasted = 0
  if (reader.bits(1) === 1) wasted = reader.unary() + 1
  const depth = bitsPerSample - wasted

  if (type === 0) {
    out.fill(reader.signed(depth), 0, blockSize)
  } else if (type === 1) {
    for (let i = 0; i < blockSize; i += 1) out[i] = reader.signed(depth)
  } else if (type >= 8 && type <= 12) {
    const order = type - 8
    for (let i = 0; i < order; i += 1) out[i] = reader.signed(depth)
    readResidual(reader, out, order, blockSize)
    const coefficients = FIXED_COEFFICIENTS[order]
    for (let i = order; i < blockSize; i += 1) {
      let prediction = 0
      for (let j = 0; j < order; j += 1) prediction += coefficients[j] * out[i - 1 - j]
      out[i] += prediction
    }
  } else if (type >= 32) {
    const order = type - 31
    for (let i = 0; i < order; i += 1) out[i] = reader.signed(depth)
    const precision = reader.bits(4) + 1
    if (precision === 16) throw new Error('FLAC: invalid predictor precision')
    const shift = reader.signed(5)
    if (shift < 0) throw new Error('FLAC: negative predictor shift')
    const coefficients = new Float64Array(order)
    for (let j = 0; j < order; j += 1) coefficients[j] = reader.signed(precision)
    readResidual(reader, out, order, blockSize)
    // The sum can exceed 32 bits; doubles are exact far beyond what 16-bit audio can reach.
    const divisor = 2 ** shift
    for (let i = order; i < blockSize; i += 1) {
      let prediction = 0
      for (let j = 0; j < order; j += 1) prediction += coefficients[j] * out[i - 1 - j]
      out[i] += Math.floor(prediction / divisor)
    }
  } else {
    throw new Error('FLAC: reserved subframe type')
  }

  if (wasted > 0) for (let i = 0; i < blockSize; i += 1) out[i] *= 1 << wasted
}

export function decodeFlac(data: ArrayBuffer | Uint8Array): DecodedFlac {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (bytes.length < 42 || bytes[0] !== 0x66 || bytes[1] !== 0x4c || bytes[2] !== 0x61 || bytes[3] !== 0x43) {
    throw new Error('Not a FLAC file')
  }

  let offset = 4
  let sampleRate = 0
  let channels = 0
  let bitsPerSample = 0
  let totalSamples = 0
  let last = false
  while (!last) {
    if (offset + 4 > bytes.length) throw new Error('FLAC: truncated metadata')
    last = (bytes[offset] & 0x80) !== 0
    const type = bytes[offset] & 0x7f
    const length = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]
    offset += 4
    if (type === 0) {
      const info = new BitReader(bytes, offset + 10)
      sampleRate = info.bits(20)
      channels = info.bits(3) + 1
      bitsPerSample = info.bits(5) + 1
      totalSamples = info.bits(4) * 2 ** 32 + info.bits(16) * 65536 + info.bits(16)
    }
    offset += length
  }
  if (sampleRate === 0) throw new Error('FLAC: missing stream info')
  if (channels !== 1 || bitsPerSample > 16) {
    throw new Error(`FLAC: only mono files up to 16 bits are supported (got ${channels} ch, ${bitsPerSample} bit)`)
  }

  const samples = new Int16Array(totalSamples)
  const block = new Int32Array(65536)
  const reader = new BitReader(bytes, offset)
  let written = 0
  while (written < totalSamples && !reader.exhausted) {
    if (reader.bits(14) !== 0x3ffe) throw new Error('FLAC: lost frame sync')
    reader.bits(2)
    const blockCode = reader.bits(4)
    const rateCode = reader.bits(4)
    const channelCode = reader.bits(4)
    reader.bits(4)
    if (channelCode !== 0) throw new Error('FLAC: unexpected channel layout')
    // Frame or sample number, coded like UTF-8.
    const lead = reader.bits(8)
    for (let mask = 0x80; (lead & mask) !== 0 && mask > 0x02; mask >>= 1) {
      if (mask !== 0x80) reader.bits(8)
    }
    const blockSize = blockSizeFor(blockCode, reader)
    if (rateCode === 12) reader.bits(8)
    else if (rateCode === 13 || rateCode === 14) reader.bits(16)
    reader.bits(8) // CRC-8

    readSubframe(reader, block, blockSize, bitsPerSample)
    reader.alignToByte()
    reader.bits(16) // CRC-16

    const count = Math.min(blockSize, totalSamples - written)
    for (let i = 0; i < count; i += 1) samples[written + i] = block[i]
    written += count
  }
  if (written !== totalSamples) throw new Error('FLAC: stream ended before the declared length')
  return { sampleRate, samples }
}

/** FNV-1a over the little-endian bytes of 16-bit PCM; matches `pcmFnv1a` in the sample manifest. */
export function pcmFingerprint(samples: Int16Array): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i]
    hash = Math.imul(hash ^ (value & 0xff), 0x01000193)
    hash = Math.imul(hash ^ ((value >> 8) & 0xff), 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
