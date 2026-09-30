import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'
import { createHarness, type Harness } from './test-utils/fakes'

afterEach(cleanup)

const mount = (h: Harness = createHarness()) => ({ h, ...render(<App deps={h.deps} />) })
const control = (c: HTMLElement, id: string) => c.querySelector(`[data-control-id="${id}"]`) as HTMLElement
const key = (c: HTMLElement, note: number) => c.querySelector(`[data-note="${note}"]`) as HTMLElement
const tap = (el: HTMLElement, init: object = {}) => {
  fireEvent.pointerDown(el, { pointerId: 1, ...init })
  fireEvent.pointerUp(el, { pointerId: 1 })
}
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const program = (c: HTMLElement) => (c.querySelector('#program-oled') as HTMLElement).textContent ?? ''

describe('piano.layers / piano.instrument-library — the panel drives the sound (DOM)', () => {
  it('shows the selected type and model in the Program display and switches them from the panel', () => {
    const { container } = mount()
    expect(program(container)).toMatch(/A▸ Grand · Salamander Grand/)
    expect(program(container)).toMatch(/B\s+off/)
    tap(control(container, 'piano-select'))
    expect(control(container, 'piano-select').getAttribute('aria-label')).toBe('Piano type: Upright')
    expect(program(container)).toMatch(/A▸ Upright · Upright KW/)
    tap(control(container, 'piano-select'))
    fireEvent.keyDown(control(container, 'piano-model-dial'), { key: 'ArrowUp' })
    expect(program(container)).toMatch(/Electric · Pianet T/)
    expect(control(container, 'piano-model-dial').getAttribute('aria-description')).toMatch(/Pianet T, model 2 of 2/)
  })

  it('a key press starts one voice per enabled layer, each on its own layer, through the one shared audio context', async () => {
    const { container, h } = mount()
    tap(control(container, 'piano-layer-b-onoff'), { shiftKey: true })
    expect(control(container, 'piano-layer-b-onoff').getAttribute('aria-pressed')).toBe('true')
    expect(control(container, 'piano-layer-a-onoff').getAttribute('aria-pressed')).toBe('true')
    expect(control(container, 'piano-layer-b-onoff').getAttribute('data-focused')).toBe('true')
    fireEvent.pointerDown(key(container, 60), { pointerId: 5 })
    await settle()
    expect(h.contexts).toHaveLength(1)
    expect(h.ctx()!.voiceSources().length).toBe(2)
    expect(within(container).getByTestId('voice-status').textContent).toMatch(/Voices 2\/24/)
    expect(program(container)).toMatch(/AUDIO READY/)
    fireEvent.pointerUp(window, { pointerId: 5 })
  })

  it('the Piano section button mutes the keys: they still move, nothing sounds', () => {
    const { container, h } = mount()
    tap(control(container, 'piano-on'))
    expect(program(container)).toMatch(/PIANO SECTION OFF/)
    fireEvent.pointerDown(key(container, 60), { pointerId: 2 })
    expect(key(container, 60).getAttribute('data-pressed')).toBe('true')
    expect(h.ctx()?.voiceSources() ?? []).toHaveLength(0)
  })

  it('a failed recorded set flashes the type LED and reports "Piano not found", while the keys stay playable', async () => {
    const { container, h } = mount(createHarness({ samples: 'missing' }))
    fireEvent.pointerDown(key(container, 60), { pointerId: 3 })
    expect(h.ctx()!.voiceSources().length).toBe(1) // fallback voice sounds immediately
    await settle()
    await settle()
    expect(program(container)).toMatch(/PIANO NOT FOUND/)
    expect(program(container)).toMatch(/AUDIO FALLBACK/)
    expect(within(container).getByTestId('audio-status').getAttribute('data-phase')).toBe('fallback')
    expect(control(container, 'piano-select').getAttribute('data-focused')).toBe('true')
    expect(control(container, 'piano-select').querySelector('.is-blinking') ?? container.querySelector('.led.is-blinking')).not.toBeNull()
    fireEvent.pointerUp(window, { pointerId: 3 })
  })

  it('effects panel controls carry their state: the reverb knob, type and on button follow the focused layer', () => {
    const { container } = mount()
    tap(control(container, 'fx-reverb-on'))
    expect(control(container, 'fx-reverb-on').getAttribute('aria-pressed')).toBe('true')
    tap(control(container, 'fx-reverb-type'))
    expect(control(container, 'fx-reverb-type').getAttribute('aria-label')).toBe('Reverb type: Cathedral')
    fireEvent.keyDown(control(container, 'fx-reverb-dry-wet'), { key: 'End' })
    expect(control(container, 'fx-reverb-dry-wet').getAttribute('aria-valuenow')).toBe('10')
    // switch to layer B: its own chain (reverb off) is shown
    tap(control(container, 'piano-layer-b-onoff'))
    expect(control(container, 'fx-reverb-on').getAttribute('aria-pressed')).toBe('false')
    expect(control(container, 'fx-reverb-type').getAttribute('aria-label')).toBe('Reverb type: Hall')
    expect(container.querySelector('[data-indicator="led-fx-focus-piano-b"]')!.className).toMatch(/is-lit/)
    expect(container.querySelector('[data-indicator="led-fx-focus-piano-a"]')!.className).not.toMatch(/is-lit/)
  })

  it('unsupported (spec-excluded) controls say so to assistive tech; functional ones do not', () => {
    // Phase 3: Organ, Synth and Program controls are functional now, so they no longer carry the "Decorative" description
    const { container } = mount()
    expect(control(container, 'organ-on').getAttribute('aria-description')).toBeNull()
    expect(control(container, 'synth-glide').getAttribute('aria-description')).toBeNull()
    expect(control(container, 'piano-ped-noise').getAttribute('aria-description')).toMatch(/Unsupported/)
    expect(control(container, 'piano-timbre').getAttribute('aria-description')).toBeNull()
    expect(control(container, 'master-level').getAttribute('aria-description')).toBeNull()
  })

  it('Master Level changes the audio graph: the master gain follows the knob', async () => {
    const { container, h } = mount()
    fireEvent.pointerDown(key(container, 60), { pointerId: 1 })
    await settle()
    const ctx = h.ctx()!
    const masters = () =>
      ctx.nodes
        .filter((n) => n.kind === 'gain' && [...n.outputs].some((o) => (o as { kind?: string }).kind === 'shaper'))
        .map((n) => (n as unknown as { gain: { events: Array<{ type: string; value: number }> } }).gain.events.filter((e) => e.type === 'ramp').map((e) => e.value))
    fireEvent.keyDown(control(container, 'master-level'), { key: 'Home' })
    expect(masters().flat().at(-1)).toBe(0)
    fireEvent.keyDown(control(container, 'master-level'), { key: 'End' })
    expect(masters().flat().at(-1)).toBeCloseTo(1.15)
    fireEvent.pointerUp(window, { pointerId: 1 })
  })

  it('unmount tears the whole Phase 2 graph down: one context closed, no live nodes, timers or store listeners', async () => {
    const { container, h, unmount } = mount()
    tap(control(container, 'fx-reverb-on'))
    tap(control(container, 'fx-mod1-on'))
    tap(control(container, 'piano-layer-b-onoff'), { shiftKey: true })
    fireEvent.pointerDown(key(container, 60), { pointerId: 1 })
    await settle()
    const ctx = h.ctx()!
    unmount()
    expect(ctx.closed).toBe(true)
    expect(ctx.liveNodes()).toHaveLength(0)
    expect(h.scheduler.pending).toBe(0)
    expect(h.keys.count() + h.win.count() + h.doc.count()).toBe(0)
  })
})
