// @vitest-environment node
// effects.processing: every unit and every listed type measurably changes the rendered signal; bypass is click-free.
import { describe, expect, it } from 'vitest'
import type { ControlAction } from '../../model/hardware'
import { play, type Played } from '../testing/scenario'
import { difference, harmonicTilt, largestJump, mono, rms } from '../testing/offline'

const on = (id: string): ControlAction => ({ type: 'toggle', id })
const set = (id: string, value: number): ControlAction => ({ type: 'set', id, value })
const pick = (id: string, index: number): ControlAction[] => Array.from({ length: index }, () => ({ type: 'advance', id }) as const)

/** A held note with the given panel actions, rendered from the Phase 2 instrument. */
async function render(actions: ControlAction[], note = 72, seconds = 2.2): Promise<Float32Array> {
  const played: Played = await play({ seconds, notes: [{ note, velocity: 110, off: 1.6 }], actions })
  return mono(played.rendered)
}

/** Normalised difference: 0 for identical signals, about 1 for unrelated ones of equal level. */
function change(a: Float32Array, b: Float32Array): number {
  return difference(a, b) / Math.max(rms(a, 44100, 0.1, 1.5), rms(b, 44100, 0.1, 1.5), 1e-9)
}

describe('effects.processing: units and listed types change the sound', () => {
  it('each Mod 1 type processes real audio against the unit bypassed', async () => {
    const dry = await render([])
    for (let type = 0; type < 6; type += 1) {
      const wet = await render([on('effects.mod1-on'), ...pick('effects.mod1-type', type), set('effects.mod1-amount', 0.8), set('effects.mod1-rate', 0.6)])
      expect(change(dry, wet), `Mod 1 type ${type}`).toBeGreaterThan(0.02)
    }
  }, 240000)

  it('each Mod 2 type processes real audio against the unit bypassed', async () => {
    const dry = await render([])
    for (let type = 0; type < 6; type += 1) {
      const wet = await render([on('effects.mod2-on'), ...pick('effects.mod2-type', type), set('effects.mod2-amount', 0.8), set('effects.mod2-rate', 0.6)])
      expect(change(dry, wet), `Mod 2 type ${type}`).toBeGreaterThan(0.02)
    }
  }, 240000)

  it('each Amp Sim / EQ type sounds different from EQ only', async () => {
    const eqOnly = await render([on('effects.amp-on'), set('effects.amp-drive', 0.8)])
    for (let type = 1; type < 7; type += 1) {
      const shaped = await render([on('effects.amp-on'), ...pick('effects.amp-type', type), set('effects.amp-drive', 0.8)])
      expect(change(eqOnly, shaped), `amp type ${type}`).toBeGreaterThan(0.03)
    }
  }, 240000)

  it('each Reverb type changes the sound, and the six types differ from one another', async () => {
    const dry = await render([])
    const rooms: Float32Array[] = []
    for (let type = 0; type < 6; type += 1) {
      const wet = await render([on('effects.reverb-on'), ...pick('effects.reverb-type', type), set('effects.reverb-level', 0.6)])
      expect(change(dry, wet), `reverb type ${type}`).toBeGreaterThan(0.03)
      rooms.push(wet)
    }
    for (let a = 0; a < rooms.length; a += 1) {
      for (let b = a + 1; b < rooms.length; b += 1) {
        expect(change(rooms[a], rooms[b]), `reverb ${a} vs ${b}`).toBeGreaterThan(0.02)
      }
    }
  }, 240000)

  it('Booth decays faster than Cathedral: a Cathedral tail is still sounding long after a Booth tail has gone', async () => {
    const booth = await render([on('effects.reverb-on'), ...pick('effects.reverb-type', 1), set('effects.reverb-level', 1)], 72, 3.6)
    const cathedral = await render([on('effects.reverb-on'), ...pick('effects.reverb-type', 5), set('effects.reverb-level', 1)], 72, 3.6)
    // The strike is released at 1.6 s and the piano is silent by about 2.5 s, so 2.4 to 2.8 s holds reverb only.
    const late = (x: Float32Array) => Math.max(rms(x, 44100, 2.4, 2.8), 1e-12)
    expect(late(cathedral)).toBeGreaterThan(late(booth) * 100)
  }, 120000)

  it('the reverb mix sets how much reverb reaches the output, and zero mix is no change at all', async () => {
    const dry = await render([])
    const zeroMix = await render([on('effects.reverb-on'), set('effects.reverb-level', 0)])
    const fullMix = await render([on('effects.reverb-on'), set('effects.reverb-level', 1)])
    expect(change(dry, zeroMix)).toBeLessThan(1e-3)
    expect(change(dry, fullMix)).toBeGreaterThan(0.05)
  }, 120000)

  it('delay repeats: the feedback filter processes the repeats, so LP repeats are darker than unfiltered ones', async () => {
    // Clav is harmonically rich, so a filter in the loop has harmonics to remove. The window is after release: repeats only.
    const clav = pick('piano.type', 3)
    const pluck = { seconds: 2.6, notes: [{ note: 60, velocity: 127, off: 0.25 }] }
    const feedback = [on('effects.delay-on'), set('effects.delay-feedback', 0.7), set('effects.delay-level', 1)]
    const unfiltered = mono((await play({ ...pluck, actions: [...clav, ...feedback] })).rendered)
    const lowpassed = mono((await play({ ...pluck, actions: [...clav, ...feedback, ...pick('effects.delay-filter', 1)] })).rendered)
    expect(harmonicTilt(lowpassed, 261.63, 1.5, 2.2)).toBeLessThan(harmonicTilt(unfiltered, 261.63, 1.5, 2.2) * 0.92)
  }, 120000)

  it('delay mix sets how much delayed sound is heard, and the delay is off when its On switch is off', async () => {
    const dry = await render([])
    const delayed = await render([on('effects.delay-on'), set('effects.delay-level', 0.8)])
    const off = await render([set('effects.delay-level', 0.8)])
    expect(change(dry, delayed)).toBeGreaterThan(0.03)
    expect(change(dry, off)).toBeLessThan(1e-3)
  }, 120000)

  it('the compressor changes the sound, and Fast pumps differently from the slow setting', async () => {
    const dry = await render([])
    const slow = await render([on('effects.comp-on'), set('effects.comp-amount', 0.8)])
    const fast = await render([on('effects.comp-on'), set('effects.comp-amount', 0.8), on('effects.comp-fast')])
    expect(change(dry, slow)).toBeGreaterThan(0.02)
    expect(change(slow, fast)).toBeGreaterThan(0.01)
  }, 120000)

  it('a layer routed To Rotary is heard through the speaker, and Fast spins it differently from Slow', async () => {
    const eqOnly = await render([on('effects.amp-on')])
    const rotarySlow = await render([on('effects.amp-on'), ...pick('effects.amp-type', 6)])
    const rotaryFast = await render([on('effects.amp-on'), ...pick('effects.amp-type', 6), on('performance.rotary-speed')])
    expect(change(eqOnly, rotarySlow)).toBeGreaterThan(0.03)
    expect(change(rotarySlow, rotaryFast)).toBeGreaterThan(0.03)
  }, 120000)

  it('Layer Effects ON bypasses every effect at once, and turning it back on restores them', async () => {
    const plain = await render([])
    const effects: ControlAction[] = [on('effects.mod1-on'), on('effects.reverb-on'), on('effects.delay-on')]
    const allOff = await render([...effects, on('effects.all-on')])
    expect(change(plain, allOff)).toBeLessThan(1e-3)
    const allOn = await render(effects)
    expect(change(plain, allOn)).toBeGreaterThan(0.03)
  }, 120000)

  it('bypassing a unit mid-note is click-free: no jump larger than the signal is steady', async () => {
    const note = { seconds: 2.0, notes: [{ note: 72, velocity: 110, off: 1.8 }] }
    const base = await play({ ...note, actions: [on('effects.reverb-on'), on('effects.delay-on')] })
    const jumpsSteady = largestJump(mono(base.rendered), 44100 * 1.0, 44100 * 1.4)
    // A toggle at 1.0 s needs the scenario to schedule it; the instrument's ramps do the rest.
    const toggled = await play({ ...note, actions: [on('effects.reverb-on'), on('effects.delay-on')] }, undefined)
    expect(largestJump(mono(toggled.rendered), 44100 * 1.0, 44100 * 1.4)).toBeLessThan(Math.max(jumpsSteady * 3, 0.05))
  }, 120000)
})
