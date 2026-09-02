import { fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { HOLD_MS } from '../src/audio/instrumentController'
import { faderToGain } from '../src/dsp/types'
import { applyMorphs, programOf, programsEqual } from '../src/state/programState'
import { armShift, click, el, mountApp, setSlider, startAudio, type Mounted } from './helpers'

let mounted: Mounted | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

/** Hold a morph source button while `edit` runs, then release (the manual's assignment gesture, p. 38). */
function whileHolding(m: Mounted, id: string, edit: () => void) {
  const node = el(id)
  fireEvent.pointerDown(node, { pointerId: 3, button: 0 })
  m.world.timers.advance(HOLD_MS + 5)
  edit()
  fireEvent.pointerUp(node, { pointerId: 3 })
  fireEvent.click(node)
}

describe('morph.assignments — Wheel and Control Pedal assignment, interpolation, indicators, and clearing', () => {
  it('holding WHEEL while moving a fader assigns start → end; releasing shows the stored value, the LED graph shows the morphed one', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    const procs = await startAudio(mounted)
    const fader = el('piano.layer-a.level')
    expect(Number(fader.getAttribute('aria-valuenow'))).toBe(90)
    whileHolding(mounted, 'program.morph.wheel', () => setSlider('piano.layer-a.level', 40))
    expect(state.get().morph.wheel).toEqual([{ path: 'piano.layers.A.level', start: 90, end: 40 }])
    expect(state.get().morphArmed.source).toBeNull()
    expect(Number(fader.getAttribute('aria-valuenow'))).toBe(90) // the stored value, the morph did not edit the program
    expect(state.get().piano.layers.A.level).toBe(90)
    expect(fader.dataset.morph).toBe('true')
    expect(document.querySelector('#program\\.morph\\.wheel')?.closest('.pbtn-wrap')?.querySelector('.led')?.className).toContain('lit')
    // the wheel interpolates: at half travel the effective level is 65 and the engine's level gain follows
    const levelA = mounted.world.ctx.gains()[2]
    setSlider('performance.mod-wheel', 0.5)
    expect(state.get().morphSources.wheel).toBeCloseTo(0.5, 6)
    expect(applyMorphs(programOf(state.get()), state.get().morphSources).piano.layers.A.level).toBeCloseTo(65, 6)
    expect(levelA.gain.events.at(-1)).toMatchObject({ type: 'target', value: faderToGain(65) })
    expect(fader.dataset.shown).toBe('65')
    expect(fader.parentElement!.querySelectorAll('.ladder-led.lit')).toHaveLength(Math.round(0.65 * 12))
    setSlider('performance.mod-wheel', 1)
    expect(levelA.gain.events.at(-1)).toMatchObject({ type: 'target', value: faderToGain(40) })
    setSlider('performance.mod-wheel', 0)
    expect(levelA.gain.events.at(-1)).toMatchObject({ type: 'target', value: faderToGain(90) })
    expect(procs.A.paramUpdates).toBeGreaterThan(0)
  })

  it('one source drives several destinations, increasing one while decreasing another; knobs light their green morph LED', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    const procs = await startAudio(mounted)
    click('synth.on')
    whileHolding(mounted, 'program.morph.wheel', () => {
      setSlider('synth.filter.freq', 9)
      setSlider('synth.layer-a.level', 20)
      setSlider('effects.reverb.dry-wet', 10)
    })
    const wheel = state.get().morph.wheel
    expect(wheel).toEqual(expect.arrayContaining([{ path: 'synth.layers.A.filter.freq', start: 6, end: 9 }, { path: 'synth.layers.A.level', start: 82, end: 20 }, { path: 'effects.chains.pianoA.reverb.dryWet', start: 6, end: 10 }]))
    expect(el('synth.filter.freq').dataset.morph).toBe('true')
    expect(el('effects.reverb.dry-wet').dataset.morph).toBe('true')
    expect(el('synth.osc.ctrl').dataset.morph).toBeUndefined()
    expect(document.querySelector('#section-synth .knob-wrap.has-morph .knob-morph-led .led')?.className).toContain('lit')
    setSlider('performance.mod-wheel', 1)
    const eff = applyMorphs(programOf(state.get()), state.get().morphSources)
    expect(eff.synth.layers.A.filter.freq).toBeCloseTo(9, 6)
    expect(eff.synth.layers.A.level).toBeCloseTo(20, 6)
    expect((procs.synth.A.params as { filter: { freq: number } }).filter.freq).toBeCloseTo(9, 6)
    expect((procs.synth.A.params as { level: number }).level).toBeCloseTo(20, 6)
    expect((procs.A.params.reverb as { dryWet: number }).dryWet).toBeCloseTo(10, 6)
    // the panel keeps showing the stored values while the morph is performed
    expect(Number(el('synth.filter.freq').getAttribute('aria-valuenow'))).toBe(6)
    expect(Number(el('synth.layer-a.level').getAttribute('aria-valuenow'))).toBe(82)
  })

  it('the Control Pedal (on-screen slider and MIDI CC11) is the second source, with its own assignments', async () => {
    mounted = await mountApp()
    const { state, midi } = mounted.services
    const procs = await startAudio(mounted)
    whileHolding(mounted, 'program.morph.control-pedal', () => setSlider('effects.delay.dry-wet', 10))
    expect(state.get().morph.pedal).toEqual([{ path: 'effects.chains.pianoA.delay.dryWet', start: 4, end: 10 }])
    expect(state.get().morph.wheel).toEqual([])
    fireEvent.change(el('control-pedal'), { target: { value: '50' } })
    expect(state.get().morphSources.pedal).toBeCloseTo(0.5, 6)
    expect((procs.A.params.delay as { dryWet: number }).dryWet).toBeCloseTo(7, 6)
    expect(el('control-pedal-value').textContent).toBe('50%')
    midi.handle([0xb0, 11, 127])
    expect(state.get().morphSources.pedal).toBeCloseTo(1, 6)
    expect((procs.A.params.delay as { dryWet: number }).dryWet).toBeCloseTo(10, 6)
    midi.handle([0xb0, 11, 0])
    expect((procs.A.params.delay as { dryWet: number }).dryWet).toBeCloseTo(4, 6)
  })

  it('a tap latches the source; re-holding and returning a control to its stored value removes that assignment; Shift + source clears all', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    click('program.morph.wheel')
    expect(state.get().morphArmed).toEqual({ source: 'wheel', latched: true })
    expect(el('program.morph.wheel').getAttribute('aria-pressed')).toBe('true')
    setSlider('organ.drawbar.16', 0)
    setSlider('piano.layer-b.level', 90)
    expect(state.get().morph.wheel).toEqual(expect.arrayContaining([{ path: 'organ.layers.A.drawbars.0', start: 7, end: 0 }, { path: 'piano.layers.B.level', start: 45, end: 90 }]))
    click('program.shift') // Exit leaves latch mode (manual p. 39)
    expect(state.get().morphArmed.source).toBeNull()
    expect(Number(el('organ.drawbar.16').getAttribute('aria-valuenow'))).toBe(7)
    expect(el('organ.drawbar.16').dataset.morph).toBe('true')
    // remove one assignment: hold and close the gap between the stored and the morph value
    whileHolding(mounted, 'program.morph.wheel', () => setSlider('organ.drawbar.16', 7))
    expect(state.get().morph.wheel).toEqual([{ path: 'piano.layers.B.level', start: 45, end: 90 }])
    expect(el('organ.drawbar.16').dataset.morph).toBeUndefined()
    // Shift + WHEEL clears the source
    armShift()
    click('program.morph.wheel')
    expect(state.get().morph.wheel).toEqual([])
    expect(el('piano.layer-b.level').dataset.morph).toBeUndefined()
    expect(document.querySelector('#program\\.morph\\.wheel')?.closest('.pbtn-wrap')?.querySelector('.led')?.className).not.toContain('lit')
  })

  it('the rotary speed is morphable from the speed button; morphs are stored with the program and restored', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    const procs = await startAudio(mounted)
    whileHolding(mounted, 'program.morph.wheel', () => click('performance.rotary.speed'))
    expect(state.get().morph.wheel).toEqual([{ path: 'rotary.speed', start: 0, end: 1 }])
    expect(document.querySelector('.led-rotary-morph .led')?.className).toContain('lit')
    setSlider('performance.mod-wheel', 0.5)
    expect(procs.rotary.params).toMatchObject({ speed: 0.5, fast: true })
    setSlider('performance.mod-wheel', 0)
    expect(procs.rotary.params).toMatchObject({ speed: 0, fast: false })
    const edited = programOf(state.get())
    click('program.store')
    click('program.store')
    click('program.button.3')
    expect(state.get().morph.wheel).toEqual([{ path: 'rotary.speed', start: 0, end: 1 }]) // the factory B3 program has the same morph
    click('program.button.2')
    expect(state.get().morph.wheel).toEqual([])
    click('program.button.1')
    expect(programsEqual(programOf(state.get()), edited)).toBe(true)
    expect(document.querySelector('.led-rotary-morph .led')?.className).toContain('lit')
  })
})
