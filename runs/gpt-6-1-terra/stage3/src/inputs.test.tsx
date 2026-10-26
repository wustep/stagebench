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
 it('holds notes with the UI and keyboard sustain sources independently', () => {
  vi.stubGlobal('AudioContext', FakeContext)
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Sustain off' }))
  fireEvent.keyDown(window, { key: ' ', code: 'Space' })
  fireEvent.keyDown(window, { key: 'a' }); fireEvent.keyUp(window, { key: 'a' })
  expect(stops).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: 'Sustain on' }))
  expect(stops).toHaveLength(0)
  fireEvent.keyUp(window, { key: ' ', code: 'Space' })
  expect(stops).toHaveLength(2)
 })
 it('keeps grouped effect settings together across focus changes', () => {
  render(<App />)
  fireEvent.click(screen.getByText('Layer and effects settings'))
  fireEvent.click(screen.getByRole('button', { name: 'Effect 1 Select' }))
  expect(screen.getByText(/Mod 1: Tremolo/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Piano effects group off' }))
  fireEvent.click(screen.getByRole('button', { name: 'Piano Layer B' }))
  expect(screen.getByText(/Mod 1: Tremolo/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Effect 1 Select' }))
  fireEvent.click(screen.getByRole('button', { name: 'Piano Layer A' }))
  expect(screen.getByText(/Mod 1: Ring Mod/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'All effects on' }))
  expect(screen.getByRole('button', { name: 'All effects bypassed' })).toHaveAttribute('aria-pressed', 'false')
 })
 it('applies a global delay setting to both piano layers', () => {
  render(<App />)
  fireEvent.click(screen.getByText('Layer and effects settings'))
  fireEvent.click(screen.getByRole('button', { name: 'Delay On' }), { shiftKey: true }); expect(screen.getByRole('button', { name: 'delay global on' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Delay On' }))
  fireEvent.click(screen.getByRole('button', { name: 'Piano Layer B' }))
  expect(screen.getByRole('button', { name: 'Delay On' })).toHaveAttribute('aria-pressed', 'true')
 })
 it('creates one audio context for overlapping layers and closes it on unmount', () => {
  let count = 0
  const close = vi.fn(() => Promise.resolve())
  class CountedContext extends FakeContext { constructor() { super(); count++ }; close = close }
  vi.stubGlobal('AudioContext', CountedContext)
  const view = render(<App />)
  fireEvent.click(screen.getByText('Layer and effects settings'))
  fireEvent.click(screen.getByRole('button', { name: 'Layer B off' }))
  fireEvent.keyDown(window, { key: 'a' }); fireEvent.keyDown(window, { key: 's' })
  expect(count).toBe(1)
  view.unmount(); expect(close).toHaveBeenCalledOnce()
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
