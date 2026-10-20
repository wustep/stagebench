// @vitest-environment node
// synth.sources, synth.filter-envelopes, synth.voice-modes: the synth's sound, rendered and measured.
import { describe, expect, it } from 'vitest'
import type { ControlAction } from '../../model/hardware'
import type { Stage4Instrument } from '../../instrument/stage4Instrument'
import { renderEngines, type EngineNote } from '../testing/engines'
import { brightness, difference, rms, toneAmplitude, zeroCrossingHz } from '../testing/offline'
import { WAVEFORMS } from './sources'

const A3 = 220
const WINDOW = [0.3, 0.9] as const
/** Organ off, so the synth alone makes the sound. */
const SYNTH_ONLY: ControlAction[] = [{ type: 'toggle', id: 'organ.layer-a-on' }]
const HARMONICS = [1, 2, 3, 4, 5, 6, 7, 8] as const

const set = (id: string, value: number): ControlAction => ({ type: 'set', id, value })

/** Steps a cycle control to an index, as the panel does: each press advances one step. */
const pick = (id: string, index: number): ControlAction[] => Array.from({ length: index }, () => ({ type: 'advance' as const, id }))

async function play(
  actions: ControlAction[],
  notes: EngineNote[] = [{ note: 57, on: 0.05, off: 1.0 }],
  events: { time: number; run: (instrument: Stage4Instrument) => void }[] = [],
  seconds = 1.1,
) {
  return renderEngines({ seconds, actions: [...SYNTH_ONLY, ...actions], notes, events })
}

/** The harmonic spectrum of a note, normalized so the loudest harmonic is 1. */
function harmonics(data: Float32Array, from = WINDOW[0], to = WINDOW[1]): number[] {
  const amps = HARMONICS.map((k) => toneAmplitude(data, A3 * k, 44100, from, to))
  const peak = Math.max(...amps, 1e-9)
  return amps.map((amp) => amp / peak)
}

function distance(a: number[], b: number[]): number {
  return a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0)
}

describe('synth.sources: waveforms and Osc Ctrl', () => {
  it('lists the required waveforms in the spec order, by category', () => {
    expect(WAVEFORMS.map((waveform) => waveform.name)).toEqual([
      'Sine',
      'Triangle',
      'Saw',
      'Square',
      'Pulse 33',
      'Pulse 10',
      'White Noise',
      'Sync Saw',
      'Sync Square',
      'Multi Saw',
      'Multi Saw 8ve',
      'Super Saw',
      'Super Square',
      'FM 2-op (algorithm A)',
    ])
  })

  it('makes the Pure, Sync, Multi, Super, and FM-H categories audibly distinct, not renamed copies of one oscillator', async () => {
    // One representative per category on the harmonic grid: Sine (Pure), Saw (Pure), Multi Saw, Super Saw, FM 2-op.
    // Sync is checked on its own below, because its second oscillator sits off the harmonic grid.
    const indexes = [0, 2, 9, 11, 13]
    const spectra: number[][] = []
    for (const index of indexes) {
      spectra.push(harmonics((await play([...pick('synth.osc-type', index), set('synth.osc-ctrl', 0.6)])).mono))
    }
    for (let i = 0; i < spectra.length; i += 1) {
      for (let j = i + 1; j < spectra.length; j += 1) {
        expect(distance(spectra[i], spectra[j]), `waveforms ${indexes[i]} and ${indexes[j]}`).toBeGreaterThan(0.2)
      }
    }
  }, 120000)

  it('Sync Saw sounds at its relative pitch, which a plain saw does not', async () => {
    const plain = await play([...pick('synth.osc-type', 2), set('synth.osc-ctrl', 0.6)])
    const synced = await play([...pick('synth.osc-type', 7), set('synth.osc-ctrl', 0.6)])
    // At full Osc Ctrl the synced oscillator sits at 1 + 3 × 0.6 = 2.8 times the pitch.
    const relative = A3 * 2.8
    expect(toneAmplitude(synced.mono, relative, 44100, ...WINDOW)).toBeGreaterThan(toneAmplitude(plain.mono, relative, 44100, ...WINDOW) * 3)
  }, 120000)

  it('Pure waveforms ignore Osc Ctrl, while the stacked and FM sources respond to it', async () => {
    const pureLow = await play([...pick('synth.osc-type', 2), set('synth.osc-ctrl', 0)])
    const pureHigh = await play([...pick('synth.osc-type', 2), set('synth.osc-ctrl', 1)])
    expect(difference(pureLow.mono, pureHigh.mono)).toBeLessThan(1e-6)

    const superLow = await play([...pick('synth.osc-type', 11), set('synth.osc-ctrl', 0)])
    const superHigh = await play([...pick('synth.osc-type', 11), set('synth.osc-ctrl', 1)])
    expect(difference(superLow.mono, superHigh.mono)).toBeGreaterThan(0.002)

    const fmLow = await play([...pick('synth.osc-type', 13), set('synth.osc-ctrl', 0)])
    const fmHigh = await play([...pick('synth.osc-type', 13), set('synth.osc-ctrl', 1)])
    expect(distance(harmonics(fmLow.mono), harmonics(fmHigh.mono))).toBeGreaterThan(0.2)
  }, 120000)

  it('the required Pulse and noise sources render: a pulse has energy, and white noise is broadband', async () => {
    const pulse = await play([...pick('synth.osc-type', 4)])
    const noise = await play([...pick('synth.osc-type', 6)])
    expect(rms(pulse.mono, 44100, ...WINDOW)).toBeGreaterThan(0.002)
    expect(rms(noise.mono, 44100, ...WINDOW)).toBeGreaterThan(0.002)
    // Noise has energy far above the fundamental; a sine has almost none.
    const sine = await play([...pick('synth.osc-type', 0)])
    expect(toneAmplitude(noise.mono, 5000, 44100, ...WINDOW)).toBeGreaterThan(toneAmplitude(sine.mono, 5000, 44100, ...WINDOW) * 3)
  }, 120000)
})

describe('synth.filter-envelopes: filter, drive, tracking, and envelopes', () => {
  it('the filter types differ: a high-pass sound is thinner than a low-pass one', async () => {
    const low = await play([...pick('synth.osc-type', 2), ...pick('synth.filter-type', 0), set('synth.filter-cutoff', 0.4)])
    const high = await play([...pick('synth.osc-type', 2), ...pick('synth.filter-type', 2), set('synth.filter-cutoff', 0.4)])
    expect(rms(high.mono, 44100, ...WINDOW)).toBeLessThan(rms(low.mono, 44100, ...WINDOW))
    expect(difference(low.mono, high.mono)).toBeGreaterThan(0.002)
  }, 120000)

  it('the cutoff, resonance, and drive each alter the rendered sound', async () => {
    const base = [...pick('synth.osc-type', 2), set('synth.filter-cutoff', 0.3)]
    const dark = await play(base)
    const bright = await play([...pick('synth.osc-type', 2), set('synth.filter-cutoff', 0.9)])
    // Brightness (the share of energy in the first difference) rises with the cutoff; plain level does not, because a resonant low cutoff lifts the fundamental.
    expect(brightness(bright.mono, Math.round(WINDOW[0] * 44100), Math.round(WINDOW[1] * 44100))).toBeGreaterThan(
      brightness(dark.mono, Math.round(WINDOW[0] * 44100), Math.round(WINDOW[1] * 44100)) * 1.5,
    )
    const resonant = await play([...base, set('synth.filter-resonance', 0.9)])
    expect(difference(resonant.mono, dark.mono)).toBeGreaterThan(0.002)
    const driven = await play([...base, { type: 'advance', id: 'synth.filter-drive' }, { type: 'advance', id: 'synth.filter-drive' }, { type: 'advance', id: 'synth.filter-drive' }])
    expect(difference(driven.mono, dark.mono)).toBeGreaterThan(0.002)
  }, 120000)

  it('keyboard tracking moves the cutoff with pitch, so a higher note is brighter when tracking is on', async () => {
    const off = await play([...pick('synth.osc-type', 2), set('synth.filter-cutoff', 0.3), ...pick('synth.filter-track', 0)], [{ note: 84, on: 0.05, off: 1.0 }])
    const full = await play([...pick('synth.osc-type', 2), set('synth.filter-cutoff', 0.3), ...pick('synth.filter-track', 3)], [{ note: 84, on: 0.05, off: 1.0 }])
    expect(rms(full.mono, 44100, ...WINDOW)).toBeGreaterThan(rms(off.mono, 44100, ...WINDOW) * 1.2)
  }, 120000)

  it('the filter envelope amount sweeps the cutoff, and the amplifier envelope release is audible in the tail', async () => {
    const flat = await play([...pick('synth.osc-type', 2), set('synth.filter-cutoff', 0.2), set('synth.filter-env', 0)])
    const swept = await play([...pick('synth.osc-type', 2), set('synth.filter-cutoff', 0.2), set('synth.filter-env', 1), set('synth.fenv-decay', 0.5)])
    expect(difference(flat.mono, swept.mono)).toBeGreaterThan(0.002)
    const shortRelease = await play([...pick('synth.osc-type', 0), set('synth.env-release', 0)])
    const longRelease = await play([...pick('synth.osc-type', 0), set('synth.env-release', 0.9)])
    expect(rms(longRelease.mono, 44100, 1.02, 1.08)).toBeGreaterThan(rms(shortRelease.mono, 44100, 1.02, 1.08) * 2)
  }, 120000)

  it('the oscillator envelope pitch amount bends the pitch of a held note', async () => {
    const flat = await play([...pick('synth.osc-type', 0), set('synth.oenv-pitch', 0.5), set('synth.oenv-decay', 0.5)])
    const bent = await play([...pick('synth.osc-type', 0), set('synth.oenv-pitch', 1), set('synth.oenv-decay', 0.5)])
    expect(difference(flat.mono, bent.mono)).toBeGreaterThan(0.002)
  }, 120000)

  it('the LFO moves the pitch or the cutoff when its amount and destination are on', async () => {
    const off = await play([...pick('synth.osc-type', 2)])
    const pitch = await play([...pick('synth.osc-type', 2), set('synth.lfo-amount', 1), set('synth.lfo-rate', 0.5), { type: 'toggle', id: 'synth.lfo-to-pitch' }])
    const filter = await play([...pick('synth.osc-type', 2), set('synth.lfo-amount', 1), set('synth.lfo-rate', 0.5), { type: 'toggle', id: 'synth.lfo-to-filter' }, set('synth.filter-cutoff', 0.4)])
    expect(difference(off.mono, pitch.mono)).toBeGreaterThan(0.002)
    expect(difference(off.mono, filter.mono)).toBeGreaterThan(0.002)
  }, 120000)
})

describe('synth.voice-modes: poly, mono, legato, priority, glide, unison, vibrato', () => {
  it('poly plays a chord on separate voices, and mono plays one voice for the layer', async () => {
    const chord: EngineNote[] = [
      { note: 57, on: 0.05, off: 1.0 },
      { note: 61, on: 0.05, off: 1.0 },
      { note: 64, on: 0.05, off: 1.0 },
    ]
    // Count the voices while the chord is held: a voice that has ended after its release is not counted.
    const counts: Record<string, number> = {}
    const holdCount = (name: string) => ({ time: 0.5, run: (instrument: Stage4Instrument) => (counts[name] = instrument.synthVoiceCount()) })
    await play([...pick('synth.voice-mode', 0)], chord, [holdCount('poly')])
    await play([...pick('synth.voice-mode', 1)], chord, [holdCount('mono')])
    expect(counts.poly).toBe(3)
    expect(counts.mono).toBeLessThanOrEqual(1)
  }, 120000)

  it('note priority picks the next note on release: Low goes to the lowest held note, High to the highest', async () => {
    const chord: EngineNote[] = [
      { note: 57, on: 0.05 },
      { note: 64, on: 0.1 },
      { note: 69, on: 0.15, off: 0.5 },
    ]
    const low = await play([...pick('synth.voice-mode', 1), ...pick('synth.voice-priority', 1)], chord)
    const high = await play([...pick('synth.voice-mode', 1), ...pick('synth.voice-priority', 2)], chord)
    // After the top note lifts at 0.5 s, Low keeps the bottom note (A3, 220 Hz) and High keeps the middle note (E4, 330 Hz).
    const lowPitch = zeroCrossingHz(low.mono, 44100, 0.7, 0.95)
    const highPitch = zeroCrossingHz(high.mono, 44100, 0.7, 0.95)
    expect(Math.abs(lowPitch - 220)).toBeLessThan(Math.abs(lowPitch - 330))
    expect(Math.abs(highPitch - 330)).toBeLessThan(Math.abs(highPitch - 220))
  }, 120000)

  it('legato keeps the envelope running on a new note, and mono retriggers it', async () => {
    const legatoNotes: EngineNote[] = [
      { note: 57, on: 0.05, off: 0.6 },
      { note: 64, on: 0.3, off: 1.0 },
    ]
    // A long attack (about 2 s) makes the restart visible: Mono rises again from silence at 0.3 s, Legato does not.
    const legato = await play([...pick('synth.voice-mode', 2), set('synth.env-attack', 1), set('synth.env-decay', 1)], legatoNotes)
    const mono = await play([...pick('synth.voice-mode', 1), set('synth.env-attack', 1), set('synth.env-decay', 1)], legatoNotes)
    expect(rms(mono.mono, 44100, 0.4, 0.5)).toBeLessThan(rms(legato.mono, 44100, 0.4, 0.5) * 0.8)
  }, 120000)

  it('glide moves the pitch over time instead of jumping', async () => {
    const notes: EngineNote[] = [
      { note: 57, on: 0.05, off: 0.6 },
      { note: 69, on: 0.1, off: 1.0 },
    ]
    const glide = await play([...pick('synth.voice-mode', 1), set('synth.voice-glide', 1)], notes)
    const jump = await play([...pick('synth.voice-mode', 1), set('synth.voice-glide', 0)], notes)
    // Just after the second note, the glide is still between A3 (220 Hz) and A4 (440 Hz); the jump is already at 440.
    const early = [0.12, 0.2] as const
    const glidePitch = zeroCrossingHz(glide.mono, 44100, ...early)
    const jumpPitch = zeroCrossingHz(jump.mono, 44100, ...early)
    expect(glidePitch).toBeGreaterThan(225)
    expect(glidePitch).toBeLessThan(420)
    expect(jumpPitch).toBeGreaterThan(420)
  }, 120000)

  it('unison spreads copies of the voice, and the vibrato On and Wheel modes differ with the wheel at zero', async () => {
    const plain = await play([...pick('synth.osc-type', 2), ...pick('synth.voice-unison', 0)])
    const unison = await play([...pick('synth.osc-type', 2), ...pick('synth.voice-unison', 3)])
    expect(distance(harmonics(plain.mono), harmonics(unison.mono))).toBeGreaterThan(0.1)
    const on = await play([...pick('synth.osc-type', 0), ...pick('synth.vib-mode', 0), set('synth.vib-amount', 0.6)])
    const wheel = await play([...pick('synth.osc-type', 0), ...pick('synth.vib-mode', 1), set('synth.vib-amount', 0.6)])
    expect(difference(on.mono, wheel.mono)).toBeGreaterThan(0.002)
  }, 120000)
})
