// hardware.bindings: every panel control is bound to a canonical state path or listed as unsupported,
// and every bound control changes state when it is operated.
import { describe, expect, it } from 'vitest'
import { bindingOf, UNSUPPORTED } from './bindings'
import { CONTROLS, getControl, isContinuous } from './hardware'
import { createInstrumentState, instrumentReducer, type InstrumentAction, type InstrumentState } from './instrument'

/** The action a player takes on a control of this kind. */
function operate(id: string): InstrumentAction {
  const control = getControl(id)!
  switch (control.kind) {
    case 'cycle':
      return { type: 'advance', id }
    case 'button':
      return { type: 'toggle', id, shiftKey: false }
    default:
      return isContinuous(control.kind) ? { type: 'set', id, value: 0.9 } : { type: 'set', id, value: 0.9 }
  }
}

/** The state a control is operated from. Page-down starts from page 2, so it has a page to go back to. */
function baseline(state: InstrumentState, id: string): InstrumentState {
  return id === 'program.page-down' ? instrumentReducer(state, { type: 'toggle', id: 'program.page-up' }) : state
}

/** Operates a control from its baseline, and returns the state after it. */
function after(state: InstrumentState, id: string): InstrumentState {
  return instrumentReducer(baseline(state, id), operate(id))
}

/**
 * Radio sets: a switch that is already lit does nothing when pressed again, which is correct. For these,
 * the audit operates the other member of the set, which is the press that changes the instrument.
 */
const RADIO_ALTERNATIVE: Readonly<Record<string, string>> = {
  'organ.layer-a-focus': 'organ.layer-b-focus',
  'organ.model-b3': 'organ.model-vox',
  'piano.layer-a-focus': 'piano.layer-b-focus',
  'synth.layer-a-focus': 'synth.layer-b-focus',
  'effects.focus-a': 'effects.focus-b',
  'effects.section-piano': 'effects.section-synth',
  // Program 1 is the loaded program at the start, so pressing it reloads the same state; program 2 changes it.
  'program.button-1': 'program.button-2',
}

describe('hardware.bindings: the control audit', () => {
  it('covers every control: each is bound or listed as unsupported, with a reason', () => {
    for (const control of CONTROLS) {
      const binding = bindingOf(control.id)
      expect(['bound', 'unsupported']).toContain(binding)
      if (binding === 'unsupported') expect(UNSUPPORTED[control.id].length, control.id).toBeGreaterThan(20)
    }
  })

  it('lists only controls that exist, so the unsupported list cannot hide a missing control', () => {
    for (const id of Object.keys(UNSUPPORTED)) expect(getControl(id), id).toBeDefined()
  })

  it('every bound control changes the instrument state when it is operated, so none is a silent no-op', () => {
    const start = createInstrumentState()
    const silent: string[] = []
    for (const control of CONTROLS) {
      if (bindingOf(control.id) !== 'bound') continue
      // Tap and Panic have effects outside the reducer's state: Tap changes the clock by taps, and Panic is a counter the hub reads.
      if (control.id === 'program.tap' || control.id === 'program.panic') continue
      const pressed = RADIO_ALTERNATIVE[control.id] ?? control.id
      const next = after(start, pressed)
      if (JSON.stringify(next) === JSON.stringify(baseline(start, pressed))) silent.push(control.id)
    }
    expect(silent, 'controls that changed nothing').toEqual([])
  })

  it('Panic and Tap have their own effects: Panic counts, and a tap is recorded by the page', () => {
    const start = createInstrumentState()
    expect(instrumentReducer(start, { type: 'panic' }).panics).toBe(1)
    expect(instrumentReducer(start, { type: 'tap-tempo', time: 0 }).taps).toHaveLength(1)
  })

  it('the unsupported controls are the spec-excluded or optional ones, and they stay decorative', () => {
    expect(Object.keys(UNSUPPORTED).sort()).toEqual(['piano.model', 'program.morph-3'])
  })
})
