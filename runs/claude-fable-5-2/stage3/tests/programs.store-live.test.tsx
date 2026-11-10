import { describe, expect, it } from 'vitest'
import { PROGRAM_STORAGE_KEY } from '../src/programs/bank'
import { factoryLive, factoryPrograms } from '../src/programs/factory'
import { LIVE_COUNT, NAME_LENGTH, extractProgram, programSignature } from '../src/state/model'
import { StageStore } from '../src/state/store'
import { mountApp } from './support/app'
import { FakeStorage } from './support/fakes'
import { down, keys, kernelOf, led, oled, press, render, shiftPress, start, up } from './support/panel'
import { makeRig } from './support/rig'
import { magnitudeAt, mono, rms } from './support/signal'

/**
 * Feature: programs.store-live
 * Store, Store As with naming, and the 8 auto-storing Live slots.
 */

describe('programs.store-live: Store', () => {
  it('Store once shows the destination and flashes; Store again writes it', () => {
    const storage = new FakeStorage()
    const rig = makeRig(storage)
    rig.set('fx-reverb-mix', 9)
    rig.press('fx-reverb-on')
    rig.press('store')
    expect(rig.state().ui.mode).toBe('store')
    expect(rig.state().ui.store.dest).toEqual({ live: false, slot: 0 })
    expect(rig.led('store')).toBe('blink')
    expect(rig.led('program-1')).toBe('blink')
    // Nothing is written until the second press.
    expect(storage.data.has(PROGRAM_STORAGE_KEY)).toBe(false)
    expect(rig.stage.bank.get({ live: false, slot: 0 }).fx.chains[0].reverb.on).toBe(false)
    rig.press('store')
    expect(rig.state().ui.mode).toBe('play')
    expect(rig.led('store')).toBe('off')
    expect(rig.state().nav.dirty).toBe(false)
    expect(rig.stage.bank.get({ live: false, slot: 0 }).fx.chains[0].reverb).toMatchObject({ on: true, mix: 9 })
    expect(storage.data.has(PROGRAM_STORAGE_KEY)).toBe(true)
    expect(rig.state().notice).toBe('Stored to 1.1 Grand Piano')
    rig.dispose()
  })

  it('the destination is chosen with the dial, the Page buttons, and the Program buttons', () => {
    const rig = makeRig()
    rig.press('fx-reverb-on')
    rig.press('store')
    rig.turn('program-dial', 3)
    expect(rig.state().ui.store.dest).toEqual({ live: false, slot: 3 })
    rig.press('page-next')
    expect(rig.state().ui.store.dest).toEqual({ live: false, slot: 11 })
    rig.press('program-7')
    expect(rig.state().ui.store.dest).toEqual({ live: false, slot: 14 })
    expect(rig.led('program-7')).toBe('blink')
    rig.press('page-prev')
    rig.press('page-prev')
    expect(rig.state().ui.store.dest).toEqual({ live: false, slot: 30 })
    // The loaded program has not moved while choosing.
    expect(rig.state().nav.slot).toBe(0)
    rig.press('store')
    expect(rig.state().nav).toMatchObject({ live: false, slot: 30, dirty: false })
    expect(rig.stage.bank.name({ live: false, slot: 30 })).toBe('Grand Piano')
    expect(rig.stage.bank.get({ live: false, slot: 30 }).fx.chains[0].reverb.on).toBe(true)
    // The slot it came from still holds what it held.
    expect(rig.stage.bank.get({ live: false, slot: 0 }).fx.chains[0].reverb.on).toBe(false)
    rig.dispose()
  })

  it('the program already at the destination can be auditioned from the keys before it is overwritten', () => {
    const rig = makeRig()
    // Editing program 1.1 (a piano); destination 1.2 is the organ program.
    rig.press('store')
    rig.down(60)
    const own = rig.sound()
    expect(own.layers[0].on).toBe(true)
    rig.turn('program-dial', 1)
    expect(rig.state().ui.audition?.name).toBe('Tonewheel B3')
    const heard = rig.sound()
    expect(heard.layers[0].on).toBe(false)
    expect(heard.organ.layers[0].on).toBe(true)
    // The edit buffer is untouched underneath: the canonical state is still the piano.
    expect(rig.state().piano.on).toBe(true)
    expect(rig.state().organ.on).toBe(false)
    // Back on its own slot, it hears itself again.
    rig.turn('program-dial', -1)
    expect(rig.state().ui.audition).toBeNull()
    expect(rig.sound().layers[0].on).toBe(true)
    rig.exit()
    expect(rig.sound().organ.layers[0].on).toBe(false)
    rig.dispose()
  })

  it('auditioning is audible: the organ at the destination sounds, then the piano again after storing', async () => {
    const app = mountApp()
    await start(app)
    press(app, 'store')
    keys(app, 'program-dial', 'ArrowUp')
    expect(oled(app, 'big')).toBe('1.2 Tonewheel B3')
    expect(app.control('program-oled')).toHaveAttribute('data-mode', 'store')
    down(app, 60)
    const auditioned = mono(render(app, 0.5))
    // A tonewheel organ holds its level; the piano would be decaying and has no 16 foot sub-octave.
    expect(magnitudeAt(auditioned.subarray(12000), 130.81)).toBeGreaterThan(0.01)
    expect(kernelOf(app).organLayer(0).keyCount).toBe(1)
    up(app, 60)
    press(app, 'store')
    expect(app.control('program-oled')).toHaveAttribute('data-mode', 'play')
    expect(oled(app, 'notice')).toBe('> STORED TO 1.2 GRAND PIANO')
    render(app, 0.5)
    down(app, 60)
    render(app, 0.3)
    expect(kernelOf(app).organLayer(0).keyCount).toBe(0)
    expect(kernelOf(app).layerVoiceCount(0)).toBeGreaterThan(0)
  })
})

describe('programs.store-live: Store As', () => {
  it('Shift + Store opens naming; the dial enters characters, Page moves the cursor', () => {
    const rig = makeRig()
    rig.shiftPress('store')
    expect(rig.state().ui.mode).toBe('name')
    expect(rig.state().ui.store).toMatchObject({ name: 'Grand Piano', cursor: 0, naming: true })
    // G is the 7th capital: one detent on gives H.
    rig.turn('program-dial', 1)
    expect(rig.state().ui.store.name.startsWith('Hrand')).toBe(true)
    rig.press('page-next')
    rig.press('page-next')
    expect(rig.state().ui.store.cursor).toBe(2)
    rig.turn('program-dial', -1)
    // 'a' sits right after 'Z' in the character row; one detent back is 'Z'.
    expect(rig.state().ui.store.name.startsWith('HrZnd')).toBe(true)
    rig.press('page-prev')
    expect(rig.state().ui.store.cursor).toBe(1)
    // The loaded program keeps its name until the store is confirmed.
    expect(rig.state().name).toBe('Grand Piano')
    rig.dispose()
  })

  it('Insert and Delete (Program buttons 1 and 2) open and close a gap at the cursor', () => {
    const rig = makeRig()
    rig.shiftPress('store')
    rig.press('program-1')
    expect(rig.state().ui.store.name.trimEnd()).toBe(' Grand Piano')
    rig.press('program-2')
    rig.press('program-2')
    expect(rig.state().ui.store.name.trimEnd()).toBe('rand Piano')
    rig.stage.setStoreName('A name that is far too long for the display')
    expect(rig.state().ui.store.name).toHaveLength(NAME_LENGTH)
    rig.dispose()
  })

  it('Store then moves on to the destination, and Store again writes the program under the new name', () => {
    const storage = new FakeStorage()
    const rig = makeRig(storage)
    rig.press('fx-delay-on')
    rig.shiftPress('store')
    rig.stage.setStoreName('Echo Grand')
    rig.press('store')
    expect(rig.state().ui.mode).toBe('store')
    rig.press('page-next')
    rig.press('program-5')
    rig.press('store')
    expect(rig.state().name).toBe('Echo Grand')
    expect(rig.state().nav).toMatchObject({ slot: 12, dirty: false })
    expect(rig.stage.bank.name({ live: false, slot: 12 })).toBe('Echo Grand')
    expect(rig.stage.bank.names()[12]).toBe('Echo Grand')
    // After a reload the name and the sound are both there.
    const reloaded = new StageStore({ storage })
    reloaded.load({ live: false, slot: 12 })
    expect(reloaded.getState().name).toBe('Echo Grand')
    expect(reloaded.getState().fx.chains[0].delay.on).toBe(true)
    // Only the slot that was stored to is written; the factory content is not copied into storage.
    const written = JSON.parse(storage.data.get(PROGRAM_STORAGE_KEY)!)
    expect(Object.keys(written.programs)).toEqual(['12'])
    rig.dispose()
  })

  it('the naming page shows the name, the cursor, and the character row', () => {
    const app = mountApp()
    shiftPress(app, 'store')
    const display = app.control('program-oled')
    expect(display).toHaveAttribute('data-mode', 'name')
    expect(display.querySelector('[data-line="program-name"]')).toHaveTextContent('STORE PROGRAM AS')
    expect(oled(app, 'big').replace(/·/g, ' ').trimEnd()).toBe('Grand Piano')
    expect(display.querySelector('[data-line="row-1"]')?.textContent).toContain('[G]')
    keys(app, 'program-dial', 'ArrowUp', 'ArrowUp')
    expect(display.querySelector('[data-line="row-1"]')?.textContent).toContain('[I]')
    expect(oled(app, 'big').startsWith('Irand')).toBe(true)
    expect(led(app, 'store')).toBe('blink')
  })
})

describe('programs.store-live: Live Mode', () => {
  it('Live Mode turns the eight Program buttons into the eight Live slots', () => {
    const rig = makeRig()
    rig.press('program-3')
    expect(rig.state().nav).toMatchObject({ live: false, slot: 2 })
    rig.press('live-mode')
    expect(rig.state().nav).toMatchObject({ live: true, slot: 0 })
    expect(rig.led('live-mode')).toBe('on')
    expect(rig.state().name).toBe(factoryLive()[0].name)
    for (let button = 1; button <= LIVE_COUNT; button += 1) {
      rig.press(`program-${button}`)
      expect(rig.state().nav).toMatchObject({ live: true, slot: button - 1 })
      expect(rig.led(`program-${button}`)).toBe('on')
      expect(rig.state().name).toBe(factoryLive()[button - 1].name)
    }
    // Leaving Live Mode returns to the program that was loaded before.
    rig.press('live-mode')
    expect(rig.state().nav).toMatchObject({ live: false, slot: 2 })
    expect(rig.led('live-mode')).toBe('off')
    // And Live Mode remembers which slot it was on.
    rig.press('live-mode')
    expect(rig.state().nav).toMatchObject({ live: true, slot: 7 })
    rig.dispose()
  })

  it('every edit in a Live slot is stored as it is made: there is no E, and nothing to confirm', () => {
    const storage = new FakeStorage()
    const rig = makeRig(storage)
    rig.press('live-mode')
    rig.press('program-4')
    expect(storage.data.has(PROGRAM_STORAGE_KEY)).toBe(false)
    rig.set('fx-reverb-mix', 8.5)
    rig.press('fx-reverb-on')
    rig.press('piano-layer-b')
    expect(rig.state().nav.dirty).toBe(false)
    const stored = rig.stage.bank.get({ live: true, slot: 3 })
    expect(stored.fx.chains[0].reverb).toMatchObject({ on: true, mix: 8.5 })
    expect(stored.piano.layers[1].on).toBe(true)
    expect(programSignature(stored)).toBe(programSignature(extractProgram(rig.state())))
    expect(Object.keys(JSON.parse(storage.data.get(PROGRAM_STORAGE_KEY)!).live)).toEqual(['3'])
    // Go away and come back: the edits are there.
    rig.press('program-1')
    rig.press('program-4')
    expect(rig.state().fx.chains[0].reverb.mix).toBe(8.5)
    expect(rig.state().piano.layers[1].on).toBe(true)
    rig.dispose()
  })

  it('Live edits survive a reload', () => {
    const storage = new FakeStorage()
    const first = makeRig(storage)
    first.press('live-mode')
    first.press('program-6')
    first.press('synth-on')
    first.set('synth-filter-freq', 8.1)
    first.stage.setBpm(97)
    const signature = programSignature(extractProgram(first.state()))
    first.dispose()

    const second = makeRig(storage)
    // A fresh session starts on program 1.1, outside Live Mode…
    expect(second.state().nav).toMatchObject({ live: false, slot: 0 })
    second.press('live-mode')
    second.press('program-6')
    // …and Live slot 6 is exactly as it was left.
    expect(programSignature(extractProgram(second.state()))).toBe(signature)
    expect(second.state().synth.layers[0].filter.freq).toBe(8.1)
    expect(second.state().clock.bpm).toBe(97)
    second.dispose()
  })

  it('outside Live Mode nothing stores itself: a program slot only changes on Store', () => {
    const storage = new FakeStorage()
    const rig = makeRig(storage)
    rig.set('fx-reverb-mix', 9)
    rig.press('organ-on')
    expect(storage.data.size).toBe(0)
    expect(programSignature(rig.stage.bank.get({ live: false, slot: 0 }))).toBe(programSignature(factoryPrograms()[0]))
    rig.dispose()
  })

  it('a program can be copied into a Live slot, and a Live slot into a program slot, with Store', () => {
    const rig = makeRig()
    // Program 1.3 into Live slot 5: Store, Live Mode, Program 5, Store.
    rig.press('program-3')
    const source = programSignature(extractProgram(rig.state()))
    rig.press('store')
    rig.press('live-mode')
    expect(rig.state().ui.store.dest.live).toBe(true)
    expect(rig.led('live-mode')).toBe('on')
    rig.press('program-5')
    rig.press('store')
    expect(rig.state().nav).toMatchObject({ live: true, slot: 4 })
    expect(programSignature(rig.stage.bank.get({ live: true, slot: 4 }))).toBe(source)
    // Edit it there (auto-stored), then copy it to program slot 4.8.
    rig.press('fx-delay-on')
    const edited = programSignature(extractProgram(rig.state()))
    rig.press('store')
    rig.press('live-mode')
    expect(rig.state().ui.store.dest.live).toBe(false)
    rig.turn('program-dial', 40)
    expect(rig.state().ui.store.dest).toEqual({ live: false, slot: 31 })
    rig.press('store')
    expect(rig.state().nav).toMatchObject({ live: false, slot: 31 })
    expect(programSignature(rig.stage.bank.get({ live: false, slot: 31 }))).toBe(edited)
    expect(rig.led('live-mode')).toBe('off')
    rig.dispose()
  })

  it('the display and the audio follow Live Mode', async () => {
    const app = mountApp()
    await start(app)
    press(app, 'live-mode')
    expect(app.control('program-oled').querySelector('[data-line="program-name"]')).toHaveTextContent('LIVE 1 Grand Piano')
    expect(app.getByTestId('program-edited')).toHaveTextContent(/Live Mode: edits are stored as they are made/)
    press(app, 'program-2')
    expect(app.control('program-oled').querySelector('[data-line="program-name"]')).toHaveTextContent('LIVE 2 Tonewheel B3')
    down(app, 60)
    expect(rms(render(app, 0.3).left)).toBeGreaterThan(0.005)
    expect(kernelOf(app).organLayer(0).keyCount).toBe(1)
    up(app, 60)
    // Its edits reach the platform's storage.
    keys(app, 'organ-drawbar-1', 'Home')
    const written = JSON.parse(app.fake.storage.data.get(PROGRAM_STORAGE_KEY)!)
    expect(written.live['1'].organ.layers[0].drawbars[0]).toBe(0)
  })
})
