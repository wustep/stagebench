import { describe, expect, it } from 'vitest'
import { renderOffline } from '../audio/engine'
import { modelSpectralSignature } from '../audio/organ-voice'
import { defaultOrganState } from '../audio/program-types'
import { earlyRms, rms, signalsDiffer } from '../audio/signal-analysis'

const OFF_PIANO = {
  sectionOn: false,
  kbTouch: 'Medium' as const,
  dynComp: 'Off' as const,
  timbreIndex: 0,
  unison: 'Off' as const,
  softRelease: false,
  stringRes: false,
}

const ORGAN_SCENE = {
  pianoA: false,
  pianoB: false,
  organA: true,
  organB: false,
  synthA: false,
  synthB: false,
  synthC: false,
}

describe('organ.engine', () => {
  it('plays organ layers through shared effect chain', async () => {
    const buf = await renderOffline((e) => {
      e.updateState({
        pianoPerf: OFF_PIANO,
        organ: {
          ...defaultOrganState(),
          sectionOn: true,
          layerA: { ...defaultOrganState().layerA, enabled: true, level: 127, drawbars: [0, 0, 8, 0, 8, 0, 0, 0, 0] },
          layerB: { ...defaultOrganState().layerB, enabled: true, level: 127 },
        },
        sceneI: { ...ORGAN_SCENE, organB: true },
      })
      e.noteOn(60, 100, 0)
    })
    expect(rms(buf)).toBeGreaterThan(0.001)
  })

  it('cleans up voices on all-notes-off', async () => {
    const engine = await (async () => {
      const { PianoEngine } = await import('../audio/engine')
      const e = new PianoEngine()
      await e.ensureReady()
      return e
    })()
    engine.updateState({
      pianoPerf: OFF_PIANO,
      organ: { ...defaultOrganState(), layerA: { ...defaultOrganState().layerA, enabled: true, level: 127 } },
      sceneI: ORGAN_SCENE,
    })
    engine.noteOn(60, 100, 0)
    expect(engine.getActiveVoiceCount()).toBeGreaterThan(0)
    engine.allNotesOff()
    expect(engine.getActiveVoiceCount()).toBe(0)
    engine.dispose()
  })
})

describe('organ.models-drawbars', () => {
  it('B3 Vox Farf and Pipe have distinct spectral signatures', () => {
    expect(modelSpectralSignature('B3')).not.toEqual(modelSpectralSignature('Vox'))
    expect(modelSpectralSignature('Vox')).not.toEqual(modelSpectralSignature('Farf'))
    expect(modelSpectralSignature('Farf')).not.toEqual(modelSpectralSignature('Pipe'))
  })

  it('drawbar changes alter rendered organ audio', async () => {
    const low = await renderOffline((e) => {
      e.updateState({
        pianoPerf: OFF_PIANO,
        organ: {
          ...defaultOrganState(),
          layerA: { ...defaultOrganState().layerA, enabled: true, model: 'B3', drawbars: [0, 0, 4, 0, 0, 0, 0, 0, 0] },
        },
        sceneI: ORGAN_SCENE,
      })
      e.noteOn(60, 100, 0)
    })
    const high = await renderOffline((e) => {
      e.updateState({
        pianoPerf: OFF_PIANO,
        organ: {
          ...defaultOrganState(),
          layerA: { ...defaultOrganState().layerA, enabled: true, model: 'B3', drawbars: [0, 0, 8, 0, 8, 4, 2, 0, 0] },
        },
        sceneI: ORGAN_SCENE,
      })
      e.noteOn(60, 100, 0)
    })
    expect(signalsDiffer(low, high)).toBe(true)
  })

  it('B3 percussion measurably changes output', async () => {
    const off = await renderOffline((e) => {
      e.updateState({
        pianoPerf: OFF_PIANO,
        organ: {
          ...defaultOrganState(),
          percussion: { on: false, soft: false, fast: false, third: false },
          layerA: { ...defaultOrganState().layerA, enabled: true, model: 'B3' },
        },
        sceneI: ORGAN_SCENE,
      })
      e.noteOn(60, 110, 0)
    })
    const on = await renderOffline((e) => {
      e.updateState({
        pianoPerf: OFF_PIANO,
        organ: {
          ...defaultOrganState(),
          percussion: { on: true, soft: false, fast: false, third: true },
          layerA: { ...defaultOrganState().layerA, enabled: true, model: 'B3' },
        },
        sceneI: ORGAN_SCENE,
      })
      e.noteOn(60, 110, 0)
    })
    expect(earlyRms(on)).toBeGreaterThan(earlyRms(off))
  })
})

describe('organ.rotary', () => {
  it('routes organ through shared rotary when enabled', async () => {
    const dry = await renderOffline((e) => {
      e.updateState({
        pianoPerf: OFF_PIANO,
        organ: { ...defaultOrganState(), rotaryRoute: false, layerA: { ...defaultOrganState().layerA, enabled: true, level: 127 } },
        effects: { ...e.getState().effects, amp: { ...e.getState().effects.amp, toRotary: false }, rotaryOn: false, reverb: { ...e.getState().effects.reverb, mix: 0, bypass: true } },
        sceneI: ORGAN_SCENE,
      })
      e.noteOn(60, 100, 0)
    })
    const wet = await renderOffline((e) => {
      e.updateState({
        pianoPerf: OFF_PIANO,
        organ: { ...defaultOrganState(), rotaryRoute: true, layerA: { ...defaultOrganState().layerA, enabled: true, level: 127 } },
        effects: { ...e.getState().effects, amp: { ...e.getState().effects.amp, toRotary: true }, rotaryOn: true, rotarySpeed: 'fast', rotaryDrive: 127, reverb: { ...e.getState().effects.reverb, mix: 80, bypass: false } },
        sceneI: ORGAN_SCENE,
      })
      e.noteOn(60, 100, 0)
    })
    expect(signalsDiffer(dry, wet)).toBe(true)
  })
})
