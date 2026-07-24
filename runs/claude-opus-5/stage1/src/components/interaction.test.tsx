import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { CONTROLS, control } from '../model/controls'
import { createRig } from '../test/harness'

function pointerDown(element: Element, pointerId = 1) {
  fireEvent.pointerDown(element, { pointerId, button: 0, pointerType: 'mouse', clientX: 0, clientY: 0 })
}

function pointerUp(target: Element | Window, pointerId = 1) {
  fireEvent.pointerUp(target, { pointerId, button: 0, pointerType: 'mouse', clientX: 0, clientY: 0 })
}

/** Feature: interaction.keys */
describe('keybed interaction', () => {
  it('presses and releases a key with the pointer', async () => {
    const rig = createRig()
    const { container } = render(<App boundaries={rig.boundaries} />)
    const key = container.querySelector('#key-60')!

    pointerDown(key)
    await waitFor(() => expect(key).toHaveAttribute('aria-pressed', 'true'))
    expect(rig.graph.liveNodeCount).toBeGreaterThan(2)

    pointerUp(window)
    await waitFor(() => expect(key).toHaveAttribute('aria-pressed', 'false'))
  })

  it('treats two simultaneous touches as independent notes', async () => {
    const rig = createRig()
    const { container } = render(<App boundaries={rig.boundaries} />)
    const low = container.querySelector('#key-60')!
    const high = container.querySelector('#key-64')!

    fireEvent.pointerDown(low, { pointerId: 11, pointerType: 'touch', clientX: 0, clientY: 0 })
    fireEvent.pointerDown(high, { pointerId: 12, pointerType: 'touch', clientX: 0, clientY: 0 })
    await waitFor(() => {
      expect(low).toHaveAttribute('aria-pressed', 'true')
      expect(high).toHaveAttribute('aria-pressed', 'true')
    })

    pointerUp(window, 11)
    await waitFor(() => expect(low).toHaveAttribute('aria-pressed', 'false'))
    expect(high).toHaveAttribute('aria-pressed', 'true')

    pointerUp(window, 12)
    await waitFor(() => expect(high).toHaveAttribute('aria-pressed', 'false'))
  })

  it('releases the note when the pointer is cancelled', async () => {
    const rig = createRig()
    const { container } = render(<App boundaries={rig.boundaries} />)
    const key = container.querySelector('#key-55')!
    fireEvent.pointerDown(key, { pointerId: 3, pointerType: 'touch', clientX: 0, clientY: 0 })
    await waitFor(() => expect(key).toHaveAttribute('aria-pressed', 'true'))
    fireEvent.pointerCancel(window, { pointerId: 3 })
    await waitFor(() => expect(key).toHaveAttribute('aria-pressed', 'false'))
  })

  it('slides the held note across the keybed on a glissando', async () => {
    const rig = createRig()
    const { container } = render(<App boundaries={rig.boundaries} />)
    const first = container.querySelector('#key-60')!
    const second = container.querySelector('#key-62')!

    pointerDown(first, 7)
    await waitFor(() => expect(first).toHaveAttribute('aria-pressed', 'true'))
    fireEvent.pointerEnter(second, { pointerId: 7, pointerType: 'mouse', clientX: 0, clientY: 0 })
    await waitFor(() => {
      expect(first).toHaveAttribute('aria-pressed', 'false')
      expect(second).toHaveAttribute('aria-pressed', 'true')
    })
    pointerUp(window, 7)
    await waitFor(() => expect(second).toHaveAttribute('aria-pressed', 'false'))
  })

  it('plays a focused key from the keyboard with Space and Enter', async () => {
    const rig = createRig()
    const { container } = render(<App boundaries={rig.boundaries} />)
    const key = container.querySelector('#key-67')! as HTMLElement
    key.focus()

    fireEvent.keyDown(key, { key: ' ', code: 'Space' })
    await waitFor(() => expect(key).toHaveAttribute('aria-pressed', 'true'))
    fireEvent.keyUp(key, { key: ' ', code: 'Space' })
    await waitFor(() => expect(key).toHaveAttribute('aria-pressed', 'false'))

    fireEvent.keyDown(key, { key: 'Enter', code: 'Enter' })
    await waitFor(() => expect(key).toHaveAttribute('aria-pressed', 'true'))
    fireEvent.keyUp(key, { key: 'Enter', code: 'Enter' })
    await waitFor(() => expect(key).toHaveAttribute('aria-pressed', 'false'))
  })

  it('drops every held key when the window loses focus', async () => {
    const rig = createRig()
    const { container } = render(<App boundaries={rig.boundaries} />)
    const key = container.querySelector('#key-60')!
    pointerDown(key, 21)
    await waitFor(() => expect(key).toHaveAttribute('aria-pressed', 'true'))
    act(() => {
      fireEvent.blur(window)
    })
    await waitFor(() => expect(key).toHaveAttribute('aria-pressed', 'false'))
  })
})

/** Features: interaction.decorative-controls, accessibility.controls */
describe('decorative panel controls', () => {
  it('marks every rendered panel control as non-functional in the DOM', () => {
    const { container } = render(<App boundaries={createRig().boundaries} />)
    const nodes = [...container.querySelectorAll('[data-control-id]')]
    expect(nodes).toHaveLength(CONTROLS.length)
    for (const node of nodes) expect(node).toHaveAttribute('data-functional', 'false')
    // Keys are the only inputs that are not marked decorative.
    for (const key of container.querySelectorAll('.pkey')) {
      expect(key.hasAttribute('data-functional')).toBe(false)
    }
  })

  it('advances an option button through its printed options on click', async () => {
    const { container } = render(<App boundaries={createRig().boundaries} />)
    const button = container.querySelector('[data-control-id="piano.type"]')! as HTMLElement
    expect(button).toHaveAttribute('data-value', 'Grand')
    fireEvent.click(button)
    await waitFor(() => expect(button).toHaveAttribute('data-value', 'Upright'))
    fireEvent.click(button)
    await waitFor(() => expect(button).toHaveAttribute('data-value', 'Electric'))
    expect(button).toHaveAccessibleName('Piano Type: Electric')
  })

  it('flips a toggle button and reports it through aria-pressed', async () => {
    const { container } = render(<App boundaries={createRig().boundaries} />)
    const button = container.querySelector('[data-control-id="fx.reverb.on"]')! as HTMLElement
    expect(button).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(button)
    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'))
    fireEvent.click(button)
    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'false'))
  })

  it('shows a momentary button depressing and springing back', () => {
    const { container } = render(<App boundaries={createRig().boundaries} />)
    const button = container.querySelector('[data-control-id="program.store"]')! as HTMLElement
    pointerDown(button)
    expect(button).toHaveAttribute('data-pressed', 'true')
    pointerUp(button)
    expect(button).toHaveAttribute('data-pressed', 'false')
    expect(button).not.toHaveAttribute('aria-pressed')
  })

  it('turns a knob with the keyboard and reports the new value', async () => {
    const { container } = render(<App boundaries={createRig().boundaries} />)
    const knob = container.querySelector('[data-control-id="fx.mod1.rate"]')! as HTMLElement
    const spec = control('fx.mod1.rate')
    expect(knob).toHaveAttribute('role', 'slider')
    expect(Number(knob.getAttribute('aria-valuenow'))).toBeCloseTo(spec.initial, 6)

    fireEvent.keyDown(knob, { key: 'ArrowUp' })
    await waitFor(() =>
      expect(Number(knob.getAttribute('aria-valuenow'))).toBeCloseTo(spec.initial + spec.step, 6),
    )
    fireEvent.keyDown(knob, { key: 'End' })
    await waitFor(() => expect(Number(knob.getAttribute('aria-valuenow'))).toBe(spec.max))
    fireEvent.keyDown(knob, { key: 'Home' })
    await waitFor(() => expect(Number(knob.getAttribute('aria-valuenow'))).toBe(spec.min))
    fireEvent.keyDown(knob, { key: 'ArrowDown' })
    expect(Number(knob.getAttribute('aria-valuenow'))).toBe(spec.min)
  })

  it('drags a fader with the pointer', async () => {
    const { container } = render(<App boundaries={createRig().boundaries} />)
    const fader = container.querySelector('[data-control-id="organ.a.level"]')! as HTMLElement
    const before = Number(fader.getAttribute('aria-valuenow'))
    fireEvent.pointerDown(fader, { pointerId: 4, button: 0, pointerType: 'mouse', clientY: 200 })
    fireEvent.pointerMove(fader, { pointerId: 4, clientY: 130 })
    await waitFor(() => expect(Number(fader.getAttribute('aria-valuenow'))).toBeGreaterThan(before))
    fireEvent.pointerMove(fader, { pointerId: 4, clientY: 400 })
    await waitFor(() => expect(Number(fader.getAttribute('aria-valuenow'))).toBe(0))
    fireEvent.pointerUp(fader, { pointerId: 4 })
    // Movement stops once the pointer is released.
    const settled = Number(fader.getAttribute('aria-valuenow'))
    fireEvent.pointerMove(fader, { pointerId: 4, clientY: 0 })
    expect(Number(fader.getAttribute('aria-valuenow'))).toBe(settled)
  })

  it('pulls a drawbar out when dragged down, matching real drawbar direction', async () => {
    const { container } = render(<App boundaries={createRig().boundaries} />)
    const drawbar = container.querySelector('[data-control-id="organ.drawbar.5"]')! as HTMLElement
    const before = Number(drawbar.getAttribute('aria-valuenow'))
    fireEvent.pointerDown(drawbar, { pointerId: 5, button: 0, pointerType: 'mouse', clientY: 100 })
    fireEvent.pointerMove(drawbar, { pointerId: 5, clientY: 160 })
    await waitFor(() => expect(Number(drawbar.getAttribute('aria-valuenow'))).toBeGreaterThan(before))
    fireEvent.pointerUp(drawbar, { pointerId: 5 })
  })

  it('springs the pitch stick back to centre when released', async () => {
    const { container } = render(<App boundaries={createRig().boundaries} />)
    const stick = container.querySelector('[data-control-id="perf.pitch-stick"]')! as HTMLElement
    fireEvent.pointerDown(stick, { pointerId: 6, button: 0, pointerType: 'mouse', clientX: 100 })
    fireEvent.pointerMove(stick, { pointerId: 6, clientX: 130 })
    await waitFor(() => expect(Number(stick.getAttribute('aria-valuenow'))).toBeGreaterThan(0))
    fireEvent.pointerUp(stick, { pointerId: 6 })
    await waitFor(() => expect(Number(stick.getAttribute('aria-valuenow'))).toBe(0))
  })

  it('steps the endless program dial with the keyboard', async () => {
    const { container } = render(<App boundaries={createRig().boundaries} />)
    const dial = container.querySelector('[data-control-id="program.dial"]')! as HTMLElement
    expect(dial).toHaveAttribute('role', 'spinbutton')
    const before = Number(dial.getAttribute('aria-valuenow'))
    fireEvent.keyDown(dial, { key: 'ArrowUp' })
    await waitFor(() => expect(Number(dial.getAttribute('aria-valuenow'))).toBe(before + 1))
    fireEvent.keyDown(dial, { key: 'ArrowDown' })
    await waitFor(() => expect(Number(dial.getAttribute('aria-valuenow'))).toBe(before))
  })

  it('changes nothing audible: moving every panel control leaves the audio graph untouched', () => {
    const rig = createRig()
    const { container } = render(<App boundaries={rig.boundaries} />)
    const before = rig.graph.liveNodeCount
    for (const node of container.querySelectorAll('[data-control-id]')) {
      const element = node as HTMLElement
      if (element.tagName === 'BUTTON') fireEvent.click(element)
      else fireEvent.keyDown(element, { key: 'ArrowUp' })
    }
    expect(rig.graph.liveNodeCount).toBe(before)
    expect(rig.graph.render(0.25).some((sample) => sample !== 0)).toBe(false)
    expect(screen.getByText(/nothing on the deck is connected to audio/i)).toBeInTheDocument()
  })
})
