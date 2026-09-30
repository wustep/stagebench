import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'
import { CONTROLS, OLEDS } from './hardware/layout'
import { SECTIONS } from './hardware/geometry'
import { createHarness, type Harness } from './test-utils/fakes'

afterEach(cleanup)

const mount = (h: Harness = createHarness()) => {
  const utils = render(<App deps={h.deps} />)
  return { h, ...utils }
}
const control = (container: HTMLElement, id: string) => container.querySelector(`[data-control-id="${id}"]`) as HTMLElement
const key = (container: HTMLElement, note: number) => container.querySelector(`[data-note="${note}"]`) as HTMLElement
const pressedNotes = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-note][data-pressed="true"]')).map((e) => Number(e.getAttribute('data-note')))

describe('visual.key-count (DOM)', () => {
  it('renders 73 keys: 43 white and 30 black, E1 first and E7 last', () => {
    const { container } = mount()
    const keys = container.querySelectorAll('[data-note]')
    expect(keys).toHaveLength(73)
    expect(container.querySelectorAll('[data-key="white"]')).toHaveLength(43)
    expect(container.querySelectorAll('[data-key="black"]')).toHaveLength(30)
    expect(key(container, 28).getAttribute('aria-label')).toBe('E1')
    expect(key(container, 100).getAttribute('aria-label')).toBe('E7')
    expect(screen.getByRole('group', { name: /keybed, 73 keys, E1 to E7/i })).toBeInTheDocument()
  })
})

describe('visual.section-layout / regression.chassis (DOM)', () => {
  it('renders one continuous chassis with six ordered sections at their widths and a 54/46 split', () => {
    const { container } = mount()
    const instrument = screen.getByTestId('instrument')
    expect(Number(instrument.getAttribute('data-aspect-ratio'))).toBeCloseTo(9013 / 2912, 4)
    expect(container.querySelectorAll('.chassis')).toHaveLength(1)
    const sections = Array.from(container.querySelectorAll('section[data-section]'))
    expect(sections.map((s) => s.getAttribute('data-section'))).toEqual(SECTIONS.map((s) => s.id))
    sections.forEach((s, i) => {
      expect(Number(s.getAttribute('data-fraction'))).toBe(SECTIONS[i].fraction)
      expect((s as HTMLElement).style.width).toContain(`* ${SECTIONS[i].width})`)
    })
    expect(screen.getByTestId('deck').style.height).toBe('54%')
    expect(screen.getByTestId('keybed-zone').style.top).toBe('54%')
    expect(screen.getByTestId('keybed-zone').style.height).toBe('46%')
  })

  it('has no marketing hero, no heading above the instrument and no detached rails', () => {
    const { container } = mount()
    expect(container.querySelector('h1, h2, [class*="hero"]')).toBeNull()
    const main = container.querySelector('main')!
    expect(main.firstElementChild?.querySelector('[data-testid="instrument"]')).not.toBeNull()
    // everything that makes up the instrument lives inside the single .instrument box
    const instrument = screen.getByTestId('instrument')
    for (const sel of ['.deck', '.keybed-zone', '.bottom-rail', '.deck-lip', '.chassis']) {
      expect(instrument.querySelector(sel), sel).not.toBeNull()
    }
  })
})

describe('visual.control-inventory (DOM)', () => {
  it('renders every control once with its stable id', () => {
    const { container } = mount()
    for (const c of CONTROLS) expect(container.querySelectorAll(`[data-control-id="${c.id}"]`), c.id).toHaveLength(1)
    expect(container.querySelectorAll('[data-control-id]')).toHaveLength(CONTROLS.length)
  })

  it('places controls in the section they belong to', () => {
    const { container } = mount()
    for (const c of CONTROLS) {
      expect(control(container, c.id).closest('[data-section]')?.getAttribute('data-section'), c.id).toBe(c.section)
    }
  })

  it('renders only two OLEDs, one in Program and one in Synth, and no OLED elsewhere', () => {
    const { container } = mount()
    const oleds = Array.from(container.querySelectorAll('[data-oled]'))
    expect(oleds.map((o) => o.closest('[data-section]')?.getAttribute('data-section'))).toEqual(['program', 'synth'])
    expect(OLEDS).toHaveLength(2)
    for (const section of ['performance', 'organ', 'piano', 'effects']) {
      const el = container.querySelector(`section[data-section="${section}"]`)!
      expect(el.querySelector('[data-oled],[id*="oled"],[class*="oled"],[class*="display"],[class*="screen"]'), section).toBeNull()
    }
  })

  it('OLEDs only report real state: audio status, voices, sustain — and admit the rest is inactive', async () => {
    const { container, h } = mount()
    const program = container.querySelector('#program-oled') as HTMLElement
    expect(program.textContent).toMatch(/AUDIO IDLE/)
    expect(program.textContent).toMatch(/VOICES 00\/24/)
    expect(program.textContent).toMatch(/Programs: not yet/)
    const synth = container.querySelector('#synth-oled') as HTMLElement
    expect(synth.textContent).toMatch(/Not active yet/)
    expect(synth.textContent).toMatch(/decorative/)
    act(() => h.keys.emit('keydown', { code: 'KeyQ', repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: null, preventDefault() {} }))
    expect(program.textContent).toMatch(/AUDIO READY/)
    expect(program.textContent).toMatch(/VOICES 01\/24/)
  })
})

describe('accessibility.controls', () => {
  it('gives every control an accessible name and a slider/button role with values', () => {
    const { container } = mount()
    for (const c of CONTROLS) {
      const el = control(container, c.id)
      expect(el.getAttribute('aria-label'), c.id).toBeTruthy()
      if (c.kind === 'button') {
        expect(el.tagName, c.id).toBe('BUTTON')
      } else {
        expect(el.getAttribute('role'), c.id).toBe('slider')
        expect(el.getAttribute('aria-valuenow'), c.id).not.toBeNull()
        expect(el.getAttribute('aria-valuemin'), c.id).not.toBeNull()
        expect(el.getAttribute('aria-valuemax'), c.id).not.toBeNull()
        expect(el.tabIndex, c.id).toBe(0)
      }
    }
  })

  it('is discoverable through the accessibility tree by name', () => {
    mount()
    expect(screen.getByRole('slider', { name: 'Master level' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: "Organ drawbar 16'" })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Organ model: B3$/ })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Program dial' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Store' })).toBeInTheDocument()
  })

  it('exposes the current option for selector buttons and updates it', () => {
    const { container } = mount()
    const type = control(container, 'piano-select')
    expect(type.getAttribute('aria-label')).toBe('Piano type: Grand')
    fireEvent.pointerDown(type, { pointerId: 1 })
    fireEvent.pointerUp(type, { pointerId: 1 })
    expect(type.getAttribute('aria-label')).toBe('Piano type: Upright')
  })

  it('ships a visible focus style for controls and keys', async () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')
    expect(css).toMatch(/\.ctl:focus-visible\s*\{[^}]*outline/)
    expect(css).toMatch(/\.key:focus-visible\s*\{[^}]*outline/)
  })

  it('marks keys as pressed for assistive tech', () => {
    const { container } = mount()
    expect(key(container, 60).getAttribute('aria-pressed')).toBe('false')
  })
})

describe('interaction.decorative-controls', () => {
  it('sliders move with the keyboard and expose the new value', () => {
    const { container } = mount()
    for (const c of CONTROLS.filter((x) => x.kind !== 'button')) {
      const el = control(container, c.id)
      el.focus()
      fireEvent.keyDown(el, { key: 'Home' })
      const low = el.getAttribute('aria-valuenow')
      fireEvent.keyDown(el, { key: 'End' })
      const high = el.getAttribute('aria-valuenow')
      // the pitch stick springs back on key release; encoders wrap and only have Home
      if (c.kind !== 'encoder') expect(high, c.id).not.toBe(low)
      fireEvent.keyDown(el, { key: c.kind === 'drawbar' ? 'ArrowUp' : 'ArrowDown' })
      expect(el.getAttribute('aria-valuenow'), c.id).not.toBe(high)
    }
  })

  it('knobs turn when dragged and the indicator rotates', () => {
    const { container } = mount()
    const knob = control(container, 'synth-glide')
    const before = (knob.querySelector('.knob-body') as HTMLElement).style.transform
    fireEvent.pointerDown(knob, { pointerId: 1, clientY: 200 })
    fireEvent.pointerMove(knob, { pointerId: 1, clientY: 150 })
    fireEvent.pointerUp(knob, { pointerId: 1 })
    expect((knob.querySelector('.knob-body') as HTMLElement).style.transform).not.toBe(before)
  })

  it('faders and drawbars slide when dragged', () => {
    const { container } = mount()
    const fader = control(container, 'organ-level-a')
    const capBefore = (fader.querySelector('.fader-cap') as HTMLElement).style.top
    fireEvent.pointerDown(fader, { pointerId: 1, clientY: 200 })
    fireEvent.pointerMove(fader, { pointerId: 1, clientY: 150 })
    fireEvent.pointerUp(fader, { pointerId: 1 })
    expect((fader.querySelector('.fader-cap') as HTMLElement).style.top).not.toBe(capBefore)

    const drawbar = control(container, 'organ-drawbar-3')
    const before = drawbar.getAttribute('aria-valuenow')
    fireEvent.pointerDown(drawbar, { pointerId: 2, clientY: 100 })
    fireEvent.pointerMove(drawbar, { pointerId: 2, clientY: 60 })
    fireEvent.pointerUp(drawbar, { pointerId: 2 })
    expect(drawbar.getAttribute('aria-valuenow')).not.toBe(before)
  })

  it('drawbar LED ladders follow the drawbar', () => {
    const { container } = mount()
    const drawbar = control(container, 'organ-drawbar-1')
    const lit = () => drawbar.nextElementSibling!.querySelectorAll('.drawbar-led.is-lit').length
    fireEvent.keyDown(drawbar, { key: 'Home' })
    expect(lit()).toBe(0)
    fireEvent.keyDown(drawbar, { key: 'End' })
    expect(lit()).toBeGreaterThan(0)
  })

  it('buttons light on press, latch or cycle, and respond to the keyboard', () => {
    const { container } = mount()
    const on = control(container, 'organ-on')
    expect(on.getAttribute('aria-pressed')).toBe('false')
    fireEvent.pointerDown(on, { pointerId: 1 })
    expect(on.className).toMatch(/is-held/)
    fireEvent.pointerUp(on, { pointerId: 1 })
    expect(on.getAttribute('aria-pressed')).toBe('true')
    // LED next to it is lit
    expect(container.querySelector('section[data-section="organ"] .led--red.is-lit')).not.toBeNull()

    fireEvent.keyDown(on, { key: 'Enter' })
    fireEvent.keyUp(on, { key: 'Enter' })
    expect(on.getAttribute('aria-pressed')).toBe('false')
    fireEvent.keyDown(on, { key: ' ' })
    fireEvent.keyUp(on, { key: ' ' })
    expect(on.getAttribute('aria-pressed')).toBe('true')

    const store = control(container, 'program-store')
    fireEvent.pointerDown(store, { pointerId: 1 })
    expect(store.className).toMatch(/is-held/)
    fireEvent.pointerUp(store, { pointerId: 1 })
    expect(store.className).not.toMatch(/is-held/)
    expect(store.getAttribute('aria-pressed')).toBe('false')
  })

  it('tag toggles (LED + legend) also operate', () => {
    const { container } = mount()
    const tag = control(container, 'organ-sustain-pedal')
    fireEvent.pointerDown(tag, { pointerId: 1 })
    fireEvent.pointerUp(tag, { pointerId: 1 })
    expect(tag.getAttribute('aria-pressed')).toBe('true')
    expect(tag.querySelector('.led.is-lit')).not.toBeNull()
  })

  it('the pitch stick springs back, the modulation wheel stays', () => {
    const { container } = mount()
    const pitch = control(container, 'pitch-stick')
    const mod = control(container, 'mod-wheel')
    fireEvent.keyDown(pitch, { key: 'End' })
    expect(pitch.getAttribute('aria-valuenow')).toBe('100')
    fireEvent.keyUp(pitch, { key: 'End' })
    expect(pitch.getAttribute('aria-valuenow')).toBe('50')
    fireEvent.keyDown(mod, { key: 'End' })
    fireEvent.keyUp(mod, { key: 'End' })
    expect(mod.getAttribute('aria-valuenow')).toBe('100')
  })

  it('changes presentation state only: no audio, no voices, no MIDI, no program state', () => {
    const { container, h } = mount()
    for (const c of CONTROLS) {
      const el = control(container, c.id)
      if (c.kind === 'button') {
        fireEvent.pointerDown(el, { pointerId: 1 })
        fireEvent.pointerUp(el, { pointerId: 1 })
        fireEvent.keyDown(el, { key: 'Enter' })
        fireEvent.keyUp(el, { key: 'Enter' })
      } else {
        fireEvent.keyDown(el, { key: 'End' })
        fireEvent.keyDown(el, { key: 'Home' })
      }
    }
    expect(h.contexts).toHaveLength(0)
    expect(h.scheduler.pending).toBe(0)
    const program = container.querySelector('#program-oled')!
    expect(program.textContent).toMatch(/AUDIO IDLE/)
    expect(program.textContent).toMatch(/VOICES 00/)
    expect(container.querySelectorAll('[data-note][data-pressed="true"]')).toHaveLength(0)
  })
})

describe('interaction.keys', () => {
  const keyEvent = (code: string, extra = {}) => ({ code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: null, preventDefault() {}, ...extra })

  it('presses on pointer down, depresses the key and releases on pointer up', () => {
    const { container, h } = mount()
    const k = key(container, 60)
    fireEvent.pointerDown(k, { pointerId: 1, clientY: 0 })
    expect(pressedNotes(container)).toEqual([60])
    expect(k.className).toMatch(/is-down/)
    expect(h.ctx()).not.toBeNull()
    fireEvent.pointerUp(window, { pointerId: 1 })
    expect(pressedNotes(container)).toEqual([])
    expect(k.className).not.toMatch(/is-down/)
  })

  it('releases on pointer cancel', () => {
    const { container } = mount()
    fireEvent.pointerDown(key(container, 62), { pointerId: 4 })
    expect(pressedNotes(container)).toEqual([62])
    fireEvent.pointerCancel(window, { pointerId: 4 })
    expect(pressedNotes(container)).toEqual([])
  })

  it('supports independent multi-touch', () => {
    const { container } = mount()
    fireEvent.pointerDown(key(container, 60), { pointerId: 1, pointerType: 'touch' })
    fireEvent.pointerDown(key(container, 64), { pointerId: 2, pointerType: 'touch' })
    fireEvent.pointerDown(key(container, 67), { pointerId: 3, pointerType: 'touch' })
    expect(pressedNotes(container)).toEqual([60, 64, 67])
    fireEvent.pointerUp(window, { pointerId: 2 })
    expect(pressedNotes(container)).toEqual([60, 67])
    fireEvent.pointerCancel(window, { pointerId: 1 })
    fireEvent.pointerUp(window, { pointerId: 3 })
    expect(pressedNotes(container)).toEqual([])
  })

  it('ignores pointer ups from pointers that never pressed a key', () => {
    const { container } = mount()
    fireEvent.pointerDown(key(container, 60), { pointerId: 1 })
    fireEvent.pointerUp(window, { pointerId: 99 })
    expect(pressedNotes(container)).toEqual([60])
  })

  it('plays black keys and does not press the white key underneath', () => {
    const { container } = mount()
    const black = container.querySelector('[data-key="black"]') as HTMLElement
    fireEvent.pointerDown(black, { pointerId: 1 })
    expect(pressedNotes(container)).toEqual([Number(black.getAttribute('data-note'))])
  })

  it('plays from the computer keyboard and shows the key going down', () => {
    const { container, h } = mount()
    act(() => h.keys.emit('keydown', keyEvent('KeyQ')))
    expect(pressedNotes(container)).toEqual([60])
    act(() => h.keys.emit('keydown', keyEvent('KeyQ', { repeat: true })))
    expect(h.ctx()!.voiceSources()).toHaveLength(1)
    act(() => h.keys.emit('keyup', keyEvent('KeyQ')))
    expect(pressedNotes(container)).toEqual([])
  })

  it('releases held keys on window blur and hidden page', () => {
    const { container, h } = mount()
    act(() => h.keys.emit('keydown', keyEvent('KeyQ')))
    fireEvent.pointerDown(key(container, 64), { pointerId: 1 })
    expect(pressedNotes(container)).toEqual([60, 64])
    act(() => h.win.emit('blur'))
    expect(pressedNotes(container)).toEqual([])
  })

  it('keys are operable from the keyboard: Enter/Space hold the key, arrows move focus', () => {
    const { container } = mount()
    const first = key(container, 28)
    expect(first.tabIndex).toBe(0)
    expect(key(container, 29).tabIndex).toBe(-1)
    first.focus()
    fireEvent.keyDown(first, { key: 'Enter' })
    expect(pressedNotes(container)).toEqual([28])
    fireEvent.keyUp(first, { key: 'Enter' })
    expect(pressedNotes(container)).toEqual([])
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(key(container, 29).tabIndex).toBe(0)
    expect(document.activeElement).toBe(key(container, 29))
    fireEvent.keyDown(key(container, 29), { key: ' ' })
    expect(pressedNotes(container)).toEqual([29])
    fireEvent.blur(key(container, 29))
    expect(pressedNotes(container)).toEqual([])
  })

  it('sustain button holds notes until released', () => {
    const { container, h } = mount()
    const pedal = within(container).getByTestId('sustain-button')
    fireEvent.pointerDown(pedal, { pointerId: 1 })
    fireEvent.pointerDown(key(container, 60), { pointerId: 2 })
    fireEvent.pointerUp(window, { pointerId: 2 })
    expect(within(container).getByTestId('voice-status').textContent).toMatch(/Sustain on/)
    const gains = h.ctx()!.nodes.filter((n) => n.kind === 'gain')
    expect(gains.length).toBeGreaterThan(0)
    fireEvent.pointerUp(pedal, { pointerId: 1 })
    expect(within(container).getByTestId('voice-status').textContent).toMatch(/Sustain off/)
  })
})

describe('piano.basic-status-cleanup (DOM)', () => {
  it('shows truthful audio status and cleans up on unmount', () => {
    const h = createHarness({ audio: 'none' })
    const { container, unmount } = mount(h)
    expect(within(container).getByTestId('audio-status').getAttribute('data-phase')).toBe('idle')
    fireEvent.pointerDown(key(container, 60), { pointerId: 1 })
    expect(within(container).getByTestId('audio-status').getAttribute('data-phase')).toBe('error')
    const before = h.keys.count() + h.win.count() + h.doc.count()
    expect(before).toBeGreaterThan(0)
    unmount()
    expect(h.keys.count() + h.win.count() + h.doc.count()).toBe(0)
  })

  it('unmount stops sound and closes the audio context', () => {
    const h = createHarness()
    const { container, unmount } = mount(h)
    fireEvent.pointerDown(key(container, 60), { pointerId: 1 })
    fireEvent.pointerDown(key(container, 64), { pointerId: 2 })
    const ctx = h.ctx()!
    expect(ctx.liveNodes().length).toBeGreaterThan(2)
    unmount()
    expect(ctx.closed).toBe(true)
    expect(ctx.liveNodes()).toHaveLength(0)
    expect(h.scheduler.pending).toBe(0)
  })

  it('reports MIDI denied in the status bar', async () => {
    const h = createHarness({ midi: 'denied' })
    const { container } = mount(h)
    await act(async () => {
      fireEvent.click(within(container).getByRole('button', { name: /connect midi/i }))
    })
    expect(within(container).getByTestId('midi-status').getAttribute('data-phase')).toBe('denied')
  })
})
