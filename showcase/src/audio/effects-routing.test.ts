import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { fakeAssetBoundary, fakeAudioBoundary, FakeDelayNode, FakeFilter, FakeGain, FakeNode } from '../test/fakes'
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

  it('Amp/EQ "To Rotary" routes the layer through the single rotary instance, post-reverb', () => {
    const { store, engine } = makeSystem()
    const { channels } = engine.diagnostics()
    const channel = channels!.A
    const toRotary = channel.toRotary as unknown as FakeGain
    const toMaster = channel.toMaster as unknown as FakeGain
    expect(toRotary.gain.value).toBeLessThan(0.001)
    store.toggleUnitOn('ampEq')
    for (let i = 0; i < 6; i++) store.cycleAmpType() // Neutral -> ... -> To Rotary
    expect(store.getState().chains.A.ampEq.type).toBe('To Rotary')
    expect(toRotary.gain.value).toBeGreaterThan(0.9)
    expect(toMaster.gain.value).toBeLessThan(0.001)
    // Turning the Amp unit off returns the layer to the direct path.
    store.toggleUnitOn('ampEq')
    expect(toRotary.gain.value).toBeLessThan(0.001)
    expect(toMaster.gain.value).toBeGreaterThan(0.9)
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

  it('the panel focus button cycles Piano A -> B -> Group and lights the FX Focus LEDs', () => {
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
    expect(focusLeds()).toEqual(['true', 'true']) // group
    fireEvent.click(focusButton)
    expect(focusLeds()).toEqual(['true', 'false'])
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
})
