import { describe, expect, it } from 'vitest'
import { fakeAssetBoundary, fakeAudioBoundary } from '../test/fakes'
import { PianoEngine } from '../audio/engine'
import { InstrumentController } from '../input/controller'
import { InstrumentStore } from './instrument'
import { PresentationStore } from './presentation'
import { functionalControls } from '../model/hardware'

/**
 * hardware.bindings — every functional (non-excluded) control has MEANINGFUL
 * canonical behavior: operating it from the panel front door must change the
 * canonical instrument state or its truthful last-edit readout. This audits
 * the whole surface systematically so no control can silently regress into a
 * decorative stub while claiming to be functional.
 */

function makeSystem() {
  const setup = fakeAudioBoundary()
  const instrument = new InstrumentStore()
  const engine = new PianoEngine(setup.boundary, { assets: fakeAssetBoundary() })
  engine.attachStore(instrument)
  const controller = new InstrumentController(engine)
  const presentation = new PresentationStore({ instrument, controller, now: () => 0 })
  return { instrument, engine, controller, presentation }
}

/**
 * Controls whose canonical effect lives in the engine/input layer rather than
 * the InstrumentStore document, each covered by dedicated behavior tests.
 */
const ENGINE_LEVEL = new Set([
  'perf-pitch-stick', // live pitch bend — src/input/inputs.test.tsx
  'perf-mod-wheel', // morph source position — morph tests (state changes only when morphs are assigned)
  'perf-ctrl-pedal', // morph source position — morph tests
  'panic', // immediate all-notes-off — stage3-engine.test.ts
  'shift', // latching modifier for other controls — decorative-controls tests
])

describe('hardware.bindings audit', () => {
  it('every functional control changes canonical state or the truthful display readout', () => {
    for (const control of functionalControls()) {
      if (ENGINE_LEVEL.has(control.id)) continue
      const { instrument, presentation } = makeSystem()
      const fingerprint = () => JSON.stringify(instrument.getState()) + presentation.getSynthMenu()
      const before = fingerprint()
      if (control.type === 'button') {
        presentation.toggle(control.id)
      } else {
        const current = presentation.getValue(control.id)
        const max = control.max ?? 127
        const target = current > max / 2 ? Math.max(0, current - Math.max(1, Math.round(max / 4))) : Math.min(max, current + Math.max(1, Math.round(max / 4)))
        presentation.setValue(control.id, target)
      }
      expect(fingerprint(), `functional control ${control.id} must have canonical behavior`).not.toBe(before)
    }
  })

  it('the morph sources move the live morph position (engine-level canonical state)', () => {
    const { instrument, presentation } = makeSystem()
    presentation.setValue('perf-mod-wheel', 127)
    expect(instrument.getState().morphValues.wheel).toBeCloseTo(1, 5)
    presentation.setValue('perf-ctrl-pedal', 64)
    expect(instrument.getState().morphValues.pedal).toBeGreaterThan(0.4)
  })
})
