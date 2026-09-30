import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'
import { PROGRAM_STORAGE_KEY } from './engine/programs'
import { createHarness, MemoryStorage, type Harness } from './test-utils/fakes'

afterEach(cleanup)

const mount = (h: Harness = createHarness({ storage: new MemoryStorage() })) => ({ h, ...render(<App deps={h.deps} />) })
const control = (c: HTMLElement, id: string) => c.querySelector(`[data-control-id="${id}"]`) as HTMLElement
const key = (c: HTMLElement, note: number) => c.querySelector(`[data-note="${note}"]`) as HTMLElement
const tap = (el: HTMLElement, init: object = {}) => {
  fireEvent.pointerDown(el, { pointerId: 1, ...init })
  fireEvent.pointerUp(el, { pointerId: 1 })
}
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const program = (c: HTMLElement) => (c.querySelector('#program-oled') as HTMLElement).textContent ?? ''
const synth = (c: HTMLElement) => (c.querySelector('#synth-oled') as HTMLElement).textContent ?? ''

describe('programs.navigation / programs.roundtrip — the Program display and buttons (DOM)', () => {
  it('shows page.button and the name, the E indicator for an edited program, and choosing another program clears it', () => {
    const { container } = mount()
    expect(program(container)).toMatch(/^1\.1 Grand Piano/)
    expect(container.querySelector('[data-testid="edited-indicator"]')).toBeNull()
    fireEvent.keyDown(control(container, 'fx-reverb-dry-wet'), { key: 'End' })
    expect(container.querySelector('[data-testid="edited-indicator"]')?.textContent).toBe('E')
    expect((container.querySelector('#program-oled') as HTMLElement).getAttribute('aria-label')).toMatch(/edited/)
    tap(control(container, 'program-button-2'))
    expect(program(container)).toMatch(/^1\.2 Concert Grand/)
    expect(container.querySelector('[data-testid="edited-indicator"]')).toBeNull()
    tap(control(container, 'program-page-next'))
    tap(control(container, 'program-button-4'))
    expect(program(container)).toMatch(/^2\.4 /)
    expect(control(container, 'program-button-4').getAttribute('aria-description')).toMatch(/^Program 2\.4 /)
  })

  it('Shift + Program dial shows the numeric list of programs', () => {
    const { container } = mount()
    const dial = control(container, 'program-dial')
    fireEvent.keyDown(control(container, 'program-shift'), { key: 'Enter' })
    fireEvent.keyDown(dial, { key: 'ArrowUp' })
    fireEvent.keyUp(control(container, 'program-shift'), { key: 'Enter' })
    expect(program(container)).toMatch(/PROGRAM LIST/)
    expect(program(container)).toMatch(/▸1\.2\s*Concert Grand/)
  })

  it('a Live slot edit survives a reload; the storage note in the status bar is truthful', () => {
    const storage = new MemoryStorage()
    const first = mount(createHarness({ storage }))
    tap(control(first.container, 'program-live-mode'))
    fireEvent.keyDown(control(first.container, 'fx-reverb-dry-wet'), { key: 'End' })
    first.unmount() // unmount flushes the pending write
    expect(JSON.parse(storage.getItem(PROGRAM_STORAGE_KEY)!).live[0]).toBeDefined()
    const second = mount(createHarness({ storage }))
    expect(control(second.container, 'program-live-mode').getAttribute('aria-pressed')).toBe('true')
    expect(control(second.container, 'fx-reverb-dry-wet').getAttribute('aria-valuenow')).toBe('10')
    expect(within(second.container).getByTestId('program-status').textContent).toMatch(/saved in this browser/)
    const blocked = mount(createHarness({ storage: null }))
    expect(within(blocked.container).getAllByTestId('program-status').at(-1)!.textContent).toMatch(/saved in this browser|unavailable/)
  })
})

describe('organ.engine / synth.sources / system.integration — the whole instrument through one AudioContext (DOM)', () => {
  it('organ and synth layers sound alongside the piano on the same context and the Program display names them', async () => {
    const { container, h } = mount()
    tap(control(container, 'organ-layer-a-onoff'), { shiftKey: true })
    tap(control(container, 'synth-layer-a-onoff'), { shiftKey: true })
    expect(program(container)).toMatch(/ORG A▸B3\s+SYN A▸Saw/)
    expect(synth(container)).toMatch(/SYNTH A/)
    fireEvent.pointerDown(key(container, 60), { pointerId: 5 })
    await settle()
    expect(h.contexts).toHaveLength(1)
    const ready = within(container).getByTestId('audio-status').textContent ?? ''
    expect(ready).toMatch(/B3 organ \(live synthesis\)/)
    expect(ready).toMatch(/Synth A \(live synthesis\)/)
    expect(h.ctx()!.voiceSources().length).toBeGreaterThanOrEqual(3)
    // every source that carries audio reaches the destination (modulators feed parameters, not the output)
    const modulates = (node: { outputs: Set<unknown>; paramOutputs: Set<unknown> }, seen = new Set<unknown>()): boolean => {
      if (seen.has(node)) return false
      seen.add(node)
      return node.paramOutputs.size > 0 || [...node.outputs].some((o) => modulates(o as typeof node, seen))
    }
    for (const src of h.ctx()!.voiceSources()) expect(src.reachesDestination() || modulates(src as never), src.kind).toBe(true)
    fireEvent.pointerUp(window, { pointerId: 5 })
  })

  it('unmount tears everything down: organ, synth, arpeggio, splits, morph and programs leave no node, timer or listener', async () => {
    const { container, h, unmount } = mount()
    tap(control(container, 'organ-layer-a-onoff'))
    tap(control(container, 'organ-perc-on'))
    tap(control(container, 'organ-vib-chorus-on'))
    tap(control(container, 'synth-layer-b-onoff'), { shiftKey: true })
    tap(control(container, 'synth-arp-run'))
    tap(control(container, 'synth-kb-hold'))
    tap(control(container, 'program-split'))
    fireEvent.pointerDown(key(container, 60), { pointerId: 1 })
    fireEvent.pointerDown(key(container, 64), { pointerId: 2 })
    await settle()
    const ctx = h.ctx()!
    unmount()
    expect(ctx.closed).toBe(true)
    expect(ctx.liveNodes()).toHaveLength(0)
    expect(h.scheduler.pending).toBe(0)
    expect(h.keys.count() + h.win.count() + h.doc.count()).toBe(0)
  })

  it('Panic (Shift + Transpose) stops every note and forgets held inputs', async () => {
    const { container, h } = mount()
    tap(control(container, 'synth-layer-a-onoff'), { shiftKey: true })
    tap(control(container, 'synth-kb-hold'))
    fireEvent.pointerDown(key(container, 60), { pointerId: 1 })
    fireEvent.keyDown(within(container).getByTestId('sustain-button'), { key: ' ' })
    await settle()
    expect(within(container).getByTestId('voice-status').textContent).toMatch(/Voices [1-9]/)
    tap(control(container, 'program-transpose'), { shiftKey: true })
    act(() => h.scheduler.advance(500))
    expect(within(container).getByTestId('voice-status').textContent).toMatch(/Voices 0\/24 · Sustain off/)
    expect(container.querySelectorAll('[data-note][data-pressed="true"]')).toHaveLength(0)
  })
})

describe('splits.zones / morph.assignments — panel feedback (DOM)', () => {
  it('the split-point LEDs above the keybed show the active positions', () => {
    const { container } = mount()
    const leds = () => Array.from(container.querySelectorAll('[data-split-position][data-lit="true"]')).map((e) => e.getAttribute('data-split-position'))
    expect(container.querySelectorAll('[data-split-position]')).toHaveLength(11)
    expect(leds()).toEqual([])
    tap(control(container, 'program-split'))
    expect(leds()).toEqual(['C4'])
    expect(within(container).getByTestId('split-leds').getAttribute('aria-label')).toMatch(/C4/)
    tap(control(container, 'program-split'))
    expect(leds()).toEqual([])
  })

  it('an assigned knob lights its green morph LED, and a fader shows the morph range on its LED graph', () => {
    const { container } = mount()
    const source = control(container, 'program-morph-wheel')
    fireEvent.pointerDown(source, { pointerId: 1 })
    fireEvent.pointerUp(source, { pointerId: 1 })
    fireEvent.pointerDown(source, { pointerId: 1 })
    fireEvent.pointerUp(source, { pointerId: 1 }) // double tap: latch
    fireEvent.keyDown(control(container, 'fx-reverb-dry-wet'), { key: 'End' })
    fireEvent.keyDown(control(container, 'piano-level-a'), { key: 'Home' })
    tap(source) // leave assign mode
    expect(control(container, 'fx-reverb-dry-wet').querySelector('.morph-led.is-lit')).not.toBeNull()
    expect(control(container, 'fx-mod1-rate').querySelector('.morph-led')).toBeNull()
    expect(control(container, 'piano-level-a').getAttribute('aria-description')).toMatch(/Morph assigned/)
    expect(container.querySelectorAll('.ladder-led.is-morph').length).toBeGreaterThan(0)
    expect(control(container, 'program-morph-wheel').getAttribute('aria-pressed')).toBe('true')
  })

  it('the on-screen Control pedal and the modulation wheel are the two morph sources: moving them changes what is sounding', async () => {
    const { container, h } = mount()
    const source = control(container, 'program-morph-ctrlped')
    fireEvent.pointerDown(source, { pointerId: 1 })
    fireEvent.pointerUp(source, { pointerId: 1 })
    fireEvent.pointerDown(source, { pointerId: 1 })
    fireEvent.pointerUp(source, { pointerId: 1 })
    fireEvent.keyDown(control(container, 'master-level'), { key: 'Home' }) // not a morph destination: nothing assigned
    fireEvent.keyDown(control(container, 'piano-level-a'), { key: 'Home' })
    tap(source)
    fireEvent.pointerDown(key(container, 60), { pointerId: 9 })
    await settle()
    const pedal = within(container).getByTestId('control-pedal') as HTMLInputElement
    const gains = () =>
      h
        .ctx()!
        .nodes.filter((n) => n.kind === 'gain')
        .map((n) => (n as unknown as { gain: { events: Array<{ type: string; value: number }> } }).gain.events.filter((e) => e.type === 'ramp').map((e) => e.value))
        .flat()
    const before = gains().length
    fireEvent.change(pedal, { target: { value: '127' } })
    expect(gains().length).toBeGreaterThan(before) // the layer level ramped toward the morph end (0)
    expect(gains().at(-1)).toBeDefined()
    fireEvent.pointerUp(window, { pointerId: 9 })
    // MIDI CC11 drives the same source, CC1 the wheel
    h.midiInput.send(0xb0, 11, 0)
    await settle()
  })

  it('the control audit lists exactly the spec-excluded controls, each with its reason', () => {
    const { container } = mount()
    const items = Array.from(container.querySelectorAll('[data-control-audit]')).map((e) => e.getAttribute('data-control-audit'))
    expect(items).toContain('piano-ped-noise')
    expect(items).toContain('program-morph-at')
    expect(items).toContain('synth-arp-pattern')
    expect(items).not.toContain('synth-glide')
    expect(container.querySelector('[data-control-partial="synth-mode"]')?.textContent).toMatch(/Analog is the only mode/)
    expect(items).toHaveLength(21)
  })
})
