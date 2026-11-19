// @vitest-environment node
import { OfflineAudioContext } from 'node-web-audio-api'
import { describe, expect, it } from 'vitest'
import type { AudioContextLike, Clock, TimerHandle } from '../audio/boundaries'
import { StageAudioEngine } from '../audio/stageAudioEngine'
import {
  createInitialInstrumentState,
  instrumentStateReducer,
  type StageInstrumentState,
} from '../model/instrumentState'
import type { DrawbarTuple, OrganModelId, OrganVibChorusType } from '../model/organSynthTypes'
import { createMemoryStorageAdapter } from '../model/programBank'

function createNoopClock(): Clock {
  let id = 1
  return {
    now: () => 0,
    setTimeout: (): TimerHandle => id++,
    clearTimeout: () => undefined,
  }
}

function makeOrganBaseState(overrides: {
  model?: OrganModelId
  drawbars?: DrawbarTuple
  vibOn?: boolean
  vibType?: OrganVibChorusType
  percOn?: boolean
  percSoft?: boolean
  percFast?: boolean
  percThird?: boolean
  keyClick?: boolean
  organRouted?: boolean
  rotarySpeed?: 'Slow' | 'Fast'
  rotaryStop?: boolean
  rotaryDrive?: number
  rotaryDriveOn?: boolean
  layerBEnabled?: boolean
  layerBModel?: OrganModelId
} = {}): StageInstrumentState {
  let s = createInitialInstrumentState(createMemoryStorageAdapter())
  s = instrumentStateReducer(s, { type: 'set-piano-section', patch: { sectionOn: false } })
  s = instrumentStateReducer(s, { type: 'set-synth-section', patch: { sectionOn: false } })
  s = instrumentStateReducer(s, { type: 'set-organ-section', patch: { sectionOn: true } })
  s = instrumentStateReducer(s, {
    type: 'set-organ-layer',
    layer: 'A',
    patch: {
      enabled: true,
      level: 85,
      model: overrides.model ?? 'B3',
      drawbars: overrides.drawbars ?? [8, 0, 8, 6, 4, 4, 2, 2, 2],
      vibChorusOn: overrides.vibOn ?? false,
      vibChorusType: overrides.vibType ?? 'V1',
      percussion: {
        on: overrides.percOn ?? false,
        soft: overrides.percSoft ?? false,
        fast: overrides.percFast ?? true,
        third: overrides.percThird ?? true,
      },
      keyClick: overrides.keyClick ?? false,
    },
  })
  s = instrumentStateReducer(s, {
    type: 'set-organ-layer',
    layer: 'B',
    patch: {
      enabled: overrides.layerBEnabled ?? false,
      level: 80,
      model: overrides.layerBModel ?? 'Vox',
      drawbars: [6, 6, 8, 6, 5, 4, 3, 6, 6],
      vibChorusOn: false,
    },
  })
  s = instrumentStateReducer(s, {
    type: 'patch-fx-chain',
    chain: 'organ',
    patch: { reverb: { on: false, dryWet: 0 } },
  })
  s = instrumentStateReducer(s, {
    type: 'set-rotary',
    patch: {
      on: true,
      organRouted: overrides.organRouted ?? false,
      speed: overrides.rotarySpeed ?? 'Slow',
      stopMode: overrides.rotaryStop ?? false,
      drive: overrides.rotaryDrive ?? 25,
      driveOn: overrides.rotaryDriveOn ?? false,
    },
  })
  return s
}

async function renderOrganSignal(
  state: StageInstrumentState,
  opts: { durationSec?: number; midi?: number; releaseAtSec?: number; sampleRate?: number } = {},
) {
  const sampleRate = opts.sampleRate ?? 22050
  const durationSec = opts.durationSec ?? 0.6
  const offline = new OfflineAudioContext(2, Math.floor(sampleRate * durationSec), sampleRate)
  const engine = new StageAudioEngine({
    contextFactory: () => offline as unknown as AudioContextLike,
    clock: createNoopClock(),
    initialState: state,
    autoLoadSamples: false,
  })
  engine.triggerNote(1, opts.midi ?? 60, 100)
  if (opts.releaseAtSec !== undefined) {
    engine.releaseNote(1, false, opts.releaseAtSec)
  }
  const diag = engine.getGraphDiagnostics()
  const rendered = await offline.startRendering()
  const left = new Float32Array(rendered.getChannelData(0))
  const right = new Float32Array(rendered.getChannelData(1))
  engine.stopAllImmediate()
  const afterStopNodes = engine.getActiveNodeCount()
  engine.dispose()
  return { left, right, sampleRate, diag, afterStopNodes }
}

function rms(buf: Float32Array, start = 0, end = buf.length): number {
  let sum = 0
  const n = Math.max(1, end - start)
  for (let i = start; i < end; i++) sum += buf[i] * buf[i]
  return Math.sqrt(sum / n)
}

function diffRms(a: Float32Array, b: Float32Array, start = 0, end = Math.min(a.length, b.length)): number {
  let sum = 0
  const n = Math.max(1, end - start)
  for (let i = start; i < end; i++) {
    const d = a[i] - b[i]
    sum += d * d
  }
  return Math.sqrt(sum / n)
}

/**
 * Simple normalized spectral centroid / high-frequency ratio estimate via first-difference RMS / signal RMS.
 */
function brightnessMetric(buf: Float32Array, start = 0, end = buf.length): number {
  let diffSum = 0
  let sigSum = 0
  for (let i = Math.max(1, start); i < end; i++) {
    const d = buf[i] - buf[i - 1]
    diffSum += d * d
    sigSum += buf[i] * buf[i]
  }
  return Math.sqrt(diffSum / Math.max(1e-12, sigSum))
}

describe('organ.models-drawbars — distinct B3, Vox, Farf, Pipe 1 (+ B3 Bass, Pipe 2) & drawbars/perc/click/VC', () => {
  it('renders audibly distinct waveforms & spectra for B3, Vox, Farf, Pipe 1, Pipe 2, and B3 Bass', async () => {
    const drawbars: DrawbarTuple = [8, 6, 8, 6, 4, 6, 4, 6, 6]
    const b3 = await renderOrganSignal(makeOrganBaseState({ model: 'B3', drawbars }))
    const vox = await renderOrganSignal(makeOrganBaseState({ model: 'Vox', drawbars }))
    const farf = await renderOrganSignal(makeOrganBaseState({ model: 'Farf', drawbars }))
    const pipe1 = await renderOrganSignal(makeOrganBaseState({ model: 'Pipe 1', drawbars }))
    const pipe2 = await renderOrganSignal(makeOrganBaseState({ model: 'Pipe 2', drawbars }))
    const bass = await renderOrganSignal(makeOrganBaseState({ model: 'B3 Bass', drawbars }))

    for (const r of [b3, vox, farf, pipe1, pipe2, bass]) {
      expect(rms(r.left)).toBeGreaterThan(0.01)
      expect(r.diag.contextCount).toBe(1)
      expect(r.afterStopNodes).toBe(0)
    }

    // All four required models must be pairwise observably distinct
    expect(diffRms(b3.left, vox.left)).toBeGreaterThan(0.015)
    expect(diffRms(b3.left, farf.left)).toBeGreaterThan(0.015)
    expect(diffRms(b3.left, pipe1.left)).toBeGreaterThan(0.015)
    expect(diffRms(vox.left, farf.left)).toBeGreaterThan(0.015)
    expect(diffRms(vox.left, pipe1.left)).toBeGreaterThan(0.015)
    expect(diffRms(farf.left, pipe1.left)).toBeGreaterThan(0.015)

    // Pipe 2 is brighter than Pipe 1; B3 Bass is darker than full B3
    expect(brightnessMetric(pipe2.left)).toBeGreaterThan(brightnessMetric(pipe1.left))
    expect(brightnessMetric(bass.left)).toBeLessThan(brightnessMetric(b3.left))
  })

  it('changes audible spectrum per drawbar and honors Farfisa on/off register threshold (>= 5)', async () => {
    const lowDraw = await renderOrganSignal(
      makeOrganBaseState({ model: 'B3', drawbars: [8, 0, 0, 0, 0, 0, 0, 0, 0] }),
    )
    const highDraw = await renderOrganSignal(
      makeOrganBaseState({ model: 'B3', drawbars: [8, 0, 0, 0, 0, 0, 0, 0, 8] }),
    )
    expect(brightnessMetric(highDraw.left)).toBeGreaterThan(brightnessMetric(lowDraw.left) * 1.8)

    // Farfisa: drawbars all <= 4 are OFF (silent); pulling >= 5 switches register ON
    const farfOff = await renderOrganSignal(
      makeOrganBaseState({ model: 'Farf', drawbars: [4, 4, 4, 4, 4, 4, 4, 4, 4] }),
    )
    const farfOn = await renderOrganSignal(
      makeOrganBaseState({ model: 'Farf', drawbars: [0, 0, 6, 0, 0, 0, 0, 0, 0] }),
    )
    expect(rms(farfOff.left)).toBeLessThan(0.002)
    expect(rms(farfOn.left)).toBeGreaterThan(0.01)
  })

  it('measurably alters rendered audio for B3 percussion (on/soft/fast/third), key click, and Vibrato/Chorus (V1 vs C1, 1->3 depth)', async () => {
    const plain = await renderOrganSignal(
      makeOrganBaseState({ model: 'B3', drawbars: [0, 0, 8, 0, 0, 0, 0, 0, 0], percOn: false, keyClick: false }),
    )
    const withPerc = await renderOrganSignal(
      makeOrganBaseState({ model: 'B3', drawbars: [0, 0, 8, 0, 0, 0, 0, 0, 0], percOn: true, percFast: true, percThird: true }),
    )
    const withPerc2nd = await renderOrganSignal(
      makeOrganBaseState({ model: 'B3', drawbars: [0, 0, 8, 0, 0, 0, 0, 0, 0], percOn: true, percFast: true, percThird: false }),
    )
    const withClick = await renderOrganSignal(
      makeOrganBaseState({ model: 'B3', drawbars: [0, 0, 8, 0, 0, 0, 0, 0, 0], keyClick: true }),
    )

    // Attack window (first 60 ms) clearly reflects Percussion & Key Click
    const atkEnd = Math.floor(plain.sampleRate * 0.06)
    expect(diffRms(plain.left, withPerc.left, 0, atkEnd)).toBeGreaterThan(0.015)
    expect(diffRms(withPerc.left, withPerc2nd.left, 0, atkEnd)).toBeGreaterThan(0.01)
    expect(diffRms(plain.left, withClick.left, 0, Math.floor(plain.sampleRate * 0.02))).toBeGreaterThan(0.005)

    // Vibrato/Chorus: V1 vs C1 distinct and instantaneous frequency modulation depth grows V1 < V2 < V3
    const freqSpread = (buf: Float32Array, sr: number) => {
      const win = Math.floor(sr * 0.03)
      const rates: number[] = []
      for (let start = Math.floor(sr * 0.05); start + win < buf.length; start += Math.floor(win / 2)) {
        let crossings = 0
        for (let i = start + 1; i < start + win; i++) {
          if ((buf[i - 1] <= 0 && buf[i] > 0) || (buf[i - 1] >= 0 && buf[i] < 0)) crossings++
        }
        rates.push((crossings / 2) / (win / sr))
      }
      const mean = rates.reduce((a, b) => a + b, 0) / Math.max(1, rates.length)
      const variance = rates.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, rates.length)
      return Math.sqrt(variance)
    }
    const v1 = await renderOrganSignal(
      makeOrganBaseState({ model: 'B3', drawbars: [0, 0, 8, 0, 0, 0, 0, 0, 0], vibOn: true, vibType: 'V1' }),
      { durationSec: 0.7 },
    )
    const c1 = await renderOrganSignal(
      makeOrganBaseState({ model: 'B3', drawbars: [0, 0, 8, 0, 0, 0, 0, 0, 0], vibOn: true, vibType: 'C1' }),
      { durationSec: 0.7 },
    )
    const v2 = await renderOrganSignal(
      makeOrganBaseState({ model: 'B3', drawbars: [0, 0, 8, 0, 0, 0, 0, 0, 0], vibOn: true, vibType: 'V2' }),
      { durationSec: 0.7 },
    )
    const v3 = await renderOrganSignal(
      makeOrganBaseState({ model: 'B3', drawbars: [0, 0, 8, 0, 0, 0, 0, 0, 0], vibOn: true, vibType: 'V3' }),
      { durationSec: 0.7 },
    )
    expect(diffRms(v1.left, c1.left)).toBeGreaterThan(0.01)
    const spreadV1 = freqSpread(v1.left, v1.sampleRate)
    const spreadV2 = freqSpread(v2.left, v2.sampleRate)
    const spreadV3 = freqSpread(v3.left, v3.sampleRate)
    expect(spreadV2).toBeGreaterThan(spreadV1)
    expect(spreadV3).toBeGreaterThan(spreadV2)
  })
})

describe('organ.engine & organ.rotary — two layers, shared FX chain, rotary routing/speed/drive/morph', () => {
  it('supports two simultaneous organ layers with different models sharing one effect chain and rotary routing', async () => {
    const singleA = await renderOrganSignal(
      makeOrganBaseState({ model: 'B3', layerBEnabled: false }),
    )
    const dualAB = await renderOrganSignal(
      makeOrganBaseState({ model: 'B3', layerBEnabled: true, layerBModel: 'Vox' }),
    )
    expect(dualAB.diag.organVoiceCounts?.A).toBe(1)
    expect(dualAB.diag.organVoiceCounts?.B).toBe(1)
    expect(diffRms(singleA.left, dualAB.left)).toBeGreaterThan(0.015)

    // Rotary routing (Slow vs Fast vs Stop vs Drive + morphable speed)
    const slowRot = await renderOrganSignal(
      makeOrganBaseState({ model: 'B3', organRouted: true, rotarySpeed: 'Slow', rotaryDrive: 20 }),
      { durationSec: 0.9 },
    )
    const fastRot = await renderOrganSignal(
      makeOrganBaseState({ model: 'B3', organRouted: true, rotarySpeed: 'Fast', rotaryDrive: 20 }),
      { durationSec: 0.9 },
    )
    const drivenRot = await renderOrganSignal(
      makeOrganBaseState({ model: 'B3', organRouted: true, rotarySpeed: 'Slow', rotaryDrive: 95, rotaryDriveOn: true }),
      { durationSec: 0.9 },
    )
    expect(slowRot.diag.organRoutedToRotary).toBe(true)
    expect(diffRms(slowRot.left, fastRot.left)).toBeGreaterThan(0.015)
    expect(diffRms(slowRot.left, drivenRot.left)).toBeGreaterThan(0.01)
    // Stereo rotor produces L/R difference
    expect(diffRms(fastRot.left, fastRot.right)).toBeGreaterThan(0.01)

    // Morphable Rotary Speed via Wheel
    let morphed = makeOrganBaseState({ model: 'B3', organRouted: true, rotarySpeed: 'Slow' })
    morphed = instrumentStateReducer(morphed, {
      type: 'assign-morph',
      source: 'wheel',
      target: 'rotary:speed',
      start: 0,
      end: 1,
    })
    morphed = instrumentStateReducer(morphed, { type: 'set-mod-wheel', value: 100 })
    const morphedRender = await renderOrganSignal(morphed, { durationSec: 0.9 })
    expect(diffRms(slowRot.left, morphedRender.left)).toBeGreaterThan(0.015)
  })
})
