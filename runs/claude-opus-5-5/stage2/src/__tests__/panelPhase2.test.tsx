// Phase 2 panel bindings through the whole app: Piano section, Layer Effects, Master Level and
// the pedal/fallback UI change canonical state, panel feedback and the rendered audio together.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Workbench } from '../App'
import { delaySeconds } from '../audio/fx/delay'
import { makeTestRuntime, type TestRuntime } from '../testing/fakes'
import { difference, peak, rms } from '../testing/simAudio'

afterEach(cleanup)

const el = (id: string) => {
  const found = document.getElementById(id)
  if (!found) throw new Error(`missing #${id}`)
  return found
}
const key = (midi: number) => document.querySelector<HTMLElement>(`[data-note="${midi}"]`)!
const keybed = () => document.querySelector<HTMLElement>('.keybed')!
const lit = (led: string) => el(led).getAttribute('data-lit') === 'true'
const value = (id: string) => Number(el(id).getAttribute('aria-valuenow'))

async function mount(runtime: TestRuntime = makeTestRuntime(), ready: RegExp = /^Ready$/) {
  const utils = render(<Workbench runtime={runtime} />)
  await waitFor(() => expect(screen.getByTestId('voice-status').textContent).toMatch(ready))
  return { ...utils, runtime }
}

/** Press a key with the pointer, render while held, release, render the tail. */
function strike(runtime: TestRuntime, midi = 60, hold = 0.3, tail = 0.1): Float32Array {
  fireEvent.pointerDown(key(midi), { pointerId: 1, pointerType: 'mouse', button: 0 })
  const ctx = runtime.contexts[0]
  const a = ctx.render(hold)
  fireEvent.pointerUp(keybed(), { pointerId: 1 })
  const b = ctx.render(tail)
  const out = new Float32Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

function withShift(action: () => void) {
  const shift = el('effects-shift')
  fireEvent.pointerDown(shift)
  action()
  fireEvent.pointerUp(shift)
}

describe('Phase 2 panel — piano section drives sound and feedback', () => {
  it('type selector cycles the six types; LEDs, OLED and audio follow', async () => {
    const { runtime } = await mount()
    expect(lit('piano-led-type-grand')).toBe(true)
    expect(el('program-oled')).toHaveTextContent('Salamander Grand')
    const grand = strike(runtime)
    runtime.contexts[0].render(1)
    fireEvent.click(el('piano-type'))
    expect(lit('piano-led-type-upright')).toBe(true)
    expect(lit('piano-led-type-grand')).toBe(false)
    expect(el('program-oled')).toHaveTextContent('Upright KW')
    const upright = strike(runtime)
    expect(difference(grand, upright)).toBeGreaterThan(0.3)
    for (const [name, led] of [['Wurlitzer', 'electric'], ['Clavinet', 'clav'], ['Digital Piano', 'digital'], ['Marimba', 'misc']] as const) {
      fireEvent.click(el('piano-type'))
      expect(lit(`piano-led-type-${led}`)).toBe(true)
      expect(el('program-oled')).toHaveTextContent(name)
    }
    // Model dial selects within the type.
    fireEvent.keyDown(el('piano-model'), { key: 'ArrowUp' })
    expect(el('program-oled')).toHaveTextContent('Vibraphone')
  })

  it('performance buttons show canonical state: KB touch, dyn comp, unison, acoustics, timbre', async () => {
    await mount()
    expect(el('piano-kb-touch')).toHaveAttribute('data-state', 'MED')
    fireEvent.click(el('piano-kb-touch'))
    expect(el('piano-kb-touch')).toHaveAttribute('data-state', 'LIGHT')
    fireEvent.click(el('piano-kb-touch'))
    expect(el('piano-kb-touch')).toHaveAttribute('data-state', 'HEAVY')
    fireEvent.click(el('piano-dyn-comp'))
    expect(el('piano-dyn-comp')).toHaveAttribute('data-state', '1')
    fireEvent.click(el('piano-unison'))
    fireEvent.click(el('piano-unison'))
    fireEvent.click(el('piano-unison'))
    expect(el('piano-unison')).toHaveAttribute('data-state', '3')
    fireEvent.click(el('piano-acoustics'))
    expect(lit('piano-led-soft-rel')).toBe(true)
    // Acoustic types cycle Off/Soft/Mid/Bright only (Dyno is for electric pianos).
    for (let i = 0; i < 4; i++) fireEvent.click(el('piano-timbre'))
    expect(el('piano-timbre')).toHaveAttribute('data-state', 'off')
  })

  it('Master Level knob changes the rendered level and reaches silence at 0', async () => {
    const { runtime } = await mount()
    const ref = strike(runtime)
    runtime.contexts[0].render(1)
    fireEvent.keyDown(el('performance-master-level'), { key: 'End' })
    const loud = strike(runtime)
    runtime.contexts[0].render(1)
    expect(rms(loud)).toBeGreaterThan(rms(ref) * 1.3)
    fireEvent.keyDown(el('performance-master-level'), { key: 'Home' })
    const silent = strike(runtime)
    expect(peak(silent.subarray(800))).toBe(0)
  })

  it('layer buttons enable and focus layer B; the effect focus and knobs follow', async () => {
    const { runtime } = await mount()
    fireEvent.click(el('piano-layer-b'))
    expect(el('piano-layer-b')).toHaveAttribute('aria-pressed', 'true')
    expect(el('effects-focus-piano')).toHaveAttribute('data-state', 'B')
    expect(el('program-oled')).toHaveTextContent('PIANO B')
    expect(el('piano-led-b-on')).toHaveAttribute('data-flash', 'true')
    fireEvent.pointerDown(key(60), { pointerId: 1, pointerType: 'mouse', button: 0 })
    expect(screen.getByTestId('voice-count')).toHaveTextContent('(A 1 · B 1)')
    fireEvent.pointerUp(keybed(), { pointerId: 1 })
    // Edit B's reverb, then focus A: the knob shows A's own value.
    fireEvent.keyDown(el('effects-reverb-dry-wet'), { key: 'End' })
    expect(value('effects-reverb-dry-wet')).toBe(127)
    fireEvent.click(el('effects-focus-piano'))
    expect(el('effects-focus-piano')).toHaveAttribute('data-state', 'A')
    expect(value('effects-reverb-dry-wet')).toBe(45)
    runtime.contexts[0].render(0.1)
  })

  it('Shift + layer A toggles SUSTPED: the UI sustain pedal then no longer holds that layer', async () => {
    const { runtime } = await mount()
    expect(lit('piano-led-sustped')).toBe(true)
    withShift(() => fireEvent.click(el('piano-layer-a')))
    expect(lit('piano-led-sustped')).toBe(false)
    expect(el('piano-layer-a')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /Sustain pedal/ }))
    fireEvent.pointerDown(key(60), { pointerId: 1, pointerType: 'mouse', button: 0 })
    runtime.contexts[0].render(0.1)
    fireEvent.pointerUp(keybed(), { pointerId: 1 })
    runtime.contexts[0].render(1)
    expect(runtime.contexts[0].liveSourceCount()).toBe(0)
    // SUSTPED back on: the same UI pedal holds the note.
    withShift(() => fireEvent.click(el('piano-layer-a')))
    fireEvent.pointerDown(key(62), { pointerId: 1, pointerType: 'mouse', button: 0 })
    runtime.contexts[0].render(0.1)
    fireEvent.pointerUp(keybed(), { pointerId: 1 })
    runtime.contexts[0].render(0.5)
    expect(runtime.contexts[0].liveSourceCount()).toBe(1)
    withShift(() => fireEvent.click(el('piano-layer-b')))
    expect(lit('piano-led-pstick')).toBe(false)
  })

  it('octave buttons shift the focused layer', async () => {
    const { runtime } = await mount()
    fireEvent.click(el('piano-octave-up'))
    expect(el('program-oled')).toHaveTextContent('Oct +1')
    fireEvent.pointerDown(key(60), { pointerId: 1, pointerType: 'mouse', button: 0 })
    expect(screen.getByTestId('voice-count')).toHaveTextContent('1 / 24')
    fireEvent.pointerUp(keybed(), { pointerId: 1 })
    runtime.contexts[0].render(0.1)
  })
})

describe('Phase 2 panel — layer effects routing through the UI', () => {
  it('unit ON buttons and the Layer Effects ON button change the audio; types cycle with LEDs', async () => {
    const { runtime } = await mount()
    const plain = strike(runtime)
    runtime.contexts[0].render(1)
    fireEvent.click(el('effects-reverb-on'))
    fireEvent.keyDown(el('effects-reverb-dry-wet'), { key: 'End' })
    const wet = strike(runtime)
    runtime.contexts[0].render(1.5)
    expect(difference(plain, wet)).toBeGreaterThan(0.05)
    fireEvent.click(el('effects-on'))
    expect(el('effects-on')).toHaveAttribute('aria-pressed', 'false')
    runtime.contexts[0].render(0.1) // let the 20 ms bypass crossfade finish
    const bypassed = strike(runtime)
    expect(difference(plain, bypassed)).toBeLessThan(0.02)
    fireEvent.click(el('effects-reverb-type'))
    expect(lit('effects-led-reverb-cath')).toBe(true)
    fireEvent.click(el('effects-mod1-type'))
    expect(lit('effects-led-mod1-a-wah')).toBe(false)
    expect(el('effects-amp-type')).toHaveAttribute('data-state', 'unlit')
    for (let i = 0; i < 4; i++) fireEvent.click(el('effects-amp-type'))
    expect(el('effects-amp-type')).toHaveAttribute('data-state', 'TO ROTARY')
    fireEvent.click(el('effects-amp-on'))
    // Layer Effects is still off, so nothing is routed to the Rotary yet.
    expect(lit('performance-led-rotary-on')).toBe(false)
    fireEvent.click(el('effects-on'))
    expect(lit('performance-led-rotary-on')).toBe(true)
  })

  it('Shift functions: GLOBAL on Delay/Comp/Reverb, GROUP on piano focus, FAST on comp amount', async () => {
    await mount()
    withShift(() => fireEvent.click(el('effects-reverb-on')))
    expect(lit('effects-led-reverb-global')).toBe(true)
    expect(el('effects-reverb-on')).toHaveAttribute('aria-pressed', 'false')
    withShift(() => fireEvent.click(el('effects-delay-on')))
    withShift(() => fireEvent.click(el('effects-comp-on')))
    expect(lit('effects-led-delay-global')).toBe(true)
    expect(lit('effects-led-comp-global')).toBe(true)
    withShift(() => fireEvent.click(el('effects-focus-piano')))
    expect(lit('effects-led-focus-piano-a')).toBe(true)
    expect(lit('effects-led-focus-piano-b')).toBe(true)
    const amount = value('effects-comp-amount')
    withShift(() => fireEvent.keyDown(el('effects-comp-amount'), { key: 'ArrowUp' }))
    expect(lit('effects-led-comp-fast')).toBe(true)
    expect(value('effects-comp-amount')).toBe(amount)
    withShift(() => fireEvent.keyDown(el('effects-comp-amount'), { key: 'ArrowDown' }))
    expect(lit('effects-led-comp-fast')).toBe(false)
  })

  it('tap tempo sets the delay tempo knob from the tapped interval', async () => {
    const { runtime } = await mount()
    const before = value('effects-delay-tempo')
    act(() => {
      fireEvent.click(el('effects-delay-tap'))
      fireEvent.click(el('effects-delay-tap'))
    })
    // The injected clock advances 500 ms per reading → a 0.5 s delay.
    const after = value('effects-delay-tempo')
    expect(after).not.toBe(before)
    expect(delaySeconds(after)).toBeCloseTo(0.5, 1)
    void runtime
  })

  it('rotary speed and pitch stick are live performance controls', async () => {
    const { runtime } = await mount()
    expect(el('performance-rotary-speed')).toHaveAttribute('data-state', 'SLOW')
    fireEvent.click(el('performance-rotary-speed'))
    expect(el('performance-rotary-speed')).toHaveAttribute('data-state', 'FAST')
    const flat = strike(runtime, 60, 0.2, 0.02)
    runtime.contexts[0].render(1)
    fireEvent.keyDown(el('performance-pitch-stick'), { key: 'End' })
    const bent = strike(runtime, 60, 0.2, 0.02)
    fireEvent.keyUp(el('performance-pitch-stick'), { key: 'End' })
    expect(difference(flat, bent)).toBeGreaterThan(0.2)
  })
})

describe('Phase 2 panel — fallback and cleanup', () => {
  it('a failed Grand pack is reported as a labelled fallback that still plays', async () => {
    const runtime = makeTestRuntime({ failAssets: ['samples/grand.nspk'] })
    await mount(runtime, /Fallback/)
    expect(screen.getByTestId('voice-status')).not.toHaveTextContent('Ready')
    expect(screen.getByTestId('voice-detail')).toHaveTextContent(/Grand samples failed to load/)
    expect(el('program-oled')).toHaveTextContent('LOAD FAILED')
    expect(el('piano-led-type-grand')).toHaveAttribute('data-flash', 'true')
    expect(screen.getByTestId('library-sources')).toHaveTextContent(/Grand samples \(recorded samples\): failed/)
    expect(rms(strike(runtime))).toBeGreaterThan(0.003)
  })

  it('unmount closes the single context and frees every node, LFO and voice', async () => {
    const runtime = makeTestRuntime()
    const { unmount } = await mount(runtime)
    fireEvent.click(el('effects-mod2-on'))
    fireEvent.click(el('piano-layer-b'))
    fireEvent.pointerDown(key(60), { pointerId: 1, pointerType: 'mouse', button: 0 })
    const ctx = runtime.contexts[0]
    ctx.render(0.1)
    expect(ctx.liveSourceCount()).toBe(2)
    unmount()
    expect(runtime.contexts).toHaveLength(1)
    expect(ctx.closed).toBe(true)
    expect(ctx.liveSourceCount()).toBe(0)
    expect(ctx.liveModulatorCount()).toBe(0)
    expect(ctx.connectedNodeCount()).toBe(0)
  })
})
