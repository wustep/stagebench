import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from './App'
import { controls, initialHardware, keys, sections, updateHardware } from './hardware'
import { PianoEngine } from './audio'
function mount() { const audio = { start: vi.fn(async () => {}), voice: vi.fn(() => ({ release: vi.fn(), stop: vi.fn() })), close: vi.fn() }; const engine = new PianoEngine(audio); return { ...render(<App suppliedEngine={engine} />), engine, audio } }
describe('Stage 4 73 hardware', () => {
  it('models the exact E1–E7 keybed, white/black pattern and contiguous geometry', () => {
    mount(); expect(keys).toHaveLength(73); expect(keys.filter(k => k.black)).toHaveLength(30); expect(keys.filter(k => !k.black)).toHaveLength(43)
    expect(keys[0]).toMatchObject({ midi: 28, name: 'E1', left: 0 }); expect(keys[72]).toMatchObject({ midi: 100, name: 'E7' })
    keys.forEach((k, i) => { expect(k.midi).toBe(i + 28); expect(k.black).toBe([1, 3, 6, 8, 10].includes(k.midi % 12)); expect(k.left + k.width).toBeLessThanOrEqual(100.0001); expect(screen.getByRole('button', { name: `Play ${k.name}` })).toBeInTheDocument() })
  })
  it('renders six photo-measured sections, mixed control landmarks and just two primary OLEDs', () => {
    const { container } = mount()
    expect(sections.map(s => s.fraction)).toEqual([.14, .2, .085, .125, .25, .2])
    expect([...container.querySelectorAll('[data-section]')].map(e => e.getAttribute('data-section'))).toEqual(sections.map(s => s.id))
    expect(container.querySelectorAll('.oled')).toHaveLength(2); expect(container.querySelector('.program .oled')).toBeInTheDocument(); expect(container.querySelector('.synth .oled')).toBeInTheDocument()
    expect(container.querySelectorAll('.organ .drawbar')).toHaveLength(9); expect(container.querySelectorAll('.effects .effect-strip')).toHaveLength(5)
    expect(container.querySelector('.performance .wheel')).toBeInTheDocument(); expect(container.querySelector('.performance .stick')).toBeInTheDocument()
    expect(new Set(controls.map(c => c.id)).size).toBe(controls.length); expect(controls.length).toBeGreaterThan(130)
  })
  it('gives every panel input a unique stable ID, name, role and value, with presentation-only interaction', () => {
    const { container, audio, engine } = mount()
    for (const c of controls) {
      const input = container.querySelector(`#${c.id}`)!
      expect(input).toHaveAccessibleName(expect.stringContaining(c.label))
      if (c.kind === 'button') { fireEvent.click(input); expect(input).toHaveAttribute('aria-pressed', c.initial ? 'false' : 'true') }
      else { fireEvent.change(input, { target: { value: '91' } }); expect(input).toHaveValue('91'); expect(input).toHaveAttribute('aria-valuetext', '91 percent · decorative') }
    }
    expect(audio.start).not.toHaveBeenCalled(); expect(audio.voice).not.toHaveBeenCalled(); expect(engine.notes.size).toBe(0)
    expect(screen.getByLabelText('Program OLED: panel inactive')).toHaveTextContent('Panel is decorative')
  })
  it('clamps presentation values without mutating defaults or accepting unknown IDs', () => {
    const next = updateHardware(initialHardware, 'performance-master-level', 500); expect(next['performance-master-level']).toBe(100); expect(initialHardware['performance-master-level']).toBe(70)
    expect(updateHardware(initialHardware, 'unknown', 50)).toBe(initialHardware)
  })
  it('keyboard-accessible key buttons release on keyup and focus loss; unmount cleans audio', () => {
    const { engine, audio, unmount } = mount(); const key = screen.getByRole('button', { name: 'Play C4' })
    fireEvent.keyDown(key, { key: 'Enter' }); expect(engine.notes.size).toBe(1); expect(key).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyUp(key, { key: 'Enter' }); expect(engine.notes.size).toBe(0)
    fireEvent.keyDown(key, { key: ' ' }); fireEvent.blur(key); expect(engine.notes.size).toBe(0)
    unmount(); expect(audio.close).toHaveBeenCalledOnce()
  })
  it('offers truthful initial status and explicit surface inspection', () => {
    mount(); expect(screen.getByText('Piano asleep · play a key to begin')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Inspect surface' })); expect(screen.getByRole('button', { name: 'Fit instrument' })).toHaveAttribute('aria-pressed', 'true')
  })
})
