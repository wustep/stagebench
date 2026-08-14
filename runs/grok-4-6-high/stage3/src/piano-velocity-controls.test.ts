import { describe, expect, it } from 'vitest'
import { meanAbsDiff, renderPianoScript, rms } from './audio/piano-engine'
import { defaultInstrumentState } from './model/instrument-state'

describe('piano.velocity-controls', () => {
  it('KB Touch, Dyn Comp, Timbre, Unison, Soft Release, String Res, and Master Level change audio', async () => {
    const base = await renderPianoScript(0.4, (engine) => {
      engine.noteOn(67, 0.35, 0)
      engine.noteOff(67, 0.12)
    })
    expect(rms(base)).toBeGreaterThan(0.0008)

    const heavy = await renderPianoScript(0.4, (engine) => {
      const state = defaultInstrumentState()
      state.layers.A.kbTouch = 'Heavy'
      engine.applyState(state, 0)
      engine.noteOn(67, 0.35, 0)
    })
    const light = await renderPianoScript(0.4, (engine) => {
      const state = defaultInstrumentState()
      state.layers.A.kbTouch = 'Light'
      engine.applyState(state, 0)
      engine.noteOn(67, 0.35, 0)
    })
    expect(rms(light)).toBeGreaterThan(rms(heavy) * 1.15)

    const compressed = await renderPianoScript(0.3, (engine) => {
      const state = defaultInstrumentState()
      state.layers.A.dynComp = 3
      engine.applyState(state, 0)
      engine.noteOn(67, 0.22, 0)
    })
    const natural = await renderPianoScript(0.3, (engine) => {
      engine.noteOn(67, 0.22, 0)
    })
    expect(rms(compressed)).toBeGreaterThan(rms(natural) * 1.2)

    const soft = await renderPianoScript(0.32, (engine) => {
      const state = defaultInstrumentState()
      state.layers.A.timbre = 'Soft'
      engine.applyState(state, 0)
      engine.noteOn(64, 0.8, 0)
    })
    const bright = await renderPianoScript(0.32, (engine) => {
      const state = defaultInstrumentState()
      state.layers.A.timbre = 'Bright'
      engine.applyState(state, 0)
      engine.noteOn(64, 0.8, 0)
    })
    expect(meanAbsDiff(soft, bright)).toBeGreaterThan(0.001)

    const dryUni = await renderPianoScript(0.32, (engine) => {
      engine.noteOn(60, 0.8, 0)
    })
    const uni = await renderPianoScript(0.32, (engine) => {
      const state = defaultInstrumentState()
      state.layers.A.unison = 3
      engine.applyState(state, 0)
      engine.noteOn(60, 0.8, 0)
    })
    expect(meanAbsDiff(dryUni, uni)).toBeGreaterThan(0.001)

    const hardRel = await renderPianoScript(0.7, (engine) => {
      engine.noteOn(62, 0.8, 0)
      engine.noteOff(62, 0.08)
    })
    const softRel = await renderPianoScript(0.7, (engine) => {
      const state = defaultInstrumentState()
      state.layers.A.softRelease = true
      engine.applyState(state, 0)
      engine.noteOn(62, 0.8, 0)
      engine.noteOff(62, 0.08)
    })
    const tail = Math.floor(0.4 * 44100)
    expect(rms(softRel, tail)).toBeGreaterThan(rms(hardRel, tail) * 1.05)

    const noRes = await renderPianoScript(0.4, (engine) => {
      engine.setSustain(true, 0)
      engine.noteOn(60, 0.8, 0)
    })
    const res = await renderPianoScript(0.4, (engine) => {
      const state = defaultInstrumentState()
      state.layers.A.stringRes = true
      engine.applyState(state, 0)
      engine.setSustain(true, 0)
      engine.noteOn(60, 0.8, 0)
    })
    expect(meanAbsDiff(noRes, res)).toBeGreaterThan(0.0004)

    const quiet = await renderPianoScript(0.28, (engine) => {
      const state = defaultInstrumentState()
      state.masterLevel = 0.15
      engine.applyState(state, 0)
      engine.noteOn(64, 0.85, 0)
    })
    const loud = await renderPianoScript(0.28, (engine) => {
      const state = defaultInstrumentState()
      state.masterLevel = 1
      engine.applyState(state, 0)
      engine.noteOn(64, 0.85, 0)
    })
    expect(rms(loud)).toBeGreaterThan(rms(quiet) * 1.5)
  })
})
