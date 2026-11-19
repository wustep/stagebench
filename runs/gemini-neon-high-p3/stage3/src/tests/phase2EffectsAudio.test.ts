// @vitest-environment node
import { OfflineAudioContext } from 'node-web-audio-api'
import { describe, expect, it } from 'vitest'
import type { AudioContextLike, Clock, TimerHandle } from '../audio/boundaries'
import { StageAudioEngine } from '../audio/stageAudioEngine'
import {
  AMP_EQ_TYPES,
  createInitialInstrumentState,
  instrumentStateReducer,
  MOD1_TYPES,
  MOD2_TYPES,
  REVERB_TYPES,
  resolveEffectiveChainForLayer,
  type AmpEqType,
  type DelayFilterType,
  type Mod1Type,
  type Mod2Type,
  type ReverbType,
  type StageInstrumentState,
} from '../model/instrumentState'

function createNoopClock(): Clock {
  let id = 1
  return {
    now: () => 0,
    setTimeout: (): TimerHandle => id++,
    clearTimeout: () => undefined,
  }
}

function makeDryBaseState(): StageInstrumentState {
  const base = createInitialInstrumentState()
  return {
    ...base,
    masterLevel: 80,
    piano: {
      ...base.piano,
      layers: {
        ...base.piano.layers,
        A: {
          ...base.piano.layers.A,
          enabled: true,
          type: 'Digital',
          modelIndex: 0,
          level: 90,
          stringRes: false,
        },
        B: {
          ...base.piano.layers.B,
          enabled: false,
          type: 'Clav',
          modelIndex: 0,
          level: 85,
          stringRes: false,
        },
      },
    },
    effects: {
      ...base.effects,
      allOn: true,
      chains: {
        ...base.effects.chains,
        pianoA: {
          ...base.effects.chains.pianoA,
          reverb: { ...base.effects.chains.pianoA.reverb, on: false, dryWet: 55 },
        },
        pianoB: {
          ...base.effects.chains.pianoB,
          reverb: { ...base.effects.chains.pianoB.reverb, on: false, dryWet: 55 },
        },
      },
    },
  }
}

async function renderFxSignal(
  state: StageInstrumentState,
  opts: {
    durationSec?: number
    notes?: Array<{ midi: number; velocity: number; releaseAtSec?: number }>
    sampleRate?: number
  } = {},
) {
  const sr = opts.sampleRate ?? 22050
  const dur = opts.durationSec ?? 0.9
  const offline = new OfflineAudioContext(2, Math.floor(sr * dur), sr)

  const engine = new StageAudioEngine({
    contextFactory: () => offline as unknown as AudioContextLike,
    clock: createNoopClock(),
    autoLoadSamples: false,
    initialState: state,
  })

  const notes = opts.notes ?? [{ midi: 60, velocity: 105 }]
  notes.forEach((n, idx) => {
    engine.triggerNote(idx + 1, n.midi, n.velocity)
    if (n.releaseAtSec !== undefined) {
      engine.releaseNote(idx + 1, false, n.releaseAtSec)
    }
  })
  const diagBeforeDispose = engine.getGraphDiagnostics()
  const rendered = await offline.startRendering()
  // Copy channel PCM out of native node-web-audio-api AudioBuffer before it can be GC'd
  const left = new Float32Array(rendered.getChannelData(0))
  const right = new Float32Array(rendered.getChannelData(1))

  engine.stopAllImmediate()
  const nodesAfterStop = engine.getActiveNodeCount()
  engine.dispose()

  return { left, right, sampleRate: sr, diag: diagBeforeDispose, nodesAfterStop }
}

function rmsWindow(ch: Float32Array, sr: number, startSec = 0, endSec?: number): number {
  const s = Math.max(0, Math.floor(startSec * sr))
  const e = Math.min(ch.length, endSec !== undefined ? Math.floor(endSec * sr) : ch.length)
  let sum = 0
  for (let i = s; i < e; i++) sum += ch[i] * ch[i]
  return Math.sqrt(sum / Math.max(1, e - s))
}

function diffRmsStereo(
  aL: Float32Array,
  aR: Float32Array,
  bL: Float32Array,
  bR: Float32Array,
  start = 0,
  end?: number,
): number {
  const n = Math.min(aL.length, bL.length, end ?? aL.length)
  let sum = 0
  for (let i = start; i < n; i++) {
    const dl = aL[i] - bL[i]
    const dr = aR[i] - bR[i]
    sum += 0.5 * (dl * dl + dr * dr)
  }
  return Math.sqrt(sum / Math.max(1, n - start))
}

function highFreqRms(ch: Float32Array, sr: number, startSec = 0, endSec?: number): number {
  const s = Math.max(1, Math.floor(startSec * sr))
  const e = Math.min(ch.length, endSec !== undefined ? Math.floor(endSec * sr) : ch.length)
  let sum = 0
  for (let i = s; i < e; i++) {
    const d = ch[i] - ch[i - 1]
    sum += d * d
  }
  return Math.sqrt(sum / Math.max(1, e - s))
}

describe('effects.graph — one AudioContext, documented order, master limiter, cleanup', () => {
  it('uses exactly one AudioContext, enforces documented signal order, limits 10-note chords without clipping, and cleans up all voice nodes', async () => {
    const state = makeDryBaseState()
    const chord = [48, 52, 55, 60, 64, 67, 71, 74, 76, 79].map((midi) => ({
      midi,
      velocity: 127,
    }))
    const res = await renderFxSignal(state, { durationSec: 0.4, notes: chord })

    expect(res.diag.contextCount).toBe(1)
    expect(res.diag.signalOrder).toEqual([
      'Layer source',
      'Mod 1',
      'Mod 2',
      'Delay',
      'Amp Sim/EQ or Filter',
      'Compressor',
      'Reverb',
      'Rotary when routed',
      'Layer level',
      'Master gain/limiter',
      'Destination',
    ])
    expect(res.nodesAfterStop).toBe(0)

    let peak = 0
    for (let i = 0; i < res.left.length; i++) {
      peak = Math.max(peak, Math.abs(res.left[i]), Math.abs(res.right[i]))
    }
    expect(peak).toBeGreaterThan(0.1)
    expect(peak).toBeLessThanOrEqual(1.0)
  })
})

describe('effects.routing — focus, group mode, global mode, bypass, dry/wet, Reverb-before-Rotary, delay feedback path', () => {
  it('follows Piano layer focus, supports manual focus, Piano Group Mode, Global Mode, and Tap Tempo', () => {
    let s = makeDryBaseState()
    // Layer focus -> FX focus follows
    s = instrumentStateReducer(s, { type: 'focus-piano-layer', layer: 'B' })
    expect(s.effects.focusedChain).toBe('pianoB')

    // Manual focus Organ / Synth
    s = instrumentStateReducer(s, { type: 'activate', id: 'fx-focus-organ' })
    expect(s.effects.focusedChain).toBe('organ')
    s = instrumentStateReducer(s, { type: 'activate', id: 'fx-focus-synth' })
    expect(s.effects.focusedChain).toBe('synthA')
    s = instrumentStateReducer(s, { type: 'activate', id: 'fx-focus-piano' })
    expect(s.effects.focusedChain).toBe('pianoA')

    // Piano Group Mode via Shift + FX Focus Piano shares Piano A settings onto Piano B
    s = instrumentStateReducer(s, { type: 'patch-fx-chain', chain: 'pianoA', patch: { mod1: { on: true, type: 'Tremolo' } } })
    expect(resolveEffectiveChainForLayer(s.effects, 'B').mod1.on).toBe(false)
    s = instrumentStateReducer(s, { type: 'activate', id: 'fx-shift' })
    s = instrumentStateReducer(s, { type: 'activate', id: 'fx-focus-piano' })
    expect(s.effects.pianoGroupMode).toBe(true)
    expect(resolveEffectiveChainForLayer(s.effects, 'B').mod1.on).toBe(true)

    // Global Mode via Shift + Reverb On applies global Reverb to both layers
    s = instrumentStateReducer(s, { type: 'activate', id: 'fx-shift' })
    s = instrumentStateReducer(s, { type: 'activate', id: 'fx-reverb-on' })
    expect(s.effects.global.reverbGlobal).toBe(true)
    expect(resolveEffectiveChainForLayer(s.effects, 'A').reverb.type).toBe('Hall')
    expect(resolveEffectiveChainForLayer(s.effects, 'B').reverb.type).toBe('Hall')

    // Tap tempo sets exact BPM (500 ms interval = 120 BPM)
    s = instrumentStateReducer(s, { type: 'tap-delay-tempo', nowMs: 1000 })
    s = instrumentStateReducer(s, { type: 'tap-delay-tempo', nowMs: 1500 })
    expect(resolveEffectiveChainForLayer(s.effects, 'A').delay.bpm).toBe(120)
  })

  it('All-Effects Bypass cleanly bypasses active effects and Rotary; Reverb precedes Rotary when To Rotary is routed', async () => {

    // Reverb (100% wet Hall) + To Rotary (Fast)
    const revAndRotaryState = instrumentStateReducer(makeDryBaseState(), {
      type: 'patch-fx-chain',
      chain: 'pianoA',
      patch: {
        ampEq: { on: true, type: 'To Rotary' },
        reverb: { on: true, type: 'Hall', dryWet: 100 },
      },
    })
    const fastRevRot = instrumentStateReducer(revAndRotaryState, {
      type: 'set-rotary',
      patch: { speed: 'Fast', stopMode: false, drive: 40, driveOn: true },
    })

    const revOnlyState = instrumentStateReducer(makeDryBaseState(), {
      type: 'patch-fx-chain',
      chain: 'pianoA',
      patch: {
        ampEq: { on: false, type: 'EQ only' },
        reverb: { on: true, type: 'Hall', dryWet: 100 },
      },
    })

    const allBypassedState: StageInstrumentState = {
      ...fastRevRot,
      effects: { ...fastRevRot.effects, allOn: false },
    }

    const renderedFastRevRot = await renderFxSignal(fastRevRot, {
      durationSec: 1.1,
      notes: [{ midi: 60, velocity: 100, releaseAtSec: 0.14 }],
    })
    const renderedRevOnly = await renderFxSignal(revOnlyState, {
      durationSec: 1.1,
      notes: [{ midi: 60, velocity: 100, releaseAtSec: 0.14 }],
    })
    const renderedAllBypass = await renderFxSignal(allBypassedState, {
      durationSec: 1.1,
      notes: [{ midi: 60, velocity: 100, releaseAtSec: 0.14 }],
    })

    // Verify To Rotary routing registered in graph diagnostics
    expect(renderedFastRevRot.diag.rotaryRoutedLayers).toContain('A')
    expect(renderedAllBypass.diag.rotaryRoutedLayers).toHaveLength(0)

    // All-effects bypass matches dry signal identically on held notes and has no reverb tail
    const dryHeld = await renderFxSignal(makeDryBaseState(), { durationSec: 0.4 })
    const bypassHeld = await renderFxSignal(allBypassedState, { durationSec: 0.4 })
    expect(diffRmsStereo(dryHeld.left, dryHeld.right, bypassHeld.left, bypassHeld.right)).toBeLessThan(0.001)
    expect(rmsWindow(renderedAllBypass.left, renderedAllBypass.sampleRate, 0.5, 1.0)).toBeLessThan(0.005)

    // Reverb-before-Rotary proof: AFTER the dry note is completely released (0.45..1.0 s),
    const sr = renderedFastRevRot.sampleRate
    const tailStart = Math.floor(0.45 * sr)
    const tailEnd = Math.floor(1.0 * sr)
    expect(rmsWindow(renderedFastRevRot.left, sr, 0.45, 1.0)).toBeGreaterThan(0.005)
    expect(
      diffRmsStereo(
        renderedRevOnly.left,
        renderedRevOnly.right,
        renderedFastRevRot.left,
        renderedFastRevRot.right,
        tailStart,
        tailEnd,
      ),
    ).toBeGreaterThan(0.004)
  })

  it('Delay feedback filter filters repeats while leaving initial dry attack untouched', async () => {
    const makeDelayState = (filter: DelayFilterType) => {
      const base = makeDryBaseState()
      const withClav: StageInstrumentState = {
        ...base,
        piano: {
          ...base.piano,
          layers: {
            ...base.piano.layers,
            A: { ...base.piano.layers.A, type: 'Clav', modelIndex: 0 },
          },
        },
      }
      return instrumentStateReducer(withClav, {
        type: 'patch-fx-chain',
        chain: 'pianoA',
        patch: {
          delay: { on: true, bpm: 240, feedback: 70, dryWet: 50, filter, pingPong: false },
        },
      })
    }

    const off = await renderFxSignal(makeDelayState('Off'), {
      durationSec: 1.1,
      notes: [{ midi: 72, velocity: 110, releaseAtSec: 0.08 }],
    })
    const lp = await renderFxSignal(makeDelayState('LP'), {
      durationSec: 1.1,
      notes: [{ midi: 72, velocity: 110, releaseAtSec: 0.08 }],
    })
    const hp = await renderFxSignal(makeDelayState('HP'), {
      durationSec: 1.1,
      notes: [{ midi: 72, velocity: 110, releaseAtSec: 0.08 }],
    })
    const bp = await renderFxSignal(makeDelayState('BP'), {
      durationSec: 1.1,
      notes: [{ midi: 72, velocity: 110, releaseAtSec: 0.08 }],
    })

    const sr = off.sampleRate
    // Pure dry attack window (0..0.07 s, strictly before 0.08 s release & 0.25 s first repeat)
    const dryAttackEnd = Math.floor(0.07 * sr)
    expect(diffRmsStereo(off.left, off.right, lp.left, lp.right, 0, dryAttackEnd)).toBeLessThan(0.001)
    expect(diffRmsStereo(off.left, off.right, hp.left, hp.right, 0, dryAttackEnd)).toBeLessThan(0.001)

    // Repeat window (0.28..0.95 s): LP reduces high frequencies vs Off; HP and BP alter repeats measurably
    const offRepeatHf = highFreqRms(off.left, sr, 0.28, 0.95)
    const lpRepeatHf = highFreqRms(lp.left, sr, 0.28, 0.95)
    expect(offRepeatHf).toBeGreaterThan(lpRepeatHf * 1.15)
    expect(
      diffRmsStereo(off.left, off.right, hp.left, hp.right, Math.floor(0.28 * sr), Math.floor(0.95 * sr)),
    ).toBeGreaterThan(0.002)
    expect(
      diffRmsStereo(lp.left, lp.right, bp.left, bp.right, Math.floor(0.28 * sr), Math.floor(0.95 * sr)),
    ).toBeGreaterThan(0.002)
  })
})

describe('effects.processing — every unit and every listed type measurably alters rendered audio', () => {
  it('Mod 1: every type (A-Pan, Tremolo, Ring Mod, A-Wah, Wah, Pump) differs from bypass and from other types', async () => {
    const dry = await renderFxSignal(makeDryBaseState(), { durationSec: 0.65 })
    const rendered = new Map<Mod1Type, { left: Float32Array; right: Float32Array }>()

    for (const type of MOD1_TYPES) {
      const st = instrumentStateReducer(makeDryBaseState(), {
        type: 'patch-fx-chain',
        chain: 'pianoA',
        patch: { mod1: { on: true, type, rate: 62, amount: 85 } },
      })
      const r = await renderFxSignal(st, { durationSec: 0.65 })
      expect(
        diffRmsStereo(dry.left, dry.right, r.left, r.right),
        `Mod 1 ${type} must differ from bypass`,
      ).toBeGreaterThan(0.01)
      rendered.set(type, { left: r.left, right: r.right })
    }

    // All pairs of Mod 1 types must be distinct
    for (let i = 0; i < MOD1_TYPES.length; i++) {
      for (let j = i + 1; j < MOD1_TYPES.length; j++) {
        const a = rendered.get(MOD1_TYPES[i])!
        const b = rendered.get(MOD1_TYPES[j])!
        expect(
          diffRmsStereo(a.left, a.right, b.left, b.right),
          `Mod 1 ${MOD1_TYPES[i]} vs ${MOD1_TYPES[j]} must be distinct`,
        ).toBeGreaterThan(0.008)
      }
    }
  })

  it('Mod 2: every type (Chorus, Flanger, Phaser, Vibe, Ensemble, Spin) differs from bypass and from other types', async () => {
    const dry = await renderFxSignal(makeDryBaseState(), { durationSec: 0.65 })
    const rendered = new Map<Mod2Type, { left: Float32Array; right: Float32Array }>()

    for (const type of MOD2_TYPES) {
      const st = instrumentStateReducer(makeDryBaseState(), {
        type: 'patch-fx-chain',
        chain: 'pianoA',
        patch: { mod2: { on: true, type, rate: 58, amount: 82 } },
      })
      const r = await renderFxSignal(st, { durationSec: 0.65 })
      expect(
        diffRmsStereo(dry.left, dry.right, r.left, r.right),
        `Mod 2 ${type} must differ from bypass`,
      ).toBeGreaterThan(0.008)
      rendered.set(type, { left: r.left, right: r.right })
    }

    for (let i = 0; i < MOD2_TYPES.length; i++) {
      for (let j = i + 1; j < MOD2_TYPES.length; j++) {
        const a = rendered.get(MOD2_TYPES[i])!
        const b = rendered.get(MOD2_TYPES[j])!
        expect(
          diffRmsStereo(a.left, a.right, b.left, b.right),
          `Mod 2 ${MOD2_TYPES[i]} vs ${MOD2_TYPES[j]} must be distinct`,
        ).toBeGreaterThan(0.006)
      }
    }
  })

  it('Amp Sim / EQ: EQ only, Twin, JC, Small, LP24, HP24, and To Rotary are all active and distinct', async () => {
    const dry = await renderFxSignal(makeDryBaseState(), { durationSec: 0.55 })
    const rendered = new Map<AmpEqType, { left: Float32Array; right: Float32Array }>()

    for (const type of AMP_EQ_TYPES) {
      const st = instrumentStateReducer(makeDryBaseState(), {
        type: 'patch-fx-chain',
        chain: 'pianoA',
        patch: {
          ampEq: {
            on: true,
            type,
            drive: 72,
            bass: type === 'EQ only' ? 90 : 55,
            mid: type === 'LP24 Filter' || type === 'HP24 Filter' ? 70 : 50,
            midFreq: type === 'LP24 Filter' ? 30 : type === 'HP24 Filter' ? 58 : 50,
            treble: type === 'EQ only' ? 15 : 55,
          },
        },
      })
      const r = await renderFxSignal(st, { durationSec: 0.55 })
      expect(
        diffRmsStereo(dry.left, dry.right, r.left, r.right),
        `Amp/EQ ${type} must differ from bypass`,
      ).toBeGreaterThan(0.008)
      rendered.set(type, { left: r.left, right: r.right })
    }

    // Twin, JC, and Small must be pairwise distinct
    for (const [aName, bName] of [
      ['Twin', 'JC'],
      ['Twin', 'Small'],
      ['JC', 'Small'],
      ['LP24 Filter', 'HP24 Filter'],
    ] as const) {
      const a = rendered.get(aName)!
      const b = rendered.get(bName)!
      expect(
        diffRmsStereo(a.left, a.right, b.left, b.right),
        `${aName} vs ${bName} must be distinct`,
      ).toBeGreaterThan(0.008)
    }
  })

  it('Compressor reduces dynamic range and Fast mode differs from normal; Reverb types grow Booth -> Cathedral with Bright/Dark and full wet', async () => {
    const dry = await renderFxSignal(makeDryBaseState(), { durationSec: 0.55 })
    const compNormal = await renderFxSignal(
      instrumentStateReducer(makeDryBaseState(), {
        type: 'patch-fx-chain',
        chain: 'pianoA',
        patch: { comp: { on: true, amount: 85, fast: false } },
      }),
      { durationSec: 0.55 },
    )
    const compFast = await renderFxSignal(
      instrumentStateReducer(makeDryBaseState(), {
        type: 'patch-fx-chain',
        chain: 'pianoA',
        patch: { comp: { on: true, amount: 85, fast: true } },
      }),
      { durationSec: 0.55 },
    )
    expect(diffRmsStereo(dry.left, dry.right, compNormal.left, compNormal.right)).toBeGreaterThan(0.01)
    expect(diffRmsStereo(compNormal.left, compNormal.right, compFast.left, compFast.right)).toBeGreaterThan(0.004)

    // Reverb: all 6 types differ from dry, Cathedral tail > Booth tail, Bright > Dark HF energy
    const shortNote = [{ midi: 64, velocity: 105, releaseAtSec: 0.1 }]
    const dryShort = await renderFxSignal(makeDryBaseState(), { durationSec: 1.4, notes: shortNote })
    const tails = new Map<ReverbType, number>()
    for (const type of REVERB_TYPES) {
      const r = await renderFxSignal(
        instrumentStateReducer(makeDryBaseState(), {
          type: 'patch-fx-chain',
          chain: 'pianoA',
          patch: { reverb: { on: true, type, tone: 'Normal', dryWet: 75 } },
        }),
        { durationSec: 1.4, notes: shortNote },
      )
      expect(
        diffRmsStereo(dryShort.left, dryShort.right, r.left, r.right),
        `Reverb ${type} must differ from bypass`,
      ).toBeGreaterThan(0.008)
      tails.set(type, rmsWindow(r.left, r.sampleRate, 0.65, 1.35))
    }
    expect(tails.get('Cathedral')!).toBeGreaterThan(tails.get('Booth')! * 3)
    expect(tails.get('Hall')!).toBeGreaterThan(tails.get('Room')! * 1.5)

    // Bright vs Dark reverb tone
    const revBright = await renderFxSignal(
      instrumentStateReducer(makeDryBaseState(), {
        type: 'patch-fx-chain',
        chain: 'pianoA',
        patch: { reverb: { on: true, type: 'Hall', tone: 'Bright', dryWet: 100 } },
      }),
      { durationSec: 0.9, notes: shortNote },
    )
    const revDark = await renderFxSignal(
      instrumentStateReducer(makeDryBaseState(), {
        type: 'patch-fx-chain',
        chain: 'pianoA',
        patch: { reverb: { on: true, type: 'Hall', tone: 'Dark', dryWet: 100 } },
      }),
      { durationSec: 0.9, notes: shortNote },
    )
    expect(highFreqRms(revBright.left, revBright.sampleRate, 0.1, 0.85)).toBeGreaterThan(
      highFreqRms(revDark.left, revDark.sampleRate, 0.1, 0.85) * 1.5,
    )

    // Rotary Slow vs Fast vs Stop
    const baseRot = instrumentStateReducer(makeDryBaseState(), {
      type: 'patch-fx-chain',
      chain: 'pianoA',
      patch: { ampEq: { on: true, type: 'To Rotary' } },
    })
    const rotSlow = await renderFxSignal(
      instrumentStateReducer(baseRot, { type: 'set-rotary', patch: { speed: 'Slow', stopMode: false } }),
      { durationSec: 0.8 },
    )
    const rotFast = await renderFxSignal(
      instrumentStateReducer(baseRot, { type: 'set-rotary', patch: { speed: 'Fast', stopMode: false } }),
      { durationSec: 0.8 },
    )
    const rotStop = await renderFxSignal(
      instrumentStateReducer(baseRot, { type: 'set-rotary', patch: { speed: 'Slow', stopMode: true } }),
      { durationSec: 0.8 },
    )
    expect(diffRmsStereo(rotSlow.left, rotSlow.right, rotFast.left, rotFast.right)).toBeGreaterThan(0.008)
    expect(diffRmsStereo(rotFast.left, rotFast.right, rotStop.left, rotStop.right)).toBeGreaterThan(0.008)
  })
})
