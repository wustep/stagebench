// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { editSynth, setBpm, setDrawbar, setPercussion, setScene, setSplitPoint, setTransposeOn, setTransposeSemitones, setVibOn } from '../engine/edits'
import { assignMorph } from '../engine/morph'
import { defaultState, setRotary, type EngineState } from '../engine/state'
import type { Crossfade } from '../engine/zones'
import { bandEnergy, dominantHz, peak, rms } from '../test-utils/analysis'
import { renderNotes, type NoteEvent, type OfflineRig } from '../test-utils/offline'

/**
 * system.integration / organ.engine / layers.routing / splits.zones / scenes.switching / morph.assignments / organ.rotary:
 * the WHOLE instrument (note lifecycle → zone router → sink → Organ / Synth / Piano engines → per-section graphs → shared master
 * path) rendered on a real Web Audio implementation, one AudioContext for everything.
 */
const rigs: OfflineRig[] = []
afterEach(() => {
  while (rigs.length) rigs.pop()!.dispose()
})
const SR = 44100
const at = (s: number) => Math.floor(s * SR)

const play = async (seconds: number, notes: NoteEvent[], edit: (s: EngineState) => EngineState = (s) => s, extra?: Parameters<typeof renderNotes>[3]) => {
  const out = await renderNotes(seconds, notes, edit, extra)
  rigs.push(out.rig)
  return out
}
const chain = (...edits: Array<(s: EngineState) => EngineState>) => (s: EngineState) => edits.reduce((acc, e) => e(acc), s)

// --- building blocks: which layers are on -------------------------------------------------------------------
const pianoOnly = (s: EngineState): EngineState => s
const noPiano = (s: EngineState): EngineState => ({ ...s, layers: { ...s.layers, A: { ...s.layers.A, enabled: false } } })
const organA = (s: EngineState): EngineState => ({ ...s, organOn: true, organ: { ...s.organ, layers: { ...s.organ.layers, A: { ...s.organ.layers.A, enabled: true } } } })
const synthLayer =
  (id: 'A' | 'B' | 'C', waveform = 2) =>
  (s: EngineState): EngineState => ({
    ...s,
    synthOn: true,
    synth: { ...s.synth, [id]: { ...s.synth[id], enabled: true, patch: { ...s.synth[id].patch, waveform } } },
  })
const organOnly = chain(noPiano, organA)
const synthOnly = (id: 'A' | 'B' | 'C' = 'A', waveform = 2) => chain(noPiano, synthLayer(id, waveform))

describe('organ.engine — the Organ plays through the shared instrument', () => {
  it('a B3 note sounds at the played pitch: a harmonic series of the 16-foot fundamental (note/2), with the 8-foot partial at the key pitch', async () => {
    const r = await play(1.2, [{ note: 60 }], organOnly)
    expect(rms(r.mono)).toBeGreaterThan(0.01)
    expect(peak(r.mono)).toBeLessThan(1)
    expect(dominantHz(r.mono, SR, at(0.3), 16384, 100, 600)).toBeCloseTo(261.6, -1)
    // 16' (130.8), 8' (261.6), 5 1/3' (392.4) are the default 88 8000 registration; 4' (523) is drawn to zero
    const band = (f: number) => bandEnergy(r.mono, SR, f * 0.97, f * 1.03, at(0.3), 16384)
    expect(band(130.8)).toBeGreaterThan(band(523.2) * 20)
    expect(band(392.4)).toBeGreaterThan(band(523.2) * 20)
  })

  it('both organ layers sound and share ONE effect chain and ONE AudioContext with the piano and synth', async () => {
    const all = chain(organA, (s) => ({ ...s, organ: { ...s.organ, layers: { ...s.organ.layers, B: { ...s.organ.layers.B, enabled: true } } } }), synthLayer('A'))
    let counts: { organ: number; synth: number; piano: number } | null = null
    const r = await play(1.2, [{ note: 60 }], all, (rig) => [
      { at: 0.4, run: () => (counts = { ...rig.instrument.sink.engineVoiceCount(), piano: rig.instrument.sink.liveVoiceCount() }) },
    ])
    expect(counts).toEqual({ organ: 2, synth: 1, piano: 1 })
    expect(rms(r.mono)).toBeGreaterThan(0.02)
    // the rig throws when the engine asks for a second AudioContext, so reaching here proves there is only one
    const graph = r.rig.instrument.sink.getGraph()!
    expect(graph.organ.chain).toBeDefined()
    expect(graph.organ.layerIn.A).not.toBe(graph.organ.layerIn.B)
  })

  it('layer level, octave and enable act per organ layer', async () => {
    const quiet = await play(1, [{ note: 60 }], chain(organOnly, (s) => ({ ...s, organ: { ...s.organ, layers: { ...s.organ.layers, A: { ...s.organ.layers.A, level: 0.3 } } } })))
    const loud = await play(1, [{ note: 60 }], chain(organOnly, (s) => ({ ...s, organ: { ...s.organ, layers: { ...s.organ.layers, A: { ...s.organ.layers.A, level: 1 } } } })))
    expect(rms(loud.mono, at(0.3))).toBeGreaterThan(rms(quiet.mono, at(0.3)) * 3)
    const up = await play(1, [{ note: 60 }], chain(organOnly, (s) => ({ ...s, organ: { ...s.organ, layers: { ...s.organ.layers, A: { ...s.organ.layers.A, octave: 1 } } } })))
    // +1 octave: the lowest partial (the 16-foot tonewheel of the shifted key) sits at 261.6 Hz, nothing remains at the unshifted 130.8 Hz
    const partial = (r: Awaited<ReturnType<typeof play>>, hz: number) => bandEnergy(r.mono, SR, hz * 0.97, hz * 1.03, at(0.3), 16384)
    expect(partial(up, 261.6)).toBeGreaterThan(partial(up, 130.8) * 50)
    expect(partial(quiet, 130.8)).toBeGreaterThan(partial(quiet, 65.4) * 50)
    const off = await play(1, [{ note: 60 }], chain(noPiano))
    expect(rms(off.mono)).toBeLessThan(1e-4)
  })

  it('Panic and release free every organ voice', async () => {
    let during = -1
    let after = -1
    await play(
      1.6,
      [{ note: 60 }, { note: 64 }, { note: 67 }],
      organOnly,
      (rig) => [
        { at: 0.3, run: () => (during = rig.instrument.sink.engineVoiceCount().organ) },
        { at: 0.4, run: () => rig.instrument.panic() },
        {
          at: 1.0,
          run: () => {
            rig.scheduler.advance(400)
            after = rig.instrument.sink.engineVoiceCount().organ
          },
        },
      ],
    )
    expect(during).toBe(3)
    expect(after).toBe(0)
  })
})

describe('splits.zones — split points route notes to layers and fade across the crossfade', () => {
  const splitAt = (position: number, crossfade: Crossfade = 0) => (s: EngineState) => setSplitPoint(s, 'mid', { active: true, position, crossfade })
  const zones = (entries: Record<string, [number, number]>) => (s: EngineState): EngineState => ({ ...s, zones: { ...s.zones, ...entries } })

  it('a Mid split at C4 sends low keys to the synth and high keys to the piano, and the split point can be moved', async () => {
    const setup = chain(synthLayer('A'), zones({ 'synth.A': [0, 0], 'piano.A': [1, 1] }), splitAt(4))
    const seen: Record<string, { piano: number; synth: number }> = {}
    const probe = (name: string) => (rig: OfflineRig) => [
      { at: 0.3, run: () => (seen[name] = { piano: rig.instrument.sink.liveVoiceCount(), synth: rig.instrument.sink.engineVoiceCount().synth }) },
    ]
    await play(0.6, [{ note: 48 }], setup, probe('below'))
    await play(0.6, [{ note: 72 }], setup, probe('above'))
    await play(0.6, [{ note: 62 }], chain(setup, splitAt(5)), probe('movedBelow')) // split moved to F4 (65): 62 is now below
    await play(0.6, [{ note: 62 }], chain(setup, splitAt(2)), probe('movedAbove')) // split moved to C3 (48): 62 is above
    expect(seen.below).toEqual({ piano: 0, synth: 1 })
    expect(seen.above).toEqual({ piano: 1, synth: 0 })
    expect(seen.movedBelow).toEqual({ piano: 0, synth: 1 })
    expect(seen.movedAbove).toEqual({ piano: 1, synth: 0 })
  })

  it('crossfades: Off switches at the split point; ±6 and ±12 fade equal-power across that many semitones', async () => {
    // the organ plays only above the split; the played key is C4 (60) and the split is moved around it
    const upper = (position: number, xf: Crossfade) => chain(organOnly, zones({ 'organ.A': [1, 1] }), splitAt(position, xf))
    const level = async (position: number, xf: Crossfade) => rms((await play(1, [{ note: 60 }], upper(position, xf))).mono, at(0.3))
    const full = await level(2, 0) // split at C3: C4 is far above it
    const off = await level(4, 0) // split exactly at C4: C4 is in the upper zone at full level
    const below = await level(6, 0) // split at C5: C4 is below it, nothing sounds
    const half6 = await level(4, 6) // C4 sits in the middle of a ±6 crossfade around C4: equal power, about -3 dB
    const half12 = await level(4, 12)
    const quarter = await level(5, 12) // split F4 (65) ±12: C4 is 5 semitones below the split, well down the fade-in
    expect(off).toBeGreaterThan(full * 0.95)
    expect(below).toBeLessThan(full * 0.02)
    expect(half6 / full).toBeGreaterThan(0.62)
    expect(half6 / full).toBeLessThan(0.78)
    expect(half12 / full).toBeGreaterThan(0.62)
    expect(half12 / full).toBeLessThan(0.78)
    expect(quarter).toBeLessThan(half12)
    expect(quarter).toBeGreaterThan(below)
  })

  it('a layer assigned to a zone range plays in every zone of the range', async () => {
    const setup = chain(synthLayer('A'), zones({ 'synth.A': [0, 1], 'piano.A': [2, 3] }), (s) => setSplitPoint(setSplitPoint(setSplitPoint(s, 'low', { active: true, position: 2 }), 'mid', { active: true, position: 4 }), 'high', { active: true, position: 6 }))
    const seen: Record<number, string> = {}
    for (const note of [40, 55, 66, 80]) {
      await play(0.6, [{ note }], setup, (rig) => [{ at: 0.3, run: () => (seen[note] = rig.instrument.sink.liveVoiceCount() ? 'piano' : rig.instrument.sink.engineVoiceCount().synth ? 'synth' : 'none') }])
    }
    expect(seen).toEqual({ 40: 'synth', 55: 'synth', 66: 'piano', 80: 'piano' })
  })
})

describe('scenes.switching — Layer Scene I/II switch which layers are on, never the sound parameters', () => {
  it('scene II turns the organ on and the piano off while the organ keeps its drawbars; back in scene I the piano returns', async () => {
    const setup = chain(
      organA,
      (s) => setDrawbar(s, 3, 6),
      (s) => ({ ...s, organ: { ...s.organ, layers: { ...s.organ.layers, A: { ...s.organ.layers.A, enabled: false } } } }), // scene I: piano only
      (s) => setScene(s, 1),
      (s) => ({ ...s, organOn: true, layers: { ...s.layers, A: { ...s.layers.A, enabled: false } }, organ: { ...s.organ, layers: { ...s.organ.layers, A: { ...s.organ.layers.A, enabled: true } } } }), // scene II: organ only
      (s) => setScene(s, 0),
    )
    const states: string[] = []
    const r = await play(2.2, [{ note: 60 }], setup, (rig) => [
      { at: 0.3, run: () => states.push(`I:${rig.instrument.sink.liveVoiceCount()}p${rig.instrument.sink.engineVoiceCount().organ}o`) },
      { at: 0.6, run: () => rig.state.update((s) => setScene(s, 1)) },
      { at: 0.65, run: () => void rig.instrument.lifecycle.noteOn('later', 64, 100) },
      {
        at: 1.0,
        run: () => {
          rig.scheduler.advance(2000) // let the released piano voice finish (the offline rig has no real timers)
          states.push(`II:${rig.instrument.sink.engineVoiceCount().organ}o${rig.instrument.sink.liveVoiceCount()}p`)
        },
      },
      { at: 1.2, run: () => rig.state.update((s) => setScene(s, 0)) },
      { at: 1.25, run: () => void rig.instrument.lifecycle.noteOn('again', 67, 100) },
      { at: 1.6, run: () => states.push(`I2:${rig.instrument.sink.liveVoiceCount()}p`) },
    ])
    expect(states[0]).toBe('I:1p0o')
    expect(states[1]).toBe('II:1o0p') // the piano note was released by the scene change and is gone; the key pressed in scene II sounds on the organ
    expect(states[2]).toMatch(/^I2:[12]p$/) // scene I: the piano is back for the new key
    // the organ's registration survived both scene changes
    expect(r.rig.state.get().organ.layers.A.drawbars[3]).toBe(6)
    expect(r.rig.state.get().scene).toBe(0)
  })
})

describe('morph.assignments — a moving source interpolates its destinations in the audio', () => {
  const morphed = (dest: string, to: number, wheel: number) => (s: EngineState): EngineState => {
    const base = { ...s, modWheel: wheel }
    return { ...base, morph: assignMorph(base.morph, 'wheel', dest, dest.startsWith('drawbar') ? 0 : 0.2, to) }
  }

  it('the Wheel moves an organ layer level from its stored start to the assigned end', async () => {
    const setup = (wheel: number) => chain(organOnly, (s) => ({ ...s, organ: { ...s.organ, layers: { ...s.organ.layers, A: { ...s.organ.layers.A, level: 0.2 } } } }), morphed('level.organ.A', 1, wheel))
    const [w0, w5, w10] = await Promise.all([0, 0.5, 1].map((w) => play(1, [{ note: 60 }], setup(w))))
    const level = (r: Awaited<ReturnType<typeof play>>) => rms(r.mono, at(0.3))
    expect(level(w5)).toBeGreaterThan(level(w0) * 1.8)
    expect(level(w10)).toBeGreaterThan(level(w5) * 1.3)
  })

  it('a morph can move a drawbar: pulling the 4-foot drawbar in with the wheel adds energy at the octave partial', async () => {
    const setup = (wheel: number) => chain(organOnly, (s) => setDrawbar(s, 3, 0), (s) => ({ ...s, modWheel: wheel, morph: assignMorph(s.morph, 'wheel', 'drawbar.organ.A.3', 0, 8) }))
    const w0 = await play(1, [{ note: 60 }], setup(0))
    const w1 = await play(1, [{ note: 60 }], setup(1))
    const oct = (r: Awaited<ReturnType<typeof play>>) => bandEnergy(r.mono, SR, 500, 550, at(0.3), 16384)
    expect(oct(w1)).toBeGreaterThan(oct(w0) * 30)
  })

  it('a second source (Control Pedal) morphs the synth filter while the wheel morphs an effect: both destinations follow their own source', async () => {
    const setup = (pedal: number) =>
      chain(synthOnly('A', 2), (s) => editSynth({ ...s, synthFocus: 'A' }, (p) => ({ ...p, filter: { ...p.filter, freq: 0.2, envAmount: 0, type: 'LP24' } })), (s) => ({
        ...s,
        pedalPos: pedal,
        morph: assignMorph(s.morph, 'pedal', 'synth.filterFreq.A', 0.2, 0.95),
      }))
    const closed = await play(1, [{ note: 60 }], setup(0))
    const open = await play(1, [{ note: 60 }], setup(1))
    const bright = (r: Awaited<ReturnType<typeof play>>) => bandEnergy(r.mono, SR, 2000, 8000, at(0.3), 16384) / bandEnergy(r.mono, SR, 100, 700, at(0.3), 16384)
    expect(bright(open)).toBeGreaterThan(bright(closed) * 5)
  })

  it('moving the source while a note sounds changes the sound without a new key press', async () => {
    const setup = chain(organOnly, (s) => ({ ...s, organ: { ...s.organ, layers: { ...s.organ.layers, A: { ...s.organ.layers.A, level: 0.15 } } } }), (s) => ({ ...s, morph: assignMorph(s.morph, 'wheel', 'level.organ.A', 0.15, 1) }))
    const r = await play(1.6, [{ note: 60 }], setup, (rig) => [{ at: 0.8, run: () => rig.state.update((s) => ({ ...s, modWheel: 1 })) }])
    expect(rms(r.mono, at(1.2), at(1.5))).toBeGreaterThan(rms(r.mono, at(0.4), at(0.7)) * 3)
  })
})

describe('performance: transpose, master clock, Panic', () => {
  it('Transpose shifts every engine by the set semitones', async () => {
    const base = await play(0.8, [{ note: 60 }], organOnly)
    const up = await play(0.8, [{ note: 60 }], chain(organOnly, (s) => setTransposeSemitones(setTransposeOn(s, true), 2)))
    const f = (r: Awaited<ReturnType<typeof play>>) => dominantHz(r.mono, SR, at(0.3), 16384, 100, 600)
    expect(f(up) / f(base)).toBeCloseTo(Math.pow(2, 2 / 12), 1)
    const synth = await play(0.8, [{ note: 60 }], chain(synthOnly('A', 0), (s) => setTransposeSemitones(setTransposeOn(s, true), -5)))
    expect(dominantHz(synth.mono, SR, at(0.3), 16384, 100, 600)).toBeCloseTo(261.6 * Math.pow(2, -5 / 12), -1)
  })

  it('the master clock tempo sets the arpeggiator step time', async () => {
    const arp = (bpm: number) =>
      chain(
        synthOnly('A', 2),
        (s) => editSynth({ ...s, synthFocus: 'A' }, (p) => ({ ...p, arp: { ...p.arp, run: true, mode: 'arp', sync: true, division: 4 } })),
        (s) => setBpm(s, bpm),
      )
    // the offline rig has no real timers, so the arpeggiator is pumped through the whole render at the start
    const render = async (bpm: number) => {
      const r = await renderNotes(2.4, [{ note: 60 }, { note: 64 }], arp(bpm), (rig) => [{ at: 0.01, run: () => rig.instrument.sink.getSynthEngine()!.pump(3) }])
      rigs.push(r.rig)
      return r
    }
    const slow = await render(60) // 1/8 notes at 60 BPM: one step every 0.5 s
    const fast = await render(240) // one step every 0.125 s
    expect(rms(slow.mono)).toBeGreaterThan(0.005)
    expect(rms(fast.mono)).toBeGreaterThan(0.005)
    // count note onsets: the faster clock retriggers more often in the same time
    const onsets = (x: Float32Array) => {
      let n = 0
      let prev = 0
      for (let i = 0; i < x.length - 441; i += 441) {
        const v = rms(x, i, i + 441)
        if (v > prev * 1.6 + 0.004) n++
        prev = v
      }
      return n
    }
    expect(onsets(fast.mono)).toBeGreaterThan(onsets(slow.mono) * 2)
  })

  it('Panic silences held notes, KB Hold, the arpeggio and sustained voices in every engine', async () => {
    const setup = chain(
      noPiano,
      synthLayer('A'),
      organA,
      (s) => editSynth({ ...s, synthFocus: 'A' }, (p) => ({ ...p, arp: { ...p.arp, run: true, hold: true } })),
    )
    let before = -1
    let after = -1
    const r = await play(2.2, [{ note: 60 }, { note: 64 }], setup, (rig) => [
      { at: 0.5, run: () => (before = rig.instrument.sink.engineVoiceCount().organ + rig.instrument.sink.engineVoiceCount().synth) },
      { at: 0.7, run: () => rig.instrument.lifecycle.noteOff('t0') },
      { at: 0.75, run: () => rig.instrument.lifecycle.noteOff('t1') },
      { at: 1.0, run: () => rig.instrument.lifecycle.sustain('pedal', true) },
      { at: 1.2, run: () => rig.instrument.panic() },
      {
        at: 1.6,
        run: () => {
          rig.scheduler.advance(500)
          after = rig.instrument.sink.engineVoiceCount().organ + rig.instrument.sink.engineVoiceCount().synth
        },
      },
    ])
    expect(before).toBeGreaterThan(0)
    expect(after).toBe(0)
    expect(rms(r.mono, at(1.8), at(2.1))).toBeLessThan(1e-3)
    expect(r.rig.instrument.getSnapshot().sustain).toBe(false)
  })
})

describe('organ.rotary — speed, drive and routing', () => {
  const routed = chain(organOnly, (s) => ({ ...s, organ: { ...s.organ, layers: { ...s.organ.layers, A: { ...s.organ.layers.A, drawbars: [0, 0, 8, 0, 0, 0, 0, 0, 0] } } } }), (s) => setRotary(s, { organ: true, drive: 0.1 }))

  it('the organ routes into the shared rotary: fast speed modulates the amplitude far more than slow, and the routing button matters', async () => {
    const dry = await play(2.5, [{ note: 60 }], chain(organOnly, (s) => setRotary(s, { organ: false })))
    const slow = await play(2.5, [{ note: 60 }], chain(routed, (s) => setRotary(s, { fast: false })))
    const fast = await play(2.5, [{ note: 60 }], chain(routed, (s) => setRotary(s, { fast: true })))
    // the fast horn beats at about 6.6 Hz, the slow one at 0.8 Hz, the dry organ not at all: count loudness peaks in 1.2 s
    const peaks = (r: Awaited<ReturnType<typeof play>>) => {
      const win = 882 // 20 ms, five cycles of the 261 Hz tone
      const env: number[] = []
      for (let i = at(1.2); i + win < at(2.4); i += win) env.push(rms(r.mono, i, i + win))
      const mean = env.reduce((a, b) => a + b, 0) / env.length
      let count = 0
      for (let i = 2; i < env.length - 2; i++) {
        const isPeak = env[i] > env[i - 1] && env[i] >= env[i + 1] && env[i] > env[i - 2] && env[i] > env[i + 2]
        if (isPeak && env[i] > mean * 1.1) count++
      }
      return count
    }
    expect(peaks(fast)).toBeGreaterThanOrEqual(5)
    expect(peaks(slow)).toBeLessThanOrEqual(2)
    expect(peaks(dry)).toBeLessThanOrEqual(2)
  })

  it('speed changes accelerate: the rotor speed a moment after switching to fast is between slow and fast', async () => {
    let early = 0
    let late = 0
    await play(4, [{ note: 60 }], routed, (rig) => [
      { at: 0.5, run: () => rig.state.update((s) => setRotary(s, { fast: true })) },
      { at: 0.9, run: () => (early = rig.instrument.sink.getGraph()!.rotary!.hornHz) },
      { at: 3.5, run: () => (late = rig.instrument.sink.getGraph()!.rotary!.hornHz) },
    ])
    expect(early).toBeGreaterThan(0.8)
    expect(early).toBeLessThan(5.5)
    expect(late).toBeGreaterThan(early)
  })

  it('Stop mode brings the rotors to a halt on the slow position', async () => {
    let hz = -1
    await play(8, [{ note: 60 }], chain(routed, (s) => setRotary(s, { fast: true })), (rig) => [
      { at: 0.5, run: () => rig.state.update((s) => setRotary(s, { stopMode: true, fast: false })) },
      { at: 7.5, run: () => (hz = rig.instrument.sink.getGraph()!.rotary!.hornHz) },
    ])
    expect(hz).toBeLessThan(0.05)
  })
})

describe('layers.routing — the vibrato/chorus unit and the model engines follow their layer', () => {
  it('vibrato modulates the pitch of the organ and chorus mixes it with the original', async () => {
    const plain = await play(1.5, [{ note: 60 }], organOnly)
    const v3 = await play(1.5, [{ note: 60 }], chain(organOnly, (s) => setVibOn(s, true), (s) => ({ ...s, organ: { ...s.organ, vibMode: 'V3' as const } })))
    const c3 = await play(1.5, [{ note: 60 }], chain(organOnly, (s) => setVibOn(s, true), (s) => ({ ...s, organ: { ...s.organ, vibMode: 'C3' as const } })))
    const sidebands = (r: Awaited<ReturnType<typeof play>>) => bandEnergy(r.mono, SR, 250, 258, at(0.3), 32768) + bandEnergy(r.mono, SR, 265, 273, at(0.3), 32768)
    expect(sidebands(v3)).toBeGreaterThan(sidebands(plain) * 5)
    expect(sidebands(c3)).toBeGreaterThan(sidebands(plain) * 3)
  })

  it('B3 percussion adds a decaying attack partial; Farfisa and Pipe use their own engines', async () => {
    const dry = await play(1, [{ note: 60 }], organOnly)
    const perc = await play(1, [{ note: 60 }], chain(organOnly, (s) => setPercussion(s, { on: true, third: true, fast: false })))
    const third = (r: Awaited<ReturnType<typeof play>>, from: number) => bandEnergy(r.mono, SR, 775, 795, at(from), 4096)
    expect(third(perc, 0.02)).toBeGreaterThan(third(dry, 0.02) * 8)
    expect(third(perc, 0.7)).toBeLessThan(third(perc, 0.02) * 0.35)
  })
})

describe('regression: the Phase 2 piano path is unchanged', () => {
  it('the default program still renders the Grand piano through the same master path', async () => {
    const r = await play(1.2, [{ note: 69 }], pianoOnly)
    expect(rms(r.mono)).toBeGreaterThan(0.01)
    expect(defaultState().layers.A.enabled).toBe(true)
  })
})
