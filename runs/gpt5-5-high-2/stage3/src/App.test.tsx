import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { blackKeyCount, createControlState, decorativeControls, keyboard, sections, whiteKeyCount } from './hardware'
import { ampEqTypes, createPianoEngine, mod1Types, mod2Types, pianoTypes, reverbTypes, sampleLibrary, type EffectUnit } from './pianoEngine'
import {
  applyMorph,
  applyStage3Control,
  arpeggiatorSteps,
  clearMorph,
  createStage3State,
  filterTypes,
  integrationSnapshot,
  layerRouteGain,
  lfoWaveforms,
  organModels,
  panic,
  renderOrganProbe,
  renderSynthProbe,
  selectProgram,
  splitPositions,
  storeAsProgram,
  storeProgram,
  switchScene,
  synthWaveforms,
  unsupportedDeclarations,
  zoneForMidi,
} from './stage3System'

class FakeAudioParam {
  value = 0
  setValueAtTime(value: number) {
    this.value = value
  }
  exponentialRampToValueAtTime(value: number) {
    this.value = value
  }
  cancelScheduledValues() {}
}

class FakeNode {
  gain = new FakeAudioParam()
  frequency = new FakeAudioParam()
  detune = new FakeAudioParam()
  Q = new FakeAudioParam()
  threshold = new FakeAudioParam()
  knee = new FakeAudioParam()
  ratio = new FakeAudioParam()
  attack = new FakeAudioParam()
  release = new FakeAudioParam()
  type = 'triangle'
  connected: unknown[] = []
  stopped = false
  connect(target: unknown) {
    this.connected.push(target)
  }
  disconnect() {
    this.connected = []
  }
  start() {}
  stop() {
    this.stopped = true
  }
}

class FakeAudioContext {
  currentTime = 1
  destination = {}
  state = 'running'
  createOscillator() {
    return new FakeNode() as unknown as OscillatorNode
  }
  createGain() {
    return new FakeNode() as unknown as GainNode
  }
  createBiquadFilter() {
    return new FakeNode() as unknown as BiquadFilterNode
  }
  createDynamicsCompressor() {
    return new FakeNode() as unknown as DynamicsCompressorNode
  }
  resume = vi.fn()
  close = vi.fn()
}

const completeSystemFunctional = new Set([
  'performance.master-level',
  'performance.mod-wheel',
  'performance.organ-level',
  'performance.octave-down',
  'performance.octave-up',
  'performance.transpose',
  ...decorativeControls.filter((control) => control.section === 'piano' || control.section === 'effects' || control.section === 'organ' || control.section === 'program' || control.section === 'synth').map((control) => control.id),
])
completeSystemFunctional.delete('effects.delay-tempo')
completeSystemFunctional.delete('program.morph-aftertouch')

function energy(samples: Float32Array) {
  return samples.reduce((total, sample) => total + Math.abs(sample), 0)
}

function distance(left: Float32Array, right: Float32Array) {
  const length = Math.min(left.length, right.length)
  let sum = 0
  for (let i = 0; i < length; i += 1) {
    const leftSample = Number.isFinite(left[i]) ? left[i] : 0
    const rightSample = Number.isFinite(right[i]) ? right[i] : 0
    sum += Math.abs(leftSample - rightSample)
  }
  return sum / length
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Nord Stage 4 73 surface', () => {
  it('models the exact Stage 4 73 E-to-E keybed and section layout', () => {
    expect(keyboard).toHaveLength(73)
    expect(whiteKeyCount).toBe(43)
    expect(blackKeyCount).toBe(30)
    expect(keyboard[0]).toMatchObject({ note: 'E1', midi: 28, black: false })
    expect(keyboard.at(-1)).toMatchObject({ note: 'E7', midi: 100, black: false })
    expect(sections.map((section) => section.id)).toEqual(['performance', 'organ', 'piano', 'program', 'synth', 'effects'])
    expect(sections.map((section) => section.fraction)).toEqual([0.13, 0.21, 0.15, 0.09, 0.21, 0.21])
    expect(sections.filter((section) => section.hasOled).map((section) => section.id)).toEqual(['program', 'synth'])
  })

  it('renders the complete visible surface with required landmarks and stable controls', () => {
    render(<App />)
    expect(screen.getByLabelText(/Nord Stage 4 73 Phase 3 complete system recreation/i)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /piano key/i })).toHaveLength(73)
    expect(screen.getByLabelText(/Program \/ Morph primary OLED/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Synth primary OLED/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Organ primary OLED/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Nine functional organ drawbars/i)).toBeInTheDocument()

    for (const control of decorativeControls) {
      const suffix = completeSystemFunctional.has(control.id) ? 'control' : 'decorative control'
      const button = screen.getByRole('button', { name: `${control.label} ${suffix}` })
      expect(button).toHaveAttribute('data-control-id', control.id)
    }
  }, 10000)

  it('moves controls accessibly without changing their stable inventory', () => {
    render(<App />)
    const state = createControlState()
    expect(Object.keys(state)).toHaveLength(decorativeControls.length)
    const dial = screen.getByRole('button', { name: /Program Dial control/i })
    expect(dial).toHaveAttribute('aria-valuenow', '42')
    fireEvent.keyDown(dial, { key: 'ArrowRight' })
    expect(dial).toHaveAttribute('aria-valuenow', '50')
    const live = screen.getByRole('button', { name: /Live Mode control/i })
    fireEvent.pointerDown(live, { pointerId: 9 })
    expect(live).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('piano key interactions', () => {
  it('supports pointer note press, release, cancel, and blur cleanup presentation', () => {
    render(<App />)
    const key = screen.getByRole('button', { name: 'C4 piano key' })
    fireEvent.pointerDown(key, { pointerId: 1, clientY: 20 })
    expect(key).toHaveAttribute('aria-pressed', 'true')
    fireEvent.pointerCancel(key, { pointerId: 1 })
    expect(key).toHaveAttribute('aria-pressed', 'false')

    fireEvent.pointerDown(key, { pointerId: 2, clientY: 20 })
    fireEvent.blur(window)
    expect(key).toHaveAttribute('aria-pressed', 'false')
  })

  it('supports mapped computer keys with repeat suppression and sustain cleanup', () => {
    render(<App />)
    const c3 = screen.getByRole('button', { name: 'C3 piano key' })
    fireEvent.keyDown(window, { key: 'a', repeat: false })
    expect(c3).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(window, { key: 'a', repeat: true })
    expect(c3).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(window, { key: ' ', repeat: false })
    fireEvent.keyUp(window, { key: 'a' })
    expect(c3).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('piano-status')).toHaveTextContent(/sustain held/i)
    fireEvent.keyUp(window, { key: ' ' })
    expect(screen.getByTestId('piano-status')).toHaveTextContent(/stage 4 system ready/i)
  })

  it('keeps the chassis inspectable within the canonical document at desktop and narrow widths', () => {
    render(<App />)
    const shell = screen.getByLabelText(/Nord Stage 4 73 Phase 3 complete system recreation/i)
    expect(shell).toHaveClass('instrument-shell')
    expect(within(shell).getByLabelText(/73 key E to E hammer action keybed/i)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/hero|buy now|fully modeled effects/i)
  })
})

describe('basic generated piano engine', () => {
  it('has a deterministic note lifecycle with release, sustain, polyphony, and voice stealing', () => {
    vi.useFakeTimers()
    const status = vi.fn()
    const engine = createPianoEngine({ context: new FakeAudioContext() as unknown as AudioContext, maxVoices: 2, onStatus: status })
    engine.prepare()
    engine.noteOn(60, 0.2, 'one')
    engine.noteOn(64, 1, 'two')
    expect(engine.getSnapshot()).toMatchObject({ activeVoices: 2, sustain: false, stolenVoices: 0 })
    engine.noteOn(67, 0.8, 'three')
    expect(engine.getSnapshot().stolenVoices).toBe(1)
    engine.setSustain(true)
    engine.noteOff(64, 'two')
    expect(engine.getSnapshot().sustain).toBe(true)
    engine.setSustain(false)
    engine.allNotesOff()
    vi.advanceTimersByTime(1000)
    expect(engine.getSnapshot().activeVoices).toBe(0)
  })

  it('reports a truthful fallback when no browser audio context exists', () => {
    const originalAudioContext = window.AudioContext
    const originalWebkitAudioContext = window.webkitAudioContext
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined })
    Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: undefined })
    const engine = createPianoEngine()
    engine.prepare()
    expect(engine.getSnapshot().status).toMatchObject({ state: 'fallback' })
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: originalAudioContext })
    Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: originalWebkitAudioContext })
  })
})

describe('phase 2 piano library, layers, and effects', () => {
  it('declares six playable piano types and truthful generated provenance for the three sample-style sets', () => {
    expect(pianoTypes).toEqual(['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'])
    expect(sampleLibrary.map((entry) => entry.type)).toEqual(['Grand', 'Upright', 'Electric'])
    for (const entry of sampleLibrary) {
      expect(entry.source).toMatch(/generated.*not a recording/i)
      expect(entry.roots.length).toBeGreaterThanOrEqual(9)
      expect(entry.velocities).toEqual(['soft', 'medium', 'hard'])
    }

    const engine = createPianoEngine({ context: new FakeAudioContext() as unknown as AudioContext })
    const renders = pianoTypes.map((type) => {
      engine.updateLayer('A', { type })
      return engine.renderProbe({ seconds: 0.35 })
    })
    for (let i = 1; i < renders.length; i += 1) {
      expect(distance(renders[0], renders[i])).toBeGreaterThan(0.003)
    }
  })

  it('owns voices per enabled layer with level, octave, focus, sustain-pedal routing, and cleanup', () => {
    vi.useFakeTimers()
    const engine = createPianoEngine({ context: new FakeAudioContext() as unknown as AudioContext, maxVoices: 8 })
    engine.prepare()
    engine.updateLayer('B', { enabled: true, focused: true, level: 0.5, octave: 12, sustainPedal: false })
    engine.noteOn(60, 0.8, 'kbd')
    expect(engine.getSnapshot().activeVoices).toBe(2)
    expect(engine.getSnapshot().effects.focusedLayer).toBe('B')
    engine.setSustain(true)
    engine.noteOff(60, 'kbd')
    vi.advanceTimersByTime(650)
    expect(engine.getSnapshot().activeVoices).toBe(1)
    engine.setSustain(false)
    vi.advanceTimersByTime(650)
    expect(engine.getSnapshot().activeVoices).toBe(0)
  })

  it('measurably changes rendered audio for velocity controls and master level', () => {
    const engine = createPianoEngine({ context: new FakeAudioContext() as unknown as AudioContext })
    const base = engine.renderProbe({ velocity: 0.35 })
    engine.updatePerformance({ kbTouch: 'Light' })
    const light = engine.renderProbe({ velocity: 0.35 })
    engine.updatePerformance({ dynComp: '3' })
    const compressed = engine.renderProbe({ velocity: 0.35 })
    engine.updatePerformance({ timbre: 'Bright' })
    const bright = engine.renderProbe({ velocity: 0.35 })
    engine.updatePerformance({ unison: '3' })
    const unison = engine.renderProbe({ velocity: 0.35 })
    engine.updatePerformance({ softRelease: true })
    const softRelease = engine.renderProbe({ velocity: 0.35 })
    engine.updatePerformance({ stringRes: true })
    const stringRes = engine.renderProbe({ velocity: 0.35 })
    engine.updatePerformance({ masterLevel: 0.2 })
    const quiet = engine.renderProbe({ velocity: 0.35 })

    expect(energy(light)).toBeGreaterThan(energy(base))
    expect(distance(compressed, light)).toBeGreaterThan(0.001)
    expect(distance(bright, compressed)).toBeGreaterThan(0.001)
    expect(distance(unison, bright)).toBeGreaterThan(0.001)
    expect(distance(softRelease, unison)).toBeGreaterThan(0.00025)
    expect(distance(stringRes, softRelease)).toBeGreaterThan(0.0005)
    expect(energy(quiet)).toBeLessThan(energy(stringRes))
  })

  it('builds one graph with layer buses, ordered effects, master path, and cleanup', () => {
    vi.useFakeTimers()
    const context = new FakeAudioContext() as unknown as AudioContext
    const engine = createPianoEngine({ context })
    engine.prepare()
    engine.updateLayer('B', { enabled: true })
    engine.noteOn(64, 0.8, 'graph')
    const snapshot = engine.getSnapshot()
    expect(snapshot.graph).toMatchObject({ contextCount: 1, destinationCount: 1, layerBuses: 2, masterLimiter: true })
    expect(snapshot.graph.order).toEqual([
      'Layer source',
      'Mod 1',
      'Mod 2',
      'Delay',
      'Amp Sim/EQ or Filter',
      'Compressor',
      'Reverb',
      'Rotary when routed',
      'Layer level',
      'Master gain/limiter',
      'Destination',
    ])
    engine.dispose()
    vi.advanceTimersByTime(500)
    expect(engine.getSnapshot().activeVoices).toBe(0)
  })

  it('routes focus/group/global/bypass and every effect unit/type across rendered audio', () => {
    const engine = createPianoEngine({ context: new FakeAudioContext() as unknown as AudioContext })
    const base = engine.renderProbe({ seconds: 0.55 })
    const unitCases: Array<[EffectUnit, number]> = [
      ['mod1', mod1Types.length],
      ['mod2', mod2Types.length],
      ['delay', 1],
      ['ampEq', ampEqTypes.length],
      ['compressor', 1],
      ['reverb', reverbTypes.length],
    ]

    for (const [unit, typeCount] of unitCases) {
      for (let typeIndex = 0; typeIndex < typeCount; typeIndex += 1) {
        engine.updateEffects((current) => ({
          ...current,
          allBypass: false,
          chains: {
            ...current.chains,
            A: {
              ...current.chains.A,
              [unit]: { ...current.chains.A[unit], on: true, typeIndex, amount: 0.76, mix: 0.62, feedback: 0.48, drive: 0.65 },
            },
          },
        }))
        expect(distance(base, engine.renderProbe({ seconds: 0.55 }))).toBeGreaterThan(0.0005)
      }
    }

    engine.updateEffects((current) => ({ ...current, allBypass: true }))
    const bypassed = engine.renderProbe({ seconds: 0.55 })
    expect(distance(base, bypassed)).toBeLessThan(0.02)

    engine.updateEffects((current) => ({
      ...current,
      allBypass: false,
      pianoGroup: true,
      rotaryOn: true,
      chains: {
        A: { ...current.chains.A, ampEq: { ...current.chains.A.ampEq, on: true, typeIndex: ampEqTypes.indexOf('To Rotary'), drive: 0.7 } },
        B: current.chains.B,
      },
    }))
    expect(distance(base, engine.renderProbe({ seconds: 0.55 }))).toBeGreaterThan(0.001)
  })
})

describe('phase 3 programs, performance system, organ, and synth', () => {
  it('round-trips all supported program state, Store/Store As, Live auto-store, discard, and navigation', () => {
    let state = createStage3State()
    expect(state.slots).toHaveLength(32)
    expect(state.liveSlots).toHaveLength(8)
    expect(state.slots.filter((slot) => slot.factory)).toHaveLength(8)

    state = applyStage3Control(state, 'organ.vox-model', 1)
    state = applyStage3Control(state, 'synth.filter-cutoff', 0.88)
    state = applyStage3Control(state, 'program.split', 1)
    expect(state.dirty).toBe(true)
    state = storeAsProgram(state, 'Round Trip Vox', 9)
    expect(state.dirty).toBe(false)
    state = selectProgram(state, 0)
    state = selectProgram(state, 9)
    expect(state.editName).toBe('Round Trip Vox')
    expect(state.working.organ.layers.A.model).toBe('Vox')
    expect(state.working.synth.layers.A.filter.cutoff).toBeCloseTo(0.88)
    expect(state.working.split.enabled).toBe(true)

    state = applyStage3Control(state, 'organ.farf-model', 1)
    expect(state.dirty).toBe(true)
    state = selectProgram(state, 0)
    expect(state.working.organ.layers.A.model).not.toBe('Farf')

    state = applyStage3Control(state, 'program.live-mode', 1)
    expect(state.liveMode).toBe(true)
    state = applyStage3Control(state, 'synth.osc-control', 0.77)
    expect(state.dirty).toBe(false)
    expect(state.liveSlots[state.liveSlot].snapshot.synth.layers.A.oscCtrl).toBeCloseTo(0.77)

    state = applyStage3Control(state, 'program.live-mode', 0)
    state = applyStage3Control(state, 'program.page-right', 1)
    state = applyStage3Control(state, 'program.program-2', 1)
    expect(state.currentSlot).toBe(9)
    state = applyStage3Control(state, 'program.program-dial', 1)
    expect(state.currentSlot).toBe(31)
    expect(state.listView).toBe(true)

    state = storeProgram(state, 31, 'Stored 32')
    expect(state.slots[31].name).toBe('Stored 32')
  })

  it('routes layers through split zones, crossfades, scenes, morphs, master clock, transpose, and Panic', () => {
    let state = createStage3State()
    expect(splitPositions).toEqual(['C2', 'F2', 'C3', 'F3', 'C4', 'F4', 'C5', 'F5', 'C6', 'F6', 'C7'])
    state = applyStage3Control(state, 'program.split', 1)
    state.working.organ.layers.A.zone = { low: 1, high: 2 }
    state.working.synth.layers.A.zone = { low: 3, high: 4 }
    expect(zoneForMidi(state.working.split, 48)).toBe(2)
    expect(layerRouteGain(state.working, 'organ', 'A', 48)).toBeGreaterThan(0)
    expect(layerRouteGain(state.working, 'synth', 'A', 72)).toBeGreaterThan(0)
    expect(layerRouteGain(state.working, 'synth', 'A', 60)).toBeGreaterThan(0.2)

    const originalWave = state.working.synth.layers.A.waveform
    state = switchScene(state, 'II')
    expect(state.working.activeScene).toBe('II')
    expect(state.working.pianoLayers.A.enabled).toBe(false)
    expect(state.working.synth.layers.A.waveform).toBe(originalWave)

    const morphed = applyMorph(state, 'Wheel', 0.5)
    expect(morphed['synth.A.filter.cutoff']).toBeGreaterThan(0.35)
    state = clearMorph(state, 'Wheel')
    expect(state.working.morphs.Wheel).toHaveLength(0)
    expect(state.working.clock).toMatchObject({ bpm: expect.any(Number), syncTargets: ['Arpeggiator/Gate', 'Synth LFO', 'Delay', 'Mod 1 rate'] })
    state = applyStage3Control(state, 'performance.transpose', 1)
    expect(state.working.transpose).toBe(1)
    state = { ...state, heldNotes: [60, 64, 67] }
    state = panic(state)
    expect(state.heldNotes).toEqual([])
    expect(state.working.transpose).toBe(0)
  })

  it('renders distinct organ models with drawbars, percussion, key click, vibrato/chorus, rotary, and cleanup-ready layers', () => {
    const state = createStage3State()
    state.working.organ.layers.A.enabled = true
    const renders = organModels.map((model) => {
      state.working.organ.layers.A.model = model
      return renderOrganProbe(state.working, { seconds: 0.45 })
    })
    for (let i = 1; i < renders.length; i += 1) {
      expect(distance(renders[0], renders[i])).toBeGreaterThan(0.002)
    }

    state.working.organ.layers.A.model = 'B3'
    state.working.organ.layers.A.drawbars = [1, 0, 0, 0, 0, 0, 0, 0, 0]
    const single = renderOrganProbe(state.working)
    state.working.organ.layers.A.drawbars = [1, 1, 1, 1, 1, 1, 1, 1, 1]
    const full = renderOrganProbe(state.working)
    expect(distance(single, full)).toBeGreaterThan(0.01)
    state.working.organ.layers.A.percussion = false
    const noPerc = renderOrganProbe(state.working)
    state.working.organ.layers.A.percussion = true
    state.working.organ.layers.A.keyClick = 0.9
    const percClick = renderOrganProbe(state.working)
    expect(distance(noPerc, percClick)).toBeGreaterThan(0.001)
    state.working.organ.layers.A.vibratoOn = true
    state.working.organ.layers.A.vibratoMode = 'V3'
    const vibrato = renderOrganProbe(state.working)
    state.working.organ.rotary.speed = 'Fast'
    state.working.organ.rotary.ramp = 1
    state.working.organ.rotary.drive = 0.8
    const rotary = renderOrganProbe(state.working)
    expect(distance(vibrato, rotary)).toBeGreaterThan(0.001)
    expect(state.working.organ.layers.B).toMatchObject({ focused: false })
  })

  it('renders distinct synth sources, filters, envelopes, LFO, voice modes, and deterministic arp/gate behavior', () => {
    const state = createStage3State()
    state.working.synth.layers.A.enabled = true
    const allWaves = Object.values(synthWaveforms).flat()
    expect(allWaves).toEqual([
      'Sine',
      'Triangle',
      'Saw',
      'Square',
      'Pulse 33',
      'Pulse 10',
      'White Noise',
      'Sync Saw',
      'Sync Square',
      'Multi Saw',
      'Multi Saw 8ve',
      'Super Saw',
      'Super Square',
      'FM 2-op (algorithm A)',
    ])
    const baseLayer = state.working.synth.layers.A
    const renders = allWaves.map((waveform) => {
      const category = (Object.entries(synthWaveforms).find(([, waves]) => waves.includes(waveform))?.[0] ?? 'Pure') as keyof typeof synthWaveforms
      baseLayer.category = category
      baseLayer.waveform = waveform
      baseLayer.oscCtrl = 0.74
      return renderSynthProbe(state.working, { seconds: 0.4 })
    })
    for (let i = 1; i < renders.length; i += 1) {
      expect(distance(renders[0], renders[i])).toBeGreaterThan(0.0004)
    }

    baseLayer.category = 'Pure'
    baseLayer.waveform = 'Saw'
    baseLayer.filter.type = 'LP24'
    const base = renderSynthProbe(state.working)
    for (const filter of filterTypes) {
      if (filter === 'LP24') continue
      baseLayer.filter.type = filter
      expect(distance(base, renderSynthProbe(state.working))).toBeGreaterThan(0.0002)
    }
    baseLayer.filter.resonance = 0.9
    baseLayer.filter.drive = 3
    baseLayer.ampEnv.attack = 0.8
    const env = renderSynthProbe(state.working)
    expect(distance(base, env)).toBeGreaterThan(0.0005)
    for (const waveform of lfoWaveforms) {
      baseLayer.lfo.waveform = waveform
      baseLayer.lfo.destination = 'Filter Freq'
      baseLayer.lfo.amount = 0.75
      expect(distance(base, renderSynthProbe(state.working))).toBeGreaterThan(0.0002)
    }
    baseLayer.voice.mode = 'Legato'
    baseLayer.voice.priority = 'High'
    baseLayer.voice.glide = 0.55
    baseLayer.voice.unison = 3
    baseLayer.voice.vibrato = 'On'
    const voice = renderSynthProbe(state.working)
    expect(distance(env, voice)).toBeGreaterThan(0.0004)
    baseLayer.arp.run = true
    baseLayer.arp.mode = 'Gate'
    baseLayer.arp.range = 3
    baseLayer.arp.direction = 'Up/Down'
    expect(arpeggiatorSteps(baseLayer, [60, 64, 67], 8)).toEqual([60, 64, 67, 72, 76, 79, 84, 88])
    expect(distance(voice, renderSynthProbe(state.working))).toBeGreaterThan(0.0002)
    expect(Object.keys(state.working.synth.layers)).toEqual(['A', 'B', 'C'])
  })

  it('keeps the complete system integrated through one master path and declares excluded controls honestly', () => {
    expect(integrationSnapshot()).toMatchObject({
      audioContextCount: 1,
      destinationCount: 1,
      engines: ['Piano', 'Organ', 'Synth'],
    })
    expect(integrationSnapshot().masterPath.join(' ')).toMatch(/master gain\/limiter/)
    expect(unsupportedDeclarations.join(' ')).toMatch(/Aftertouch morph source is visual only/)
    expect(unsupportedDeclarations.join(' ')).toMatch(/Extern/)

    render(<App />)
    expect(screen.getByRole('button', { name: /Morph Aftertouch decorative control/i })).toBeInTheDocument()
    fireEvent.pointerDown(screen.getByRole('button', { name: /Organ FX Focus control/i }), { pointerId: 4 })
    expect(screen.getByTestId('piano-status')).toHaveTextContent(/Organ routed through the shared Stage 4 effects graph/)
  })
})
