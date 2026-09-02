import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CONTROLS } from '../src/hardware/controls'
import { mountApp, type Mounted } from './helpers'

let mounted: Mounted | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

describe('accessibility.controls — names, roles, values, keyboard operation, visible focus', () => {
  it('every control and key exposes a role and an accessible name', async () => {
    mounted = await mountApp()
    for (const spec of CONTROLS) {
      const node = document.getElementById(spec.id)!
      expect(node.getAttribute('aria-label')).toBe(spec.name)
      if (spec.kind === 'button') expect(node.tagName).toBe('BUTTON')
      else expect(node.getAttribute('role')).toBe('slider')
    }
    const keys = document.querySelectorAll('.key')
    expect(keys).toHaveLength(73)
    for (const key of keys) {
      expect(key.tagName).toBe('BUTTON')
      expect(key.getAttribute('aria-label')).toMatch(/^Key [A-G]#?\d$/)
      expect(key.getAttribute('aria-pressed')).toBe('false')
    }
    expect(document.getElementById('keys')!.getAttribute('aria-label')).toMatch(/73 keys, E1 to E7/)
    expect(document.getElementById('instrument')!.getAttribute('aria-label')).toMatch(/Nord Stage 4 73/)
  })

  it('sliders expose min / max / now / valuetext and orientation; toggles expose aria-pressed', async () => {
    mounted = await mountApp()
    for (const spec of CONTROLS) {
      const node = document.getElementById(spec.id)!
      if (spec.kind === 'button') {
        if (spec.mode === 'toggle' || spec.mode === 'radio') expect(['true', 'false']).toContain(node.getAttribute('aria-pressed'))
        if (spec.mode === 'select') expect(document.getElementById(node.getAttribute('aria-describedby')!)?.textContent).toMatch(/selected/)
        continue
      }
      expect(Number(node.getAttribute('aria-valuemin'))).toBe(spec.min)
      expect(Number(node.getAttribute('aria-valuemax'))).toBe(spec.max)
      expect(Number(node.getAttribute('aria-valuenow'))).toBe(spec.initial)
      expect(node.getAttribute('aria-valuetext')).toBeTruthy()
      if (spec.kind !== 'dial') expect(['vertical', 'horizontal']).toContain(node.getAttribute('aria-orientation'))
    }
  })

  it('everything is reachable and operable from the keyboard', async () => {
    mounted = await mountApp()
    for (const spec of CONTROLS) {
      const node = document.getElementById(spec.id) as HTMLElement
      expect(node.tabIndex).toBeGreaterThanOrEqual(0)
      node.focus()
      expect(document.activeElement).toBe(node)
      if (spec.kind === 'button') continue
      const before = node.getAttribute('aria-valuenow')
      fireEvent.keyDown(node, { key: 'PageUp' })
      const after = node.getAttribute('aria-valuenow')
      if (spec.initial < spec.max || spec.wrap) expect(after).not.toBe(before)
      fireEvent.keyDown(node, { key: 'Home' })
      if (!spec.springBack) expect(Number(node.getAttribute('aria-valuenow'))).toBe(spec.min)
      fireEvent.keyDown(node, { key: 'End' })
      if (!spec.springBack) expect(Number(node.getAttribute('aria-valuenow'))).toBe(spec.max)
    }
    const key = document.getElementById('key-60') as HTMLElement
    key.focus()
    expect(document.activeElement).toBe(key)
  })

  it('the stylesheet gives every control and key a visible focus ring', () => {
    const css = readFileSync(path.resolve(__dirname, '../src/styles.css'), 'utf8')
    const focusRule = css.match(/\.pbtn:focus-visible,[\s\S]*?\{[\s\S]*?\}/)?.[0] ?? ''
    for (const selector of ['.pbtn', '.dial', '.knob', '.fader', '.drawbar', '.wheel', '.pitch-stick']) expect(focusRule).toContain(`${selector}:focus-visible`)
    expect(focusRule).toMatch(/outline:\s*[^;]*solid/)
    const keyRule = css.match(/\.key:focus-visible\s*\{[\s\S]*?\}/)?.[0] ?? ''
    expect(keyRule).toMatch(/outline:\s*[^;]*solid/)
    const statusRule = css.match(/\.status-btn:focus-visible\s*\{[\s\S]*?\}/)?.[0] ?? ''
    expect(statusRule).toMatch(/outline:/)
  })

  it('status controls under the instrument are labelled buttons with live audio status', async () => {
    mounted = await mountApp()
    expect(document.getElementById('start-audio')?.textContent).toMatch(/Start audio/)
    expect(document.getElementById('sustain-pedal')?.getAttribute('aria-pressed')).toBe('false')
    expect(document.getElementById('audio-status')?.getAttribute('role')).toBe('status')
    expect(document.getElementById('audio-status')?.getAttribute('aria-live')).toBe('polite')
  })
})
