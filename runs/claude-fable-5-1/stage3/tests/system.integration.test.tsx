import { fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeProcessorNode } from '../src/audio/fakeAudio'
import { ARP_SUBDIVISIONS, LFO_SUBDIVISIONS, subdivisionFromKnob, subdivisionSeconds } from '../src/dsp/synthTypes'
import { DELAY_SUBDIVISIONS } from '../src/state/instrumentState'
import { armShift, click, el, hold, lastEvent, mountApp, play, release, setSlider, startAudio, turnDial, type Mounted } from './helpers'

let mounted: Mounted | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

function tapClock(m: Mounted, times: number, intervalMs: number) {
  for (let i = 0; i < times; i++) {
    fireEvent.pointerDown(el('program.master-clock'), { pointerId: 4, button: 0 })
    fireEvent.pointerUp(el('program.master-clock'), { pointerId: 4 })
    m.world.timers.advance(intervalMs)
  }
}

describe('system.integration — all engines share programs, scenes, zones, morphs, clock, effects, one AudioContext, one master path, and Panic', () => {
  it('one AudioContext hosts every engine: factory programs bring piano, organ and synth sounds up on the same graph', async () => {
    mounted = await mountApp()
    const { state, engine } = mounted.services
    const procs = await startAudio(mounted)
    const ctx = mounted.world.ctx
    expect(mounted.world.contexts).toHaveLength(1)
    // 1.3 B3 Soulful: organ (rotary), 1.7 Super Saw Pad: synth, 2.1 Bass / EP Split: synth + piano B split
    click('program.button.3')
    expect(state.get().organ.on).toBe(true)
    expect((procs.organ.params as { layers: { A: { model: number } } }).layers.A.model).toBe(0)
    expect(ctx.pathsToDestination(procs.organ)[0]).toContain('rotary')
    play(mounted, 55)
    expect(procs.organ.heldNotes('A')).toEqual([55])
    expect(engine.activeVoices()).toHaveLength(0) // piano off in this program
    release(mounted, 55)
    click('program.button.7')
    expect(state.get().synth.on).toBe(true)
    expect(procs.synth.A.params).toMatchObject({ on: true, wave: { category: 3, index: 0 }, unison: 2 })
    play(mounted, 60)
    expect(procs.synth.A.heldNotes()).toEqual([60])
    expect(procs.organ.heldNotes('A')).toEqual([])
    release(mounted, 60)
    fireEvent.pointerDown(el('program.page-next'), { pointerId: 1, button: 0 })
    fireEvent.pointerUp(el('program.page-next'), { pointerId: 1 })
    click('program.button.1')
    expect(state.get().name).toBe('Bass / EP Split')
    play(mounted, 48)
    play(mounted, 72)
    expect(procs.synth.A.heldNotes()).toEqual([48])
    expect(engine.activeVoices().map((v) => [v.layer, v.midi])).toEqual([['B', 72]])
    release(mounted, 48)
    release(mounted, 72)
    expect(mounted.world.contexts).toHaveLength(1)
    expect(ctx.liveNodes().filter((n) => n.connections.includes(ctx.destination))).toEqual([procs.master])
    for (const p of ctx.processors()) if (p.kind !== 'master') expect(ctx.pathsToDestination(p)[0].at(-2)).toBe('master')
  })

  it('Master Clock: tap ×4 and hold + dial set the tempo; synced Delay, Mod 1, LFO and arpeggiator follow it; KB Sync resets the clock', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    const procs = await startAudio(mounted)
    click('synth.on')
    tapClock(mounted, 4, 500)
    expect(state.get().clock.bpm).toBe(120)
    mounted.world.timers.advance(3500) // taps older than the 3 s window are forgotten; a new series starts
    tapClock(mounted, 4, 400)
    expect(state.get().clock.bpm).toBe(150)
    expect(el('program.oled').textContent).toMatch(/150 BPM/)
    // Shift + turning the Tempo / Rate knobs clockwise syncs them; the DSP receives clock-derived values
    armShift('effects.shift')
    fireEvent.keyDown(el('effects.delay.tempo'), { key: 'ArrowUp' })
    expect(state.get().effects.chains.pianoA.delay.sync).toBe(true)
    expect(Number(el('effects.delay.tempo').getAttribute('aria-valuenow'))).toBe(5) // the knob itself did not move
    expect((procs.A.params.delay as { seconds: number }).seconds).toBeCloseTo(subdivisionSeconds(subdivisionFromKnob(DELAY_SUBDIVISIONS, 5), 150), 6)
    armShift('effects.shift')
    fireEvent.keyDown(el('effects.mod1.rate'), { key: 'ArrowUp' })
    expect((procs.A.params.mod1 as { rateHz: number }).rateHz).toBeCloseTo(1 / subdivisionSeconds(subdivisionFromKnob(LFO_SUBDIVISIONS, 4), 150), 6)
    armShift()
    fireEvent.keyDown(el('synth.arp.rate'), { key: 'ArrowUp' })
    armShift()
    fireEvent.keyDown(el('synth.lfo.rate'), { key: 'ArrowUp' })
    expect(procs.synth.A.params).toMatchObject({ bpm: 150, arp: { sync: true }, lfo: { sync: true } })
    expect(document.querySelectorAll('#section-synth .lgd-red.is-on-text')).toHaveLength(2)
    expect(document.querySelectorAll('#section-effects .lgd-red.is-on-text')).toHaveLength(2)
    // hold + dial: the tempo page; every synced unit follows the new tempo
    hold(mounted, 'program.master-clock')
    expect(state.get().view.mode).toBe('clock')
    turnDial('program.dial', -30)
    expect(state.get().clock.bpm).toBe(120)
    expect((procs.A.params.delay as { seconds: number }).seconds).toBeCloseTo(subdivisionSeconds(subdivisionFromKnob(DELAY_SUBDIVISIONS, 5), 120), 6)
    expect(procs.synth.A.params).toMatchObject({ bpm: 120 })
    expect(el('program.oled').textContent).toMatch(/MASTER CLOCK 120 BPM/)
    // KBS soft button: the first key after all keys were lifted resets the synced units
    click('program.button.1')
    expect(state.get().clock.kbSync).toBe(true)
    click('program.shift')
    const resets = () => procs.synth.A.events.filter((e) => (e as { type: string }).type === 'clockReset').length
    const before = resets()
    play(mounted, 60)
    expect(resets()).toBe(before + 1)
    play(mounted, 64)
    expect(resets()).toBe(before + 1) // a second key while one is held does not reset
    release(mounted, 60)
    release(mounted, 64)
    // Shift + counter-clockwise turns sync off again
    armShift('effects.shift')
    fireEvent.keyDown(el('effects.delay.tempo'), { key: 'ArrowDown' })
    expect(state.get().effects.chains.pianoA.delay.sync).toBe(false)
    expect(subdivisionFromKnob(ARP_SUBDIVISIONS, 10).label).toBe('1/16T')
  })

  it('Transpose ±6 shifts every engine; Panic (Shift + Transpose) silences everything and resets the held inputs', async () => {
    mounted = await mountApp()
    const { state, engine, bus } = mounted.services
    const procs = await startAudio(mounted)
    click('organ.on')
    click('synth.on')
    hold(mounted, 'program.transpose')
    turnDial('program.dial', 8)
    expect(state.get().transpose).toEqual({ on: true, semitones: 6 }) // clamped at +6
    turnDial('program.dial', -4)
    expect(state.get().transpose.semitones).toBe(2)
    click('program.shift')
    expect(el('program.transpose').getAttribute('aria-pressed')).toBe('true')
    play(mounted, 60)
    expect(engine.activeVoices().map((v) => v.playedMidi)).toEqual([62])
    expect(procs.organ.heldNotes('A')).toEqual([62])
    expect(procs.synth.A.heldNotes()).toEqual([62])
    // transpose off while the key is held: the release still stops the transposed note everywhere
    click('program.transpose')
    expect(state.get().transpose.on).toBe(false)
    release(mounted, 60)
    expect(procs.organ.heldNotes('A')).toEqual([])
    expect(procs.synth.A.heldNotes()).toEqual([])
    expect(engine.activeVoices().every((v) => v.releasing)).toBe(true)
    // PANIC
    bus.setSustain('ui', true)
    setSlider('performance.mod-wheel', 1)
    play(mounted, 64)
    play(mounted, 67)
    expect(bus.heldNotes()).toEqual([64, 67])
    armShift()
    click('program.transpose')
    expect(state.get().transpose.on).toBe(false) // Shift + Transpose is Panic, not a toggle
    expect(bus.heldNotes()).toEqual([])
    expect(bus.isSustain()).toBe(false)
    expect(lastEvent(procs.organ, 'allOff')).toBeTruthy()
    expect(lastEvent(procs.synth.A, 'allOff')).toBeTruthy()
    expect(engine.activeVoices().every((v) => v.releasing)).toBe(true)
    expect(state.get().morphSources).toEqual({ wheel: 0, pedal: 0 })
    expect(Number(el('performance.mod-wheel').getAttribute('aria-valuenow'))).toBe(0)
    expect(el('program.oled').textContent).toMatch(/PANIC/)
    // the on-screen Panic button does the same
    play(mounted, 60)
    fireEvent.click(el('panic'))
    expect(bus.heldNotes()).toEqual([])
  })

  it('the mod wheel and pitch stick reach every engine (Wheel vibrato, PSTICK bends); unmount disposes all twelve processors', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    const procs = await startAudio(mounted)
    const ctx = mounted.world.ctx
    click('synth.on')
    setSlider('performance.mod-wheel', 0.6)
    expect(procs.synth.A.params).toMatchObject({ wheel: 0.6 })
    setSlider('performance.pitch-stick', 1)
    expect((procs.organ.params as { pitchBend: number }).pitchBend).toBe(1)
    expect(procs.synth.A.params).toMatchObject({ pitchBend: 1 })
    expect(state.get().synth.layers.A.pstick).toBe(true)
    armShift()
    click('synth.layer-b.on') // Shift + Layer B = PSTICK of the focused synth layer
    expect(state.get().synth.layers.A.pstick).toBe(false)
    expect(procs.synth.A.params).toMatchObject({ pstick: false })
    expect(ctx.processors()).toHaveLength(12)
    mounted.unmount()
    mounted = null
    expect(ctx.processors().every((p) => p.disposed)).toBe(true)
    expect(ctx.liveNodes()).toEqual([])
    expect(ctx.nodes.filter((n) => n instanceof FakeProcessorNode)).toHaveLength(12)
  })
})
