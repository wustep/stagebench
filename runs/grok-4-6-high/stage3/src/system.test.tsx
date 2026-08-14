import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { meanAbsDiff, PianoEngine, renderPianoScript, rms } from './audio/piano-engine'
import { createAudioContext } from './audio/software-context'
import { applyHardwareControl } from './model/apply-control'
import { INTERACTIVE_CONTROLS } from './model/controls'
import { UNSUPPORTED_CONTROL_IDS, defaultInstrumentState } from './model/instrument-state'
import { soundingState } from './model/morph'
import { switchScene } from './model/programs'
import { zoneGain } from './model/splits'

describe('layers.routing', () => {
  it('enables, focuses, levels, and octaves organ/synth layers independently', async () => {
    const quiet = await renderPianoScript(0.25, (engine) => {
      const state = defaultInstrumentState()
      state.pianoOn = false
      state.synthOn = true
      state.synth.A.enable = true
      state.synth.A.level = 0.2
      engine.applyState(state, 0)
      engine.noteOn(60, 0.85, 0)
    })
    const loud = await renderPianoScript(0.25, (engine) => {
      const state = defaultInstrumentState()
      state.pianoOn = false
      state.synthOn = true
      state.synth.A.enable = true
      state.synth.A.level = 1
      engine.applyState(state, 0)
      engine.noteOn(60, 0.85, 0)
    })
    expect(rms(loud)).toBeGreaterThan(rms(quiet) * 1.4)
    let state = defaultInstrumentState()
    state = applyHardwareControl(state, 'synth-layer-b-focus', 1)
    expect(state.synth.B.focus).toBe(true)
    expect(state.fxSectionFocus).toBe('synth')
    state = applyHardwareControl(state, 'synth-oct-up', 1)
    expect(state.synth.B.octave).toBe(12)
  })
})

describe('splits.zones', () => {
  it('routes notes by split points and crossfade widths', () => {
    const state = defaultInstrumentState()
    state.split.on = true
    state.split.mid.enabled = true
    state.split.mid.midi = 60
    state.split.mid.xfade = 0
    state.layers.A.zone = { lo: 0, hi: 0 }
    state.synth.A.zone = { lo: 1, hi: 3 }
    expect(zoneGain(48, state.layers.A.zone, state.split)).toBe(1)
    expect(zoneGain(72, state.layers.A.zone, state.split)).toBe(0)
    expect(zoneGain(72, state.synth.A.zone, state.split)).toBe(1)
    state.split.mid.xfade = 12
    expect(zoneGain(54, state.layers.A.zone, state.split)).toBeGreaterThan(0)
    expect(zoneGain(54, state.layers.A.zone, state.split)).toBeLessThan(1)
  })

  it('audibly drops a layer outside its zone', async () => {
    const inZone = await renderPianoScript(0.28, (engine) => {
      const state = defaultInstrumentState()
      state.split.on = true
      state.split.mid.enabled = true
      state.split.mid.midi = 60
      state.layers.A.zone = { lo: 0, hi: 0 }
      engine.applyState(state, 0)
      engine.noteOn(48, 0.85, 0)
    })
    const outZone = await renderPianoScript(0.28, (engine) => {
      const state = defaultInstrumentState()
      state.split.on = true
      state.split.mid.enabled = true
      state.split.mid.midi = 60
      state.layers.A.zone = { lo: 0, hi: 0 }
      engine.applyState(state, 0)
      engine.noteOn(72, 0.85, 0)
    })
    expect(rms(inZone)).toBeGreaterThan(rms(outZone) * 4)
  })
})

describe('morph.assignments', () => {
  it('interpolates wheel destinations and clears a source', () => {
    let state = defaultInstrumentState()
    state.layers.A.level = 0.1
    state.morphLatch = 'wheel'
    state = applyHardwareControl(state, 'piano-layer-a-level', 0.9)
    expect(state.morphs.some((m) => m.dest === 'piano-layer-a-level')).toBe(true)
    state.modWheel = 0
    expect(soundingState(state).layers.A.level).toBeCloseTo(0.1, 1)
    state.modWheel = 1
    expect(soundingState(state).layers.A.level).toBeCloseTo(0.9, 1)
    state = applyHardwareControl(state, 'program-morph-wheel', 1, { 'program-shift': 1, 'program-morph-wheel': 1 })
    expect(state.morphs.filter((m) => m.source === 'wheel')).toHaveLength(0)
  })
})

describe('scenes.switching', () => {
  it('toggles enable flags without copying sound parameters', () => {
    const state = defaultInstrumentState()
    state.layers.A.type = 'clav'
    state.layers.A.enable = true
    state.layers.B.enable = false
    state.sceneI = {
      pianoA: true,
      pianoB: false,
      organA: true,
      organB: false,
      synthA: false,
      synthB: false,
      synthC: false,
    }
    state.sceneII = {
      pianoA: false,
      pianoB: true,
      organA: false,
      organB: true,
      synthA: true,
      synthB: false,
      synthC: false,
    }
    switchScene(state, 'II')
    expect(state.layers.A.enable).toBe(false)
    expect(state.layers.B.enable).toBe(true)
    expect(state.synth.A.enable).toBe(true)
    expect(state.layers.A.type).toBe('clav')
    switchScene(state, 'I')
    expect(state.layers.A.enable).toBe(true)
    expect(state.layers.A.type).toBe('clav')
  })
})

describe('system.integration', () => {
  it('shares one context, clock, panic, and programs across engines', async () => {
    const ctx = createAudioContext({ offline: true, durationSec: 0.5 })
    const engine = new PianoEngine({ context: ctx })
    const state = defaultInstrumentState()
    state.organOn = true
    state.synthOn = true
    state.synth.A.enable = true
    engine.applyState(state, 0)
    engine.noteOn(60, 0.8, 0)
    expect(engine.getContext()).toBe(ctx)
    expect(engine.getLayerVoiceCount('A') + engine.getOrganVoiceCount() + engine.getSynthVoiceCount()).toBeGreaterThan(1)
    engine.panic(0.1)
    expect(engine.getActiveVoiceCount()).toBe(0)
    engine.dispose()
    expect(engine.getContext()).toBeNull()

    const withFx = await renderPianoScript(0.35, (eng) => {
      const st = defaultInstrumentState()
      st.pianoOn = false
      st.organOn = true
      st.organFx.delayOn = true
      st.organFx.delayMix = 0.7
      eng.applyState(st, 0)
      eng.noteOn(60, 0.85, 0)
    })
    const dry = await renderPianoScript(0.35, (eng) => {
      const st = defaultInstrumentState()
      st.pianoOn = false
      st.organOn = true
      eng.applyState(st, 0)
      eng.noteOn(60, 0.85, 0)
    })
    expect(meanAbsDiff(withFx, dry)).toBeGreaterThan(0.0004)
  })
})

describe('hardware.bindings', () => {
  it('lists only spec-excluded controls as unsupported and binds the rest', () => {
    const unsupported = new Set<string>(UNSUPPORTED_CONTROL_IDS)
    expect(unsupported.has('program-morph-at')).toBe(true)
    expect(unsupported.has('organ-preset-1')).toBe(true)
    expect(unsupported.has('piano-on')).toBe(false)
    for (const control of INTERACTIVE_CONTROLS) {
      if (unsupported.has(control.id)) continue
      const next = applyHardwareControl(defaultInstrumentState(), control.id, control.kind === 'button' ? 1 : control.max)
      expect(next).toBeTruthy()
    }
    render(<App deps={{ autoMidi: false }} />)
    expect(screen.getByText(/Unsupported: aftertouch morph, organ presets/i)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Panic'))
  })
})
