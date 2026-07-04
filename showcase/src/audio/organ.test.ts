import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { fakeAssetBoundary, fakeAudioBoundary, FakeGain, FakeOscillator } from '../test/fakes'
import { renderApp } from '../test/renderApp'
import { InstrumentStore } from '../state/instrument'
import { PianoEngine } from './engine'

/**
 * organ.engine / organ.models-drawbars / organ.rotary — state + graph tests
 * against fakes (rendered-audio proof lives in render-organ.test.ts).
 *
 * The Piano section is switched off in the engine-level tests so voice
 * counts and node inspection reflect the organ alone.
 */
function makeSystem() {
  const setup = fakeAudioBoundary()
  const store = new InstrumentStore()
  const engine = new PianoEngine(setup.boundary, { assets: fakeAssetBoundary() })
  engine.attachStore(store)
  store.setPianoSectionOn(false)
  store.setOrganSectionOn(true)
  return { ...setup, store, engine }
}

/** Oscillators created by the next call, minus everything already present. */
function newOscillators(context: { oscillators(): FakeOscillator[] }, run: () => void): FakeOscillator[] {
  const before = context.oscillators().length
  run()
  return context.oscillators().slice(before)
}

describe('organ.engine — lifecycle, layers, pedals', () => {
  it('the organ only sounds while its section is on, per enabled layer', () => {
    const { engine, store } = makeSystem()
    store.setOrganSectionOn(false)
    engine.ensureStarted()
    engine.noteOn(60, 0.8)
    expect(engine.layerVoiceCount('A', 'organ')).toBe(0)
    store.setOrganSectionOn(true)
    engine.noteOn(62, 0.8)
    expect(engine.layerVoiceCount('A', 'organ')).toBe(1)
    expect(engine.layerVoiceCount('B', 'organ')).toBe(0) // layer B off by default
    store.toggleOrganLayerEnabled('B')
    engine.noteOn(64, 0.8)
    expect(engine.layerVoiceCount('A', 'organ')).toBe(2)
    expect(engine.layerVoiceCount('B', 'organ')).toBe(1)
  })

  it('organ voices stop with a short declick release and clean up their nodes', () => {
    const { engine, timers, getContext } = makeSystem()
    engine.ensureStarted()
    // Snapshot only the voice's oscillators: the scanner LFOs run standing.
    const voiceOscs = newOscillators(getContext()!, () => engine.noteOn(60, 0.8))
    expect(engine.activeVoiceCount()).toBe(1)
    engine.noteOff(60)
    timers.advance(200) // organ release ≈ 20 ms + cleanup grace
    expect(engine.activeVoiceCount()).toBe(0)
    expect(voiceOscs.length).toBeGreaterThan(0)
    expect(voiceOscs.every((osc) => osc.stopped)).toBe(true)
  })

  it('organ pitch is not velocity sensitive (fixed-level voice envelope)', () => {
    const { engine, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    const peakFor = (midi: number, velocity: number) => {
      const before = context.nodes.length
      engine.noteOn(midi, velocity)
      const gains = context.nodes.slice(before).filter((n): n is FakeGain => n instanceof FakeGain)
      const peak = Math.max(...gains.map((g) => g.gain.maxScheduled()))
      engine.noteOff(midi)
      return peak
    }
    expect(peakFor(60, 0.1)).toBeCloseTo(peakFor(64, 0.95), 6)
  })

  it('octave shift moves the whole partial stack by an octave', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    const lowest = (oscs: FakeOscillator[]) => Math.min(...oscs.map((o) => o.frequency.value))
    const first = newOscillators(context, () => engine.noteOn(60, 0.8))
    engine.noteOff(60)
    store.shiftOrganOctave('A', 1)
    const shifted = newOscillators(context, () => engine.noteOn(60, 0.8))
    expect(lowest(shifted)).toBeCloseTo(lowest(first) * 2, 3)
  })

  it('organ sustain follows the organ SUSTPED routing', () => {
    const { engine, store, timers } = makeSystem()
    engine.setSustain(1)
    engine.noteOn(60, 0.8)
    engine.noteOff(60)
    timers.advance(500)
    expect(engine.activeVoiceCount()).toBe(1) // held: organ SUSTPED defaults on
    store.toggleOrganSustped()
    timers.advance(500)
    expect(engine.activeVoiceCount()).toBe(0) // routing off releases the hold
    engine.setSustain(0)
  })

  it('organ PSTICK gates the pitch stick for organ voices', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    const oscs = newOscillators(context, () => engine.noteOn(60, 0.8))
    store.toggleOrganPstick() // on -> off
    engine.setPitchBend(2)
    expect(oscs.every((o) => Math.abs(o.detune.value) < 20)).toBe(true) // base detunes only
    store.toggleOrganPstick() // off -> on: bend reapplies to sounding voices
    expect(oscs.some((o) => o.detune.value >= 180)).toBe(true)
    engine.setPitchBend(0)
  })
})

describe('organ.models-drawbars — recipes and live registration', () => {
  it('drawbar moves retune sounding voices immediately', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    for (let i = 0; i < 9; i++) store.setOrganDrawbar(i, i === 0 ? 8 : 0) // 16' only
    const before = context.nodes.length
    engine.noteOn(60, 0.8)
    const partialGains = context.nodes.slice(before).filter((n): n is FakeGain => n instanceof FakeGain)
    const values = () => partialGains.map((g) => +g.gain.value.toFixed(6))
    const silentBefore = values()
    store.setOrganDrawbar(5, 8) // pull the 2' drawbar mid-note
    const after = values()
    expect(after).not.toEqual(silentBefore)
    expect(Math.max(...after)).toBeGreaterThan(Math.max(...silentBefore.slice(1)))
  })

  it('B3 partials are all sines; Farf uses buzzy register waveforms', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    const b3 = newOscillators(context, () => engine.noteOn(60, 0.8))
    expect(b3.length).toBeGreaterThanOrEqual(9)
    expect(b3.every((osc) => osc.type === 'sine')).toBe(true)
    engine.noteOff(60)
    store.cycleOrganModel() // B3 -> Vox
    store.cycleOrganModel() // Vox -> Farf
    for (let i = 0; i < 9; i++) store.setOrganDrawbar(i, 8) // all registers on
    const farf = newOscillators(context, () => engine.noteOn(62, 0.8))
    expect(farf.some((osc) => osc.type === 'square')).toBe(true)
    expect(farf.some((osc) => osc.type === 'sawtooth')).toBe(true)
  })

  it('B3 Bass only voices partials for drawbars 0+2 (16prime+8prime), even with every drawbar out', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    store.cycleOrganModel() // B3 -> Vox
    store.cycleOrganModel() // Vox -> Farf
    store.cycleOrganModel() // Farf -> Pipe1
    store.cycleOrganModel() // Pipe1 -> B3Bass
    expect(store.getState().organ.layers.A.model).toBe('B3Bass')
    for (let i = 0; i < 9; i++) store.setOrganDrawbar(i, 8) // pull every drawbar out
    const oscs = newOscillators(context, () => engine.noteOn(60, 0.8))
    // Only the 16' (drawbar 0, 0.5x) and 8' (drawbar 2, 1x) partials exist —
    // never more than two oscillators for the tonewheel stack (percussion is
    // unavailable on B3 Bass).
    expect(oscs.length).toBe(2)
    expect(oscs.every((osc) => osc.type === 'sine')).toBe(true)
    // Derive the fundamental from the lower (16', 0.5x) partial rather than
    // hardcoding a frequency constant.
    const fundamental = Math.min(...oscs.map((o) => o.frequency.value)) * 2
    const ratios = oscs.map((osc) => osc.frequency.value / fundamental).sort((a, b) => a - b)
    expect(ratios[0]).toBeCloseTo(0.5, 3) // 16'
    expect(ratios[1]).toBeCloseTo(1, 3) // 8'
    // Drawbar 1 (5⅓', ratio 1.5) must not respond even though it's pulled out.
    expect(oscs.some((osc) => Math.abs(osc.frequency.value / fundamental - 1.5) < 0.01)).toBe(false)
  })

  it('layers A (B3) and B (Vox) can run different models simultaneously: A stays all sine, B includes sawtooth', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    expect(store.getState().organ.layers.A.model).toBe('B3')
    store.setOrganFocusedLayer('B')
    store.cycleOrganModel() // B3 -> Vox
    expect(store.getState().organ.layers.B.model).toBe('Vox')
    expect(store.getState().organ.layers.A.model).toBe('B3') // A untouched by focusing/cycling B
    store.toggleOrganLayerEnabled('B')
    expect(store.getState().organ.layers.A.enabled).toBe(true)
    expect(store.getState().organ.layers.B.enabled).toBe(true)

    // Layer A's voice starts before layer B's within one noteOn (engine.ts
    // dispatch order), so the first B3_RATIOS.length (9) new oscillators are
    // A's, and everything after is B's Vox partials.
    const oscs = newOscillators(context, () => engine.noteOn(60, 0.8))
    const layerA = oscs.slice(0, 9)
    const layerB = oscs.slice(9)
    expect(layerA.length).toBe(9)
    expect(layerA.every((osc) => osc.type === 'sine')).toBe(true)
    expect(layerB.length).toBeGreaterThan(0)
    expect(layerB.some((osc) => osc.type === 'sawtooth')).toBe(true)
  })

  it("Pipe 2's oscillator types differ from Pipe 1 (brighter triangle ranks)", () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    for (let i = 0; i < 9; i++) store.setOrganDrawbar(i, 8)
    store.cycleOrganModel() // B3 -> Vox
    store.cycleOrganModel() // Vox -> Farf
    store.cycleOrganModel() // Farf -> Pipe1
    const context = getContext()!
    const pipe1 = newOscillators(context, () => engine.noteOn(60, 0.8))
    engine.noteOff(60)
    expect(pipe1.every((osc) => osc.type === 'sine')).toBe(true)
    store.cycleOrganModel() // Pipe1 -> B3Bass
    store.cycleOrganModel() // B3Bass -> Pipe2
    expect(store.getState().organ.layers.A.model).toBe('Pipe2')
    const pipe2 = newOscillators(context, () => engine.noteOn(62, 0.8))
    expect(pipe2.some((osc) => osc.type === 'triangle')).toBe(true)
    expect(pipe2.some((osc) => osc.type === 'sine')).toBe(true)
  })

  it('B3 percussion is single-triggered and follows its harmonic/volume/decay flags', () => {
    const { engine, store, timers, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    store.toggleOrganPercussion('on')
    const first = newOscillators(context, () => engine.noteOn(60, 0.8))
    const legato = newOscillators(context, () => engine.noteOn(64, 0.8)) // 60 still held
    expect(first.length).toBe(legato.length + 1) // percussion only on the first stroke
    engine.noteOff(60)
    engine.noteOff(64)
    timers.advance(300)
    // Third-harmonic percussion: the extra oscillator sits at 3x the fundamental.
    store.toggleOrganPercussion('third')
    const withThird = newOscillators(context, () => engine.noteOn(60, 0.8))
    const fundamental = Math.min(...withThird.map((o) => o.frequency.value)) * 2 // 16' is 0.5x
    expect(withThird.some((o) => Math.abs(o.frequency.value - fundamental * 3) < 1)).toBe(true)
    engine.noteOff(60)
  })

  it('percussion stays suppressed while a pedal-sustained organ chord is still SOUNDING (manual p. 20)', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    store.toggleOrganPercussion('on')
    engine.noteOn(60, 0.8)
    engine.setSustain(true)
    engine.noteOff(60) // key up, but the pedal keeps the note sounding
    const restruck = newOscillators(context, () => engine.noteOn(64, 0.8))
    engine.noteOff(64)
    engine.setSustain(false)
    // Fresh strike with nothing sounding: percussion returns — one extra oscillator.
    const clean = newOscillators(context, () => engine.noteOn(60, 0.8))
    expect(clean.length).toBe(restruck.length + 1)
    engine.noteOff(60)
  })

  it('Percussion POLY (Shift + Percussion Volume) lets a legato addition retrigger its own percussion partial', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    store.toggleOrganPercussion('on')
    store.toggleOrganPercussion('poly')
    expect(store.getState().organ.percussion.poly).toBe(true)
    const first = newOscillators(context, () => engine.noteOn(60, 0.8))
    const legato = newOscillators(context, () => engine.noteOn(64, 0.8)) // 60 still held
    // With POLY on, the second (legato) key-down also gets a percussion oscillator.
    expect(legato.length).toBe(first.length)
    engine.noteOff(60)
    engine.noteOff(64)
  })

  it('the vib/chorus selector cycles the six scanner positions', () => {
    const { store } = makeSystem()
    const seen = [store.getState().organ.vibratoType]
    for (let i = 0; i < 6; i++) {
      store.cycleOrganVibratoType()
      seen.push(store.getState().organ.vibratoType)
    }
    expect(seen).toEqual(['C3', 'V3', 'C1', 'V1', 'C2', 'V2', 'C3'])
    store.toggleOrganVibrato()
    expect(store.getState().organ.layers.A.vibrato).toBe(true) // per-layer on/off
  })
})

describe('organ.rotary — shared rotary routing', () => {
  it('the ORGAN rotary source crossfades the shared chain output into the single rotary instance', () => {
    const { engine, store } = makeSystem()
    engine.ensureStarted()
    const { organChainToMaster, organChainToRotary } = engine.diagnostics()
    expect(organChainToMaster!.gain.value).toBeGreaterThan(0.5)
    expect(organChainToRotary!.gain.value).toBeLessThan(0.01)
    store.toggleOrganRotary()
    expect(organChainToRotary!.gain.value).toBeGreaterThan(0.5)
    expect(organChainToMaster!.gain.value).toBeLessThan(0.01)
  })
})

describe('organ panel — canonical writes with display and LED feedback', () => {
  it('the ON button, drawbars, model and SUSTPED/PSTICK all work from the real panel', () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Organ Section On' }))
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Organ Section On/)

    const drawbar = screen.getByRole('slider', { name: 'Drawbar 9 (1′)' })
    fireEvent.keyDown(drawbar, { key: 'End' })
    expect(drawbar.getAttribute('aria-valuenow')).toBe('8')
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Drawbar 9: 8/)

    fireEvent.click(screen.getByRole('button', { name: 'Organ Model Select' }))
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Organ A: Vox/)

    const shift = screen.getByRole('button', { name: 'Shift/Exit' })
    fireEvent.click(shift)
    fireEvent.click(screen.getByRole('button', { name: 'Organ Layer A On/Off' }))
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Organ SUSTPED Off/)
    fireEvent.click(screen.getByRole('button', { name: 'Organ Layer B On/Off' }))
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Organ PSTICK Off/)
    fireEvent.click(shift)

    fireEvent.click(screen.getByRole('button', { name: 'Rotary Organ Source' }))
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Organ → Rotary On/)
  })
})
