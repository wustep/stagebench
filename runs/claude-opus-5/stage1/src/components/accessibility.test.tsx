import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { CONTROLS, controlValueText } from '../model/controls'
import { KEYBED } from '../model/keyboard'
import { SECTION_LAYOUT } from '../model/layout'
import { createRig } from '../test/harness'

const SLIDER_KINDS = new Set(['knob', 'fader', 'drawbar', 'wheel', 'stick'])

/** Feature: accessibility.controls */
describe('accessibility of the control surface', () => {
  it('gives every control the role its behaviour implies', () => {
    const { container } = render(<App boundaries={createRig().boundaries} />)
    for (const spec of CONTROLS) {
      const node = container.querySelector(`[data-control-id="${spec.id}"]`)!
      if (spec.kind === 'button') {
        expect(node.tagName, spec.id).toBe('BUTTON')
      } else if (spec.kind === 'encoder') {
        expect(node.getAttribute('role'), spec.id).toBe('spinbutton')
      } else if (SLIDER_KINDS.has(spec.kind)) {
        expect(node.getAttribute('role'), spec.id).toBe('slider')
      }
    }
  })

  it('gives every control a non-empty accessible name', () => {
    const { container } = render(<App boundaries={createRig().boundaries} />)
    for (const spec of CONTROLS) {
      const node = container.querySelector(`[data-control-id="${spec.id}"]`)! as HTMLElement
      const label = node.getAttribute('aria-label') ?? ''
      expect(label.length, spec.id).toBeGreaterThan(0)
      expect(label, spec.id).toContain(spec.name)
    }
  })

  it('exposes min, max, current value and a readable value on every continuous control', () => {
    const { container } = render(<App boundaries={createRig().boundaries} />)
    for (const spec of CONTROLS) {
      if (spec.kind === 'button') continue
      const node = container.querySelector(`[data-control-id="${spec.id}"]`)!
      expect(Number(node.getAttribute('aria-valuemin')), spec.id).toBe(spec.min)
      expect(Number(node.getAttribute('aria-valuemax')), spec.id).toBe(spec.max)
      expect(Number(node.getAttribute('aria-valuenow')), spec.id).toBeCloseTo(spec.initial, 6)
      expect(node.getAttribute('aria-valuetext'), spec.id).toBeTruthy()
      if (spec.kind !== 'stick') {
        expect(node.getAttribute('aria-valuetext'), spec.id).toBe(controlValueText(spec, spec.initial))
      }
    }
  })

  it('makes every control reachable by keyboard', () => {
    const { container } = render(<App boundaries={createRig().boundaries} />)
    for (const spec of CONTROLS) {
      const node = container.querySelector(`[data-control-id="${spec.id}"]`)! as HTMLElement
      if (node.tagName === 'BUTTON') {
        expect(node.hasAttribute('disabled'), spec.id).toBe(false)
      } else {
        expect(node.getAttribute('tabindex'), spec.id).toBe('0')
      }
    }
  })

  it('marks vertical sliders with their orientation', () => {
    const { container } = render(<App boundaries={createRig().boundaries} />)
    for (const spec of CONTROLS) {
      if (spec.kind !== 'fader' && spec.kind !== 'drawbar') continue
      const node = container.querySelector(`[data-control-id="${spec.id}"]`)!
      expect(node.getAttribute('aria-orientation'), spec.id).toBe('vertical')
    }
  })

  it('names every key with its note and MIDI number, and reports pressed state', () => {
    const { container } = render(<App boundaries={createRig().boundaries} />)
    for (const key of KEYBED) {
      const node = container.querySelector(`#${key.id}`)! as HTMLElement
      expect(node.tagName).toBe('BUTTON')
      expect(node.getAttribute('aria-label')).toBe(`${key.name}, MIDI note ${key.midi}`)
      expect(node.getAttribute('aria-pressed')).toBe('false')
    }
  })

  it('labels the keybed and each section as a landmark region', () => {
    render(<App boundaries={createRig().boundaries} />)
    expect(screen.getByRole('group', { name: /73 key hammer action keybed/i })).toBeInTheDocument()
    for (const section of SECTION_LAYOUT) {
      expect(screen.getByRole('region', { name: section.label })).toBeInTheDocument()
    }
  })

  it('announces audio and MIDI state through live regions', () => {
    render(<App boundaries={createRig().boundaries} />)
    expect(screen.getAllByRole('status').length).toBeGreaterThanOrEqual(2)
  })

  it('keeps every focusable control in document order without positive tabindex', () => {
    const { container } = render(<App boundaries={createRig().boundaries} />)
    const positive = [...container.querySelectorAll('[tabindex]')].filter(
      (node) => Number(node.getAttribute('tabindex')) > 0,
    )
    expect(positive).toHaveLength(0)
  })
})
