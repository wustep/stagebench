// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { OfflineAudioContext } from 'node-web-audio-api'
import { describe, expect, it } from 'vitest'
import type { AudioContextLike, Clock, SampleFetcher, TimerHandle } from '../audio/boundaries'
import { NoteLifecycleController } from '../audio/noteLifecycle'
import { getBankManifest } from '../audio/sampleBankManager'
import { StageAudioEngine } from '../audio/stageAudioEngine'
import {
  createInitialInstrumentState,
  type PianoTypeId,
  type StageInstrumentState,
} from '../model/instrumentState'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.resolve(__dirname, '../../public')

const diskSampleFetcher: SampleFetcher = async (url: string) => {
  const rel = url.replace(/^\.\//, '')
  const buf = fs.readFileSync(path.join(PUBLIC_DIR, rel))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

function createNoopClock(): Clock {
  let id = 1
  return {
    now: () => 0,
    setTimeout: (): TimerHandle => id++,
    clearTimeout: () => undefined,
  }
}

interface StereoStats {
  readonly left: Float32Array
  readonly right: Float32Array
  readonly rms: number
  readonly peak: number
  readonly stereoDiffRms: number
  readonly highFreqEnergy: number
  readonly lowFreqEnergy: number
}

function analyzeBuffer(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  startSec = 0,
  endSec?: number,
): StereoStats {
  const start = Math.max(0, Math.floor(startSec * sampleRate))
  const end = Math.min(left.length, endSec !== undefined ? Math.floor(endSec * sampleRate) : left.length)
  const count = Math.max(1, end - start)
  let sumSq = 0
  let peak = 0
  let diffSq = 0
  let hfSq = 0
  let lfSq = 0
  let prevMono = 0
  let lp = 0
  for (let i = start; i < end; i++) {
    const l = left[i]
    const r = right[i]
    const mono = 0.5 * (l + r)
    sumSq += 0.5 * (l * l + r * r)
    peak = Math.max(peak, Math.abs(l), Math.abs(r))
    diffSq += (l - r) * (l - r)
    // First-difference weights treble (> 2 kHz) strongly vs fundamental
    const dh = mono - prevMono
    prevMono = mono
    lp += 0.16 * (mono - lp)
    lfSq += lp * lp
    hfSq += dh * dh
  }
  return {
    left,
    right,
    rms: Math.sqrt(sumSq / count),
    peak,
    stereoDiffRms: Math.sqrt(diffSq / count),
    highFreqEnergy: Math.sqrt(hfSq / count),
    lowFreqEnergy: Math.sqrt(lfSq / count),
  }
}

function waveformDiffRms(a: Float32Array, b: Float32Array, start = 0, end?: number): number {
  const n = Math.min(a.length, b.length, end ?? a.length)
  let sum = 0
  let count = 0
  for (let i = start; i < n; i++) {
    const d = a[i] - b[i]
    sum += d * d
    count++
  }
  return Math.sqrt(sum / Math.max(1, count))
}

function makeCleanState(mutator?: (s: StageInstrumentState) => StageInstrumentState): StageInstrumentState {
  let base = createInitialInstrumentState()
  // Turn off default subtle Booth reverb for pure dry piano measurements
  base = {
    ...base,
    effects: {
      ...base.effects,
      chains: {
        ...base.effects.chains,
        pianoA: {
          ...base.effects.chains.pianoA,
          reverb: { ...base.effects.chains.pianoA.reverb, on: false },
        },
      },
    },
  }
  return mutator ? mutator(base) : base
}

async function renderSingleNote(
  state: StageInstrumentState,
  opts: {
    midi?: number
    velocity?: number
    durationSec?: number
    releaseAtSec?: number
    preloadBank?: 'grand' | 'upright' | 'rhodes' | 'wurli'
    preloadBanks?: Array<'grand' | 'upright' | 'rhodes' | 'wurli'>
    sampleFetcher?: SampleFetcher
    sustainPedal?: boolean
    heldCompanionMidi?: number
  } = {},
) {
  const sr = 22050
  const dur = opts.durationSec ?? 0.6
  const offline = new OfflineAudioContext(2, Math.floor(sr * dur), sr)
  const ctxLike = offline as unknown as AudioContextLike
  const engine = new StageAudioEngine({
    contextFactory: () => ctxLike,
    sampleFetcher: opts.sampleFetcher ?? diskSampleFetcher,
    clock: createNoopClock(),
    autoLoadSamples: false,
    initialState: state,
  })

  const banksToLoad = opts.preloadBanks ?? (opts.preloadBank ? [opts.preloadBank] : [])
  for (const bankId of banksToLoad) {
    // Load just middle-register target sample(s) fast for deterministic test runtime
    const note = opts.midi ?? 60
    const vels = bankId === 'grand' ? ['v3', 'v10', 'v16'] : bankId === 'upright' ? ['vL', 'vH'] : bankId === 'wurli' ? ['mp', 'ff'] : ['v1']
    const manifest = getBankManifest(bankId)
    for (const vel of vels) {
      let best = manifest.find((r) => r.vel === vel) ?? manifest[0]
      let bestDist = Infinity
      for (const r of manifest) {
        if (r.vel !== vel) continue
        const d = Math.abs(r.midi - note)
        if (d < bestDist) {
          bestDist = d
          best = r
        }
      }
      if (best) {
        const raw = await (opts.sampleFetcher ?? diskSampleFetcher)(`./${best.file}`)
        const decoded = await ctxLike.decodeAudioData(raw)
        engine.sampleManager.injectDecodedBuffer(bankId, best.midi, best.vel, decoded)
      }
    }
  }

  if (opts.sustainPedal) {
    engine.setSustainPedalState(true)
  }
  if (opts.heldCompanionMidi !== undefined) {
    engine.triggerNote(99, opts.heldCompanionMidi, 80)
  }
  engine.triggerNote(1, opts.midi ?? 60, opts.velocity ?? 96)

  if (opts.releaseAtSec !== undefined) {
    engine.releaseNote(1, false, opts.releaseAtSec)
  }
  const rendered = await offline.startRendering()
  // Copy channel PCM out of native node-web-audio-api AudioBuffer before it can be GC'd
  const left = new Float32Array(rendered.getChannelData(0))
  const right = new Float32Array(rendered.getChannelData(1))
  const status = engine.getStatus()
  const diag = engine.getGraphDiagnostics()
  engine.stopAllImmediate()
  engine.dispose()
  return { left, right, sampleRate: sr, stats: analyzeBuffer(left, right, sr), status, diag }
}

describe('piano.instrument-library — 6 types, bundled recorded Grand/Upright/Electric, audibly distinct', () => {
  it('renders non-silent, audibly distinct waveforms across Grand, Upright, Rhodes, Wurlitzer, Clav, Digital, and Misc', async () => {
    const grand = await renderSingleNote(
      makeCleanState((s) => ({
        ...s,
        piano: { ...s.piano, layers: { ...s.piano.layers, A: { ...s.piano.layers.A, type: 'Grand', modelIndex: 0 } } },
      })),
      { preloadBank: 'grand', midi: 60, velocity: 96, durationSec: 0.45 },
    )

    const upright = await renderSingleNote(
      makeCleanState((s) => ({
        ...s,
        piano: { ...s.piano, layers: { ...s.piano.layers, A: { ...s.piano.layers.A, type: 'Upright', modelIndex: 0 } } },
      })),
      { preloadBank: 'upright', midi: 60, velocity: 96, durationSec: 0.45 },
    )

    const rhodes = await renderSingleNote(
      makeCleanState((s) => ({
        ...s,
        piano: { ...s.piano, layers: { ...s.piano.layers, A: { ...s.piano.layers.A, type: 'Electric', modelIndex: 0 } } },
      })),
      { preloadBank: 'rhodes', midi: 60, velocity: 96, durationSec: 0.45 },
    )

    const wurli = await renderSingleNote(
      makeCleanState((s) => ({
        ...s,
        piano: { ...s.piano, layers: { ...s.piano.layers, A: { ...s.piano.layers.A, type: 'Electric', modelIndex: 1 } } },
      })),
      { preloadBank: 'wurli', midi: 60, velocity: 96, durationSec: 0.45 },
    )

    const synthResults: Record<string, Float32Array> = {}
    for (const t of ['Clav', 'Digital', 'Misc'] as PianoTypeId[]) {
      const res = await renderSingleNote(
        makeCleanState((s) => ({
          ...s,
          piano: { ...s.piano, layers: { ...s.piano.layers, A: { ...s.piano.layers.A, type: t, modelIndex: 0 } } },
        })),
        { midi: 60, velocity: 96, durationSec: 0.45 },
      )
      expect(res.stats.rms, `${t} must not be silent`).toBeGreaterThan(0.01)
      expect(res.status.usingFallback).toBe(false)
      synthResults[t] = res.left
    }

    // All three recorded families render real, non-fallback, non-silent audio
    expect(grand.stats.rms).toBeGreaterThan(0.01)
    expect(upright.stats.rms).toBeGreaterThan(0.01)
    expect(rhodes.stats.rms).toBeGreaterThan(0.01)
    expect(wurli.stats.rms).toBeGreaterThan(0.01)
    expect(grand.status.usingFallback).toBe(false)
    expect(upright.status.usingFallback).toBe(false)
    expect(rhodes.status.usingFallback).toBe(false)
    expect(wurli.status.usingFallback).toBe(false)

    // Recorded Grand, Upright, Rhodes, Wurlitzer must be pairwise distinct
    expect(waveformDiffRms(grand.left, upright.left)).toBeGreaterThan(0.01)
    expect(waveformDiffRms(grand.left, rhodes.left)).toBeGreaterThan(0.01)
    expect(waveformDiffRms(upright.left, rhodes.left)).toBeGreaterThan(0.01)
    expect(waveformDiffRms(rhodes.left, wurli.left)).toBeGreaterThan(0.01)

    // Synthesized Clav, Digital, Misc must be pairwise distinct and distinct from Grand
    expect(waveformDiffRms(synthResults.Clav, synthResults.Digital)).toBeGreaterThan(0.01)
    expect(waveformDiffRms(synthResults.Clav, synthResults.Misc)).toBeGreaterThan(0.01)
    expect(waveformDiffRms(synthResults.Digital, synthResults.Misc)).toBeGreaterThan(0.01)
    expect(waveformDiffRms(grand.left, synthResults.Clav)).toBeGreaterThan(0.01)
  })
})

describe('piano.layers — two-layer enable, level, octave shift, voice ownership, cleanup', () => {
  it('sums enabled Layer A + Layer B, honors layer levels and octave shift, and isolates layer ownership', async () => {
    const onlyA = await renderSingleNote(
      makeCleanState((s) => ({
        ...s,
        piano: {
          ...s.piano,
          layers: {
            A: { ...s.piano.layers.A, enabled: true, type: 'Digital', level: 80, octave: 0 },
            B: { ...s.piano.layers.B, enabled: false, type: 'Clav', level: 80, octave: 0 },
          },
        },
      })),
      { midi: 60, velocity: 96, durationSec: 0.35 },
    )

    const aPlusB = await renderSingleNote(
      makeCleanState((s) => ({
        ...s,
        piano: {
          ...s.piano,
          layers: {
            A: { ...s.piano.layers.A, enabled: true, type: 'Digital', level: 80, octave: 0 },
            B: { ...s.piano.layers.B, enabled: true, type: 'Clav', level: 80, octave: 0 },
          },
        },
      })),
      { midi: 60, velocity: 96, durationSec: 0.35 },
    )

    const bOctaveUp = await renderSingleNote(
      makeCleanState((s) => ({
        ...s,
        piano: {
          ...s.piano,
          layers: {
            A: { ...s.piano.layers.A, enabled: false, type: 'Digital', level: 80, octave: 0 },
            B: { ...s.piano.layers.B, enabled: true, type: 'Misc', level: 85, octave: 1 },
          },
        },
      })),
      { midi: 60, velocity: 96, durationSec: 0.35 },
    )

    const bOctaveZero = await renderSingleNote(
      makeCleanState((s) => ({
        ...s,
        piano: {
          ...s.piano,
          layers: {
            A: { ...s.piano.layers.A, enabled: false, type: 'Digital', level: 80, octave: 0 },
            B: { ...s.piano.layers.B, enabled: true, type: 'Misc', level: 85, octave: 0 },
          },
        },
      })),
      { midi: 60, velocity: 96, durationSec: 0.35 },
    )

    const levelZero = await renderSingleNote(
      makeCleanState((s) => ({
        ...s,
        piano: {
          ...s.piano,
          layers: {
            A: { ...s.piano.layers.A, enabled: true, type: 'Digital', level: 0 },
            B: { ...s.piano.layers.B, enabled: false },
          },
        },
      })),
      { midi: 60, velocity: 96, durationSec: 0.25 },
    )

    expect(waveformDiffRms(onlyA.left, aPlusB.left)).toBeGreaterThan(0.01)
    expect(waveformDiffRms(bOctaveZero.left, bOctaveUp.left)).toBeGreaterThan(0.01)
    expect(bOctaveUp.stats.highFreqEnergy).toBeGreaterThan(bOctaveZero.stats.highFreqEnergy)
    expect(levelZero.stats.rms).toBeLessThan(0.002)

    // Voice ownership: disabling Layer B releases only Layer B voices while Layer A stays active
    const offline = new OfflineAudioContext(2, 4410, 22050)
    const stateBoth = makeCleanState((s) => ({
      ...s,
      piano: {
        ...s.piano,
        layers: {
          A: { ...s.piano.layers.A, enabled: true, type: 'Digital' },
          B: { ...s.piano.layers.B, enabled: true, type: 'Clav' },
        },
      },
    }))
    const engine = new StageAudioEngine({
      contextFactory: () => offline as unknown as AudioContextLike,
      clock: createNoopClock(),
      autoLoadSamples: false,
      initialState: stateBoth,
    })
    engine.triggerNote(1, 60, 96)
    expect(engine.getGraphDiagnostics().layerVoiceCounts).toEqual({ A: 1, B: 1 })

    engine.applyInstrumentState({
      ...stateBoth,
      piano: {
        ...stateBoth.piano,
        layers: { ...stateBoth.piano.layers, B: { ...stateBoth.piano.layers.B, enabled: false } },
      },
    })
    expect(engine.getGraphDiagnostics().layerVoiceCounts).toEqual({ A: 1, B: 0 })

    engine.stopAllImmediate()
    expect(engine.getActiveNodeCount()).toBe(0)
    engine.dispose()
  })
})

describe('piano.velocity-controls — KB Touch, Dyn Comp, Timbre, Unison, Soft Release, String Res, Master Level, Pitch Stick', () => {
  it('KB Touch Heavy < Medium < Light and Dyn Comp lifts soft stroke RMS', async () => {
    const heavy = await renderSingleNote(
      makeCleanState((s) => ({
        ...s,
        piano: { ...s.piano, layers: { ...s.piano.layers, A: { ...s.piano.layers.A, type: 'Digital', kbTouch: 'Heavy' } } },
      })),
      { midi: 60, velocity: 55, durationSec: 0.3 },
    )
    const med = await renderSingleNote(
      makeCleanState((s) => ({
        ...s,
        piano: { ...s.piano, layers: { ...s.piano.layers, A: { ...s.piano.layers.A, type: 'Digital', kbTouch: 'Medium' } } },
      })),
      { midi: 60, velocity: 55, durationSec: 0.3 },
    )
    const light = await renderSingleNote(
      makeCleanState((s) => ({
        ...s,
        piano: { ...s.piano, layers: { ...s.piano.layers, A: { ...s.piano.layers.A, type: 'Digital', kbTouch: 'Light' } } },
      })),
      { midi: 60, velocity: 55, durationSec: 0.3 },
    )
    expect(heavy.stats.rms).toBeLessThan(med.stats.rms)
    expect(med.stats.rms).toBeLessThan(light.stats.rms)

    const compOff = await renderSingleNote(
      makeCleanState((s) => ({
        ...s,
        piano: { ...s.piano, layers: { ...s.piano.layers, A: { ...s.piano.layers.A, type: 'Digital', dynComp: 0 } } },
      })),
      { midi: 60, velocity: 28, durationSec: 0.3 },
    )
    const comp3 = await renderSingleNote(
      makeCleanState((s) => ({
        ...s,
        piano: { ...s.piano, layers: { ...s.piano.layers, A: { ...s.piano.layers.A, type: 'Digital', dynComp: 3 } } },
      })),
      { midi: 60, velocity: 28, durationSec: 0.3 },
    )
    expect(comp3.stats.rms).toBeGreaterThan(compOff.stats.rms * 1.4)
  })

  it('Timbre (Soft/Mid/Bright/Dyno1/Dyno2), Unison (Off vs 3), Soft Release (disabled on Clav), String Res, Master Level, and Pitch Stick measurably alter audio', async () => {
    // Timbre on Electric (Wurlitzer EP200 recorded bank with rich upper reed harmonics)
    const timbreSoft = await renderSingleNote(
      makeCleanState((s) => ({
        ...s,
        piano: { ...s.piano, layers: { ...s.piano.layers, A: { ...s.piano.layers.A, type: 'Electric', modelIndex: 1, timbre: 'Soft' } } },
      })),
      { preloadBank: 'wurli', midi: 60, velocity: 115, durationSec: 0.35 },
    )
    const timbreBright = await renderSingleNote(
      makeCleanState((s) => ({
        ...s,
        piano: { ...s.piano, layers: { ...s.piano.layers, A: { ...s.piano.layers.A, type: 'Electric', modelIndex: 1, timbre: 'Bright' } } },
      })),
      { preloadBank: 'wurli', midi: 60, velocity: 115, durationSec: 0.35 },
    )
    const timbreDyno2 = await renderSingleNote(
      makeCleanState((s) => ({
        ...s,
        piano: { ...s.piano, layers: { ...s.piano.layers, A: { ...s.piano.layers.A, type: 'Electric', modelIndex: 1, timbre: 'Dyno 2' } } },
      })),
      { preloadBank: 'wurli', midi: 60, velocity: 115, durationSec: 0.35 },
    )
    expect(timbreBright.stats.highFreqEnergy).toBeGreaterThan(timbreSoft.stats.highFreqEnergy * 1.35)
    expect(timbreDyno2.stats.highFreqEnergy).toBeGreaterThan(timbreSoft.stats.highFreqEnergy * 1.3)
    expect(waveformDiffRms(timbreBright.left, timbreDyno2.left)).toBeGreaterThan(0.004)
    // Unison Off vs Unison 3 stereo spread
    const uniOff = await renderSingleNote(
      makeCleanState((s) => ({
        ...s,
        piano: { ...s.piano, layers: { ...s.piano.layers, A: { ...s.piano.layers.A, type: 'Digital', unison: 0 } } },
      })),
      { midi: 60, velocity: 96, durationSec: 0.35 },
    )
    const uni3 = await renderSingleNote(
      makeCleanState((s) => ({
        ...s,
        piano: { ...s.piano, layers: { ...s.piano.layers, A: { ...s.piano.layers.A, type: 'Digital', unison: 3 } } },
      })),
      { midi: 60, velocity: 96, durationSec: 0.35 },
    )
    expect(uni3.stats.stereoDiffRms).toBeGreaterThan(uniOff.stats.stereoDiffRms + 0.015)

    // Soft Release: extends tail on Grand/Digital, disabled on Clav
    const relNormal = await renderSingleNote(
      makeCleanState((s) => ({
        ...s,
        piano: { ...s.piano, layers: { ...s.piano.layers, A: { ...s.piano.layers.A, type: 'Digital', softRelease: false } } },
      })),
      { midi: 60, velocity: 96, durationSec: 0.85, releaseAtSec: 0.15 },
    )
    const relSoft = await renderSingleNote(
      makeCleanState((s) => ({
        ...s,
        piano: { ...s.piano, layers: { ...s.piano.layers, A: { ...s.piano.layers.A, type: 'Digital', softRelease: true } } },
      })),
      { midi: 60, velocity: 96, durationSec: 0.85, releaseAtSec: 0.15 },
    )
    const tailNormal = analyzeBuffer(relNormal.left, relNormal.right, relNormal.sampleRate, 0.35, 0.65).rms
    const tailSoft = analyzeBuffer(relSoft.left, relSoft.right, relSoft.sampleRate, 0.35, 0.65).rms
    expect(tailSoft).toBeGreaterThan(tailNormal * 1.8)

    const clavRelOff = await renderSingleNote(
      makeCleanState((s) => ({
        ...s,
        piano: { ...s.piano, layers: { ...s.piano.layers, A: { ...s.piano.layers.A, type: 'Clav', softRelease: false } } },
      })),
      { midi: 60, velocity: 96, durationSec: 0.6, releaseAtSec: 0.12 },
    )
    const clavRelOn = await renderSingleNote(
      makeCleanState((s) => ({
        ...s,
        piano: { ...s.piano, layers: { ...s.piano.layers, A: { ...s.piano.layers.A, type: 'Clav', softRelease: true } } },
      })),
      { midi: 60, velocity: 96, durationSec: 0.6, releaseAtSec: 0.12 },
    )
    expect(waveformDiffRms(clavRelOff.left, clavRelOn.left)).toBeLessThan(0.0005)

    // String Resonance when sustain pedal is held
    const srOff = await renderSingleNote(
      makeCleanState((s) => ({
        ...s,
        piano: { ...s.piano, layers: { ...s.piano.layers, A: { ...s.piano.layers.A, type: 'Digital', stringRes: false } } },
      })),
      { midi: 60, velocity: 96, durationSec: 0.4, sustainPedal: true },
    )
    const srOn = await renderSingleNote(
      makeCleanState((s) => ({
        ...s,
        piano: { ...s.piano, layers: { ...s.piano.layers, A: { ...s.piano.layers.A, type: 'Digital', stringRes: true } } },
      })),
      { midi: 60, velocity: 96, durationSec: 0.4, sustainPedal: true },
    )
    expect(waveformDiffRms(srOff.left, srOn.left)).toBeGreaterThan(0.005)

    // Master Level: 0% is silent, 100% > 50%
    const mst0 = await renderSingleNote(makeCleanState((s) => ({ ...s, masterLevel: 0 })), {
      midi: 60,
      velocity: 96,
      durationSec: 0.25,
    })
    const mst50 = await renderSingleNote(makeCleanState((s) => ({ ...s, masterLevel: 50 })), {
      midi: 60,
      velocity: 96,
      durationSec: 0.25,
    })
    const mst100 = await renderSingleNote(makeCleanState((s) => ({ ...s, masterLevel: 100 })), {
      midi: 60,
      velocity: 96,
      durationSec: 0.25,
    })
    expect(mst0.stats.rms).toBeLessThan(0.001)
    expect(mst100.stats.rms).toBeGreaterThan(mst50.stats.rms * 1.4)

    // Pitch Stick respects PSTICK toggle
    const noBend = await renderSingleNote(
      makeCleanState((s) => ({
        ...s,
        pitchStick: 0,
        piano: { ...s.piano, pstick: true, layers: { ...s.piano.layers, A: { ...s.piano.layers.A, type: 'Misc' } } },
      })),
      { midi: 60, velocity: 96, durationSec: 0.25 },
    )
    const bendOn = await renderSingleNote(
      makeCleanState((s) => ({
        ...s,
        pitchStick: 100,
        piano: { ...s.piano, pstick: true, layers: { ...s.piano.layers, A: { ...s.piano.layers.A, type: 'Misc' } } },
      })),
      { midi: 60, velocity: 96, durationSec: 0.25 },
    )
    const bendMutedByPstick = await renderSingleNote(
      makeCleanState((s) => ({
        ...s,
        pitchStick: 100,
        piano: { ...s.piano, pstick: false, layers: { ...s.piano.layers, A: { ...s.piano.layers.A, type: 'Misc' } } },
      })),
      { midi: 60, velocity: 96, durationSec: 0.25 },
    )
    expect(waveformDiffRms(noBend.left, bendOn.left)).toBeGreaterThan(0.02)
    expect(waveformDiffRms(noBend.left, bendMutedByPstick.left)).toBeLessThan(0.001)
  })
})

describe('piano.pedals — sustain honors SUSTPED toggle', () => {
  it('holds notes when SUSTPED is on and releases immediately when SUSTPED is turned off', () => {
    const released: number[] = []
    const backend = {
      unlock: async () => undefined,
      triggerNote: () => undefined,
      releaseNote: (id: number) => released.push(id),
      stopAllImmediate: () => undefined,
      getActiveNodeCount: () => 0,
      getStatus: () => ({
        status: 'ready' as const,
        loadedSamples: 1,
        totalSamples: 1,
        usingFallback: false,
        message: 'ready',
        audioContextState: 'running' as const,
      }),
      subscribeStatus: () => () => undefined,
      dispose: () => undefined,
    }
    const ctrl = new NoteLifecycleController(backend)
    ctrl.setSustainEnabled(true)
    ctrl.setSustain(true, 'midi:cc64')
    const vid = ctrl.noteOn(60, 100, 'midi:n1')!
    ctrl.noteOff(60, 'midi:n1')
    expect(released).toHaveLength(0)
    expect(ctrl.getSnapshot().sustainedNotes.has(60)).toBe(true)

    // Turning SUSTPED off releases sustained notes immediately even while pedal is down
    ctrl.setSustainEnabled(false)
    expect(released).toContain(vid)
    expect(ctrl.getSnapshot().sustainedNotes.size).toBe(0)

    // New notes while SUSTPED is off release immediately on noteOff
    const vid2 = ctrl.noteOn(64, 100, 'midi:n2')!
    ctrl.noteOff(64, 'midi:n2')
    expect(released).toContain(vid2)
  })
})

describe('piano.fallback — asset failure enters labeled playable fallback', () => {
  it('reports fallback status with failedBanks and renders audible fallback PCM without ever reporting primary ready', async () => {
    const failingFetcher: SampleFetcher = async () => {
      throw new Error('404 sample offline missing')
    }
    const sr = 22050
    const offline = new OfflineAudioContext(2, Math.floor(sr * 0.4), sr)
    const engine = new StageAudioEngine({
      contextFactory: () => offline as unknown as AudioContextLike,
      sampleFetcher: failingFetcher,
      clock: createNoopClock(),
      autoLoadSamples: false,
      initialState: makeCleanState(),
    })

    await engine.sampleManager.loadBank('grand', offline as unknown as AudioContextLike)
    const statusBeforeNote = engine.getStatus()
    expect(statusBeforeNote.status).toBe('fallback')
    expect(statusBeforeNote.usingFallback).toBe(true)
    expect(statusBeforeNote.failedBanks).toContain('grand')
    expect(statusBeforeNote.message).toMatch(/fallback/i)

    engine.triggerNote(1, 60, 100)
    const rendered = await offline.startRendering()
    const stats = analyzeBuffer(
      new Float32Array(rendered.getChannelData(0)),
      new Float32Array(rendered.getChannelData(1)),
      sr,
    )
    expect(stats.rms).toBeGreaterThan(0.01)
    expect(engine.getStatus().status).toBe('fallback')
    engine.dispose()
  })
})
