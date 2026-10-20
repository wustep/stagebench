import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import App from './App'
import { SECTIONS } from './model/sections'

/** A pointer event with the fields the browser would set; jsdom has no PointerEvent constructor. */
function pointer(type: string, pointerId: number) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { pointerId, pointerType: 'touch', button: 0, clientX: 0, clientY: 0 })
  return event
}

function keyNode(note: number): HTMLElement {
  const node = document.querySelector<HTMLElement>(`[data-note="${note}"]`)
  if (!node) throw new Error(`no key for ${note}`)
  return node
}

describe('visual.key-count', () => {
  it('renders exactly 73 keys, 43 white and 30 black, from E1 to E7', () => {
    const { container } = render(<App />)
    const keys = container.querySelectorAll('.key')
    expect(keys).toHaveLength(73)
    expect(container.querySelectorAll('.key.white')).toHaveLength(43)
    expect(container.querySelectorAll('.key.black')).toHaveLength(30)
    const notes = Array.from(keys, (key) => Number((key as HTMLElement).dataset.note))
    expect(Math.min(...notes)).toBe(28)
    expect(Math.max(...notes)).toBe(100)
  })
})

describe('visual.section-layout', () => {
  it('renders the six sections in order with their documented widths', () => {
    const { container } = render(<App />)
    const sections = Array.from(container.querySelectorAll<HTMLElement>('section[data-section]'))
    expect(sections.map((section) => section.dataset.section)).toEqual(SECTIONS.map((section) => section.id))
    sections.forEach((section, index) => {
      expect(Number(section.style.flexGrow)).toBeCloseTo(SECTIONS[index].fraction, 10)
    })
  })

  it('keeps the keybed inside the same chassis as the deck, so the chassis is one continuous piece', () => {
    const { container } = render(<App />)
    const chassis = container.querySelectorAll('.chassis')
    expect(chassis).toHaveLength(1)
    expect(chassis[0].querySelector('.deck')).not.toBeNull()
    expect(chassis[0].querySelector('.keybed')).not.toBeNull()
  })
})

describe('visual.control-inventory', () => {
  it('has exactly two primary OLEDs, in Program and Synth', () => {
    const { container } = render(<App />)
    const oleds = container.querySelectorAll('.oled')
    expect(oleds).toHaveLength(2)
    expect(container.querySelector('[data-section="program"] .oled')).not.toBeNull()
    expect(container.querySelector('[data-section="synth"] .oled')).not.toBeNull()
  })

  it('names every panel control with a role and a stable ID', () => {
    const { container } = render(<App />)
    const controls = container.querySelectorAll<HTMLElement>('.control')
    expect(controls.length).toBeGreaterThan(90)
    for (const control of Array.from(controls)) {
      expect(control.id).toMatch(/^[a-z]+\.[a-z0-9-]+$/)
      expect(control.getAttribute('aria-label')).toBeTruthy()
    }
  })

  it('shows the loaded program and the selected synth layer in the Program and Synth displays', () => {
    render(<App />)
    expect(screen.getByRole('img', { name: /program display: 1\.1 grand piano/i })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /synth display: synth a: sine/i })).toBeInTheDocument()
  })
})

describe('accessibility.controls', () => {
  it('exposes continuous controls as sliders with values', () => {
    render(<App />)
    const master = screen.getByRole('slider', { name: 'Master level' })
    expect(master).toHaveAttribute('aria-valuenow', '70')
    expect(master).toHaveAttribute('aria-valuemin', '0')
    expect(master).toHaveAttribute('aria-valuemax', '100')
  })

  it('moves a slider from the keyboard and reports the new value', () => {
    render(<App />)
    const master = screen.getByRole('slider', { name: 'Master level' })
    master.focus()
    fireEvent.keyDown(master, { key: 'ArrowUp' })
    expect(master).toHaveAttribute('aria-valuenow', '72')
    fireEvent.keyDown(master, { key: 'End' })
    expect(master).toHaveAttribute('aria-valuenow', '100')
    fireEvent.keyDown(master, { key: 'Home' })
    expect(master).toHaveAttribute('aria-valuenow', '0')
  })

  it('toggles a button from the keyboard and reflects it in aria-pressed', () => {
    render(<App />)
    const vibrato = screen.getByRole('button', { name: 'Vibrato on' })
    expect(vibrato).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(vibrato)
    expect(vibrato).toHaveAttribute('aria-pressed', 'true')
  })

  it('treats the organ model switches as a radio set: pressing one selects it and clears the others', () => {
    render(<App />)
    const b3 = screen.getByRole('button', { name: 'B3' })
    const vox = screen.getByRole('button', { name: 'Vox' })
    expect(b3).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(vox)
    expect(vox).toHaveAttribute('aria-pressed', 'true')
    expect(b3).toHaveAttribute('aria-pressed', 'false')
  })

  it('cycles a selector and shows the current step as text for assistive tech', () => {
    render(<App />)
    const type = screen.getByRole('button', { name: 'Piano type' })
    expect(type).toHaveTextContent('Grand')
    fireEvent.click(type)
    expect(type).toHaveAttribute('data-step', '1')
    expect(type).toHaveTextContent('Upright')
  })

  it('keeps the visible focus indicator in the stylesheet', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')
    expect(css).toContain(':focus-visible')
  })
})

describe('interaction.decorative-controls', () => {
  it('moves and presses controls without starting audio', () => {
    render(<App />)
    const cutoff = screen.getByRole('slider', { name: 'Filter cutoff' })
    const store = screen.getByRole('button', { name: 'Store' })
    fireEvent.keyDown(cutoff, { key: 'ArrowDown' })
    fireEvent.click(store)
    expect(cutoff).toHaveAttribute('aria-valuenow', '68')
    expect(store).toHaveAttribute('aria-pressed', 'true')
    // Presentation only: no note, program, or effect state changed, and no audio was started.
    expect(document.getElementById('engine-status')).toHaveAttribute('data-engine-state', 'idle')
    expect(document.querySelectorAll('.key.pressed')).toHaveLength(0)
  })
})

describe('interaction.keys and piano.basic-inputs', () => {
  it('presses a key on pointer down and releases it on pointer up', () => {
    render(<App />)
    const key = keyNode(60)
    fireEvent(key, pointer('pointerdown', 1))
    expect(key).toHaveClass('pressed')
    fireEvent(key, pointer('pointerup', 1))
    expect(key).not.toHaveClass('pressed')
  })

  it('plays independent keys with independent touches (multi-touch)', () => {
    render(<App />)
    fireEvent(keyNode(60), pointer('pointerdown', 1))
    fireEvent(keyNode(64), pointer('pointerdown', 2))
    expect(keyNode(60)).toHaveClass('pressed')
    expect(keyNode(64)).toHaveClass('pressed')

    fireEvent(keyNode(60), pointer('pointerup', 1))
    expect(keyNode(60)).not.toHaveClass('pressed')
    expect(keyNode(64)).toHaveClass('pressed')
  })

  it('releases a pointer note on pointer cancel', () => {
    render(<App />)
    fireEvent(keyNode(67), pointer('pointerdown', 4))
    fireEvent(keyNode(67), pointer('pointercancel', 4))
    expect(keyNode(67)).not.toHaveClass('pressed')
  })

  it('maps the computer keyboard and suppresses auto-repeat', () => {
    render(<App />)
    fireEvent.keyDown(window, { code: 'KeyA' })
    expect(keyNode(60)).toHaveClass('pressed')
    fireEvent.keyDown(window, { code: 'KeyA', repeat: true })
    fireEvent.keyUp(window, { code: 'KeyA' })
    expect(keyNode(60)).not.toHaveClass('pressed')
  })

  it('releases every note when the window loses focus', () => {
    render(<App />)
    fireEvent.keyDown(window, { code: 'KeyS' })
    fireEvent(keyNode(72), pointer('pointerdown', 9))
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(keyNode(62)).not.toHaveClass('pressed')
    expect(keyNode(72)).not.toHaveClass('pressed')
  })

  it('reports the truthful MIDI state when Web MIDI is unavailable', () => {
    render(<App />)
    expect(document.getElementById('midi-status')).toHaveTextContent('Web MIDI is not available')
  })

  it('reports a labelled silent fallback when Web Audio is unavailable, and keys still track', () => {
    render(<App />)
    fireEvent(keyNode(60), pointer('pointerdown', 1))
    const status = document.getElementById('engine-status')
    expect(status).toHaveAttribute('data-engine-state', 'fallback')
    expect(status).toHaveTextContent('Silent fallback')
    expect(keyNode(60)).toHaveClass('pressed')
  })
})

describe('piano.basic-sustain-polyphony (UI and keyboard)', () => {
  it('holds notes with the Shift key and releases them when Shift lifts', () => {
    render(<App />)
    const pedal = screen.getByRole('button', { name: 'Sustain pedal (virtual)' })
    fireEvent.keyDown(window, { code: 'ShiftLeft' })
    expect(pedal).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyUp(window, { code: 'ShiftLeft' })
    expect(pedal).toHaveAttribute('aria-pressed', 'false')
  })

  it('holds sustain while the virtual pedal is pressed', () => {
    render(<App />)
    const pedal = screen.getByRole('button', { name: 'Sustain pedal (virtual)' })
    fireEvent(pedal, pointer('pointerdown', 1))
    expect(pedal).toHaveAttribute('aria-pressed', 'true')
    fireEvent(pedal, pointer('pointerup', 1))
    expect(pedal).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('regression.chassis (structure; layout is measured in the browser pass)', () => {
  it('has no marketing hero above the instrument and a single instrument region', () => {
    const { container } = render(<App />)
    expect(container.querySelector('[class*="hero"]')).toBeNull()
    expect(container.querySelector('.stage > .instrument')).not.toBeNull()
    expect(within(container).getAllByRole('group', { name: 'Keybed, 73 keys, E1 to E7' })).toHaveLength(1)
  })
})
