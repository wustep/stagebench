import { fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { faderToGain } from '../src/dsp/types'
import { armShift, click, el, lastEvent, mountApp, play, release, startAudio, type Mounted } from './helpers'

let mounted: Mounted | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

function pressOctave(id: string) {
  fireEvent.pointerDown(el(id), { pointerId: 1, button: 0 })
  fireEvent.pointerUp(el(id), { pointerId: 1 })
}

describe('layers.routing — enable/focus/level/octave/effect-target routing for every layer of every engine', () => {
  it('organ layers: enable, focus (FX focus follows), level, octave and the shared organ chain', async () => {
    mounted = await mountApp()
    const { state, engine } = mounted.services
    const procs = await startAudio(mounted)
    click('organ.on')
    expect(state.get().effects.focus).toBe('piano') // the section button does not move the FX focus
    click('organ.layer-b.on')
    expect(state.get().organ.layers.B.on).toBe(true)
    expect(state.get().organ.focus).toBe('B')
    expect(state.get().effects.focus).toBe('organ')
    expect(document.querySelector('#section-organ .strip-fx .led')?.className).toContain('lit')
    expect(el('organ.layer-b.on').closest('.pbtn-wrap')?.className).toContain('is-focus')
    // level and octave of the focused layer reach the organ processor
    fireEvent.keyDown(el('organ.layer-b.level'), { key: 'End' })
    pressOctave('organ.octave-up')
    const organ = procs.organ.params as { layers: { A: { level: number; octave: number; on: boolean }; B: { level: number; octave: number; on: boolean } } }
    expect(organ.layers.B).toMatchObject({ on: true, level: 100, octave: 1 })
    expect(organ.layers.A).toMatchObject({ on: true, level: 78, octave: 0 })
    // both layers receive the note; the shared chain is edited from the Organ focus
    play(mounted, 60)
    expect(procs.organ.heldNotes('A')).toEqual([60])
    expect(procs.organ.heldNotes('B')).toEqual([60])
    expect(lastEvent(procs.organ, 'on')).toMatchObject({ layer: 'B', midi: 60, gain: 1 })
    release(mounted, 60)
    fireEvent.keyDown(el('effects.reverb.dry-wet'), { key: 'End' })
    expect((procs.organChain.params.reverb as { dryWet: number }).dryWet).toBe(10)
    expect((procs.A.params.reverb as { dryWet: number }).dryWet).toBe(6)
    // pressing the lit Organ focus toggles the focused organ layer; turning B off moves the focus back to A
    click('effects.focus.organ')
    expect(state.get().organ.focus).toBe('A')
    click('organ.layer-b.on')
    expect(state.get().organ.layers.B.on).toBe(false)
    expect(state.get().organ.focus).toBe('A')
    expect(engine.getOrgan().layers.B.on).toBe(false)
    expect(document.querySelector('#organ\\.layer-b\\.on')?.closest('.pbtn-wrap')?.className).not.toContain('is-focus')
  })

  it('synth layers A / B / C: independent state and effect chains, focus, levels, octaves; Shift + Synth focus groups the chains', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    const procs = await startAudio(mounted)
    click('synth.on')
    click('synth.layer-b.on')
    click('synth.layer-c.on')
    expect(state.get().synth.focus).toBe('C')
    expect(state.get().effects.focus).toBe('synth')
    expect(document.querySelector('.fx-led-synth-c .led')?.className).toContain('lit')
    expect(document.querySelector('.fx-led-synth-a .led')?.className).not.toContain('lit')
    fireEvent.keyDown(el('synth.layer-c.level'), { key: 'Home' })
    pressOctave('synth.octave-down')
    fireEvent.keyDown(el('synth.filter.freq'), { key: 'End' })
    expect(procs.synth.C.params).toMatchObject({ on: true, level: 0, octave: -1, filter: { freq: 10 } })
    expect(procs.synth.A.params).toMatchObject({ on: true, level: 82, octave: 0, filter: { freq: 6 } })
    expect(procs.synth.B.params).toMatchObject({ on: true, level: 40 })
    // effect edits reach only the focused synth chain
    fireEvent.keyDown(el('effects.delay.feedback'), { key: 'End' })
    expect((procs.synthChains.C.params.delay as { feedback: number }).feedback).toBe(10)
    expect((procs.synthChains.A.params.delay as { feedback: number }).feedback).toBe(6)
    expect((procs.A.params.delay as { feedback: number }).feedback).toBe(6)
    // group mode: the focused chain is copied to A / B / C and further edits stay in sync
    armShift('effects.shift')
    click('effects.focus.synth')
    expect(state.get().effects.synthGroup).toBe(true)
    expect((procs.synthChains.A.params.delay as { feedback: number }).feedback).toBe(10)
    fireEvent.keyDown(el('effects.mod2.amount'), { key: 'End' })
    expect((procs.synthChains.B.params.mod2 as { amount: number }).amount).toBe(10)
    expect(document.querySelector('.fx-led-synth-a .led')?.className).toContain('lit')
    expect(document.querySelector('.fx-led-synth-b .led')?.className).toContain('lit')
    armShift('effects.shift')
    click('effects.focus.synth')
    expect(state.get().effects.synthGroup).toBe(false)
    // the notes reach every enabled synth layer processor
    play(mounted, 62)
    expect(procs.synth.A.heldNotes()).toEqual([62])
    expect(procs.synth.B.heldNotes()).toEqual([62])
    expect(procs.synth.C.heldNotes()).toEqual([62])
    release(mounted, 62)
    expect(procs.synth.C.heldNotes()).toEqual([])
    // the focused layer cycles with the lit Synth focus button
    click('effects.focus.synth')
    expect(state.get().synth.focus).toBe('A')
    expect(Number(el('synth.filter.freq').getAttribute('aria-valuenow'))).toBe(6)
  })

  it('piano layers keep their Phase 2 routing and every layer of every engine reaches the master limiter through its own path', async () => {
    mounted = await mountApp()
    const { engine } = mounted.services
    const procs = await startAudio(mounted)
    const ctx = mounted.world.ctx
    click('organ.on')
    click('synth.on')
    click('piano.layer-b.on')
    fireEvent.keyDown(el('piano.layer-b.level'), { key: 'End' })
    expect(ctx.gains()[4].gain.events.at(-1)).toMatchObject({ type: 'target', value: faderToGain(100) })
    play(mounted, 60)
    const voices = engine.activeVoices()
    expect(voices.map((v) => v.layer).sort()).toEqual(['A', 'B'])
    for (const source of ctx.sources()) expect(ctx.pathsToDestination(source)[0].join(' > ')).toBe('source > gain > gain > layer > gain > gain > master > destination')
    expect(ctx.pathsToDestination(procs.organ)[0].join(' > ')).toBe('organ > layer > gain > gain > master > destination')
    expect(ctx.pathsToDestination(procs.synth.A)[0].join(' > ')).toBe('synth > layer > gain > gain > master > destination')
    expect(ctx.liveNodes().filter((n) => n.connections.includes(ctx.destination))).toEqual([procs.master])
    release(mounted, 60)
    // routing to the shared rotary: ORGAN button for the organ, To Rotary for a synth layer
    click('performance.rotary.organ')
    expect(ctx.pathsToDestination(procs.organ)[0].join(' > ')).toBe('organ > layer > gain > rotary > gain > master > destination')
    expect(document.querySelector('.led-rotary-on .led')?.className).toContain('lit')
    click('effects.focus.synth')
    click('effects.amp.on')
    const model = el('effects.amp.model')
    while (Number(model.dataset.value) !== 4) fireEvent.click(model)
    expect(ctx.pathsToDestination(procs.synth.A)[0].join(' > ')).toBe('synth > layer > gain > rotary > gain > master > destination')
    expect(ctx.pathsToDestination(procs.synth.B)[0].join(' > ')).toBe('synth > layer > gain > gain > master > destination')
    click('performance.rotary.organ')
    expect(ctx.pathsToDestination(procs.organ)[0].join(' > ')).toBe('organ > layer > gain > gain > master > destination')
  })

  it('turning a section off silences its layers (section gain 0, held notes forgotten) and turning it on restores the levels', async () => {
    mounted = await mountApp()
    const { engine } = mounted.services
    const procs = await startAudio(mounted)
    const ctx = mounted.world.ctx
    click('synth.on')
    play(mounted, 60)
    expect(procs.synth.A.heldNotes()).toEqual([60])
    click('synth.on')
    expect(ctx.gains()[6].gain.events.at(-1)).toMatchObject({ type: 'target', value: 0 })
    expect(engine.sourceNotes().synth.A).toEqual([])
    expect(procs.synth.A.params).toMatchObject({ on: false })
    release(mounted, 60)
    click('synth.on')
    expect(ctx.gains()[6].gain.events.at(-1)).toMatchObject({ type: 'target', value: 1 })
    expect(procs.synth.A.params).toMatchObject({ on: true })
  })
})
