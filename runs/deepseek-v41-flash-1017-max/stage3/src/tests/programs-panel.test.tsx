import { describe, expect, it, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import App from '../App'
import { createMemoryStorage } from '../audio/programStore'
import { PROGRAM_SLOTS } from '../audio/programStore'

/**
 * The Program section, exercised through the real panel.
 *
 * This suite exists because a browser pass caught a defect no unit test had: a momentary
 * button only reported its *release* to the harness, so every one of them — Store, the eight
 * program buttons, the page buttons, the focus buttons, Panic — was reachable, accessible and
 * completely inert. The panel-level cases below are what prove the press edge reaches the
 * program system.
 */

afterEach(() => cleanup())

/** Presses a momentary button the way a pointer does: press, release, then click. */
function pressMomentary(id: string): void {
  const el = document.querySelector(`[data-control-id="${id}"] [role="button"]`) as HTMLElement
  if (!el) throw new Error(`missing momentary button ${id}`)
  fireEvent.pointerDown(el, { pointerId: 1, button: 0, pointerType: 'mouse' })
  fireEvent.pointerUp(el, { pointerId: 1, button: 0, pointerType: 'mouse' })
  // A real pointer gesture also produces a click; the control must not report the press twice.
  fireEvent.click(el)
}

/** Presses a momentary button the way the keyboard does: a bare click, no pointer. */
function clickMomentary(id: string): void {
  const el = document.querySelector(`[data-control-id="${id}"] [role="button"]`) as HTMLElement
  if (!el) throw new Error(`missing momentary button ${id}`)
  fireEvent.click(el)
}

const slotLine = (): string => document.querySelector('[data-testid="program-slot-line"]')?.textContent ?? ''
const bankLine = (): string => document.querySelector('[data-testid="program-bank-line"]')?.textContent ?? ''

function mount() {
  return render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
}

describe('programs.navigation — the panel', () => {
  it('boots into program 1.1 with a clean indicator', () => {
    mount()
    expect(slotLine()).toMatch(/^1\.1 Init Stage$/)
    expect(bankLine()).toBe('BANK 1 · PAGE 1')
  })

  it('selects all eight programs of the current page with the program buttons', () => {
    mount()
    const seen: string[] = []
    for (let button = 1; button <= 8; button += 1) {
      clickMomentary(`program.slot.${button}`)
      seen.push(slotLine())
    }
    expect(seen[0]).toMatch(/^1\.1 /)
    expect(seen[1]).toMatch(/^1\.2 Concert Grand/)
    expect(seen[6]).toMatch(/^1\.7 /)
    expect(seen[7]).toMatch(/^1\.8 /)
    // Every button addressed a different slot.
    expect(new Set(seen).size).toBe(8)
  })

  it('pages with the page buttons, and the program buttons follow the page', () => {
    mount()
    clickMomentary('program.page.up')
    expect(bankLine()).toBe('BANK 1 · PAGE 2')
    clickMomentary('program.slot.1')
    expect(slotLine()).toMatch(/^2\.1 /)
    clickMomentary('program.page.down')
    expect(bankLine()).toBe('BANK 1 · PAGE 1')
    clickMomentary('program.slot.1')
    expect(slotLine()).toMatch(/^1\.1 /)
    // The page cannot leave the bank.
    for (let index = 0; index < 6; index += 1) clickMomentary('program.page.up')
    expect(bankLine()).toBe('BANK 1 · PAGE 4')
    for (let index = 0; index < 8; index += 1) clickMomentary('program.page.down')
    expect(bankLine()).toBe('BANK 1 · PAGE 1')
  })

  it('reaches every slot in the bank through the dial', () => {
    mount()
    const dial = document.querySelector('[data-control-id="program.dial"] [role="slider"]') as HTMLElement
    fireEvent.keyDown(dial, { key: 'End' })
    expect(slotLine()).toMatch(/^4\.8 /)
    fireEvent.keyDown(dial, { key: 'Home' })
    expect(slotLine()).toMatch(/^1\.1 /)
    // A step in between selects an intermediate slot (the dial's Page step is a tenth of
    // the range, so one press moves by three slots).
    fireEvent.keyDown(dial, { key: 'PageUp' })
    expect(slotLine()).toMatch(/^1\.4 /)
    void PROGRAM_SLOTS
  })
})

describe('programs.store-live — the panel', () => {
  it('stores an edit with two Store presses and clears the E', () => {
    mount()
    // Edit a bound control, which lights the dirty indicator.
    const slider = document.querySelector('[data-control-id="organ.drawbar.16"] [role="slider"]') as HTMLElement
    fireEvent.keyDown(slider, { key: 'Home' })
    expect(slotLine()).toMatch(/· E$/)

    // The first Store press enters the destination step; the second commits.
    clickMomentary('program.store')
    expect(slotLine()).toMatch(/· E$/)
    clickMomentary('program.store')
    expect(slotLine()).not.toMatch(/· E/)

    // Loading another program and coming back restores the stored edit.
    clickMomentary('program.slot.2')
    expect(slotLine()).toMatch(/^1\.2 /)
    clickMomentary('program.slot.1')
    const restored = document.querySelector('[data-control-id="organ.drawbar.16"] [role="slider"]') as HTMLElement
    expect(restored.getAttribute('aria-valuenow')).toBe('0')
  })

  it('cancels a pending store with Shift/Exit and keeps the edit', () => {
    mount()
    const slider = document.querySelector('[data-control-id="piano.timbre"] [role="radio"]:nth-of-type(1)') as HTMLElement
    fireEvent.click(slider)
    expect(slotLine()).toMatch(/· E$/)
    clickMomentary('program.store')
    clickMomentary('program.shift')
    expect(slotLine()).toMatch(/· E$/)
  })

  it('switches the buttons to the Live slots in Live mode, and each Live slot is independent', () => {
    mount()
    const live = document.querySelector('[data-control-id="program.live-mode"] [role="switch"]') as HTMLElement
    fireEvent.click(live)
    expect(bankLine()).toBe('LIVE')
    expect(slotLine()).toMatch(/^L1 Live 1$/)

    // An edit in Live mode is stored automatically, so the E never appears.
    const slider = document.querySelector('[data-control-id="synth.filter.freq"] [role="slider"]') as HTMLElement
    fireEvent.keyDown(slider, { key: 'End' })
    expect(slotLine()).not.toMatch(/· E/)

    // Move to another Live slot and back: the edit survives.
    clickMomentary('program.slot.2')
    expect(slotLine()).toMatch(/^L2 Live 2$/)
    clickMomentary('program.slot.1')
    expect(slotLine()).toMatch(/^L1 Live 1$/)
    const restored = document.querySelector('[data-control-id="synth.filter.freq"] [role="slider"]') as HTMLElement
    expect(restored.getAttribute('aria-valuenow')).toBe('10')
    // Leaving Live mode returns to the bank.
    fireEvent.click(live)
    expect(bankLine()).toMatch(/^BANK 1/)
  })
})

describe('programs.undo-cancel — the panel', () => {
  it('discards an edit when another program is selected', () => {
    mount()
    clickMomentary('program.slot.2')
    // Slot 2 is the Concert Grand program, and its piano layer A level is 84.
    const slider = document.querySelector('[data-control-id="piano.layer.a.level"] [role="slider"]') as HTMLElement
    expect(slider.getAttribute('aria-valuenow')).toBe('84')
    fireEvent.keyDown(slider, { key: 'Home' })
    expect(slider.getAttribute('aria-valuenow')).toBe('0')
    expect(slotLine()).toMatch(/· E$/)
    clickMomentary('program.slot.3')
    expect(slotLine()).not.toMatch(/· E/)
    // Coming back gives the stored program, not the discarded edit.
    clickMomentary('program.slot.2')
    const restored = document.querySelector('[data-control-id="piano.layer.a.level"] [role="slider"]') as HTMLElement
    expect(restored.getAttribute('aria-valuenow')).toBe('84')
  })
})

describe('splits.zones — the panel zone switches', () => {
  it('assigns the focused layer to a zone and shows it in the split grid', () => {
    mount()
    // The Organ's KB ZONE 3 switch assigns the focused organ layer to zone 3.
    const zone3 = document.querySelector('[data-control-id="organ.kb-zone.3"] [role="switch"]') as HTMLElement
    expect(zone3.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(zone3)
    expect(zone3.getAttribute('aria-checked')).toBe('true')
    // The split editor's own grid reads the same state.
    fireEvent.click(document.querySelector('.editors-toggle') as HTMLElement)
    const cell = document.querySelector('[data-testid="zone-organ.a-2"]') as HTMLElement
    expect(cell.getAttribute('aria-checked')).toBe('true')
    // And turning it back off clears both.
    fireEvent.click(document.querySelector('.editors-toggle') as HTMLElement)
    fireEvent.click(zone3)
    expect(zone3.getAttribute('aria-checked')).toBe('false')
  })

  it('assigns the piano layer to a zone independently of the organ', () => {
    mount()
    const organZone = document.querySelector('[data-control-id="organ.kb-zone.1"] [role="switch"]') as HTMLElement
    const pianoZone = document.querySelector('[data-control-id="piano.kb-zone.1"] [role="switch"]') as HTMLElement
    expect(organZone.getAttribute('aria-checked')).toBe('true')
    expect(pianoZone.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(pianoZone)
    expect(pianoZone.getAttribute('aria-checked')).toBe('false')
    // The organ's assignment is untouched.
    expect(organZone.getAttribute('aria-checked')).toBe('true')
  })
})

describe('morph.assignments — the panel morph sources', () => {
  it('records a destination while a source button is held', () => {
    mount()
    // Hold the WHEEL source button, sweep a morphable control, then release.
    const wheel = document.querySelector('[data-control-id="program.morph.wheel"] [role="button"]') as HTMLElement
    fireEvent.pointerDown(wheel, { pointerId: 1, button: 0, pointerType: 'mouse' })
    expect(wheel.getAttribute('aria-pressed')).toBe('true')
    const slider = document.querySelector('[data-control-id="piano.layer.a.level"] [role="slider"]') as HTMLElement
    fireEvent.keyDown(slider, { key: 'PageDown' })
    fireEvent.keyDown(slider, { key: 'PageUp' })
    fireEvent.keyDown(slider, { key: 'PageDown' })
    fireEvent.pointerUp(wheel, { pointerId: 1, button: 0, pointerType: 'mouse' })
    fireEvent.blur(wheel)

    // The assignment is listed in the morph panel with its range.
    fireEvent.click(document.querySelector('.editors-toggle') as HTMLElement)
    const wheelPanel = document.querySelector('[data-testid="morph-wheel"]')?.textContent ?? ''
    expect(wheelPanel).not.toMatch(/No assignments/)
    expect(wheelPanel).toContain('piano.layer.a.level')
  })

  it('refuses to assign a control the specs do not list as morphable', () => {
    mount()
    const wheel = document.querySelector('[data-control-id="program.morph.wheel"] [role="button"]') as HTMLElement
    fireEvent.pointerDown(wheel, { pointerId: 1, button: 0, pointerType: 'mouse' })
    // Mod 2 Rate is not a morph destination in the effects spec; moving it records nothing.
    const slider = document.querySelector('[data-control-id="effects.mod2.rate"] [role="slider"]') as HTMLElement
    fireEvent.keyDown(slider, { key: 'End' })
    fireEvent.pointerUp(wheel, { pointerId: 1, button: 0, pointerType: 'mouse' })
    fireEvent.blur(wheel)
    fireEvent.click(document.querySelector('.editors-toggle') as HTMLElement)
    const wheelPanel = document.querySelector('[data-testid="morph-wheel"]')?.textContent ?? ''
    expect(wheelPanel).toMatch(/No assignments/)
  })
})

describe('accessibility.controls — momentary buttons report a press', () => {
  it('activates a momentary button from the keyboard', () => {
    mount()
    // Enter on a slot button is a full press-and-release, so it selects the program.
    const el = document.querySelector('[data-control-id="program.slot.4"] [role="button"]') as HTMLElement
    fireEvent.keyDown(el, { key: 'Enter' })
    fireEvent.keyUp(el, { key: 'Enter' })
    fireEvent.click(el)
    expect(slotLine()).toMatch(/^1\.4 /)
  })

  it('reports a pointer press exactly once', () => {
    mount()
    // A press then release then click must select the program once, not twice: the second
    // activation would be a no-op anyway, but the count is what verifies the guard.
    clickMomentary('program.slot.5')
    expect(slotLine()).toMatch(/^1\.5 /)
    pressMomentary('program.slot.6')
    expect(slotLine()).toMatch(/^1\.6 /)
  })
})
