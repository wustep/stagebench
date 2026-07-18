import { describe, expect, it } from 'vitest'
import { makeRig } from '../test-helpers'
import { corr, highBandRatio, rms, windowEnergy } from '../audio/fake-backend'
import { defaultSynthState, type SynthLayerState } from '../state/synth-state'
import { renderSynthLayerSource } from '../audio/synth-render'
import { Arpeggiator, arpStepsPerSecond, lfoRateHz } from '../audio/synth-engine'
import type { NoteEvent } from '../audio/render'

const SR = 8000

function synthWith(mut: (s: ReturnType<typeof defaultSynthState>) => void): ReturnType<typeof defaultSynthState> {
  const s = defaultSynthState()
  s.sectionOn = true
  mut(s)
  return s
}

function renderSynth(layer: Partial<SynthLayerState>, seconds = 0.5, note = 60, ctx: Partial<{ bpm: number; arpNotes: number[] }> = {}): Float32Array {
  const s = synthWith((st) => Object.assign(st.layers.A, layer))
  const notes: NoteEvent[] = [{ note, velocity: 0.9, start: 0, release: null, stop: null }]
  const frame = renderSynthLayerSource(s, 'A', notes, seconds, SR, { bpm: ctx.bpm ?? 120, transpose: 0, wheelPos: 0, arpNotes: ctx.arpNotes ?? [] })
  const out = new Float32Array(frame.l.length)
  for (let i = 0; i < out.length; i++) out[i] = (frame.l[i] + frame.r[i]) / 2
  return out
}

/** Render one note released at 0.2 s through the layer source. */
function renderWithNoteOff(release: number): Float32Array {
  const s = synthWith((st) => {
    st.layers.A.oscWave = 0
    st.layers.A.ampEnv = { attack: 0, decay: 127, release, velocity: 0 }
  })
  const notes: NoteEvent[] = [{ note: 60, velocity: 0.9, start: 0, release: 0.2, stop: null }]
  const frame = renderSynthLayerSource(s, 'A', notes, 1.0, SR, { bpm: 120, transpose: 0, wheelPos: 0, arpNotes: [] })
  const out = new Float32Array(frame.l.length)
  for (let i = 0; i < out.length; i++) out[i] = (frame.l[i] + frame.r[i]) / 2
  return out
}

describe('synth.sources', () => {
  it('three layers with independent state route notes', async () => {
    const { engine } = await makeRig()
    engine.setSynthSectionOn(true)
    engine.setSynthLayerEnabled('B', true)
    engine.setSynthLayerEnabled('C', true)
    engine.setSectionOn(false)
    engine.noteOn(60, 0.9)
    const layers = engine.getVoices().map((v) => v.layer)
    expect(layers).toContain('synthA')
    expect(layers).toContain('synthB')
    expect(layers).toContain('synthC')
  })

  it('every required waveform is selectable and renders non-silence', () => {
    for (let wave = 0; wave < 14; wave++) {
      const buf = renderSynth({ oscWave: wave }, 0.3)
      expect(rms(buf), `wave ${wave}`).toBeGreaterThan(0.005)
    }
  })

  it('Pure, Sync, Multi, Super, FM-H categories are audibly distinct', () => {
    const pure = renderSynth({ oscWave: 2 }) // Saw
    const sync = renderSynth({ oscWave: 7, oscCtrl: 80 })
    const multi = renderSynth({ oscWave: 9, oscCtrl: 80 })
    const sup = renderSynth({ oscWave: 11, oscCtrl: 80 })
    const fm = renderSynth({ oscWave: 13, oscCtrl: 80 })
    const all = [pure, sync, multi, sup, fm]
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(corr(all[i], all[j]), `${i} vs ${j}`).toBeLessThan(0.95)
      }
    }
  })

  it('Osc Ctrl is a no-op for Pure but sweeps Sync pitch, Multi/Super detune, FM amount', () => {
    const pure0 = renderSynth({ oscWave: 2, oscCtrl: 0 })
    const pure127 = renderSynth({ oscWave: 2, oscCtrl: 127 })
    expect(corr(pure0, pure127)).toBeGreaterThan(0.999) // Pure: no effect (manual p. 29)
    for (const wave of [7, 9, 11, 13]) {
      const lo = renderSynth({ oscWave: wave, oscCtrl: 0 })
      const hi = renderSynth({ oscWave: wave, oscCtrl: 127 })
      expect(corr(lo, hi), `wave ${wave}`).toBeLessThan(0.95)
    }
  })

  it('Pure category members are distinct from each other (sine vs pulse vs noise)', () => {
    const sine = renderSynth({ oscWave: 0 })
    const pulse = renderSynth({ oscWave: 4 })
    const noise = renderSynth({ oscWave: 6 })
    expect(corr(sine, pulse)).toBeLessThan(0.9)
    expect(corr(sine, noise)).toBeLessThan(0.5)
    expect(highBandRatio(noise, SR, 1500)).toBeGreaterThan(highBandRatio(sine, SR, 1500) * 3)
  })
})

describe('synth.filter-envelopes', () => {
  it('LP12/LP24/HP/BP produce the expected spectral shapes', () => {
    const base = { oscWave: 2, filterFreq: 90 }
    const lp12 = renderSynth({ ...base, filterType: 0 })
    const lp24 = renderSynth({ ...base, filterType: 1 })
    const hp = renderSynth({ ...base, filterType: 2 })
    const bp = renderSynth({ ...base, filterType: 3 })
    // LP passes lows, HP passes highs.
    expect(highBandRatio(lp12, SR, 800)).toBeLessThan(highBandRatio(hp, SR, 800))
    // LP24 cuts harder than LP12 above the cutoff.
    expect(highBandRatio(lp24, SR, 1500)).toBeLessThan(highBandRatio(lp12, SR, 1500))
    // BP sits between: distinct from both LP and HP.
    expect(corr(bp, lp12)).toBeLessThan(0.98)
    expect(corr(bp, hp)).toBeLessThan(0.98)
  })

  it('cutoff, resonance, tracking, drive, and env amount each alter the signal', () => {
    const open = renderSynth({ oscWave: 2, filterFreq: 127 })
    const closed = renderSynth({ oscWave: 2, filterFreq: 20 })
    expect(highBandRatio(closed, SR, 1200)).toBeLessThan(highBandRatio(open, SR, 1200) * 0.5)
    const res = renderSynth({ oscWave: 2, filterFreq: 60, filterRes: 120 })
    expect(corr(open, res)).toBeLessThan(0.98)
    // Tracking: high notes keep brightness with full tracking.
    const noTrackHi = renderSynth({ oscWave: 2, filterFreq: 80, filterKbTrack: 0 }, 0.4, 84)
    const trackHi = renderSynth({ oscWave: 2, filterFreq: 80, filterKbTrack: 3 }, 0.4, 84)
    expect(highBandRatio(trackHi, SR, 1200)).toBeGreaterThan(highBandRatio(noTrackHi, SR, 1200) * 1.1)
    const driven = renderSynth({ oscWave: 2, filterDrive: 3 })
    expect(corr(open, driven)).toBeLessThan(0.98)
    const envSweep = renderSynth({ oscWave: 2, filterFreq: 40, filterEnvAmt: 127, filterEnv: { attack: 0, decay: 40, release: 30, velocity: 0 } })
    expect(corr(open, envSweep)).toBeLessThan(0.98)
  })

  it('amp envelope attack/decay/release have observable time-domain effects', () => {
    const fast = renderSynth({ oscWave: 0, ampEnv: { attack: 0, decay: 127, release: 10, velocity: 0 } }, 0.5)
    const slowAttack = renderSynth({ oscWave: 0, ampEnv: { attack: 100, decay: 127, release: 10, velocity: 0 } }, 0.5)
    // Slow attack: first 50 ms much quieter.
    expect(windowEnergy(slowAttack, 0, SR * 0.05)).toBeLessThan(windowEnergy(fast, 0, SR * 0.05) * 0.3)
    // Decay below max: the note decays away instead of sustaining.
    const decaying = renderSynth({ oscWave: 0, ampEnv: { attack: 0, decay: 40, release: 10, velocity: 0 } }, 0.8)
    const lateDecaying = windowEnergy(decaying, SR * 0.6, SR * 0.8)
    const lateSustained = windowEnergy(fast, SR * 0.6, SR * 0.8)
    expect(lateDecaying).toBeLessThan(lateSustained * 0.2 + 1e-9)
  })

  it('release shapes the tail after note-off (source-level, deterministic)', () => {
    const longRel = renderWithNoteOff(90)
    const shortRel = renderWithNoteOff(2)
    const tailLong = windowEnergy(longRel, SR * 0.5, SR * 0.9)
    const tailShort = windowEnergy(shortRel, SR * 0.5, SR * 0.9)
    expect(tailLong).toBeGreaterThan(tailShort * 3)
  })

  it('amp velocity levels make soft strikes quieter', () => {
    const mk = (vel: number, level: number) => {
      const s = synthWith((st) => {
        st.layers.A.ampEnv.velocity = level
      })
      const notes: NoteEvent[] = [{ note: 60, velocity: vel, start: 0, release: null, stop: null }]
      const frame = renderSynthLayerSource(s, 'A', notes, 0.3, SR, { bpm: 120, transpose: 0, wheelPos: 0, arpNotes: [] })
      const out = new Float32Array(frame.l.length)
      for (let i = 0; i < out.length; i++) out[i] = (frame.l[i] + frame.r[i]) / 2
      return out
    }
    const soft = mk(0.2, 3)
    const loud = mk(1.0, 3)
    expect(rms(soft)).toBeLessThan(rms(loud) * 0.7)
  })

  it('LFO to filter measurably wobbles the spectrum; LFO off keeps settings but does nothing', () => {
    const lfoOn = renderSynth({ oscWave: 2, lfoDest: 3, lfoRate: 100, lfoAmount: 127 }, 0.8)
    const lfoOff = renderSynth({ oscWave: 2, lfoDest: 0, lfoRate: 100, lfoAmount: 127 }, 0.8)
    const dry = renderSynth({ oscWave: 2 }, 0.8)
    expect(corr(lfoOff, dry)).toBeGreaterThan(0.999)
    expect(corr(lfoOn, dry)).toBeLessThan(0.995)
    // Time-varying: spectral content swings across LFO phases.
    let min = 1
    let max = 0
    for (let w = 0; w < 8; w++) {
      const e = highBandRatio(Float32Array.from(lfoOn.slice(SR * w * 0.1, SR * (w + 1) * 0.1)), SR, 1000)
      min = Math.min(min, e)
      max = Math.max(max, e)
    }
    expect(max - min).toBeGreaterThan(0.004)
  })

  it('LFO syncs to the master clock (rate doubles with BPM)', () => {
    const layer = defaultSynthState().layers.A
    layer.lfoSync = true
    layer.lfoRate = 2 // 1/4 note
    expect(lfoRateHz(layer, 120)).toBeCloseTo(2, 5)
    expect(lfoRateHz(layer, 240)).toBeCloseTo(4, 5)
  })
})

describe('synth.voice-modes', () => {
  it('poly plays chords; mono collapses to one voice line', async () => {
    const { engine } = await makeRig()
    engine.setSynthSectionOn(true)
    engine.setSectionOn(false)
    engine.update(() => (engine.synth.layers.A.voiceMode = 0))
    engine.noteOn(60, 0.9)
    engine.noteOn(64, 0.9)
    engine.noteOn(67, 0.9)
    expect(engine.getVoices().filter((v) => v.layer === 'synthA').length).toBe(3)
    engine.allNotesOff()
    engine.update(() => (engine.synth.layers.A.voiceMode = 1))
    engine.noteOn(60, 0.9)
    engine.noteOn(64, 0.9)
    expect(engine.getVoices().filter((v) => v.layer === 'synthA').length).toBe(1)
  })

  it('glide connects notes in mono with a portamento sweep (frequency moves over time)', () => {
    // Glide on: second note starts at the first note's pitch and sweeps.
    const s = synthWith((st) => {
      st.layers.A.voiceMode = 1
      st.layers.A.glide = 100
      st.layers.A.oscWave = 0 // sine: pitch is easy to track
    })
    const notes: NoteEvent[] = [
      { note: 60, velocity: 0.9, start: 0, release: 0.25, stop: null },
      { note: 72, velocity: 0.9, start: 0.25, release: null, stop: null },
    ]
    const frame = renderSynthLayerSource(s, 'A', notes, 0.6, SR, { bpm: 120, transpose: 0, wheelPos: 0, arpNotes: [] })
    const out = new Float32Array(frame.l.length)
    for (let i = 0; i < out.length; i++) out[i] = (frame.l[i] + frame.r[i]) / 2
    // Zero-crossing rate rises during the glide window (pitch sweeps up).
    const zcr = (buf: Float32Array, from: number, to: number) => {
      let crossings = 0
      for (let i = from + 1; i < to; i++) if (Math.sign(buf[i]) !== Math.sign(buf[i - 1])) crossings++
      return crossings / (to - from)
    }
    const duringGlide = zcr(out, Math.floor(SR * 0.25), Math.floor(SR * 0.32))
    const afterGlide = zcr(out, Math.floor(SR * 0.45), Math.floor(SR * 0.55))
    // During the sweep the average rate sits between the start and target pitch.
    expect(duringGlide).toBeLessThan(afterGlide * 1.05)
    expect(rms(out)).toBeGreaterThan(0.01)
  })

  it('unison adds detuned voices (denser, decorrelated from single voice)', () => {
    const single = renderSynth({ oscWave: 2, unison: 0 }, 0.4)
    const uni = renderSynth({ oscWave: 2, unison: 3 }, 0.4)
    expect(corr(single, uni)).toBeLessThan(0.95)
    expect(rms(uni)).toBeGreaterThan(rms(single))
  })

  it('vibrato On modulates pitch; Wheel mode is silent until the wheel moves', () => {
    const vib = renderSynth({ oscWave: 0, vibrato: 1, vibratoAmount: 127, vibratoRate: 80 }, 0.6)
    const dry = renderSynth({ oscWave: 0 }, 0.6)
    expect(corr(vib, dry)).toBeLessThan(0.99)
    const wheelStill = renderSynth({ oscWave: 0, vibrato: 2, vibratoAmount: 127 }, 0.6)
    expect(corr(wheelStill, dry)).toBeGreaterThan(0.999)
  })

  it('synth layers route through their own effect chains', async () => {
    const { engine, backend } = await makeRig()
    engine.setSynthSectionOn(true)
    engine.setSectionOn(false)
    engine.noteOn(60, 0.9)
    backend.advance(0.02)
    const dry = backend.renderMix(1.0)
    engine.update(() => {
      engine.effects.chains.synthA.reverb.on = true
      engine.effects.chains.synthA.reverb.amount = 120
      engine.effects.chains.synthA.reverb.type = 5
    })
    const wet = backend.renderMix(1.0)
    expect(windowEnergy(wet, SR * 0.7, SR)).toBeGreaterThan(windowEnergy(dry, SR * 0.7, SR) * 1.5)
  })
})

describe('synth.arp-gate', () => {
  function layer(partial: Partial<SynthLayerState>): SynthLayerState {
    return { ...defaultSynthState().layers.A, ...partial }
  }

  it('direction sequences are exact and deterministic (Up/Down/Up-Down/Random)', () => {
    const pool = [60, 64, 67]
    const up = new Arpeggiator().sequence(layer({ arpDirection: 0, arpMode: 0, arpRange: 1 }), pool, 5)
    expect(up).toEqual([60, 64, 67, 60, 64])
    const down = new Arpeggiator().sequence(layer({ arpDirection: 1, arpMode: 0, arpRange: 1 }), pool, 5)
    expect(down).toEqual([67, 64, 60, 67, 64])
    const updown = new Arpeggiator().sequence(layer({ arpDirection: 2, arpMode: 0, arpRange: 1 }), pool, 6)
    expect(updown).toEqual([60, 64, 67, 64, 60, 64])
    const rnd1 = new Arpeggiator().sequence(layer({ arpDirection: 3, arpMode: 0, arpRange: 1 }), pool, 8)
    const rnd2 = new Arpeggiator().sequence(layer({ arpDirection: 3, arpMode: 0, arpRange: 1 }), pool, 8)
    expect(rnd1).toEqual(rnd2) // seeded: reproducible
    expect(rnd1.every((n) => pool.includes(n))).toBe(true)
  })

  it('range expands the pool by octaves', () => {
    expect(Arpeggiator.pool([60, 64], 2, 0)).toEqual([60, 64, 72, 76])
    expect(Arpeggiator.pool([60, 64], 4, 0)).toEqual([60, 64, 72, 76, 84, 88, 96, 100])
  })

  it('rate: free quarter-note BPM, and clock-synced subdivisions', () => {
    const free = layer({ arpSync: false, arpRate: 63.5 })
    expect(arpStepsPerSecond(free, 120)).toBeCloseTo((30 + 0.5 * 270) / 60, 1)
    const sync16 = layer({ arpSync: true, arpRate: 6 }) // 1/16
    expect(arpStepsPerSecond(sync16, 120)).toBeCloseTo(8, 5) // 2 beats/sec ÷ 0.25
    const sync8 = layer({ arpSync: true, arpRate: 4 }) // 1/8
    expect(arpStepsPerSecond(sync8, 120)).toBeCloseTo(4, 5)
    // Doubling the master clock doubles the synced rate.
    expect(arpStepsPerSecond(sync16, 240)).toBeCloseTo(16, 5)
  })

  it('hold keeps the pool after keys lift; run gates the whole engine', async () => {
    const { engine } = await makeRig()
    engine.setSynthSectionOn(true)
    engine.update(() => {
      engine.synth.layers.A.arpHold = true
      engine.synth.layers.A.arpRun = true
    })
    engine.noteOn(60, 0.9)
    engine.noteOn(64, 0.9)
    engine.noteOff(60)
    engine.noteOff(64)
    expect(engine.getArpNotes('A')).toEqual([60, 64])
    engine.update(() => (engine.synth.layers.A.arpRun = false))
    // Run off: no arp events even with a pool.
    const s = synthWith((st) => {
      st.layers.A.arpRun = false
    })
    const frame = renderSynthLayerSource(s, 'A', [], 0.5, SR, { bpm: 120, transpose: 0, wheelPos: 0, arpNotes: [60, 64] })
    let energy = 0
    for (let i = 0; i < frame.l.length; i++) energy += frame.l[i] ** 2
    expect(energy).toBe(0)
  })

  it('running arp produces stepped note events with deterministic timing', () => {
    const s = synthWith((st) => {
      st.layers.A.arpRun = true
      st.layers.A.arpSync = true
      st.layers.A.arpRate = 4 // 1/8 at 120 BPM → 4 steps/sec
      st.layers.A.arpDirection = 0
      st.layers.A.arpRange = 1
    })
    const frame = renderSynthLayerSource(s, 'A', [], 1.0, SR, { bpm: 120, transpose: 0, wheelPos: 0, arpNotes: [60, 64, 67] })
    const out = new Float32Array(frame.l.length)
    for (let i = 0; i < out.length; i++) out[i] = (frame.l[i] + frame.r[i]) / 2
    expect(rms(out)).toBeGreaterThan(0.01)
    // 4 steps/sec: energy in each 250 ms step window.
    for (let step = 0; step < 4; step++) {
      const e = windowEnergy(out, SR * step * 0.25, SR * (step + 1) * 0.25)
      expect(e, `step ${step}`).toBeGreaterThan(0)
    }
  })

  it('gate mode re-triggers the held chord; poly mode plays it sustained per step', () => {
    const mk = (mode: number) => {
      const s = synthWith((st) => {
        st.layers.A.arpRun = true
        st.layers.A.arpMode = mode
        st.layers.A.arpRange = mode === 2 ? 4 : 1
        st.layers.A.arpSync = true
        st.layers.A.arpRate = 4
      })
      const frame = renderSynthLayerSource(s, 'A', [], 0.6, SR, { bpm: 120, transpose: 0, wheelPos: 0, arpNotes: [60, 64] })
      const out = new Float32Array(frame.l.length)
      for (let i = 0; i < out.length; i++) out[i] = (frame.l[i] + frame.r[i]) / 2
      return out
    }
    const poly = mk(1)
    const gate = mk(2)
    expect(rms(poly)).toBeGreaterThan(0.01)
    expect(rms(gate)).toBeGreaterThan(0.01)
    expect(corr(poly, gate)).toBeLessThan(0.999)
  })
})
