// Shared helpers for whole-app (Workbench) tests: mount, element lookup, Shift, striking keys.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { expect } from 'vitest'
import { Workbench } from '../App'
import type { StageController } from '../system/controller'
import { makeTestRuntime, type TestRuntime } from './fakes'

export async function mountApp(runtime: TestRuntime = makeTestRuntime()) {
  const utils = render(createElement(Workbench, { runtime }))
  await waitFor(() => expect(screen.getByTestId('voice-status').textContent).toMatch(/^Ready$/))
  return { ...utils, runtime }
}

export const el = (id: string): HTMLElement => {
  const found = document.getElementById(id)
  if (!found) throw new Error(`missing #${id}`)
  return found
}

export const key = (midi: number) => document.querySelector<HTMLElement>(`[data-note="${midi}"]`)!
export const keybed = () => document.querySelector<HTMLElement>('.keybed')!
export const lit = (led: string) => el(led).getAttribute('data-lit') === 'true'
export const flashing = (led: string) => el(led).getAttribute('data-flash') === 'true'
export const value = (id: string) => Number(el(id).getAttribute('aria-valuenow'))
export const status = () => screen.getByTestId('program-status').textContent ?? ''
export const click = (id: string) => fireEvent.click(el(id))

/** Hold the program Shift rocker while `action` runs. */
export function withShift(action: () => void, shiftId = 'program-shift') {
  const shift = el(shiftId)
  fireEvent.pointerDown(shift)
  action()
  fireEvent.pointerUp(shift)
}

/** Shift pressed and released alone = EXIT. */
export function exit() {
  withShift(() => undefined)
}

export function turn(id: string, steps: number) {
  const k = steps > 0 ? 'ArrowUp' : 'ArrowDown'
  for (let i = 0; i < Math.abs(steps); i++) fireEvent.keyDown(el(id), { key: k })
}

/** Press a key with the pointer, render while held, release, render the tail. */
export function strike(runtime: TestRuntime, midi = 60, hold = 0.3, tail = 0.1): Float32Array {
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

/** The controller behind the mounted app (inspection of canonical state). */
export function controllerOf(runtime: TestRuntime): StageController {
  const c = runtime.handles?.controller
  if (!c) throw new Error('app not mounted')
  return c
}
