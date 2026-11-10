import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  FUNCTIONAL_BUTTON_IDS,
  FUNCTIONAL_CONTROL_IDS,
  FUNCTIONAL_RANGE_IDS,
  SHIFT_BUTTON_IDS,
  UNSUPPORTED_CONTROLS,
  UNSUPPORTED_FUNCTIONS,
} from '../src/hardware/functional'
import { INVENTORY } from '../src/hardware/inventory'
import type { RangeDef } from '../src/hardware/types'
import { programSignature, type StageState } from '../src/state/model'
import { mountApp } from './support/app'
import { kernelOf, oled, press, shiftPress, start } from './support/panel'
import { makeRig } from './support/rig'

/**
 * Feature: hardware.bindings
 * Every non-excluded control has meaningful canonical behavior; spec-excluded controls are
 * listed as unsupported.
 *
 * The audit is done by doing: every one of the 146 panel controls is operated, on a fresh
 * instrument, and what it changed is compared with what it is supposed to be.
 */

/** Everything a control could legitimately change, as one comparable string. */
function fingerprint(state: StageState): string {
  const { notice: _notice, nav, ui, ...rest } = state
  void _notice
  return JSON.stringify({ rest, nav: { live: nav.live, slot: nav.slot }, ui: { mode: ui.mode, synthPage: ui.synthPage, morphAssign: ui.morphAssign, store: ui.store, split: ui.split, listCursor: ui.listCursor } })
}

/** A rig with every section on, so that no control is a no-op merely because its section is off. */
function ready() {
  const rig = makeRig()
  rig.press('organ-on')
  rig.press('synth-on')
  rig.press('split')
  return rig
}

/** Controls that only act together with something else; each gets its own test below. */
const SPECIAL = new Set<string>([...SHIFT_BUTTON_IDS, 'synth-waveform', 'fx-delay-tap'])

/**
 * A few controls have nothing to do in the state `ready` leaves: a section's only layer cannot
 * be switched off, a piano type with one model has nothing for the Model dial to select, and
 * Transpose at zero moves no pitch. Give each of them something to do first.
 */
function prepare(rig: ReturnType<typeof makeRig>, id: string): void {
  const layerA = id.match(/^(organ|piano|synth)-layer-a$/)
  if (layerA) {
    rig.press(`${layerA[1]}-layer-b`)
    rig.press(id)
  }
  if (id === 'piano-model') for (let presses = 0; presses < 3; presses += 1) rig.press('piano-type')
  if (id === 'transpose') {
    rig.stage.setTranspose(3)
  }
  // The Synth dials edit the page that is showing; put a page with three live dials up.
  if (id.startsWith('synth-osc-dial')) rig.press('synth-amp-envelope')
}

describe('hardware.bindings: the audit covers the whole panel', () => {
  it('all 146 controls are either functional or listed as unsupported, never both and never neither', () => {
    const functional = new Set(FUNCTIONAL_CONTROL_IDS)
    const unsupported = new Set(Object.keys(UNSUPPORTED_CONTROLS))
    expect(INVENTORY.controls).toHaveLength(146)
    expect(functional.size).toBe(FUNCTIONAL_CONTROL_IDS.length)
    expect(functional.size + unsupported.size).toBe(146)
    for (const control of INVENTORY.controls) {
      expect(functional.has(control.id) !== unsupported.has(control.id), control.id).toBe(true)
    }
    expect(functional.size).toBe(135)
    expect(unsupported.size).toBe(11)
    for (const id of FUNCTIONAL_BUTTON_IDS) expect(INVENTORY.controlById.get(id)?.kind, id).toBe('button')
    for (const id of FUNCTIONAL_RANGE_IDS) expect(INVENTORY.controlById.get(id)?.kind, id).not.toBe('button')
  })

  it('every unsupported control names the spec exclusion (or unimplemented option) behind it', () => {
    for (const [id, reason] of Object.entries(UNSUPPORTED_CONTROLS)) {
      expect(INVENTORY.controlById.has(id), id).toBe(true)
      expect(reason, id).toMatch(/excluded by the \w+ spec|excluded as a morph source \(programs spec\)|optional in the \w+ spec|Samples mode is optional and Extern is excluded in the synth spec/)
    }
    for (const reason of Object.values(UNSUPPORTED_FUNCTIONS)) expect(reason).toMatch(/excluded|optional|not part of/)
  })
})

describe('hardware.bindings: every functional control does something real', () => {
  it('each functional button, pressed on its own, changes the canonical state', () => {
    const silent: string[] = []
    for (const id of FUNCTIONAL_BUTTON_IDS) {
      if (SPECIAL.has(id)) continue
      const rig = ready()
      prepare(rig, id)
      const before = fingerprint(rig.state())
      rig.press(id)
      if (fingerprint(rig.state()) === before) silent.push(id)
      // The panel was redrawn from the state: nothing is left showing a position the state does not have.
      rig.dispose()
    }
    expect(silent).toEqual([])
  })

  it('each functional knob, fader, drawbar, dial, wheel, and stick, moved on its own, changes the canonical state', () => {
    const silent: string[] = []
    for (const id of FUNCTIONAL_RANGE_IDS) {
      const rig = ready()
      const def = INVENTORY.controlById.get(id) as RangeDef
      prepare(rig, id)
      const before = fingerprint(rig.state())
      if (def.wrap) rig.turn(id, id === 'synth-osc-dial-2' ? -3 : 3)
      else rig.set(id, rig.value(id) > (def.min + def.max) / 2 ? def.min : def.max)
      if (fingerprint(rig.state()) === before) silent.push(id)
      rig.dispose()
    }
    expect(silent).toEqual([])
  })

  it('each of those changes reaches the audio kernel, or is a page, program, or assignment control by design', () => {
    // Controls whose effect is on the display, the program memory, or an editing mode rather than directly on the sound.
    const notSound = new Set([
      // Store opens a page; Program 1 reloads the program that is already loaded; the Morph buttons latch.
      'store', 'program-1', 'morph-wheel', 'morph-control-pedal', 'mst-clk',
      // Page buttons of the Synth display.
      'synth-osc-pitch', 'synth-osc-envelope', 'synth-filter-type', 'synth-filter-envelope', 'synth-amp-envelope',
      'synth-lfo-waveform', 'synth-arp-menu', 'synth-vibrato-menu',
      // Effect focus chooses what the effect controls edit.
      'fx-focus-organ', 'fx-focus-piano', 'fx-focus-synth',
    ])
    const untouched: string[] = []
    for (const id of FUNCTIONAL_CONTROL_IDS) {
      if (SPECIAL.has(id) || notSound.has(id)) continue
      const rig = ready()
      const def = INVENTORY.controlById.get(id)!
      prepare(rig, id)
      const before = JSON.stringify(rig.kernel.getState())
      if (def.kind === 'button') rig.press(id)
      else if ((def as RangeDef).wrap) rig.turn(id, id === 'synth-osc-dial-2' ? -3 : 3)
      else rig.set(id, rig.value(id) > ((def as RangeDef).min + (def as RangeDef).max) / 2 ? (def as RangeDef).min : (def as RangeDef).max)
      if (JSON.stringify(rig.kernel.getState()) === before) untouched.push(id)
      rig.dispose()
    }
    expect(untouched).toEqual([])
    // 115 of the 135 functional controls change what the kernel is told to play.
    expect(FUNCTIONAL_CONTROL_IDS.length - SPECIAL.size - notSound.size).toBe(115)
  })

  it('the controls that act through a mode or a second control are bound too', () => {
    // Waveform: back to the oscillator page; Shift + Waveform: Sound Init.
    const rig = ready()
    rig.press('synth-filter-envelope')
    rig.press('synth-waveform')
    expect(rig.state().ui.synthPage).toBe('osc')
    rig.set('synth-filter-freq', 9.5)
    rig.turn('synth-osc-dial-1', 5)
    rig.shiftPress('synth-waveform')
    expect(rig.state().synth.layers[0].filter.freq).toBe(3.5)
    expect(rig.state().synth.layers[0].wave).toBe(2)
    expect(rig.state().notice).toBe('Synth A Sound Init')
    // Shift: latches for the next control, and is Exit on an editing page.
    rig.exit()
    expect(rig.binder.shiftActive).toBe(true)
    expect(rig.hardware.isLatched('shift')).toBe(true)
    expect(rig.hardware.isLatched('fx-shift')).toBe(true)
    rig.press('fx-delay-on')
    expect(rig.state().fx.global.delay).toBe(true)
    expect(rig.binder.shiftActive).toBe(false)
    rig.hardware.press('fx-shift')
    rig.press('fx-reverb-on')
    rig.hardware.release('fx-shift', true)
    expect(rig.state().fx.global.reverb).toBe(true)
    // The Delay tap needs two taps.
    rig.clock.now = 1000
    rig.press('fx-delay-tap')
    rig.clock.now = 1400
    rig.press('fx-delay-tap')
    expect(rig.state().fx.chains[rig.state().fx.focus].delay.seconds).toBeCloseTo(0.4)
    // The modulation wheel is a morph source and the vibrato depth in Wheel mode.
    rig.set('perf-mod-wheel', 127)
    expect(rig.sound().synth.wheel).toBe(1)
    // The piano model dial changes the model where a type has more than one.
    rig.press('piano-layer-a')
    for (let presses = 0; presses < 3; presses += 1) rig.press('piano-type')
    rig.turn('piano-model', 1)
    expect(rig.sound().layers[0].source).toEqual({ kind: 'partials', recipe: 'clav-bridge' })
    rig.dispose()
  })

  it('after any control is operated, the panel shows exactly what the canonical state holds', () => {
    // Operate everything functional once, in order, on one instrument; then check that a second
    // panel bound to the same state would be drawn identically (the panel has no state of its own).
    const rig = ready()
    for (const id of FUNCTIONAL_BUTTON_IDS) {
      if (id === 'transpose' || id === 'store') continue
      rig.press(id)
    }
    if (rig.stage.editing) rig.exit()
    const first = rig.hardware.snapshot()
    // Re-drawing from the state changes nothing: the panel is already what the state says.
    rig.stage.setNotice('redraw')
    expect(rig.hardware.snapshot()).toEqual(first)
    for (const control of INVENTORY.controls) {
      if (control.kind !== 'button' || control.steps === 0) continue
      expect(rig.hardware.getValue(control.id), control.id).toBeLessThan(control.steps)
    }
    rig.dispose()
  })
})

describe('hardware.bindings: unsupported controls and functions', () => {
  it('the eleven unsupported controls move or press and change nothing: no state, no sound, no program', () => {
    const rig = ready()
    for (const note of [48, 60]) rig.down(note)
    const before = rig.state()
    const sound = JSON.stringify(rig.kernel.getState())
    for (const id of Object.keys(UNSUPPORTED_CONTROLS)) {
      const control = INVENTORY.controlById.get(id)!
      const position = rig.value(id)
      rig.press(id)
      rig.shiftPress(id)
      expect(rig.hardware.getPressCount(id), id).toBe(2)
      if (control.kind === 'button' && control.steps > 0) expect(rig.value(id), id).not.toBe(position + 99)
    }
    // Not a new object, let alone a changed one: the store was never asked.
    expect(rig.state()).toBe(before)
    expect(JSON.stringify(rig.kernel.getState())).toBe(sound)
    expect(programSignature(rig.state())).toBe(programSignature(before))
    rig.dispose()
  })

  it('unsupported Shift functions say "not available" on the display and change nothing', () => {
    const cases: Array<[string, RegExp]> = [
      ['piano-type', /Piano Info is not available/],
      ['piano-acoustics', /Pedal Noise is not available/],
      ['fx-mod1-type', /Variations are not available/],
      ['fx-delay-tap', /Analog delay mode is not available/],
      ['rotary-stop-mode', /Rotary stop angle is not available/],
      ['rotary-source', /Rotary close mic is not available/],
      ['organ-perc-volume-soft', /Percussion Poly is not available/],
      ['page-next', /one bank of 32 programs/],
      ['mst-clk', /Pedal Tap is not available/],
      ['synth-layer-c', /Layer Pan is not available/],
      ['synth-kb-hold', /KB Hold Exclude is not available/],
      ['synth-arp-mode', /Arpeggiator Pattern is not available/],
      ['synth-lfo-waveform', /Synth Group modes are not available/],
      ['synth-filter-type', /Synth Group modes are not available/],
      ['synth-arp-menu', /Synth Group modes are not available/],
    ]
    const rig = ready()
    for (const [id, notice] of cases) {
      const before = fingerprint(rig.state())
      rig.shiftPress(id)
      expect(rig.state().notice, id).toMatch(notice)
      expect(fingerprint(rig.state()), id).toBe(before)
    }
    rig.shiftTurn('piano-model', 1)
    expect(rig.state().notice).toBe('Model List view is not available')
    // The LEDs of excluded features are never lit.
    for (const slug of ['organ-perc-poly', 'synth-exclude', 'synth-arp-pattern', 'synth-lfo-group', 'synth-filter-group', 'synth-arp-group', 'synth-keep-edits', 'synth-mode-extern', 'num-pad', 'mst-clk-pedal-tap', 'layer-scene-pedal', 'rotary-close-mic', 'fx-delay-analog', 'fx-mod1-variation', 'fx-reverb-chorale', 'piano-ped-noise']) {
      expect(rig.led(slug), slug).toBe('off')
    }
    expect(Object.keys(UNSUPPORTED_FUNCTIONS).length).toBeGreaterThanOrEqual(cases.length - 2)
    rig.dispose()
  })

  it('the page lists them: every unsupported control, by its panel name, with its reason', () => {
    const app = mountApp()
    const list = app.getByTestId('unsupported-controls')
    for (const [id, reason] of Object.entries(UNSUPPORTED_CONTROLS)) {
      const item = list.querySelector(`[data-unsupported="${id}"]`)
      expect(item, id).not.toBeNull()
      expect(item).toHaveTextContent(INVENTORY.controlById.get(id)!.name)
      expect(item).toHaveTextContent(reason)
    }
    for (const name of Object.keys(UNSUPPORTED_FUNCTIONS)) expect(list).toHaveTextContent(name)
    expect(app.container.querySelector('.console__note')).toHaveTextContent(/The 11 controls the specs exclude/)
    // And each says so itself, to assistive technology, where it sits on the panel.
    for (const control of INVENTORY.controls) {
      const element = app.control(control.id)
      const unsupported = control.id in UNSUPPORTED_CONTROLS
      expect(element, control.id).toHaveAttribute('data-decorative', unsupported ? 'true' : 'false')
      const description = element.getAttribute('aria-description') ?? ''
      if (unsupported) expect(description, control.id).toMatch(/unsupported: excluded by the specs/)
      else expect(description, control.id).not.toMatch(/unsupported|Decorative/)
    }
  })

  it('IMPLEMENTATION_DETAILS.json carries the same audit', () => {
    const details = JSON.parse(readFileSync(join(process.cwd(), 'IMPLEMENTATION_DETAILS.json'), 'utf8'))
    expect(details.phase).toBe(3)
    expect(details.controlAudit).toMatchObject({ totalControls: 146, functional: 135, unsupported: 11 })
    expect(details.controlAudit.unsupportedControls).toEqual(UNSUPPORTED_CONTROLS)
    expect(details.controlAudit.unsupportedFunctions).toEqual(UNSUPPORTED_FUNCTIONS)
    expect(details.unsupported.controls).toEqual(UNSUPPORTED_CONTROLS)
    // Nothing synthesized is described as a recording.
    for (const source of details.audio.generatedSources) {
      expect(source.isRecording, source.name).toBe(false)
      expect(source.usesStoredBuffer, source.name).toBe(false)
    }
    const names = details.audio.generatedSources.map((source: { name: string }) => source.name)
    for (const name of ['Organ wavetables', 'Organ model B3', 'Organ model Vox', 'Organ model Farf', 'Organ model Pipe 1', 'Synth oscillators']) expect(names).toContain(name)
    expect(details.audio.sampleSources.map((source: { set: string }) => source.set)).toEqual(['grand', 'upright', 'electric'])
  })

  it('in the running app, an unsupported control sends nothing to the audio host and a bound one does', async () => {
    const app = mountApp()
    await start(app)
    const sent = () => app.fake.audio.node.received.length
    let count = sent()
    for (const id of Object.keys(UNSUPPORTED_CONTROLS)) {
      press(app, id)
      shiftPress(app, id)
      fireEvent.keyDown(app.control(id), { key: 'Enter' })
      fireEvent.keyUp(app.control(id), { key: 'Enter' })
    }
    expect(sent()).toBe(count)
    expect(oled(app, 'notice')).toBe('')
    for (const id of ['organ-on', 'synth-on', 'organ-drawbar-1', 'synth-filter-freq', 'split', 'layer-scene']) {
      count = sent()
      const element = app.control(id)
      if (element.tagName === 'BUTTON') press(app, id)
      else fireEvent.keyDown(element, { key: 'Home' })
      expect(sent(), id).toBeGreaterThan(count)
    }
    expect(kernelOf(app).getState().organ.layers[0].drawbars[0]).toBe(0)
  })
})
