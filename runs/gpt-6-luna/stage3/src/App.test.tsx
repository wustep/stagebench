import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { AudioConfiguration, LayerId, PianoOutput } from './audio'
import { HARDWARE_CONTROLS } from './hardware'
import type { MidiAccessLike } from './App'
import type { InstrumentPatch } from './stage3'

class FakePianoOutput implements PianoOutput {
  calls: Array<{ kind: 'on' | 'off' | 'all-off'; id?: string; midi?: number; velocity?: number; layers?: LayerId[] }> = []
  configurations: AudioConfiguration[] = []
  stage3Configurations: InstrumentPatch[] = []
  stage3Calls: Array<{ kind: 'on' | 'off'; id: string; midi?: number; routes?: string[] }> = []
  sustainCalls: Array<{ down: boolean; layers: LayerId[] }> = []
  disposed = false

  noteOn(id: string, midi: number, velocity: number, layers: LayerId[] = ['A']) { this.calls.push({ kind: 'on', id, midi, velocity, layers }) }
  noteOff(id: string, _releaseSeconds?: number, layers?: LayerId[]) { this.calls.push({ kind: 'off', id, layers }) }
  setSustain(down: boolean, layers: LayerId[]) { this.sustainCalls.push({ down, layers }) }
  configure(configuration: AudioConfiguration) { this.configurations.push(configuration) }
  configureStage3(patch: InstrumentPatch) { this.stage3Configurations.push(structuredClone(patch)) }
  noteOnStage3(id: string, midi: number, _velocity: number, routes: string[]) { this.stage3Calls.push({ kind: 'on', id, midi, routes }) }
  noteOffStage3(id: string, _releaseSeconds?: number, routes?: string[]) { this.stage3Calls.push({ kind: 'off', id, routes }) }
  allNotesOff() { this.calls.push({ kind: 'all-off' }) }
  dispose() { this.disposed = true }
}

class FallbackPianoOutput extends FakePianoOutput {
  async prepare() { return 'fallback' as const }
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear() })

function mountApp(midiAccessFactory?: () => Promise<MidiAccessLike>) {
  const output = new FakePianoOutput()
  const rendered = render(<App audioOutputFactory={() => output} midiAccessFactory={midiAccessFactory} />)
  return { ...rendered, output }
}

describe('Stage 4 73 surface', () => {
  it('renders the exact E2–E8 73-key hammer action keybed with the measured black and white pattern', async () => {
    const { container } = mountApp()
    await waitFor(() => expect(screen.getByText('Ready · injected test audio output')).toBeInTheDocument())
    const keybed = container.querySelector('[data-key-count="73"]')
    const keys = Array.from(container.querySelectorAll('[data-key-id]'))
    expect(keybed).toHaveAttribute('aria-label', '73-key hammer action keybed, E2 to E8')
    expect(keys).toHaveLength(73)
    expect(keys.filter((key) => key.getAttribute('data-key-color') === 'white')).toHaveLength(43)
    expect(keys.filter((key) => key.getAttribute('data-key-color') === 'black')).toHaveLength(30)
    expect(screen.getByRole('button', { name: 'E2 piano key' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'E8 piano key' })).toBeInTheDocument()
  })

  it('lays out all six sections in the measured order and gives only Program and Synth primary displays', () => {
    const { container } = mountApp()
    const sections = Array.from(container.querySelectorAll('[data-section-id]'))
    expect(sections.map((section) => section.getAttribute('data-section-id'))).toEqual(['performance', 'organ', 'piano', 'program', 'synth', 'effects'])
    expect(sections.map((section) => Number.parseFloat((section as HTMLElement).style.flexBasis))).toEqual([14, 20, 8.5, 12.5, 25, 20])
    expect(container.querySelectorAll('[data-primary-display]')).toHaveLength(2)
    expect(container.querySelector('[data-primary-display="program"]')).toHaveAttribute('aria-label', 'Program OLED, current program and instrument state')
    expect(container.querySelector('[data-primary-display="synth"]')).toHaveAttribute('aria-label', 'Synth OLED showing selected oscillator and envelope')
    expect(within(sections[1] as HTMLElement).getAllByRole('slider', { name: /organ drawbar/i })).toHaveLength(9)
    expect(within(sections[1] as HTMLElement).getAllByLabelText(/organ drawbar/i)).toHaveLength(9)
  })

  it('keeps a stable accessible control inventory and lets decorative controls change presentation only', () => {
    const { container, output } = mountApp()
    expect(container.querySelectorAll('[data-control-id]')).toHaveLength(HARDWARE_CONTROLS.length)
    expect(new Set(Array.from(container.querySelectorAll('[data-control-id]'), (node) => node.getAttribute('data-control-id'))).size).toBe(HARDWARE_CONTROLS.length)
    const control = screen.getByRole('button', { name: 'Percussion On' })
    expect(control).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(control)
    expect(control).toHaveAttribute('aria-pressed', 'true')
    const master = screen.getByRole('slider', { name: 'Master Level' })
    master.focus()
    expect(master).toHaveFocus()
    fireEvent.change(master, { target: { value: '75' } })
    expect(master).toHaveValue('75')
    expect(output.calls).toEqual([])
  })

  it('plays and releases independent pointer notes, including cancel cleanup', () => {
    const { output } = mountApp()
    const e2 = screen.getByRole('button', { name: 'E2 piano key' })
    const f2 = screen.getByRole('button', { name: 'F2 piano key' })
    fireEvent.pointerDown(e2, { pointerId: 7, pointerType: 'touch' })
    fireEvent.pointerDown(f2, { pointerId: 8, pointerType: 'touch' })
    expect(output.calls.filter((call) => call.kind === 'on').map((call) => call.midi)).toEqual([40, 41])
    expect(e2).toHaveAttribute('aria-pressed', 'true')
    fireEvent.pointerUp(e2, { pointerId: 7, pointerType: 'touch' })
    expect(e2).toHaveAttribute('aria-pressed', 'false')
    expect(f2).toHaveAttribute('aria-pressed', 'true')
    fireEvent.pointerCancel(f2, { pointerId: 8, pointerType: 'touch' })
    expect(f2).toHaveAttribute('aria-pressed', 'false')
    expect(output.calls.filter((call) => call.kind === 'off')).toHaveLength(2)
  })

  it('maps computer keys, suppresses repeats, applies Space sustain, and releases every owned note on blur', () => {
    const { output } = mountApp()
    fireEvent.keyDown(window, { code: 'KeyA', key: 'a' })
    fireEvent.keyDown(window, { code: 'KeyA', key: 'a', repeat: true })
    fireEvent.keyDown(window, { code: 'KeyS', key: 's' })
    expect(output.calls.filter((call) => call.kind === 'on')).toHaveLength(2)
    expect(output.calls.filter((call) => call.kind === 'on').map((call) => call.velocity)).toEqual([88, 88])
    fireEvent.keyDown(window, { code: 'Space', key: ' ' })
    fireEvent.keyUp(window, { code: 'KeyA', key: 'a' })
    expect(output.calls.filter((call) => call.kind === 'off')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Sustain pedal' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyUp(window, { code: 'Space', key: ' ' })
    expect(output.calls.filter((call) => call.kind === 'off')).toHaveLength(1)
    fireEvent.keyUp(window, { code: 'KeyS', key: 's' })
    fireEvent(window, new Event('blur'))
    expect(output.calls.filter((call) => call.kind === 'all-off')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Sustain pedal' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('supports MIDI note velocity and sustain CC64 through the injected MIDI boundary', async () => {
    const input: { id: string; state: string; onmidimessage: ((event: { data: Uint8Array }) => void) | null } = { id: 'midi-in', state: 'connected', onmidimessage: null }
    const stateListeners = new Set<(event: { port?: { id?: string; state?: string; type?: string } }) => void>()
    const access: MidiAccessLike = {
      inputs: new Map([['midi-in', input]]),
      addEventListener: (_type, listener) => stateListeners.add(listener),
      removeEventListener: (_type, listener) => stateListeners.delete(listener),
    }
    const { output } = mountApp(async () => access)
    fireEvent.click(screen.getByRole('button', { name: 'Connect MIDI' }))
    await screen.findByText('MIDI connected')
    expect(input.onmidimessage).toBeTypeOf('function')
    input.onmidimessage?.({ data: new Uint8Array([0x92, 60, 109]) })
    expect(output.calls.at(-1)).toMatchObject({ kind: 'on', midi: 60, velocity: 109 })
    input.onmidimessage?.({ data: new Uint8Array([0xb2, 64, 127]) })
    input.onmidimessage?.({ data: new Uint8Array([0x82, 60, 0]) })
    expect(output.calls.filter((call) => call.kind === 'off')).toHaveLength(0)
    input.onmidimessage?.({ data: new Uint8Array([0xb2, 64, 0]) })
    expect(output.calls.filter((call) => call.kind === 'off')).toHaveLength(1)
    act(() => stateListeners.forEach((listener) => listener({ port: { id: 'midi-in', state: 'disconnected', type: 'input' } })))
    expect(screen.getByText('MIDI disconnected')).toBeInTheDocument()
  })

  it('reports denied MIDI access and stops all voices on component cleanup', async () => {
    const { output, unmount } = mountApp(async () => { throw new DOMException('Permission denied', 'NotAllowedError') })
    fireEvent.click(screen.getByRole('button', { name: 'Connect MIDI' }))
    expect(await screen.findByText('MIDI permission denied')).toBeInTheDocument()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'E3 piano key' }), { pointerId: 4 })
    unmount()
    expect(output.calls.some((call) => call.kind === 'all-off')).toBe(true)
    expect(output.disposed).toBe(true)
  })

  it('selects sampled and generated piano types and keeps the active model named on Program', () => {
    const { container, output } = mountApp()
    fireEvent.click(screen.getByRole('button', { name: 'Piano Type Electric' }))
    expect(output.configurations.at(-1)?.pianoType).toBe('Electric')
    expect(container.querySelector('[data-primary-display="program"]')).toHaveTextContent('jRhodes3d Rhodes')
    fireEvent.click(screen.getByRole('button', { name: 'Piano Type Misc' }))
    expect(output.configurations.at(-1)?.pianoType).toBe('Misc')
    expect(container.querySelector('[data-primary-display="program"]')).toHaveTextContent('Mallet Piano')
  })

  it('binds Piano layers, focus, octave, level, and performance controls to the audio configuration', () => {
    const { container, output } = mountApp()
    fireEvent.click(screen.getByRole('button', { name: 'Layer B Enabled' }))
    fireEvent.click(screen.getByRole('button', { name: 'Focus Piano Layer B' }))
    fireEvent.click(screen.getByRole('button', { name: 'Layer B Octave Up' }))
    fireEvent.change(screen.getByRole('slider', { name: 'Layer B Level' }), { target: { value: '65' } })
    fireEvent.click(screen.getByRole('button', { name: 'Keyboard Touch: Medium' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dynamic Compression: Off' }))
    fireEvent.click(screen.getByRole('button', { name: 'Piano Timbre: Off' }))
    fireEvent.click(screen.getByRole('button', { name: 'Piano Unison: Off' }))
    fireEvent.click(screen.getByRole('button', { name: 'Soft Release' }))
    fireEvent.click(screen.getByRole('button', { name: 'String Resonance' }))
    const configuration = output.configurations.at(-1)
    expect(configuration?.layers.B).toMatchObject({ enabled: true, level: 0.65, octave: 1 })
    expect(configuration?.effects.focus).toBe('B')
    expect(configuration?.performance.touch).toBe('Light')
    expect(configuration?.performance.dynComp).toBe(1)
    expect(configuration?.performance.timbre).toBe('Soft')
    expect(configuration?.performance.unison).toBe(1)
    expect(configuration?.performance.softRelease).toBe(true)
    expect(configuration?.performance.stringRes).toBe(true)
    expect(container.querySelector('.piano-state-readout')).toHaveAttribute('aria-label', 'Layer A octave 0, layer B octave 1')
    fireEvent.pointerDown(screen.getByRole('button', { name: 'E2 piano key' }), { pointerId: 23 })
    expect(output.calls.at(-1)).toMatchObject({ kind: 'on', layers: ['A', 'B'] })
  })

  it('honors SUSTPED routing and routes effect focus, group, unit, and bypass state', () => {
    const { output, container } = mountApp()
    const control = (id: string) => container.querySelector(`[data-control-id="${id}"]`) as HTMLButtonElement
    const key = container.querySelector('[data-key-id="key-e2"]') as HTMLButtonElement
    fireEvent.click(control('piano-layer-b'))
    fireEvent.click(screen.getByRole('button', { name: 'Sustain pedal' }))
    fireEvent.pointerDown(key, { pointerId: 24 })
    fireEvent.pointerUp(key, { pointerId: 24 })
    expect(output.sustainCalls).toContainEqual({ down: true, layers: ['A', 'B'] })
    expect(output.calls.filter((call) => call.kind === 'off')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Sustain pedal' }))
    expect(output.calls.filter((call) => call.kind === 'off')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Piano Sustain Pedal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sustain pedal' }))
    fireEvent.pointerDown(key, { pointerId: 25 })
    fireEvent.pointerUp(key, { pointerId: 25 })
    expect(output.calls.filter((call) => call.kind === 'off')).toHaveLength(2)

    const effect1Depth = container.querySelector('[data-control-id="effects-effect-1-depth"] input') as HTMLInputElement
    fireEvent.change(effect1Depth, { target: { value: '90' } })
    fireEvent.click(control('effects-focus-b'))
    expect(effect1Depth).toHaveValue('44')
    fireEvent.click(control('effects-effect-1-type'))
    fireEvent.click(control('effects-effect-1-on'))
    expect(output.configurations.at(-1)?.effects.focus).toBe('B')
    expect(output.configurations.at(-1)?.effects.units.B.mod1).toMatchObject({ type: 'Tremolo', on: true })
    fireEvent.click(control('effects-piano-group'))
    fireEvent.change(effect1Depth, { target: { value: '90' } })
    expect(output.configurations.at(-1)?.effects.units.A.mod1.amount).toBe(0.9)
    expect(output.configurations.at(-1)?.effects.units.B.mod1.amount).toBe(0.9)
    fireEvent.click(control('effects-effects-on'))
    expect(output.configurations.at(-1)?.effects.allBypass).toBe(true)
  })

  it('routes sustain only to enabled Piano layers', () => {
    const { output } = mountApp()
    fireEvent.click(screen.getByRole('button', { name: 'Sustain pedal' }))
    expect(output.sustainCalls).toEqual([{ down: true, layers: ['A'] }])
    fireEvent.click(screen.getByRole('button', { name: 'Sustain pedal' }))
    expect(output.sustainCalls.at(-1)).toEqual({ down: false, layers: ['A'] })
  })

  it('reports a labeled generated fallback and keeps note input playable when sample loading fails', async () => {
    const output = new FallbackPianoOutput()
    render(<App audioOutputFactory={() => output} />)
    expect(await screen.findByText('Fallback · Grand sample files could not load; generated synthesis remains playable')).toBeInTheDocument()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'E2 piano key' }), { pointerId: 26 })
    expect(output.calls.at(-1)).toMatchObject({ kind: 'on', midi: 40 })
  })

  it('selects a saved piano voicing and stores named programs with all supported patch state', async () => {
    const { container } = mountApp()
    const slider = (id: string) => container.querySelector(`[data-control-id="${id}"] input`) as HTMLInputElement
    const button = (id: string) => container.querySelector(`[data-control-id="${id}"]`) as HTMLButtonElement
    fireEvent.change(slider('piano-model-selector'), { target: { value: '100' } })
    await waitFor(() => expect(container.querySelector('.program-oled small')).toHaveTextContent('Bright'))
    fireEvent.click(button('piano-type-electric'))
    await waitFor(() => expect(container.querySelector('.program-oled small')).toHaveTextContent('jRhodes3d Rhodes · Studio'))

    fireEvent.click(button('program-program-2'))
    await waitFor(() => expect(container.querySelector('.program-oled strong')).toHaveTextContent('Upright Ballad'))
    fireEvent.click(button('program-store-as'))
    const name = container.querySelector('[aria-label="Program name"]') as HTMLInputElement
    fireEvent.change(name, { target: { value: 'Warm Keys' } })
    fireEvent.click(container.querySelector('.program-name-form button[type="submit"]') as HTMLButtonElement)
    fireEvent.click(button('program-program-3'))
    fireEvent.click(button('program-store'))
    await waitFor(() => expect(container.querySelector('.program-oled strong')).toHaveTextContent('Warm Keys'))
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('stagebench-stage4-state-v1') ?? 'null') as { programs: Array<{ name: string; patch: { piano: AudioConfiguration } }> } | null
      expect(saved?.programs[2]?.name).toBe('Warm Keys')
      expect(saved?.programs[2]?.patch.piano).toMatchObject({ pianoType: 'Upright', modelVariant: 0 })
    })
  })

it('discards edits on program change and auto-saves Live slot changes', async () => {
    const { container, output } = mountApp()
    const button = (id: string) => container.querySelector(`[data-control-id="${id}"]`) as HTMLButtonElement
    const slider = (id: string) => container.querySelector(`[data-control-id="${id}"] input`) as HTMLInputElement
    fireEvent.change(slider('synth-layer-a-level'), { target: { value: '88' } })
    await waitFor(() => expect(container.querySelector('.program-oled strong')).toHaveTextContent('Grand Piano · E'))
    fireEvent.click(button('program-program-2'))
    await waitFor(() => expect(container.querySelector('.program-oled strong')).toHaveTextContent('Upright Ballad'))
    fireEvent.click(button('program-live-mode'))
    await waitFor(() => expect(container.querySelector('.program-oled')).toHaveTextContent('LIVE 1'))
    fireEvent.click(button('organ-layer-a'))
    await waitFor(() => expect(container.querySelector('.organ-state-readout')).toHaveTextContent('B3'))
    const e2 = screen.getByRole('button', { name: 'E2 piano key' })
    fireEvent.pointerDown(e2, { pointerId: 44 })
    expect(output.stage3Calls.some((call) => call.kind === 'on' && call.routes?.includes('organ-A'))).toBe(true)
    fireEvent.pointerUp(e2, { pointerId: 44 })
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('stagebench-stage4-state-v1') ?? 'null') as { liveSlots: Array<{ patch: InstrumentPatch }> } | null
      expect(saved?.liveSlots[0]?.patch.organ.layers.A.enabled).toBe(true)
    })
  })

  it('captures panel morph assignments, interpolates an Organ destination, and clears them', async () => {
    const { container, output } = mountApp()
    const button = (id: string) => container.querySelector(`[data-control-id="${id}"]`) as HTMLButtonElement
    const slider = (id: string) => container.querySelector(`[data-control-id="${id}"] input`) as HTMLInputElement
    fireEvent.click(button('program-morph-wheel'))
    fireEvent.change(slider('organ-layer-a-level'), { target: { value: '40' } })
    await waitFor(() => expect(output.stage3Configurations.at(-1)?.morph.assignments.Wheel).toHaveLength(1))
    fireEvent.change(slider('performance-modulation-wheel'), { target: { value: '100' } })
    await waitFor(() => expect(output.stage3Configurations.at(-1)?.organ.layers.A.level).toBeCloseTo(0.72))
    fireEvent.click(container.querySelector('.program-tools-trigger') as HTMLButtonElement)
    const clearWheel = Array.from(document.body.querySelectorAll('.program-editors button')).find((item) => item.textContent === 'Clear Wheel') as HTMLButtonElement
    fireEvent.click(clearWheel)
    await waitFor(() => expect(output.stage3Configurations.at(-1)?.morph.assignments.Wheel).toHaveLength(0))
  })

  it('edits split points, crossfades, zones, and independent layer scenes from the panel', async () => {
    const { container, output } = mountApp()
    const button = (id: string) => container.querySelector(`[data-control-id="${id}"]`) as HTMLButtonElement
    fireEvent.click(button('program-split'))
    fireEvent.click(container.querySelector('.program-tools-trigger') as HTMLButtonElement)
    fireEvent.change(document.body.querySelector('[aria-label="Split point 1"]') as HTMLSelectElement, { target: { value: 'F3' } })
    fireEvent.change(document.body.querySelector('[aria-label="Split crossfade 1"]') as HTMLSelectElement, { target: { value: '6' } })
    fireEvent.change(document.body.querySelector('[aria-label="Zone assignment layer"]') as HTMLSelectElement, { target: { value: 'synth-C' } })
    fireEvent.change(document.body.querySelector('[aria-label="Layer zone start"]') as HTMLSelectElement, { target: { value: '1' } })
    await waitFor(() => expect(output.stage3Configurations.at(-1)?.splits.points[0]).toMatchObject({ note: 'F3', crossfade: 6 }))
    expect(container.querySelector('[data-split-note="F3"]')).toBeInTheDocument()
    expect(output.stage3Configurations.at(-1)?.synth.layers.C.zoneStart).toBe(1)
    fireEvent.click(document.body.querySelector('.program-editors header button') as HTMLButtonElement)
    fireEvent.click(button('organ-layer-a'))
    fireEvent.click(button('program-layer-scene'))
    await waitFor(() => expect(output.stage3Configurations.at(-1)?.scenes.active).toBe('II'))
    expect(output.stage3Configurations.at(-1)?.organ.layers.A.enabled).toBe(false)
    fireEvent.click(button('program-layer-scene'))
    await waitFor(() => expect(output.stage3Configurations.at(-1)?.organ.layers.A.enabled).toBe(true))
  })

  it('keeps the chassis complete and fits the two required viewport proportions without a marketing hero', () => {
    const { container } = mountApp()
    expect(container.querySelector('h1')).not.toBeInTheDocument()
    const instrument = container.querySelector('.instrument')
    expect(instrument).toHaveAttribute('data-instrument', 'stage-4-73')
    expect(instrument).toHaveClass('instrument')
    expect(container.querySelector('.keybed')).toBeInTheDocument()
    expect(container.querySelector('.instrument-top-rail')).toBeInTheDocument()
    expect(container.querySelector('.deck-front-rail')).toBeInTheDocument()
  })
})
