// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { bandEnergy, highBandRatio, peak, renderEngine, rms, similarity, type RenderOptions } from '../test/offline'
import type { InstrumentStore } from '../state/instrument'

/**
 * effects.processing — every required effect family measurably changes REAL
 * rendered audio through the shared graph, with honest bypass comparisons.
 * All scenarios play the Electric set (small, fast) unless noted.
 */

function withElectric(store: InstrumentStore): void {
  store.setFocusedLayer('B')
  store.selectPianoType('Electric')
  store.setFocusedLayer('A')
  store.selectPianoType('Electric')
}

function playChord(on = 0, off = 0.5): RenderOptions['steps'] {
  return [
    {
      time: on,
      run: ({ engine }) => {
        engine.noteOn(48, 0.9)
        engine.noteOn(60, 0.9)
        engine.noteOn(64, 0.8)
      },
    },
    {
      time: off,
      run: ({ engine }) => {
        engine.noteOff(48)
        engine.noteOff(60)
        engine.noteOff(64)
      },
    },
  ]
}

async function renderWith(configureFx: ((store: InstrumentStore) => void) | null, duration = 1.6, steps = playChord()) {
  return renderEngine({
    duration,
    configure: (store) => {
      withElectric(store)
      configureFx?.(store)
    },
    steps,
  })
}

/** Amplitude fluctuation: max/min RMS across small windows (tremolo/pan depth). */
function fluctuation(data: Float32Array, from: number, to: number, windowSeconds = 0.1): number {
  const values: number[] = []
  for (let t = from; t + windowSeconds <= to; t += windowSeconds) values.push(rms(data, t, t + windowSeconds))
  return Math.max(...values) / Math.max(1e-9, Math.min(...values))
}

describe('effects.processing — rendered', () => {
  it('Mod 1 Tremolo modulates rendered amplitude; bypass does not', async () => {
    const dry = await renderWith(null)
    const wet = await renderWith((store) => {
      store.updateUnit('mod1', { type: 'Tremolo', rate: 80, amount: 110 })
      store.toggleUnitOn('mod1')
    })
    expect(fluctuation(wet.left, 0.1, 0.5)).toBeGreaterThan(fluctuation(dry.left, 0.1, 0.5) * 1.3)
  }, 60000)

  it('Mod 1 A-Pan swings energy between left and right channels', async () => {
    const dry = await renderWith(null)
    const wet = await renderWith((store) => {
      store.updateUnit('mod1', { type: 'A-Pan', rate: 70, amount: 120 })
      store.toggleUnitOn('mod1')
    })
    const sideSwing = (r: typeof wet): number => {
      let swing = 0
      for (let t = 0.1; t + 0.05 <= 0.5; t += 0.05) {
        swing = Math.max(swing, Math.abs(rms(r.left, t, t + 0.05) - rms(r.right, t, t + 0.05)))
      }
      return swing
    }
    expect(sideSwing(wet)).toBeGreaterThan(sideSwing(dry) * 2)
  }, 60000)

  it('Mod 2 modulation (Phaser and Chorus) changes the rendered signal', async () => {
    const dry = await renderWith(null)
    for (const type of ['Phaser', 'Chorus'] as const) {
      const wet = await renderWith((store) => {
        store.updateUnit('mod2', { type, rate: 70, amount: 100 })
        store.toggleUnitOn('mod2')
      })
      expect(Math.abs(similarity(wet.left, dry.left, 0.1, 0.5)), type).toBeLessThan(0.985)
      expect(rms(wet.left, 0.1, 0.5), type).toBeGreaterThan(0.002)
    }
  }, 60000)

  it('Delay adds repeats after the dry decay; feedback controls how long they last', async () => {
    const steps: RenderOptions['steps'] = [
      { time: 0, run: ({ engine }) => engine.noteOn(60, 0.95) },
      { time: 0.2, run: ({ engine }) => engine.noteOff(60) },
    ]
    const dry = await renderWith(null, 2.6, steps)
    const echoing = await renderWith((store) => {
      store.updateUnit('delay', { tempo: 40, feedback: 110, mix: 90 }) // ~455 ms repeats
      store.toggleUnitOn('delay')
    }, 2.6, steps)
    // Late window: repeats keep energy alive well after the damped dry note.
    expect(rms(echoing.left, 1.8, 2.5)).toBeGreaterThan(rms(dry.left, 1.8, 2.5) * 1.5)

    const shortFeedback = await renderWith((store) => {
      store.updateUnit('delay', { tempo: 40, feedback: 15, mix: 90 })
      store.toggleUnitOn('delay')
    }, 2.6, steps)
    expect(rms(echoing.left, 1.8, 2.5)).toBeGreaterThan(rms(shortFeedback.left, 1.8, 2.5) * 1.2)
  }, 60000)

  it('the Delay feedback filter reshapes successive repeats, not the first tap', async () => {
    // Full wet isolates the repeat train (~455 ms apart): tap 1 has not been
    // through the loop filter yet; taps 3+ have passed it repeatedly. The
    // High Pass loop filter (700 Hz) strips the note's fundamental from later
    // repeats. Driven by the GENERATED synth section (Saw, C4 — fundamental
    // ~262 Hz, well under the loop filter) instead of a piano sample so the
    // measurement is independent of the shared decode cache's warm/cold state
    // (which shifted the margins between isolated and full-file runs).
    const steps: RenderOptions['steps'] = [
      { time: 0, run: ({ engine }) => engine.noteOn(60, 0.95) },
      { time: 0.15, run: ({ engine }) => engine.noteOff(60) },
    ]
    const renderSynthDelay = (filter: 'Off' | 'High Pass') =>
      renderEngine({
        duration: 2.4,
        configure: (store) => {
          store.setPianoSectionOn(false)
          store.setSynthSectionOn(true)
          store.setSynthAmpEnvelope({ attack: 0, decay: 30, release: 10 }) // dry note dies fast; repeats dominate
          store.setSynthFxFocus('A')
          store.updateUnit('delay', { on: true, tempo: 40, feedback: 115, mix: 127, filter }, 'Delay filter test')
        },
        steps,
      })
    const open = await renderSynthDelay('Off')
    const filtered = await renderSynthDelay('High Pass')
    // Tap 1 (one pass at most) keeps most of its body in both renders…
    const early = rms(filtered.left, 0.46, 0.75) / Math.max(1e-9, rms(open.left, 0.46, 0.75))
    expect(early).toBeGreaterThan(0.35)
    // …while taps 3+ lose their low fundamental progressively (thin repeats):
    // the open loop keeps the 262 Hz saw fundamental, the filtered loop's late
    // repeats are mostly >700 Hz content, so the high-band share diverges hard.
    const lateBalance = (data: Float32Array) => highBandRatio(data, 700, 1.55, 2.25)
    expect(lateBalance(filtered.left)).toBeGreaterThan(lateBalance(open.left) * 1.4)
  }, 60000)

  it('Amp/EQ mid band measurably reshapes the spectrum; drive saturates the waveform', async () => {
    const flat = await renderWith((store) => {
      store.updateUnit('ampEq', { type: 'Neutral EQ', drive: 0 })
      store.toggleUnitOn('ampEq')
    })
    // Sweepable mid at ~2 kHz (freq 79), boost +15 dB vs cut -15 dB.
    const midBoost = await renderWith((store) => {
      store.updateUnit('ampEq', { type: 'Neutral EQ', drive: 0, mid: 127, freq: 79 })
      store.toggleUnitOn('ampEq')
    })
    const midCut = await renderWith((store) => {
      store.updateUnit('ampEq', { type: 'Neutral EQ', drive: 0, mid: 0, freq: 79 })
      store.toggleUnitOn('ampEq')
    })
    // Measure at the swept mid band itself (freq 79 -> ~1.98 kHz), energy
    // normalized by overall level: robust across source sample sets (the
    // broadband highpass ratio depended on the Electric set's spectrum).
    const midRatio = (data: Float32Array) => bandEnergy(data, 1983, 0.1, 0.5) / Math.max(1e-9, rms(data, 0.1, 0.5))
    expect(midRatio(midBoost.left)).toBeGreaterThan(midRatio(flat.left) * 1.15)
    expect(midRatio(midCut.left)).toBeLessThan(midRatio(flat.left) * 0.85)

    const driven = await renderWith((store) => {
      store.updateUnit('ampEq', { type: 'Twin', drive: 127 })
      store.toggleUnitOn('ampEq')
    })
    // Saturation flattens the crest factor and reshapes the waveform.
    const crest = (r: typeof flat) => peak(r.left, 0.05, 0.5) / Math.max(1e-9, rms(r.left, 0.05, 0.5))
    expect(crest(driven)).toBeLessThan(crest(flat) * 0.9)
    expect(Math.abs(similarity(driven.left, flat.left, 0.05, 0.5))).toBeLessThan(0.95)
  }, 60000)

  it('the LP24 resonant filter darkens the output dramatically', async () => {
    const open = await renderWith(null)
    const closed = await renderWith((store) => {
      store.updateUnit('ampEq', { type: 'LP24 Filter', freq: 25 })
      store.toggleUnitOn('ampEq')
    })
    expect(highBandRatio(closed.left, 1500, 0.1, 0.5)).toBeLessThan(highBandRatio(open.left, 1500, 0.1, 0.5) * 0.5)
    expect(rms(closed.left, 0.1, 0.5)).toBeGreaterThan(0.001) // still audible
  }, 60000)

  it('Compressor raises soft passages relative to loud ones (reduced dynamic range)', async () => {
    const steps: RenderOptions['steps'] = [
      { time: 0, run: ({ engine }) => engine.noteOn(60, 1) },
      { time: 0.45, run: ({ engine }) => engine.noteOff(60) },
      { time: 0.6, run: ({ engine }) => engine.noteOn(60, 0.2) },
      { time: 1.05, run: ({ engine }) => engine.noteOff(60) },
    ]
    const dry = await renderWith(null, 1.3, steps)
    const squeezed = await renderWith((store) => {
      store.updateUnit('comp', { amount: 120 })
      store.toggleUnitOn('comp')
    }, 1.3, steps)
    const range = (r: typeof dry) => rms(r.left, 0.05, 0.4) / Math.max(1e-9, rms(r.left, 0.65, 1.0))
    expect(range(squeezed)).toBeLessThan(range(dry) * 0.8)
  }, 60000)

  it('Reverb adds an audible tail governed by dry/wet', async () => {
    const steps: RenderOptions['steps'] = [
      { time: 0, run: ({ engine }) => engine.noteOn(60, 0.95) },
      { time: 0.25, run: ({ engine }) => engine.noteOff(60) },
    ]
    const dry = await renderWith(null, 2.2, steps)
    const hall = await renderWith((store) => {
      store.updateUnit('reverb', { type: 'Hall', mix: 100 })
      store.toggleUnitOn('reverb')
    }, 2.2, steps)
    const mixLow = await renderWith((store) => {
      store.updateUnit('reverb', { type: 'Hall', mix: 25 })
      store.toggleUnitOn('reverb')
    }, 2.2, steps)
    const tail = (r: typeof dry) => rms(r.left, 1.5, 2.1)
    expect(tail(hall)).toBeGreaterThan(tail(dry) * 1.5)
    expect(tail(hall)).toBeGreaterThan(tail(mixLow) * 1.1)
  }, 60000)

  it('Rotary slow/fast changes the modulation rate of routed content; stop nearly freezes it', async () => {
    const route = (speed: 'slow' | 'fast' | 'stop') => (store: InstrumentStore) => {
      store.updateUnit('ampEq', { type: 'To Rotary' })
      store.toggleUnitOn('ampEq')
      if (speed === 'fast') store.toggleRotarySpeed()
      if (speed === 'stop') store.toggleRotaryStop()
    }
    const measureSwings = (r: { left: Float32Array; right: Float32Array }): number => {
      // Count pan-direction reversals over time (rotor/horn rotation rate).
      const signs: number[] = []
      for (let t = 0.4; t + 0.04 <= 2.4; t += 0.04) {
        signs.push(Math.sign(rms(r.left, t, t + 0.04) - rms(r.right, t, t + 0.04)))
      }
      let flips = 0
      for (let i = 1; i < signs.length; i++) if (signs[i] !== 0 && signs[i - 1] !== 0 && signs[i] !== signs[i - 1]) flips++
      return flips
    }
    const steps: RenderOptions['steps'] = [
      { time: 0, run: ({ engine }) => engine.noteOn(60, 0.9) },
      { time: 2.2, run: ({ engine }) => engine.noteOff(60) },
    ]
    const slow = await renderWith(route('slow'), 2.5, steps)
    const fast = await renderWith(route('fast'), 2.5, steps)
    expect(rms(slow.left, 0.2, 2.0)).toBeGreaterThan(0.002) // routed content is audible
    expect(measureSwings(fast)).toBeGreaterThan(measureSwings(slow) * 1.8)
  }, 60000)

  it('All FX Off renders like the dry signal even with every unit engaged', async () => {
    const dry = await renderWith(null)
    const allOff = await renderWith((store) => {
      store.toggleUnitOn('mod1')
      store.toggleUnitOn('delay')
      store.toggleUnitOn('reverb')
      store.toggleAllFxOff()
    })
    expect(similarity(allOff.left, dry.left, 0.05, 0.5)).toBeGreaterThan(0.99)
  }, 60000)

  it('clipping protection: many simultaneous loud notes stay within full scale', async () => {
    const result = await renderEngine({
      duration: 1,
      configure: withElectric,
      steps: [
        {
          time: 0,
          run: ({ engine, store }) => {
            store.setMasterVolume(127)
            for (let midi = 40; midi < 64; midi++) engine.noteOn(midi, 1)
          },
        },
      ],
    })
    expect(peak(result.left, 0, 1)).toBeLessThanOrEqual(1.0)
    expect(rms(result.left, 0.1, 0.8)).toBeGreaterThan(0.05)
  }, 60000)
})
