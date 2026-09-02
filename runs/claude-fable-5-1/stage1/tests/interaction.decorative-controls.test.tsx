import { fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CONTROLS, type ButtonControl, type ContinuousControl } from '../src/hardware/controls'
import { mountApp, type Mounted } from './helpers'

let mounted: Mounted | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

function el(id: string): HTMLElement {
  const node = document.getElementById(id)
  if (!node) throw new Error(`control ${id} is not rendered`)
  return node
}

function snapshotAudio(m: Mounted) {
  return { voices: m.services.engine.activeVoices().length, lastNote: m.services.engine.getStatus().lastNote, held: m.services.bus.heldNotes(), nodes: m.world.ctx.nodes.length }
}

describe('interaction.decorative-controls — every visible control moves or presses, presentation only', () => {
  it('every continuous control (knob, dial, fader, drawbar, wheel, stick) responds to keyboard and pointer drag', async () => {
    mounted = await mountApp()
    const before = snapshotAudio(mounted)
    const continuous = CONTROLS.filter((c): c is ContinuousControl => c.kind !== 'button')
    expect(continuous.length).toBeGreaterThanOrEqual(45)
    for (const spec of continuous) {
      const node = el(spec.id)
      const start = Number(node.getAttribute('aria-valuenow'))
      // keyboard: ArrowUp moves by one step (dials wrap, sticks spring back on key up)
      fireEvent.keyDown(node, { key: 'ArrowUp' })
      const afterKey = Number(node.getAttribute('aria-valuenow'))
      if (spec.wrap) expect(afterKey).not.toBe(start)
      else if (start < spec.max) expect(afterKey).toBeGreaterThan(start)
      fireEvent.keyDown(node, { key: 'ArrowDown' })
      // pointer: a vertical (or horizontal) drag changes the value
      const beforeDrag = Number(node.getAttribute('aria-valuenow'))
      fireEvent.pointerDown(node, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
      fireEvent.pointerMove(node, { pointerId: 1, clientX: spec.kind === 'stick' ? 130 : 100, clientY: spec.kind === 'stick' ? 100 : spec.kind === 'drawbar' ? 140 : 60 })
      const during = Number(node.getAttribute('aria-valuenow'))
      expect(during).not.toBe(beforeDrag === spec.max && !spec.wrap ? NaN : beforeDrag === spec.max && !spec.wrap ? during : beforeDrag)
      fireEvent.pointerUp(node, { pointerId: 1 })
      if (spec.springBack) expect(Number(node.getAttribute('aria-valuenow'))).toBe(spec.initial)
      expect(Number(node.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(spec.min)
      expect(Number(node.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(spec.max)
    }
    expect(snapshotAudio(mounted)).toEqual(before)
  })

  it('every button presses: toggles light, selectors cycle, radios switch, momentary buttons hold while pressed', async () => {
    mounted = await mountApp()
    const before = snapshotAudio(mounted)
    const buttons = CONTROLS.filter((c): c is ButtonControl => c.kind === 'button')
    expect(buttons.length).toBeGreaterThan(80)
    for (const spec of buttons) {
      const node = el(spec.id) as HTMLButtonElement
      expect(node.tagName).toBe('BUTTON')
      if (spec.mode === 'toggle') {
        const start = node.getAttribute('aria-pressed')
        fireEvent.click(node)
        expect(node.getAttribute('aria-pressed')).toBe(start === 'true' ? 'false' : 'true')
        fireEvent.click(node)
        expect(node.getAttribute('aria-pressed')).toBe(start)
      } else if (spec.mode === 'select') {
        const n = spec.options!.length
        const start = Number(node.dataset.value)
        fireEvent.click(node)
        expect(Number(node.dataset.value)).toBe((start + 1) % n)
        const describedBy = node.getAttribute('aria-describedby')!
        expect(document.getElementById(describedBy)?.textContent).toContain(spec.options![(start + 1) % n])
        for (let i = 1; i < n; i++) fireEvent.click(node)
        expect(Number(node.dataset.value)).toBe(start)
      } else if (spec.mode === 'radio') {
        fireEvent.click(node)
        expect(node.getAttribute('aria-pressed')).toBe('true')
        const group = buttons.filter((b) => b.mode === 'radio' && b.radioGroup === spec.radioGroup && b.id !== spec.id)
        for (const other of group) expect(el(other.id).getAttribute('aria-pressed')).toBe('false')
      } else {
        fireEvent.pointerDown(node, { pointerId: 1, button: 0 })
        expect(node.dataset.value).toBe('1')
        expect(node.className).toContain('is-pressed')
        fireEvent.pointerUp(node, { pointerId: 1 })
        expect(node.dataset.value).toBe('0')
        fireEvent.keyDown(node, { key: ' ' })
        expect(node.dataset.value).toBe('1')
        fireEvent.keyUp(node, { key: ' ' })
        expect(node.dataset.value).toBe('0')
      }
    }
    expect(snapshotAudio(mounted)).toEqual(before)
  })

  it('panel state lives in the normalized hardware store and changes nothing else', async () => {
    mounted = await mountApp()
    const { hardware, engine, bus } = mounted.services
    const initial = hardware.get().values
    fireEvent.click(el('organ.vibrato.on'))
    fireEvent.keyDown(el('effects.reverb.dry-wet'), { key: 'ArrowUp' })
    const next = hardware.get().values
    const changed = Object.keys(next).filter((k) => next[k] !== initial[k])
    expect(changed.sort()).toEqual(['effects.reverb.dry-wet', 'organ.vibrato.on'])
    expect(engine.activeVoices()).toEqual([])
    expect(engine.getStatus().lastNote).toBeNull()
    expect(bus.heldNotes()).toEqual([])
    expect(mounted.world.ctx.nodes.length).toBe(0) // no audio context was even created by panel use
    // the displays still report honestly after panel changes
    expect(document.getElementById('program.oled')!.textContent).toMatch(/Basic piano/)
  })

  it('shows state visibly: knob angle, fader cap position, drawbar cap position, LED lit classes', async () => {
    mounted = await mountApp()
    const knob = el('effects.mod1.rate')
    const angleBefore = knob.style.getPropertyValue('--angle')
    fireEvent.keyDown(knob, { key: 'End' })
    expect(knob.style.getPropertyValue('--angle')).not.toBe(angleBefore)
    const fader = el('organ.layer-a.level')
    fireEvent.keyDown(fader, { key: 'Home' })
    expect((fader.querySelector('.fader-cap') as HTMLElement).style.bottom).toBe('0%')
    expect(fader.parentElement!.querySelectorAll('.ladder-led.lit')).toHaveLength(0)
    fireEvent.keyDown(fader, { key: 'End' })
    expect((fader.querySelector('.fader-cap') as HTMLElement).style.bottom).toBe('100%')
    expect(fader.parentElement!.querySelectorAll('.ladder-led.lit')).toHaveLength(12)
    const drawbar = el('organ.drawbar.16')
    fireEvent.keyDown(drawbar, { key: 'Home' })
    expect(drawbar.closest('.drawbar-body')!.querySelectorAll('.ladder-led.lit')).toHaveLength(0)
    fireEvent.keyDown(drawbar, { key: 'End' })
    expect(drawbar.closest('.drawbar-body')!.querySelectorAll('.ladder-led.lit')).toHaveLength(8)
    const toggle = el('organ.percussion.on')
    const led = toggle.closest('.pbtn-wrap')!.querySelector('.led')!
    expect(led.className).not.toContain('lit')
    fireEvent.click(toggle)
    expect(led.className).toContain('lit')
    expect(toggle.className).toContain('is-lit')
  })
})
