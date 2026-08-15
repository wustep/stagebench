import { describe, expect, it } from 'vitest'
import type { InstrumentStore } from '../state/instrument'
import { bandEnergy, highBandRatio, renderEngine, rms, similarity } from '../test/offline'

/**
 * stage3 rendered audio — the organ engines and synth source categories are
 * AUDIBLY distinct (not renamed copies of one oscillator), drawbars and the
 * synth filter shape the real rendered spectrum, and morphs are observable
 * in audio. Rendering uses node-web-audio-api's OfflineAudioContext through
 * the full engine graph (chains → master → limiter → destination).
 */

const DURATION = 1.1
const FROM = 0.15
const TO = 0.95

function organOnly(store: InstrumentStore, modelSteps = 0): void {
  store.setPianoSectionOn(false)
  store.toggleOrganLayer('A')
  for (let i = 0; i < modelSteps; i++) store.cycleOrganModel()
}

function synthOnly(store: InstrumentStore, categorySteps = 0): void {
  store.setPianoSectionOn(false)
  store.toggleSynthLayer('A')
  for (let i = 0; i < categorySteps; i++) store.cycleSynthCategory()
}

async function renderNote(configure: (store: InstrumentStore) => void): Promise<Float32Array> {
  const result = await renderEngine({
    duration: DURATION,
    configure,
    steps: [{ time: 0, run: ({ engine }) => engine.noteOn(60, 0.85) }],
  })
  return result.left
}

describe('stage3.render organ engines', () => {
  it('B3, Vox, Farf and Pipe are audibly distinct waveforms, not renamed copies', async () => {
    // Model order: B3(0) → B3 Bass(1) → Vox(2) → Farf(3) → Pipe 1(4).
    const b3 = await renderNote((s) => organOnly(s, 0))
    const vox = await renderNote((s) => organOnly(s, 2))
    const farf = await renderNote((s) => organOnly(s, 3))
    const pipe = await renderNote((s) => organOnly(s, 4))
    const renders: Array<[string, Float32Array]> = [
      ['B3', b3],
      ['Vox', vox],
      ['Farf', farf],
      ['Pipe', pipe],
    ]
    for (const [name, data] of renders) {
      expect(rms(data, FROM, TO), `${name} must sound`).toBeGreaterThan(0.005)
    }
    for (let i = 0; i < renders.length; i++) {
      for (let j = i + 1; j < renders.length; j++) {
        const corr = similarity(renders[i]![1], renders[j]![1], FROM, TO)
        expect(Math.abs(corr), `${renders[i]![0]} vs ${renders[j]![0]} must differ`).toBeLessThan(0.9)
      }
    }
    // Farfisa's buzzy registers carry far more high-frequency content than
    // the default B3 registration.
    expect(highBandRatio(farf, 2000, FROM, TO)).toBeGreaterThan(highBandRatio(b3, 2000, FROM, TO) * 1.5)
  })

  it('pulling the 1′ drawbar adds real energy at the 8th harmonic', async () => {
    const base = await renderNote((s) => organOnly(s))
    const bright = await renderNote((s) => {
      organOnly(s)
      s.setDrawbar(8, 8) // 1' rank fully out
    })
    // C4 fundamental ≈ 261.63 Hz → 1' rank sounds ≈ 2093 Hz.
    const harmonic = 261.63 * 8
    expect(bandEnergy(bright, harmonic, FROM, TO)).toBeGreaterThan(bandEnergy(base, harmonic, FROM, TO) * 3)
  })
})

describe('stage3.render synth', () => {
  it('Pure, Super and FM-H source categories are audibly distinct', async () => {
    // Category order: Pure(0) → Sync(1) → Multi(2) → Super(3) → FM-H(4).
    const pure = await renderNote((s) => synthOnly(s, 0))
    const superSaw = await renderNote((s) => synthOnly(s, 3))
    const fm = await renderNote((s) => synthOnly(s, 4))
    for (const [name, data] of [
      ['Pure', pure],
      ['Super', superSaw],
      ['FM-H', fm],
    ] as const) {
      expect(rms(data, FROM, TO), `${name} must sound`).toBeGreaterThan(0.003)
    }
    expect(Math.abs(similarity(pure, superSaw, FROM, TO))).toBeLessThan(0.9)
    expect(Math.abs(similarity(pure, fm, FROM, TO))).toBeLessThan(0.9)
    expect(Math.abs(similarity(superSaw, fm, FROM, TO))).toBeLessThan(0.9)
  })

  it('the lowpass filter frequency audibly darkens the rendered signal', async () => {
    const open = await renderNote((s) => {
      synthOnly(s, 3) // Super Saw: broadband source
      s.setSynthFilter({ freq: 120 }, 'open')
    })
    const closed = await renderNote((s) => {
      synthOnly(s, 3)
      s.setSynthFilter({ freq: 18 }, 'closed')
    })
    expect(rms(closed, FROM, TO)).toBeGreaterThan(0.0002) // still sounds (heavily darkened)
    expect(highBandRatio(open, 1500, FROM, TO)).toBeGreaterThan(highBandRatio(closed, 1500, FROM, TO) * 2)
  })
})

describe('stage3.render envelopes', () => {
  it('the amp envelope attack audibly delays the note bloom', async () => {
    const fast = await renderNote((s) => synthOnly(s, 3))
    const slow = await renderNote((s) => {
      synthOnly(s, 3)
      s.setAmpEnv({ attack: 105 }, 'slow attack')
    })
    const early = (d: Float32Array) => rms(d, 0.03, 0.18)
    const late = (d: Float32Array) => rms(d, 0.8, 1.05)
    expect(early(fast)).toBeGreaterThan(early(slow) * 3) // slow attack is still quiet early on
    expect(late(slow)).toBeGreaterThan(0.002) // …but blooms by the end of the window
  })

  it('the filter envelope amount audibly brightens the attack', async () => {
    const flat = await renderNote((s) => {
      synthOnly(s, 3)
      s.setSynthFilter({ freq: 40, envAmt: 0 }, 'no env')
    })
    const swept = await renderNote((s) => {
      synthOnly(s, 3)
      s.setSynthFilter({ freq: 40, envAmt: 120 }, 'big env')
    })
    expect(highBandRatio(swept, 1200, 0.03, 0.3)).toBeGreaterThan(highBandRatio(flat, 1200, 0.03, 0.3) * 1.5)
  })
})

describe('stage3.render morphs', () => {
  it('a wheel morph to an organ drawbar is observable in rendered audio', async () => {
    const configure = (s: InstrumentStore) => {
      organOnly(s)
      s.toggleMorphCapture('wheel')
      s.setDrawbar(8, 8) // morph destination: 1' rank 0 → 8
      s.toggleMorphCapture('wheel')
    }
    const wheelDown = await renderNote(configure)
    const wheelUp = await renderEngine({
      duration: DURATION,
      configure,
      steps: [
        {
          time: 0,
          run: ({ engine, store }) => {
            store.setMorphValue('wheel', 1)
            engine.noteOn(60, 0.85)
          },
        },
      ],
    })
    const harmonic = 261.63 * 8
    expect(bandEnergy(wheelUp.left, harmonic, FROM, TO)).toBeGreaterThan(bandEnergy(wheelDown, harmonic, FROM, TO) * 3)
  })
})
