import { describe, expect, it } from 'vitest'
import { renderOffline } from './engine'
import { defaultSynthState } from './program-types'
import { buildArpSequence, categoryOscCtrlEffect, createSynthOscillators } from './synth-voice'
import { rms, signalsDiffer } from './signal-analysis'

const OFF_PIANO = {
  sectionOn: false,
  kbTouch: 'Medium' as const,
  dynComp: 'Off' as const,
  timbreIndex: 0,
  unison: 'Off' as const,
  softRelease: false,
  stringRes: false,
}

const ORGAN_OFF_SCENE = {
  pianoA: false,
  pianoB: false,
  organA: false,
  organB: false,
  synthA: true,
  synthB: false,
  synthC: false,
}

describe('synth.sources', () => {
  it('renders distinct Pure Sync Multi Super and FM-H categories', async () => {
    const categories = ['Pure', 'Sync', 'Multi', 'Super', 'FM-H'] as const
    const buffers = []
    for (const category of categories) {
      const buf = await renderOffline((e) => {
        e.updateState({
          pianoPerf: OFF_PIANO,
          synth: {
            ...defaultSynthState(),
            sectionOn: true,
            layerA: { ...defaultSynthState().layerA, enabled: true, category, waveformIndex: 0, level: 127 },
          },
          sceneI: ORGAN_OFF_SCENE,
        })
        e.noteOn(60, 100, 0)
      })
      buffers.push(buf)
      expect(rms(buf)).toBeGreaterThan(0.0005)
    }
    expect(signalsDiffer(buffers[0]!, buffers[1]!)).toBe(true)
    expect(signalsDiffer(buffers[2]!, buffers[4]!)).toBe(true)
  })

  it('Pure Osc Ctrl has no effect', () => {
    expect(categoryOscCtrlEffect('Pure', 64)).toBe(0)
    expect(categoryOscCtrlEffect('Sync', 64)).toBeGreaterThan(0)
  })
})

describe('synth.filter-envelopes', () => {
  it('filter frequency changes rendered output', async () => {
    const dark = await renderOffline((e) => {
      e.updateState({
        pianoPerf: OFF_PIANO,
        synth: { ...defaultSynthState(), layerA: { ...defaultSynthState().layerA, enabled: true, filterFreq: 10, level: 127 } },
        sceneI: ORGAN_OFF_SCENE,
      })
      e.noteOn(60, 100, 0)
    })
    const bright = await renderOffline((e) => {
      e.updateState({
        pianoPerf: OFF_PIANO,
        synth: { ...defaultSynthState(), layerA: { ...defaultSynthState().layerA, enabled: true, filterFreq: 127, level: 127 } },
        sceneI: ORGAN_OFF_SCENE,
      })
      e.noteOn(60, 100, 0)
    })
    expect(signalsDiffer(dark, bright)).toBe(true)
  })

  it('filter type HP vs LP24 differ', async () => {
    const lp = await renderOffline((e) => {
      e.updateState({
        pianoPerf: OFF_PIANO,
        synth: { ...defaultSynthState(), layerA: { ...defaultSynthState().layerA, enabled: true, filterType: 'LP24', filterFreq: 80 } },
        sceneI: ORGAN_OFF_SCENE,
      })
      e.noteOn(60, 100, 0)
    })
    const hp = await renderOffline((e) => {
      e.updateState({
        pianoPerf: OFF_PIANO,
        synth: { ...defaultSynthState(), layerA: { ...defaultSynthState().layerA, enabled: true, filterType: 'HP', filterFreq: 80 } },
        sceneI: ORGAN_OFF_SCENE,
      })
      e.noteOn(60, 100, 0)
    })
    expect(signalsDiffer(lp, hp)).toBe(true)
  })
})

describe('synth.voice-modes', () => {
  it('unison increases layered output', async () => {
    const single = await renderOffline((e) => {
      e.updateState({
        pianoPerf: OFF_PIANO,
        synth: { ...defaultSynthState(), layerA: { ...defaultSynthState().layerA, enabled: true, category: 'Super', unison: 0 } },
        sceneI: ORGAN_OFF_SCENE,
      })
      e.noteOn(60, 100, 0)
    })
    const uni = await renderOffline((e) => {
      e.updateState({
        pianoPerf: OFF_PIANO,
        synth: { ...defaultSynthState(), layerA: { ...defaultSynthState().layerA, enabled: true, category: 'Super', unison: 3 } },
        sceneI: ORGAN_OFF_SCENE,
      })
      e.noteOn(60, 100, 0)
    })
    expect(rms(uni)).toBeGreaterThanOrEqual(rms(single))
  })

  it('filter resonance changes signal', async () => {
    const low = await renderOffline((e) => {
      e.updateState({
        pianoPerf: OFF_PIANO,
        synth: { ...defaultSynthState(), layerA: { ...defaultSynthState().layerA, enabled: true, filterRes: 5 } },
        sceneI: ORGAN_OFF_SCENE,
      })
      e.noteOn(60, 100, 0)
    })
    const high = await renderOffline((e) => {
      e.updateState({
        pianoPerf: OFF_PIANO,
        synth: { ...defaultSynthState(), layerA: { ...defaultSynthState().layerA, enabled: true, filterRes: 127, filterFreq: 60 } },
        sceneI: ORGAN_OFF_SCENE,
      })
      e.noteOn(60, 100, 0)
    })
    expect(signalsDiffer(low, high)).toBe(true)
  })
})

describe('synth.arp-gate', () => {
  it('builds deterministic arp sequence', () => {
    const seq1 = buildArpSequence([60, 64], 2, 'Up')
    const seq2 = buildArpSequence([60, 64], 2, 'Up')
    expect(seq1).toEqual(seq2)
    expect(seq1.length).toBeGreaterThan(2)
  })

  it('creates oscillators offline for waveform categories', () => {
    const ctx = new OfflineAudioContext(1, 44100, 44100)
    const layer = defaultSynthState().layerA
    layer.category = 'FM-H'
    const bundle = createSynthOscillators(ctx, 440, layer, 0)
    expect(bundle.oscillators.length).toBeGreaterThan(0)
  })
})
