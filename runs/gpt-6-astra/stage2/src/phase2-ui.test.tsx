import { StrictMode } from 'react'
import { fireEvent, render, screen, act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from './App'
import { LayeredPianoEngine, type LayerAudioBoundary } from './layer-audio'
import { PianoLibrary } from './library'
import { controls } from './hardware'
import { panelBinding } from './panel'
function mount() {
  const output: LayerAudioBoundary = { library: new PianoLibrary(), start: vi.fn(async () => {}), configure: vi.fn(), voice: vi.fn(() => ({ release: vi.fn(), stop: vi.fn() })), close: vi.fn(), clear: vi.fn(), pedal: vi.fn() }
  const engine = new LayeredPianoEngine(output)
  return { ...render(<StrictMode><App suppliedEngine={engine} /></StrictMode>), engine, output }
}
describe('Phase 2 canonical panel bindings', () => {
  it('keeps the complete Phase 1 surface while exposing accurate active and decorative labels', () => {
    const { container } = mount()
    expect(container.querySelectorAll('.piano-key')).toHaveLength(73); expect(container.querySelectorAll('.hardware')).toHaveLength(controls.length)
    expect(container.querySelector('#performance-master-level')).not.toHaveAccessibleName(expect.stringContaining('decorative'))
    expect(container.querySelector('#organ-organ-model')).toHaveAccessibleName(expect.stringContaining('decorative'))
    expect(container.querySelector('#effects-effects-variation')).toHaveAccessibleName(expect.stringContaining('decorative'))
    expect(container.querySelector('#program-program-dial')).toHaveAccessibleName(expect.stringContaining('decorative'))
  })
  it('cycles type and touch, follows focus, edits both layers and binds master without starting audio', () => {
    const { engine, output, container } = mount()
    fireEvent.click(container.querySelector('#piano-piano-type')!); expect(engine.state.layers.A.type).toBe('Upright')
    fireEvent.click(container.querySelector('#piano-kb-touch')!); expect(engine.state.layers.A.touch).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: 'Focus Piano B', hidden: true })); expect(engine.state.focus).toBe('B'); expect(engine.state.fxFocus).toBe('B')
    fireEvent.click(screen.getByRole('button', { name: 'Enable Piano B', hidden: true })); expect(engine.state.layers.B.enabled).toBe(true)
    fireEvent.change(container.querySelector('#performance-master-level')!, { target: { value: '30' } }); expect(engine.state.master).toBe(.3)
    expect(output.start).not.toHaveBeenCalled(); expect(output.voice).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Program OLED: piano model status')).toHaveTextContent('RECORDINGS UNAVAILABLE')
  })
  it('Shift+On, manual focus, group, all-bypass and excluded controls have honest targets', () => {
    const { engine, container } = mount()
    fireEvent.click(container.querySelector('#effects-delay-on')!, { shiftKey: true }); expect(engine.state.globals.delay).toBe(true)
    fireEvent.click(container.querySelector('#effects-delay-on')!); expect(engine.state.layers.A.effects.delay.on).toBe(true); expect(engine.state.layers.B.effects.delay.on).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Piano group mode', hidden: true })); expect(engine.state.group).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'All effects on', hidden: true })); expect(engine.state.effectsOn).toBe(false)
    const before = JSON.stringify(engine.state.layers)
    fireEvent.click(container.querySelector('#effects-organ-focus')!); fireEvent.click(container.querySelector('#effects-mod-1-on')!); fireEvent.click(container.querySelector('#effects-effects-variation')!)
    expect(engine.state.fxSection).toBe('Organ'); expect(JSON.stringify(engine.state.layers)).toBe(before)
  })
  it('survives StrictMode reattachment with held-key feedback and cleanup', async () => {
    const { engine, output, unmount } = mount(), key = screen.getByRole('button', { name: 'Play C4' })
    await act(async () => { fireEvent.keyDown(key, { key: 'Enter' }) })
    expect(key).toHaveAttribute('aria-pressed', 'true'); expect(engine.notes.size).toBe(1)
    fireEvent.keyUp(key, { key: 'Enter' }); expect(key).toHaveAttribute('aria-pressed', 'false')
    unmount(); expect(engine.notes.size).toBe(0); expect(output.close).toHaveBeenCalled()
  })
  it('physical normalized controls bind their actual units, including reverb brightness', () => {
    const { engine } = mount()
    const c = controls.find(c => c.id === 'effects-reverb-rate')!
    act(() => panelBinding(engine, c)!.change(85))
    expect(engine.state.layers.A.effects.reverb.tone).toBe(.85)
  })
})
