import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  fakeAssetBoundary,
  fakeAudioBoundary,
  FakeCompressor,
  FakeDelayNode,
  FakeFilter,
  FakeGain,
  FakeNode,
  FakeStereoPanner,
  fakeStorageBoundary,
} from '../test/fakes'
import { renderApp } from '../test/renderApp'
import { InstrumentStore } from '../state/instrument'
import { PianoEngine } from './engine'

/**
 * effects.routing — focus/targeting, Piano group behavior, global units,
 * on/bypass, all-bypass, dry/wet, the documented order, the Delay feedback
 * path and To Rotary routing all alter real state and real graph parameters.
 */
function makeSystem() {
  const setup = fakeAudioBoundary()
  const store = new InstrumentStore()
  const engine = new PianoEngine(setup.boundary, { assets: fakeAssetBoundary() })
  engine.attachStore(store)
  engine.ensureStarted()
  return { ...setup, store, engine }
}

function dryGainOf(unit: { input: unknown }): FakeGain {
  // Shell wiring: input -> [dry, wetIn]; dry is the first connection.
  return (unit.input as FakeNode).connections[0] as FakeGain
}

describe('effects.routing', () => {
  it('effect edits target the focused piano layer only (independent chains)', () => {
    const { store } = makeSystem()
    store.updateUnit('mod1', { rate: 100 })
    expect(store.getState().chains.A.mod1.rate).toBe(100)
    expect(store.getState().chains.B.mod1.rate).toBe(64)
    store.setFocusedLayer('B')
    store.updateUnit('mod1', { rate: 20 })
    expect(store.getState().chains.A.mod1.rate).toBe(100)
    expect(store.getState().chains.B.mod1.rate).toBe(20)
  })

  it('Group mode copies the focused chain to the group and edits both layers', () => {
    const { store } = makeSystem()
    store.updateUnit('delay', { feedback: 100 })
    store.toggleFxGroupPiano()
    expect(store.getState().chains.B.delay.feedback).toBe(100) // copied on entry
    store.updateUnit('delay', { feedback: 30 })
    expect(store.getState().chains.A.delay.feedback).toBe(30)
    expect(store.getState().chains.B.delay.feedback).toBe(30)
    store.toggleFxGroupPiano()
    store.updateUnit('delay', { feedback: 90 })
    expect(store.getState().chains.B.delay.feedback).toBe(30) // independent again
  })

  it('Global mode (Shift+On) mirrors Delay/Comp/Reverb settings across all layers', () => {
    const { store } = makeSystem()
    store.updateUnit('reverb', { mix: 90 })
    store.toggleFxGlobal('reverb')
    expect(store.getState().fxGlobal.reverb).toBe(true)
    expect(store.getState().chains.B.reverb.mix).toBe(90)
    store.updateUnit('reverb', { mix: 20 })
    expect(store.getState().chains.A.reverb.mix).toBe(20)
    expect(store.getState().chains.B.reverb.mix).toBe(20)
  })

  it('unit On engages the wet path with a click-free crossfade; bypass restores dry', () => {
    const { store, engine } = makeSystem()
    const { channels } = engine.diagnostics()
    const dry = dryGainOf(channels!.A.units.reverb)
    expect(dry.gain.value).toBe(1) // bypassed: full dry
    store.toggleUnitOn('reverb')
    expect(dry.gain.value).toBeLessThan(1) // dry/wet crossfade engaged
    const rampEvents = dry.gain.events.filter((e) => e.kind === 'target')
    expect(rampEvents.length).toBeGreaterThan(0)
    store.toggleUnitOn('reverb')
    expect(dry.gain.value).toBe(1)
  })

  it('dry/wet knobs move the actual crossfade of the focused chain', () => {
    const { store, engine } = makeSystem()
    const { channels } = engine.diagnostics()
    store.toggleUnitOn('delay')
    const dry = dryGainOf(channels!.A.units.delay)
    const mid = dry.gain.value
    store.updateUnit('delay', { mix: 127 })
    expect(dry.gain.value).toBeLessThan(mid) // full wet -> dry approaches 0
    store.updateUnit('delay', { mix: 0 })
    expect(dry.gain.value).toBeGreaterThan(mid)
  })

  it('All FX Off bypasses every unit on every chain and restores them after', () => {
    const { store, engine } = makeSystem()
    const { channels } = engine.diagnostics()
    store.toggleUnitOn('reverb')
    store.setFocusedLayer('B')
    store.toggleUnitOn('delay')
    const reverbDryA = dryGainOf(channels!.A.units.reverb)
    const delayDryB = dryGainOf(channels!.B.units.delay)
    expect(reverbDryA.gain.value).toBeLessThan(1)
    expect(delayDryB.gain.value).toBeLessThan(1)
    store.toggleAllFxOff()
    expect(reverbDryA.gain.value).toBe(1)
    expect(delayDryB.gain.value).toBe(1)
    store.toggleAllFxOff()
    expect(reverbDryA.gain.value).toBeLessThan(1)
    expect(delayDryB.gain.value).toBeLessThan(1)
  })

  it('the Delay feedback filter/effect processes REPEATS only, never the dry path', () => {
    const { store, engine, getContext } = makeSystem()
    store.toggleUnitOn('delay')
    store.cycleDelayFilter() // Low Pass
    expect(store.getState().chains.A.delay.filter).toBe('Low Pass')
    const { channels } = engine.diagnostics()
    const input = channels!.A.units.delay.input as FakeNode
    const context = getContext()!
    // Find the delay node fed from this unit's wet path.
    const wetIn = input.connections[1]! // [dry, wetIn]
    const delayNode = wetIn.connections.find((n) => n.kind === 'delay') as FakeDelayNode
    expect(delayNode).toBeTruthy()
    // Feedback loop: the delay reaches itself through the loop filter.
    const loopNodes: FakeNode[] = []
    const stack = [...delayNode.connections]
    const seen = new Set<FakeNode>()
    let loops = false
    while (stack.length) {
      const node = stack.pop()!
      if (node === delayNode) {
        loops = true
        continue
      }
      if (seen.has(node)) continue
      seen.add(node)
      loopNodes.push(node)
      stack.push(...node.connections)
    }
    expect(loops).toBe(true)
    const loopFilter = loopNodes.find((n): n is FakeFilter => n instanceof FakeFilter && n.type === 'lowpass')
    expect(loopFilter).toBeTruthy()
    // The DRY path (input -> dry -> output) contains no filter.
    const dry = input.connections[0]!
    expect(dry.connections.every((n) => n.kind === 'gain')).toBe(true)
    expect(context.nodes.includes(delayNode)).toBe(true)
  })

  it('PING PONG (Shift + Filter) re-gates repeats onto alternating L/R panners (manual p. 51)', () => {
    const { store, engine } = makeSystem()
    store.toggleUnitOn('delay')
    const input = engine.diagnostics().channels!.A.units.delay.input as FakeNode
    const wetIn = input.connections[1]! // shell wiring: [dry, wetIn]
    const delayA = wetIn.connections.find((n) => n.kind === 'delay') as FakeDelayNode
    // Wiring order off the first delay: [centerTap, pingATap, toB, fbFromA].
    const [centerTap, pingATap, toB, fbFromA] = delayA.connections as FakeGain[]
    expect(centerTap!.gain.value).toBe(1) // plain mode: one centered tap
    expect(pingATap!.gain.value).toBeLessThan(0.001)
    store.toggleDelayPingPong()
    expect(store.getState().chains.A.delay.pingPong).toBe(true)
    expect(centerTap!.gain.value).toBeLessThan(0.001)
    expect(pingATap!.gain.value).toBe(1) // tap A now feeds the left panner…
    expect(toB!.gain.value).toBe(1) // …and the series delay B for the right side
    expect(fbFromA!.gain.value).toBeLessThan(0.001) // feedback re-sourced from B
    const panL = pingATap!.connections.find((n) => n.kind === 'panner') as FakeStereoPanner
    expect(panL.pan.value).toBeLessThan(-0.5)
    const delayB = toB!.connections.find((n) => n.kind === 'delay') as FakeDelayNode
    const panR = delayB.connections.find((n) => n.kind === 'panner') as FakeStereoPanner
    expect(panR.pan.value).toBeGreaterThan(0.5)
    store.toggleDelayPingPong()
    expect(centerTap!.gain.value).toBe(1) // back to the centered tap
  })

  it('COMP FAST (the clickable FAST print) shortens the compressor release (manual p. 52)', () => {
    const { store, engine } = makeSystem()
    store.toggleUnitOn('comp')
    const input = engine.diagnostics().channels!.A.units.comp.input as FakeNode
    const wetIn = input.connections[1]!
    const comp = wetIn.connections.find((n): n is FakeCompressor => n instanceof FakeCompressor)!
    expect(comp.release.value).toBeCloseTo(0.3)
    store.toggleCompFast()
    expect(store.getState().chains.A.comp.fast).toBe(true)
    expect(comp.release.value).toBeCloseTo(0.08)
    store.toggleCompFast()
    expect(comp.release.value).toBeCloseTo(0.3)
  })

  it('PED (Shift + Selector) hands the Wah sweep to the control pedal (manual p. 49)', () => {
    const { store, engine } = makeSystem()
    store.updateUnit('mod1', { type: 'Wah', on: true })
    const input = engine.diagnostics().channels!.A.units.mod1.input as FakeNode
    const wetIn = input.connections[1]!
    const filter = wetIn.connections.find((n): n is FakeFilter => n instanceof FakeFilter)!
    expect(filter.frequency.value).toBe(600) // LFO-swept center while PED is off
    store.toggleMod1Ped()
    expect(store.getState().chains.A.mod1.ped).toBe(true)
    expect(filter.frequency.value).toBeCloseTo(250) // pedal at heel
    store.setMorphSource('pedal', 127)
    expect(filter.frequency.value).toBeCloseTo(2500) // pedal at toe
    store.setMorphSource('pedal', 64)
    expect(filter.frequency.value).toBeGreaterThan(700) // mid-sweep, exponential
    expect(filter.frequency.value).toBeLessThan(900)
    store.toggleMod1Ped() // back to the LFO sweep
    expect(filter.frequency.value).toBe(600)
  })

  it('Amp/EQ "To Rotary" routes the layer through the single rotary instance, post-reverb', () => {
    const { store, engine } = makeSystem()
    const { channels } = engine.diagnostics()
    const channel = channels!.A
    const toRotary = channel.toRotary as unknown as FakeGain
    const toMaster = channel.toMaster as unknown as FakeGain
    expect(toRotary.gain.value).toBeLessThan(0.001)
    store.toggleUnitOn('ampEq')
    for (let i = 0; i < 2; i++) store.cycleAmpType() // Neutral -> Small -> To Rotary
    expect(store.getState().chains.A.ampEq.type).toBe('To Rotary')
    expect(toRotary.gain.value).toBeGreaterThan(0.9)
    expect(toMaster.gain.value).toBeLessThan(0.001)
    // Turning the Amp unit off returns the layer to the direct path.
    store.toggleUnitOn('ampEq')
    expect(toRotary.gain.value).toBeLessThan(0.001)
    expect(toMaster.gain.value).toBeGreaterThan(0.9)
  })

  it('Global Reverb relocates post-Rotary: the shared unit takes over, chain reverbs bypass (manual p. 52-53)', () => {
    const { store, engine } = makeSystem()
    const diag = engine.diagnostics()
    store.toggleUnitOn('reverb')
    const chainDry = dryGainOf(diag.channels!.A.units.reverb)
    const globalDry = dryGainOf(diag.globalReverb!)
    expect(chainDry.gain.value).toBeLessThan(1) // local reverb engaged
    expect(globalDry.gain.value).toBe(1) // shared post-rotary unit idles dry
    store.toggleFxGlobal('reverb')
    expect(chainDry.gain.value).toBe(1) // local reverb bypassed
    expect(globalDry.gain.value).toBeLessThan(1) // the post-rotary reverb took over
    // Placement: rotary output -> pre-master sum -> global reverb input.
    const preMaster = (diag.rotary!.output as FakeNode).connections[0]!
    expect(preMaster.connections.includes(diag.globalReverb!.input as FakeNode)).toBe(true)
    store.toggleFxGlobal('reverb') // leaving Global restores the local reverb
    expect(chainDry.gain.value).toBeLessThan(1)
    expect(globalDry.gain.value).toBe(1)
  })

  it('rotary speed and stop controls retarget the rotor/horn LFO frequencies with inertia', () => {
    const { store, engine, getContext } = makeSystem()
    const context = getContext()!
    // Rotary LFOs: oscillators whose initial frequencies are 0.8 (horn) and 0.7 (rotor).
    const lfos = context.oscillators().filter((o) => o.frequency.value === 0.8 || o.frequency.value === 0.7)
    expect(lfos.length).toBe(2)
    store.toggleRotarySpeed() // fast
    expect(lfos.every((o) => o.frequency.value > 5)).toBe(true)
    expect(lfos.every((o) => o.frequency.events.some((e) => e.kind === 'target'))).toBe(true) // acceleration ramp
    store.toggleRotaryStop() // stop
    expect(lfos.every((o) => o.frequency.value < 0.1)).toBe(true)
    expect(engine.diagnostics().rotary).toBeTruthy()
  })

  it('CLOSE MIC (Shift + Organ, manual p. 54, audit E11) widens the horn band\'s pan/amp modulation', () => {
    const { store, getContext } = makeSystem()
    const context = getContext()!
    const gains = () => context.nodes.filter((n): n is FakeGain => n.kind === 'gain')
    // Default mic distance: horn pan depth 0.75, horn amp depth 0.22.
    expect(gains().some((g) => g.gain.value === 0.75)).toBe(true)
    expect(store.getState().rotary.closeMic).toBe(false)
    store.toggleRotaryCloseMic()
    expect(store.getState().rotary.closeMic).toBe(true)
    expect(store.getState().programs.dirty).toBe(true) // stored per program (manual p. 54)
    // Close-miked model: the SAME depth nodes ramp to the wider values.
    expect(gains().some((g) => g.gain.value === 0.95)).toBe(true) // horn pan sweep
    expect(gains().some((g) => g.gain.value === 0.32)).toBe(true) // horn amp motion
    expect(gains().some((g) => g.gain.value === 0.0006)).toBe(true) // doppler shimmer
    store.toggleRotaryCloseMic()
    expect(gains().some((g) => g.gain.value === 0.95)).toBe(false)
    expect(gains().some((g) => g.gain.value === 0.75)).toBe(true)
  })

  it('a fixed stop ANGLE (Shift + Stop Mode, manual p. 54) parks the pose deterministically; Free keeps the drift', () => {
    const { store, getContext } = makeSystem()
    const context = getContext()!
    // The ping-pong delay panners park permanently at ±0.85; the rotary's
    // pose panners are the ones that move between 0 and the parked values.
    const posePans = () =>
      context.nodes
        .filter((n): n is FakeStereoPanner => n.kind === 'panner')
        .map((p) => p.pan.value)
        .filter((v) => Math.abs(v) !== 0.85)
    const gains = () => context.nodes.filter((n): n is FakeGain => n.kind === 'gain')
    // Free (default) + stop: residual wobble remains (depth scaled to 0.15).
    store.toggleRotaryStop()
    expect(store.getState().rotary.stopAngle).toBe('Free')
    expect(gains().some((g) => Math.abs(g.gain.value - 0.75 * 0.15) < 1e-9)).toBe(true)
    expect(posePans().every((v) => v === 0)).toBe(true) // no forced pose
    // Cycle Free -> 0° -> 45° -> 90°: the wobble depth drops to zero and the
    // horn/rotor pan park at sin(90°) of their sweep widths — the same pose
    // every time Stop Mode engages.
    store.cycleRotaryStopAngle()
    expect(store.getState().rotary.stopAngle).toBe(0)
    store.cycleRotaryStopAngle()
    store.cycleRotaryStopAngle()
    expect(store.getState().rotary.stopAngle).toBe(90)
    expect(gains().some((g) => Math.abs(g.gain.value - 0.75 * 0.15) < 1e-9)).toBe(false)
    expect(posePans().some((v) => Math.abs(v - 0.75) < 1e-9)).toBe(true) // horn parked
    expect(posePans().some((v) => Math.abs(v - 0.35) < 1e-9)).toBe(true) // rotor parked
    // Leaving Stop Mode releases the pose and restores the full sweep.
    store.toggleRotaryStop()
    expect(posePans().every((v) => v === 0)).toBe(true)
    expect(gains().some((g) => g.gain.value === 0.75)).toBe(true)
  })

  it('Close Mic and Stop Angle are program state: they round-trip through Store and backfill on old snapshots', () => {
    const store = new InstrumentStore()
    store.toggleRotaryCloseMic()
    store.cycleRotaryStopAngle() // Free -> 0°
    store.cycleRotaryStopAngle() // 0° -> 45°
    store.storePress()
    store.storePress()
    store.selectProgram(4) // an untouched program: hardware defaults
    expect(store.getState().rotary.closeMic).toBe(false)
    expect(store.getState().rotary.stopAngle).toBe('Free')
    store.selectProgram(0)
    expect(store.getState().rotary.closeMic).toBe(true)
    expect(store.getState().rotary.stopAngle).toBe(45)
    // Programs persisted before these fields existed (rotary = { speed,
    // drive } only) load with the hardware defaults, not a crash.
    const strip = (slot: { name: string; snapshot: unknown }) => {
      const snapshot = JSON.parse(JSON.stringify(slot.snapshot)) as { rotary: Record<string, unknown> }
      delete snapshot.rotary.closeMic
      delete snapshot.rotary.stopAngle
      return { name: slot.name, snapshot }
    }
    const rawBank = store.getState().programs.bank.map(strip)
    const rawLive = store.getState().programs.live.map(strip)
    const storage = fakeStorageBoundary({
      'stagebench.programs.v1': JSON.stringify({ version: 1, bank: rawBank, live: rawLive, liveMode: false, current: 0 }),
    })
    expect(() => new InstrumentStore(storage)).not.toThrow()
    const restored = new InstrumentStore(storage)
    expect(restored.getState().rotary.closeMic).toBe(false)
    expect(restored.getState().rotary.stopAngle).toBe('Free')
  })

  it('panel: Shift + Organ toggles CLOSE MIC (LED lit), Shift + Stop Mode cycles the ANGLE list', () => {
    renderApp()
    const closeMicLed = document.querySelectorAll('.rotary-strip .rotary-led-row')[1]!.querySelector('.led')!
    expect((closeMicLed as HTMLElement).dataset.on).toBe('false')
    const shift = screen.getByRole('button', { name: 'Shift/Exit' })
    fireEvent.click(shift)
    fireEvent.click(screen.getByRole('button', { name: 'Rotary Organ Source' }))
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Rotary Close Mic On/)
    expect((closeMicLed as HTMLElement).dataset.on).toBe('true')
    // ANGLE = Shift + Stop Mode steps Free -> 0° -> 45° …
    fireEvent.click(screen.getByRole('button', { name: 'Rotary Stop Mode' }))
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Rotary Stop Angle: 0°/)
    fireEvent.click(screen.getByRole('button', { name: 'Rotary Stop Mode' }))
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Rotary Stop Angle: 45°/)
    fireEvent.click(shift) // unlatch
    // A plain Stop Mode press still toggles Stop, untouched by the new pairing.
    fireEvent.click(screen.getByRole('button', { name: 'Rotary Stop Mode' }))
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Rotary Stop/)
  })

  it('the panel focus button cycles Piano A/B; GROUP is the printed Shift pairing (manual p. 46)', () => {
    renderApp()
    const focusButton = screen.getByRole('button', { name: 'Piano FX Focus Group' })
    const focusLeds = () =>
      Array.from(document.querySelectorAll('.fx-strip .focus-cell')[1]!.querySelectorAll('.led')).map(
        (led) => (led as HTMLElement).dataset.on,
      )
    expect(focusLeds()).toEqual(['true', 'false'])
    fireEvent.click(focusButton)
    expect(focusLeds()).toEqual(['false', 'true'])
    fireEvent.click(focusButton)
    expect(focusLeds()).toEqual(['true', 'false']) // plain presses never enter Group
    // GROUP ▿ = Shift + press (the latch persists); a second shifted press
    // leaves Group with the focus unchanged.
    fireEvent.click(screen.getByRole('button', { name: 'Shift/Exit' }))
    fireEvent.click(focusButton)
    expect(focusLeds()).toEqual(['true', 'true'])
    fireEvent.click(focusButton)
    expect(focusLeds()).toEqual(['true', 'false'])
    fireEvent.click(screen.getByRole('button', { name: 'Shift/Exit' })) // unlatch
  })

  it('Shift+On toggles Global mode from the real panel and lights the GLOBAL tag', () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Shift/Exit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reverb On' }))
    expect(document.querySelector('.reverb-box .red-tag.lit')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Shift/Exit' })) // shift off
    fireEvent.click(screen.getByRole('button', { name: 'Reverb On' })) // plain on now
    expect(screen.getByRole('button', { name: 'Reverb On' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('tap tempo sets the delay time from tap intervals', () => {
    const { timers, ...rest } = (() => {
      const rendered = renderApp()
      return rendered
    })()
    void rest
    const tap = screen.getByRole('button', { name: 'Delay Tap/Set' })
    fireEvent.click(tap)
    timers.now += 500
    fireEvent.click(tap)
    timers.now += 500
    fireEvent.click(tap)
    const edit = screen.getByTestId('oled-edit-line').textContent!
    expect(edit).toMatch(/Delay Tempo 50\d ms/)
  })

  it('Shift + Tap/Set toggles the delay Analog mode (one physical button) and lights its LED', () => {
    renderApp()
    // The ANALOG LED is the second LED in the TAP/SET sub-box (below the button).
    const analogLed = () => (document.querySelectorAll('.delay-tap-cell .led')[1] as HTMLElement).dataset.on
    expect(analogLed()).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Shift/Exit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delay Tap/Set' }))
    expect(analogLed()).toBe('true')
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Delay Analog On/)
  })
})
