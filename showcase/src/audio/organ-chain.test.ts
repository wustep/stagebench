import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { fakeAssetBoundary, fakeAudioBoundary } from '../test/fakes'
import { renderApp } from '../test/renderApp'
import { InstrumentStore } from '../state/instrument'
import { PianoEngine } from './engine'

/**
 * organ.engine (shared effects chain) — manual p. 18: "Both Organ Layers
 * share the same effects chain." FX focus follows section-layer presses
 * (Piano A/B vs Organ A/B); the focused chain is what every effect knob,
 * button, Group/Global mirror and morph capture read and write.
 *
 * Organ layer B starts disabled (layer A is pre-enabled, manual power-on
 * pose) — enabling it is the reliable way to exercise "switching a layer on
 * moves focus" without first having to switch anything off.
 */
function makeSystem() {
  const setup = fakeAudioBoundary()
  const store = new InstrumentStore()
  const engine = new PianoEngine(setup.boundary, { assets: fakeAssetBoundary() })
  engine.attachStore(store)
  engine.ensureStarted()
  return { ...setup, store, engine }
}

describe('organ-chain — FX focus follows section-layer presses', () => {
  it('pressing an Organ layer moves FX focus to the shared organ chain; Piano moves it back', () => {
    const { store } = makeSystem()
    expect(store.getState().fxSection).toBe('piano')
    store.toggleOrganLayerEnabled('B')
    expect(store.getState().fxSection).toBe('organ')
    expect(store.focusedChain()).toBe(store.getState().organChain)
    store.setFocusedLayer('A')
    expect(store.getState().fxSection).toBe('piano')
    expect(store.focusedChain()).toBe(store.getState().chains.A)
  })

  it('the panel LEDs light PIANO A/B only when focused on Piano and ORGAN A/B only when focused on Organ', () => {
    renderApp()
    const ledsOf = (index: number) =>
      Array.from(document.querySelectorAll('.fx-focus-column .focus-cell')[index]!.querySelectorAll('.led')).map(
        (led) => (led as HTMLElement).dataset.on,
      )
    // Power-on: Piano A focused, Organ off — PIANO A lit, ORGAN LEDs dark.
    expect(ledsOf(1)).toEqual(['true', 'false']) // PIANO A, B
    expect(ledsOf(0)).toEqual(['false', 'false']) // ORGAN A, B
    fireEvent.click(screen.getByRole('button', { name: 'Organ Layer B On/Off' }))
    // Organ A is pre-enabled (power-on pose); enabling B lights both.
    expect(ledsOf(0)).toEqual(['true', 'true']) // ORGAN A, B lit, focus moved
    expect(ledsOf(1)).toEqual(['false', 'false']) // PIANO LEDs dark while focus is on Organ
    fireEvent.click(screen.getByRole('button', { name: 'Piano Layer A On/Off' }))
    expect(ledsOf(1)).toEqual(['false', 'false']) // A was on; this click switches it off, focus untouched
    fireEvent.click(screen.getByRole('button', { name: 'Piano Layer A On/Off' })) // switch A back on
    expect(ledsOf(1)).toEqual(['true', 'false'])
    expect(ledsOf(0)).toEqual(['false', 'false'])
  })
})

describe('organ-chain — knob/button edits target organChain, not the piano chains', () => {
  it('an effect edit while focused on Organ writes organChain and leaves both piano chains untouched', () => {
    const { store } = makeSystem()
    store.toggleOrganLayerEnabled('B')
    store.updateUnit('mod1', { rate: 100 })
    expect(store.getState().organChain.mod1.rate).toBe(100)
    expect(store.getState().chains.A.mod1.rate).toBe(64)
    expect(store.getState().chains.B.mod1.rate).toBe(64)
  })

  it('per-unit bypass toggles the organ chain unit only', () => {
    const { store } = makeSystem()
    store.toggleOrganLayerEnabled('B')
    expect(store.getState().organChain.reverb.on).toBe(false)
    store.toggleUnitOn('reverb')
    expect(store.getState().organChain.reverb.on).toBe(true)
    expect(store.getState().chains.A.reverb.on).toBe(false)
    expect(store.getState().chains.B.reverb.on).toBe(false)
  })
})

describe('organ-chain — global mode mirrors onto the organ chain', () => {
  it('Global mode (Shift+On) mirrors the focused piano layer unit onto organChain too', () => {
    const { store } = makeSystem()
    store.updateUnit('reverb', { mix: 90 })
    store.toggleFxGlobal('reverb')
    expect(store.getState().fxGlobal.reverb).toBe(true)
    expect(store.getState().chains.B.reverb.mix).toBe(90)
    expect(store.getState().organChain.reverb.mix).toBe(90)
    // While global is active, an organ-focused edit is scoped to the organ
    // chain only (targetLayers/global mirroring is a Piano-side concept).
    store.toggleOrganLayerEnabled('B')
    store.updateUnit('reverb', { mix: 40 })
    expect(store.getState().organChain.reverb.mix).toBe(40)
  })
})

describe('organ-chain — To Rotary routing via the organ chain amp unit', () => {
  it('the organ chain Amp unit in To Rotary mode routes the shared chain output to the rotary', () => {
    const { store, engine } = makeSystem()
    store.setOrganSectionOn(true)
    store.toggleOrganLayerEnabled('B')
    const { organChainToMaster, organChainToRotary } = engine.diagnostics()
    expect(organChainToRotary!.gain.value).toBeLessThan(0.001)
    store.toggleUnitOn('ampEq')
    for (let i = 0; i < 6; i++) store.cycleAmpType() // Neutral -> ... -> To Rotary
    expect(store.getState().organChain.ampEq.type).toBe('To Rotary')
    expect(organChainToRotary!.gain.value).toBeGreaterThan(0.9)
    expect(organChainToMaster!.gain.value).toBeLessThan(0.001)
  })
})

describe('organ-chain — program snapshot round-trip', () => {
  it('storing and reloading a program round-trips organChain and fxSection', () => {
    const { store } = makeSystem()
    store.toggleOrganLayerEnabled('B')
    store.updateUnit('delay', { on: true, mix: 77 })
    store.storePress()
    store.storePress() // confirm store to the current slot
    store.setFocusedLayer('A') // move focus elsewhere before reloading
    expect(store.getState().fxSection).toBe('piano')
    store.selectProgram(1) // any other slot
    store.selectProgram(0) // back to the stored slot
    expect(store.getState().fxSection).toBe('organ')
    expect(store.getState().organChain.delay.on).toBe(true)
    expect(store.getState().organChain.delay.mix).toBe(77)
  })
})
