import { describe, expect, it } from 'vitest'
import { CONTROLS, UNSUPPORTED_CONTROL_IDS, control, isFunctionalControl } from '../model/controls'
import {
  deckReducer,
  initialDeckState,
  transposeActive,
  type DeckState,
  type HardwareAction,
} from './hardware'
import { deriveSettings } from './settings'

/**
 * Every non-excluded control has meaningful canonical behaviour.
 *
 * Feature: hardware.bindings
 *
 * The rule this file enforces, for all 147 controls at once: operating a functional control must
 * change either the settings the audio engine is driven from, or a piece of deck state outside
 * the control's own value. `values` is excluded from the deck-state comparison for the obvious
 * reason (a control storing its own position proves nothing), and `banks` is excluded too, because
 * a layer-scoped control writes its position into the focused layer's bank whether or not anything
 * downstream reads it. What is left cannot be satisfied by a control that does nothing.
 *
 * A handful of controls are modal: they change how the *next* action lands rather than changing
 * state on their own press. They are declared below and each is asserted individually, so a modal
 * control that quietly stopped working cannot hide in this list.
 */

function run(actions: HardwareAction[], from: DeckState = initialDeckState()): DeckState {
  return actions.reduce(deckReducer, from)
}

const press = (id: string, at?: number): HardwareAction => ({ type: 'activate', id, at })
const set = (id: string, value: number): HardwareAction => ({ type: 'set', id, value })
const nudge = (id: string, steps: number): HardwareAction => ({ type: 'nudge', id, steps })

/** Deck state with the two sections that start powered down switched on. */
function panel(): DeckState {
  return run([press('organ.section-on'), press('synth.section-on')])
}

/** Everything about the deck except the raw control positions and the per-layer banks. */
function deckShape(state: DeckState): string {
  const { values: _values, banks: _banks, ...rest } = state
  return JSON.stringify(rest)
}

function settingsShape(state: DeckState): string {
  return JSON.stringify(deriveSettings(state))
}

/** The action that operates a control, chosen from its kind. */
function operate(id: string, state: DeckState): HardwareAction {
  const spec = control(id)
  if (spec.kind === 'encoder') return nudge(id, 2)
  if (spec.kind === 'button') return press(id, 1000)
  const current = state.values[id]
  return set(id, current === spec.max ? spec.min : spec.max)
}

/**
 * Controls that are modal — they retarget the dial, the page buttons or the next button press
 * instead of changing state on their own. Each one is asserted by hand below.
 */
const MODAL_CONTROL_IDS: readonly string[] = ['program.shift', 'fx.shift', 'program.transpose']

/**
 * Controls whose effect is a reset: from the panel's power-up state there is nothing to reset,
 * so they are probed from an edited panel instead. The edit is the point of the control.
 */
const BASE_EDITS: Readonly<Record<string, HardwareAction[]>> = {
  'synth.sound-init': [set('synth.filter.freq', 9.4), set('synth.filter.res', 8), nudge('synth.osc.category', 2)],
}

function baseFor(id: string): DeckState {
  const base = panel()
  const edits = BASE_EDITS[id]
  return edits ? run(edits, base) : base
}

describe('hardware bindings', () => {
  it('gives every functional control an effect beyond its own position', () => {
    const inert: string[] = []
    for (const spec of CONTROLS) {
      if (!spec.functional) continue
      const base = baseFor(spec.id)
      const next = run([operate(spec.id, base)], base)
      const moved = settingsShape(base) !== settingsShape(next) || deckShape(base) !== deckShape(next)
      if (!moved) inert.push(spec.id)
    }
    // Anything that moved nothing must be one of the declared modal controls, and every declared
    // modal control must really be inert on its own press — otherwise it belongs in the loop.
    expect([...inert].sort()).toEqual([...MODAL_CONTROL_IDS].sort())
  })

  it('declares every decorative control with the spec clause that excludes it', () => {
    for (const [id, reason] of UNSUPPORTED_CONTROL_IDS) {
      expect(isFunctionalControl(id)).toBe(false)
      expect(reason.length).toBeGreaterThan(20)
      const base = panel()
      const next = run([operate(id, base)], base)
      // A decorative control moves and nothing else changes at all.
      expect(settingsShape(next)).toBe(settingsShape(base))
      expect(deckShape(next)).toBe(deckShape(base))
    }
    expect(CONTROLS.filter((spec) => !spec.functional).map((spec) => spec.id).sort()).toEqual(
      [...UNSUPPORTED_CONTROL_IDS.keys()].sort(),
    )
  })

  it('SHIFT retargets the next press instead of doing something itself', () => {
    const base = panel()
    expect(run([press('program.store')], base).storeStage).toBe('destination')
    expect(run([press('program.shift'), press('program.store')], base).storeStage).toBe('naming')
    expect(run([press('program.shift'), press('program.split')], base).splitEdit).toBe(1)
    // The Layer Effects plate carries its own SHIFT, which reaches the same modifier.
    expect(run([press('fx.shift'), press('program.split')], base).splitEdit).toBe(1)
    expect(run([press('fx.shift'), press('piano.a.on')], base).zones['piano.a']).toEqual({ from: 0, to: 0 })
  })

  it('TRANSPOSE retargets the dial from programs to the transpose amount', () => {
    const base = panel()
    expect(run([nudge('program.dial', 3)], base).slot).toBe(3)
    const on = run([press('program.transpose')], base)
    expect(transposeActive(on)).toBe(true)
    const dialled = run([nudge('program.dial', 3)], on)
    expect(dialled.slot).toBe(base.slot)
    expect(dialled.transpose).toBe(3)
    expect(deriveSettings(dialled).transpose).toBe(3)
  })

  it('STORE arms the destination stage, which is what its own press is for', () => {
    const base = panel()
    const armed = run([press('program.store')], base)
    expect(armed.storeStage).toBe('destination')
    expect(armed.storePayload).not.toBeNull()
    // It is listed as modal only because arming from slot 1.1 leaves the audible panel alone.
    expect(settingsShape(armed)).toBe(settingsShape(base))
  })

  it('the program buttons address their own slot, including the one that is already selected', () => {
    const base = panel()
    expect(base.slot).toBe(0)
    expect(run([press('program.slot.1')], base).slot).toBe(0)
    const away = run([press('program.slot.5')], base)
    expect(away.slot).toBe(4)
    expect(run([press('program.slot.1')], away).slot).toBe(0)
  })
})
