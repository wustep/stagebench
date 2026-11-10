import { act, fireEvent } from '@testing-library/react'
import type { StageKernel } from '../../src/audio/dsp/stage'
import type { MountedApp } from './app'
import type { Stereo } from './signal'

/** Ways to work the mounted panel the way a hand does, and to read back what it shows. */

export function press(app: MountedApp, id: string): void {
  const element = app.control(id)
  fireEvent.pointerDown(element, { pointerId: 90, pointerType: 'mouse', button: 0 })
  fireEvent.pointerUp(element, { pointerId: 90 })
}

/** Hold the effects-side Shift button, press `id`, let Shift go. */
export function shiftPress(app: MountedApp, id: string): void {
  const shift = app.control('fx-shift')
  fireEvent.pointerDown(shift, { pointerId: 91, pointerType: 'touch' })
  const element = app.control(id)
  fireEvent.pointerDown(element, { pointerId: 92, pointerType: 'touch' })
  fireEvent.pointerUp(element, { pointerId: 92 })
  fireEvent.pointerUp(shift, { pointerId: 91 })
}

/** Send keyboard keys to a knob, fader, or dial: 'Home', 'End', 'ArrowUp', 'PageUp', … */
export function keys(app: MountedApp, id: string, ...sequence: string[]): void {
  const element = app.control(id)
  for (const key of sequence) {
    fireEvent.keyDown(element, { key })
    fireEvent.keyUp(element, { key })
  }
}

export function value(app: MountedApp, id: string): number {
  return Number(app.control(id).getAttribute('aria-valuenow'))
}

export function step(app: MountedApp, id: string): string | null {
  return app.control(id).getAttribute('data-step-label')
}

/** 'on' | 'off' | 'blink' for the LED with the given slug (without the `led-` prefix). */
export function led(app: MountedApp, slug: string): string | null {
  return app.control(`led-${slug}`).getAttribute('data-mode')
}

export function oled(app: MountedApp, line: 'layers' | 'model' | 'source' | 'notice' | 'big' | 'program-name'): string {
  return app.control('program-oled').querySelector(`[data-line="${line}"]`)?.textContent ?? ''
}

export function down(app: MountedApp, note: number, pointerId = note): void {
  fireEvent.pointerDown(app.key(note), { pointerId, pointerType: 'touch' })
}

export function up(app: MountedApp, note: number, pointerId = note): void {
  fireEvent.pointerUp(app.key(note), { pointerId })
}

/** Start audio with a throw-away key press, then leave the instrument silent and settled. */
export async function start(app: MountedApp): Promise<StageKernel> {
  down(app, 60, 999)
  await app.settle()
  up(app, 60, 999)
  act(() => {
    app.fake.audio.node.render(1.5)
  })
  return kernelOf(app)
}

export function kernelOf(app: MountedApp): StageKernel {
  return app.fake.audio.node.host.kernel
}

export function render(app: MountedApp, seconds: number): Stereo {
  let out: Stereo = { left: new Float32Array(0), right: new Float32Array(0) }
  act(() => {
    out = app.fake.audio.node.render(seconds)
  })
  return out
}
