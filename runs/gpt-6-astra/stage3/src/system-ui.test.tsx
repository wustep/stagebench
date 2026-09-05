import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import App from './App'
import { controls } from './hardware'
import { SystemEngine } from './system-engine'
import { systemBinding, unsupportedControls } from './system-panel'
import { PianoLibrary } from './library'
import type { LayerAudioBoundary } from './layer-audio'
function mount() { const output: LayerAudioBoundary = { library: new PianoLibrary(), start: vi.fn(async () => {}), configure: vi.fn(), voice: vi.fn(() => ({ release() {}, stop() {} })), extraVoice: vi.fn(() => ({ release() {}, stop() {} })), clear: vi.fn(), close: vi.fn(), pedal: vi.fn() }; const engine = new SystemEngine(output, { getItem: () => null, setItem() {} }); return { ...render(<App suppliedEngine={engine} />), engine, output } }
it('audits every hardware ID: canonical binding or an explicit spec exclusion', () => {
  const { engine, container } = mount()
  const missing = controls.filter(c => !systemBinding(engine, c) && !unsupportedControls[c.id]).map(c => c.id)
  expect(missing).toEqual([]); expect(container.querySelectorAll('.hardware')).toHaveLength(155); expect(container.querySelectorAll('.oled')).toHaveLength(2)
  for (const c of controls) if (unsupportedControls[c.id]) { const before = JSON.stringify(engine.state); fireEvent.click(container.querySelector(`#${c.id}`)!); expect(JSON.stringify(engine.state)).toBe(before); expect(container.querySelector(`#${c.id}`)).toHaveAccessibleName(expect.stringContaining('Unsupported')) }
})
it('supports program buttons, Store As naming, numeric list, pages and eight Live slots through browser controls', () => {
  const { engine, container } = mount(); fireEvent.click(container.querySelector('#program-store')!, { shiftKey: true }); fireEvent.change(screen.getByLabelText('Program name'), { target: { value: 'Stage Test' } }); fireEvent.click(screen.getByRole('button', { name: 'Accept name' })); fireEvent.click(container.querySelector('#program-program-3')!); fireEvent.click(screen.getByRole('button', { name: 'Confirm Store' })); expect(engine.slots[2].name).toBe('Stage Test'); expect(engine.dirty).toBe(false)
  fireEvent.click(container.querySelector('#program-prog-view')!); expect(engine.list).toBe(true); fireEvent.click(container.querySelector('#program-page-next')!); expect(engine.page).toBe(1); fireEvent.click(container.querySelector('#program-live-mode')!); expect(engine.live).toBe(true)
})
it('edits synth sources/envelopes, organ drawbars, split positions and zones canonically', () => {
  const { engine, container } = mount(); fireEvent.click(container.querySelector('#synth-amp-envelope')!); fireEvent.change(screen.getByLabelText('Synth waveform'), { target: { value: '13' } }); fireEvent.change(screen.getByLabelText('oscEnv attack'), { target: { value: '.4' } }); expect(engine.system.synth.Sa.wave).toBe(13); expect(engine.system.synth.Sa.oscEnv.attack).toBe(.4)
  fireEvent.click(container.querySelector('#organ-organ-model')!); expect(engine.system.organ.Oa.model).toBe(1); fireEvent.change(container.querySelector('#organ-drawbar-16')!, { target: { value: '50' } }); expect(engine.system.organ.Oa.drawbars[0]).toBe(4)
  fireEvent.click(container.querySelector('#program-split-on')!); fireEvent.change(screen.getByLabelText('Mid split position'), { target: { value: '5' } }); fireEvent.change(screen.getByLabelText('Mid crossfade'), { target: { value: '2' } }); expect(engine.system.points[1]).toEqual({ enabled: true, note: 65, width: 12 }); expect(container.querySelectorAll('.split-leds i')).toHaveLength(1)
})
it('latches wheel morph assignment, shows green indicators, interpolates and clears via Shift', () => {
  const { engine, container } = mount(); fireEvent.click(container.querySelector('#program-wheel-morph')!); fireEvent.change(container.querySelector('#piano-layer-a-level')!, { target: { value: '10' } }); expect(engine.system.morphs[0]).toEqual({ source: 'Wheel', path: 'layers.A.level', start: .75, end: .1 }); expect(container.querySelector('[data-control-id=piano-layer-a-level]')).toHaveAttribute('data-morph', 'true')
  fireEvent.change(container.querySelector('#performance-modulation-wheel')!, { target: { value: '100' } }); expect(engine.system.wheel).toBe(1); fireEvent.click(container.querySelector('#program-wheel-morph')!, { shiftKey: true }); expect(engine.system.morphs).toHaveLength(0)
})
it('Shift+Transpose Panic clears held input ownership so the same computer key can immediately play again', async () => {
  const { engine, container } = mount(); await act(async () => { fireEvent.keyDown(window, { code: 'KeyA' }) }); expect(engine.notes.size).toBe(1); fireEvent.click(container.querySelector('#program-transpose')!, { shiftKey: true }); expect(engine.notes.size).toBe(0); await act(async () => { fireEvent.keyDown(window, { code: 'KeyA' }) }); expect(engine.notes.size).toBe(1); fireEvent.keyUp(window, { code: 'KeyA' }); expect([...engine.notes.values()].some(n => n.held)).toBe(false)
})
