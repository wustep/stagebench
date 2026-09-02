import { act, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizedDifference, rms } from '../src/dsp/analysis'
import { CHAIN_ORDER } from '../src/dsp/chain'
import { harmonicTone, makeChain, renderThrough } from '../src/dsp/offline'
import { secondsToTempoKnob } from '../src/dsp/types'
import type { FakeProcessorNode } from '../src/audio/fakeAudio'
import { el, flush, keyEl, mountApp, type Mounted } from './helpers'

let mounted: Mounted | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

function armShift() {
  fireEvent.pointerDown(el('effects.shift'), { pointerId: 9, button: 0 })
  fireEvent.pointerUp(el('effects.shift'), { pointerId: 9 })
}

async function startAudio(m: Mounted): Promise<{ A: FakeProcessorNode; B: FakeProcessorNode; rotary: FakeProcessorNode }> {
  await act(async () => {
    fireEvent.click(el('start-audio'))
  })
  for (let i = 0; i < 4; i++) await flush()
  await act(async () => {
    m.world.timers.flush()
  })
  const [A, B] = m.world.ctx.processors('layer')
  return { A, B, rotary: m.world.ctx.processors('rotary')[0] }
}

const unit = (p: FakeProcessorNode, name: string) => p.params[name] as Record<string, unknown>

describe('effects.routing — focus, group, global, bypass, dry/wet, order, delay feedback path, To Rotary', () => {
  it('effects focus follows the piano layer focus and edits reach only the focused chain', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    const { A, B } = await startAudio(mounted)
    expect(state.get().effects.focus).toBe('piano')
    fireEvent.keyDown(el('effects.reverb.dry-wet'), { key: 'End' })
    expect(unit(A, 'reverb').dryWet).toBe(10)
    expect(unit(B, 'reverb').dryWet).toBe(6)
    // enabling layer B focuses it; the panel now shows B's chain (dry/wet 6) and edits go to B
    fireEvent.click(el('piano.layer-b.on'))
    expect(Number(el('effects.reverb.dry-wet').getAttribute('aria-valuenow'))).toBe(6)
    fireEvent.keyDown(el('effects.reverb.dry-wet'), { key: 'Home' })
    expect(unit(B, 'reverb').dryWet).toBe(0)
    expect(unit(A, 'reverb').dryWet).toBe(10)
    expect(document.querySelector('.fx-led-piano-b .led')?.className).toContain('lit')
    expect(document.querySelector('.fx-led-piano-a .led')?.className).not.toContain('lit')
    expect(document.querySelector('#section-piano .strip-fx .led')?.className).toContain('lit')
  })

  it('manual focus buttons move the panel to Organ / Synth (stored, inaudible chains) and back to Piano', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    const { A } = await startAudio(mounted)
    const updates = A.paramUpdates
    fireEvent.click(el('effects.focus.organ'))
    expect(state.get().effects.focus).toBe('organ')
    expect(document.querySelector('.fx-led-organ .led')?.className).toContain('lit')
    expect(document.querySelector('#section-piano .strip-fx .led')?.className).not.toContain('lit')
    fireEvent.keyDown(el('effects.mod1.amount'), { key: 'End' })
    expect(state.get().effects.chains.organ.mod1.amount).toBe(10)
    expect(state.get().effects.chains.pianoA.mod1.amount).toBe(5)
    expect(A.paramUpdates).toBe(updates) // organ edits never touch a piano processor
    fireEvent.click(el('effects.focus.piano'))
    expect(state.get().effects.focus).toBe('piano')
    expect(Number(el('effects.mod1.amount').getAttribute('aria-valuenow'))).toBe(5)
  })

  it('Group mode (Shift + Piano focus) shares one setting across both piano layers; Global (Shift + On) across every chain', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    const { A, B } = await startAudio(mounted)
    fireEvent.click(el('piano.layer-b.on'))
    fireEvent.keyDown(el('effects.mod2.amount'), { key: 'End' }) // B only
    expect(unit(B, 'mod2').amount).toBe(10)
    expect(unit(A, 'mod2').amount).toBe(6)
    armShift()
    fireEvent.click(el('effects.focus.piano'))
    expect(state.get().effects.pianoGroup).toBe(true)
    expect(unit(A, 'mod2').amount).toBe(10) // entering Group copies the focused layer's settings to both
    expect(document.querySelector('.fx-led-piano-a .led')?.className).toContain('lit')
    expect(document.querySelector('.fx-led-piano-b .led')?.className).toContain('lit')
    fireEvent.click(el('effects.mod1.on'))
    expect(unit(A, 'mod1').on).toBe(true)
    expect(unit(B, 'mod1').on).toBe(true)
    armShift()
    fireEvent.click(el('effects.focus.piano'))
    expect(state.get().effects.pianoGroup).toBe(false)
    // Global delay: Shift + Delay ON (the ON toggle itself is not flipped)
    const delayOn = el('effects.delay.on')
    const before = delayOn.getAttribute('aria-pressed')
    armShift()
    fireEvent.click(delayOn)
    expect(state.get().effects.global.delay).toBe(true)
    expect(delayOn.getAttribute('aria-pressed')).toBe(before)
    expect(document.querySelector('.led-global-delay .led')?.className).toContain('lit')
    fireEvent.click(el('effects.focus.organ'))
    fireEvent.keyDown(el('effects.delay.feedback'), { key: 'End' })
    expect(unit(A, 'delay').feedback).toBe(10) // global: edited from the Organ focus, applied to the piano chains too
    expect(unit(B, 'delay').feedback).toBe(10)
    expect(state.get().effects.chains.organ.delay.feedback).toBe(10)
    expect(document.getElementById('program.oled')?.textContent).toMatch(/Global D/)
  })

  it('per-unit ON, the Layer Effects ON (all-effects bypass), dry/wet and the delay feedback filter reach the DSP', async () => {
    mounted = await mountApp()
    const { A } = await startAudio(mounted)
    expect(unit(A, 'reverb').on).toBe(true)
    fireEvent.click(el('effects.reverb.on'))
    expect(unit(A, 'reverb').on).toBe(false)
    fireEvent.click(el('effects.delay.on'))
    expect(unit(A, 'delay').on).toBe(true)
    fireEvent.keyDown(el('effects.delay.dry-wet'), { key: 'End' })
    expect(unit(A, 'delay').dryWet).toBe(10)
    const filter = el('effects.delay.filter')
    fireEvent.click(filter) // LP → Off
    expect(unit(A, 'delay').filter).toBe(0)
    fireEvent.click(filter) // → HP
    expect(unit(A, 'delay').filter).toBe(1)
    expect(A.params.effectsOn).toBe(true)
    fireEvent.click(el('effects.on'))
    expect(A.params.effectsOn).toBe(false)
    expect(document.getElementById('program.oled')?.textContent).toMatch(/FX OFF/)
    fireEvent.click(el('effects.on'))
    expect(A.params.effectsOn).toBe(true)
    // ping-pong (Shift + Filter) and compressor fast mode (Shift + Amount) are Shift functions
    armShift()
    fireEvent.click(filter)
    expect(unit(A, 'delay').pingPong).toBe(true)
    expect(unit(A, 'delay').filter).toBe(1) // the selector did not cycle
    armShift()
    fireEvent.keyDown(el('effects.comp.amount'), { key: 'ArrowUp' })
    expect(unit(A, 'compressor').fast).toBe(true)
    expect(unit(A, 'compressor').amount).toBe(5)
    expect(document.querySelector('.led-comp-fast .led')?.className).toContain('lit')
  })

  it('tap tempo sets the delay time and the Tempo knob agrees; the rotary speed and drive reach the shared rotary', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    const { A, rotary } = await startAudio(mounted)
    const timers = mounted.world.timers
    const tap = () => {
      fireEvent.pointerDown(el('effects.delay.tap'), { pointerId: 1, button: 0 })
      fireEvent.pointerUp(el('effects.delay.tap'), { pointerId: 1 })
    }
    tap()
    timers.advance(500)
    tap()
    timers.advance(500)
    tap()
    expect(state.get().effects.chains.pianoA.delay.seconds).toBeCloseTo(0.5, 3)
    expect(unit(A, 'delay').seconds).toBeCloseTo(0.5, 3)
    expect(Number(el('effects.delay.tempo').getAttribute('aria-valuenow'))).toBeCloseTo(secondsToTempoKnob(0.5), 1)
    expect(rotary.params).toMatchObject({ fast: false, drive: 2 })
    fireEvent.click(el('performance.rotary.speed'))
    expect(rotary.params).toMatchObject({ fast: true })
    fireEvent.keyDown(el('performance.rotary.drive'), { key: 'End' })
    expect(rotary.params).toMatchObject({ fast: true, drive: 10 })
  })

  it('keeps the documented order (reverb last in the chain, before the rotary) and every routing change alters the rendered signal', () => {
    expect([...CHAIN_ORDER].slice(2)).toEqual(['mod1', 'mod2', 'delay', 'ampEq', 'compressor', 'reverb'])
    const sr = 22050
    const tone = harmonicTone(60, 0.6, sr)
    const dry = renderThrough(makeChain(sr, { reverb: { on: false } }).chain, tone).l
    expect(normalizedDifference(tone, dry)).toBeLessThan(1e-6) // every unit off: bit-transparent
    const reverb = renderThrough(makeChain(sr, { reverb: { on: true, dryWet: 8 } }).chain, tone).l
    expect(normalizedDifference(tone, reverb)).toBeGreaterThan(0.1)
    const bypassed = renderThrough(makeChain(sr, { reverb: { on: true, dryWet: 8 }, effectsOn: false }).chain, tone).l
    expect(normalizedDifference(tone, bypassed)).toBeLessThan(1e-6) // Layer Effects OFF bypasses everything at once
    const wetter = renderThrough(makeChain(sr, { reverb: { on: true, dryWet: 10 } }).chain, tone).l
    expect(normalizedDifference(reverb, wetter)).toBeGreaterThan(0.05)
    expect(rms(wetter)).toBeGreaterThan(0)
  })

  it('To Rotary re-routes the layer after its chain, lights the Rotary ON LED and the master path stays the only exit', async () => {
    mounted = await mountApp()
    const { A } = await startAudio(mounted)
    fireEvent.click(el('effects.amp.on'))
    const model = el('effects.amp.model')
    while (Number(model.dataset.value) !== 4) fireEvent.click(model)
    expect(unit(A, 'ampEq').model).toBe(4)
    fireEvent.pointerDown(keyEl(60), { pointerId: 1, button: 0 })
    const ctx = mounted.world.ctx
    const path = ctx.pathsToDestination(ctx.sources().at(-1)!)[0]
    expect(path.indexOf('layer')).toBeLessThan(path.indexOf('rotary'))
    expect(path.indexOf('rotary')).toBeLessThan(path.indexOf('master'))
    expect(path.at(-1)).toBe('destination')
    expect(document.querySelector('.led-rotary-on .led')?.className).toContain('lit')
    fireEvent.pointerUp(keyEl(60), { pointerId: 1 })
  })
})
