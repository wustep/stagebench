import { describe, expect, it } from 'vitest'
import { factoryPrograms } from '../src/programs/factory'
import { programDisplay } from '../src/state/display'
import { PROGRAM_COUNT, PROGRAM_PAGES, PROGRAMS_PER_PAGE, slotLabel } from '../src/state/model'
import { mountApp } from './support/app'
import { keys, led, oled, press, shiftPress, start, kernelOf } from './support/panel'
import { makeRig } from './support/rig'

/**
 * Feature: programs.navigation
 * Program buttons, pages, dial, and the numeric list view.
 */

const NAMES = factoryPrograms().map((program) => program.name)

describe('programs.navigation: 32 slots, four pages of eight', () => {
  it('slots are numbered page.button, 1.1 to 4.8', () => {
    expect([PROGRAM_PAGES, PROGRAMS_PER_PAGE, PROGRAM_COUNT]).toEqual([4, 8, 32])
    expect(slotLabel({ live: false, slot: 0 })).toBe('1.1')
    expect(slotLabel({ live: false, slot: 7 })).toBe('1.8')
    expect(slotLabel({ live: false, slot: 8 })).toBe('2.1')
    expect(slotLabel({ live: false, slot: 17 })).toBe('3.2')
    expect(slotLabel({ live: false, slot: 31 })).toBe('4.8')
    expect(slotLabel({ live: true, slot: 2 })).toBe('LIVE 3')
  })

  it('the eight Program buttons select the eight programs of the page, and light up', () => {
    const rig = makeRig()
    for (let button = 1; button <= 8; button += 1) {
      rig.press(`program-${button}`)
      expect(rig.state().nav).toMatchObject({ live: false, slot: button - 1, dirty: false })
      expect(rig.state().name).toBe(NAMES[button - 1])
      for (let other = 1; other <= 8; other += 1) expect(rig.led(`program-${other}`)).toBe(other === button ? 'on' : 'off')
    }
    rig.dispose()
  })

  it('the Page buttons move through the four pages, keeping the button, and wrap round', () => {
    const rig = makeRig()
    rig.press('program-3')
    const visited: number[] = []
    for (let presses = 0; presses < 4; presses += 1) {
      rig.press('page-next')
      visited.push(rig.state().nav.slot)
      expect(rig.led('program-3')).toBe('on')
      expect(rig.state().name).toBe(NAMES[rig.state().nav.slot])
    }
    expect(visited).toEqual([10, 18, 26, 2])
    rig.press('page-prev')
    expect(rig.state().nav.slot).toBe(26)
    // A Program button now selects on the page that is showing.
    rig.press('program-8')
    expect(rig.state().nav.slot).toBe(31)
    expect(rig.state().notice).toBe('4.8 Init 4.8')
    rig.dispose()
  })

  it('the Program dial steps through all 32 in order and stops at either end', () => {
    const rig = makeRig()
    const seen: number[] = []
    for (let detent = 0; detent < 40; detent += 1) {
      rig.turn('program-dial', 1)
      seen.push(rig.state().nav.slot)
    }
    expect(seen.slice(0, 31)).toEqual(Array.from({ length: 31 }, (_, index) => index + 1))
    expect(seen.slice(31).every((slot) => slot === 31)).toBe(true)
    rig.turn('program-dial', -3)
    expect(rig.state().nav.slot).toBe(28)
    rig.turn('program-dial', -40)
    expect(rig.state().nav.slot).toBe(0)
    expect(rig.state().name).toBe('Grand Piano')
    // The lit Program button follows the dial across pages.
    rig.turn('program-dial', 9)
    expect(rig.led('program-2')).toBe('on')
    expect(rig.text('program-dial')).toBe(`Program 2.2: ${NAMES[9]}`)
    rig.dispose()
  })

  it('loading a program changes the sound to that program', () => {
    const rig = makeRig()
    expect(rig.sound().layers[0].on).toBe(true)
    rig.press('program-2')
    expect(rig.sound().layers[0].on).toBe(false)
    expect(rig.sound().organ.layers[0]).toMatchObject({ on: true, drawbars: [8, 8, 8, 0, 0, 0, 0, 0, 0] })
    expect(rig.sound().organ.toRotary).toBe(true)
    rig.press('program-3')
    expect(rig.sound().organ.layers[0].on).toBe(false)
    expect(rig.sound().synth.layers[0].on).toBe(true)
    // The display turns to the section the program uses.
    expect(rig.state().ui.section).toBe('synth')
    rig.press('program-1')
    expect(rig.state().ui.section).toBe('piano')
    rig.dispose()
  })
})

describe('programs.navigation: the numeric list view', () => {
  it('Shift + the Program dial opens a numbered list of all 32 programs', () => {
    const rig = makeRig()
    rig.shiftTurn('program-dial', 1)
    expect(rig.state().ui.mode).toBe('list')
    expect(rig.state().ui.listCursor).toBe(1)
    const view = programDisplay(rig.state(), rig.stage.bank)
    expect(view.header).toBe('PROGRAM LIST 2/32')
    expect(view.rows).toEqual([' 1.1 Grand Piano', '>1.2 Tonewheel B3', ' 1.3 Saw Lead', ' 1.4 Bass/Piano Split', ' 1.5 Piano + Pad', ' 1.6 Reed EP Tremolo'])
    // Every one of the 32 appears, in numeric order, as the list is scrolled.
    const listed = new Set<string>()
    rig.turn('program-dial', -5)
    for (let detent = 0; detent < PROGRAM_COUNT; detent += 1) {
      for (const row of programDisplay(rig.state(), rig.stage.bank).rows) listed.add(row.slice(1))
      rig.turn('program-dial', 1)
    }
    expect([...listed]).toEqual(NAMES.map((name, slot) => `${slotLabel({ live: false, slot })} ${name}`))
    rig.dispose()
  })

  it('moving through the list loads what it highlights; Page jumps a page; Exit closes it', () => {
    const rig = makeRig()
    rig.shiftTurn('program-dial', 2)
    expect(rig.state().nav.slot).toBe(2)
    expect(rig.state().name).toBe('Saw Lead')
    expect(rig.sound().synth.layers[0].on).toBe(true)
    rig.turn('program-dial', 3)
    expect(rig.state().ui.mode).toBe('list')
    expect(rig.state().nav.slot).toBe(5)
    rig.press('page-next')
    expect(rig.state().ui.listCursor).toBe(13)
    expect(rig.state().nav.slot).toBe(13)
    rig.press('page-prev')
    rig.press('page-prev')
    expect(rig.state().ui.listCursor).toBe(0)
    rig.exit()
    expect(rig.state().ui.mode).toBe('play')
    expect(rig.state().nav.slot).toBe(0)
    // A Program button picks directly and closes the list.
    rig.shiftTurn('program-dial', 1)
    rig.press('program-6')
    expect(rig.state().ui.mode).toBe('play')
    expect(rig.state().nav.slot).toBe(5)
    rig.dispose()
  })

  it('on the display: the list page, its cursor, and the program bar on the playing page', async () => {
    const app = mountApp()
    await start(app)
    const display = app.control('program-oled')
    expect(display.querySelector('[data-line="program-name"]')).toHaveTextContent('1.1 Grand Piano')
    expect(display).toHaveAttribute('data-mode', 'play')
    press(app, 'program-3')
    expect(display.querySelector('[data-line="program-name"]')).toHaveTextContent('1.3 Saw Lead')
    expect(oled(app, 'layers')).toBe('SYNTH A:PURE<  B:OFF  C:OFF')
    expect(oled(app, 'model')).toBe('Saw')
    expect(led(app, 'program-3')).toBe('on')
    expect(kernelOf(app).getState().synth.layers[0].on).toBe(true)
    press(app, 'page-next')
    expect(app.control('program-oled').querySelector('[data-line="program-name"]')).toHaveTextContent('2.3 Sync Sweep')

    // Hold Shift and turn the dial: the list.
    const dial = app.control('program-dial')
    app.fake.events.key('down', 'ShiftLeft')
    keys(app, 'program-dial', 'ArrowUp')
    app.fake.events.key('up', 'ShiftLeft')
    const list = app.control('program-oled')
    expect(list).toHaveAttribute('data-mode', 'list')
    expect(list.querySelector('[data-line="program-name"]')).toHaveTextContent('PROGRAM LIST 12/32')
    expect(list.textContent).toContain('>2.4 FM Bells')
    expect(list.textContent).toContain(' 2.3 Sync Sweep')
    keys(app, 'program-dial', 'ArrowDown', 'ArrowDown')
    expect(app.control('program-oled').textContent).toContain('>2.2 Pipe Organ')
    expect(dial.getAttribute('data-value-text')).toBe('Program 2.2: Pipe Organ')
    shiftPress(app, 'store')
    expect(app.control('program-oled')).toHaveAttribute('data-mode', 'name')
  })

  it('in Live Mode the Program buttons and dial move through the 8 Live slots; pages and list say why they do not apply', () => {
    const rig = makeRig()
    rig.press('live-mode')
    rig.turn('program-dial', 20)
    expect(rig.state().nav).toMatchObject({ live: true, slot: 7 })
    rig.turn('program-dial', -2)
    expect(rig.state().nav).toMatchObject({ live: true, slot: 5 })
    rig.press('page-next')
    expect(rig.state().nav).toMatchObject({ live: true, slot: 5 })
    expect(rig.state().notice).toBe('The Live slots are a single page')
    rig.shiftTurn('program-dial', 1)
    expect(rig.state().ui.mode).toBe('play')
    expect(rig.state().notice).toMatch(/leave Live Mode/)
    rig.shiftPress('page-next')
    expect(rig.state().notice).toBe('There is one bank of 32 programs')
    rig.dispose()
  })
})
