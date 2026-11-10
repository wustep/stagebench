import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DRAWBAR } from '../src/hardware/builder'
import { FUNCTIONAL_CONTROL_IDS, UNSUPPORTED_CONTROLS } from '../src/hardware/functional'
import { INVENTORY } from '../src/hardware/inventory'
import { HardwareStore, normalize } from '../src/hardware/store'
import type { ButtonDef, RangeDef } from '../src/hardware/types'
import { mountApp, type MountedApp } from './support/app'
import { equal } from './support/signal'

/**
 * Feature: interaction.decorative-controls
 * Every visible control moves or presses accessibly and changes presentation state only.
 *
 * Phase 2 note. This is the Phase 1 suite, narrowed as its hand-off notes asked: the Piano,
 * Layer Effects, Rotary, and Master Level controls listed in src/hardware/functional.ts are
 * functional now and have their own suites (piano.*, effects.*). Tests about *moving and
 * pressing* still run over every control on the panel; tests about *doing nothing else* run
 * over every control that is still decorative.
 *
 * Phase 3 note. Narrowed again, the same way: Organ, Synth, and Program are functional and have
 * their own suites (organ.*, synth.*, programs.*, hardware.bindings). What is still decorative
 * is exactly the eleven controls the specs exclude (UNSUPPORTED_CONTROLS). No test was removed;
 * the ones that named an Organ or Synth control as their decorative example now name an
 * excluded control, and the OLED test checks that the displays tell the truth about the
 * program and the synth instead of checking that they claim nothing.
 */

const FUNCTIONAL = new Set(FUNCTIONAL_CONTROL_IDS)
const allButtons = INVENTORY.controls.filter((control): control is ButtonDef => control.kind === 'button')
const allRanges = INVENTORY.controls.filter((control): control is RangeDef => control.kind !== 'button')
/** Still decorative in Phase 3: the spec-excluded controls. */
const buttons = allButtons.filter((control) => !FUNCTIONAL.has(control.id))
const ranges = allRanges.filter((control) => !FUNCTIONAL.has(control.id))

/** The part of each ranged control that visibly moves. */
const MOVING_PART = '.knob__cap, .fader__cap, .drawbar__cap, .wheel__notch, .stick__wood'

function pressWithPointer(element: HTMLElement) {
  fireEvent.pointerDown(element, { pointerId: 1, pointerType: 'mouse', button: 0 })
  fireEvent.pointerUp(element, { pointerId: 1 })
}

/** Operates every decorative panel control once by pointer and once by keyboard. */
function operateEverything(app: MountedApp) {
  for (const def of buttons) {
    const element = app.control(def.id)
    pressWithPointer(element)
    fireEvent.keyDown(element, { key: 'Enter' })
    fireEvent.keyUp(element, { key: 'Enter' })
  }
  for (const def of ranges) {
    const element = app.control(def.id)
    fireEvent.pointerDown(element, { pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(element, { pointerId: 1, clientX: 130, clientY: 60 })
    fireEvent.pointerUp(element, { pointerId: 1 })
    fireEvent.keyDown(element, { key: 'PageUp' })
    fireEvent.keyDown(element, { key: 'ArrowDown' })
  }
}

describe('interaction.decorative-controls: buttons press', () => {
  it('every button goes down under a pointer, comes back up, and counts the press', () => {
    const app = mountApp()
    expect(buttons.map((button) => button.id).sort()).toEqual(Object.keys(UNSUPPORTED_CONTROLS).sort())
    expect(ranges).toHaveLength(0)
    expect(allButtons).toHaveLength(97)
    for (const def of allButtons) {
      const element = app.control(def.id)
      expect(element).toHaveAttribute('data-pressed', 'false')
      fireEvent.pointerDown(element, { pointerId: 1, pointerType: 'mouse', button: 0 })
      expect(element, def.id).toHaveAttribute('data-pressed', 'true')
      expect(element.className).toContain('is-down')
      fireEvent.pointerUp(element, { pointerId: 1 })
      expect(element).toHaveAttribute('data-pressed', 'false')
      expect(element).toHaveAttribute('data-presses', '1')
    }
  })

  it('every button with an indicator steps it, and its LEDs follow', () => {
    const app = mountApp()
    for (const def of buttons.filter((button) => button.steps > 0)) {
      const element = app.control(def.id)
      const leds = INVENTORY.leds.filter((led) => led.binding.type === 'step' && led.binding.control === def.id)
      expect(leds.length, def.id).toBeGreaterThan(0)
      const litNow = () => leds.filter((led) => app.control(led.id).dataset.lit === 'true').map((led) => led.id)
      const expectedLit = (step: number) =>
        leds.filter((led) => led.binding.type === 'step' && led.binding.on.includes(step)).map((led) => led.id)

      expect(element).toHaveAttribute('data-step', String(def.initial))
      expect(litNow()).toEqual(expectedLit(def.initial))
      // Walk the indicator all the way round.
      for (let press = 1; press <= def.steps; press += 1) {
        pressWithPointer(element)
        const step = (def.initial + press) % def.steps
        expect(element, def.id).toHaveAttribute('data-step', String(step))
        expect(element).toHaveAttribute('data-step-label', def.stepLabels![step])
        expect(litNow(), `${def.id} step ${step}`).toEqual(expectedLit(step))
      }
      expect(element).toHaveAttribute('data-step', String(def.initial))
    }
  })

  it('off/on buttons expose their state as aria-pressed', () => {
    const app = mountApp()
    // A decorative toggle (Solo is optional and not implemented) and a functional one (Organ On).
    for (const [id, ledId] of [['solo', 'led-solo'], ['organ-on', 'led-organ-on']]) {
      const toggle = app.control(id)
      expect(toggle).toHaveAttribute('aria-pressed', 'false')
      expect(app.control(ledId)).toHaveAttribute('data-lit', 'false')
      pressWithPointer(toggle)
      expect(toggle).toHaveAttribute('aria-pressed', 'true')
      expect(app.control(ledId).className).toContain('is-lit')
      pressWithPointer(toggle)
      expect(toggle).toHaveAttribute('aria-pressed', 'false')
      expect(app.control(ledId)).toHaveAttribute('data-lit', 'false')
    }
    // Selectors and momentary buttons are not toggles.
    expect(app.control('piano-type')).not.toHaveAttribute('aria-pressed')
    expect(app.control('organ-octave-up')).not.toHaveAttribute('aria-pressed')
  })

  it('momentary buttons have no indicator: they press, count, and nothing else', () => {
    const app = mountApp()
    const momentary = allButtons.filter((button) => button.steps === 0)
    expect(momentary.map((button) => button.id)).toContain('shift')
    for (const def of momentary) {
      const element = app.control(def.id)
      expect(element).not.toHaveAttribute('data-step')
      pressWithPointer(element)
      pressWithPointer(element)
      expect(element).toHaveAttribute('data-presses', '2')
    }
  })

  it('sliding off a button, cancelling, or losing focus lets it up without counting', () => {
    const app = mountApp()
    const element = app.control('piano-type')
    element.getBoundingClientRect = () =>
      ({ left: 10, right: 30, top: 10, bottom: 20, width: 20, height: 10, x: 10, y: 10, toJSON: () => ({}) }) as DOMRect
    fireEvent.pointerDown(element, { pointerId: 1, clientX: 15, clientY: 15 })
    fireEvent.pointerUp(element, { pointerId: 1, clientX: 200, clientY: 200 })
    // Browsers with pointer capture still deliver a click to the captured button; it must not count.
    fireEvent.click(element)
    expect(element).toHaveAttribute('data-pressed', 'false')
    expect(element).toHaveAttribute('data-presses', '0')
    expect(element).toHaveAttribute('data-step', '0')

    fireEvent.pointerDown(element, { pointerId: 1, clientX: 15, clientY: 15 })
    fireEvent.pointerCancel(element, { pointerId: 1 })
    expect(element).toHaveAttribute('data-presses', '0')

    fireEvent.keyDown(element, { key: ' ' })
    expect(element).toHaveAttribute('data-pressed', 'true')
    fireEvent.blur(element)
    expect(element).toHaveAttribute('data-pressed', 'false')
    expect(element).toHaveAttribute('data-presses', '0')

    fireEvent.pointerDown(element, { pointerId: 1, clientX: 15, clientY: 15 })
    fireEvent.pointerUp(element, { pointerId: 1, clientX: 15, clientY: 15 })
    expect(element).toHaveAttribute('data-presses', '1')
    expect(element).toHaveAttribute('data-step', '1')
  })

  it('a pointer press followed by the browser click it generates counts once; a bare click counts too', () => {
    const app = mountApp()
    const element = app.control('store')
    fireEvent.pointerDown(element, { pointerId: 1 })
    fireEvent.pointerUp(element, { pointerId: 1 })
    fireEvent.click(element)
    expect(element).toHaveAttribute('data-presses', '1')

    const other = app.control('live-mode')
    fireEvent.click(other)
    expect(other).toHaveAttribute('data-presses', '1')
    expect(other).toHaveAttribute('aria-pressed', 'true')
  })

  it('ignores secondary mouse buttons', () => {
    const app = mountApp()
    const element = app.control('store')
    fireEvent.pointerDown(element, { pointerId: 1, pointerType: 'mouse', button: 2 })
    expect(element).toHaveAttribute('data-pressed', 'false')
  })
})

describe('interaction.decorative-controls: knobs, dials, faders, drawbars, wheel, stick move', () => {
  it('every ranged control follows a pointer drag and shows it', () => {
    const app = mountApp()
    expect(allRanges).toHaveLength(49)
    for (const def of allRanges) {
      const element = app.control(def.id)
      const before = Number(element.getAttribute('aria-valuenow'))
      const moving = element.querySelector<HTMLElement>(MOVING_PART)
      expect(moving, def.id).not.toBeNull()
      const visual = () => moving?.getAttribute('style')
      const lookBefore = visual()
      // Drag in whichever direction has room to move.
      const up = def.kind === 'drawbar' ? before >= def.max : before < def.max
      fireEvent.pointerDown(element, { pointerId: 7, clientX: 100, clientY: 100 })
      fireEvent.pointerMove(element, {
        pointerId: 7,
        clientX: def.kind === 'stick' ? 140 : 100,
        clientY: def.kind === 'stick' ? 100 : up ? 60 : 140,
      })
      const during = Number(element.getAttribute('aria-valuenow'))
      expect(during, def.id).not.toBe(before)
      expect(visual(), def.id).not.toBe(lookBefore)
      expect(during).toBeGreaterThanOrEqual(def.min)
      expect(during).toBeLessThanOrEqual(def.max)
      fireEvent.pointerUp(element, { pointerId: 7 })
      // A move from a pointer that is not dragging does nothing.
      const settled = element.getAttribute('aria-valuenow')
      fireEvent.pointerMove(element, { pointerId: 7, clientX: 0, clientY: 0 })
      expect(element.getAttribute('aria-valuenow')).toBe(settled)
    }
  })

  it('knobs turn their pointer through 270° and faders slide their cap', () => {
    const app = mountApp()
    const knob = app.control('rotary-drive')
    const cap = knob.querySelector<HTMLElement>('.knob__cap')!
    fireEvent.keyDown(knob, { key: 'Home' })
    expect(cap.style.transform).toBe('rotate(-135deg)')
    fireEvent.keyDown(knob, { key: 'End' })
    expect(cap.style.transform).toBe('rotate(135deg)')

    const fader = app.control('piano-layer-a-level')
    const faderCap = fader.querySelector<HTMLElement>('.fader__cap')!
    fireEvent.keyDown(fader, { key: 'End' })
    expect(faderCap.style.top).toBe('0px')
    fireEvent.keyDown(fader, { key: 'Home' })
    expect(parseFloat(faderCap.style.top)).toBeGreaterThan(300)
  })

  it('fader LED ladders and drawbar LED graphs follow the control they belong to', () => {
    const app = mountApp()
    const ladder = app.container.querySelector<HTMLElement>('[data-ladder-for="organ-layer-b-level"]')!
    expect(ladder).toHaveAttribute('data-lit', '6')
    expect(ladder.querySelectorAll('.is-lit')).toHaveLength(6)
    fireEvent.keyDown(app.control('organ-layer-b-level'), { key: 'End' })
    expect(ladder.querySelectorAll('.is-lit')).toHaveLength(12)
    fireEvent.keyDown(app.control('organ-layer-b-level'), { key: 'Home' })
    expect(ladder.querySelectorAll('.is-lit')).toHaveLength(0)

    const bar = app.control('organ-drawbar-4')
    const graph = app.container.querySelector<HTMLElement>('[data-graph-for="organ-drawbar-4"]')!
    const cap = bar.querySelector<HTMLElement>('.drawbar__cap')!
    expect(graph.querySelectorAll('.is-lit')).toHaveLength(4)
    expect(cap.style.top).toBe(`${4 * DRAWBAR.perStep}px`)
    // Pulling a drawbar out (down) raises its value.
    fireEvent.keyDown(bar, { key: 'ArrowDown' })
    expect(bar).toHaveAttribute('aria-valuenow', '5')
    expect(graph.querySelectorAll('.is-lit')).toHaveLength(5)
    expect(cap.style.top).toBe(`${5 * DRAWBAR.perStep}px`)
    fireEvent.keyDown(bar, { key: 'Home' })
    expect(graph.querySelectorAll('.is-lit')).toHaveLength(0)
    fireEvent.keyDown(bar, { key: 'End' })
    expect(graph.querySelectorAll('.is-lit')).toHaveLength(8)
  })

  it('endless dials wrap instead of stopping', () => {
    const app = mountApp()
    const dial = app.control('program-dial')
    fireEvent.keyDown(dial, { key: 'ArrowDown' })
    expect(dial).toHaveAttribute('aria-valuenow', '23')
    fireEvent.keyDown(dial, { key: 'ArrowUp' })
    fireEvent.keyDown(dial, { key: 'ArrowUp' })
    expect(dial).toHaveAttribute('aria-valuenow', '1')
    expect(dial).toHaveAttribute('aria-valuetext', 'detent 2 of 24')
  })

  it('the pitch stick springs back to centre; the mod wheel stays where it is left', () => {
    const app = mountApp()
    const stick = app.control('perf-pitch-stick')
    fireEvent.pointerDown(stick, { pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(stick, { pointerId: 1, clientX: 160, clientY: 100 })
    expect(Number(stick.getAttribute('aria-valuenow'))).toBeGreaterThan(0)
    fireEvent.pointerUp(stick, { pointerId: 1 })
    expect(stick).toHaveAttribute('aria-valuenow', '0')
    fireEvent.keyDown(stick, { key: 'ArrowLeft' })
    expect(Number(stick.getAttribute('aria-valuenow'))).toBeLessThan(0)
    fireEvent.keyUp(stick, { key: 'ArrowLeft' })
    expect(stick).toHaveAttribute('aria-valuenow', '0')

    const wheel = app.control('perf-mod-wheel')
    fireEvent.pointerDown(wheel, { pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(wheel, { pointerId: 1, clientX: 100, clientY: 60 })
    fireEvent.pointerUp(wheel, { pointerId: 1 })
    expect(Number(wheel.getAttribute('aria-valuenow'))).toBeGreaterThan(0)
  })

  it('double-click returns a control to where it started', () => {
    const app = mountApp()
    const knob = app.control('fx-reverb-mix')
    const initial = knob.getAttribute('aria-valuenow')
    fireEvent.keyDown(knob, { key: 'End' })
    expect(knob.getAttribute('aria-valuenow')).not.toBe(initial)
    fireEvent.doubleClick(knob)
    expect(knob.getAttribute('aria-valuenow')).toBe(initial)
  })
})

describe('interaction.decorative-controls: presentation state only', () => {
  it('operating every control never starts audio, sends nothing to the engine, and stores nothing', async () => {
    const app = mountApp()
    operateEverything(app)
    await app.settle()
    // No control is a "gesture" for audio: the context was never even created.
    expect(app.fake.audio.contexts).toHaveLength(0)
    expect(app.fake.storage.data.size).toBe(0)
    expect(app.fake.midi.requests).toBe(0)
    expect(app.fake.timing.pendingTimers).toBe(0)

    // With audio running, operating every control again sends the synthesis host nothing.
    fireEvent.pointerDown(app.key(60), { pointerId: 50 })
    fireEvent.pointerUp(app.key(60), { pointerId: 50 })
    await app.settle()
    const sent = app.fake.audio.node.received.length
    operateEverything(app)
    expect(app.fake.audio.node.received).toHaveLength(sent)
    expect(app.fake.audio.connections).toHaveLength(1)
  })

  it('the keybed sounds bit-for-bit the same before and after every control is moved', async () => {
    const play = async (touchPanel: boolean) => {
      const app = mountApp()
      if (touchPanel) operateEverything(app)
      fireEvent.pointerDown(app.key(48), { pointerId: 50 })
      fireEvent.pointerDown(app.key(64), { pointerId: 51 })
      await app.settle()
      if (touchPanel) operateEverything(app)
      const out = app.fake.audio.node.render(0.25)
      fireEvent.pointerUp(app.key(48), { pointerId: 50 })
      const tail = app.fake.audio.node.render(0.25)
      app.unmount()
      return { out, tail }
    }
    const untouched = await play(false)
    const touched = await play(true)
    expect(untouched.out.left.some((sample) => sample !== 0)).toBe(true)
    expect(equal(untouched.out.left, touched.out.left)).toBe(true)
    expect(equal(untouched.out.right, touched.out.right)).toBe(true)
    expect(equal(untouched.tail.left, touched.tail.left)).toBe(true)
  })

  it('no control changes what the OLEDs or the status readouts say', () => {
    const app = mountApp()
    const readouts = () => [
      app.control('program-oled').textContent,
      app.control('program-oled').getAttribute('aria-label'),
      app.control('synth-oled').textContent,
      app.container.querySelector('.console')?.textContent,
    ]
    const before = readouts()
    operateEverything(app)
    expect(readouts()).toEqual(before)
    // Pressing a key on the keybed, by contrast, does change the readouts.
    fireEvent.pointerDown(app.key(60), { pointerId: 1 })
    expect(readouts()).not.toEqual(before)
  })

  it('no control presses a key, holds the pedal, or changes the computer-keyboard octave', () => {
    const app = mountApp()
    operateEverything(app)
    expect(app.container.querySelectorAll('.key.is-down')).toHaveLength(0)
    expect(app.getByRole('button', { name: /Sustain pedal/ })).toHaveAttribute('aria-pressed', 'false')
    expect(app.getByTestId('kbd-octave')).toHaveTextContent('A = C4')
  })

  it('the OLEDs never claim a program, an organ, or a synth that is not there', () => {
    const app = mountApp()
    operateEverything(app)
    // Phase 3: there are programs now, so the Program display names the one that is loaded —
    // this project's own factory program 1.1 — and the real piano model. It still never shows
    // Nord factory content or a bank letter, and no organ model while the Organ is off.
    const program = app.control('program-oled').textContent ?? ''
    expect(program).toContain('1.1 Grand Piano')
    expect(program).toContain('Salamander Grand')
    expect(program).not.toContain('Basic Piano')
    expect(program).not.toMatch(/Soulful|Vista|Royal|White Grand|[A-H]:\d\d|B3|Farf|Vox/)
    // The Synth display shows the Synth's real state: its waveform, and that the layer is off.
    expect(app.control('synth-oled').textContent).toMatch(/Saw \(OFF\)/)
    expect(app.control('synth-oled').textContent).not.toMatch(/Not active/)
    expect(app.control('synth-oled').getAttribute('aria-label')).toMatch(/Synth layer A Saw \(OFF\)/)
  })

  it('tells assistive tech and sighted users alike that the panel is decorative', () => {
    const app = mountApp()
    const note = app.control('decorative-note')
    expect(note).toHaveTextContent(/Decorative in Phase 3/)
    for (const def of INVENTORY.controls) {
      const element = app.control(def.id)
      const description =
        (element.getAttribute('aria-description') ?? '') +
        (app.container.ownerDocument.getElementById(element.getAttribute('aria-describedby') ?? '')?.textContent ?? '')
      if (FUNCTIONAL.has(def.id)) {
        // A functional control must not be described as decorative.
        expect(element, def.id).toHaveAttribute('data-decorative', 'false')
        expect(description, def.id).not.toMatch(/does not change the sound|Decorative/)
      } else {
        expect(element, def.id).toHaveAttribute('data-decorative', 'true')
        expect(description, def.id).toMatch(/does not change the sound/)
      }
    }
    expect([...buttons, ...ranges].length + FUNCTIONAL.size).toBe(INVENTORY.controls.length)
    expect(app.container.querySelector('.console__note')).toHaveTextContent(/decorative: it does not change the sound/)
  })
})

describe('interaction.decorative-controls: the hardware store is a dead end', () => {
  it('holds only positions, and cannot reach audio, input, or platform code', () => {
    const hardwareDir = join(process.cwd(), 'src', 'hardware')
    const files: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.tsx?$/.test(entry)) files.push(path)
      }
    }
    walk(hardwareDir)
    expect(files.length).toBeGreaterThan(8)
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1])
      for (const specifier of imports) {
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/audio|input|platform|app\/|ui\//)
      }
      expect(source).not.toMatch(/AudioContext|localStorage|requestMIDIAccess|window\./)
    }
    // The control components import the store and nothing that makes sound.
    const controls = readFileSync(join(process.cwd(), 'src', 'ui', 'controls.tsx'), 'utf8')
    expect(controls).not.toMatch(/from '\.\.\/(audio|input|platform|app)\//)
  })

  it('normalizes values: clamp, snap, and wrap', () => {
    const store = new HardwareStore()
    store.setValue('organ-drawbar-1', 99)
    expect(store.getValue('organ-drawbar-1')).toBe(8)
    store.setValue('organ-drawbar-1', -3)
    expect(store.getValue('organ-drawbar-1')).toBe(0)
    store.setValue('organ-drawbar-1', 3.4)
    expect(store.getValue('organ-drawbar-1')).toBe(3)
    store.setValue('rotary-drive', 4.26)
    expect(store.getValue('rotary-drive')).toBe(4.3)
    const dial = store.def('program-dial') as RangeDef
    expect(normalize(dial, 24)).toBe(0)
    expect(normalize(dial, -1)).toBe(23)
    expect(normalize(dial, 49)).toBe(1)
    // Buttons cannot be set like a knob, and unknown controls are rejected.
    store.setValue('fx-on', 0)
    expect(store.getValue('fx-on')).toBe(1)
    expect(() => store.setValue('nope', 1)).toThrow()
  })

  it('starts in the reference-photo state and returns to it on reset', () => {
    const store = new HardwareStore()
    const initial = store.snapshot()
    expect(initial['piano-type']).toBe(0)
    expect(initial['organ-drawbar-3']).toBe(8)
    let changes = 0
    const unsubscribe = store.subscribe(() => {
      changes += 1
    })
    store.activate('piano-type')
    store.setValue('organ-drawbar-3', 2)
    store.setValue('organ-drawbar-3', 2) // no change, no notification
    store.press('shift')
    expect(store.isPressed('shift')).toBe(true)
    expect(changes).toBe(4) // activate = press + release, one real set, one press
    store.reset()
    expect(store.snapshot()).toEqual(initial)
    expect(store.isPressed('shift')).toBe(false)
    expect(store.getPressCount('piano-type')).toBe(0)
    unsubscribe()
    expect(store.listenerCount).toBe(0)
  })
})
