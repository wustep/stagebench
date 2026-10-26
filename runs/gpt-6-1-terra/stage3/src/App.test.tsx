import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from './App'
import { PianoEngine, type AudioBackend } from './audio'

describe('surface', () => {
 it('renders the exact keybed and six sections with decorative controls', () => {
  const { container } = render(<App />)
  expect(container.querySelectorAll('.piano-key')).toHaveLength(73)
  expect(container.querySelectorAll('.white')).toHaveLength(43)
  expect(container.querySelectorAll('.black')).toHaveLength(30)
  expect(screen.getByLabelText('Piano E2')).toBeInTheDocument()
  expect(screen.getByLabelText('Piano E8')).toBeInTheDocument()
  expect(container.querySelectorAll('.section')).toHaveLength(6)
  expect(container.querySelectorAll('.oled')).toHaveLength(2)
  const button = screen.getByRole('button', { name: 'Piano Type' })
  fireEvent.click(button); expect(button).toHaveAttribute('aria-pressed', 'true')
  const knob = screen.getByLabelText('Master Level')
  fireEvent.change(knob, { target: { value: '80' } }); expect(knob).toHaveValue('80')
 })
})
describe('piano lifecycle', () => {
 it('sustains released notes, steals oldest and cleans up', () => {
  const voices: {release: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>}[] = []
  const backend: AudioBackend = { start: vi.fn(() => { const voice = { release: vi.fn(), stop: vi.fn() }; voices.push(voice); return voice }), close: vi.fn() }
  const piano = new PianoEngine(backend, 2)
  piano.on('a', 60, 40); piano.sustain(true); piano.off('a'); expect(voices[0].release).not.toHaveBeenCalled()
  piano.on('b', 64, 100); piano.on('c', 67, 127); expect(voices[0].stop).toHaveBeenCalledOnce()
  piano.off('b'); piano.sustain(false); expect(voices[1].release).toHaveBeenCalledOnce()
  piano.close(); expect(voices[2].stop).toHaveBeenCalledOnce(); expect(backend.close).toHaveBeenCalledOnce()
  expect(backend.start).toHaveBeenCalledWith(60, 40)
 })
})

describe('surface inventory and ownership', () => {
 it('uses distinct named controls and the chromatic E to E pattern', () => {
  const { container } = render(<App />)
  const controls = [...container.querySelectorAll<HTMLInputElement | HTMLButtonElement>('.section input, .section button')]
  expect(new Set(controls.map(x => x.id)).size).toBe(controls.length)
  expect(controls.every(x => x.id && (['perf-0', 'perf-1', 'rotary-0', 'rotary-1', 'rotary-2', 'wheel-0', 'effect-focus-1', 'effect-focus-3', 'sys-0', 'morph-0', 'morph-2', 'wheel-1', 'effect-focus-0', 'effect-focus-2', 'piano-0', 'piano-1', 'piano-2', 'piano-3', 'piano-4', 'piano-5', 'piano-6', 'piano-7', 'piano-8', 'piano-level-0', 'piano-level-1', 'effects-switch-0', 'effects-switch-1', 'effects-switch-2', 'effects-switch-3', 'effects-switch-4', 'effects-switch-5', 'effects-switch-6', 'effects-switch-7', 'effects-switch-8', 'effects-a-0', 'effects-a-1', 'effects-a-2', 'effects-a-3', 'effects-b-0', 'effects-b-1', 'effects-b-2', 'effects-b-3', 'effects-b-7', 'effects-b-8', 'effects-b-4', 'effects-b-5', 'effects-b-6', 'effects-b-9', 'morph-4', 'morph-5', 'morph-7', 'organ-mode-0', 'organ-mode-1', 'organ-mode-2', 'organ-mode-3', 'organ-mode-4', 'organ-mode-5', 'organ-mode-6', 'organ-mode-7', 'synth-bottom-5', 'synth-bottom-6', 'synth-top-0', 'synth-top-1', 'synth-top-3', 'synth-top-4', 'synth-top-5', 'synth-top-6', 'synth-top-7', 'synth-bottom-0', 'synth-bottom-1', 'synth-bottom-2', 'synth-bottom-3', 'synth-bottom-4', ...Array.from({length: 9}, (_, i) => `drawbar-${i}`), ...Array.from({length: 2}, (_, i) => `organ-level-${i}`), ...Array.from({length: 3}, (_, i) => `synth-level-${i}`), ...([0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(i => `synth-knob-${i}`)), 'morph-3', 'morph-6', 'morph-8', 'morph-9', 'program-dial-0', ...Array.from({length: 8}, (_, i) => `program-button-${i}`)].includes(x.id) ? !x.getAttribute('aria-label')?.includes('decorative') : x.getAttribute('aria-label')?.includes('decorative')))).toBe(true)
  const keyNodes = [...container.querySelectorAll<HTMLElement>('.piano-key')]
  expect(keyNodes.map(x => Number(x.dataset.note))).toEqual(Array.from({ length: 73 }, (_, i) => i + 40))
  for (const key of keyNodes) expect(key.classList.contains('black')).toBe([1, 3, 6, 8, 10].includes(Number(key.dataset.note) % 12))
  expect(container.querySelectorAll('.organ .drawbar-unit')).toHaveLength(9)
  expect(container.querySelector('.program .oled')).toBeInTheDocument()
  expect(container.querySelector('.synth .oled')).toBeInTheDocument()
 })
 it('retains retriggered notes under the pedal until pedal up', () => {
  const voices: {release: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>}[] = []
  const backend: AudioBackend = { start: () => { const v = { release: vi.fn(), stop: vi.fn() }; voices.push(v); return v }, close: vi.fn() }
  const piano = new PianoEngine(backend)
  piano.sustain(true); piano.on('midi', 60, 100); piano.off('midi'); piano.on('midi', 60, 100); piano.off('midi')
  expect(voices[0].release).not.toHaveBeenCalled(); expect(voices[0].stop).not.toHaveBeenCalled()
  piano.sustain(false); expect(voices[0].release).toHaveBeenCalledOnce(); expect(voices[1].release).toHaveBeenCalledOnce()
 })
})
