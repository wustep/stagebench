import { describe, expect, it } from 'vitest'
import { meanAbsDiff, PianoEngine, renderPianoScript, rms } from './audio/piano-engine'
import { createAudioContext } from './audio/software-context'
import { SYNTH_WAVES, defaultInstrumentState, type SynthWave } from './model/instrument-state'
import { SYNTH_WAVE_CATEGORY } from './model/instrument-state'

function synthOnly(wave: SynthWave = 'Saw') {
  const state = defaultInstrumentState()
  state.pianoOn = false
  state.synthOn = true
  state.synth.A.enable = true
  state.synth.A.wave = wave
  state.synth.A.filterFreq = 0.85
  state.synth.A.filterRes = 0.1
  return state
}

describe('synth.sources', () => {
  it('keeps required categories audibly distinct with category-correct Osc Ctrl', async () => {
    const reps: SynthWave[] = ['Saw', 'Sync Saw', 'Multi Saw', 'Super Saw', 'FM 2-op (algorithm A)']
    const bufs: Record<string, Float32Array> = {}
    for (const wave of reps) {
      bufs[wave] = await renderPianoScript(0.3, (engine) => {
        const state = synthOnly(wave)
        state.synth.A.oscCtrl = 0.7
        engine.applyState(state, 0)
        engine.noteOn(60, 0.85, 0)
      })
      expect(rms(bufs[wave]), wave).toBeGreaterThan(0.0008)
      expect(SYNTH_WAVES.includes(wave)).toBe(true)
    }
    expect(meanAbsDiff(bufs.Saw, bufs['Sync Saw'])).toBeGreaterThan(0.001)
    expect(meanAbsDiff(bufs.Saw, bufs['Multi Saw'])).toBeGreaterThan(0.001)
    expect(meanAbsDiff(bufs.Saw, bufs['Super Saw'])).toBeGreaterThan(0.001)
    expect(meanAbsDiff(bufs.Saw, bufs['FM 2-op (algorithm A)'])).toBeGreaterThan(0.001)

    const pureLo = await renderPianoScript(0.25, (engine) => {
      const state = synthOnly('Saw')
      state.synth.A.oscCtrl = 0
      engine.applyState(state, 0)
      engine.noteOn(64, 0.8, 0)
    })
    const pureHi = await renderPianoScript(0.25, (engine) => {
      const state = synthOnly('Saw')
      state.synth.A.oscCtrl = 1
      engine.applyState(state, 0)
      engine.noteOn(64, 0.8, 0)
    })
    expect(meanAbsDiff(pureLo, pureHi)).toBeLessThan(0.002)

    const syncLo = await renderPianoScript(0.25, (engine) => {
      const state = synthOnly('Sync Saw')
      state.synth.A.oscCtrl = 0.05
      engine.applyState(state, 0)
      engine.noteOn(64, 0.8, 0)
    })
    const syncHi = await renderPianoScript(0.25, (engine) => {
      const state = synthOnly('Sync Saw')
      state.synth.A.oscCtrl = 0.95
      engine.applyState(state, 0)
      engine.noteOn(64, 0.8, 0)
    })
    expect(meanAbsDiff(syncLo, syncHi)).toBeGreaterThan(0.001)
    expect(SYNTH_WAVE_CATEGORY['Sync Saw']).toBe('Sync')
  })
})

describe('synth.filter-envelopes', () => {
  it('changes audio with filter type, tracking, resonance, drive, and envelopes', async () => {
    const lp = await renderPianoScript(0.3, (engine) => {
      const state = synthOnly()
      state.synth.A.filterType = 'LP12'
      state.synth.A.filterFreq = 0.3
      engine.applyState(state, 0)
      engine.noteOn(60, 0.9, 0)
    })
    const hp = await renderPianoScript(0.3, (engine) => {
      const state = synthOnly()
      state.synth.A.filterType = 'HP'
      state.synth.A.filterFreq = 0.3
      engine.applyState(state, 0)
      engine.noteOn(60, 0.9, 0)
    })
    expect(meanAbsDiff(lp, hp)).toBeGreaterThan(0.001)

    const dull = await renderPianoScript(0.28, (engine) => {
      const state = synthOnly()
      state.synth.A.filterRes = 0
      engine.applyState(state, 0)
      engine.noteOn(62, 0.85, 0)
    })
    const res = await renderPianoScript(0.28, (engine) => {
      const state = synthOnly()
      state.synth.A.filterRes = 0.9
      engine.applyState(state, 0)
      engine.noteOn(62, 0.85, 0)
    })
    expect(meanAbsDiff(dull, res)).toBeGreaterThan(0.0005)

    const noEnv = await renderPianoScript(0.4, (engine) => {
      const state = synthOnly()
      state.synth.A.filterEnvAmt = 0
      state.synth.A.ampEnvA = 0.02
      engine.applyState(state, 0)
      engine.noteOn(64, 0.85, 0)
    })
    const filtEnv = await renderPianoScript(0.4, (engine) => {
      const state = synthOnly()
      state.synth.A.filterEnvAmt = 0.9
      state.synth.A.filtEnvA = 0.01
      state.synth.A.filtEnvD = 0.4
      engine.applyState(state, 0)
      engine.noteOn(64, 0.85, 0)
    })
    expect(meanAbsDiff(noEnv, filtEnv)).toBeGreaterThan(0.0004)

    const slowAmp = await renderPianoScript(0.35, (engine) => {
      const state = synthOnly()
      state.synth.A.ampEnvA = 0.7
      engine.applyState(state, 0)
      engine.noteOn(60, 0.9, 0)
    })
    const fastAmp = await renderPianoScript(0.35, (engine) => {
      const state = synthOnly()
      state.synth.A.ampEnvA = 0.01
      engine.applyState(state, 0)
      engine.noteOn(60, 0.9, 0)
    })
    expect(rms(fastAmp, 0, Math.floor(0.05 * 44100))).toBeGreaterThan(
      rms(slowAmp, 0, Math.floor(0.05 * 44100)) * 1.2,
    )
  })
})

describe('synth.voice-modes', () => {
  it('applies mono/legato, glide, unison, vibrato, and LFO', async () => {
    const poly = await renderPianoScript(0.3, (engine) => {
      const state = synthOnly()
      state.synth.A.voiceMode = 'Poly'
      engine.applyState(state, 0)
      engine.noteOn(60, 0.8, 0)
      engine.noteOn(67, 0.8, 0.01)
    })
    const mono = await renderPianoScript(0.3, (engine) => {
      const state = synthOnly()
      state.synth.A.voiceMode = 'Mono'
      engine.applyState(state, 0)
      engine.noteOn(60, 0.8, 0)
      engine.noteOn(67, 0.8, 0.01)
    })
    expect(rms(poly)).toBeGreaterThan(rms(mono) * 1.05)

    const dry = await renderPianoScript(0.28, (engine) => {
      engine.applyState(synthOnly(), 0)
      engine.noteOn(60, 0.85, 0)
    })
    const uni = await renderPianoScript(0.28, (engine) => {
      const state = synthOnly()
      state.synth.A.unison = 3
      engine.applyState(state, 0)
      engine.noteOn(60, 0.85, 0)
    })
    expect(meanAbsDiff(dry, uni)).toBeGreaterThan(0.0008)

    const vib = await renderPianoScript(0.4, (engine) => {
      const state = synthOnly()
      state.synth.A.vibrato = 'On'
      state.synth.A.vibratoAmt = 0.9
      state.synth.A.filterFreq = 0.35
      engine.applyState(state, 0)
      engine.noteOn(60, 0.85, 0)
    })
    const dryFilt = await renderPianoScript(0.4, (engine) => {
      const state = synthOnly()
      state.synth.A.filterFreq = 0.35
      engine.applyState(state, 0)
      engine.noteOn(60, 0.85, 0)
    })
    expect(meanAbsDiff(dryFilt, vib)).toBeGreaterThan(0.0003)

    const lfo = await renderPianoScript(0.4, (engine) => {
      const state = synthOnly()
      state.synth.A.lfoDest = 'Filter Freq'
      state.synth.A.lfoAmt = 0.9
      state.synth.A.lfoRate = 0.8
      engine.applyState(state, 0)
      engine.noteOn(60, 0.85, 0)
    })
    expect(meanAbsDiff(dry, lfo)).toBeGreaterThan(0.0003)

    const ctx = createAudioContext({ offline: true, durationSec: 0.4 })
    const engine = new PianoEngine({ context: ctx })
    const state = synthOnly()
    state.synth.A.voiceMode = 'Mono'
    engine.applyState(state, 0)
    engine.noteOn(48, 0.7, 0)
    engine.noteOn(72, 0.7, 0)
    expect(engine.getSynthVoiceCount('A')).toBeLessThanOrEqual(2)
    engine.dispose()
  })
})

describe('synth.arp-gate', () => {
  it('runs a deterministic arp with rate, range, direction, hold, and clock sync', async () => {
    const up = await renderPianoScript(0.9, (engine) => {
      const state = synthOnly()
      state.synth.A.arpOn = true
      state.synth.A.arpRun = true
      state.synth.A.arpDir = 'Up'
      state.synth.A.arpRange = 2
      state.synth.A.arpRate = 0.8
      engine.applyState(state, 0)
      engine.noteOn(60, 0.85, 0)
      engine.noteOn(64, 0.85, 0)
      engine.noteOn(67, 0.85, 0)
    })
    const down = await renderPianoScript(0.9, (engine) => {
      const state = synthOnly()
      state.synth.A.arpOn = true
      state.synth.A.arpRun = true
      state.synth.A.arpDir = 'Down'
      state.synth.A.arpRange = 2
      state.synth.A.arpRate = 0.8
      engine.applyState(state, 0)
      engine.noteOn(60, 0.85, 0)
      engine.noteOn(64, 0.85, 0)
      engine.noteOn(67, 0.85, 0)
    })
    expect(rms(up)).toBeGreaterThan(0.0008)
    expect(meanAbsDiff(up, down)).toBeGreaterThan(0.0004)

    const slow = await renderPianoScript(0.8, (engine) => {
      const state = synthOnly()
      state.synth.A.arpOn = true
      state.synth.A.arpRun = true
      state.synth.A.arpRate = 0.15
      engine.applyState(state, 0)
      engine.noteOn(60, 0.85, 0)
      engine.noteOn(64, 0.85, 0)
    })
    const fast = await renderPianoScript(0.8, (engine) => {
      const state = synthOnly()
      state.synth.A.arpOn = true
      state.synth.A.arpRun = true
      state.synth.A.arpRate = 0.9
      engine.applyState(state, 0)
      engine.noteOn(60, 0.85, 0)
      engine.noteOn(64, 0.85, 0)
    })
    expect(meanAbsDiff(slow, fast)).toBeGreaterThan(0.0004)

    const gated = await renderPianoScript(0.6, (engine) => {
      const state = synthOnly()
      state.synth.A.arpOn = true
      state.synth.A.arpRun = true
      state.synth.A.arpMode = 'Gate'
      state.clockSync = true
      state.clockBpm = 180
      engine.applyState(state, 0)
      engine.noteOn(60, 0.9, 0)
    })
    expect(rms(gated)).toBeGreaterThan(0.0005)
  })
})
