import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { UNSUPPORTED_CONTROLS } from '../src/hardware/functional'
import { PROGRAM_STORAGE_KEY } from '../src/programs/bank'
import { factoryPrograms } from '../src/programs/factory'
import { extractProgram, programSignature } from '../src/state/model'
import { mountApp } from './support/app'
import { FakeStorage } from './support/fakes'
import { keys, kernelOf, oled, press, start, value } from './support/panel'
import { makeRig, scramble } from './support/rig'

/**
 * Feature: programs.undo-cancel
 * Edit-discard on program change and any claimed undo restores the documented prior state.
 *
 * No Undo is claimed: Shift + Solo (UNDO on the panel) belongs to the optional list and is not
 * implemented, and these tests check that the app says so rather than pretending. What is
 * implemented and tested is the documented behaviour without undo: unsaved edits are discarded
 * when another program is selected, and a Store can be cancelled without writing anything.
 */

describe('programs.undo-cancel: edits are discarded on program change', () => {
  it('selecting another program drops unsaved edits; coming back loads what was stored', () => {
    const rig = makeRig()
    const stored = programSignature(factoryPrograms()[0])
    scramble(rig, 4)
    expect(rig.state().nav.dirty).toBe(true)
    expect(programSignature(extractProgram(rig.state()))).not.toBe(stored)
    rig.press('program-2')
    expect(rig.state().nav).toMatchObject({ slot: 1, dirty: false })
    expect(rig.state().notice).toBe('1.2 Tonewheel B3 (edits discarded)')
    rig.press('program-1')
    expect(programSignature(extractProgram(rig.state()))).toBe(stored)
    expect(rig.state().nav.dirty).toBe(false)
    // The memory itself was never touched.
    expect(programSignature(rig.stage.bank.get({ live: false, slot: 0 }))).toBe(stored)
    rig.dispose()
  })

  it('the same holds for the dial, the Page buttons, the list, and entering Live Mode', () => {
    const leave: Array<[string, (rig: ReturnType<typeof makeRig>) => void]> = [
      ['dial', (rig) => rig.turn('program-dial', 1)],
      ['page', (rig) => rig.press('page-next')],
      ['list', (rig) => rig.shiftTurn('program-dial', 2)],
      ['live', (rig) => rig.press('live-mode')],
    ]
    for (const [name, go] of leave) {
      const rig = makeRig()
      rig.set('fx-reverb-mix', 9.9)
      rig.press('synth-on')
      go(rig)
      expect(rig.state().nav.dirty, name).toBe(false)
      rig.stage.load({ live: false, slot: 0 })
      expect(rig.state().fx.chains[0].reverb.mix, name).toBe(6.5)
      expect(rig.state().synth.on, name).toBe(false)
      rig.dispose()
    }
  })

  it('re-selecting the loaded program reloads it: that is how an edit is thrown away on purpose', () => {
    const rig = makeRig()
    rig.set('piano-layer-a-level', 20)
    rig.press('fx-comp-on')
    rig.press('program-1')
    expect(rig.state().piano.layers[0].level).toBe(100)
    expect(rig.state().fx.chains[0].comp.on).toBe(false)
    expect(rig.value('piano-layer-a-level')).toBe(100)
    expect(rig.state().nav.dirty).toBe(false)
    rig.dispose()
  })

  it('the panel and the sound both go back, not just the flag', async () => {
    const app = mountApp()
    await start(app)
    keys(app, 'fx-reverb-mix', 'End')
    press(app, 'fx-reverb-on')
    press(app, 'piano-type')
    expect(kernelOf(app).getState().layers[0].fx.reverb).toMatchObject({ on: true, mix: 1 })
    expect(oled(app, 'model')).toBe('Kawai Upright KW')
    press(app, 'program-2')
    press(app, 'program-1')
    expect(value(app, 'fx-reverb-mix')).toBe(6.5)
    expect(kernelOf(app).getState().layers[0].fx.reverb).toMatchObject({ on: false, mix: 0.65 })
    expect(oled(app, 'model')).toBe('Salamander Grand')
    expect(app.control('program-oled').querySelector('[data-line="edited"]')).toBeNull()
  })

  it('a stored edit is not discarded: only what was never stored is lost', () => {
    const rig = makeRig()
    rig.set('fx-reverb-mix', 9)
    rig.press('store')
    rig.press('store')
    rig.set('fx-reverb-mix', 2)
    rig.press('program-5')
    rig.press('program-1')
    expect(rig.state().fx.chains[0].reverb.mix).toBe(9)
    rig.dispose()
  })
})

describe('programs.undo-cancel: cancelling a Store', () => {
  it('Shift / Exit cancels a Store: nothing is written and the edits are still there, still unsaved', () => {
    const storage = new FakeStorage()
    const rig = makeRig(storage)
    rig.press('fx-delay-on')
    const edited = programSignature(extractProgram(rig.state()))
    rig.press('store')
    rig.turn('program-dial', 5)
    rig.exit()
    expect(rig.state().ui.mode).toBe('play')
    expect(rig.state().ui.audition).toBeNull()
    expect(rig.state().notice).toBe('Store cancelled')
    expect(rig.state().nav).toMatchObject({ live: false, slot: 0, dirty: true })
    expect(programSignature(extractProgram(rig.state()))).toBe(edited)
    expect(storage.data.has(PROGRAM_STORAGE_KEY)).toBe(false)
    expect(programSignature(rig.stage.bank.get({ live: false, slot: 5 }))).toBe(programSignature(factoryPrograms()[5]))
    // The auditioned destination no longer sounds.
    expect(rig.sound().layers[0].fx.delay.on).toBe(true)
    expect(rig.led('store')).toBe('off')
    rig.dispose()
  })

  it('a Store As can be cancelled from the naming page or from the destination page', () => {
    for (const steps of [1, 2]) {
      const rig = makeRig()
      rig.shiftPress('store')
      rig.turn('program-dial', 3)
      if (steps === 2) rig.press('store')
      rig.exit()
      expect(rig.state().ui.mode).toBe('play')
      expect(rig.state().name).toBe('Grand Piano')
      expect(rig.stage.bank.name({ live: false, slot: 0 })).toBe('Grand Piano')
      expect(rig.state().nav.dirty).toBe(false)
      rig.dispose()
    }
  })

  it('Exit leaves the list, split, clock, and transpose pages without changing the program', () => {
    const rig = makeRig()
    const before = programSignature(extractProgram(rig.state()))
    rig.shiftPress('split')
    expect(rig.state().ui.mode).toBe('split')
    rig.exit()
    rig.press('mst-clk')
    expect(rig.state().ui.mode).toBe('clock')
    rig.exit()
    expect(rig.state().ui.mode).toBe('play')
    expect(programSignature(extractProgram(rig.state()))).toBe(before)
    // Exit does not take back an edit made on a page: that is an edit like any other, and shows as E.
    rig.press('mst-clk')
    rig.turn('program-dial', 7)
    rig.exit()
    expect(rig.state().clock.bpm).toBe(127)
    expect(rig.state().nav.dirty).toBe(true)
    rig.dispose()
  })

  it('Exit is not a latch on an editing page, and is one again afterwards', () => {
    const rig = makeRig()
    rig.press('store')
    rig.exit()
    expect(rig.binder.shiftActive).toBe(false)
    expect(rig.state().ui.mode).toBe('play')
    // Outside an editing page a lone Shift press latches for the next control, as in Phase 2.
    rig.exit()
    expect(rig.binder.shiftActive).toBe(true)
    rig.press('store')
    expect(rig.state().ui.mode).toBe('name')
    rig.dispose()
  })
})

describe('programs.undo-cancel: no undo is claimed', () => {
  it('Solo (whose Shift function is UNDO) is listed as unsupported and changes nothing', () => {
    expect(UNSUPPORTED_CONTROLS.solo).toMatch(/optional/)
    const rig = makeRig()
    rig.set('fx-reverb-mix', 9)
    rig.press('program-2')
    const after = programSignature(extractProgram(rig.state()))
    rig.shiftPress('solo')
    rig.press('solo')
    expect(programSignature(extractProgram(rig.state()))).toBe(after)
    expect(rig.state().nav.slot).toBe(1)
    rig.dispose()
  })

  it('the implementation notes say that undo is not implemented', () => {
    const details = JSON.parse(readFileSync(join(process.cwd(), 'IMPLEMENTATION_DETAILS.json'), 'utf8'))
    expect(JSON.stringify(details.unsupported)).toMatch(/[Uu]ndo/)
    expect(JSON.stringify(details.scope.optionalNotImplemented)).toMatch(/undo/i)
    const app = mountApp()
    expect(app.getByTestId('unsupported-controls')).toHaveTextContent(/Solo/)
  })
})
