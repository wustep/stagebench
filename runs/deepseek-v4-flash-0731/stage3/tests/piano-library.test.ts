import { describe, expect, it } from 'vitest'
import { StageEngine } from '../src/audio/stage'
import { SampleLibrary, PIANO_TYPES, SAMPLE_FAMILIES, familyForType, nearestRoot } from '../src/audio/samples'
import { PianoLibrary } from '../src/piano/library'
import { StatusModel } from '../src/piano/status'
import { StageLifecycle } from '../src/piano/lifecycle2'

/**
 * piano.instrument-library, piano.layers, piano.pedals, piano.fallback —
 * six selectable types (recorded Grand/Upright/Electric sample sets audibly
 * distinct), two-layer enable/focus/level/octave with correct voice ownership,
 * sustain from UI/keyboard/MIDI honoring SUSTPED, and asset-failure fallback.
 *
 * These cross the audio boundary by rendering real PCM from the StageEngine.
 */

const SR = 8000
const lib = () => new SampleLibrary(SR, [0.2, 0.55, 0.95])

function rmsArray(a: Float32Array): number {
  let s = 0
  for (const x of a) s += x * x
  return Math.sqrt(s / a.length)
}

function renderType(type: (typeof PIANO_TYPES)[number]): number {
  const e = new StageEngine({ sampleRate: SR, library: lib() })
  e.setLayer('A', { type, level: 1, enabled: true })
  e.noteOn('A', 60, 0.9)
  return rmsArray(e.render(SR * 0.5).samples)
}

describe('piano.instrument-library', () => {
  it('all six types are selectable and produce audible, distinct output', () => {
    const results = PIANO_TYPES.map(renderType)
    for (const r of results) expect(r).toBeGreaterThan(1e-3)
    // pairwise distinctness
    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        expect(Math.abs(results[i] - results[j]) > 1e-6).toBe(true)
      }
    }
  })

  it('Grand, Upright, and Electric are the bundled sample-set families', () => {
    expect(SAMPLE_FAMILIES).toEqual(['grand', 'upright', 'electric'])
    expect(PIANO_TYPES.length).toBe(6)
    for (const fam of SAMPLE_FAMILIES) expect(familyForType(fam as unknown as (typeof PIANO_TYPES)[number])).toBe(fam)
  })

  it('sample library has enough root notes and velocity layers to avoid uniform pitch-shift', () => {
    const l = lib()
    const roots = l.roots()
    expect(roots.length).toBeGreaterThanOrEqual(14) // across E1..E7
    // max gap between roots is small (bounded pitch-shift)
    for (let i = 1; i < roots.length; i++) {
      expect(roots[i] - roots[i - 1]).toBeLessThanOrEqual(5)
    }
    expect(l.layers().length).toBeGreaterThanOrEqual(2)
    const nearest = nearestRoot(60)
    expect(Math.abs(nearest - 60)).toBeLessThanOrEqual(3)
  })

  it('declared sample entries carry truthful, redistributable provenance', () => {
    const entries = lib().entries()
    expect(entries.length).toBe(SAMPLE_FAMILIES.length * lib().roots().length * lib().layers().length)
    for (const e of entries) {
      expect(e.asset).toMatch(/^public\/samples\//)
      expect(e.license).toMatch(/not a field recording/i)
      expect(e.data.length).toBeGreaterThan(0)
      expect(e.root).toBeGreaterThanOrEqual(28)
      expect(e.root).toBeLessThanOrEqual(100)
    }
  })

  it('sample assets are bundled and loadable offline (no network dependency)', async () => {
    const engine = new StageEngine({ sampleRate: SR, library: lib() })
    const status = new StatusModel()
    // offline synchronous load succeeds without any network
    const pl = new PianoLibrary({ engine, status, library: lib() })
    const phase = await pl.load()
    expect(phase).toBe('ready')
    expect(status.snapshot.status).toBe('ready')
    expect(status.snapshot.usingFallback).toBe(false)
  })
})

describe('piano.layers', () => {
  it('two layers with enable/focus/level/octave and correct voice ownership', () => {
    const e = new StageEngine({ sampleRate: SR, library: lib() })
    e.setLayer('A', { type: 'Grand', level: 0.8, enabled: true, octave: 0 })
    e.setLayer('B', { type: 'Electric', level: 0.8, enabled: true, octave: 12 })
    const lc = new StageLifecycle(e)
    lc.noteOn(60, 0.9, 'k')
    // both layers enabled -> 2 primary voices owned by A and B
    const details = e.activeVoiceDetails
    expect(details.length).toBeGreaterThanOrEqual(2)
    const layersOwned = new Set(details.map((v) => v.layer))
    expect(layersOwned.has('A')).toBe(true)
    expect(layersOwned.has('B')).toBe(true)
    // B octave-shifted: its voice pitch is 60+12=72
    const bVoices = details.filter((v) => v.layer === 'B')
    expect(bVoices[0].midi).toBe(72)
    lc.noteOff(60, 'k')
  })

  it('disabling a layer stops new voices being owned by it', () => {
    const e = new StageEngine({ sampleRate: SR, library: lib() })
    e.setLayer('A', { enabled: true })
    e.setLayer('B', { enabled: false })
    e.noteOn('A', 60, 0.9)
    e.noteOn('B', 60, 0.9)
    const details = e.activeVoiceDetails
    expect(details.every((v) => v.layer === 'A')).toBe(true)
  })

  it('layer level scales that layer only (independent mixing)', () => {
    function levelSum(aLev: number, bLev: number): number {
      const e = new StageEngine({ sampleRate: SR, library: lib() })
      e.setLayer('A', { type: 'Grand', level: aLev, enabled: true })
      e.setLayer('B', { type: 'Upright', level: bLev, enabled: true })
      e.noteOn('A', 60, 0.9)
      e.noteOn('B', 60, 0.9)
      return rmsArray(e.render(SR * 0.4).samples)
    }
    const both = levelSum(1, 1)
    const aOnly = levelSum(1, 0)
    expect(both).toBeGreaterThan(aOnly)
    expect(aOnly).toBeGreaterThan(0)
  })

  it('layer state is independently settable for both layers (focus/edit target)', () => {
    // focus selects the edit target; each layer still holds its own state
    const e = new StageEngine({ sampleRate: SR, library: lib() })
    expect(e.layerState.A).toBeTruthy()
    expect(e.layerState.B).toBeTruthy()
    e.setLayer('A', { type: 'Clav' })
    e.setLayer('B', { type: 'Misc' })
    expect(e.layerState.A.type).toBe('Clav')
    expect(e.layerState.B.type).toBe('Misc')
  })
})

describe('piano.pedals — sustain honors SUSTPED', () => {
  function sustainTail(sustped: boolean, pedalHeld: boolean): number {
    const e = new StageEngine({ sampleRate: SR, library: lib() })
    e.setLayer('A', { level: 1, enabled: true, sustped })
    e.noteOn('A', 60, 0.9)
    e.render(SR * 0.1)
    if (pedalHeld) e.setSustain(true)
    e.noteOff('A', 60)
    return rmsArray(e.render(SR).samples)
  }

  it('sustain only holds notes when SUSTPED routes the pedal to the layer', () => {
    const withPedal = sustainTail(true, true)
    const noPedalRoute = sustainTail(false, true) // SUSTPED off -> no sustain
    const released = sustainTail(true, false)
    expect(withPedal).toBeGreaterThan(released)
    // SUSTPED off behaves like a plain release
    expect(Math.abs(noPedalRoute - released)).toBeLessThan(1e-4)
  })

  it('StageLifecycle sustain reaches layers and reflects state', () => {
    const e = new StageEngine({ sampleRate: SR, library: lib() })
    const lc = new StageLifecycle(e)
    expect(lc.status.sustain).toBe(false)
    lc.setSustain(true)
    expect(lc.status.sustain).toBe(true)
    expect(e.sustainInput).toBe(true)
  })

  it('all-notes-off silences every layer and voice (cleanup)', () => {
    const e = new StageEngine({ sampleRate: SR, library: lib() })
    e.setLayer('A', { enabled: true })
    e.setLayer('B', { enabled: true })
    e.noteOn('A', 60, 0.9)
    e.noteOn('B', 64, 0.9)
    expect(e.voiceCount).toBeGreaterThan(0)
    e.allNotesOff()
    expect(e.voiceCount).toBe(0)
    expect(rmsArray(e.render(SR * 0.2).samples)).toBeLessThan(1e-6)
  })

  it('dispose releases owned voices and returns to baseline', () => {
    const e = new StageEngine({ sampleRate: SR, library: lib() })
    e.setLayer('A', { enabled: true })
    e.noteOn('A', 60, 0.9)
    expect(e.voiceCount).toBe(1)
    e.dispose()
    expect(e.voiceCount).toBe(0)
  })
})

describe('piano.fallback — labeled playable fallback', () => {
  it('asset failure enters a labeled playable fallback, not ready', async () => {
    const engine = new StageEngine({ sampleRate: SR, library: lib() })
    const status = new StatusModel()
    const pl = new PianoLibrary({
      engine, status, library: lib(),
      load: async () => { throw new Error('corrupt asset') },
    })
    const phase = await pl.load()
    expect(phase).toBe('fallback')
    expect(status.snapshot.status).toBe('fallback')
    expect(status.snapshot.usingFallback).toBe(true)
    expect(status.snapshot.message).toMatch(/fallback/i)
    // fallback stays playable (labeled synthesized voice)
    engine.setLayer('A', { type: 'Grand', level: 1, enabled: true })
    engine.noteOn('A', 60, 0.9)
    expect(rmsArray(engine.render(SR * 0.4).samples)).toBeGreaterThan(1e-3)
    expect(engine.isFallback).toBe(true)
  })

  it('retry after failure can recover to ready', async () => {
    const engine = new StageEngine({ sampleRate: SR, library: lib() })
    const status = new StatusModel()
    let shouldFail = true
    const pl = new PianoLibrary({
      engine, status, library: lib(),
      load: async () => { if (shouldFail) throw new Error('missing') },
    })
    expect(await pl.load()).toBe('fallback')
    shouldFail = false
    expect(await pl.retry()).toBe('ready')
    expect(status.snapshot.status).toBe('ready')
    expect(engine.isFallback).toBe(false)
  })
})