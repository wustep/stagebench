/**
 * Offline mirror of one Piano layer for tests: the same sample selection, velocity / KB Touch / Dyn Comp /
 * Unison / Soft Release rules as the runtime engine (shared helpers), rendered into stereo Float32Arrays
 * and optionally run through the real LayerChain DSP (Timbre, String Res, effects) and the master path.
 * Tests use it to prove that every functional piano control measurably changes rendered audio.
 */
import { LayerChain } from '../dsp/chain'
import { MasterUnit } from '../dsp/master'
import { mergeChainParams, type ChainOverrides, type StereoBuffer } from '../dsp/offline'
import { defaultChainParams, masterKnobToGain, type ChainParams, type TimbreParams } from '../dsp/types'
import { LAYER_VELOCITIES, RELEASE_SECONDS, SOFT_RELEASE_SECONDS, UNISON_CENTS, UNISON_SIDE_LEVEL, applyKbTouch, dynCompGain } from './engine'
import { renderPianoNote, velocityGain, velocityLayer, type PianoRenderParams } from './pianoRenderer'
import { pickSample, type LoadedSet } from './sampleLibrary'

export interface OfflinePianoEvent {
  time: number
  type: 'on' | 'off' | 'sustain'
  midi?: number
  velocity?: number
  on?: boolean
}

export interface OfflinePianoOptions {
  sampleRate?: number
  seconds?: number
  /** Recorded set; omitted = the generated renderer (Phase 1 additive piano). */
  set?: LoadedSet | null
  renderer?: (p: PianoRenderParams) => Float32Array
  kbTouch?: number
  dynComp?: number
  unison?: number
  softRelease?: boolean
  softReleaseSupported?: boolean
  stringRes?: boolean
  /** Extra undamped strings (keys held silently, e.g. after their sound decayed) for String Res. */
  heldStrings?: number[]
  timbre?: number
  family?: TimbreParams['family']
  octave?: number
  /** SUSTPED: false makes the pedal events inert (the section ignores the pedal). */
  sustped?: boolean
  /** Runs the mix through a LayerChain with these overrides (null / undefined = no chain). */
  chain?: ChainOverrides | null
  /** Master Level knob 0..10 (default 10 = unity) and whether the master limiter runs. */
  masterLevel?: number
  limiter?: boolean
  blockSize?: number
}

const GAIN_FLOOR = 0.0005

interface OfflineVoice {
  midi: number
  data: Float32Array
  rate: number
  level: number
  start: number
  keyDown: boolean
  sustained: boolean
  releaseAt: number | null
  releaseSeconds: number
  detune: number[]
  side: number
}

/** Constant-power pan gains for a position in −1..1. */
export function panGains(position: number): [number, number] {
  const a = ((Math.min(1, Math.max(-1, position)) + 1) * Math.PI) / 4
  return [Math.cos(a), Math.sin(a)]
}

export function renderPiano(events: OfflinePianoEvent[], options: OfflinePianoOptions = {}): StereoBuffer {
  const sr = options.sampleRate ?? 22050
  const seconds = options.seconds ?? 2
  const length = Math.round(seconds * sr)
  const l = new Float32Array(length)
  const r = new Float32Array(length)
  const renderer = options.renderer ?? renderPianoNote
  const kbTouch = options.kbTouch ?? 1
  const dynComp = options.dynComp ?? 0
  const unison = Math.min(3, Math.max(0, options.unison ?? 0))
  const octave = options.octave ?? 0
  const sustped = options.sustped ?? true
  const releaseSeconds = options.softRelease && (options.softReleaseSupported ?? true) ? SOFT_RELEASE_SECONDS : RELEASE_SECONDS
  const sorted = [...events].sort((a, b) => a.time - b.time)
  const voices: OfflineVoice[] = []
  let sustain = false
  const release = (v: OfflineVoice, t: number) => {
    if (v.releaseAt === null) v.releaseAt = t
  }
  for (const e of sorted) {
    if (e.type === 'on' && e.midi !== undefined) {
      for (const v of voices) if (v.midi === e.midi && v.releaseAt === null) release(v, e.time)
      const played = e.midi + octave * 12
      const touched = applyKbTouch(e.velocity ?? 100, kbTouch)
      const natural = velocityGain(touched)
      let data: Float32Array
      let rate = 1
      let level: number
      if (options.set) {
        const pick = pickSample(options.set, played, touched)
        if (!pick) continue
        data = pick.sample.data
        rate = pick.playbackRate * (pick.sample.sampleRate / sr)
        const layerInfo = options.set.manifest.layers[pick.layer]
        const inLayer = Math.min(1.5, Math.max(0.35, layerInfo ? natural / velocityGain(layerInfo.velocity) : 1))
        level = inLayer * (dynCompGain(natural, dynComp) / natural)
      } else {
        const layerVelocity = LAYER_VELOCITIES[velocityLayer(touched)]
        data = renderer({ midi: played, velocity: layerVelocity, sampleRate: sr, maxSeconds: seconds })
        level = dynCompGain(natural, dynComp) / velocityGain(layerVelocity)
      }
      const cents = UNISON_CENTS[unison]
      const side = UNISON_SIDE_LEVEL[unison]
      voices.push({ midi: e.midi, data, rate, level: level / (1 + side * 0.7), start: e.time, keyDown: true, sustained: false, releaseAt: null, releaseSeconds, detune: unison > 0 ? [0, -cents, cents] : [0], side })
    } else if (e.type === 'off' && e.midi !== undefined) {
      for (const v of voices) {
        if (v.midi === e.midi && v.keyDown) {
          v.keyDown = false
          if (sustain && sustped) v.sustained = true
          else release(v, e.time)
        }
      }
    } else if (e.type === 'sustain') {
      sustain = !!e.on
      if (!sustain) for (const v of voices) if (v.sustained && !v.keyDown) release(v, e.time)
    }
  }
  // Mix: resample with linear interpolation, apply the exponential release ramp and unison panning.
  for (const v of voices) {
    const startSample = Math.round(v.start * sr)
    const relSample = v.releaseAt === null ? Infinity : Math.round((v.releaseAt - v.start) * sr)
    const relLen = Math.max(1, Math.round(v.releaseSeconds * sr))
    v.detune.forEach((cents, i) => {
      const rate = v.rate * Math.pow(2, cents / 1200)
      const gain = i === 0 ? v.level : v.level * v.side
      const [gl, gr] = i === 0 ? [Math.SQRT1_2, Math.SQRT1_2] : panGains(cents < 0 ? -0.85 : 0.85)
      const total = Math.floor((v.data.length - 1) / rate)
      for (let k = 0; k < total; k++) {
        const o = startSample + k
        if (o >= length) break
        let g = gain
        if (k >= relSample) {
          const j = k - relSample
          if (j >= relLen) break
          g *= Math.pow(GAIN_FLOOR, j / relLen)
        }
        const pos = k * rate
        const idx = Math.floor(pos)
        const frac = pos - idx
        const sample = v.data[idx] * (1 - frac) + v.data[idx + 1] * frac
        l[o] += sample * g * gl
        r[o] += sample * g * gr
      }
    })
  }
  const chainOverrides = options.chain
  const stringRes = options.stringRes ?? false
  const timbre = options.timbre ?? 0
  if (chainOverrides !== null && chainOverrides !== undefined) {
    const params: ChainParams = mergeChainParams(defaultChainParams(), chainOverrides)
    params.timbre = { family: options.family ?? 'acoustic', setting: timbre }
    const chain = new LayerChain(sr)
    const block = options.blockSize ?? 128
    const bl = new Float32Array(block)
    const br = new Float32Array(block)
    for (let start = 0; start < length; start += block) {
      const n = Math.min(block, length - start)
      const t = start / sr
      const pedal = sustped && isPedalDown(sorted, t)
      const strings = stringRes ? [...new Set([...(options.heldStrings ?? []), ...voices.filter((v) => v.start <= t && (v.releaseAt === null || v.releaseAt > t)).map((v) => v.midi + octave * 12)])].sort((a, b) => a - b) : []
      chain.setParams({ ...params, stringRes: { on: stringRes, strings, pedal } })
      bl.set(l.subarray(start, start + n))
      br.set(r.subarray(start, start + n))
      chain.process(bl, br, n)
      l.set(bl.subarray(0, n), start)
      r.set(br.subarray(0, n), start)
    }
  }
  const master = masterKnobToGain(options.masterLevel ?? 10)
  for (let i = 0; i < length; i++) {
    l[i] *= master
    r[i] *= master
  }
  if (options.limiter) {
    const unit = new MasterUnit(sr)
    unit.setParams({ level: 10 })
    const block = options.blockSize ?? 128
    const bl = new Float32Array(block)
    const br = new Float32Array(block)
    for (let start = 0; start < length; start += block) {
      const n = Math.min(block, length - start)
      bl.set(l.subarray(start, start + n))
      br.set(r.subarray(start, start + n))
      unit.process(bl, br, n)
      l.set(bl.subarray(0, n), start)
      r.set(br.subarray(0, n), start)
    }
  }
  return { l, r }
}

function isPedalDown(events: OfflinePianoEvent[], t: number): boolean {
  let down = false
  for (const e of events) {
    if (e.time > t) break
    if (e.type === 'sustain') down = !!e.on
  }
  return down
}

/** Mono mix of a stereo buffer. */
export function mono(buffer: StereoBuffer): Float32Array {
  const out = new Float32Array(buffer.l.length)
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * (buffer.l[i] + buffer.r[i])
  return out
}
