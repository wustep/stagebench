// @vitest-environment node
// Every functional piano and effect control measurably changes rendered audio: each control is moved between
// two positions (or switched on and off), the same note is rendered for both, and the difference is measured.
import { describe, expect, it } from 'vitest'
import type { ControlAction } from '../model/hardware'
import { play } from './testing/scenario'
import { difference, mono, rms } from './testing/offline'

const set = (id: string, value: number): ControlAction => ({ type: 'set', id, value })
const on = (id: string): ControlAction => ({ type: 'toggle', id })
const pick = (id: string, index: number): ControlAction[] => Array.from({ length: index }, () => ({ type: 'advance', id }) as const)

/** Renders a held note from the Phase 2 instrument with the given panel actions. */
async function render(actions: ControlAction[], note = 72): Promise<Float32Array> {
  const played = await play({ seconds: 2.2, notes: [{ note, velocity: 110, off: 1.6 }], actions })
  return mono(played.rendered)
}

/** Normalised difference between two renders: 0 means identical. */
function change(a: Float32Array, b: Float32Array): number {
  return difference(a, b) / Math.max(rms(a, 44100, 0.1, 1.5), rms(b, 44100, 0.1, 1.5), 1e-9)
}

/** A control moved between two sets of actions. `changes` needs a rendered difference; `louder` and `quieter` need a level ratio. */
interface Case {
  control: string
  low: ControlAction[]
  high: ControlAction[]
  expect: 'changes' | 'louder' | 'quieter'
  /** Minimum change for `changes`, or minimum level ratio for `louder` and `quieter`. */
  threshold: number
}

/** Measured after the start-up ramp so that only the steady sound of the two settings is compared. */
const WINDOW = [0.3, 1.5] as const
const level = (x: Float32Array) => rms(x, 44100, WINDOW[0], WINDOW[1])

const CASES: Case[] = [
  // Piano layers and section
  { control: 'piano.layer-b-on (Layer B joins the sound)', low: [], high: [on('piano.layer-b-on')], expect: 'changes', threshold: 0.05 },
  { control: 'piano.layer-a-level (fader at zero is silent)', low: [set('piano.layer-a-level', 0)], high: [set('piano.layer-a-level', 1)], expect: 'louder', threshold: 10 },
  { control: 'piano.layer-b-level (fader sets Layer B alone)', low: [on('piano.layer-a-on'), on('piano.layer-b-on'), set('piano.layer-b-level', 0)], high: [on('piano.layer-a-on'), on('piano.layer-b-on'), set('piano.layer-b-level', 1)], expect: 'louder', threshold: 10 },
  { control: 'piano.layer-a-octave (+12 semitones)', low: [set('piano.layer-a-octave', 0.5)], high: [set('piano.layer-a-octave', 1)], expect: 'changes', threshold: 0.3 },
  { control: 'piano.section-on (off silences the section)', low: [], high: [on('piano.section-on')], expect: 'quieter', threshold: 10 },
  // Layer effects: Mod 1
  { control: 'effects.mod1-on (Mod 1 bypass)', low: [], high: [on('effects.mod1-on'), ...pick('effects.mod1-type', 1)], expect: 'changes', threshold: 0.02 },
  { control: 'effects.mod1-rate (tremolo speed)', low: [on('effects.mod1-on'), ...pick('effects.mod1-type', 1), set('effects.mod1-amount', 0.8), set('effects.mod1-rate', 0)], high: [on('effects.mod1-on'), ...pick('effects.mod1-type', 1), set('effects.mod1-amount', 0.8), set('effects.mod1-rate', 1)], expect: 'changes', threshold: 0.02 },
  { control: 'effects.mod1-amount (tremolo depth; zero is full level)', low: [on('effects.mod1-on'), ...pick('effects.mod1-type', 1), set('effects.mod1-amount', 0)], high: [on('effects.mod1-on'), ...pick('effects.mod1-type', 1), set('effects.mod1-amount', 0.8)], expect: 'changes', threshold: 0.02 },
  // Layer effects: Mod 2
  { control: 'effects.mod2-on (Mod 2 bypass)', low: [], high: [on('effects.mod2-on')], expect: 'changes', threshold: 0.02 },
  { control: 'effects.mod2-rate (chorus speed)', low: [on('effects.mod2-on'), set('effects.mod2-amount', 0.8), set('effects.mod2-rate', 0)], high: [on('effects.mod2-on'), set('effects.mod2-amount', 0.8), set('effects.mod2-rate', 1)], expect: 'changes', threshold: 0.02 },
  { control: 'effects.mod2-amount (chorus depth)', low: [on('effects.mod2-on'), set('effects.mod2-amount', 0)], high: [on('effects.mod2-on'), set('effects.mod2-amount', 0.9)], expect: 'changes', threshold: 0.02 },
  // Layer effects: Amp Sim and EQ (EQ only unless stated)
  { control: 'effects.amp-on (Amp bypass)', low: [], high: [on('effects.amp-on'), set('effects.eq-mid', 1)], expect: 'changes', threshold: 0.02 },
  { control: 'effects.amp-drive (Twin)', low: [on('effects.amp-on'), ...pick('effects.amp-type', 1), set('effects.amp-drive', 0)], high: [on('effects.amp-on'), ...pick('effects.amp-type', 1), set('effects.amp-drive', 1)], expect: 'changes', threshold: 0.02 },
  { control: 'effects.amp-tone (mid frequency)', low: [on('effects.amp-on'), set('effects.eq-mid', 1), set('effects.amp-tone', 0)], high: [on('effects.amp-on'), set('effects.eq-mid', 1), set('effects.amp-tone', 1)], expect: 'changes', threshold: 0.02 },
  { control: 'effects.amp-level (output level)', low: [on('effects.amp-on'), set('effects.amp-level', 0)], high: [on('effects.amp-on'), set('effects.amp-level', 1)], expect: 'louder', threshold: 1.5 },
  { control: 'effects.eq-low (bass)', low: [on('effects.amp-on'), set('effects.eq-low', 0)], high: [on('effects.amp-on'), set('effects.eq-low', 1)], expect: 'changes', threshold: 0.02 },
  { control: 'effects.eq-mid (mid gain)', low: [on('effects.amp-on'), set('effects.eq-mid', 0)], high: [on('effects.amp-on'), set('effects.eq-mid', 1)], expect: 'changes', threshold: 0.02 },
  { control: 'effects.eq-high (treble)', low: [on('effects.amp-on'), set('effects.eq-high', 0)], high: [on('effects.amp-on'), set('effects.eq-high', 1)], expect: 'changes', threshold: 0.02 },
  // Layer effects: Delay, Compressor, Reverb
  { control: 'effects.delay-on (Delay bypass)', low: [], high: [on('effects.delay-on'), set('effects.delay-level', 0.8)], expect: 'changes', threshold: 0.03 },
  { control: 'effects.delay-time', low: [on('effects.delay-on'), set('effects.delay-level', 0.8), set('effects.delay-time', 0)], high: [on('effects.delay-on'), set('effects.delay-level', 0.8), set('effects.delay-time', 1)], expect: 'changes', threshold: 0.03 },
  { control: 'effects.delay-feedback', low: [on('effects.delay-on'), set('effects.delay-level', 0.8), set('effects.delay-feedback', 0)], high: [on('effects.delay-on'), set('effects.delay-level', 0.8), set('effects.delay-feedback', 0.8)], expect: 'changes', threshold: 0.03 },
  { control: 'effects.comp-on (Compressor bypass)', low: [], high: [on('effects.comp-on'), set('effects.comp-amount', 0.8)], expect: 'changes', threshold: 0.02 },
  { control: 'effects.comp-amount', low: [on('effects.comp-on'), set('effects.comp-amount', 0)], high: [on('effects.comp-on'), set('effects.comp-amount', 1)], expect: 'changes', threshold: 0.02 },
  { control: 'effects.reverb-on (Reverb bypass)', low: [], high: [on('effects.reverb-on'), set('effects.reverb-level', 0.8)], expect: 'changes', threshold: 0.03 },
  { control: 'effects.reverb-size (bright or dark)', low: [on('effects.reverb-on'), set('effects.reverb-level', 1), set('effects.reverb-size', 0)], high: [on('effects.reverb-on'), set('effects.reverb-level', 1), set('effects.reverb-size', 1)], expect: 'changes', threshold: 0.02 },
  // Rotary
  { control: 'performance.rotary-brake (rotor stops)', low: [on('effects.amp-on'), ...pick('effects.amp-type', 6)], high: [on('effects.amp-on'), ...pick('effects.amp-type', 6), on('performance.rotary-brake')], expect: 'changes', threshold: 0.03 },
  { control: 'performance.rotary-level', low: [on('effects.amp-on'), ...pick('effects.amp-type', 6), set('performance.rotary-level', 0)], high: [on('effects.amp-on'), ...pick('effects.amp-type', 6), set('performance.rotary-level', 1)], expect: 'louder', threshold: 10 },
]

describe('every functional control measurably changes rendered audio', () => {
  it.each(CASES.map((c) => [c.control, c] as const))('%s', async (_name, c) => {
    const low = await render(c.low)
    const high = await render(c.high)
    if (c.expect === 'changes') {
      expect(difference(low.subarray(44100 * 0.3, 44100 * 1.5), high.subarray(44100 * 0.3, 44100 * 1.5)) / Math.max(level(low), level(high), 1e-9), c.control).toBeGreaterThan(c.threshold)
    } else if (c.expect === 'louder') {
      expect(level(high) / Math.max(level(low), 1e-9), c.control).toBeGreaterThan(c.threshold)
    } else {
      expect(level(low) / Math.max(level(high), 1e-9), c.control).toBeGreaterThan(c.threshold)
    }
  }, 60000)

  it('Layer Effects ON: when off, every unit is bypassed even if switched on', async () => {
    const plain = await render([])
    const bypassed = await render([on('effects.all-on'), on('effects.delay-on'), set('effects.delay-level', 0.8), on('effects.reverb-on')])
    expect(change(plain, bypassed)).toBeLessThan(1e-3)
  }, 60000)

  it('focus selects the layer whose effects the panel edits: a delay on focused B is heard only when B plays', async () => {
    const onlyA = await render([on('piano.layer-b-focus'), on('effects.delay-on'), set('effects.delay-level', 0.8)])
    const plainA = await render([])
    // Layer A plays and B is off, so the delay edited on focused B is not heard.
    expect(change(plainA, onlyA)).toBeLessThan(1e-3)
    const bothOn = await render([on('piano.layer-b-on'), on('piano.layer-b-focus'), on('effects.delay-on'), set('effects.delay-level', 0.8)])
    const bothPlain = await render([on('piano.layer-b-on')])
    expect(change(bothPlain, bothOn)).toBeGreaterThan(0.03)
  }, 60000)

  it('piano group mode writes both layers: a delay edited on focused A reaches B only when grouped', async () => {
    // Layer A off, Layer B on: only B is heard, so any change to B is audible in the render.
    const onlyB = [on('piano.layer-a-on'), on('piano.layer-b-on')]
    const plain = await render(onlyB)
    const ungrouped = await render([...onlyB, on('effects.delay-on'), set('effects.delay-level', 0.8)])
    expect(change(plain, ungrouped)).toBeLessThan(1e-3)
    const grouped = await render([...onlyB, on('effects.group'), on('effects.delay-on'), set('effects.delay-level', 0.8)])
    expect(change(plain, grouped)).toBeGreaterThan(0.03)
  }, 60000)

  it('Shift + On global mode applies the delay to every layer', async () => {
    const onlyB = [on('piano.layer-a-on'), on('piano.layer-b-on')]
    const plain = await render(onlyB)
    const local = await render([...onlyB, on('effects.delay-on'), set('effects.delay-level', 0.8)])
    expect(change(plain, local)).toBeLessThan(1e-3)
    // Delay is on and set on focused A; Shift + On then makes it global, copying it to B.
    const global = await render([...onlyB, on('effects.delay-on'), set('effects.delay-level', 0.8), { type: 'global', id: 'effects.delay-on' }])
    expect(change(plain, global)).toBeGreaterThan(0.03)
  }, 60000)

  it('the octave control moves the layer by a full octave: note 60 shifted up sounds like note 72', async () => {
    const shifted = await render([set('piano.layer-a-octave', 1)], 60)
    const upper = await render([], 72)
    expect(change(shifted, upper)).toBeLessThan(0.01)
  }, 60000)
})
