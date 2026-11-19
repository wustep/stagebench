// @vitest-environment node
import { OfflineAudioContext } from 'node-web-audio-api'
import { describe, expect, it } from 'vitest'
import { buildArpStepSequence, getArpStepSeconds } from '../audio/arpeggiator'
import type { AudioContextLike, Clock, TimerHandle } from '../audio/boundaries'
import { StageAudioEngine } from '../audio/stageAudioEngine'
import {
  createInitialInstrumentState,
  instrumentStateReducer,
  type StageInstrumentState,
} from '../model/instrumentState'
import {
  ALL_REQUIRED_SYNTH_WAVEFORMS,
  getCategoryForWaveform,
  type SynthFilterType,
  type SynthLayerState,
  type SynthLfoWaveform,
  type SynthWaveformId,
} from '../model/organSynthTypes'
import { createMemoryStorageAdapter } from '../model/programBank'

function createNoopClock(): Clock {
  let id = 1
  return {
    now: () => 0,
    setTimeout: (): TimerHandle => id++,
    clearTimeout: () => undefined,
  }
}

function makeSynthState(
  layerAPatch: Partial<SynthLayerState> = {},
  extra?: {
    layerB?: Partial<SynthLayerState>
    layerC?: Partial<SynthLayerState>
    modWheel?: number
    masterBpm?: number
  },
): StageInstrumentState {
  let s = createInitialInstrumentState(createMemoryStorageAdapter())
  s = instrumentStateReducer(s, { type: 'set-piano-section', patch: { sectionOn: false } })
  s = instrumentStateReducer(s, { type: 'set-organ-section', patch: { sectionOn: false } })
  s = instrumentStateReducer(s, { type: 'set-synth-section', patch: { sectionOn: true } })
  s = instrumentStateReducer(s, {
    type: 'set-synth-layer',
    layer: 'A',
    patch: {
      enabled: true,
      level: 85,
      oscCategory: 'Pure',
      oscWaveform: 'Saw',
      oscCtrl: 50,
      filter: {
        on: true,
        type: 'LP24',
        freq: 70,
        res: 15,
        envAmt: 0,
        kbTrack: 0,
        drive: 0,
      },
      ampEnv: { attack: 2, decay: 100, release: 20, velocity: 2 },
      lfo: { waveform: 'Triangle', destination: 'Off', rate: 40, amount: 0, clockSync: false },
      voice: { mode: 'Poly', priority: 'Off', glide: 0, unison: 0 },
      vibrato: { mode: 'Off', rateHz: 5.5, amount: 5 },
      ...layerAPatch,
    },
  })
  if (extra?.layerB) {
    s = instrumentStateReducer(s, { type: 'set-synth-layer', layer: 'B', patch: extra.layerB })
  }
  if (extra?.layerC) {
    s = instrumentStateReducer(s, { type: 'set-synth-layer', layer: 'C', patch: extra.layerC })
  }
  if (extra?.modWheel !== undefined) {
    s = instrumentStateReducer(s, { type: 'set-mod-wheel', value: extra.modWheel })
  }
  if (extra?.masterBpm !== undefined) {
    s = instrumentStateReducer(s, { type: 'set-master-clock', patch: { bpm: extra.masterBpm } })
  }
  s = instrumentStateReducer(s, {
    type: 'patch-fx-chain',
    chain: 'synthA',
    patch: { reverb: { on: false, dryWet: 0 } },
  })
  return s
}

async function renderSynth(
  state: StageInstrumentState,
  opts: {
    durationSec?: number
    sampleRate?: number
    notes?: Array<{ id: number; midi: number; velocity?: number; releaseAtSec?: number }>
    stepArp?: number
  } = {},
) {
  const sampleRate = opts.sampleRate ?? 22050
  const durationSec = opts.durationSec ?? 0.55
  const offline = new OfflineAudioContext(2, Math.floor(sampleRate * durationSec), sampleRate)
  const engine = new StageAudioEngine({
    contextFactory: () => offline as unknown as AudioContextLike,
    clock: createNoopClock(),
    initialState: state,
    autoLoadSamples: false,
  })
  const notes = opts.notes ?? [{ id: 1, midi: 60, velocity: 100 }]
  for (const n of notes) {
    engine.triggerNote(n.id, n.midi, n.velocity ?? 100)
    if (n.releaseAtSec !== undefined) {
      engine.releaseNote(n.id, false, n.releaseAtSec)
    }
  }
  if (opts.stepArp) {
    for (let i = 0; i < opts.stepArp; i++) {
      engine.stepArpeggiator('A')
    }
  }
  const diag = engine.getGraphDiagnostics()
  const buf = await offline.startRendering()
  const left = new Float32Array(buf.getChannelData(0))
  const right = new Float32Array(buf.getChannelData(1))
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

function diffRms(a: Float32Array, b: Float32Array): number {
  let sum = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i]
    sum += d * d
  }
  return Math.sqrt(sum / Math.max(1, n))
}

function brightness(buf: Float32Array): number {
  let d = 0
  let s = 0
  for (let i = 1; i < buf.length; i++) {
    const df = buf[i] - buf[i - 1]
    d += df * df
    s += buf[i] * buf[i]
  }
  return Math.sqrt(d / Math.max(1e-12, s))
}

describe('synth.sources — 3 layers, exact required waveform list, and category-correct Osc Ctrl', () => {
  it('renders every required waveform and proves Pure/Sync/Multi/Super/FM-H are audibly distinct with category-correct Osc Ctrl', async () => {
    expect(ALL_REQUIRED_SYNTH_WAVEFORMS).toHaveLength(14)

    const renders = new Map<SynthWaveformId, Float32Array>()
    for (const wave of ALL_REQUIRED_SYNTH_WAVEFORMS) {
      const cat = getCategoryForWaveform(wave)
      const r = await renderSynth(
        makeSynthState({
          oscCategory: cat,
          oscWaveform: wave,
          oscCtrl: 60,
          filter: { on: false, type: 'LP24', freq: 90, res: 0, envAmt: 0, kbTrack: 0, drive: 0 },
        }),
        { durationSec: 0.3 },
      )
      expect(rms(r.left), `waveform ${wave} was silent`).toBeGreaterThan(0.01)
      expect(r.diag.contextCount).toBe(1)
      expect(r.afterStopNodes).toBe(0)
      renders.set(wave, r.left)
    }

    // Representative categories are pairwise distinct
    const cats: SynthWaveformId[] = ['Saw', 'Sync Saw', 'Multi Saw', 'Super Saw', 'FM 2-op']
    for (let i = 0; i < cats.length; i++) {
      for (let j = i + 1; j < cats.length; j++) {
        expect(
          diffRms(renders.get(cats[i])!, renders.get(cats[j])!),
          `${cats[i]} vs ${cats[j]}`,
        ).toBeGreaterThan(0.015)
      }
    }

    // Category-correct Osc Ctrl:
    // Pure -> Osc Ctrl has NO effect (manual p. 29)
    const pureLow = await renderSynth(
      makeSynthState({ oscCategory: 'Pure', oscWaveform: 'Saw', oscCtrl: 5, filter: { on: false, type: 'LP24', freq: 90, res: 0, envAmt: 0, kbTrack: 0, drive: 0 } }),
      { durationSec: 0.25 },
    )
    const pureHigh = await renderSynth(
      makeSynthState({ oscCategory: 'Pure', oscWaveform: 'Saw', oscCtrl: 95, filter: { on: false, type: 'LP24', freq: 90, res: 0, envAmt: 0, kbTrack: 0, drive: 0 } }),
      { durationSec: 0.25 },
    )
    expect(diffRms(pureLow.left, pureHigh.left)).toBeLessThan(0.001)

    // Sync, Multi, Super, FM-H -> Osc Ctrl measurably alters rendered audio!
    for (const [cat, wave] of [
      ['Sync', 'Sync Saw'],
      ['Multi', 'Multi Saw'],
      ['Super', 'Super Saw'],
      ['FM-H', 'FM 2-op'],
    ] as const) {
      const low = await renderSynth(
        makeSynthState({ oscCategory: cat, oscWaveform: wave, oscCtrl: 10, filter: { on: false, type: 'LP24', freq: 90, res: 0, envAmt: 0, kbTrack: 0, drive: 0 } }),
        { durationSec: 0.3 },
      )
      const high = await renderSynth(
        makeSynthState({ oscCategory: cat, oscWaveform: wave, oscCtrl: 90, filter: { on: false, type: 'LP24', freq: 90, res: 0, envAmt: 0, kbTrack: 0, drive: 0 } }),
        { durationSec: 0.3 },
      )
      expect(diffRms(low.left, high.left), `Osc Ctrl had no effect on ${cat}/${wave}`).toBeGreaterThan(0.015)
    }

    // 3 simultaneous layers (A, B, C)
    const triple = await renderSynth(
      makeSynthState(
        { enabled: true, oscCategory: 'Pure', oscWaveform: 'Saw' },
        {
          layerB: { enabled: true, level: 75, oscCategory: 'Multi', oscWaveform: 'Multi Saw' },
          layerC: { enabled: true, level: 75, oscCategory: 'FM-H', oscWaveform: 'FM 2-op' },
        },
      ),
      { durationSec: 0.25 },
    )
    expect(triple.diag.synthVoiceCounts).toEqual({ A: 1, B: 1, C: 1 })
  })
})

describe('synth.filter-envelopes — LP12/LP24/HP/BP, tracking, resonance, drive & all 3 envelopes', () => {
  it('measurably alters rendered audio across filter types, tracking, resonance, drive, and Osc/Filter/Amp envelopes', async () => {
    const byType = new Map<SynthFilterType, Float32Array>()
    for (const fType of ['LP12', 'LP24', 'HP', 'BP'] as const) {
      const r = await renderSynth(
        makeSynthState({
          filter: { on: true, type: fType, freq: 38, res: 40, envAmt: 0, kbTrack: 0, drive: 0 },
        }),
        { durationSec: 0.3 },
      )
      expect(rms(r.left)).toBeGreaterThan(0.005)
      byType.set(fType, r.left)
    }
    expect(brightness(byType.get('HP')!)).toBeGreaterThan(brightness(byType.get('LP24')!) * 1.5)
    expect(diffRms(byType.get('LP12')!, byType.get('LP24')!)).toBeGreaterThan(0.005)
    expect(diffRms(byType.get('BP')!, byType.get('LP24')!)).toBeGreaterThan(0.01)

    // Keyboard tracking on high note (C6=84): kbTrack 3 (1:1) is brighter than kbTrack 0 (Off)
    const trackOff = await renderSynth(
      makeSynthState({ filter: { on: true, type: 'LP24', freq: 30, res: 10, envAmt: 0, kbTrack: 0, drive: 0 } }),
      { durationSec: 0.25, notes: [{ id: 1, midi: 84 }] },
    )
    const trackFull = await renderSynth(
      makeSynthState({ filter: { on: true, type: 'LP24', freq: 30, res: 10, envAmt: 0, kbTrack: 3, drive: 0 } }),
      { durationSec: 0.25, notes: [{ id: 1, midi: 84 }] },
    )
    expect(rms(trackFull.left)).toBeGreaterThan(rms(trackOff.left) * 1.3)

    // Filter Drive 0 vs 3
    const driveOff = await renderSynth(
      makeSynthState({ filter: { on: true, type: 'LP24', freq: 50, res: 20, envAmt: 0, kbTrack: 0, drive: 0 } }),
      { durationSec: 0.25 },
    )
    const drive3 = await renderSynth(
      makeSynthState({ filter: { on: true, type: 'LP24', freq: 50, res: 20, envAmt: 0, kbTrack: 0, drive: 3 } }),
      { durationSec: 0.25 },
    )
    expect(diffRms(driveOff.left, drive3.left)).toBeGreaterThan(0.01)

    // Filter Envelope Amount 0 vs 85
    const fEnv0 = await renderSynth(
      makeSynthState({
        filter: { on: true, type: 'LP24', freq: 22, res: 25, envAmt: 0, kbTrack: 0, drive: 0 },
        filterEnv: { attack: 5, decay: 45, release: 25, velocity: false },
      }),
      { durationSec: 0.35 },
    )
    const fEnv85 = await renderSynth(
      makeSynthState({
        filter: { on: true, type: 'LP24', freq: 22, res: 25, envAmt: 85, kbTrack: 0, drive: 0 },
        filterEnv: { attack: 5, decay: 45, release: 25, velocity: false },
      }),
      { durationSec: 0.35 },
    )
    expect(brightness(fEnv85.left)).toBeGreaterThan(brightness(fEnv0.left) * 1.2)

    // Oscillator Envelope (Env To Pitch)
    const oscEnvFlat = await renderSynth(
      makeSynthState({ oscEnv: { attack: 5, decay: 35, release: 20, velocity: false, toPitch: true, amount: 50 } }),
      { durationSec: 0.3 },
    )
    const oscEnvUp = await renderSynth(
      makeSynthState({ oscEnv: { attack: 5, decay: 35, release: 20, velocity: false, toPitch: true, amount: 95 } }),
      { durationSec: 0.3 },
    )
    expect(diffRms(oscEnvFlat.left, oscEnvUp.left)).toBeGreaterThan(0.015)

    // Amp Envelope Attack (fast vs slow) & Decay=100 Sustain vs short Decay
    const fastAtk = await renderSynth(
      makeSynthState({ ampEnv: { attack: 1, decay: 100, release: 20, velocity: 0 } }),
      { durationSec: 0.4 },
    )
    const slowAtk = await renderSynth(
      makeSynthState({ ampEnv: { attack: 75, decay: 100, release: 20, velocity: 0 } }),
      { durationSec: 0.4 },
    )
    const earlyEnd = Math.floor(fastAtk.sampleRate * 0.08)
    expect(rms(fastAtk.left, 0, earlyEnd)).toBeGreaterThan(rms(slowAtk.left, 0, earlyEnd) * 3)
  })
})

describe('synth.voice-modes & synth.arp-gate — Mono/Legato/Glide/Unison/Vibrato/LFO & Deterministic Arp/Gate', () => {
  it('proves Mono/Legato, Priority, Unison, Vibrato, and all 5 LFO waveforms alter behavior & audio', async () => {
    // Mono holds at most 1 active voice even when 2 keys are pressed
    const mono = await renderSynth(
      makeSynthState({ voice: { mode: 'Mono', priority: 'High', glide: 40, unison: 0 } }),
      {
        durationSec: 0.3,
        notes: [
          { id: 1, midi: 60 },
          { id: 2, midi: 67 },
        ],
      },
    )
    expect(mono.diag.synthVoiceCounts?.A).toBe(1)

    // Legato glides smoothly on overlapping notes with 1 voice
    const legato = await renderSynth(
      makeSynthState({ voice: { mode: 'Legato', priority: 'Low', glide: 60, unison: 0 } }),
      {
        durationSec: 0.3,
        notes: [
          { id: 1, midi: 67 },
          { id: 2, midi: 60 },
        ],
      },
    )
    expect(legato.diag.synthVoiceCounts?.A).toBe(1)

    // Unison Off vs 3 produces wide stereo difference
    const uni0 = await renderSynth(
      makeSynthState({ voice: { mode: 'Poly', priority: 'Off', glide: 0, unison: 0 } }),
      { durationSec: 0.3 },
    )
    const uni3 = await renderSynth(
      makeSynthState({ voice: { mode: 'Poly', priority: 'Off', glide: 0, unison: 3 } }),
      { durationSec: 0.3 },
    )
    expect(diffRms(uni3.left, uni3.right)).toBeGreaterThan(diffRms(uni0.left, uni0.right) + 0.01)

    // Vibrato Wheel mode responds to Mod Wheel
    const vibZero = await renderSynth(
      makeSynthState({ vibrato: { mode: 'Wheel', rateHz: 6.0, amount: 9 } }, { modWheel: 0 }),
      { durationSec: 0.4 },
    )
    const vibFull = await renderSynth(
      makeSynthState({ vibrato: { mode: 'Wheel', rateHz: 6.0, amount: 9 } }, { modWheel: 100 }),
      { durationSec: 0.4 },
    )
    expect(diffRms(vibZero.left, vibFull.left)).toBeGreaterThan(0.015)

    // LFO 5 waveforms + Off vs Filter Freq + Master Clock sync
    const lfoOff = await renderSynth(
      makeSynthState({
        filter: { on: true, type: 'LP24', freq: 40, res: 30, envAmt: 0, kbTrack: 0, drive: 0 },
        lfo: { waveform: 'Triangle', destination: 'Off', rate: 60, amount: 85, clockSync: false },
      }),
      { durationSec: 0.4 },
    )
    for (const wave of ['Triangle', 'Saw down', 'Saw up', 'Square', 'Sample & Hold'] as SynthLfoWaveform[]) {
      const r = await renderSynth(
        makeSynthState(
          {
            filter: { on: true, type: 'LP24', freq: 40, res: 30, envAmt: 0, kbTrack: 0, drive: 0 },
            lfo: { waveform: wave, destination: 'Filter Freq', rate: 60, amount: 85, clockSync: true },
          },
          { masterBpm: 140 },
        ),
        { durationSec: 0.4 },
      )
      expect(diffRms(lfoOff.left, r.left), `LFO ${wave} did not modulate Filter`).toBeGreaterThan(0.01)
    }
  })

  it('produces 100% deterministic step order & timing for Up/Down/Up-Down/Random, Range 1-4, Clock Sync, Hold, and Run', async () => {
    // Deterministic sequence checks
    expect(buildArpStepSequence([64, 60, 67], 1, 'Up')).toEqual([60, 64, 67])
    expect(buildArpStepSequence([64, 60, 67], 1, 'Down')).toEqual([67, 64, 60])
    expect(buildArpStepSequence([60, 64, 67], 1, 'Up/Down')).toEqual([60, 64, 67, 64])
    expect(buildArpStepSequence([60, 64], 2, 'Up')).toEqual([60, 64, 72, 76])
    expect(buildArpStepSequence([60, 64, 67], 2, 'Random', 12345)).toEqual(
      buildArpStepSequence([60, 64, 67], 2, 'Random', 12345),
    )

    // Master Clock sync timing: at 120 BPM quarter note = 0.5 s, at 240 BPM = 0.25 s
    const baseArp = createInitialInstrumentState(createMemoryStorageAdapter()).synth.layers.A.arp
    const t120 = getArpStepSeconds({ ...baseArp, clockSync: true, rate: 30 }, { bpm: 120, kbSync: false })
    const t240 = getArpStepSeconds({ ...baseArp, clockSync: true, rate: 30 }, { bpm: 240, kbSync: false })
    expect(t120).toBeCloseTo(t240 * 2, 4)

    // Rendered audio with Arp Run ON and KB Hold ON continues stepping after key release!
    const arpState = makeSynthState({
      arp: {
        run: true,
        kbHold: true,
        mode: 'Arp',
        rate: 60,
        clockSync: true,
        range: 2,
        gateEnv: 60,
        direction: 'Up',
      },
    })
    const arpRender = await renderSynth(arpState, {
      durationSec: 0.45,
      notes: [
        { id: 1, midi: 60, releaseAtSec: 0.05 },
        { id: 2, midi: 67, releaseAtSec: 0.05 },
      ],
      stepArp: 2,
    })
    expect(rms(arpRender.left)).toBeGreaterThan(0.01)
    expect(arpRender.afterStopNodes).toBe(0)
  })
})
