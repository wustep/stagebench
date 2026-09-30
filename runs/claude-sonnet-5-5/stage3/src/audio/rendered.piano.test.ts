// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { defaultState, type EngineState, type LayerId, type PianoLayerState } from '../engine/state'
import type { PianoType } from './library/catalog'
import { audibleSeconds, bandEnergy, correlation, difference, dominantHz, fundamentalAt, isHarmonicSeries, peak, rms, spectralCentroid } from '../test-utils/analysis'
import { renderNotes, type NoteEvent, type OfflineRig } from '../test-utils/offline'

/**
 * These tests cross the audio boundary: the real engine renders on a real Web Audio implementation
 * (node-web-audio-api OfflineAudioContext) and the assertions are tolerant relationships between rendered signals.
 */
const rigs: OfflineRig[] = []
afterEach(() => {
  while (rigs.length) rigs.pop()!.dispose()
})

const layer = (id: LayerId, patch: Partial<PianoLayerState>) => (s: EngineState): EngineState => ({ ...s, layers: { ...s.layers, [id]: { ...s.layers[id], ...patch } } })
const A = (patch: Partial<PianoLayerState>) => layer('A', patch)
const both = (...edits: Array<(s: EngineState) => EngineState>) => (s: EngineState) => edits.reduce((acc, e) => e(acc), s)

const play = async (seconds: number, notes: NoteEvent[], edit: (s: EngineState) => EngineState = (s) => s, extra?: Parameters<typeof renderNotes>[3]) => {
  const out = await renderNotes(seconds, notes, edit, extra)
  rigs.push(out.rig)
  return out
}
const SR = 44100
const at = (seconds: number) => Math.floor(seconds * SR)
const TYPES: PianoType[] = ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc']

describe('piano.instrument-library — six types, three recorded sets', () => {
  it('every type renders audible, correctly pitched audio (A4 = 440 Hz harmonic series)', async () => {
    for (const type of TYPES) {
      const r = await play(1.5, [{ note: 69, velocity: 100 }], A({ type }))
      expect(rms(r.mono), type).toBeGreaterThan(0.004)
      expect(peak(r.mono), type).toBeLessThanOrEqual(1)
      // marimba bars are inharmonic by design; every other type sits on the harmonic series of A4
      if (type !== 'Misc') expect(isHarmonicSeries(r.mono, r.sampleRate, at(0.2), 440), type).toBe(true)
      // and not an octave or semitone away: the fundamental band carries real energy
      expect(bandEnergy(r.mono, SR, 425, 455, at(0.2), 16384), type).toBeGreaterThan(bandEnergy(r.mono, SR, 400, 415, at(0.2), 16384))
    }
  })

  it('Grand, Upright and Electric are played from recordings; Clav, Digital and Misc from live synthesis', async () => {
    const origins: Record<string, string[]> = {}
    for (const type of TYPES) {
      let seen: string[] = []
      await play(0.6, [{ note: 60 }], A({ type }), (rig) => [{ at: 0.3, run: () => (seen = rig.instrument.sink.liveVoices().map((v) => v.origin)) }])
      origins[type] = seen
    }
    expect(origins).toEqual({ Grand: ['recorded'], Upright: ['recorded'], Electric: ['recorded'], Clav: ['synth'], Digital: ['synth'], Misc: ['synth'] })
  })

  it('the three recorded sets and the three synth types render distinct signals', async () => {
    const out = new Map<PianoType, Awaited<ReturnType<typeof play>>>()
    for (const type of TYPES) out.set(type, await play(2, [{ note: 60, velocity: 96 }], A({ type })))
    const centroid = (t: PianoType) => spectralCentroid(out.get(t)!.mono, SR, at(0.15))
    const decay = (t: PianoType) => rms(out.get(t)!.mono, at(1.5), at(2)) / rms(out.get(t)!.mono, at(0.1), at(0.6))
    for (let i = 0; i < TYPES.length; i++) {
      for (let j = i + 1; j < TYPES.length; j++) {
        const a = TYPES[i]
        const b = TYPES[j]
        expect(difference(out.get(a)!.mono, out.get(b)!.mono), `${a} vs ${b}`).toBeGreaterThan(0.5)
        const spectral = Math.abs(centroid(a) - centroid(b)) / Math.max(centroid(a), centroid(b))
        const envelope = Math.abs(decay(a) - decay(b)) / Math.max(decay(a), decay(b), 1e-6)
        expect(Math.max(spectral, envelope), `${a} vs ${b}: spectral ${spectral.toFixed(2)} envelope ${envelope.toFixed(2)}`).toBeGreaterThan(0.06)
      }
    }
  }, 60000)

  it('is not one note pitch-shifted: many root notes across the keyboard, each correctly pitched', async () => {
    for (const type of ['Grand', 'Upright', 'Electric'] as const) {
      for (const note of [33, 40, 47, 55, 62, 69, 76, 83, 90]) {
        const r = await play(1.2, [{ note, velocity: 90 }], A({ type }))
        const expected = 440 * Math.pow(2, (note - 69) / 12)
        expect(fundamentalAt(r.mono, r.sampleRate, at(0.1), expected), `${type} ${note}`).toBe(true)
      }
    }
  }, 120000)

  it('velocity moves level and brightness up: soft < medium < hard', async () => {
    for (const type of ['Grand', 'Upright', 'Electric'] as const) {
      const soft = await play(1.2, [{ note: 60, velocity: 25 }], A({ type }))
      const mid = await play(1.2, [{ note: 60, velocity: 70 }], A({ type }))
      const hard = await play(1.2, [{ note: 60, velocity: 122 }], A({ type }))
      expect(rms(soft.mono, 0, at(0.5)), type).toBeLessThan(rms(mid.mono, 0, at(0.5)))
      expect(rms(mid.mono, 0, at(0.5)), type).toBeLessThan(rms(hard.mono, 0, at(0.5)))
      const c = (r: typeof soft) => spectralCentroid(r.mono, SR, at(0.02), 4096)
      expect(c(hard), type).toBeGreaterThan(c(soft))
    }
  }, 60000)

  it('models within a type are different instruments (Electric: Wurlitzer vs Pianet)', async () => {
    const a = await play(1.5, [{ note: 64, velocity: 100 }], A({ type: 'Electric', models: { ...defaultState().layers.A.models, Electric: 0 } }))
    const b = await play(1.5, [{ note: 64, velocity: 100 }], A({ type: 'Electric', models: { ...defaultState().layers.A.models, Electric: 1 } }))
    expect(difference(a.mono, b.mono)).toBeGreaterThan(0.5)
  })

  it('the master path is the only way out: master level 0 is silence, even with every effect on', async () => {
    const edit = both(
      (s) => ({ ...s, master: 0 }),
      (s) => ({ ...s, fx: { ...s.fx, A: { ...s.fx.A, reverb: { ...s.fx.A.reverb, on: true, dryWet: 1 }, delay: { ...s.fx.A.delay, on: true }, amp: { ...s.fx.A.amp, on: true, type: 'To Rotary' } } } }),
    )
    const r = await play(1.5, [{ note: 60, velocity: 110 }], edit)
    expect(peak(r.mono)).toBeLessThan(1e-4)
  })
})

describe('piano.velocity-controls — KB Touch, Dyn Comp, Timbre, Unison, Soft Release, String Res, Master Level', () => {
  it('KB Touch: at the same key velocity Light is louder than Medium, Medium louder than Heavy', async () => {
    const level = async (kbTouch: 'Heavy' | 'Medium' | 'Light') => rms((await play(1, [{ note: 60, velocity: 64 }], A({ kbTouch }))).mono, 0, at(0.5))
    const [heavy, medium, light] = [await level('Heavy'), await level('Medium'), await level('Light')]
    expect(heavy).toBeLessThan(medium)
    expect(medium).toBeLessThan(light)
  })

  it('Dyn Comp raises soft strokes step by step while a full-velocity stroke stays put', async () => {
    const level = async (dynComp: 0 | 1 | 2 | 3, velocity: number) => rms((await play(1, [{ note: 60, velocity }], A({ dynComp }))).mono, 0, at(0.5))
    const soft = [await level(0, 30), await level(1, 30), await level(2, 30), await level(3, 30)]
    expect(soft[1]).toBeGreaterThan(soft[0] * 1.03)
    expect(soft[2]).toBeGreaterThan(soft[1])
    expect(soft[3]).toBeGreaterThan(soft[2])
    const loud0 = await level(0, 127)
    const loud3 = await level(3, 127)
    expect(Math.abs(loud3 / loud0 - 1)).toBeLessThan(0.05)
    // dynamic range between soft and loud is narrower
    expect(soft[3] / loud3).toBeGreaterThan(soft[0] / loud0)
  })

  it('Timbre: Soft is darker than Off, Bright is brighter; Mid emphasises the midrange; Dyno adds bell treble', async () => {
    const high = async (type: PianoType, timbre: PianoLayerState['timbre']) => {
      const r = await play(1.2, [{ note: 60, velocity: 90 }], A({ type, timbre }))
      return { hf: bandEnergy(r.mono, SR, 3000, 12000, at(0.05)), lf: bandEnergy(r.mono, SR, 60, 200, at(0.05)), mid: bandEnergy(r.mono, SR, 900, 2200, at(0.05)) }
    }
    const off = await high('Grand', 'Off')
    const soft = await high('Grand', 'Soft')
    const bright = await high('Grand', 'Bright')
    const mid = await high('Grand', 'Mid')
    expect(soft.hf).toBeLessThan(off.hf * 0.6)
    expect(bright.hf).toBeGreaterThan(off.hf * 1.5)
    expect(mid.mid / mid.hf).toBeGreaterThan(off.mid / off.hf)
    const eOff = await high('Electric', 'Off')
    const dyno1 = await high('Electric', 'Dyno 1')
    const dyno2 = await high('Electric', 'Dyno 2')
    expect(dyno1.hf).toBeGreaterThan(eOff.hf * 1.5)
    expect(dyno2.lf).toBeGreaterThan(dyno1.lf * 1.5) // Dyno 2 also boosts the bass
  })

  it('Unison detunes into stereo: wider and further from the plain signal at each step', async () => {
    const run = async (unison: 0 | 1 | 2 | 3) => play(2, [{ note: 60, velocity: 100 }], A({ unison }))
    const [u0, u1, u2, u3] = [await run(0), await run(1), await run(2), await run(3)]
    expect(correlation(u0.left, u0.right)).toBeGreaterThan(0.999) // mono when off
    expect(correlation(u3.left, u3.right)).toBeLessThan(0.98)
    expect(correlation(u3.left, u3.right)).toBeLessThan(correlation(u1.left, u1.right))
    expect(difference(u0.mono, u1.mono)).toBeLessThan(difference(u0.mono, u3.mono))
    expect(difference(u0.left, u2.left)).toBeGreaterThan(0.2)
    // beating between detuned voices makes the envelope waver more than the single voice
    const wobble = (r: typeof u0) => {
      let d = 0
      let n = 0
      for (let i = at(0.4); i + 2048 < at(1.8); i += 2048) {
        d += Math.abs(rms(r.left, i, i + 2048) - rms(r.left, i + 2048, i + 4096))
        n++
      }
      return d / n / rms(r.left, at(0.4), at(1.8))
    }
    expect(wobble(u3)).toBeGreaterThan(wobble(u0))
  })

  it('Soft Release lengthens the acoustic release, shortens the electric one, and does nothing for Clav', async () => {
    const tail = async (type: PianoType, softRelease: boolean) => {
      const r = await play(2, [{ note: 60, velocity: 100, off: 0.6 }], A({ type, softRelease }))
      return rms(r.mono, at(0.72), at(1.1))
    }
    expect(await tail('Grand', true)).toBeGreaterThan((await tail('Grand', false)) * 1.5)
    expect(await tail('Electric', true)).toBeLessThan(await tail('Electric', false))
    // Clav: the reducer refuses the switch, so the request cannot change anything
    const { setSoftRelease, setType } = await import('../engine/state')
    let s = setType(defaultState(), 'Clav')
    s = setSoftRelease(s, true)
    expect(s.layers.A.softRelease).toBe(false)
  })

  it('String Res adds sympathetic resonance while the pedal is down (Grand and Upright only)', async () => {
    const run = async (type: PianoType, stringRes: boolean) => {
      const r = await play(2.4, [{ note: 48, velocity: 90, at: 0.05 }, { note: 60, velocity: 90, at: 0.7 }], A({ type, stringRes }), (rig) => [
        { at: 0.01, run: () => rig.instrument.lifecycle.sustain('pedal', true) },
      ])
      return r
    }
    const off = await run('Grand', false)
    const on = await run('Grand', true)
    expect(difference(off.mono, on.mono)).toBeGreaterThan(0.03)
    expect(rms(on.mono, at(0.7), at(2.2))).toBeGreaterThan(rms(off.mono, at(0.7), at(2.2)))
    const upOn = await run('Upright', true)
    const upOff = await run('Upright', false)
    expect(difference(upOn.mono, upOff.mono)).toBeGreaterThan(0.03)
    // no resonance model for electric pianos: the state refuses the switch
    const { setStringRes, setType } = await import('../engine/state')
    expect(setStringRes(setType(defaultState(), 'Electric'), true).layers.A.stringRes).toBe(false)
  })

  it('Master Level scales the output: half the knob = a quarter of the gain, zero = silence', async () => {
    const level = async (master: number) => rms((await play(1, [{ note: 60, velocity: 90 }], (s) => ({ ...s, master }))).mono, 0, at(0.5))
    const full = await level(0.72)
    const half = await level(0.36)
    expect(half / full).toBeGreaterThan(0.2)
    expect(half / full).toBeLessThan(0.3)
    expect(await level(0)).toBeLessThan(1e-5)
    expect(await level(1)).toBeGreaterThan(full)
  })

  it('the limiter keeps a dense, loud chord below full scale', async () => {
    const notes = Array.from({ length: 14 }, (_, i) => ({ note: 36 + i * 4, velocity: 127 }))
    const r = await play(1.5, notes, (s) => ({ ...s, master: 1 }))
    expect(peak(r.mono)).toBeLessThan(1)
    expect(rms(r.mono)).toBeGreaterThan(0.02)
  })
})

describe('piano.pedals — sustain from the lifecycle (UI, keyboard and MIDI CC64 all end here)', () => {
  it('sustain keeps a released note ringing; releasing the pedal lets it go', async () => {
    const run = async (pedal: boolean) =>
      play(2.4, [{ note: 60, velocity: 100, off: 0.4 }], A({ type: 'Upright' }), (rig) =>
        pedal ? [{ at: 0.01, run: () => rig.instrument.lifecycle.sustain('p', true) }, { at: 1.4, run: () => rig.instrument.lifecycle.sustain('p', false) }] : [],
      )
    const dry = await run(false)
    const held = await run(true)
    expect(rms(held.mono, at(0.6), at(1.3))).toBeGreaterThan(rms(dry.mono, at(0.6), at(1.3)) * 5)
    expect(rms(held.mono, at(1.9), at(2.3))).toBeLessThan(rms(held.mono, at(0.6), at(1.0)) * 0.3) // damper came down at 1.4 s
    expect(audibleSeconds(held.mono, SR, 0.003, at(0.4))).toBeGreaterThan(audibleSeconds(dry.mono, SR, 0.003, at(0.4)))
  })

  it('SUSTPED is per layer: only layers with the pedal routed keep sounding', async () => {
    const r = await play(1, [{ note: 60, velocity: 100, off: 0.3 }], both(layer('A', { sustPed: true }), layer('B', { enabled: true, sustPed: false })), (rig) => [
      { at: 0.01, run: () => rig.instrument.lifecycle.sustain('p', true) },
      { at: 0.5, run: () => void (states = rig.instrument.lifecycle.getVoices().map((v) => `${v.layer}:${v.state}`).sort()) },
    ])
    expect(r).toBeDefined()
    expect(states).toEqual(['A:sustained', 'B:releasing'])
  })

  it('with SUSTPED off on every layer the pedal changes nothing', async () => {
    const run = async (pedal: boolean) =>
      play(1.6, [{ note: 60, velocity: 100, off: 0.3 }], A({ sustPed: false }), (rig) => (pedal ? [{ at: 0.01, run: () => rig.instrument.lifecycle.sustain('p', true) }] : []))
    const a = await run(true)
    const b = await run(false)
    expect(difference(a.mono, b.mono)).toBeLessThan(0.01)
  })
})

let states: string[] = []

describe('piano.layers — two layers, correct voice ownership', () => {
  it('each key starts one voice per enabled layer, owned by that layer, with the layer’s own sound', async () => {
    let seen: Array<{ layer: LayerId; origin: string }> = []
    await play(0.6, [{ note: 60 }], both(layer('A', { type: 'Grand' }), layer('B', { enabled: true, type: 'Clav' })), (rig) => [
      { at: 0.3, run: () => (seen = rig.instrument.sink.liveVoices().map((v) => ({ layer: v.layer, origin: v.origin })).sort((a, b) => a.layer.localeCompare(b.layer))) },
    ])
    expect(seen).toEqual([{ layer: 'A', origin: 'recorded' }, { layer: 'B', origin: 'synth' }])
  })

  it('a disabled layer stays silent and the section switch mutes everything', async () => {
    const a = await play(1, [{ note: 60 }])
    const aOnly = await play(1, [{ note: 60 }], layer('B', { enabled: false }))
    expect(difference(a.mono, aOnly.mono)).toBeLessThan(0.001)
    const off = await play(1, [{ note: 60 }], (s) => ({ ...s, pianoOn: false }))
    expect(peak(off.mono)).toBeLessThan(1e-4)
    const noneA = await play(1, [{ note: 60 }], both(layer('A', { enabled: false }), layer('B', { enabled: true })))
    expect(peak(noneA.mono)).toBeGreaterThan(0.01)
    expect(difference(noneA.mono, a.mono)).toBeGreaterThan(0.5)
  })

  it('layer level faders mix the layers: B at zero equals A alone, B up adds to the sum', async () => {
    const base = both(layer('A', { type: 'Grand' }), layer('B', { enabled: true, type: 'Misc' }))
    const b0 = await play(1.2, [{ note: 60 }], both(base, layer('B', { level: 0 })))
    const aOnly = await play(1.2, [{ note: 60 }], layer('B', { enabled: false }))
    const b5 = await play(1.2, [{ note: 60 }], both(base, layer('B', { level: 0.5 })))
    const b10 = await play(1.2, [{ note: 60 }], both(base, layer('B', { level: 1 })))
    expect(difference(b0.mono, aOnly.mono)).toBeLessThan(0.001)
    expect(rms(b5.mono)).toBeGreaterThan(rms(b0.mono))
    expect(rms(b10.mono)).toBeGreaterThan(rms(b5.mono))
    // A's level scales A alone
    const aLow = await play(1, [{ note: 60 }], both(layer('B', { enabled: false }), layer('A', { level: 0.5 })))
    expect(rms(aLow.mono) / rms(aOnly.mono)).toBeGreaterThan(0.2)
    expect(rms(aLow.mono) / rms(aOnly.mono)).toBeLessThan(0.36)
  })

  it('octave shift moves the layer by ±12 semitones and only that layer', async () => {
    const hz = async (octave: -1 | 0 | 1) => {
      const r = await play(1.2, [{ note: 57, velocity: 100 }], A({ octave }))
      return dominantHz(r.mono, SR, at(0.15), 16384, 100, 1800)
    }
    const [down, mid, up] = [await hz(-1), await hz(0), await hz(1)]
    expect(up / mid).toBeGreaterThan(1.97)
    expect(up / mid).toBeLessThan(2.03)
    expect(mid / down).toBeGreaterThan(1.97)
    expect(mid / down).toBeLessThan(2.03)
    // layered: A stays put while B moves up
    const r = await play(1.2, [{ note: 57, velocity: 100 }], both(layer('B', { enabled: true, octave: 1, type: 'Grand' }), A({ octave: 0 })))
    const spectrum = (from: number, to: number) => bandEnergy(r.mono, SR, from, to, at(0.15), 16384)
    expect(spectrum(200, 240)).toBeGreaterThan(spectrum(300, 400)) // A's A3 (220 Hz)
    expect(spectrum(420, 460)).toBeGreaterThan(spectrum(300, 400)) // B's A4 (440 Hz)
  })

  it('a layer shifted outside the piano range is skipped without touching the other layer', async () => {
    let seen: LayerId[] = []
    await play(0.5, [{ note: 100 }], both(layer('A', { octave: 1 }), layer('B', { enabled: true })), (rig) => [{ at: 0.2, run: () => (seen = rig.instrument.sink.liveVoices().map((v) => v.layer)) }])
    expect(seen).toEqual(['B'])
  })

  it('releasing a layer or the section releases its voices; nothing is left behind after cleanup', async () => {
    const r = await play(1.2, [{ note: 60 }, { note: 64 }], layer('B', { enabled: true }), (rig) => [
      { at: 0.3, run: () => rig.state.update((s) => ({ ...s, layers: { ...s.layers, B: { ...s.layers.B, enabled: false } } })) },
      { at: 0.5, run: () => void (states = rig.instrument.lifecycle.getVoices().map((v) => `${v.layer}:${v.state}`).sort()) },
    ])
    expect(states).toEqual(['A:held', 'A:held', 'B:releasing', 'B:releasing'])
    r.rig.instrument.lifecycle.allNotesOff()
    r.rig.scheduler.advance(5000)
    expect(r.rig.instrument.sink.liveVoiceCount()).toBe(0)
    expect(r.rig.scheduler.pending).toBe(0)
  })
})
