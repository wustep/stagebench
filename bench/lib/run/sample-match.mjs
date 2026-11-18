#!/usr/bin/env node
// Does a bundled sample really come from the pack recording it names?
//
// A candidate turns raw recordings into something a browser can load: it
// trims, fades, changes level, mixes channels, resamples, re-encodes. None of
// that survives a byte comparison, and all of it survives this one. Decode
// both files, slide the bundled sample along the recording to find where the
// waveforms line up, and then ask, frequency band by frequency band, whether
// the two are the same signal there.
//
// The second step is what makes it a check. Two pianos playing the same note
// correlate strongly as whole waveforms, because one slowly decaying
// fundamental dominates both (measured on the pack: 0.80 between the upright's
// A4 and the grand's). Band by band they do not: every partial above the
// fundamental sits at a slightly different frequency in a different
// instrument, and drifts out of phase within a fraction of a second. A sample
// cut from the recording agrees with it in every band that carries energy;
// another instrument does not, and a synthesized tone either disagrees or has
// too few bands to compare.
//
// What it cannot do is tell two takes of the same note on the same instrument
// apart when they are very alike (adjacent velocity layers of one key). That
// is a mislabelled layer, not a recording from somewhere else.
//
// Self-contained on purpose (node + an ffmpeg binary, no imports from the
// repository): at seal it is written into a network-less box that holds the
// pack and a copy of the sealed tree, and run there.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// 16 kHz keeps the fundamental of the highest piano note (C8, 4186 Hz).
export const RATE = 16_000
// How much of the bundled sample is compared, and how far into the recording
// its start is searched for before the whole recording is tried.
const WINDOW_SECONDS = 4
const SEARCH_SECONDS = 12
// Mean band coherence at or above this is the same recording. Measured on the
// pack: processed copies score 0.97-1.00 (0.83 at the very worst, a 24 kbps
// Opus encode); the same note from another instrument 0.32; an additive
// synthesis of the same note 0.55; a neighbouring key's release noise 0.66.
export const MATCH_THRESHOLD = 0.8
// Bands, in Hz. A band counts when it holds energy within 40 dB of the
// sample's strongest band; at least three must, or there is nothing to compare.
export const BAND_EDGES = [50, 100, 200, 400, 800, 1200, 1700, 2300, 3000, 3800, 4800, 6000, 7600]
const SIGNIFICANT_DB = -40
const MIN_BANDS = 3

// In-place iterative radix-2 FFT.
export function fft(re, im, inverse = false) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr
      const ti = im[i]; im[i] = im[j]; im[j] = ti
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1
    const angle = (inverse ? 2 : -2) * Math.PI / size
    const wr = Math.cos(angle)
    const wi = Math.sin(angle)
    for (let start = 0; start < n; start += size) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < half; k += 1) {
        const a = start + k
        const b = a + half
        const xr = re[b] * cr - im[b] * ci
        const xi = re[b] * ci + im[b] * cr
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
        const next = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = next
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i += 1) { re[i] /= n; im[i] /= n }
}

// The part of a sample worth comparing: from where it stops being silent, for
// a few seconds. The attack and early decay carry nearly all of the energy.
export function activeWindow(samples, maxLength = WINDOW_SECONDS * RATE) {
  let peak = 0
  for (let i = 0; i < samples.length; i += 1) if (Math.abs(samples[i]) > peak) peak = Math.abs(samples[i])
  if (peak === 0) return new Float32Array(0)
  let start = 0
  while (start < samples.length && Math.abs(samples[start]) < peak * 0.02) start += 1
  return samples.subarray(start, Math.min(samples.length, start + maxLength))
}

// Best normalized cross-correlation of `needle` against every position in
// `haystack` where it fits entirely. 1 is identical up to gain; sign is
// ignored (a polarity flip is still the same recording).
export function bestCorrelation(needle, haystack) {
  if (needle.length < 64 || haystack.length < 64) return { score: 0, lag: 0 }
  const window = needle.length > haystack.length ? needle.subarray(0, haystack.length) : needle
  const n = window.length
  let size = 1
  while (size < haystack.length + n) size <<= 1
  const ar = new Float64Array(size)
  const ai = new Float64Array(size)
  const br = new Float64Array(size)
  const bi = new Float64Array(size)
  ar.set(haystack)
  br.set(window)
  fft(ar, ai)
  fft(br, bi)
  // haystack × conj(needle): the correlation at every lag in one transform.
  for (let i = 0; i < size; i += 1) {
    const r = ar[i] * br[i] + ai[i] * bi[i]
    const m = ai[i] * br[i] - ar[i] * bi[i]
    ar[i] = r
    ai[i] = m
  }
  fft(ar, ai, true)
  let needleEnergy = 0
  for (let i = 0; i < n; i += 1) needleEnergy += window[i] * window[i]
  if (needleEnergy === 0) return { score: 0, lag: 0 }
  // Energy of the haystack under the needle, at each lag.
  const prefix = new Float64Array(haystack.length + 1)
  for (let i = 0; i < haystack.length; i += 1) prefix[i + 1] = prefix[i] + haystack[i] * haystack[i]
  let best = { score: 0, lag: 0 }
  const floor = needleEnergy * 1e-6
  for (let lag = 0; lag + n <= haystack.length; lag += 1) {
    const energy = prefix[lag + n] - prefix[lag]
    if (energy <= floor) continue
    const score = Math.abs(ar[lag]) / Math.sqrt(needleEnergy * energy)
    if (score > best.score) best = { score, lag }
  }
  return best
}

// How alike two aligned signals are in each frequency band: the magnitude of
// their complex correlation over the band's bins. Magnitude, so that a
// fraction-of-a-sample misalignment (which only rotates phase) costs nothing.
export function bandCoherence(candidate, source) {
  const n = Math.min(candidate.length, source.length)
  let size = 1
  while (size < n) size <<= 1
  const cr = new Float64Array(size)
  const ci = new Float64Array(size)
  const sr = new Float64Array(size)
  const si = new Float64Array(size)
  cr.set(candidate.subarray(0, n))
  sr.set(source.subarray(0, n))
  fft(cr, ci)
  fft(sr, si)
  const bands = []
  let strongest = 0
  for (let band = 0; band + 1 < BAND_EDGES.length; band += 1) {
    const low = Math.round(BAND_EDGES[band] * size / RATE)
    const high = Math.min(size / 2, Math.round(BAND_EDGES[band + 1] * size / RATE))
    let real = 0
    let imaginary = 0
    let candidateEnergy = 0
    let sourceEnergy = 0
    for (let k = low; k < high; k += 1) {
      real += cr[k] * sr[k] + ci[k] * si[k]
      imaginary += ci[k] * sr[k] - cr[k] * si[k]
      candidateEnergy += cr[k] * cr[k] + ci[k] * ci[k]
      sourceEnergy += sr[k] * sr[k] + si[k] * si[k]
    }
    bands.push({ energy: candidateEnergy, coherence: candidateEnergy > 0 && sourceEnergy > 0 ? Math.hypot(real, imaginary) / Math.sqrt(candidateEnergy * sourceEnergy) : 0 })
    if (candidateEnergy > strongest) strongest = candidateEnergy
  }
  const significant = bands.filter((band) => strongest > 0 && 10 * Math.log10(band.energy / strongest) > SIGNIFICANT_DB).map((band) => band.coherence)
  if (significant.length < MIN_BANDS) return { bands: significant.length, score: 0, weakest: 0 }
  return { bands: significant.length, score: significant.reduce((total, value) => total + value, 0) / significant.length, weakest: Math.min(...significant) }
}

// Decode with ffmpeg to 32-bit float PCM at RATE. Returns one Float32Array per
// channel asked for.
export function decodeAudio(ffmpeg, file, { channels = 1, seconds = null } = {}) {
  const args = ['-v', 'error', '-nostdin', '-i', file, '-map', '0:a:0', '-vn', '-ac', String(channels), '-ar', String(RATE), ...(seconds ? ['-t', String(seconds)] : []), '-f', 'f32le', '-']
  const result = spawnSync(ffmpeg, args, { maxBuffer: 1024 * 1024 * 1024, timeout: 120_000 })
  if (result.status !== 0 || result.error) throw new Error(String(result.stderr || result.error?.message || 'ffmpeg failed').trim().slice(-300))
  const all = new Float32Array(result.stdout.buffer, result.stdout.byteOffset, Math.floor(result.stdout.byteLength / 4))
  if (channels === 1) return [Float32Array.from(all)]
  const frames = Math.floor(all.length / channels)
  return Array.from({ length: channels }, (_, channel) => {
    const out = new Float32Array(frames)
    for (let i = 0; i < frames; i += 1) out[i] = all[i * channels + channel]
    return out
  })
}

// The recording as the three things a candidate might have kept of it: the mix
// of both channels, the left one, the right one.
function sourceViews(ffmpeg, file, seconds) {
  const [left, right] = decodeAudio(ffmpeg, file, { channels: 2, seconds })
  const mid = new Float32Array(left.length)
  for (let i = 0; i < left.length; i += 1) mid[i] = (left[i] + right[i]) / 2
  return { mid, left, right }
}

export function matchSample(ffmpeg, candidateFile, sourceFile, cache = new Map()) {
  const [decoded] = decodeAudio(ffmpeg, candidateFile, { channels: 1 })
  const needle = activeWindow(decoded)
  if (needle.length < RATE / 50) return { status: 'silent', score: 0, seconds: decoded.length / RATE }
  const views = (seconds) => {
    const key = `${sourceFile}\0${seconds ?? 'all'}`
    if (!cache.has(key)) cache.set(key, sourceViews(ffmpeg, sourceFile, seconds))
    return cache.get(key)
  }
  let best = { score: 0, weakest: 0, bands: 0, correlation: 0, lag: 0, channel: 'mid' }
  // Near the start first (where a trimmed sample almost always begins), then anywhere.
  for (const seconds of [SEARCH_SECONDS, null]) {
    const source = views(seconds)
    for (const channel of ['mid', 'left', 'right']) {
      const aligned = bestCorrelation(needle, source[channel])
      const length = Math.min(needle.length, source[channel].length - aligned.lag)
      const compared = bandCoherence(needle.subarray(0, length), source[channel].subarray(aligned.lag, aligned.lag + length))
      if (compared.score > best.score || (best.bands === 0 && aligned.score > best.correlation)) best = { ...compared, correlation: aligned.score, lag: aligned.lag, channel }
      if (best.score >= 0.97) break
    }
    if (best.score >= MATCH_THRESHOLD || (seconds && source.mid.length < seconds * RATE)) break
  }
  return {
    status: best.score >= MATCH_THRESHOLD ? 'match' : best.bands < MIN_BANDS ? 'too-narrow' : 'mismatch',
    score: Number(best.score.toFixed(4)),
    weakestBand: Number(best.weakest.toFixed(4)),
    bands: best.bands,
    correlation: Number(best.correlation.toFixed(4)),
    offsetSeconds: Number((best.lag / RATE).toFixed(3)),
    channel: best.channel,
    seconds: Number((decoded.length / RATE).toFixed(3)),
  }
}

// Check a list of { path, packFile } entries. Decoded recordings are cached:
// several bundled samples often come from one recording.
export function matchEntries({ stage, pack, entries, ffmpeg = 'ffmpeg' }) {
  const cache = new Map()
  const results = []
  for (const entry of entries) {
    const candidateFile = path.join(stage, entry.path)
    const sourceFile = path.join(pack, entry.packFile)
    let result
    try {
      if (!fs.existsSync(candidateFile)) result = { status: 'missing', score: 0 }
      else if (!fs.existsSync(sourceFile)) result = { status: 'no-source', score: 0 }
      else result = matchSample(ffmpeg, candidateFile, sourceFile, cache)
    } catch (error) {
      result = { status: 'undecodable', score: 0, error: String(error.message).slice(0, 200) }
    }
    results.push({ path: entry.path, packFile: entry.packFile, ...result })
    // One recording's decoded views are megabytes; keep only the most recent few.
    while (cache.size > 6) cache.delete(cache.keys().next().value)
  }
  return { rate: RATE, threshold: MATCH_THRESHOLD, results }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const option = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : null)
  const request = JSON.parse(fs.readFileSync(option('request'), 'utf8'))
  const output = JSON.stringify(matchEntries(request))
  if (option('out')) fs.writeFileSync(option('out'), output)
  else process.stdout.write(`${output}\n`)
}
