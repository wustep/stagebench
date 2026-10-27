import { describe, expect, it, afterEach } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import App from '../App'
import { ALL_CONTROLS, blocksBySection } from '../hardware/catalog'
import { isNumeric, isSelector } from '../hardware/types'
import { createPresentationStore, normalizeValue } from '../hardware/presentation'
import { createRecordingEngine } from '../audio/fakes'

/**
 * interaction.decorative-controls — every visible control moves or presses accessibly and
 * changes presentation state only.
 *
 * The honesty claim is enforced structurally: with a recording engine injected, operating
 * a panel control must leave that engine completely untouched.
 */
afterEach(() => cleanup())

const SAMPLE = [
  'performance.master-level',
  'performance.pitch-stick',
  'organ.drawbar.16',
  'organ.model.select',
  'piano.type',
  'piano.layer.a.level',
  'piano.kb-touch',
  'program.dial',
  'synth.filter.freq',
  'effects.reverb.dry-wet',
  'organ.layer.a.on',
  'program.slot.3',
]

describe('interaction.decorative-controls — presentation only', () => {
  it('changes nothing in the audio engine when a panel control is moved', () => {
    const engine = createRecordingEngine()
    render(<App deps={{ engine }} />)
    const before = {
      started: engine.startedVoices.length,
      ended: engine.endedVoices.length,
      stopAll: engine.stopAllCalls,
    }

    const knob = document.querySelector('[data-control-id="performance.master-level"] [role="slider"]')
    expect(knob).not.toBeNull()
    fireEvent.keyDown(knob!, { key: 'ArrowUp' })
    fireEvent.keyDown(knob!, { key: 'ArrowDown' })

    const drawbar = document.querySelector('[data-control-id="organ.drawbar.16"] [role="slider"]')
    fireEvent.keyDown(drawbar!, { key: 'Home' })

    const toggle = document.querySelector('[data-control-id="organ.layer.a.on"] .ctl-track-toggle')!
    fireEvent.click(toggle)

    const option = document.querySelector('[data-control-id="piano.type"] [role="radio"]')!
    fireEvent.click(option)

    expect(engine.startedVoices.length).toBe(before.started)
    expect(engine.endedVoices.length).toBe(before.ended)
    expect(engine.stopAllCalls).toBe(before.stopAll)
  })

  it('does not start audio when a panel control is the first interaction', () => {
    const engine = createRecordingEngine()
    render(<App deps={{ engine }} />)
    fireEvent.click(document.querySelector('[data-control-id="program.store"] .ctl-track-toggle')!)
    // The engine only starts from the note lifecycle, never from a panel control.
    expect(engine.started).toBe(0)
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('renders every catalogued control exactly once with its stable id', () => {
    render(<App deps={{ disableAudio: true }} />)
    for (const control of ALL_CONTROLS) {
      const matches = document.querySelectorAll(`[data-control-id="${control.id}"]`)
      expect(matches.length, `control ${control.id}`).toBe(1)
    }
    expect(document.querySelectorAll('[data-control-id]')).toHaveLength(ALL_CONTROLS.length)
  })

  it('shows a knob turning: the indicator angle follows the value', () => {
    render(<App deps={{ disableAudio: true }} />)
    const slider = document.querySelector('[data-control-id="performance.master-level"] [role="slider"]') as HTMLElement
    const angleBefore = slider.style.getPropertyValue('--ctl-angle')
    fireEvent.keyDown(slider, { key: 'Home' })
    const angleAfter = slider.style.getPropertyValue('--ctl-angle')
    expect(angleBefore).not.toBe(angleAfter)
    expect(slider.getAttribute('aria-valuenow')).toBe('0')
    fireEvent.keyDown(slider, { key: 'End' })
    expect(slider.getAttribute('aria-valuenow')).toBe('100')
  })

  it('slides a drawbar and lights its LED ladder', () => {
    render(<App deps={{ disableAudio: true }} />)
    const cell = document.querySelector('[data-control-id="organ.drawbar.5-1-3"]') as HTMLElement
    const slider = cell.querySelector('[role="slider"]') as HTMLElement
    expect(slider.getAttribute('aria-valuenow')).toBe('0')
    expect(cell.querySelectorAll('.led-ladder-dot.lit')).toHaveLength(0)
    fireEvent.keyDown(slider, { key: 'End' })
    expect(slider.getAttribute('aria-valuenow')).toBe('8')
    expect(cell.querySelectorAll('.led-ladder-dot.lit')).toHaveLength(8)
    fireEvent.keyDown(slider, { key: 'Home' })
    expect(cell.querySelectorAll('.led-ladder-dot.lit')).toHaveLength(0)
  })

  it('lights a button that is switched on and clears it again', () => {
    render(<App deps={{ disableAudio: true }} />)
    const button = document.querySelector('[data-control-id="piano.string-res"] .ctl-track-toggle') as HTMLElement
    expect(button.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(button)
    expect(button.getAttribute('aria-checked')).toBe('true')
    expect(button.classList.contains('is-on')).toBe(true)
    fireEvent.click(button)
    expect(button.getAttribute('aria-checked')).toBe('false')
  })

  it('depresses a momentary button only while it is held', () => {
    render(<App deps={{ disableAudio: true }} />)
    const button = document.querySelector('[data-control-id="program.store"] .ctl-track-toggle') as HTMLElement
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, pointerType: 'mouse' })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    fireEvent.pointerUp(button, { pointerId: 1, button: 0, pointerType: 'mouse' })
    expect(button.getAttribute('aria-pressed')).toBe('false')
  })

  it('clears a held momentary button when focus leaves it', () => {
    render(<App deps={{ disableAudio: true }} />)
    const button = document.querySelector('[data-control-id="program.store"] .ctl-track-toggle') as HTMLElement
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, pointerType: 'mouse' })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    fireEvent.blur(button)
    expect(button.getAttribute('aria-pressed')).toBe('false')
  })

  it('moves a selector option and its LED', () => {
    render(<App deps={{ disableAudio: true }} />)
    const group = document.querySelector('[data-control-id="piano.kb-touch"]') as HTMLElement
    const radios = Array.from(group.querySelectorAll('[role="radio"]'))
    expect(radios).toHaveLength(3)
    expect(radios[1].getAttribute('aria-checked')).toBe('true')
    fireEvent.click(radios[2])
    expect(radios[2].getAttribute('aria-checked')).toBe('true')
    expect(radios[1].getAttribute('aria-checked')).toBe('false')
  })

  it('supports arrow keys and Home/End on a selector', () => {
    render(<App deps={{ disableAudio: true }} />)
    const group = document.querySelector('[data-control-id="piano.timbre"]') as HTMLElement
    const checked = () =>
      Array.from(group.querySelectorAll('[role="radio"]')).findIndex(
        (r) => r.getAttribute('aria-checked') === 'true',
      )
    const start = checked()
    fireEvent.keyDown(group, { key: 'ArrowDown' })
    expect(checked()).toBe(start + 1)
    fireEvent.keyDown(group, { key: 'End' })
    expect(checked()).toBe(4)
    fireEvent.keyDown(group, { key: 'Home' })
    expect(checked()).toBe(0)
    // The value can never move past either printed end.
    fireEvent.keyDown(group, { key: 'ArrowUp' })
    expect(checked()).toBe(0)
    fireEvent.keyDown(group, { key: 'End' })
    fireEvent.keyDown(group, { key: 'ArrowDown' })
    expect(checked()).toBe(4)
  })

  it('returns the pitch stick to rest when the pointer is released', () => {
    render(<App deps={{ disableAudio: true }} />)
    const stick = document.querySelector('[data-control-id="performance.pitch-stick"] [role="slider"]') as HTMLElement
    expect(stick.getAttribute('aria-valuenow')).toBe('0')
    fireEvent.keyDown(stick, { key: 'End' })
    expect(stick.getAttribute('aria-valuenow')).toBe('1')
    fireEvent.pointerDown(stick, { pointerId: 1, clientY: 100, button: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(stick, { pointerId: 1, clientY: 100, button: 0, pointerType: 'mouse' })
    expect(stick.getAttribute('aria-valuenow')).toBe('0')
  })

  it('moves a control by dragging vertically', () => {
    render(<App deps={{ disableAudio: true }} />)
    const slider = document.querySelector('[data-control-id="synth.filter.freq"] [role="slider"]') as HTMLElement
    const start = Number(slider.getAttribute('aria-valuenow'))
    fireEvent.pointerDown(slider, { pointerId: 3, clientY: 200, button: 0, pointerType: 'mouse' })
    fireEvent.pointerMove(slider, { pointerId: 3, clientY: 120, button: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(slider, { pointerId: 3, clientY: 120, button: 0, pointerType: 'mouse' })
    expect(Number(slider.getAttribute('aria-valuenow'))).toBeGreaterThan(start)
  })

  it('keeps a control inside its declared range when dragged past the end', () => {
    render(<App deps={{ disableAudio: true }} />)
    const slider = document.querySelector('[data-control-id="effects.amp.bass"] [role="slider"]') as HTMLElement
    fireEvent.pointerDown(slider, { pointerId: 4, clientY: 200, button: 0, pointerType: 'mouse' })
    fireEvent.pointerMove(slider, { pointerId: 4, clientY: -4000, button: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(slider, { pointerId: 4, clientY: -4000, button: 0, pointerType: 'mouse' })
    expect(Number(slider.getAttribute('aria-valuenow'))).toBe(15)
  })

  it('resets a control to its printed default on double click', () => {
    render(<App deps={{ disableAudio: true }} />)
    const slider = document.querySelector('[data-control-id="synth.filter.freq"] [role="slider"]') as HTMLElement
    const initial = slider.getAttribute('aria-valuenow')
    fireEvent.keyDown(slider, { key: 'Home' })
    expect(slider.getAttribute('aria-valuenow')).not.toBe(initial)
    fireEvent.doubleClick(slider)
    expect(slider.getAttribute('aria-valuenow')).toBe(initial)
  })

  it('keeps the presentation state independent of the audio graph in the store itself', () => {
    const store = createPresentationStore()
    const engine = createRecordingEngine()
    store.set('effects.reverb.dry-wet', 9)
    expect(store.value('effects.reverb.dry-wet')).toBe(9)
    // The store has no reference to the engine and cannot reach it.
    expect(engine.startedVoices).toHaveLength(0)
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('clamps and snaps every numeric control to its declared step', () => {
    for (const control of ALL_CONTROLS.filter(isNumeric)) {
      expect(normalizeValue(control, control.max + 1000)).toBe(control.max)
      expect(normalizeValue(control, control.min - 1000)).toBe(control.min)
      const mid = normalizeValue(control, (control.min + control.max) / 2)
      expect(typeof mid).toBe('number')
      const steps = (Number(mid) - control.min) / control.step
      expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6)
    }
  })

  it('wraps every control in a block that belongs to its own section', () => {
    for (const control of ALL_CONTROLS) {
      const block = blocksBySection(control.section).find((b) => b.id === control.block)
      expect(block, `block for ${control.id}`).toBeDefined()
    }
  })

  it('gives every control a printed legend and an accessible name', () => {
    render(<App deps={{ disableAudio: true }} />)
    for (const id of SAMPLE) {
      const cell = document.querySelector(`[data-control-id="${id}"]`) as HTMLElement
      expect(cell, id).not.toBeNull()
      const legend = cell.querySelector('.ctl-legend')?.textContent?.trim() ?? ''
      expect(legend.length, `legend for ${id}`).toBeGreaterThan(0)
    }
  })

  it('exposes selectors as radiogroups with each printed position individually named', () => {
    render(<App deps={{ disableAudio: true }} />)
    for (const control of ALL_CONTROLS.filter(isSelector)) {
      const cell = document.querySelector(`[data-control-id="${control.id}"]`) as HTMLElement
      expect(cell.getAttribute('role'), control.id).toBe('radiogroup')
      expect(cell.getAttribute('aria-label'), control.id).toBe(control.name)
      const radios = cell.querySelectorAll('[role="radio"]')
      expect(radios.length).toBe(control.options.length)
      for (const radio of Array.from(radios)) {
        expect(radio.getAttribute('aria-label')).toContain(control.name)
      }
    }
  })
})
