import { describe, expect, it } from 'vitest'
import { StageEngine } from '../src/audio/stage'
import { SampleLibrary } from '../src/audio/samples'

/**
 * piano.velocity-controls: KB Touch, Dyn Comp, Timbre, Unison, Soft Release,
 * String Res, and Master Level each measurably change rendered audio.
 *
 * These tests cross the audio boundary: they render real PCM from the pure-DSP
 * StageEngine and assert the control moved the signal in the expected way.
 */

const SR = 8000

function make(type: 'Grand' | 'Upright' | 'Electric' | 'Clav' | 'Digital' | 'Misc' = 'Grand') {
  const engine = new StageEngine({ sampleRate: SR, library: new SampleLibrary(SR, [0.2, 0.55, 0.95]) })
  engine.setLayer('A', { type, level: 1, enabled: true })
  engine.noteOn('A', 60, 0.9)
  return engine
}

function rms(e: StageEngine, frames = SR * 0.5): number {
  return rmsArray(e.render(frames).samples)
}

function rmsArray(a: Float32Array): number {
  let s = 0
  for (const x of a) s += x * x
  return Math.sqrt(s / a.length)
}

describe('piano.velocity-controls', () => {
  it('output differs from silence and velocity moves it in the expected direction', () => {
    const silent = new StageEngine({ sampleRate: SR, library: new SampleLibrary(SR) })
    expect(rms(silent, SR)).toBeLessThan(1e-6)
    const soft = new StageEngine({ sampleRate: SR, library: new SampleLibrary(SR) })
    soft.setLayer('A', { level: 1, enabled: true })
    soft.noteOn('A', 60, 0.1)
    const loud = new StageEngine({ sampleRate: SR, library: new SampleLibrary(SR) })
    loud.setLayer('A', { level: 1, enabled: true })
    loud.noteOn('A', 60, 1.0)
    expect(rms(loud)).toBeGreaterThan(rms(soft))
    void make
  })

  it('KB Touch changes the velocity-response curve (measured output)', () => {
    // same velocity, different curve -> output level differs
    const heavy = new StageEngine({ sampleRate: SR, library: new SampleLibrary(SR) })
    heavy.setLayer('A', { level: 1, enabled: true, kbTouch: 0 })
    heavy.noteOn('A', 60, 0.3)
    const light = new StageEngine({ sampleRate: SR, library: new SampleLibrary(SR) })
    light.setLayer('A', { level: 1, enabled: true, kbTouch: 2 })
    light.noteOn('A', 60, 0.3)
    const h = rms(heavy)
    const l = rms(light)
    // Light curve boosts soft strokes at the same velocity
    expect(l).toBeGreaterThan(h)
  })

  it('Dyn Comp raises softer signals (narrowing dynamic range)', () => {
    const off = new StageEngine({ sampleRate: SR, library: new SampleLibrary(SR) })
    off.setLayer('A', { level: 1, enabled: true, dynComp: 0 })
    off.noteOn('A', 60, 0.15)
    const on = new StageEngine({ sampleRate: SR, library: new SampleLibrary(SR) })
    on.setLayer('A', { level: 1, enabled: true, dynComp: 3 })
    on.noteOn('A', 60, 0.15)
    expect(rms(on)).toBeGreaterThan(rms(off))
  })

  it('Unison adds detuned voices (output changes and widens)', () => {
    const mono = new StageEngine({ sampleRate: SR, library: new SampleLibrary(SR) })
    mono.setLayer('A', { level: 1, enabled: true, unison: 0 })
    mono.noteOn('A', 60, 0.9)
    const unis = new StageEngine({ sampleRate: SR, library: new SampleLibrary(SR) })
    unis.setLayer('A', { level: 1, enabled: true, unison: 3 })
    unis.noteOn('A', 60, 0.9)
    expect(unis.voiceCount).toBeGreaterThan(mono.voiceCount)
    const a = mono.render(SR * 0.3).samples
    const b = unis.render(SR * 0.3).samples
    let diff = 0
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i])
    expect(diff).toBeGreaterThan(1e-3)
  })

  it('Timbre changes the rendered signal', () => {
    const t0 = new StageEngine({ sampleRate: SR, library: new SampleLibrary(SR) })
    t0.setLayer('A', { level: 1, enabled: true, timbre: 0 })
    t0.noteOn('A', 60, 0.9)
    const t3 = new StageEngine({ sampleRate: SR, library: new SampleLibrary(SR) })
    t3.setLayer('A', { level: 1, enabled: true, timbre: 3 })
    t3.noteOn('A', 60, 0.9)
    expect(rmsArray(t0.render(SR * 0.2).samples)).not.toBeCloseTo(rmsArray(t3.render(SR * 0.2).samples), 6)
  })

  it('Soft Release makes release last longer (more tail after note-off)', () => {
    function tail(soft: boolean): number {
      const e = new StageEngine({ sampleRate: SR, library: new SampleLibrary(SR) })
      e.setLayer('A', { level: 1, enabled: true, softRelease: soft })
      e.noteOn('A', 60, 0.9)
      e.render(SR * 0.1)
      e.noteOff('A', 60)
      e.setSustain(false)
      return rmsArray(e.render(SR).samples) // tail after off
    }
    const plain = tail(false)
    const soft = tail(true)
    expect(soft).toBeGreaterThan(plain)
  })

  it('String Res adds sympathetic content while other notes or sustain are held', () => {
    const noRes = new StageEngine({ sampleRate: SR, library: new SampleLibrary(SR) })
    noRes.setLayer('A', { level: 1, enabled: true, stringRes: false })
    const yesRes = new StageEngine({ sampleRate: SR, library: new SampleLibrary(SR) })
    yesRes.setLayer('A', { level: 1, enabled: true, stringRes: true })
    for (const e of [noRes, yesRes]) {
      e.noteOn('A', 60, 0.9)
      e.render(SR * 0.05)
      e.noteOn('A', 72, 0.9)
    }
    const a = noRes.render(SR * 0.4).samples
    const b = yesRes.render(SR * 0.4).samples
    let diff = 0
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i])
    expect(diff).toBeGreaterThan(1e-4)
  })

  it('Master Level scales the master output (nothing bypasses it)', () => {
    const full = new StageEngine({ sampleRate: SR, library: new SampleLibrary(SR) })
    full.setLayer('A', { level: 1, enabled: true })
    full.noteOn('A', 60, 0.9)
    const a = full.render(SR * 0.2).samples
    full.setMasterLevel(0.25)
    const b = full.render(SR * 0.2).samples
    // second block is quieter
    expect(rmsArray(b)).toBeLessThan(rmsArray(a))
  })
})