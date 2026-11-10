import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { INVENTORY } from '../src/hardware/inventory'
import { KEYBED_MODEL } from '../src/hardware/keys'
import { valueText } from '../src/hardware/store'
import type { ButtonDef, RangeDef } from '../src/hardware/types'
import { mountApp } from './support/app'

/**
 * Feature: accessibility.controls
 * Accessible names, roles, values, keyboard operation, and visible focus.
 */

const buttons = INVENTORY.controls.filter((control): control is ButtonDef => control.kind === 'button')
const ranges = INVENTORY.controls.filter((control): control is RangeDef => control.kind !== 'button')

describe('accessibility.controls: names and roles', () => {
  it('every panel control has a role and a unique, human accessible name', () => {
    const app = mountApp()
    const names = new Set<string>()
    for (const def of INVENTORY.controls) {
      const element = app.control(def.id)
      const role = element.getAttribute('role') ?? (element.tagName === 'BUTTON' ? 'button' : null)
      expect(role, def.id).toBe(def.kind === 'button' ? 'button' : 'slider')
      const name = element.getAttribute('aria-label') ?? ''
      expect(name, def.id).toBe(def.name)
      expect(name.length, def.id).toBeGreaterThan(3)
      expect(name).not.toMatch(/^[a-z]+(-[a-z0-9]+)+$/) // not a raw ID
      expect(names.has(name), `duplicate name: ${name}`).toBe(false)
      names.add(name)
    }
    expect(names.size).toBe(146)
  })

  it('finds controls by role and name the way assistive tech does', () => {
    const app = mountApp()
    expect(app.getByRole('button', { name: 'Piano section On' })).toBe(app.control('piano-on'))
    expect(app.getByRole('slider', { name: 'Master Level' })).toBe(app.control('perf-master-level'))
    expect(app.getByRole('slider', { name: 'Organ drawbar 1, 16′' })).toBe(app.control('organ-drawbar-1'))
    expect(app.getByRole('slider', { name: 'Modulation wheel' })).toBe(app.control('perf-mod-wheel'))
    expect(app.getByRole('button', { name: 'Program 5' })).toBe(app.control('program-5'))
    expect(app.getAllByRole('slider')).toHaveLength(ranges.length)
  })

  it('every key is a named button: "E1" … "F sharp 1" … "E7"', () => {
    const app = mountApp()
    const keys = within(app.control('keybed')).getAllByRole('button')
    expect(keys.map((key) => key.getAttribute('aria-label'))).toEqual(KEYBED_MODEL.keys.map((key) => key.spokenName))
    expect(keys[0]).toHaveAttribute('aria-label', 'E1')
    expect(keys[2]).toHaveAttribute('aria-label', 'F sharp 1')
    expect(keys.at(-1)).toHaveAttribute('aria-label', 'E7')
    expect(new Set(keys.map((key) => key.getAttribute('aria-label'))).size).toBe(73)
    for (const key of keys) expect(key).toHaveAttribute('aria-pressed', 'false')
  })

  it('labels the instrument, its six sections, the keybed, and both OLEDs', () => {
    const app = mountApp()
    expect(app.getByRole('group', { name: /Nord Stage 4 73/ })).toBe(app.control('instrument'))
    expect(app.getByRole('group', { name: /Keybed, 73 keys/ })).toBe(app.control('keybed'))
    const regions = app.getAllByRole('region').map((element) => element.getAttribute('aria-label'))
    expect(regions).toEqual(['Performance controls', 'Organ', 'Piano', 'Program and morph', 'Synth', 'Layer effects'])
    expect(app.getByRole('img', { name: /^Program OLED/ })).toBe(app.control('program-oled'))
    expect(app.getByRole('img', { name: /^Synth OLED/ })).toBe(app.control('synth-oled'))
    expect(app.getByRole('main')).toBeInTheDocument()
    expect(app.getByRole('heading', { level: 1 })).toHaveTextContent(/Nord Stage 4 73/)
    expect(app.getByRole('link', { name: 'Skip to keybed' })).toHaveAttribute('href', '#keybed')
  })

  it('hides purely visual hardware (legends, LEDs, plates) from the accessibility tree', () => {
    const app = mountApp()
    for (const selector of ['.lbl', '.led', '.plate', '.ladder', '.bar-graph', '.chassis']) {
      const elements = app.container.querySelectorAll(selector)
      expect(elements.length, selector).toBeGreaterThan(0)
      for (const element of elements) expect(element).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it('announces audio and MIDI status in live regions', () => {
    const app = mountApp()
    const statuses = app.getAllByRole('status')
    expect(statuses).toHaveLength(2)
    expect(statuses[0]).toHaveTextContent(/Audio/)
    expect(statuses[1]).toHaveTextContent(/MIDI/)
    for (const status of statuses) expect(status).toHaveAttribute('aria-live', 'polite')
  })
})

describe('accessibility.controls: values', () => {
  it('every slider reports min, max, current value, value text, and orientation', () => {
    const app = mountApp()
    for (const def of ranges) {
      const element = app.control(def.id)
      expect(element).toHaveAttribute('aria-valuemin', String(def.min))
      expect(element).toHaveAttribute('aria-valuemax', String(def.max))
      expect(element).toHaveAttribute('aria-valuenow', String(def.initial))
      expect(element).toHaveAttribute('aria-valuetext', valueText(def, def.initial))
      expect(element.getAttribute('aria-valuetext')!.length).toBeGreaterThan(0)
      expect(element).toHaveAttribute('aria-orientation', def.kind === 'stick' ? 'horizontal' : 'vertical')
    }
  })

  it('speaks values in the hardware\'s own terms', () => {
    const def = (id: string) => INVENTORY.controlById.get(id) as RangeDef
    expect(valueText(def('organ-drawbar-1'), 8)).toBe('8 of 8')
    expect(valueText(def('organ-layer-a-level'), 50)).toBe('50 percent')
    expect(valueText(def('program-dial'), 0)).toBe('detent 1 of 24')
    expect(valueText(def('perf-pitch-stick'), 0)).toBe('centre')
    expect(valueText(def('perf-pitch-stick'), -50)).toBe('down 50 percent')
    expect(valueText(def('fx-eq-bass'), 6)).toBe('6 dB')
    expect(valueText(def('rotary-drive'), 1.5)).toBe('1.5')
  })

  it('selector buttons describe which indicator position they are on', () => {
    const app = mountApp()
    const type = app.control('piano-type')
    expect(type.getAttribute('aria-description')).toMatch(/Indicator at Grand \(1 of 6\)/)
    fireEvent.click(type)
    expect(type.getAttribute('aria-description')).toMatch(/Indicator at Upright \(2 of 6\)/)
    // Phase 2: the piano type selector is functional, so it no longer calls itself decorative…
    expect(type.getAttribute('aria-description')).not.toMatch(/Decorative/)
    // …while a selector that is still decorative says so, in the same sentence as its position.
    const synthFocus = app.control('fx-focus-synth')
    expect(synthFocus.getAttribute('aria-description')).toMatch(/Indicator at None \(1 of 5\)/)
    expect(synthFocus.getAttribute('aria-description')).toMatch(/Decorative in Phase 2/)
  })
})

describe('accessibility.controls: keyboard operation', () => {
  it('every panel control and one key are in the tab order, with no positive tabindex', () => {
    const app = mountApp()
    for (const def of INVENTORY.controls) expect(app.control(def.id).tabIndex, def.id).toBe(0)
    for (const element of app.container.querySelectorAll<HTMLElement>('[tabindex]')) {
      expect(element.tabIndex).toBeLessThanOrEqual(0)
    }
    const keys = within(app.control('keybed')).getAllByRole('button')
    expect(keys.filter((key) => key.tabIndex === 0)).toHaveLength(1)
  })

  it('every button presses with Space and with Enter', () => {
    const app = mountApp()
    for (const def of buttons) {
      const element = app.control(def.id)
      fireEvent.keyDown(element, { key: ' ' })
      expect(element, def.id).toHaveAttribute('data-pressed', 'true')
      fireEvent.keyDown(element, { key: ' ', repeat: true })
      fireEvent.keyUp(element, { key: ' ' })
      expect(element).toHaveAttribute('data-pressed', 'false')
      fireEvent.keyDown(element, { key: 'Enter' })
      fireEvent.keyUp(element, { key: 'Enter' })
      expect(element, def.id).toHaveAttribute('data-presses', '2')
      // Other keys do nothing.
      fireEvent.keyDown(element, { key: 'a' })
      fireEvent.keyUp(element, { key: 'a' })
      expect(element).toHaveAttribute('data-presses', '2')
    }
  })

  it('every slider moves with arrows, Page Up/Down, Home, and End', () => {
    const app = mountApp()
    for (const def of ranges) {
      const element = app.control(def.id)
      const value = () => Number(element.getAttribute('aria-valuenow'))
      const more = def.kind === 'drawbar' ? 'ArrowDown' : 'ArrowUp'
      const less = def.kind === 'drawbar' ? 'ArrowUp' : 'ArrowDown'

      fireEvent.keyDown(element, { key: 'Home' })
      expect(value(), def.id).toBe(def.min)
      fireEvent.keyDown(element, { key: more })
      expect(value(), def.id).toBeCloseTo(def.min + def.keyStep, 6)
      fireEvent.keyDown(element, { key: 'ArrowRight' })
      expect(value(), def.id).toBeCloseTo(def.min + 2 * def.keyStep, 6)
      fireEvent.keyDown(element, { key: 'ArrowLeft' })
      fireEvent.keyDown(element, { key: less })
      expect(value(), def.id).toBe(def.min)
      fireEvent.keyDown(element, { key: 'PageUp' })
      expect(value(), def.id).toBeCloseTo(def.min + def.bigStep, 6)
      fireEvent.keyDown(element, { key: 'PageDown' })
      expect(value(), def.id).toBe(def.min)
      fireEvent.keyDown(element, { key: 'End' })
      expect(value(), def.id).toBe(def.max)
      expect(element).toHaveAttribute('aria-valuetext', valueText(def, def.max))
      if (!def.wrap) {
        // Hard stops: no value outside the range.
        fireEvent.keyDown(element, { key: more })
        expect(value(), def.id).toBe(def.max)
      }
    }
  })

  it('handled keys do not scroll the page; unhandled keys pass through', () => {
    const app = mountApp()
    const knob = app.control('rotary-drive')
    expect(fireEvent.keyDown(knob, { key: 'ArrowUp' })).toBe(false)
    expect(fireEvent.keyDown(knob, { key: 'PageDown' })).toBe(false)
    expect(fireEvent.keyDown(knob, { key: 'Tab' })).toBe(true)
    const button = app.control('store')
    expect(fireEvent.keyDown(button, { key: ' ' })).toBe(false)
    expect(fireEvent.keyDown(button, { key: 'Tab' })).toBe(true)
  })
})

describe('accessibility.controls: visible focus', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'styles.css'), 'utf8')

  it('draws a focus ring on every focusable part of the instrument', () => {
    const rule = css.match(/\.instrument :focus-visible\s*\{([^}]*)\}/)
    expect(rule).not.toBeNull()
    const body = rule![1]
    expect(body).toMatch(/outline:\s*calc\(3px \/ var\(--s, 1\)\) solid var\(--focus\)/)
    expect(body).toMatch(/outline-offset/)
    // The ring is sized in screen px (divided by the instrument scale), so it stays visible when fitted.
    expect(css).toMatch(/--focus:\s*#ffd23f/)
  })

  it('never removes the outline from keyboard focus', () => {
    // `outline: none` is allowed only on plain :focus (mouse focus), never on :focus-visible.
    const blocks = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    for (const [, selector, body] of blocks) {
      if (/outline:\s*(none|0)\b/.test(body)) expect(selector.trim()).not.toMatch(/focus-visible/)
    }
    expect(css).toMatch(/\.tool:focus-visible/)
  })

  it('exposes the instrument scale the focus ring depends on', () => {
    const app = mountApp()
    const instrument = app.control('instrument')
    expect(Number(instrument.style.getPropertyValue('--s'))).toBeGreaterThan(0)
  })

  it('controls can take focus programmatically', () => {
    const app = mountApp()
    for (const id of ['piano-on', 'rotary-drive', 'organ-drawbar-5', 'perf-pitch-stick', 'key-60']) {
      const element = app.control(id)
      element.focus()
      expect(app.container.ownerDocument.activeElement).toBe(element)
    }
  })
})
