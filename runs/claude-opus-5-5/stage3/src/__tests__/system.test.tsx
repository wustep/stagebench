// Phase 3 system behaviour through the whole app: layer routing for every layer of every engine,
// splits/zones/crossfades from the panel, morphs, Layer Scenes, Master Clock, Transpose, Panic,
// one AudioContext and master path, cleanup, and the control-binding audit.
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { UNSUPPORTED } from '../model/bindings/audit'
import { PANEL } from '../model/panel'
import { FUNCTIONAL, isFunctional } from '../model/panelBindings'
import { SLOTS } from '../model/sound'
import { SPLIT_LEDS } from '../system/controller'
import { makeTestRuntime, type TestRuntime } from '../testing/fakes'
import { rms } from '../testing/simAudio'
import { centroid } from '../testing/spectrum'
import { click, controllerOf, el, exit, flashing, key, keybed, lit, mountApp, strike, turn, value, withShift } from '../testing/ui'

afterEach(cleanup)

const SR = 16000
const oled = () => el('program-oled').textContent ?? ''
const perSlot = (runtime: TestRuntime) => runtime.handles!.engine.snapshot().perSlot

/** Hold keys, render, release. */
function hold(runtime: TestRuntime, notes: number[], seconds = 0.2): Float32Array {
  notes.forEach((n, i) => fireEvent.pointerDown(key(n), { pointerId: 10 + i, pointerType: 'touch', button: 0 }))
  const out = runtime.contexts[0].render(seconds)
  notes.forEach((_, i) => fireEvent.pointerUp(keybed(), { pointerId: 10 + i }))
  return out
}

describe('layers.routing — enable, focus, level, octave, effect target for every layer of every engine', () => {
  it('each section/layer button enables and focuses its layer; effects focus follows to the right chain', async () => {
    const { runtime } = await mountApp()
    const c = () => controllerOf(runtime).sound
    click('organ-on')
    click('organ-layer-b') // off → on + focus
    expect(c().organ.layers.B.enabled).toBe(true)
    expect(c().organ.focus).toBe('B')
    expect(c().fx.focus).toBe('organ')
    expect(lit('organ-led-fx-focus')).toBe(true)
    expect(el('effects-focus-organ')).toHaveAttribute('aria-pressed', 'true')
    click('synth-on')
    click('synth-layer-c')
    expect(c().synth.focus).toBe('C')
    expect(c().fx.focus).toBe('synthC')
    expect(lit('effects-led-focus-synth-c')).toBe(true)
    expect(lit('organ-led-fx-focus')).toBe(false)
    // An effect edit reaches only the focused chain.
    click('effects-reverb-on')
    expect(c().fx.chains.synthC.reverb.on).toBe(true)
    expect(c().fx.chains.synthA.reverb.on).toBe(false)
    expect(c().fx.chains.organ.reverb.on).toBe(false)
    // Manual focus buttons: piano, then synth (entering at the focused synth layer, then cycling).
    click('effects-focus-piano')
    expect(c().fx.focus).toBe('A')
    click('effects-focus-synth')
    expect(c().fx.focus).toBe('synthC')
    click('effects-focus-synth')
    expect(c().fx.focus).toBe('synthA')
    click('effects-focus-organ')
    expect(c().fx.focus).toBe('organ')
    withShift(() => click('effects-focus-synth'))
    expect(c().fx.synthGroup).toBe(true)
    expect(lit('effects-led-focus-synth-a') && lit('effects-led-focus-synth-b') && lit('effects-led-focus-synth-c')).toBe(true)
  })

  it('every one of the seven layers plays through its own voices; level and octave act per layer', async () => {
    const { runtime } = await mountApp()
    const ctl = controllerOf(runtime)
    click('organ-on')
    click('organ-layer-b')
    click('synth-on')
    click('synth-layer-b')
    click('synth-layer-c')
    click('piano-layer-b')
    fireEvent.pointerDown(key(60), { pointerId: 1, pointerType: 'mouse', button: 0 })
    runtime.contexts[0].render(0.05)
    expect(perSlot(runtime)).toEqual({ organA: 1, organB: 1, A: 1, B: 1, synthA: 1, synthB: 1, synthC: 1 })
    fireEvent.pointerUp(keybed(), { pointerId: 1 })
    runtime.contexts[0].render(0.6)
    // Octave: organ layer B up an octave plays key 60 as 72.
    click('organ-layer-b') // focus stays on B (already focused → turns off); turn back on
    click('organ-layer-b')
    click('organ-octave-up')
    expect(ctl.sound.organ.layers.B.octave).toBe(1)
    expect(runtime.handles!.engine.routeFor(60).find((r) => r.slot === 'organB')!.note).toBe(72)
    expect(runtime.handles!.engine.routeFor(60).find((r) => r.slot === 'organA')!.note).toBe(60)
    // Level: every level fader moves its layer's gain in state.
    for (const id of ['organ-level-a', 'organ-level-b', 'piano-level-a', 'piano-level-b', 'synth-level-a', 'synth-level-b', 'synth-level-c']) {
      fireEvent.keyDown(el(id), { key: 'Home' })
      expect(value(id)).toBe(0)
    }
    expect(SLOTS.every((s) => (s.length === 1 ? ctl.sound.piano.layers[s as 'A'].level : s.startsWith('organ') ? ctl.sound.organ.layers[s.slice(-1) as 'A'].level : ctl.sound.synth.layers[s.slice(-1) as 'A'].level) === 0)).toBe(true)
    runtime.contexts[0].render(0.05) // the 20 ms click-free level ramps finish
    const silent = strike(runtime, 60, 0.2, 0.05)
    expect(rms(silent)).toBeLessThan(1e-4)
  })
})

describe('splits.zones — editable split points, zones and crossfades from the panel, routed in audio', () => {
  it('Split on/Set: points and crossfades edited with dial and page buttons; LEDs show active points', async () => {
    const { runtime } = await mountApp()
    const split = () => controllerOf(runtime).sound.split
    click('program-split')
    expect(split().on).toBe(true)
    expect(lit('program-led-split-mid')).toBe(true)
    expect(lit(SPLIT_LEDS[4])).toBe(true) // C4
    withShift(() => click('program-split'))
    expect(oled()).toContain('SPLIT')
    expect(flashing('program-led-split-mid')).toBe(true)
    turn('program-dial', 2) // Mid: C4 → C5
    expect(split().points[1].pos).toBe(6)
    expect(lit(SPLIT_LEDS[6])).toBe(true)
    expect(lit(SPLIT_LEDS[4])).toBe(false)
    click('program-page-right') // Mid crossfade
    turn('program-dial', 1)
    expect(split().points[1].xfade).toBe(6)
    turn('program-dial', 1)
    expect(split().points[1].xfade).toBe(12)
    click('program-page-left')
    click('program-page-left')
    click('program-page-left') // Low note
    turn('program-dial', 3) // Off → C2 → F2 → C3
    expect(split().points[0].pos).toBe(2)
    expect(lit('program-led-split-low')).toBe(true)
    expect(oled()).toContain('Low C3')
    click('program-split') // done
    expect(oled()).not.toContain('SPLIT')
    click('program-split') // off
    expect(split().on).toBe(false)
    expect(SPLIT_LEDS.some(lit)).toBe(false)
    expect(SPLIT_LEDS).toHaveLength(11)
  })

  it('KB zones (Shift+Octave) route keys to layers; zone LEDs follow; crossfades scale the gain', async () => {
    const { runtime } = await mountApp()
    const engine = () => runtime.handles!.engine
    click('synth-on')
    click('program-split') // Mid at C4
    // Synth A → zones 1–2 (below C4); piano A → zones 3–4.
    withShift(() => click('synth-octave-down')) // [1,4] → [4,4]
    withShift(() => click('synth-octave-down')) // → [3,4]
    withShift(() => click('synth-octave-down')) // → [3,3]
    withShift(() => click('synth-octave-down')) // → [2,4]
    withShift(() => click('synth-octave-down')) // → [2,3]
    withShift(() => click('synth-octave-down')) // → [2,2]
    withShift(() => click('synth-octave-down')) // → [1,4]? step back further
    const z = controllerOf(runtime).sound.synth.layers.A.zone
    expect(z[0]).toBeGreaterThanOrEqual(1)
    // Set exact zones through the same control until the synth covers 1–2 and the piano 3–4.
    const setZone = (btn: string, section: 'synth' | 'piano', target: [number, number]) => {
      for (let i = 0; i < 12; i++) {
        const cur = controllerOf(runtime).sound[section].layers.A.zone
        if (cur[0] === target[0] && cur[1] === target[1]) return
        withShift(() => click(btn))
      }
      throw new Error('zone not reached')
    }
    setZone('synth-octave-up', 'synth', [1, 2])
    expect(lit('synth-led-kb-zone-1') && lit('synth-led-kb-zone-2')).toBe(true)
    expect(lit('synth-led-kb-zone-3')).toBe(false)
    setZone('piano-octave-up', 'piano', [3, 4])
    expect(lit('piano-led-kb-zone-3') && lit('piano-led-kb-zone-4')).toBe(true)
    expect(engine().routeFor(48).map((r) => r.slot)).toEqual(['synthA'])
    expect(engine().routeFor(72).map((r) => r.slot)).toEqual(['A'])
    hold(runtime, [48], 0.05)
    // Crossfade ±12 at C4: C4 reaches both layers at equal-power gains.
    withShift(() => click('program-split'))
    click('program-page-right')
    turn('program-dial', 2)
    exit()
    const route = engine().routeFor(60)
    expect(route.map((r) => r.slot).sort()).toEqual(['A', 'synthA'])
    for (const r of route) expect(r.gain).toBeCloseTo(Math.SQRT1_2, 5)
    expect(engine().routeFor(66).find((r) => r.slot === 'A')!.gain).toBeGreaterThan(engine().routeFor(54).find((r) => r.slot === 'A')?.gain ?? 0)
    // Audibly: at the split point the ±12 crossfade plays the piano at −3 dB versus a hard split.
    click('synth-on') // synth off: listen to the piano alone
    runtime.contexts[0].render(0.6)
    const faded = hold(runtime, [60], 0.25)
    runtime.contexts[0].render(0.8)
    withShift(() => click('program-split'))
    click('program-page-right')
    turn('program-dial', -2) // Mid crossfade back to Off
    exit()
    expect(controllerOf(runtime).sound.split.points[1].xfade).toBe(0)
    const hard = hold(runtime, [60], 0.25)
    const early = (x: Float32Array) => rms(x, 0, Math.round(0.2 * SR))
    expect(early(faded) / early(hard)).toBeCloseTo(Math.SQRT1_2, 1)
  })
})

describe('morph.assignments — Wheel and Control Pedal from the panel, indicators, interpolation, clearing', () => {
  it('assign by latching WHEEL and moving a knob; the wheel then interpolates it audibly; LEDs show it', async () => {
    const { runtime } = await mountApp()
    const ctl = controllerOf(runtime)
    click('program-slot-6') // Super Saw Lead: synth A, wheel already morphs its cutoff
    expect(lit('synth-led-filter-freq')).toBe(true)
    withShift(() => click('program-morph-wheel'))
    expect(lit('synth-led-filter-freq')).toBe(false)
    expect(lit('program-led-morph-wheel')).toBe(false)
    click('program-morph-wheel')
    expect(flashing('program-led-morph-wheel')).toBe(true)
    const base = ctl.sound.synth.layers.A.filter.freq
    fireEvent.keyDown(el('synth-filter-freq'), { key: 'Home' }) // end value: fully closed
    expect(value('synth-filter-freq')).toBe(0) // the knob shows the morph end value while assigning
    fireEvent.keyDown(el('synth-lfo-mod-amt'), { key: 'End' }) // a second destination rising
    expect(flashing('synth-led-filter-freq')).toBe(true)
    click('program-morph-wheel') // leave assign
    expect(value('synth-filter-freq')).toBe(base) // stored value untouched
    expect(lit('synth-led-filter-freq')).toBe(true)
    expect(lit('program-led-morph-wheel')).toBe(true)
    expect(ctl.sound.morph.wheel).toEqual({ 'synth.A.filterFreq': -base, 'synth.A.lfoAmount': 127 - ctl.sound.synth.layers.A.lfo.amount })
    click('effects-on') // no delay/reverb tails between the two measurements
    runtime.contexts[0]?.render(0.05)
    const bright = strike(runtime, 60, 0.3, 0.02)
    fireEvent.keyDown(el('performance-mod-wheel'), { key: 'End' })
    runtime.contexts[0].render(0.3)
    expect(ctl.effective.synth.layers.A.filter.freq).toBe(0)
    expect(ctl.effective.synth.layers.A.lfo.amount).toBe(127)
    const dark = strike(runtime, 60, 0.3, 0.02)
    expect(centroid(dark, SR, 1600, 3200, 64)).toBeLessThan(centroid(bright, SR, 1600, 3200, 64) * 0.7)
    // Half way: linear interpolation.
    fireEvent.change(el('performance-mod-wheel'), {})
    fireEvent.keyDown(el('performance-mod-wheel'), { key: 'Home' })
    for (let i = 0; i < 8; i++) fireEvent.keyDown(el('performance-mod-wheel'), { key: 'PageUp' })
    const w = value('performance-mod-wheel')
    expect(ctl.effective.synth.layers.A.filter.freq).toBeCloseTo(base * (1 - w / 127), 6)
    // Re-hold and return the destination to its start: that single assignment is removed.
    click('program-morph-wheel')
    fireEvent.keyDown(el('synth-lfo-mod-amt'), { key: 'Home' })
    const amount = ctl.sound.synth.layers.A.lfo.amount
    expect(amount % 4).toBe(0) // knob arrow steps are 4: land exactly on the stored value
    for (let i = 0; i < amount / 4; i++) fireEvent.keyDown(el('synth-lfo-mod-amt'), { key: 'ArrowUp' })
    click('program-morph-wheel')
    expect(Object.keys(ctl.sound.morph.wheel)).toEqual(['synth.A.filterFreq'])
  })

  it('level faders and drawbars show the morph range on their LED graphs; the Control Pedal (UI and CC11) drives pedal morphs', async () => {
    const { runtime } = await mountApp()
    const ctl = controllerOf(runtime)
    click('program-slot-2') // B3 organ
    click('program-morph-ctrlped')
    fireEvent.keyDown(el('organ-level-a'), { key: 'Home' })
    fireEvent.keyDown(el('organ-drawbar-9'), { key: 'End' })
    click('program-morph-ctrlped')
    expect(el('organ-level-a-ladder').getAttribute('data-morph')).toMatch(/^0-\d+$/)
    expect(el('organ-drawbar-9-graph')).toHaveAttribute('data-morph', '0-8')
    expect(lit('program-led-morph-ctrlped')).toBe(true)
    fireEvent.change(screen.getByTestId('control-pedal'), { target: { value: '127' } })
    expect(ctl.effective.organ.layers.A.level).toBe(0)
    expect(ctl.effective.organ.layers.A.drawbars[8]).toBe(8)
    fireEvent.change(screen.getByTestId('control-pedal'), { target: { value: '0' } })
    expect(ctl.effective.organ.layers.A.level).toBe(ctl.sound.organ.layers.A.level)
    // MIDI CC11 is the same Control Pedal source; CC1 is the wheel.
    const { FakeMidiInput } = await import('../testing/fakes')
    click('program-transpose') // (no effect on morphs; exercise a mode change first)
    exit()
    fireEvent.click(screen.getByRole('button', { name: /Enable MIDI input/ }))
    await screen.findByText(/MIDI enabled/)
    const input = new FakeMidiInput('m1', 'Keys')
    runtime.midiAccess.add(input)
    act(() => input.send([0xb0, 11, 127]))
    expect(ctl.pedal).toBe(127)
    expect(ctl.effective.organ.layers.A.drawbars[8]).toBe(8)
    act(() => input.send([0xb0, 1, 100]))
    expect(ctl.wheel).toBe(100)
    expect(value('performance-mod-wheel')).toBe(100)
    withShift(() => click('program-morph-ctrlped'))
    expect(ctl.sound.morph.pedal).toEqual({})
    expect(el('organ-drawbar-9-graph').getAttribute('data-morph')).toBeNull()
  })
})

describe('scenes.switching — Layer Scene I/II from the panel', () => {
  it('Scene II keeps its own layer enables; sound edits are shared; the LED shows Scene II', async () => {
    const { runtime } = await mountApp()
    const ctl = controllerOf(runtime)
    click('program-layer-scene')
    expect(lit('program-led-layer-scene')).toBe(true)
    click('piano-layer-b') // enable B in scene II
    click('piano-type') // a sound edit (shared)
    expect(ctl.sound.piano.layers.B.enabled).toBe(true)
    click('program-layer-scene') // back to I
    expect(lit('program-led-layer-scene')).toBe(false)
    expect(ctl.sound.piano.layers.B.enabled).toBe(false)
    expect(ctl.sound.piano.layers.B.type).not.toBe('electric') // the type edit made in II is shared
    fireEvent.pointerDown(key(60), { pointerId: 1, pointerType: 'mouse', button: 0 })
    runtime.contexts[0].render(0.05)
    expect(perSlot(runtime)).toMatchObject({ A: 1, B: 0 })
    fireEvent.pointerUp(keybed(), { pointerId: 1 })
    click('program-layer-scene')
    fireEvent.pointerDown(key(62), { pointerId: 1, pointerType: 'mouse', button: 0 })
    runtime.contexts[0].render(0.05)
    expect(perSlot(runtime).B).toBe(1)
    fireEvent.pointerUp(keybed(), { pointerId: 1 })
    // The factory "EP + Pad Scenes" program: Scene II drops the pad.
    click('program-slot-8')
    expect(ctl.sound.synth.layers.A.enabled).toBe(true)
    click('program-layer-scene')
    expect(ctl.sound.synth.layers.A.enabled).toBe(false)
    expect(ctl.sound.piano.layers.A.enabled).toBe(true)
  })
})

describe('system.integration — all engines share programs, clock, transpose, one context, one master path, Panic', () => {
  it('organ, piano and synth all sound through ONE AudioContext and the master level silences all of them', async () => {
    const { runtime } = await mountApp()
    click('organ-on')
    click('synth-on')
    const all = hold(runtime, [60, 64], 0.2)
    expect(rms(all)).toBeGreaterThan(0.01)
    expect(runtime.contexts).toHaveLength(1)
    expect(perSlot(runtime)).toMatchObject({ organA: 2, A: 2, synthA: 2 })
    runtime.contexts[0].render(1)
    fireEvent.keyDown(el('performance-master-level'), { key: 'Home' })
    runtime.contexts[0].render(0.1)
    const silent = hold(runtime, [60], 0.2)
    expect(silent.every((x) => x === 0)).toBe(true)
  })

  it('Master Clock: four taps set the tempo; the dial sets it; synced delay, LFO and arp follow', async () => {
    const { runtime } = await mountApp()
    const ctl = controllerOf(runtime)
    click('program-slot-6') // Super Saw Lead: delay synced to the clock
    for (let i = 0; i < 4; i++) click('program-master-clock') // the fake clock advances 500 ms per call
    expect(ctl.sound.clock.bpm).toBe(120)
    expect(oled()).toContain('120 BPM')
    turn('program-dial', 10)
    expect(ctl.sound.clock.bpm).toBe(130)
    exit()
    strike(runtime, 60, 0.05, 0.05) // first key: the AudioContext starts
    const delay = runtime.handles!.stage.chain('synthA')!.units.delay as unknown as { line: { delayTime: { valueAt(t: number): number } } }
    const t = runtime.contexts[0].currentTime + 1
    expect(delay.line.delayTime.valueAt(t)).toBeCloseTo((60 / 130) * 4 * (1 / 8), 3)
    // Arpeggiator steps follow the clock (factory 1.9 Arp Pluck 110: synced arp running).
    click('program-page-right')
    click('program-slot-1')
    expect(ctl.sound.clock.bpm).toBe(110)
    fireEvent.pointerDown(key(60), { pointerId: 1, pointerType: 'mouse', button: 0 })
    for (let i = 0; i < 80; i++) {
      runtime.tickTimers()
      runtime.contexts[0].render(0.005)
    }
    fireEvent.pointerUp(keybed(), { pointerId: 1 })
    const synthA = runtime.handles!.engine.engines.synthA as unknown as { arp: { events: { time: number }[] } }
    const ev = synthA.arp.events
    expect(ev.length).toBeGreaterThan(2)
    const step = ev[1].time - ev[0].time
    expect(step).toBeCloseTo((60 / 110) * 4 * (1 / 12), 6)
  })

  it('Transpose ±6 shifts every engine; Panic (Shift+Transpose) stops every voice and resets held inputs', async () => {
    const { runtime } = await mountApp()
    const ctl = controllerOf(runtime)
    click('organ-on')
    click('synth-on')
    click('program-transpose')
    turn('program-dial', 9)
    expect(ctl.sound.transpose).toEqual({ on: true, semitones: 6 })
    expect(lit('program-led-transpose')).toBe(true)
    exit()
    expect(runtime.handles!.engine.routeFor(60).map((r) => r.note)).toEqual([66, 66, 66])
    // Hold notes, sustain, KB Hold and a bent pitch stick, then Panic.
    click('synth-kb-hold')
    fireEvent.click(screen.getByRole('button', { name: /Sustain pedal up/ }))
    fireEvent.keyDown(el('performance-pitch-stick'), { key: 'ArrowRight' })
    fireEvent.pointerDown(key(60), { pointerId: 1, pointerType: 'mouse', button: 0 })
    runtime.contexts[0].render(0.1)
    fireEvent.pointerUp(keybed(), { pointerId: 1 })
    runtime.contexts[0].render(0.1)
    expect(runtime.handles!.engine.snapshot().voices.length).toBeGreaterThan(0)
    withShift(() => click('program-transpose'))
    expect(oled()).toContain('PANIC')
    expect(screen.getByRole('button', { name: /Sustain pedal up/ })).toBeInTheDocument()
    expect(ctl.sound.pitchStick).toBe(0)
    runtime.contexts[0].render(0.3)
    expect(runtime.handles!.engine.snapshot().voices).toHaveLength(0)
    expect(runtime.handles!.stage.liveVoiceCount).toBe(0)
    // The UI Panic chip is the same function.
    fireEvent.pointerDown(key(62), { pointerId: 1, pointerType: 'mouse', button: 0 })
    runtime.contexts[0].render(0.05)
    fireEvent.click(screen.getByTestId('panic'))
    runtime.contexts[0].render(0.3)
    expect(runtime.handles!.stage.liveVoiceCount).toBe(0)
  })

  it('Solo plays only the focused section; unmount frees timers, listeners and the context', async () => {
    const runtime = makeTestRuntime()
    const { unmount } = await mountApp(runtime)
    const listenersBefore = runtime.window.listenerCount
    click('synth-on') // the synth section is now the one being edited
    click('program-solo')
    expect(lit('program-led-solo')).toBe(true)
    fireEvent.pointerDown(key(60), { pointerId: 1, pointerType: 'mouse', button: 0 })
    runtime.contexts[0].render(0.05)
    expect(perSlot(runtime)).toMatchObject({ A: 0, synthA: 1 })
    fireEvent.pointerUp(keybed(), { pointerId: 1 })
    click('program-solo')
    expect(runtime.timers.size).toBe(1)
    expect(listenersBefore).toBeGreaterThan(0)
    unmount()
    expect(runtime.timers.size).toBe(0)
    expect(runtime.window.listenerCount).toBe(0)
    expect(runtime.doc.listenerCount).toBe(0)
    expect(runtime.contexts[0].state).toBe('closed')
    expect(runtime.handles).toBeNull()
  })
})

describe('hardware.bindings — the Synth OLED pages and their three dials', () => {
  it('page buttons open pages; the dials edit that page; envelopes draw a curve; the arp page shows the rate', async () => {
    const { runtime } = await mountApp()
    const l = () => controllerOf(runtime).sound.synth.layers.A
    const synthOled = () => el('synth-oled').textContent ?? ''
    expect(synthOled()).toContain('WAVEFORM')
    turn('synth-list-1', 3) // Saw → Pulse 10
    expect(l().wave).toBe(5)
    expect(synthOled()).toContain('Pulse 10')
    turn('synth-info', 1) // next category: Sync
    expect(synthOled()).toContain('Sync Saw')
    click('synth-amp-envelope')
    expect(synthOled()).toContain('AMP ENV')
    expect(screen.getByTestId('synth-oled-curve')).toBeInTheDocument()
    turn('synth-info', 5)
    expect(l().ampEnv.attack).toBe(10)
    expect(el('synth-info').getAttribute('aria-valuetext')).toBe('Attack: 10')
    withShift(() => click('synth-amp-envelope'))
    expect(l().ampEnv.velocity).toBe(2)
    expect(lit('synth-led-amp-velocity-2')).toBe(true)
    click('synth-osc-pitch')
    turn('synth-info', -3)
    turn('synth-list-1', 7)
    expect(l().pitch).toEqual({ coarse: -3, fine: 7 })
    expect(screen.queryByTestId('synth-oled-curve')).toBeNull()
    click('synth-filter-type') // LP24 → HP, opens the filter page
    expect(l().filter.type).toBe('HP')
    turn('synth-list-2', 2)
    expect(l().filter.drive).toBe(2)
    click('synth-arp-menu')
    turn('synth-info', 2)
    expect(l().arp.direction).toBe('upDown')
    expect(synthOled()).toMatch(/ARP off \d+ BPM/)
    turn('synth-list-1', 1)
    expect(synthOled()).toMatch(/ARP off 1\/\d+T? @ 120 BPM/)
    click('synth-vibrato-menu')
    turn('synth-list-2', -4)
    expect(l().vibrato.amount).toBe(32)
    withShift(() => click('synth-sound-init'))
    expect(l().wave).toBe(2)
    expect(l().level).toBe(118)
  })
})

describe('hardware.bindings — every control is bound or listed as unsupported', () => {
  it('FUNCTIONAL and UNSUPPORTED partition the panel; the UI notes list every unsupported control', async () => {
    await mountApp()
    for (const c of PANEL.controls) {
      const f = isFunctional(c.id)
      const u = c.id in UNSUPPORTED
      expect(f !== u, c.id).toBe(true)
    }
    for (const id of Object.keys(FUNCTIONAL)) expect(PANEL.controls.some((c) => c.id === id), id).toBe(true)
    const notes = screen.getByTestId('unsupported-notes')
    for (const id of Object.keys(UNSUPPORTED)) expect(notes.querySelector(`[data-control="${id}"]`), id).not.toBeNull()
    for (const id of Object.keys(UNSUPPORTED)) expect(el(id).getAttribute('aria-description')).toMatch(/^Unsupported \(/)
  })

  it('operating every functional control changes canonical state, a performance input or the program UI', async () => {
    const { runtime } = await mountApp()
    const ctl = controllerOf(runtime)
    const fingerprint = () =>
      JSON.stringify({ s: ctl.sound, l: ctl.location, m: ctl.mode, mo: ctl.morph, p: ctl.synthPage, so: ctl.solo, w: ctl.wheel, pe: ctl.pedal, n: ctl.name })
    // A multi-model piano type, so the model dial has something to select.
    while (el('piano-type').getAttribute('data-state') !== 'ELECTRIC') click('piano-type')
    const modifiers = new Set(['effects-shift', 'program-shift'])
    for (const c of PANEL.controls) {
      if (!isFunctional(c.id) || modifiers.has(c.id)) continue
      const slot = /^program-slot-(\d)$/.exec(c.id)
      const before = fingerprint()
      const node = el(c.id)
      if (c.kind === 'button') {
        fireEvent.click(node)
        if (fingerprint() === before) fireEvent.click(node)
      } else if (c.kind === 'encoder') {
        fireEvent.keyDown(node, { key: 'ArrowUp' })
      } else {
        fireEvent.keyDown(node, { key: 'End' })
        if (fingerprint() === before) fireEvent.keyDown(node, { key: 'Home' })
      }
      if (slot) expect(ctl.location.index % 8, c.id).toBe(Number(slot[1]) - 1)
      else expect(fingerprint() !== before, c.id).toBe(true)
      fireEvent.keyUp(node, { key: 'End' })
      exit()
    }
    // The Shift rockers are modifiers: Shift + a function does what plain press does not.
    const plain = ctl.sound.fx.global.delay
    withShift(() => click('effects-delay-on'), 'effects-shift')
    expect(ctl.sound.fx.global.delay).toBe(!plain)
  })
})
