import { describe, expect, it } from 'vitest'
import { meanAbsDiff, renderPianoScript, rms } from './audio/piano-engine'
import { defaultInstrumentState } from './model/instrument-state'
import { AMP_TYPES, MOD1_TYPES, MOD2_TYPES, REVERB_TYPES } from './model/instrument-state'

describe('effects.routing', () => {
  it('bypasses per-unit and all-effects, and dry/wet change the signal', async () => {
    const dry = await renderPianoScript(0.45, (engine) => {
      engine.noteOn(60, 0.85, 0)
    })
    const delayed = await renderPianoScript(0.45, (engine) => {
      const state = defaultInstrumentState()
      state.layers.A.fx.delayOn = true
      state.layers.A.fx.delayMix = 0.7
      state.layers.A.fx.delayFeedback = 0.4
      engine.applyState(state, 0)
      engine.noteOn(60, 0.85, 0)
      engine.noteOff(60, 0.08)
    })
    expect(meanAbsDiff(dry, delayed)).toBeGreaterThan(0.001)

    const bypassed = await renderPianoScript(0.45, (engine) => {
      const state = defaultInstrumentState()
      state.layers.A.fx.delayOn = true
      state.layers.A.fx.delayMix = 0.7
      state.fxSectionOn = false
      engine.applyState(state, 0)
      engine.noteOn(60, 0.85, 0)
      engine.noteOff(60, 0.08)
    })
    expect(meanAbsDiff(delayed, bypassed)).toBeGreaterThan(0.001)

    const wetter = await renderPianoScript(0.45, (engine) => {
      const state = defaultInstrumentState()
      state.layers.A.fx.reverbOn = true
      state.layers.A.fx.reverbMix = 0.95
      engine.applyState(state, 0)
      engine.noteOn(60, 0.85, 0)
    })
    const drier = await renderPianoScript(0.45, (engine) => {
      const state = defaultInstrumentState()
      state.layers.A.fx.reverbOn = true
      state.layers.A.fx.reverbMix = 0.15
      engine.applyState(state, 0)
      engine.noteOn(60, 0.85, 0)
    })
    expect(meanAbsDiff(wetter, drier)).toBeGreaterThan(0.0008)
  })

  it('applies delay feedback filtering on repeats, group, global, and To Rotary', async () => {
    const lp = await renderPianoScript(0.95, (engine) => {
      const state = defaultInstrumentState()
      state.layers.A.fx.delayOn = true
      state.layers.A.fx.delayMix = 0.9
      state.layers.A.fx.delayFeedback = 0.85
      state.layers.A.fx.delayTempo = 1
      state.layers.A.fx.delayFilter = 'LP'
      engine.applyState(state, 0)
      engine.noteOn(72, 0.9, 0)
      engine.noteOff(72, 0.04)
    })
    const hp = await renderPianoScript(0.95, (engine) => {
      const state = defaultInstrumentState()
      state.layers.A.fx.delayOn = true
      state.layers.A.fx.delayMix = 0.9
      state.layers.A.fx.delayFeedback = 0.85
      state.layers.A.fx.delayTempo = 1
      state.layers.A.fx.delayFilter = 'HP'
      engine.applyState(state, 0)
      engine.noteOn(72, 0.9, 0)
      engine.noteOff(72, 0.04)
    })
    const tail = Math.floor(0.22 * 44100)
    expect(meanAbsDiff(lp.subarray(tail), hp.subarray(tail))).toBeGreaterThan(0.0002)

    const grouped = await renderPianoScript(0.3, (engine) => {
      const state = defaultInstrumentState()
      state.pianoGroup = true
      state.layers.B.enable = true
      state.layers.A.fx.mod1On = true
      state.layers.A.fx.mod1Type = 'Tremolo'
      state.layers.A.fx.mod1Amount = 0.9
      engine.applyState(state, 0)
      engine.noteOn(60, 0.8, 0)
    })
    expect(rms(grouped)).toBeGreaterThan(0.001)

    const rotary = await renderPianoScript(0.4, (engine) => {
      const state = defaultInstrumentState()
      state.layers.A.fx.ampOn = true
      state.layers.A.fx.ampType = 'To Rotary'
      state.rotaryOn = true
      state.rotarySpeed = 0.9
      engine.applyState(state, 0)
      engine.noteOn(60, 0.85, 0)
    })
    const noRot = await renderPianoScript(0.4, (engine) => {
      engine.noteOn(60, 0.85, 0)
    })
    expect(meanAbsDiff(rotary, noRot)).toBeGreaterThan(0.0008)
  })
})

describe('effects.processing', () => {
  it('makes every Mod 1 type audibly distinct', async () => {
    const buffers: Float32Array[] = []
    for (const type of MOD1_TYPES) {
      const buf = await renderPianoScript(0.4, (engine) => {
        const state = defaultInstrumentState()
        state.layers.A.fx.mod1On = true
        state.layers.A.fx.mod1Type = type
        state.layers.A.fx.mod1Rate = 0.7
        state.layers.A.fx.mod1Amount = 0.85
        engine.applyState(state, 0)
        engine.noteOn(64, 0.9, 0)
      })
      expect(rms(buf), type).toBeGreaterThan(0.0005)
      buffers.push(buf)
    }
    for (let i = 0; i < buffers.length; i++) {
      for (let j = i + 1; j < buffers.length; j++) {
        expect(meanAbsDiff(buffers[i], buffers[j]), `${MOD1_TYPES[i]} vs ${MOD1_TYPES[j]}`).toBeGreaterThan(0.0004)
      }
    }
  })

  it('makes every Mod 2 type audibly distinct', async () => {
    const buffers: Float32Array[] = []
    for (const type of MOD2_TYPES) {
      const buf = await renderPianoScript(0.4, (engine) => {
        const state = defaultInstrumentState()
        state.layers.A.fx.mod2On = true
        state.layers.A.fx.mod2Type = type
        state.layers.A.fx.mod2Rate = 0.55
        state.layers.A.fx.mod2Amount = 0.8
        engine.applyState(state, 0)
        engine.noteOn(62, 0.9, 0)
      })
      expect(rms(buf), type).toBeGreaterThan(0.0005)
      buffers.push(buf)
    }
    for (let i = 0; i < buffers.length; i++) {
      for (let j = i + 1; j < buffers.length; j++) {
        expect(meanAbsDiff(buffers[i], buffers[j]), `${MOD2_TYPES[i]} vs ${MOD2_TYPES[j]}`).toBeGreaterThan(0.00035)
      }
    }
  })

  it('makes amp types, reverb types, compressor, and delay process audio', async () => {
    const eq = await renderPianoScript(0.32, (engine) => {
      const state = defaultInstrumentState()
      state.layers.A.fx.ampOn = true
      state.layers.A.fx.ampType = 'EQ only'
      engine.applyState(state, 0)
      engine.noteOn(60, 0.85, 0)
    })
    for (const type of AMP_TYPES) {
      if (type === 'EQ only') continue
      const buf = await renderPianoScript(0.32, (engine) => {
        const state = defaultInstrumentState()
        state.layers.A.fx.ampOn = true
        state.layers.A.fx.ampType = type
        state.layers.A.fx.ampDrive = 0.7
        state.rotaryOn = true
        engine.applyState(state, 0)
        engine.noteOn(60, 0.85, 0)
      })
      expect(meanAbsDiff(eq, buf), type).toBeGreaterThan(0.0004)
    }

    const room = await renderPianoScript(0.5, (engine) => {
      const state = defaultInstrumentState()
      state.layers.A.fx.reverbOn = true
      state.layers.A.fx.reverbType = 'Booth'
      state.layers.A.fx.reverbMix = 0.9
      engine.applyState(state, 0)
      engine.noteOn(60, 0.85, 0)
      engine.noteOff(60, 0.06)
    })
    for (const type of REVERB_TYPES) {
      if (type === 'Booth') continue
      const buf = await renderPianoScript(0.5, (engine) => {
        const state = defaultInstrumentState()
        state.layers.A.fx.reverbOn = true
        state.layers.A.fx.reverbType = type
        state.layers.A.fx.reverbMix = 0.9
        engine.applyState(state, 0)
        engine.noteOn(60, 0.85, 0)
        engine.noteOff(60, 0.06)
      })
      expect(meanAbsDiff(room, buf), type).toBeGreaterThan(0.0004)
    }

    const raw = await renderPianoScript(0.28, (engine) => {
      engine.noteOn(67, 0.95, 0)
    })
    const squashed = await renderPianoScript(0.28, (engine) => {
      const state = defaultInstrumentState()
      state.layers.A.fx.compOn = true
      state.layers.A.fx.compAmount = 0.95
      state.layers.A.fx.compFast = true
      engine.applyState(state, 0)
      engine.noteOn(67, 0.95, 0)
    })
    expect(meanAbsDiff(raw, squashed)).toBeGreaterThan(0.00025)
  })
})
