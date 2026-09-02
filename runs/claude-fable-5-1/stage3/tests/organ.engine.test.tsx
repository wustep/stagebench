import { fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizedDifference, rms } from '../src/dsp/analysis'
import { renderEvents } from '../src/dsp/offline'
import { OrganUnit } from '../src/dsp/organ'
import { defaultOrganParams, type OrganEvent } from '../src/dsp/organTypes'
import { FakeProcessorNode } from '../src/audio/fakeAudio'
import { click, el, lastEvent, mountApp, play, release, startAudio, type Mounted } from './helpers'

let mounted: Mounted | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

describe('organ.engine — two-layer note lifecycle, levels, focus, zones, shared effect chain, cleanup', () => {
  it('routes key presses, releases, sustain (per layer SUSTPED) and All Notes Off to the organ processor as events', async () => {
    mounted = await mountApp()
    const { state, engine, bus } = mounted.services
    const procs = await startAudio(mounted)
    click('organ.on')
    click('organ.layer-b.on')
    expect((procs.organ.params as { on: boolean; layers: { B: { on: boolean } } }).on).toBe(true)
    play(mounted, 60, 90)
    play(mounted, 67, 70)
    expect(procs.organ.heldNotes('A')).toEqual([60, 67])
    expect(procs.organ.heldNotes('B')).toEqual([60, 67])
    expect(lastEvent(procs.organ, 'on')).toMatchObject({ type: 'on', layer: 'B', midi: 67, velocity: 70, gain: 1 })
    expect(engine.getStatus().sources.organ).toEqual({ A: 2, B: 2 })
    expect(el('organ-message').textContent).toMatch(/A: B3 \(2 notes\)/)
    release(mounted, 60)
    expect(procs.organ.heldNotes('A')).toEqual([67])
    expect(lastEvent(procs.organ, 'off')).toMatchObject({ layer: 'B', midi: 60 })
    // sustain reaches the processor; SUSTPED per layer is a processor parameter (Shift + Layer A on the focused layer)
    bus.setSustain('ui', true)
    expect(lastEvent(procs.organ, 'sustain')).toMatchObject({ on: true })
    expect((procs.organ.params as { layers: { B: { sustped: boolean } } }).layers.B.sustped).toBe(true)
    fireEvent.pointerDown(el('program.shift'), { pointerId: 1, button: 0 })
    fireEvent.pointerUp(el('program.shift'), { pointerId: 1 })
    click('organ.layer-a.on') // Shift + Layer A = SUSTPED of the focused layer (B)
    expect(state.get().organ.layers.B.sustped).toBe(false)
    expect(state.get().organ.layers.B.on).toBe(true) // the layer itself is untouched
    expect((procs.organ.params as { layers: { B: { sustped: boolean } } }).layers.B.sustped).toBe(false)
    expect(document.querySelector('.led-organ-sustped .led')?.className).not.toContain('lit')
    bus.setSustain('ui', false)
    expect(lastEvent(procs.organ, 'sustain')).toMatchObject({ on: false })
    bus.releaseAll()
    expect(lastEvent(procs.organ, 'allOff')).toBeTruthy()
    expect(procs.organ.heldNotes('A')).toEqual([])
    expect(engine.getStatus().sources.organ).toEqual({ A: 0, B: 0 })
  })

  it('layer level, octave, model, drawbars, vibrato and percussion of the focused layer reach the processor; the other layer keeps its own', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    const procs = await startAudio(mounted)
    click('organ.on')
    click('organ.layer-b.on') // B focused
    fireEvent.keyDown(el('organ.drawbar.16'), { key: 'Home' })
    fireEvent.keyDown(el('organ.drawbar.1'), { key: 'End' })
    click('organ.model')
    click('organ.model') // Farf
    click('organ.vibrato.on')
    click('organ.vibrato.mode')
    click('organ.percussion.on')
    click('organ.percussion.decay')
    click('organ.percussion.harmonic')
    click('organ.percussion.volume')
    const p = procs.organ.params as { layers: { A: { drawbars: number[]; model: number; vibrato: boolean }; B: { drawbars: number[]; model: number; vibrato: boolean } }; vibratoMode: number; percussion: { on: boolean; fast: boolean; third: boolean; soft: boolean } }
    expect(p.layers.B.drawbars).toEqual([0, 3, 8, 4, 5, 3, 2, 2, 8])
    expect(p.layers.A.drawbars).toEqual([7, 3, 8, 4, 5, 3, 2, 2, 3])
    expect(p.layers.B.model).toBe(2)
    expect(p.layers.A.model).toBe(0)
    expect(p.layers.B.vibrato).toBe(true)
    expect(p.layers.A.vibrato).toBe(false) // A is a B3: vibrato is per layer there
    expect(p.vibratoMode).toBe(0) // C3 → V1 (the selector wraps)
    expect(p.percussion).toMatchObject({ on: true, fast: false, third: false, soft: true })
    // the Farf register display: LEDs 1–4 for an inactive register, 5–8 for an active one (manual p. 21)
    expect(el('organ.drawbar.16').closest('.drawbar-wrap')?.className).toContain('is-farf')
    expect(el('organ.drawbar.1').closest('.drawbar-body')!.querySelectorAll('.ladder-led.lit')).toHaveLength(4)
    expect(el('organ.drawbar.1').getAttribute('aria-valuetext')).toMatch(/register on/)
    expect(el('organ.drawbar.16').getAttribute('aria-valuetext')).toMatch(/register off/)
    // focus back to A: the panel re-shows A's drawbars and model
    click('effects.focus.organ')
    expect(state.get().organ.focus).toBe('A')
    expect(Number(el('organ.drawbar.16').getAttribute('aria-valuenow'))).toBe(7)
    expect(Number(el('organ.model').dataset.value)).toBe(0)
    expect(el('organ.drawbar.16').closest('.drawbar-wrap')?.className).not.toContain('is-farf')
    // Vox / Farf share the vibrato on/off between both layers; B3 keeps its own
    click('organ.model') // A → Vox
    click('organ.vibrato.on')
    expect(state.get().organ.layers.A.vibrato).toBe(true)
    expect(state.get().organ.layers.B.vibrato).toBe(true)
    click('organ.vibrato.on')
    expect(state.get().organ.layers.B.vibrato).toBe(false)
  })

  it('both layers share one effect chain that sits between the organ processor and the section gain; unmount disposes everything', async () => {
    mounted = await mountApp()
    const procs = await startAudio(mounted)
    const ctx = mounted.world.ctx
    expect(ctx.processors('organ')).toHaveLength(1)
    expect(procs.organ.connections).toEqual([procs.organChain])
    expect(procs.organChain.connections).toEqual([ctx.gains()[5]])
    click('organ.on')
    click('effects.focus.organ')
    click('effects.mod1.on')
    expect((procs.organChain.params.mod1 as { on: boolean }).on).toBe(true)
    expect((procs.A.params.mod1 as { on: boolean }).on).toBe(false)
    expect((procs.synthChains.A.params.mod1 as { on: boolean }).on).toBe(false)
    play(mounted, 60)
    const services = mounted.services
    mounted.unmount()
    mounted = null
    expect(procs.organ.disposed).toBe(true)
    expect(procs.organChain.disposed).toBe(true)
    expect(ctx.liveNodes()).toEqual([])
    expect(ctx.nodes.every((n) => !(n instanceof FakeProcessorNode) || n.disposed)).toBe(true)
    expect(services.engine.metrics()).toMatchObject({ liveNodes: 0, hasContext: false })
    expect(services.engine.sourceNotes().organ).toEqual({ A: [], B: [] })
  })

  it('rendered audio: two layers with different models sum in one OrganUnit, a layer off is silent, and All Notes Off ends the sound', () => {
    const sr = 22050
    const base = () => {
      const p = defaultOrganParams()
      p.on = true
      p.layers.A = { ...p.layers.A, on: true, model: 0 }
      p.layers.B = { ...p.layers.B, on: true, model: 1, drawbars: [8, 8, 8, 8, 0, 0, 0, 0, 4] }
      return p
    }
    const render = (mutate: (p: ReturnType<typeof base>) => void, events: { at: number; event: OrganEvent }[]) => {
      const unit = new OrganUnit(sr)
      const p = base()
      mutate(p)
      unit.setParams(p)
      return renderEvents(unit, events, 0.5, sr).l
    }
    const both = render(() => undefined, [{ at: 0, event: { type: 'on', layer: 'A', midi: 60, velocity: 100, gain: 1 } }, { at: 0, event: { type: 'on', layer: 'B', midi: 60, velocity: 100, gain: 1 } }])
    const aOnly = render(() => undefined, [{ at: 0, event: { type: 'on', layer: 'A', midi: 60, velocity: 100, gain: 1 } }])
    const bOff = render((p) => (p.layers.B.on = false), [{ at: 0, event: { type: 'on', layer: 'A', midi: 60, velocity: 100, gain: 1 } }, { at: 0, event: { type: 'on', layer: 'B', midi: 60, velocity: 100, gain: 1 } }])
    expect(rms(aOnly)).toBeGreaterThan(0.01)
    expect(normalizedDifference(aOnly, both)).toBeGreaterThan(0.2)
    expect(normalizedDifference(aOnly, bOff)).toBeLessThan(1e-6)
    const cut = render(() => undefined, [{ at: 0, event: { type: 'on', layer: 'A', midi: 60, velocity: 100, gain: 1 } }, { at: 0.25, event: { type: 'allOff' } }])
    expect(rms(cut, Math.round(sr * 0.05), Math.round(sr * 0.2))).toBeGreaterThan(0.01)
    expect(rms(cut, Math.round(sr * 0.4), Math.round(sr * 0.5))).toBeLessThan(1e-4)
  })
})
