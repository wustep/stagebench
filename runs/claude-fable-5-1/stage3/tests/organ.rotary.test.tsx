import { fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { HOLD_MS } from '../src/audio/instrumentController'
import { normalizedDifference, rms, stereoCorrelation } from '../src/dsp/analysis'
import { renderEvents, renderThrough, sineBurst } from '../src/dsp/offline'
import { OrganUnit } from '../src/dsp/organ'
import { defaultOrganParams } from '../src/dsp/organTypes'
import { RotaryUnit } from '../src/dsp/rotary'
import { click, el, mountApp, setSlider, startAudio, type Mounted } from './helpers'

let mounted: Mounted | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

/** Runs the rotary for `seconds` over a steady tone and returns the horn / rotor rates at the end. */
function ratesAfter(unit: RotaryUnit, seconds: number, sr = 22050) {
  const tone = sineBurst(440, seconds, sr, { amplitude: 0.3 })
  renderThrough(unit, tone)
  return { horn: unit.hornRate, rotor: unit.rotorRate }
}

describe('organ.rotary — routing, slow/fast/stop with acceleration, drive, morphable speed', () => {
  it('the ORGAN button routes the organ into the shared rotary; Slow / Fast, Stop Mode and Drive reach the rotary processor', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    const procs = await startAudio(mounted)
    const ctx = mounted.world.ctx
    click('organ.on')
    expect(ctx.pathsToDestination(procs.organ)[0]).not.toContain('rotary')
    click('performance.rotary.organ')
    expect(state.get().rotary.organ).toBe(true)
    const path = ctx.pathsToDestination(procs.organ)[0]
    expect(path.indexOf('layer')).toBeLessThan(path.indexOf('rotary'))
    expect(path.indexOf('rotary')).toBeLessThan(path.indexOf('master'))
    expect(document.querySelector('.led-rotary-on .led')?.className).toContain('lit')
    expect(procs.rotary.params).toMatchObject({ fast: false, speed: 0, stop: false, drive: 2 })
    click('performance.rotary.speed')
    expect(procs.rotary.params).toMatchObject({ fast: true, speed: 1 })
    click('performance.rotary.stop-mode')
    expect(procs.rotary.params).toMatchObject({ stop: true })
    click('performance.rotary.speed')
    expect(procs.rotary.params).toMatchObject({ fast: false, speed: 0, stop: true })
    expect(el('performance.rotary.speed').closest('.rotary-stack')?.textContent).toMatch(/STOP/)
    fireEvent.keyDown(el('performance.rotary.drive'), { key: 'End' })
    expect(procs.rotary.params).toMatchObject({ drive: 10 })
    click('performance.rotary.organ')
    expect(ctx.pathsToDestination(procs.organ)[0]).not.toContain('rotary')
    expect(document.querySelector('.led-rotary-on .led')?.className).not.toContain('lit')
  })

  it('rendered audio: speed changes accelerate and brake smoothly, Stop mode halts the rotors, drive and speed change the signal', () => {
    const sr = 22050
    const slow = new RotaryUnit(sr)
    slow.setParams({ fast: false, drive: 2 })
    expect(ratesAfter(slow, 0.2)).toMatchObject({ horn: expect.closeTo(0.8, 2), rotor: expect.closeTo(0.7, 2) })
    // switching to fast: the horn ramps (time constant 1 s) — after 0.5 s it is well under way but not there yet
    slow.setParams({ fast: true, drive: 2 })
    const mid = ratesAfter(slow, 0.5)
    expect(mid.horn).toBeGreaterThan(1.5)
    expect(mid.horn).toBeLessThan(6.5)
    const later = ratesAfter(slow, 3)
    expect(later.horn).toBeGreaterThan(mid.horn)
    expect(later.horn).toBeCloseTo(6.8, 0) // 3.5 s into a 1 s time constant: within 0.2 Hz of the fast rate
    expect(later.rotor).toBeGreaterThan(mid.rotor)
    // braking back to slow is gradual too
    slow.setParams({ fast: false, drive: 2 })
    const braking = ratesAfter(slow, 0.5)
    expect(braking.horn).toBeLessThan(later.horn)
    expect(braking.horn).toBeGreaterThan(0.8)
    // Stop mode at the slow position halts the rotors
    const stop = new RotaryUnit(sr)
    stop.setParams({ fast: false, drive: 2, speed: 0, stop: true })
    expect(ratesAfter(stop, 0.2)).toMatchObject({ horn: 0, rotor: 0 })
    expect(stop.isStopped).toBe(true)
    // a fractional morph speed sits between slow and fast
    const half = new RotaryUnit(sr)
    half.setParams({ fast: false, drive: 2, speed: 0.5 })
    const h = ratesAfter(half, 0.2)
    expect(h.horn).toBeCloseTo(0.8 + (6.8 - 0.8) * 0.5, 2)
    // the processed audio: fast vs slow differ, drive changes the signal, the rotary decorrelates the channels
    const tone = sineBurst(220, 1.0, sr, { amplitude: 0.3 })
    const render = (p: { fast: boolean; drive: number; speed?: number; stop?: boolean }) => {
      const u = new RotaryUnit(sr)
      u.setParams(p)
      return renderThrough(u, tone)
    }
    const s = render({ fast: false, drive: 2 })
    const f = render({ fast: true, drive: 2 })
    const d = render({ fast: false, drive: 9 })
    expect(rms(s.l)).toBeGreaterThan(0.01)
    expect(normalizedDifference(s.l, f.l)).toBeGreaterThan(0.1)
    expect(normalizedDifference(s.l, d.l)).toBeGreaterThan(0.1)
    expect(stereoCorrelation(f.l, f.r)).toBeLessThan(0.99)
  })

  it('the organ routed through the rotary renders differently from the dry organ, and the morph source moves the speed continuously', async () => {
    const sr = 22050
    const organ = new OrganUnit(sr)
    const p = defaultOrganParams()
    p.on = true
    organ.setParams(p)
    const dry = renderEvents(organ, [{ at: 0, event: { type: 'on', layer: 'A', midi: 60, velocity: 100, gain: 1 } }], 0.6, sr)
    const rotary = new RotaryUnit(sr)
    rotary.setParams({ fast: true, drive: 3 })
    const wet = renderThrough(rotary, dry.l, dry.r)
    expect(normalizedDifference(dry.l, wet.l)).toBeGreaterThan(0.1)
    expect(stereoCorrelation(wet.l, wet.r)).toBeLessThan(stereoCorrelation(dry.l, dry.r))
    // panel: hold WHEEL + press the speed button assigns the rotary speed morph; the mod wheel then sets fractions
    mounted = await mountApp()
    const procs = await startAudio(mounted)
    fireEvent.pointerDown(el('program.morph.wheel'), { pointerId: 2, button: 0 })
    mounted.world.timers.advance(HOLD_MS + 5)
    click('performance.rotary.speed')
    fireEvent.pointerUp(el('program.morph.wheel'), { pointerId: 2 })
    fireEvent.click(el('program.morph.wheel'))
    expect(mounted.services.state.get().morph.wheel).toEqual([{ path: 'rotary.speed', start: 0, end: 1 }])
    setSlider('performance.mod-wheel', 0.25)
    expect(procs.rotary.params).toMatchObject({ speed: 0.25, fast: false })
    setSlider('performance.mod-wheel', 0.75)
    expect(procs.rotary.params).toMatchObject({ speed: 0.75, fast: true })
    expect(document.querySelector('.led-rotary-morph .led')?.className).toContain('lit')
  })
})
