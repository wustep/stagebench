// @vitest-environment node
// piano.velocity-controls: every performance control changes the rendered audio in the expected direction.
import { describe, expect, it } from 'vitest'
import type { ControlAction } from '../model/hardware'
import { play, type NoteEvent } from './testing/scenario'
import { difference, mono, rms, toneAmplitude, trebleRatio } from './testing/offline'

function correlation(a: Float32Array, b: Float32Array): number {
  let ab = 0
  let aa = 0
  let bb = 0
  for (let i = 0; i < a.length; i += 1) {
    ab += a[i] * b[i]
    aa += a[i] * a[i]
    bb += b[i] * b[i]
  }
  return ab / Math.sqrt(aa * bb)
}

const set = (id: string, value: number): ControlAction => ({ type: 'set', id, value })
const toggle = (id: string): ControlAction => ({ type: 'toggle', id })
const advance = (id: string, times = 1): ControlAction[] => Array.from({ length: times }, () => ({ type: 'advance', id }) as const)

async function level(note: NoteEvent, actions: ControlAction[]) {
  const played = await play({ seconds: 1.6, notes: [{ ...note, off: 1.0 }], actions })
  return mono(played.rendered)
}

describe('piano.velocity-controls render', () => {
  it('KB Touch: Light plays a stroke louder than Medium, and Heavy plays it softer', async () => {
    const medium = await level({ note: 60, velocity: 60 }, [])
    const light = await level({ note: 60, velocity: 60 }, advance('piano.kb-touch', 1))
    const heavy = await level({ note: 60, velocity: 60 }, advance('piano.kb-touch', 2))
    expect(rms(light, 44100, 0.05, 0.9)).toBeGreaterThan(rms(medium, 44100, 0.05, 0.9) * 1.2)
    expect(rms(heavy, 44100, 0.05, 0.9)).toBeLessThan(rms(medium, 44100, 0.05, 0.9) * 0.85)
  }, 60000)

  it('Dyn Comp: a soft stroke gets louder as the level rises, and loud strokes barely move', async () => {
    const off = await level({ note: 60, velocity: 15 }, [])
    const three = await level({ note: 60, velocity: 15 }, advance('piano.dyn-comp', 3))
    expect(rms(three, 44100, 0.05, 0.9)).toBeGreaterThan(rms(off, 44100, 0.05, 0.9) * 1.5)
    const loudOff = await level({ note: 60, velocity: 120 }, [])
    const loudThree = await level({ note: 60, velocity: 120 }, advance('piano.dyn-comp', 3))
    expect(rms(loudThree, 44100, 0.05, 0.9) / rms(loudOff, 44100, 0.05, 0.9)).toBeLessThan(1.6)
  }, 60000)

  it('Timbre: Bright is brighter than Off, and Soft is darker (dampened highs, emphasised bass)', async () => {
    // A high note has its partials above 1.5 kHz, where the Timbre shelves act; a low note barely reaches them.
    const high = { note: 84, velocity: 110 }
    const off = await level(high, [])
    const soft = await level(high, [set('piano.timbre', 0.3)])
    const bright = await level(high, [set('piano.timbre', 0.8)])
    expect(trebleRatio(bright, 44100, 0.1, 0.9)).toBeGreaterThan(trebleRatio(off, 44100, 0.1, 0.9) * 1.2)
    expect(trebleRatio(soft, 44100, 0.1, 0.9)).toBeLessThan(trebleRatio(off, 44100, 0.1, 0.9) * 0.8)
  }, 60000)

  it('Timbre on Electric has the Dyno steps, and they change the rendered tone', async () => {
    const plain = await level({ note: 60, velocity: 100 }, [...advance('piano.type', 2), set('piano.timbre', 0.01)])
    const dyno = await level({ note: 60, velocity: 100 }, [...advance('piano.type', 2), set('piano.timbre', 0.9)])
    expect(difference(plain, dyno) / Math.max(rms(plain), rms(dyno))).toBeGreaterThan(0.05)
  }, 60000)

  it('Unison: Off is one centred voice, and Unison 3 is stereo and detuned', async () => {
    // Unison copies are panned apart and detuned, so the two channels decorrelate.
    const plain = await play({ seconds: 1.4, notes: [{ note: 60, velocity: 100, off: 1.0 }] })
    const unison = await play({ seconds: 1.4, notes: [{ note: 60, velocity: 100, off: 1.0 }], actions: advance('piano.unison', 3) })
    const window = (x: Float32Array) => x.subarray(Math.floor(0.1 * 44100), Math.floor(0.9 * 44100))
    const corrOff = correlation(window(plain.rendered.left), window(plain.rendered.right))
    const corrOn = correlation(window(unison.rendered.left), window(unison.rendered.right))
    expect(corrOn).toBeLessThan(corrOff - 0.1)
  }, 60000)

  it('Soft Release: the release tail lasts longer with Soft Release on', async () => {
    const normal = await level({ note: 60, velocity: 100 }, [])
    const soft = await level({ note: 60, velocity: 100 }, [toggle('piano.soft-release')])
    const window = [1.3, 1.6] as const
    expect(rms(soft, 44100, window[0], window[1])).toBeGreaterThan(rms(normal, 44100, window[0], window[1]) * 1.5)
  }, 60000)

  it('Soft Release does nothing to Clav, which has no soft release (manual p. 25)', async () => {
    const normal = await level({ note: 60, velocity: 100 }, advance('piano.type', 3))
    const soft = await level({ note: 60, velocity: 100 }, [...advance('piano.type', 3), toggle('piano.soft-release')])
    expect(difference(normal, soft)).toBeLessThan(1e-6)
  }, 60000)

  it('String Res: a note struck while another is held rings the held note sympathetically', async () => {
    const plain = await play({
      seconds: 3,
      notes: [
        { source: 'a', note: 48, velocity: 90, off: 2.5 },
        { source: 'b', note: 67, velocity: 90, on: 0.8, off: 1.2 },
      ],
    })
    const resonant = await play({
      seconds: 3,
      notes: [
        { source: 'a', note: 48, velocity: 90, off: 2.5 },
        { source: 'b', note: 67, velocity: 90, on: 0.8, off: 1.2 },
      ],
      actions: [toggle('piano.string-res')],
    })
    const f = 130.8 // C3, the held note; only String Res sympathetic energy should reach here after 'b' is released
    const before = toneAmplitude(mono(plain.rendered), f, 44100, 1.5, 2.3)
    const after = toneAmplitude(mono(resonant.rendered), f, 44100, 1.5, 2.3)
    expect(after).toBeGreaterThan(before * 1.2)
  }, 60000)

  it('Master Level: raising the knob raises the output, and zero is silent', async () => {
    const loud = await level({ note: 60, velocity: 100 }, [set('performance.master-level', 1)])
    const quiet = await level({ note: 60, velocity: 100 }, [set('performance.master-level', 0.2)])
    const mute = await level({ note: 60, velocity: 100 }, [set('performance.master-level', 0)])
    expect(rms(loud, 44100, 0.05, 0.9)).toBeGreaterThan(rms(quiet, 44100, 0.05, 0.9) * 2)
    expect(rms(mute, 44100, 0.05, 0.9)).toBeLessThan(1e-6)
  }, 60000)

  it('Pitch stick with PSTICK on bends the piano up to two semitones', async () => {
    // MIDI 69 is A4 (440 Hz). Full deflection is +200 cents, so the note moves to about 493.9 Hz.
    const flat = await level({ note: 69, velocity: 100 }, [toggle('piano.pstick'), set('performance.pitch-stick', 0.5)])
    const bent = await level({ note: 69, velocity: 100 }, [toggle('piano.pstick'), set('performance.pitch-stick', 1)])
    const up = 440 * Math.pow(2, 200 / 1200)
    expect(toneAmplitude(bent, up, 44100, 0.6, 0.9)).toBeGreaterThan(toneAmplitude(flat, up, 44100, 0.6, 0.9) * 2)
    expect(toneAmplitude(flat, 440, 44100, 0.6, 0.9)).toBeGreaterThan(toneAmplitude(bent, 440, 44100, 0.6, 0.9) * 2)
  }, 60000)
})
