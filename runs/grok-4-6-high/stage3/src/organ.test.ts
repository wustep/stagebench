import { describe, expect, it } from 'vitest'
import { meanAbsDiff, renderPianoScript, rms, PianoEngine } from './audio/piano-engine'
import { createAudioContext } from './audio/software-context'
import { defaultInstrumentState } from './model/instrument-state'

function organOnly(model: 'B3' | 'Vox' | 'Farf' | 'Pipe 1' | 'Pipe 2' = 'B3') {
  const state = defaultInstrumentState()
  state.pianoOn = false
  state.organOn = true
  state.organ.A.enable = true
  state.organ.A.model = model
  state.organ.A.drawbars = [8, 8, 8, 8, 4, 0, 0, 0, 0]
  return state
}

describe('organ.engine', () => {
  it('plays two layers into a shared chain and cleans up', async () => {
    const a = await renderPianoScript(0.3, (engine) => {
      const state = organOnly()
      state.organ.B.enable = false
      engine.applyState(state, 0)
      engine.noteOn(60, 0.85, 0)
    })
    const both = await renderPianoScript(0.3, (engine) => {
      const state = organOnly()
      state.organ.B.enable = true
      state.organ.B.level = 0.8
      engine.applyState(state, 0)
      engine.noteOn(60, 0.85, 0)
    })
    expect(rms(a)).toBeGreaterThan(0.001)
    expect(rms(both)).toBeGreaterThan(rms(a) * 1.08)

    const ctx = createAudioContext({ offline: true, durationSec: 0.4 })
    const engine = new PianoEngine({ context: ctx })
    engine.applyState(organOnly(), 0)
    engine.noteOn(64, 0.7, 0)
    expect(engine.getOrganVoiceCount('A')).toBeGreaterThan(0)
    expect(engine.getContext()).toBe(ctx)
    engine.allNotesOff(0.05)
    expect(engine.getActiveVoiceCount()).toBe(0)
    engine.dispose()
  })
})

describe('organ.models-drawbars', () => {
  it('makes B3, Vox, Farf, and Pipe spectrally distinct and drawbars change the sound', async () => {
    const buffers: Record<string, Float32Array> = {}
    for (const model of ['B3', 'Vox', 'Farf', 'Pipe 1'] as const) {
      buffers[model] = await renderPianoScript(0.32, (engine) => {
        engine.applyState(organOnly(model), 0)
        engine.noteOn(60, 0.9, 0)
      })
      expect(rms(buffers[model]), model).toBeGreaterThan(0.0008)
    }
    expect(meanAbsDiff(buffers.B3, buffers.Vox)).toBeGreaterThan(0.001)
    expect(meanAbsDiff(buffers.B3, buffers.Farf)).toBeGreaterThan(0.001)
    expect(meanAbsDiff(buffers.Vox, buffers.Farf)).toBeGreaterThan(0.001)
    expect(meanAbsDiff(buffers.B3, buffers['Pipe 1'])).toBeGreaterThan(0.001)

    const full = await renderPianoScript(0.28, (engine) => {
      engine.applyState(organOnly('B3'), 0)
      engine.noteOn(67, 0.85, 0)
    })
    const pulled = await renderPianoScript(0.28, (engine) => {
      const state = organOnly('B3')
      state.organ.A.drawbars = [8, 0, 0, 0, 0, 0, 0, 0, 0]
      engine.applyState(state, 0)
      engine.noteOn(67, 0.85, 0)
    })
    expect(meanAbsDiff(full, pulled)).toBeGreaterThan(0.001)

    const perc = await renderPianoScript(0.45, (engine) => {
      const state = organOnly('B3')
      state.organ.A.percOn = true
      state.organ.A.percThird = true
      engine.applyState(state, 0)
      engine.noteOn(60, 0.9, 0)
    })
    const dry = await renderPianoScript(0.45, (engine) => {
      engine.applyState(organOnly('B3'), 0)
      engine.noteOn(60, 0.9, 0)
    })
    expect(meanAbsDiff(perc, dry)).toBeGreaterThan(0.0004)

    const vib = await renderPianoScript(0.4, (engine) => {
      const state = organOnly('B3')
      state.organ.A.vibratoOn = true
      state.organ.A.vibratoType = 'V3'
      engine.applyState(state, 0)
      engine.noteOn(60, 0.85, 0)
    })
    const chorus = await renderPianoScript(0.4, (engine) => {
      const state = organOnly('B3')
      state.organ.A.vibratoOn = true
      state.organ.A.vibratoType = 'C1'
      engine.applyState(state, 0)
      engine.noteOn(60, 0.85, 0)
    })
    expect(meanAbsDiff(vib, chorus)).toBeGreaterThan(0.0003)
  })
})

describe('organ.rotary', () => {
  it('routes organ through rotary with slow/fast/stop differences', async () => {
    const dry = await renderPianoScript(0.45, (engine) => {
      const state = organOnly()
      state.rotaryOrgan = false
      engine.applyState(state, 0)
      engine.noteOn(55, 0.9, 0)
    })
    const slow = await renderPianoScript(0.45, (engine) => {
      const state = organOnly()
      state.rotaryOrgan = true
      state.rotaryOn = true
      state.rotaryFast = false
      state.rotarySpeed = 0.2
      engine.applyState(state, 0)
      engine.noteOn(55, 0.9, 0)
    })
    const fast = await renderPianoScript(0.45, (engine) => {
      const state = organOnly()
      state.rotaryOrgan = true
      state.rotaryOn = true
      state.rotaryFast = true
      engine.applyState(state, 0)
      engine.noteOn(55, 0.9, 0)
    })
    const stop = await renderPianoScript(0.45, (engine) => {
      const state = organOnly()
      state.rotaryOrgan = true
      state.rotaryOn = true
      state.rotaryStop = true
      engine.applyState(state, 0)
      engine.noteOn(55, 0.9, 0)
    })
    expect(meanAbsDiff(dry, slow)).toBeGreaterThan(0.0004)
    expect(meanAbsDiff(slow, fast)).toBeGreaterThan(0.0003)
    expect(meanAbsDiff(fast, stop)).toBeGreaterThan(0.0002)
  })
})
