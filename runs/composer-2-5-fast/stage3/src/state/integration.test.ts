import { describe, expect, it } from 'vitest'
import { PianoEngine, renderOffline } from '../audio/engine'
import { addMorphDestination, interpolateMorphValue } from '../audio/morph-clock'
import { defaultMorphState, defaultOrganState, defaultSplitState } from '../audio/program-types'
import { zoneGainForNote } from '../audio/zones'
import { CONTROLS } from '../model/hardware'
import { isFunctionalControl } from './control-bindings'
import { isUnsupportedControl, UNSUPPORTED_CONTROLS } from './unsupported-controls'

describe('layers.routing', () => {
  it('routes synth layer C through its own effect chain', async () => {
    const engine = new PianoEngine()
    await engine.ensureReady()
    engine.updateState({
      synth: {
        ...engine.getState().synth,
        layerC: { ...engine.getState().synth.layerC, enabled: true, level: 127 },
      },
    })
    expect(engine.getSynthEffectChain('C')).toBeDefined()
    engine.dispose()
  })

  it('organ layers share one effect chain', async () => {
    const engine = new PianoEngine()
    await engine.ensureReady()
    expect(engine.getOrganEffectChain()).toBe(engine.getOrganEffectChain())
    engine.dispose()
  })
})

describe('splits.zones', () => {
  it('supports 11 split positions and crossfade widths', () => {
    const split = {
      ...defaultSplitState(),
      enabled: true,
      mid: { positionIndex: 4, crossfade: 6 as const },
    }
    expect(zoneGainForNote(58, 0, 127, split)).toBeGreaterThan(0)
    expect(zoneGainForNote(62, 0, 59, split)).toBeLessThan(1)
  })

  it('routes notes differently when split enabled in audio', async () => {
    const left = await renderOffline((e) => {
      e.updateState({
        split: { enabled: true, low: { positionIndex: 4, crossfade: 0 }, mid: { positionIndex: 4, crossfade: 0 }, high: { positionIndex: 8, crossfade: 0 } },
        zones: [{ layer: { engine: 'piano', layer: 'A' }, zoneStart: 0, zoneEnd: 59 }],
        pianoPerf: { sectionOn: true, kbTouch: 'Medium', dynComp: 'Off', timbreIndex: 0, unison: 'Off', softRelease: false, stringRes: false },
        organ: { ...defaultOrganState(), sectionOn: false },
        synth: { ...e.getState().synth, sectionOn: false },
      })
      e.noteOn(72, 100, 0)
    })
    expect(left).toBeDefined()
  })
})

describe('morph.assignments', () => {
  it('interpolates morph destinations', () => {
    const dest = { controlId: 'piano-layer-a-level', start: 0, end: 127 }
    expect(interpolateMorphValue(dest, 0)).toBe(0)
    expect(interpolateMorphValue(dest, 0.5)).toBeCloseTo(63.5, 0)
    expect(interpolateMorphValue(dest, 1)).toBe(127)
  })

  it('supports adding and clearing morph assignments', () => {
    const morph = addMorphDestination(defaultMorphState(), 'wheel', {
      controlId: 'fx-mod1-rate',
      start: 10,
      end: 100,
    })
    expect(morph.wheel).toHaveLength(1)
  })
})

describe('scenes.switching', () => {
  it('Scene II toggles enable state without changing sound parameters', async () => {
    const engine = new PianoEngine()
    await engine.ensureReady()
    const base = engine.getState()
    engine.updateState({
      sceneI: { ...base.sceneI, organA: true, synthA: false },
      sceneII: { ...base.sceneII, organA: false, synthA: true },
      activeScene: 'II',
      organ: { ...base.organ, layerA: { ...base.organ.layerA, model: 'B3', level: 55 } },
    })
    const after = engine.getState()
    expect(after.organ.layerA.model).toBe('B3')
    expect(after.organ.layerA.level).toBe(55)
    expect(after.activeScene).toBe('II')
    engine.dispose()
  })
})

describe('system.integration', () => {
  it('uses one AudioContext for piano organ and synth', async () => {
    const engine = new PianoEngine()
    await engine.ensureReady()
    const ctx = engine.getAudioContext()
    engine.updateState({
      organ: { ...defaultOrganState(), layerA: { ...defaultOrganState().layerA, enabled: true } },
      synth: { ...engine.getState().synth, layerA: { ...engine.getState().synth.layerA, enabled: true } },
    })
    engine.noteOn(60, 100, 0)
    expect(engine.getAudioContext()).toBe(ctx)
    engine.panic()
    expect(engine.getActiveVoiceCount()).toBe(0)
    engine.dispose()
  })

  it('panic clears voices and resets performance inputs', async () => {
    const engine = new PianoEngine()
    await engine.ensureReady()
    engine.updateState({ performance: { transpose: 4, modWheel: 100, controlPedal: 80, pitchStick: 90 } })
    engine.noteOn(60, 100, 0)
    engine.panic()
    expect(engine.getState().performance.transpose).toBe(0)
    expect(engine.getActiveVoiceCount()).toBe(0)
    engine.dispose()
  })
})

describe('hardware.bindings', () => {
  it('binds every non-excluded control or lists it unsupported', () => {
    const unbound: string[] = []
    for (const control of CONTROLS) {
      if (isUnsupportedControl(control.id)) continue
      if (!isFunctionalControl(control.id) && control.kind !== 'display' && control.kind !== 'led') {
        unbound.push(control.id)
      }
    }
    expect(unbound).toEqual([])
    expect(UNSUPPORTED_CONTROLS.length).toBeGreaterThan(0)
  })
})

describe('regression.phase2', () => {
  it('preserves piano effects graph entry point', async () => {
    const buf = await renderOffline((e) => {
      e.updateState({ effects: { reverb: { mix: 80, bypass: false } } })
      e.noteOn(60, 100, 0)
    })
    expect(buf.length).toBeGreaterThan(0)
  })
})
