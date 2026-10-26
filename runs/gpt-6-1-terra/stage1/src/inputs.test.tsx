import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const starts: number[] = []
const stops: number[] = []
class FakeParam { value = 0; setValueAtTime() {} exponentialRampToValueAtTime() {} cancelScheduledValues() {} setTargetAtTime() {} }
class FakeNode { gain = new FakeParam(); frequency = new FakeParam(); type = ''; onended: (() => void) | null = null; connect() {} disconnect() {} start() { starts.push(1) } stop() { stops.push(1) } }
class FakeContext { currentTime = 0; destination = {}; createGain() { return new FakeNode() }; createOscillator() { return new FakeNode() }; close() { return Promise.resolve() } }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); starts.length = 0; stops.length = 0 })
describe('shared note inputs', () => {
 it('suppresses keyboard repeats and releases on keyup and blur', () => {
  vi.stubGlobal('AudioContext', FakeContext)
  render(<App />)
  fireEvent.keyDown(window, { key: 'a' }); fireEvent.keyDown(window, { key: 'a', repeat: true })
  expect(starts).toHaveLength(2); expect(screen.getByLabelText('Piano C4')).toHaveClass('pressed')
  fireEvent.keyUp(window, { key: 'a' }); expect(stops).toHaveLength(2)
  fireEvent.keyDown(window, { key: 's' }); fireEvent.blur(window)
  expect(screen.getByLabelText('Piano D4')).not.toHaveClass('pressed'); expect(stops.length).toBeGreaterThanOrEqual(4)
 })
 it('tracks independent pointers and handles cancellation', () => {
  vi.stubGlobal('AudioContext', FakeContext)
  Element.prototype.setPointerCapture = vi.fn()
  render(<App />)
  const c = screen.getByLabelText('Piano C4'), d = screen.getByLabelText('Piano D4')
  // jsdom needs a PointerEvent constructor to preserve pointer IDs.
  class TestPointerEvent extends MouseEvent { pointerId: number; constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 0 } }
  vi.stubGlobal('PointerEvent', TestPointerEvent)
  fireEvent.pointerDown(c, { pointerId: 1 }); fireEvent.pointerDown(d, { pointerId: 2 })
  expect(c).toHaveClass('pressed'); expect(d).toHaveClass('pressed')
  fireEvent.pointerCancel(c, { pointerId: 1 }); expect(c).not.toHaveClass('pressed'); expect(d).toHaveClass('pressed')
  fireEvent.pointerUp(d, { pointerId: 2 }); expect(d).not.toHaveClass('pressed')
 })
 it('routes MIDI velocity, pedal, disconnect and reports denied access', async () => {
  vi.stubGlobal('AudioContext', FakeContext)
  const input = { id: 'midi1', onmidimessage: null as null | ((e: unknown) => void) }
  const access = { inputs: new Map([['midi1', input]]), onstatechange: null as null | (() => void) }
  Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: vi.fn().mockResolvedValue(access) })
  const view = render(<App />)
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('MIDI connected'))
  const send = (data: number[]) => act(() => input.onmidimessage?.({ data, target: input }))
  send([0xb0, 64, 127]); send([0x90, 60, 35]); send([0x80, 60, 0]); expect(stops).toHaveLength(0)
  send([0xb0, 64, 0]); expect(stops).toHaveLength(2)
  send([0x90, 64, 100]); act(() => access.onstatechange?.()); expect(screen.getByLabelText('Piano E4')).not.toHaveClass('pressed')
  view.unmount(); expect(input.onmidimessage).toBeNull()
  Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: vi.fn().mockRejectedValue(new Error('denied')) })
  render(<App />); await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('MIDI access denied'))
 })
})
