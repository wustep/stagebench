// Rendered surface: the full Workbench in jsdom with the deterministic test runtime
// (simulated Web Audio, fake MIDI, counting event targets).
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Workbench } from '../App'
import { DESIGN_HEIGHT, DESIGN_WIDTH, SECTIONS } from '../model/geometry'
import { KEYS } from '../model/keys'
import { PANEL } from '../model/panel'
import type { ControlDef } from '../model/panelTypes'
import { makeTestRuntime, type TestRuntime } from '../testing/fakes'

afterEach(cleanup)

async function mount(runtime: TestRuntime = makeTestRuntime()) {
  const utils = render(<Workbench runtime={runtime} />)
  await waitFor(() => expect(screen.getByTestId('voice-status')).toHaveTextContent('Ready'))
  return { ...utils, runtime }
}

const el = (id: string) => {
  const found = document.getElementById(id)
  if (!found) throw new Error(`missing #${id}`)
  return found
}
const key = (midi: number) => document.querySelector<HTMLElement>(`[data-note="${midi}"]`)!
const keybed = () => document.querySelector<HTMLElement>('.keybed')!
const pressed = (midi: number) => key(midi).getAttribute('aria-pressed') === 'true'

function snapshotOf(runtime: TestRuntime) {
  return {
    contexts: runtime.contexts.length,
    sources: runtime.contexts.reduce((n, c) => n + c.liveSourceCount(), 0),
    voices: screen.getByTestId('voice-count').textContent,
    oleds: PANEL.oleds.map((o) => el(o.id).textContent),
    status: screen.getByTestId('voice-status').textContent,
  }
}

describe('visual.key-count — rendered keybed', () => {
  it('renders 73 keys (43 white, 30 black) with stable ids, E1 to E7', async () => {
    await mount()
    const keys = document.querySelectorAll('.keybed [data-note]')
    expect(keys).toHaveLength(73)
    expect(document.querySelectorAll('.keybed .key-white')).toHaveLength(43)
    expect(document.querySelectorAll('.keybed .key-black')).toHaveLength(30)
    expect(keybed().dataset.keyCount).toBe('73')
    for (const k of KEYS) expect(el(k.id).dataset.note).toBe(String(k.midi))
    expect(el('key-E1')).toHaveAccessibleName('E1 key')
    expect(el('key-E7')).toHaveAccessibleName('E7 key')
  })
})

describe('visual.section-layout — rendered deck', () => {
  it('renders six ordered section landmarks at the documented widths', async () => {
    await mount()
    const sections = [...document.querySelectorAll<HTMLElement>('.instrument > section.deck-section')]
    expect(sections.map((s) => s.dataset.section)).toEqual(['performance', 'organ', 'piano', 'program', 'synth', 'effects'])
    sections.forEach((s, i) => {
      expect(s.style.left).toBe(`${SECTIONS[i].left}px`)
      expect(s.style.width).toBe(`${SECTIONS[i].width}px`)
      expect(Number(s.dataset.fraction)).toBe(SECTIONS[i].fraction)
      expect(s).toHaveAccessibleName(`${SECTIONS[i].label} section`)
    })
    const inst = document.querySelector<HTMLElement>('.instrument')!
    expect(inst.style.width).toBe(`${DESIGN_WIDTH}px`)
    expect(inst.style.height).toBe(`${DESIGN_HEIGHT}px`)
    expect(keybed().style.top).toBe(`${Math.round(DESIGN_HEIGHT * 0.54)}px`)
  })
})

describe('visual.control-inventory — rendered controls', () => {
  it('renders every model control once, inside its own section, and exactly two OLEDs', async () => {
    await mount()
    for (const c of PANEL.controls) {
      const node = el(c.id)
      expect(document.querySelectorAll(`[id="${c.id}"]`)).toHaveLength(1)
      expect(node.closest('section')?.dataset.section).toBe(c.section)
    }
    const oleds = [...document.querySelectorAll<HTMLElement>('.oled')]
    expect(oleds.map((o) => o.closest('section')?.dataset.section).sort()).toEqual(['program', 'synth'])
    // No display-like element in the performance, organ, piano or effects bands.
    for (const id of ['performance', 'organ', 'piano', 'effects'])
      expect(el(`section-${id}`).querySelectorAll('[class*="oled"], [class*="display"], [class*="screen"], [id*="oled"], [id*="display"], [id*="screen"]')).toHaveLength(0)
    // Organ drawbar LED graphs and level ladders are rendered.
    expect(el('section-organ').querySelectorAll('.graph-drawbar')).toHaveLength(9)
    expect(document.querySelectorAll('.graph-ladder').length).toBeGreaterThanOrEqual(7)
  })
})

describe('interaction.keys — pointer, touch, keyboard, cancel, blur', () => {
  it('pointer down depresses a key and pointer up releases it', async () => {
    await mount()
    fireEvent.pointerDown(key(60), { pointerId: 1, pointerType: 'mouse', button: 0 })
    expect(pressed(60)).toBe(true)
    expect(screen.getByTestId('voice-count')).toHaveTextContent('1 / 24 voices')
    fireEvent.pointerUp(keybed(), { pointerId: 1, pointerType: 'mouse' })
    expect(pressed(60)).toBe(false)
  })

  it('ignores secondary mouse buttons', async () => {
    await mount()
    fireEvent.pointerDown(key(60), { pointerId: 1, pointerType: 'mouse', button: 2 })
    expect(pressed(60)).toBe(false)
  })

  it('pointer cancel and lost capture release the note', async () => {
    await mount()
    fireEvent.pointerDown(key(62), { pointerId: 3, pointerType: 'touch' })
    expect(pressed(62)).toBe(true)
    fireEvent.pointerCancel(keybed(), { pointerId: 3, pointerType: 'touch' })
    expect(pressed(62)).toBe(false)
    fireEvent.pointerDown(key(64), { pointerId: 4, pointerType: 'touch' })
    // Losing capture for a different pointer must not release this finger's note…
    fireEvent.lostPointerCapture(keybed(), { pointerId: 99, pointerType: 'touch' })
    expect(pressed(64)).toBe(true)
    // …losing capture for this pointer (e.g. the browser took the gesture) releases it.
    fireEvent.lostPointerCapture(keybed(), { pointerId: 4, pointerType: 'touch' })
    expect(pressed(64)).toBe(false)
  })

  it('independent multi-touch: each finger holds and releases its own key', async () => {
    await mount()
    fireEvent.pointerDown(key(60), { pointerId: 11, pointerType: 'touch' })
    fireEvent.pointerDown(key(64), { pointerId: 12, pointerType: 'touch' })
    fireEvent.pointerDown(key(67), { pointerId: 13, pointerType: 'touch' })
    expect([pressed(60), pressed(64), pressed(67)]).toEqual([true, true, true])
    fireEvent.pointerUp(keybed(), { pointerId: 12, pointerType: 'touch' })
    expect([pressed(60), pressed(64), pressed(67)]).toEqual([true, false, true])
    fireEvent.pointerUp(keybed(), { pointerId: 11, pointerType: 'touch' })
    fireEvent.pointerUp(keybed(), { pointerId: 13, pointerType: 'touch' })
    expect([pressed(60), pressed(64), pressed(67)]).toEqual([false, false, false])
  })

  it('two fingers on the same key keep it down until both lift', async () => {
    await mount()
    fireEvent.pointerDown(key(60), { pointerId: 21, pointerType: 'touch' })
    fireEvent.pointerDown(key(60), { pointerId: 22, pointerType: 'touch' })
    fireEvent.pointerUp(keybed(), { pointerId: 21, pointerType: 'touch' })
    expect(pressed(60)).toBe(true)
    fireEvent.pointerUp(keybed(), { pointerId: 22, pointerType: 'touch' })
    expect(pressed(60)).toBe(false)
  })

  it('focused key plays with Space/Enter, ignores auto-repeat, and releases on key up or blur', async () => {
    await mount()
    const c4 = key(60)
    expect(c4.tabIndex).toBe(0)
    act(() => c4.focus())
    fireEvent.keyDown(c4, { key: ' ', code: 'Space' })
    expect(pressed(60)).toBe(true)
    fireEvent.keyDown(c4, { key: ' ', code: 'Space', repeat: true })
    expect(screen.getByTestId('voice-count')).toHaveTextContent('1 / 24 voices')
    fireEvent.keyUp(c4, { key: ' ', code: 'Space' })
    expect(pressed(60)).toBe(false)
    fireEvent.keyDown(c4, { key: 'Enter', code: 'Enter' })
    expect(pressed(60)).toBe(true)
    fireEvent.blur(c4)
    expect(pressed(60)).toBe(false)
  })

  it('arrow keys move a single roving tab stop along the keybed', async () => {
    await mount()
    const tabbable = () => [...document.querySelectorAll<HTMLElement>('.keybed [data-note]')].filter((k) => k.tabIndex === 0)
    expect(tabbable().map((k) => k.dataset.note)).toEqual(['60'])
    act(() => key(60).focus())
    fireEvent.keyDown(key(60), { key: 'ArrowRight' })
    expect(tabbable().map((k) => k.dataset.note)).toEqual(['61'])
    expect(document.activeElement).toBe(key(61))
    fireEvent.keyDown(key(61), { key: 'Home' })
    expect(document.activeElement).toBe(key(28))
    fireEvent.keyDown(key(28), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(key(28))
    fireEvent.keyDown(key(28), { key: 'End' })
    expect(document.activeElement).toBe(key(100))
  })

  it('mapped computer keys depress keybed keys; window blur releases them', async () => {
    const { runtime } = await mount()
    act(() => {
      runtime.window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }))
      runtime.window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }))
    })
    expect([pressed(60), pressed(64)]).toEqual([true, true])
    act(() => {
      runtime.window.dispatchEvent(new Event('blur'))
    })
    expect([pressed(60), pressed(64)]).toEqual([false, false])
    expect(screen.getByTestId('voice-count')).not.toHaveTextContent('held:')
  })
})

/** Operate a control by keyboard the way a user would, returning true if its presentation changed. */
function operateByKeyboard(c: ControlDef): void {
  const node = el(c.id)
  if (c.kind === 'button') {
    fireEvent.keyDown(node, { key: 'Enter' })
    fireEvent.click(node)
    fireEvent.keyUp(node, { key: 'Enter' })
  } else {
    fireEvent.keyDown(node, { key: 'End' })
    fireEvent.keyDown(node, { key: 'ArrowUp' })
    fireEvent.keyUp(node, { key: 'ArrowUp' })
  }
}

describe('interaction.decorative-controls — presentation state only', () => {
  it('buttons press and light their LEDs; multi-state buttons cycle', async () => {
    await mount()
    const btn = el('effects-reverb-on')
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    fireEvent.pointerDown(btn)
    expect(btn).toHaveClass('is-pressed')
    fireEvent.pointerUp(btn)
    fireEvent.click(btn)
    expect(btn).not.toHaveClass('is-pressed')
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    expect(btn).toHaveClass('is-lit')
    const def = PANEL.controls.find((c) => c.id === 'effects-reverb-on')!
    const led = def.kind === 'button' ? def.states[1][0] : ''
    expect(el(led)).toHaveAttribute('data-lit', 'true')
    fireEvent.click(btn)
    expect(el(led)).toHaveAttribute('data-lit', 'false')

    const multi = PANEL.controls.find((c) => c.kind === 'button' && c.states.length > 2)
    expect(multi).toBeDefined()
    if (multi && multi.kind === 'button') {
      const node = el(multi.id)
      const seen = new Set<string | null>()
      for (let i = 0; i < multi.states.length; i++) {
        seen.add(node.getAttribute('data-state'))
        fireEvent.click(node)
      }
      expect(seen.size).toBe(multi.states.length)
      expect(node.getAttribute('data-state')).toBe(multi.stateNames[0])
    }
  })

  it('knobs turn, faders and drawbars slide, graphs follow, wheel moves, pitch stick springs back', async () => {
    await mount()
    const knob = el('effects-reverb-dry-wet')
    const before = knob.querySelector<HTMLElement>('.knob-cap')!.style.transform
    fireEvent.keyDown(knob, { key: 'ArrowUp' })
    expect(knob.querySelector<HTMLElement>('.knob-cap')!.style.transform).not.toBe(before)

    const fader = el('piano-level-a')
    fireEvent.keyDown(fader, { key: 'Home' })
    expect(fader).toHaveAttribute('aria-valuenow', '0')
    expect(el('piano-level-a-ladder')).toHaveAttribute('data-lit', '0')
    fireEvent.keyDown(fader, { key: 'End' })
    expect(Number(el('piano-level-a-ladder').getAttribute('data-lit'))).toBeGreaterThan(0)

    const drawbar = el('organ-drawbar-3')
    fireEvent.keyDown(drawbar, { key: 'End' })
    expect(drawbar).toHaveAttribute('aria-valuenow', '8')
    expect(el('organ-drawbar-3-graph')).toHaveAttribute('data-lit', '8')
    expect(drawbar.querySelector<HTMLElement>('.drawbar-cap')!.style.top).not.toBe('0px')
    fireEvent.keyDown(drawbar, { key: 'Home' })
    expect(el('organ-drawbar-3-graph')).toHaveAttribute('data-lit', '0')

    const wheel = el('performance-mod-wheel')
    fireEvent.keyDown(wheel, { key: 'End' })
    expect(wheel).toHaveAttribute('aria-valuenow', '127')

    const stick = el('performance-pitch-stick')
    fireEvent.keyDown(stick, { key: 'ArrowRight' })
    expect(Number(stick.getAttribute('aria-valuenow'))).toBeGreaterThan(0)
    fireEvent.keyUp(stick, { key: 'ArrowRight' })
    expect(stick).toHaveAttribute('aria-valuenow', '0')

    const enc = el('program-dial')
    fireEvent.keyDown(enc, { key: 'ArrowUp' })
    fireEvent.keyDown(enc, { key: 'ArrowUp' })
    expect(enc).toHaveAttribute('aria-valuenow', '2')
  })

  it('pointer drags move continuous controls', async () => {
    await mount()
    const fader = el('synth-level-a')
    const start = Number(fader.getAttribute('aria-valuenow'))
    fireEvent.pointerDown(fader, { pointerId: 5, button: 0, clientX: 0, clientY: 100 })
    expect(fader).toHaveClass('is-pressed')
    fireEvent.pointerMove(fader, { pointerId: 5, clientX: 0, clientY: 80 })
    fireEvent.pointerUp(fader, { pointerId: 5 })
    expect(Number(fader.getAttribute('aria-valuenow'))).toBeGreaterThan(start)
    expect(fader).not.toHaveClass('is-pressed')

    const knob = el('synth-filter-freq')
    const k0 = Number(knob.getAttribute('aria-valuenow'))
    fireEvent.pointerDown(knob, { pointerId: 6, button: 0, clientX: 0, clientY: 100 })
    fireEvent.pointerMove(knob, { pointerId: 6, clientX: 0, clientY: 130 })
    fireEvent.pointerUp(knob, { pointerId: 6 })
    expect(Number(knob.getAttribute('aria-valuenow'))).toBeLessThan(k0)
  })

  it('operating every visible control makes no sound and changes no voice, display or status', async () => {
    const { runtime } = await mount()
    const before = snapshotOf(runtime)
    for (const c of PANEL.controls) operateByKeyboard(c)
    // Presentation changed (so the controls really moved)…
    expect(el('organ-drawbar-1')).toHaveAttribute('aria-valuenow', '8')
    expect(el('program-slot-1')).toHaveClass('is-lit')
    // …but nothing else did.
    expect(snapshotOf(runtime)).toEqual(before)
    for (const ctx of runtime.contexts) {
      expect(ctx.liveSourceCount()).toBe(0)
      const out = ctx.render(0.1)
      expect(out.every((x) => x === 0)).toBe(true)
    }
  })

  it('panel controls never trigger notes from the computer-keyboard map', async () => {
    const { runtime } = await mount()
    const knob = el('synth-filter-freq')
    act(() => knob.focus())
    // Space on a focused control belongs to the control, not the sustain pedal.
    act(() => {
      runtime.window.dispatchEvent(Object.defineProperty(new KeyboardEvent('keydown', { code: 'Space' }), 'target', { value: knob }))
    })
    expect(screen.getByTestId('voice-count')).not.toHaveTextContent('sustain down')
  })
})

const ROLE: Record<ControlDef['kind'], string> = {
  button: 'button',
  knob: 'slider',
  fader: 'slider',
  drawbar: 'slider',
  'pitch-stick': 'slider',
  'mod-wheel': 'slider',
  encoder: 'spinbutton',
}

describe('accessibility.controls — names, roles, values, keyboard, focus', () => {
  it('every control exposes a unique accessible name, the right role, and a decorative description', async () => {
    await mount()
    const names = new Set<string>()
    for (const c of PANEL.controls) {
      const node = el(c.id)
      expect(node).toHaveAccessibleName(c.label)
      names.add(c.label)
      const role = node.getAttribute('role') ?? (node.tagName === 'BUTTON' ? 'button' : null)
      expect(role).toBe(ROLE[c.kind])
      expect(node.getAttribute('aria-description')).toMatch(/Decorative in Phase 1/)
    }
    expect(names.size).toBe(PANEL.controls.length)
  })

  it('every control is keyboard focusable', async () => {
    await mount()
    for (const c of PANEL.controls) {
      const node = el(c.id)
      expect(node.tagName === 'BUTTON' || node.tabIndex === 0).toBe(true)
      act(() => node.focus())
      expect(document.activeElement).toBe(node)
    }
  })

  it('sliders and spinbuttons report values that follow keyboard operation', async () => {
    await mount()
    for (const c of PANEL.controls.filter((x) => x.kind !== 'button')) {
      const node = el(c.id)
      expect(node).toHaveAttribute('aria-valuenow')
      expect(node.getAttribute('aria-valuetext')).toMatch(/position only|knob position only/)
      if (c.kind === 'encoder') {
        fireEvent.keyDown(node, { key: 'ArrowDown' })
        expect(node).toHaveAttribute('aria-valuenow', '-1')
        continue
      }
      const min = node.getAttribute('aria-valuemin')
      const max = node.getAttribute('aria-valuemax')
      expect(min).not.toBeNull()
      expect(max).not.toBeNull()
      fireEvent.keyDown(node, { key: 'Home' })
      expect(node).toHaveAttribute('aria-valuenow', min!)
      fireEvent.keyDown(node, { key: 'End' })
      if (c.kind !== 'pitch-stick') expect(node).toHaveAttribute('aria-valuenow', max!)
      fireEvent.keyUp(node, { key: 'End' })
    }
  })

  it('toggle buttons expose aria-pressed that follows activation', async () => {
    await mount()
    const toggles = PANEL.controls.filter((c) => c.kind === 'button' && c.states.length === 2)
    expect(toggles.length).toBeGreaterThan(20)
    for (const t of toggles) {
      const node = el(t.id)
      expect(node).toHaveAttribute('aria-pressed', 'false')
      fireEvent.click(node)
      expect(node).toHaveAttribute('aria-pressed', 'true')
    }
  })

  it('keys and status regions are labelled; OLEDs are named status regions', async () => {
    await mount()
    expect(screen.getByRole('group', { name: /Keybed: 73 hammer-action keys/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /Nord Stage 4 73/ })).toBeInTheDocument()
    for (const k of KEYS) expect(el(k.id)).toHaveAttribute('role', 'button')
    expect(screen.getByRole('status', { name: 'Program OLED display' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Synth OLED display' })).toBeInTheDocument()
  })

  it('styles give controls and keys a visible focus ring', () => {
    const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8')
    for (const sel of ['.hw:focus-visible', '.key:focus-visible', '.chip:focus-visible']) {
      const block = css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)))
      expect(css.includes(sel)).toBe(true)
      expect(block).toMatch(/outline:\s*[\d.]+px solid var\(--focus\)/)
    }
  })
})

describe('regression.chassis — no hero, no detached rails, no missing keys, no clipping', () => {
  it('the instrument is the first thing on the page: no marketing hero or reference-image background', async () => {
    const { container } = await mount()
    expect(container.querySelectorAll('img, picture, video')).toHaveLength(0)
    expect(container.querySelector('[class*="hero"]')).toBeNull()
    const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8')
    expect(css).not.toMatch(/\.jpg|\.png|url\(/)
    const header = container.querySelector('.topbar')!
    expect(header.querySelector('h1')).toBeInTheDocument()
    // The only page chrome is a compact one-line title bar (no hero banner above the instrument).
    expect(css).toMatch(/\.topbar h1\s*\{[^}]*font-size:\s*15px/)
    expect(header.nextElementSibling?.querySelector('.instrument')).not.toBeNull()
  })

  it('chassis, cheeks, top rail and bottom rail are all attached to the instrument', async () => {
    await mount()
    const inst = document.querySelector('.instrument')!
    for (const sel of ['.chassis', '.chassis-deck', '.chassis-lip', '.cheek-left.cheek-deck', '.cheek-right.cheek-deck', '.cheek-left.cheek-keys', '.cheek-right.cheek-keys', '.keybed .bottom-rail', '.keybed .key-slot'])
      expect(inst.querySelector(sel)).not.toBeNull()
    // Keybed spans the full instrument width directly under the deck.
    expect(keybed().style.width).toBe(`${DESIGN_WIDTH}px`)
    // Every key is inside the instrument box.
    for (const k of KEYS) {
      expect(k.x).toBeGreaterThanOrEqual(0)
      expect(k.x + k.w).toBeLessThanOrEqual(DESIGN_WIDTH)
      expect(k.y + k.h).toBeLessThanOrEqual(DESIGN_HEIGHT)
    }
  })

  it('stage sizing fills 88–97 % of a 1440×900 viewport without vertical scroll and fits 390×844', () => {
    const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8')
    // Desktop rule: width = min(93%, (100vh - 210px) * aspect) * zoom.
    expect(css).toMatch(/width:\s*calc\(min\(93%,\s*\(100vh - 210px\) \* 3\.0948\) \* var\(--zoom, 1\)\)/)
    const aspect = DESIGN_WIDTH / DESIGN_HEIGHT
    const desktop = Math.min(0.93 * 1440, (900 - 210) * 3.0948)
    expect(desktop / 1440).toBeGreaterThanOrEqual(0.88)
    expect(desktop / 1440).toBeLessThanOrEqual(0.97)
    // The instrument plus the page chrome above it (≤ 60px) fit in 900px.
    expect(desktop / aspect + 60).toBeLessThan(900)
    // Narrow rule: full width minus a gutter, scaled as one unit (nothing reflows or clips).
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*\.stage\s*\{\s*width:\s*calc\(\(100% - 16px\) \* var\(--zoom, 1\)\)/)
    const narrow = 390 - 16
    expect(narrow / aspect).toBeGreaterThan(100)
    expect(narrow).toBeLessThanOrEqual(390)
    // Horizontal overflow only scrolls inside the stage when the user zooms in.
    expect(css).toMatch(/\.stage-scroll\s*\{[^}]*overflow-x:\s*auto/)
    expect(css).toMatch(/\.stage-inner\s*\{[^}]*transform-origin:\s*0 0/)
  })

  it('zoom chips scale the instrument as one unit', async () => {
    await mount()
    const stage = document.querySelector<HTMLElement>('.stage')!
    expect(stage.style.getPropertyValue('--zoom')).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: '2×' }))
    expect(stage.style.getPropertyValue('--zoom')).toBe('2')
    expect(screen.getByRole('button', { name: '2×' })).toHaveAttribute('aria-pressed', 'true')
  })
})
