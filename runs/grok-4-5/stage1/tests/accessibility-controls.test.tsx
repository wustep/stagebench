import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CONTROLS } from '../src/model/hardware'
import { hardwareStore } from '../src/state/hardware-store'
import { PianoEngine } from '../src/audio/piano-engine'
import { Instrument } from '../src/components/Instrument'
import { createMockContextFactory } from '../src/test/mock-audio'

describe('accessibility.controls', () => {
  afterEach(() => {
    cleanup()
    hardwareStore.reset()
  })

  it('provides accessible names, roles, and keyboard-operable controls', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ createContext })
    render(<Instrument engine={engine} enableMidi={false} />)

    for (const c of CONTROLS) {
      const el = document.querySelector(`[data-control-id="${c.id}"]`) as HTMLElement
      expect(el, c.id).toBeTruthy()
      const label = el.getAttribute('aria-label')
      expect(label, c.id).toBeTruthy()
      expect(label!.length).toBeGreaterThan(0)

      if (c.kind === 'button') {
        expect(el.tagName).toBe('BUTTON')
      }
      if (c.kind === 'knob' || c.kind === 'encoder' || c.kind === 'fader' || c.kind === 'drawbar' || c.kind === 'wheel' || c.kind === 'stick') {
        expect(el.getAttribute('role')).toBe('slider')
        expect(el.hasAttribute('aria-valuenow')).toBe(true)
      }
      if (c.kind === 'oled') {
        expect(el.getAttribute('role')).toBe('status')
      }
    }

    // Keys have accessible names
    const key = document.querySelector('[data-key-midi="60"]') as HTMLElement
    expect(key.getAttribute('aria-label')).toMatch(/key/i)
  })
})
