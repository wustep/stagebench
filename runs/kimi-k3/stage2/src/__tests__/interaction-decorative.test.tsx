import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { PianoEngine } from '../audio/engine'
import { FakeAudioBackend } from '../audio/fake-backend'
import { CONTROLS } from '../hardware/controls'
import { getControlValue, resetHardwareStore } from '../state/hardware-store'

function setup() {
  const backend = new FakeAudioBackend()
  const engine = new PianoEngine(backend)
  const utils = render(<App engine={engine} disableMidi />)
  return { backend, engine, ...utils }
}

beforeEach(() => resetHardwareStore())

describe('interaction.decorative-controls', () => {
  it('every control is rendered with its stable ID', () => {
    const { container } = setup()
    const rendered = container.querySelectorAll('[data-control-id]')
    expect(rendered.length).toBe(CONTROLS.length)
  })

  it('buttons toggle presentation state on click and keyboard', () => {
    const { container } = setup()
    const btn = container.querySelector('[data-control-id="piano.softRelease"]')!
    expect(getControlValue('piano.softRelease')).toBe(0)
    fireEvent.click(btn)
    expect(getControlValue('piano.softRelease')).toBe(1)
    fireEvent.keyDown(btn, { key: ' ' })
    expect(getControlValue('piano.softRelease')).toBe(0)
    fireEvent.keyDown(btn, { key: 'Enter' })
    expect(getControlValue('piano.softRelease')).toBe(1)
  })

  it('selector buttons cycle their options', () => {
    const { container } = setup()
    const sel = container.querySelector('[data-control-id="piano.type"]')!
    expect(getControlValue('piano.type')).toBe(0)
    fireEvent.click(sel)
    expect(getControlValue('piano.type')).toBe(1)
    fireEvent.click(sel)
    fireEvent.click(sel)
    fireEvent.click(sel)
    fireEvent.click(sel)
    expect(getControlValue('piano.type')).toBe(5)
    fireEvent.click(sel) // wraps
    expect(getControlValue('piano.type')).toBe(0)
  })

  it('knobs respond to arrow keys within bounds', () => {
    const { container } = setup()
    const knob = container.querySelector('[data-control-id="perf.masterLevel"]')!
    const start = getControlValue('perf.masterLevel')
    fireEvent.keyDown(knob, { key: 'ArrowUp' })
    expect(getControlValue('perf.masterLevel')).toBe(start + 1)
    fireEvent.keyDown(knob, { key: 'End' })
    expect(getControlValue('perf.masterLevel')).toBe(0)
    fireEvent.keyDown(knob, { key: 'ArrowDown' })
    expect(getControlValue('perf.masterLevel')).toBe(0) // clamped
    fireEvent.keyDown(knob, { key: 'Home' })
    expect(getControlValue('perf.masterLevel')).toBe(127)
  })

  it('faders and drawbars respond to arrow keys within bounds', () => {
    const { container } = setup()
    const fader = container.querySelector('[data-control-id="organ.level"]')!
    fireEvent.keyDown(fader, { key: 'Home' })
    expect(getControlValue('organ.level')).toBe(127)
    const drawbar = container.querySelector('[data-control-id="organ.drawbar.5"]')!
    fireEvent.keyDown(drawbar, { key: 'Home' })
    expect(getControlValue('organ.drawbar.5')).toBe(8)
    fireEvent.keyDown(drawbar, { key: 'ArrowDown' })
    expect(getControlValue('organ.drawbar.5')).toBe(7)
  })

  it('knobs respond to pointer drag', () => {
    const { container } = setup()
    const knob = container.querySelector('[data-control-id="synth.filterCutoff"]')!
    const start = getControlValue('synth.filterCutoff')
    fireEvent.pointerDown(knob, { pointerId: 1, clientY: 100 })
    fireEvent.pointerMove(knob, { pointerId: 1, clientY: 50 }) // drag up = increase
    fireEvent.pointerUp(knob, { pointerId: 1 })
    expect(getControlValue('synth.filterCutoff')).toBeGreaterThan(start)
  })

  it('decorative movement changes presentation state only — no voices, no status change', () => {
    const { container, backend, engine } = setup()
    for (const id of ['piano.on', 'synth.on', 'fx.reverbOn', 'organ.model', 'program.split', 'program.dial']) {
      const el = container.querySelector(`[data-control-id="${id}"]`)!
      fireEvent.click(el)
      fireEvent.keyDown(el, { key: 'ArrowUp' })
    }
    expect(backend.activeVoiceCount()).toBe(0)
    expect(backend.startCount).toBe(0)
    expect(engine.getStatus().status).not.toBe('error')
  })
})
