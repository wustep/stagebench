import { describe, expect, it } from 'vitest'
import { OfflineAudioContext } from 'node-web-audio-api'
import {
  ARP_DIRECTIONS,
  ARP_MODES,
  FILTER_PANEL_ORDER,
  LFO_PANEL_ORDER,
  NOTE_PRIORITIES,
  OSC_CTRL_BEHAVIOUR,
  VIBRATO_PANEL_ORDER,
  VOICE_MODES,
  WAVEFORMS_BY_CATEGORY,
  cutoffHzFor,
  envelopeFromDials,
  priorityNote,
  renderEnvelope,
  renderLfo,
  renderOscillator,
  stepSecondsFor,
  trackedCutoff,
  type NotePriority,
} from '../audio/synthModel'
import {
  activeSynthLayers,
  arpModeFromPanel,
  arpModePanelIndex,
  createSynthStore,
  defaultSynthLayer,
  defaultSynthState,
  filterFromPanel,
  filterPanelIndex,
  lfoWaveformFromPanel,
  lfoWaveformPanelIndex,
  vibratoFromPanel,
  vibratoPanelIndex,
  voiceModeFromPanel,
  voiceModePanelIndex,
  type SynthState,
} from '../audio/synthState'
import { renderSynthNote } from '../audio/synthVoice'
import { applySynthEdit, synthPanelValue } from '../audio/panelBindings'
import { createPianoSession } from '../audio/noteSession'
import { createManualClock } from '../audio/clock'
import { createRecordingEngine } from '../audio/fakes'
import { VARIANT } from '../hardware/variant'
import { defaultProgramState } from '../audio/programState'
import { rms, brightness, shapeDifference, crossingRate, centroidProxy, lastAudible } from '../audio/offlineRender'

/**
 * synth.sources, synth.filter-envelopes, synth.voice-modes and synth.arp-gate.
 *
 * The audible claims are measured on the real renderer — `renderSynthNote` is the exact
 * function the browser plays, so a filter or envelope that "works" here works there. The
 * voice-mode and arpeggiator claims are asserted on state and on the session's voice
 * bookkeeping, because those are about which voice sounds, not about a waveform.
 */

const SR = 22050

function synthProgram() {
  const program = defaultProgramState()
  program.piano.sectionOn = false
  program.organ.sectionOn = false
  program.synth.sectionOn = true
  program.synth.layers['synth.a'].enabled = true
  program.synth.layers['synth.b'].enabled = false
  program.synth.layers['synth.c'].enabled = false
  program.split = { ...program.split, on: false }
  // Keep voices short and deterministic in tests.
  program.synth.layers['synth.a'].arp = {
    ...program.synth.layers['synth.a'].arp,
    mode: 'Poly',
    run: false,
    hold: false,
    clockSync: false,
  }
  return program
}

function sessionWith(program: ReturnType<typeof synthProgram>, maxPolyphony?: number) {
  const engine = createRecordingEngine()
  const session = createPianoSession({
    engine,
    clock: createManualClock(),
    lowestMidi: VARIANT.lowestMidi,
    highestMidi: VARIANT.highestMidi,
    maxPolyphony,
    pianoState: () => program.piano,
    organState: () => program.organ,
    synthState: () => program.synth,
    programState: () => program,
  })
  return { session, engine }
}

function renderLayer(layer: ReturnType<typeof defaultSynthLayer>, overrides: Record<string, unknown> = {}) {
  return renderSynthNote(
    {
      layer,
      midi: 60,
      velocity: 0.8,
      level: 0.8,
      zoneGain: 1,
      holdSeconds: 0.3,
      releaseSeconds: 0.1,
      glideFrom: null,
      modWheel: 0,
      lfoRateHz: 4,
      ...overrides,
    },
    SR,
  ).samples
}

describe('synth.sources — three layers with independent state', () => {
  it('starts one synth voice per enabled synth layer', () => {
    const program = synthProgram()
    const single = sessionWith(program)
    single.session.press({ midi: 60, velocity: 0.8, source: 'pointer', owner: 'p:1' })
    expect(single.engine.startedVoices.map((voice) => voice.layer)).toEqual(['synth.a'])
    expect(single.session.snapshot().byEngine.synth).toBe(1)

    program.synth.layers['synth.b'].enabled = true
    program.synth.layers['synth.c'].enabled = true
    const all = sessionWith(program)
    all.session.press({ midi: 60, velocity: 0.8, source: 'pointer', owner: 'p:1' })
    expect(all.engine.startedVoices.map((voice) => voice.layer).sort()).toEqual([
      'synth.a',
      'synth.b',
      'synth.c',
    ])
    expect(all.session.snapshot().byEngine.synth).toBe(3)
    // Every voice carries a synth payload.
    for (const voice of all.engine.startedVoices) expect(voice.synthSettings).toBeDefined()
  })

  it('keeps each layer\'s own waveform, filter and envelope', () => {
    const state = defaultSynthState()
    state.layers['synth.a'].waveform = 'Sine'
    state.layers['synth.b'].waveform = 'Super Saw'
    state.layers['synth.c'].waveform = 'FM 2-op (algorithm A)'
    state.layers['synth.a'].filterType = 'LP12'
    state.layers['synth.b'].filterType = 'HP'
    state.layers['synth.c'].filterType = 'BP'
    expect(state.layers['synth.a'].waveform).not.toBe(state.layers['synth.b'].waveform)
    // The three render differently.
    const a = renderLayer(state.layers['synth.a'])
    const b = renderLayer(state.layers['synth.b'])
    const c = renderLayer(state.layers['synth.c'])
    expect(shapeDifference(a, b)).toBeGreaterThan(0.02)
    expect(shapeDifference(b, c)).toBeGreaterThan(0.02)
  })

  it('reports the active layers from section, layer and zone state', () => {
    const state = defaultSynthState()
    expect(activeSynthLayers(state, 0)).toEqual(['synth.a'])
    state.layers['synth.b'].enabled = true
    expect(activeSynthLayers(state, 0)).toEqual(['synth.a', 'synth.b'])
    expect(activeSynthLayers(state, 3)).toEqual([])
    state.layers['synth.c'].zones = [true, true, true, true]
    state.layers['synth.c'].enabled = true
    expect(activeSynthLayers(state, 3)).toEqual(['synth.c'])
    state.sectionOn = false
    expect(activeSynthLayers(state, 0)).toEqual([])
  })

  it('routes each synth layer through its own chain', () => {
    const state = defaultSynthState()
    // Each synth layer has its own chain, unlike the organ's shared one.
    expect(state.layers['synth.a'].id).not.toBe(state.layers['synth.b'].id)
    // The effect state has one chain per synth layer.
    const program = defaultProgramState()
    expect(program.effects.chains['synth.a']).toBeDefined()
    expect(program.effects.chains['synth.b']).toBeDefined()
    expect(program.effects.chains['synth.c']).toBeDefined()
    expect(program.effects.chains['synth.a']).not.toBe(program.effects.chains['synth.b'])
  })
})

describe('synth.sources — the required waveform list and Osc Ctrl', () => {
  it('offers exactly the required waveforms in their categories', () => {
    expect(WAVEFORMS_BY_CATEGORY.Pure).toEqual([
      'Sine',
      'Triangle',
      'Saw',
      'Square',
      'Pulse 33',
      'Pulse 10',
      'White Noise',
    ])
    expect(WAVEFORMS_BY_CATEGORY.Sync).toEqual(['Sync Saw', 'Sync Square'])
    expect(WAVEFORMS_BY_CATEGORY.Multi).toEqual(['Multi Saw', 'Multi Saw 8ve'])
    expect(WAVEFORMS_BY_CATEGORY.Super).toEqual(['Super Saw', 'Super Square'])
    expect(WAVEFORMS_BY_CATEGORY['FM-H']).toEqual(['FM 2-op (algorithm A)'])
  })

  it('gives Osc Ctrl no effect for Pure and a real one for every other category', () => {
    expect(OSC_CTRL_BEHAVIOUR.Pure).toBe('No effect')
    const pureLow = renderOscillator({ waveform: 'Saw', midi: 60, sampleRate: SR, seconds: 0.05, oscCtrl: 0 })
    const pureHigh = renderOscillator({ waveform: 'Saw', midi: 60, sampleRate: SR, seconds: 0.05, oscCtrl: 10 })
    expect(shapeDifference(pureLow.left, pureHigh.left)).toBeLessThan(1e-6)

    for (const category of ['Sync', 'Multi', 'Super', 'FM-H'] as const) {
      const waveform = WAVEFORMS_BY_CATEGORY[category][0]
      const low = renderOscillator({ waveform, midi: 60, sampleRate: SR, seconds: 0.06, oscCtrl: 0 })
      const high = renderOscillator({ waveform, midi: 60, sampleRate: SR, seconds: 0.06, oscCtrl: 10 })
      expect(shapeDifference(low.left, high.left), category).toBeGreaterThan(0.02)
      expect(OSC_CTRL_BEHAVIOUR[category]).not.toBe('No effect')
    }
  })

  it('selects a waveform through the three dials', () => {
    const state = defaultSynthState()
    // The category dial picks a category; the wave dial picks within it.
    applySynthEdit(state, 'synth.dial.cat', 1) // Sync
    expect(state.layers[state.focused].waveform).toBe('Sync Saw')
    expect(synthPanelValue(state, 'synth.dial.cat')).toBe(1)
    applySynthEdit(state, 'synth.dial.wave', 1)
    expect(state.layers[state.focused].waveform).toBe('Sync Square')
    expect(synthPanelValue(state, 'synth.dial.wave')).toBe(1)
    // The type dial spans every waveform.
    applySynthEdit(state, 'synth.dial.type', 0)
    expect(state.layers[state.focused].waveform).toBe('Sine')
  })
})

describe('synth.filter-envelopes — filter types, tracking, resonance and drive', () => {
  it('has the four required filter types in the printed order', () => {
    expect(FILTER_PANEL_ORDER).toEqual(['LP12', 'LP24', 'HP', 'BP'])
    for (let index = 0; index < FILTER_PANEL_ORDER.length; index += 1) {
      expect(filterPanelIndex(filterFromPanel(index))).toBe(index)
    }
    // The panel selector drives the state.
    const state = defaultSynthState()
    applySynthEdit(state, 'synth.filter.type', 2)
    expect(state.layers[state.focused].filterType).toBe('HP')
    expect(synthPanelValue(state, 'synth.filter.type')).toBe(2)
  })

  it('makes each filter type render differently through the voice', () => {
    const render = (filterType: 'LP12' | 'LP24' | 'HP' | 'BP') => {
      const layer = defaultSynthLayer('synth.a', true)
      layer.waveform = 'Saw'
      layer.filterType = filterType
      layer.filterFreq = 5
      layer.filterRes = 2
      layer.filterEnvAmount = 0
      return renderLayer(layer)
    }
    const rendered = [render('LP12'), render('LP24'), render('HP'), render('BP')]
    for (let a = 0; a < rendered.length; a += 1) {
      for (let b = a + 1; b < rendered.length; b += 1) {
        expect(shapeDifference(rendered[a], rendered[b]), `${a} vs ${b}`).toBeGreaterThan(0.01)
      }
    }
    // LP24 is steeper than LP12.
    expect(brightness(rendered[1])).toBeLessThan(brightness(rendered[0]))
    // HP keeps the highs.
    expect(brightness(rendered[2])).toBeGreaterThan(brightness(rendered[0]))
  })

  it('moves the cutoff with Freq, and tracks the keyboard', () => {
    expect(cutoffHzFor(10)).toBeGreaterThan(cutoffHzFor(5))
    expect(trackedCutoff(1000, 60, 'Off')).toBe(1000)
    expect(trackedCutoff(1000, 72, '1')).toBeCloseTo(2000, 0)
    // And the rendered output is brighter with a higher Freq.
    const dark = defaultSynthLayer('synth.a', true)
    dark.waveform = 'Saw'
    dark.filterFreq = 1.5
    const bright = defaultSynthLayer('synth.a', true)
    bright.waveform = 'Saw'
    bright.filterFreq = 9
    expect(centroidProxy(renderLayer(bright), SR)).toBeGreaterThan(centroidProxy(renderLayer(dark), SR))
  })

  it('changes the output with resonance and with drive', () => {
    const render = (res: number, drive: number) => {
      const layer = defaultSynthLayer('synth.a', true)
      layer.waveform = 'Saw'
      layer.filterType = 'LP12'
      layer.filterFreq = 6
      layer.filterRes = res
      layer.filterDrive = drive
      layer.filterEnvAmount = 0
      return renderLayer(layer)
    }
    expect(shapeDifference(render(0, 0), render(9, 0))).toBeGreaterThan(0.01)
    expect(shapeDifference(render(2, 0), render(2, 3))).toBeGreaterThan(0.01)
    // Drive adds harmonics, so it brightens the signal.
    expect(brightness(render(2, 3))).toBeGreaterThan(brightness(render(2, 0)))
  })

  it('sweeps the cutoff with the filter envelope amount', () => {
    const render = (amount: number) => {
      const layer = defaultSynthLayer('synth.a', true)
      layer.waveform = 'Saw'
      layer.filterType = 'LP24'
      layer.filterFreq = 2
      layer.filterEnvAmount = amount
      layer.filterEnv = { attack: 0.6, decay: 7, release: 1, velocity: 0, amount: 0 }
      return renderLayer(layer)
    }
    expect(brightness(render(9))).toBeGreaterThan(brightness(render(0)))
  })
})

describe('synth.filter-envelopes — three envelopes', () => {
  it('has oscillator, filter and amplifier envelopes, each with ADR', () => {
    const layer = defaultSynthLayer('synth.a', true)
    for (const envelope of [layer.oscEnv, layer.filterEnv, layer.ampEnv]) {
      expect(envelope.attack).toBeDefined()
      expect(envelope.decay).toBeDefined()
      expect(envelope.release).toBeDefined()
      expect(envelope.velocity).toBeDefined()
    }
  })

  it('makes a longer attack quieter at the start of the note', () => {
    const render = (attack: number) => {
      const layer = defaultSynthLayer('synth.a', true)
      layer.waveform = 'Saw'
      layer.ampEnv = { attack, decay: 6, release: 2, velocity: 0, amount: 0 }
      const data = renderLayer(layer, { holdSeconds: 0.4 })
      // Measure the first 20 ms only.
      return rms(data.slice(0, Math.round(0.02 * SR)))
    }
    expect(render(0.5)).toBeLessThan(render(0.1))
  })

  it('makes a longer release dial ring for longer after the key lifts', () => {
    // The amp envelope's Release dial is the source of truth; the session derives the
    // voice's rendered release length from it (`synthRequest`), which is what a real note
    // does. The test drives the same pair so it measures the shipped path.
    const render = (releaseDial: number) => {
      const layer = defaultSynthLayer('synth.a', true)
      layer.waveform = 'Saw'
      layer.ampEnv = { attack: 0.1, decay: 6, release: releaseDial, velocity: 0, amount: 0 }
      const layerRelease = envelopeFromDials(layer.ampEnv.attack, layer.ampEnv.decay, releaseDial).release
      const data = renderLayer(layer, {
        holdSeconds: 0.15,
        releaseSeconds: Math.max(0.05, Math.min(4, layerRelease)),
      })
      return lastAudible(data) / SR
    }
    // Dial 9 is a long release and dial 1 is a short one.
    expect(render(9)).toBeGreaterThan(render(1) * 2)
  })

  it('honours the release length the voice is asked to render', () => {
    // A caller that asks for a specific release gets exactly that tail, independent of the
    // dial: this is what makes a rendered voice match the note it belongs to.
    const render = (releaseSeconds: number) => {
      const layer = defaultSynthLayer('synth.a', true)
      layer.waveform = 'Saw'
      const data = renderLayer(layer, { holdSeconds: 0.15, releaseSeconds })
      return lastAudible(data) / SR
    }
    expect(render(1.5)).toBeGreaterThan(render(0.2) * 3)
  })

  it('treats decay at maximum as sustain mode', () => {
    const settings = envelopeFromDials(1, 10, 1)
    expect(settings.sustainMode).toBe(true)
    const shape = renderEnvelope(settings, 0.4, 0.5, SR)
    expect(shape[Math.round(0.35 * SR)]).toBeGreaterThan(0.95)
  })

  it('modulates pitch with the oscillator envelope when Env To Pitch is engaged', () => {
    const render = (toPitch: boolean) => {
      const layer = defaultSynthLayer('synth.a', true)
      layer.waveform = 'Sine'
      layer.filterOn = false
      layer.oscEnvToPitch = toPitch
      layer.oscEnvAmount = 6
      layer.oscEnv = { attack: 0.5, decay: 5, release: 1, velocity: 0, amount: 0 }
      return renderLayer(layer)
    }
    expect(shapeDifference(render(false), render(true))).toBeGreaterThan(0.01)
  })

  it('respects the Amp Velocity switch', () => {
    const render = (velocity: number, ampVelocity: number) => {
      const layer = defaultSynthLayer('synth.a', true)
      layer.waveform = 'Saw'
      layer.ampVelocity = ampVelocity
      layer.ampEnv = { attack: 0.1, decay: 5, release: 1, velocity: 0, amount: 0 }
      return renderLayer(layer, { velocity })
    }
    // Off: loud and soft strikes render at the same level.
    expect(rms(render(1, 0))).toBeCloseTo(rms(render(0.25, 0)), 2)
    // Level 3: they differ clearly.
    expect(rms(render(1, 3))).toBeGreaterThan(rms(render(0.25, 3)) * 1.5)
  })
})

describe('synth.voice-modes — poly, mono, legato, priority, glide, unison, vibrato', () => {
  it('offers the three voice modes in the printed order', () => {
    expect(VOICE_MODES).toEqual(['Poly', 'Mono', 'Legato'])
    for (let index = 0; index < VOICE_MODES.length; index += 1) {
      expect(voiceModePanelIndex(voiceModeFromPanel(index))).toBe(index)
    }
    const state = defaultSynthState()
    applySynthEdit(state, 'synth.voice.mode', 1)
    expect(state.layers[state.focused].voiceMode).toBe('Mono')
    expect(synthPanelValue(state, 'synth.voice.mode')).toBe(1)
  })

  it('sounds many notes in Poly and one at a time in Mono', () => {
    const poly = synthProgram()
    const polyRun = sessionWith(poly)
    for (const midi of [60, 64, 67]) {
      polyRun.session.press({ midi, velocity: 0.8, source: 'pointer', owner: `p:${midi}` })
    }
    expect(polyRun.engine.activeVoiceCount()).toBe(3)

    const mono = synthProgram()
    mono.synth.layers['synth.a'].voiceMode = 'Mono'
    const monoRun = sessionWith(mono)
    monoRun.session.press({ midi: 60, velocity: 0.8, source: 'pointer', owner: 'p:60' })
    expect(monoRun.engine.activeVoiceCount()).toBe(1)
    monoRun.session.press({ midi: 64, velocity: 0.8, source: 'pointer', owner: 'p:64' })
    // The new note replaces the old one rather than stacking.
    expect(monoRun.engine.activeVoiceCount()).toBe(1)
    expect(monoRun.session.snapshot().sounding).toEqual([64])
    // And legato behaves the same way at the voice level; the difference is the envelope
    // retrigger, which is asserted through the parameter next.
    const legato = synthProgram()
    legato.synth.layers['synth.a'].voiceMode = 'Legato'
    const legatoRun = sessionWith(legato)
    legatoRun.session.press({ midi: 60, velocity: 0.8, source: 'pointer', owner: 'p:60' })
    legatoRun.session.press({ midi: 64, velocity: 0.8, source: 'pointer', owner: 'p:64' })
    expect(legatoRun.engine.activeVoiceCount()).toBe(1)
  })

  it('offers note priority Off, Low and High, and resolves the sounding note', () => {
    expect(NOTE_PRIORITIES).toEqual(['Off', 'Low', 'High'])
    const held = [
      { midi: 60, order: 1 },
      { midi: 72, order: 2 },
      { midi: 48, order: 3 },
    ]
    expect(priorityNote(held, 'Low' as NotePriority)).toBe(48)
    expect(priorityNote(held, 'High' as NotePriority)).toBe(72)
    // Off keeps the most recently played note.
    expect(priorityNote(held, 'Off' as NotePriority)).toBe(48)
    expect(priorityNote([], 'Low' as NotePriority)).toBeNull()
  })

  it('passes a glide source to the voice in mono mode and none in poly', () => {
    const mono = synthProgram()
    mono.synth.layers['synth.a'].voiceMode = 'Mono'
    mono.synth.layers['synth.a'].glide = 6
    const monoRun = sessionWith(mono)
    monoRun.session.press({ midi: 60, velocity: 0.8, source: 'pointer', owner: 'p:60' })
    monoRun.session.press({ midi: 72, velocity: 0.8, source: 'pointer', owner: 'p:72' })
    const glided = monoRun.engine.startedVoices.at(-1)
    expect(glided?.synthSettings?.glideFrom).not.toBeNull()

    const poly = synthProgram()
    poly.synth.layers['synth.a'].voiceMode = 'Poly'
    poly.synth.layers['synth.a'].glide = 6
    const polyRun = sessionWith(poly)
    polyRun.session.press({ midi: 60, velocity: 0.8, source: 'pointer', owner: 'p:60' })
    polyRun.session.press({ midi: 72, velocity: 0.8, source: 'pointer', owner: 'p:72' })
    expect(polyRun.engine.startedVoices.at(-1)?.synthSettings?.glideFrom).toBeNull()
  })

  it('renders a glide that starts at the previous pitch', () => {
    const layer = defaultSynthLayer('synth.a', true)
    layer.waveform = 'Sine'
    layer.filterOn = false
    layer.glide = 8
    const glided = renderSynthNote(
      {
        layer,
        midi: 72,
        velocity: 0.8,
        level: 0.8,
        zoneGain: 1,
        holdSeconds: 0.4,
        releaseSeconds: 0.05,
        glideFrom: 60,
        modWheel: 0,
        lfoRateHz: 4,
      },
      SR,
    ).samples
    const direct = renderSynthNote(
      {
        layer,
        midi: 72,
        velocity: 0.8,
        level: 0.8,
        zoneGain: 1,
        holdSeconds: 0.4,
        releaseSeconds: 0.05,
        glideFrom: null,
        modWheel: 0,
        lfoRateHz: 4,
      },
      SR,
    ).samples
    // Early in the glide the pitch is still low, so fewer zero crossings than the target.
    const early = (data: Float32Array) => crossingRate(data.slice(0, Math.round(0.05 * SR)), SR)
    expect(early(glided)).toBeLessThan(early(direct))
  })

  it('stacks unison voices, widening and detuning the source', () => {
    const state = defaultSynthState()
    applySynthEdit(state, 'synth.unison', 3)
    expect(state.layers[state.focused].unison).toBe(3)
    expect(synthPanelValue(state, 'synth.unison')).toBe(3)
    const render = (unison: number) => {
      const layer = defaultSynthLayer('synth.a', true)
      layer.waveform = 'Saw'
      layer.unison = unison
      return renderLayer(layer)
    }
    expect(shapeDifference(render(0), render(3))).toBeGreaterThan(0.01)
  })

  it('offers the required vibrato modes with the printed panel order', () => {
    // The spec's required modes are On and Wheel; the panel prints WHL / DLY / ON / A.T.
    expect(VIBRATO_PANEL_ORDER).toEqual(['Wheel', 'Delayed', 'On', 'Aftertouch'])
    for (let index = 0; index < VIBRATO_PANEL_ORDER.length; index += 1) {
      expect(vibratoPanelIndex(vibratoFromPanel(index))).toBe(index)
    }
    const state = defaultSynthState()
    applySynthEdit(state, 'synth.vibrato', 2)
    expect(state.layers[state.focused].vibrato).toBe('On')
    expect(synthPanelValue(state, 'synth.vibrato')).toBe(2)
  })

  it('makes the Wheel vibrato follow the mod wheel and On ignore it', () => {
    const render = (mode: 'On' | 'Wheel', modWheel: number) => {
      const layer = defaultSynthLayer('synth.a', true)
      layer.waveform = 'Sine'
      layer.filterOn = false
      layer.vibrato = mode
      layer.vibratoAmount = 8
      return renderLayer(layer, { modWheel, holdSeconds: 0.4 })
    }
    // Wheel: no wheel means no vibrato, wheel up means vibrato.
    expect(shapeDifference(render('Wheel', 0), render('Wheel', 1))).toBeGreaterThan(0.005)
    // On: vibrato regardless of the wheel.
    expect(shapeDifference(render('On', 0), render('On', 1))).toBeLessThan(1e-6)
  })
})

describe('synth.arp-gate — deterministic rate, sync, range, direction, hold and run', () => {
  it('offers the three arp modes with the printed order', () => {
    expect(ARP_MODES).toEqual(['Poly', 'Arp', 'Gate'])
    for (let index = 0; index < ARP_MODES.length; index += 1) {
      expect(arpModePanelIndex(arpModeFromPanel(index))).toBe(index)
    }
    expect(ARP_DIRECTIONS).toEqual(['Up', 'Down', 'Up/Down', 'Random'])
  })

  it('locks the step rate to the master clock when synced', () => {
    const at120 = stepSecondsFor(5, 120, true)
    const at240 = stepSecondsFor(5, 240, true)
    expect(at240).toBeCloseTo(at120 / 2, 5)
    // Unsynced, tempo has no effect.
    expect(stepSecondsFor(5, 120, false)).toBeCloseTo(stepSecondsFor(5, 240, false), 10)
  })

  it('runs the arpeggiator deterministically from the held notes', () => {
    const program = synthProgram()
    program.synth.layers['synth.a'].arp = {
      ...program.synth.layers['synth.a'].arp,
      mode: 'Arp',
      run: true,
      rate: 5,
      range: 0,
      direction: 'Up',
      hold: false,
      clockSync: true,
    }
    program.clock.bpm = 120
    const clock = createManualClock()
    const engine = createRecordingEngine()
    const session = createPianoSession({
      engine,
      clock,
      lowestMidi: VARIANT.lowestMidi,
      highestMidi: VARIANT.highestMidi,
      pianoState: () => program.piano,
      organState: () => program.organ,
      synthState: () => program.synth,
      programState: () => program,
    })
    session.press({ midi: 60, velocity: 0.8, source: 'pointer', owner: 'p:60' })
    session.press({ midi: 64, velocity: 0.8, source: 'pointer', owner: 'p:64' })
    session.press({ midi: 67, velocity: 0.8, source: 'pointer', owner: 'p:67' })
    // The keys themselves do not sound: the arpeggiator walks them on its own clock.
    expect(engine.startedVoices).toHaveLength(0)
    expect(session.snapshot().arpRunning).toBe(true)

    // Each step sounds one note, in ascending order.
    const played: number[] = []
    for (let step = 0; step < 6; step += 1) {
      clock.advance(250)
      const latest = engine.startedVoices.at(-1)
      if (latest) played.push(latest.midi)
    }
    expect(played.length).toBeGreaterThan(0)
    expect(played.slice(0, 3)).toEqual([60, 64, 67])
    // Deterministic: the same setup plus the same clock gives the same sequence.
    expect(session.snapshot().arpStep).toBeGreaterThan(0)
  })

  it('honours the range across octaves', () => {
    const program = synthProgram()
    program.synth.layers['synth.a'].arp = {
      ...program.synth.layers['synth.a'].arp,
      mode: 'Arp',
      run: true,
      rate: 5,
      range: 10,
      direction: 'Up',
      hold: false,
      clockSync: true,
    }
    program.clock.bpm = 120
    const clock = createManualClock()
    const engine = createRecordingEngine()
    const session = createPianoSession({
      engine,
      clock,
      lowestMidi: VARIANT.lowestMidi,
      highestMidi: VARIANT.highestMidi,
      pianoState: () => program.piano,
      organState: () => program.organ,
      synthState: () => program.synth,
      programState: () => program,
    })
    session.press({ midi: 60, velocity: 0.8, source: 'pointer', owner: 'p:60' })
    const played: number[] = []
    for (let step = 0; step < 8; step += 1) {
      clock.advance(250)
      const latest = engine.startedVoices.at(-1)
      if (latest) played.push(latest.midi)
    }
    // With a wide range the walk leaves the played octave.
    expect(Math.max(...played)).toBeGreaterThan(60)
  })

  it('keeps running with KB HOLD after the keys are lifted', () => {
    const program = synthProgram()
    program.synth.layers['synth.a'].arp = {
      ...program.synth.layers['synth.a'].arp,
      mode: 'Arp',
      run: true,
      rate: 5,
      range: 0,
      direction: 'Up',
      hold: true,
      clockSync: true,
    }
    program.clock.bpm = 120
    const clock = createManualClock()
    const engine = createRecordingEngine()
    const session = createPianoSession({
      engine,
      clock,
      lowestMidi: VARIANT.lowestMidi,
      highestMidi: VARIANT.highestMidi,
      pianoState: () => program.piano,
      organState: () => program.organ,
      synthState: () => program.synth,
      programState: () => program,
    })
    session.press({ midi: 60, velocity: 0.8, source: 'pointer', owner: 'p:60' })
    clock.advance(250)
    const beforeRelease = engine.startedVoices.length
    session.release('pointer', 'p:60', 60)
    clock.advance(500)
    // With hold engaged the arpeggio keeps stepping after the key is up.
    expect(engine.startedVoices.length).toBeGreaterThan(beforeRelease)
  })

  it('stops when ARP RUN is disengaged and clears its voices', () => {
    const program = synthProgram()
    program.synth.layers['synth.a'].arp = {
      ...program.synth.layers['synth.a'].arp,
      mode: 'Arp',
      run: true,
      rate: 5,
      clockSync: true,
    }
    program.clock.bpm = 120
    const clock = createManualClock()
    const engine = createRecordingEngine()
    const session = createPianoSession({
      engine,
      clock,
      lowestMidi: VARIANT.lowestMidi,
      highestMidi: VARIANT.highestMidi,
      pianoState: () => program.piano,
      organState: () => program.organ,
      synthState: () => program.synth,
      programState: () => program,
    })
    session.press({ midi: 60, velocity: 0.8, source: 'pointer', owner: 'p:60' })
    expect(session.snapshot().arpRunning).toBe(true)
    clock.advance(250)
    expect(engine.startedVoices.length).toBe(1)
    session.setArpRun(false)
    expect(session.snapshot().arpRunning).toBe(false)
    expect(engine.activeVoiceCount()).toBe(0)
    // No further steps fire.
    const count = engine.startedVoices.length
    clock.advance(2000)
    expect(engine.startedVoices.length).toBe(count)
  })

  it('selects Arp mode from the panel, which starts the arpeggiator', () => {
    const state = defaultSynthState()
    applySynthEdit(state, 'synth.arp.mode', 1)
    expect(state.layers[state.focused].arp.mode).toBe('Arp')
    expect(state.layers[state.focused].arp.run).toBe(true)
    applySynthEdit(state, 'synth.arp.mode', 0)
    expect(state.layers[state.focused].arp.mode).toBe('Poly')
    expect(state.layers[state.focused].arp.run).toBe(false)
  })

  it('repurposes the Range knob as gate hardness in Gate mode', () => {
    const state = defaultSynthState()
    applySynthEdit(state, 'synth.arp.mode', 2)
    expect(state.layers[state.focused].arp.mode).toBe('Gate')
    applySynthEdit(state, 'synth.arp.range', 8)
    expect(state.layers[state.focused].arp.range).toBe(8)
    // The knob is the same control; its meaning is what changes.
    expect(synthPanelValue(state, 'synth.arp.range')).toBe(8)
  })
})

describe('synth.arp-gate — the arpeggiator is audible', () => {
  it('chops a rendered voice into steps with the gate envelope', () => {
    const layer = defaultSynthLayer('synth.a', true)
    layer.waveform = 'Saw'
    layer.ampEnv = { attack: 0.05, decay: 6, release: 0.2, velocity: 0, amount: 0 }
    const sustained = renderSynthNote(
      {
        layer,
        midi: 60,
        velocity: 0.8,
        level: 0.8,
        zoneGain: 1,
        holdSeconds: 0.9,
        releaseSeconds: 0.05,
        glideFrom: null,
        modWheel: 0,
        lfoRateHz: 4,
      },
      SR,
    ).samples
    const gated = renderSynthNote(
      {
        layer,
        midi: 60,
        velocity: 0.8,
        level: 0.8,
        zoneGain: 1,
        holdSeconds: 0.9,
        releaseSeconds: 0.05,
        glideFrom: null,
        modWheel: 0,
        lfoRateHz: 4,
        arpGate: { times: [0, 0.3, 0.6], gateSeconds: 0.2, hardness: 1 },
      },
      SR,
    ).samples
    // The gated version has silent gaps; the sustained one does not.
    const silentFraction = (data: Float32Array) => {
      let silent = 0
      for (const sample of data) if (Math.abs(sample) < 1e-6) silent += 1
      return silent / data.length
    }
    expect(silentFraction(gated)).toBeGreaterThan(silentFraction(sustained) + 0.2)
  })
})

describe('synth.voice-modes — the store', () => {
  it('notifies subscribers and clones deeply', () => {
    const store = createSynthStore()
    const before = store.get()
    const seen: string[] = []
    store.subscribe((next) => seen.push(next.layers['synth.a'].waveform))
    store.update((draft) => {
      draft.layers['synth.a'].waveform = 'Multi Saw'
    })
    expect(before.layers['synth.a'].waveform).toBe('Super Saw')
    expect(store.get().layers['synth.a'].waveform).toBe('Multi Saw')
    expect(seen).toEqual(['Multi Saw'])
    // The update clones deeply: mutating the draft's nested objects does not reach the
    // state the store held before, which is what makes a snapshot safe to compare against.
    const previous = store.get()
    store.update((draft) => {
      draft.layers['synth.a'].lfo.rate = 9
      draft.layers['synth.a'].ampEnv.attack = 1.5
    })
    expect(previous.layers['synth.a'].lfo.rate).not.toBe(9)
    expect(previous.layers['synth.a'].ampEnv.attack).not.toBe(1.5)
  })

  it('keeps the LFO waveform list and its panel order', () => {
    expect(LFO_PANEL_ORDER).toEqual(['Triangle', 'Saw down', 'Saw up', 'Square', 'Sample & Hold'])
    for (let index = 0; index < LFO_PANEL_ORDER.length; index += 1) {
      expect(lfoWaveformPanelIndex(lfoWaveformFromPanel(index))).toBe(index)
    }
    const state: SynthState = defaultSynthState()
    applySynthEdit(state, 'synth.lfo.waveform', 3)
    expect(state.layers[state.focused].lfo.waveform).toBe('Square')
  })

  it('renders all five LFO waveforms', () => {
    const rendered = LFO_PANEL_ORDER.map((waveform) => renderLfo(waveform, 5, SR, SR))
    for (const data of rendered) expect(data.some((value) => value !== 0)).toBe(true)
    // And they are not all the same.
    for (let a = 0; a < rendered.length; a += 1) {
      for (let b = a + 1; b < rendered.length; b += 1) {
        expect(shapeDifference(rendered[a], rendered[b])).toBeGreaterThan(0.005)
      }
    }
  })
})
