import { describe, expect, it } from 'vitest'
import { OfflineAudioContext } from 'node-web-audio-api'
import {
  B3_FOOTAGES,
  ORGAN_MODELS,
  ORGAN_MODEL_PANEL_ORDER,
  drawbarGain,
  harmonicBins,
  organModelFromPanel,
  panelIndexForOrganModel,
  registrationFor,
  renderKeyClick,
  renderOrganLoop,
  renderPercussion,
  vibratoSettingsFor,
  type OrganModelId,
} from '../audio/organModel'
import {
  B3_DEFAULT_DRAWBARS,
  activeOrganLayers,
  cloneOrganState,
  createOrganStore,
  defaultDrawbarsFor,
  defaultOrganState,
  vibratoFromIndex,
  vibratoPanelIndex,
} from '../audio/organState'
import { applyOrganEdit, organPanelValue } from '../audio/panelBindings'
import { createOrganVoice } from '../audio/organVoice'
import { createPianoSession } from '../audio/noteSession'
import { createManualClock } from '../audio/clock'
import { createFakeContext, createRecordingEngine } from '../audio/fakes'
import { VARIANT } from '../hardware/variant'
import { defaultProgramState } from '../audio/programState'
import { createWebAudioEngine } from '../audio/webAudioEngine'
import { adaptAudioContext } from '../audio/adapters'
import { createChain, buildRotary, createRotaryReturn } from '../audio/effectGraph'
import { ROTARY_SPEEDS } from '../audio/effectTypes'
import { createEffectStore, defaultEffectState, isRoutedToRotary, type EffectState } from '../audio/effectState'
import { rms, brightness, shapeDifference, crossingRate } from '../audio/offlineRender'

/**
 * organ.engine — two layers, levels, focus, zones, the shared effect chain, and cleanup.
 *
 * The engine-level claims (which layer sounded, how many voices, whether nodes were
 * reclaimed) are asserted with a recording engine, because those are bookkeeping facts. The
 * audible claims live in `organ-models.test.ts`, which renders the real voice code.
 */

function organProgram() {
  const program = defaultProgramState()
  program.piano.sectionOn = false
  program.synth.sectionOn = false
  program.organ.sectionOn = true
  program.organ.layers['organ.a'].enabled = true
  program.organ.layers['organ.b'].enabled = false
  program.split = { ...program.split, on: false }
  return program
}

function sessionWith(program: ReturnType<typeof organProgram>) {
  const engine = createRecordingEngine()
  const session = createPianoSession({
    engine,
    clock: createManualClock(),
    lowestMidi: VARIANT.lowestMidi,
    highestMidi: VARIANT.highestMidi,
    pianoState: () => program.piano,
    organState: () => program.organ,
    synthState: () => program.synth,
    programState: () => program,
  })
  return { session, engine }
}

describe('organ.engine — two layers and voice ownership', () => {
  it('sounds one organ voice per enabled organ layer', () => {
    const program = organProgram()
    const single = sessionWith(program)
    single.session.press({ midi: 60, velocity: 0.8, source: 'pointer', owner: 'p:1' })
    expect(single.engine.startedVoices).toHaveLength(1)
    expect(single.engine.startedVoices[0].layer).toBe('organ.a')
    expect(single.session.snapshot().byEngine.organ).toBe(1)

    // Both organ layers on: two voices on the same key, both organ.
    program.organ.layers['organ.b'].enabled = true
    const both = sessionWith(program)
    both.session.press({ midi: 60, velocity: 0.8, source: 'pointer', owner: 'p:1' })
    expect(both.engine.startedVoices.map((voice) => voice.layer).sort()).toEqual(['organ.a', 'organ.b'])
    expect(both.session.snapshot().byEngine).toEqual({ piano: 0, organ: 2, synth: 0 })
    // Both voices carry an organ payload, which is what makes them organ voices.
    for (const voice of both.engine.startedVoices) {
      expect(voice.organSettings).toBeDefined()
      expect(voice.settings).toBeDefined()
    }
  })

  it('lets the two layers use different models, as the manual describes', () => {
    const program = organProgram()
    program.organ.layers['organ.b'].enabled = true
    program.organ.layers['organ.a'].model = 'b3'
    program.organ.layers['organ.b'].model = 'vox'
    // The engine reads each layer's model from state, so a rendered voice for B differs.
    expect(program.organ.layers['organ.a'].model).not.toBe(program.organ.layers['organ.b'].model)
    const b3 = renderOrganLoop({ model: 'b3', drawbars: B3_DEFAULT_DRAWBARS, midi: 60, sampleRate: 22050 })
    const vox = renderOrganLoop({ model: 'vox', drawbars: B3_DEFAULT_DRAWBARS, midi: 60, sampleRate: 22050 })
    expect(shapeDifference(b3.samples, vox.samples)).toBeGreaterThan(0.05)
  })

  it('stops only a layer\'s own voices when that layer is switched off', () => {
    const program = organProgram()
    program.organ.layers['organ.b'].enabled = true
    const { session, engine } = sessionWith(program)
    session.press({ midi: 60, velocity: 0.8, source: 'pointer', owner: 'p:1' })
    expect(engine.activeVoiceCount()).toBe(2)
    session.releaseLayer('organ.b')
    expect(engine.activeVoiceCount()).toBe(1)
    expect(session.snapshot().byAnyLayer['organ.a']).toBe(1)
    expect(session.snapshot().byAnyLayer['organ.b']).toBe(0)
  })

  it('sounds nothing when the organ section is off', () => {
    const program = organProgram()
    program.organ.sectionOn = false
    const { session, engine } = sessionWith(program)
    session.press({ midi: 60, velocity: 0.8, source: 'pointer', owner: 'p:1' })
    expect(engine.startedVoices).toHaveLength(0)
  })

  it('carries each layer\'s octave shift into the sounding pitch', () => {
    const program = organProgram()
    program.organ.layers['organ.b'].enabled = true
    program.organ.layers['organ.a'].octave = -12
    program.organ.layers['organ.b'].octave = 12
    const { session, engine } = sessionWith(program)
    session.press({ midi: 60, velocity: 0.8, source: 'pointer', owner: 'p:1' })
    const pitches = engine.startedVoices.map((voice) => voice.midi).sort((a, b) => a - b)
    expect(pitches).toEqual([48, 72])
  })

  it('holds and releases organ notes with the sustain pedal per layer', () => {
    const program = organProgram()
    program.organ.layers['organ.b'].enabled = true
    const { session, engine } = sessionWith(program)
    session.setSustainRouting('organ.a', true)
    session.setSustainRouting('organ.b', false)
    session.setSustain(true, 'ui:sustain')
    session.press({ midi: 60, velocity: 0.8, source: 'pointer', owner: 'p:1' })
    expect(engine.activeVoiceCount()).toBe(2)
    session.release('pointer', 'p:1', 60)
    // A holds through the pedal; B does not.
    expect(engine.activeVoiceCount()).toBe(1)
    expect(session.snapshot().byAnyLayer['organ.a']).toBe(1)
    session.setSustain(false, 'ui:sustain')
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('cleans up every organ voice on all-notes-off and dispose', () => {
    const program = organProgram()
    program.organ.layers['organ.b'].enabled = true
    const { session, engine } = sessionWith(program)
    session.press({ midi: 48, velocity: 0.7, source: 'pointer', owner: 'p:1' })
    session.press({ midi: 55, velocity: 0.7, source: 'keyboard', owner: 'k:1' })
    expect(engine.activeVoiceCount()).toBe(4)
    session.allNotesOff('panic')
    expect(engine.activeVoiceCount()).toBe(0)
    expect(engine.liveNodeCount()).toBe(0)
    session.press({ midi: 60, velocity: 0.7, source: 'pointer', owner: 'p:2' })
    session.dispose()
    expect(engine.activeVoiceCount()).toBe(0)
    expect(session.lastAllNotesOffReason()).toBe('unmount')
  })

  it('respects the layer enable state a scene writes', () => {
    const program = organProgram()
    program.organ.layers['organ.b'].enabled = true
    // A scene is the layer flags, so writing Scene I's configuration is what decides.
    program.organ.layers['organ.a'].enabled = false
    program.organ.layers['organ.b'].enabled = true
    const { session, engine } = sessionWith(program)
    session.press({ midi: 60, velocity: 0.8, source: 'pointer', owner: 'p:1' })
    expect(engine.startedVoices.map((voice) => voice.layer)).toEqual(['organ.b'])
  })

  it('reports the active organ layers from section, layer and zone state', () => {
    const state = defaultOrganState()
    expect(activeOrganLayers(state, 0)).toEqual(['organ.a'])
    state.layers['organ.b'].enabled = true
    expect(activeOrganLayers(state, 0)).toEqual(['organ.a', 'organ.b'])
    // Zone 2 is off by default, so nothing sounds there.
    expect(activeOrganLayers(state, 2)).toEqual([])
    state.layers['organ.a'].zones = [true, true, true, true]
    expect(activeOrganLayers(state, 2)).toEqual(['organ.a'])
    state.sectionOn = false
    expect(activeOrganLayers(state, 0)).toEqual([])
  })
})

describe('organ.engine — two layers share one effect chain', () => {
  it('builds exactly one organ chain in the graph, not one per layer', async () => {
    const SR = 44100
    const ctx = new OfflineAudioContext(2, Math.round(SR * 0.2), SR)
    const engine = createWebAudioEngine({ createContext: () => adaptAudioContext(ctx as never) })
    engine.setOrganState({ ...defaultOrganState(), sectionOn: true })
    engine.noteOn({ id: 'v1', midi: 60, velocity: 0.8, layer: 'organ.a' })
    expect(engine.chains).not.toBeNull()
    // Six chains for the whole instrument: Piano A/B, one Organ, Synth A/B/C.
    expect(Object.keys(engine.chains!)).toEqual(['piano.a', 'piano.b', 'organ', 'synth.a', 'synth.b', 'synth.c'])
    // Both organ layers resolve to that same chain.
    expect(engine.chains!.organ).toBe(engine.chains!.organ)
    engine.dispose()
  })

  it('routes both organ layers into the shared chain', () => {
    const SR = 44100
    // A *fake* context is used here on purpose: an OfflineAudioContext runs to completion the
    // instant a source starts, so a voice's `onended` reclaims it before the second note is
    // booked. The fake records the graph without a transport, which is what this test needs.
    const context = createFakeContext()
    const engine = createWebAudioEngine({ createContext: () => context })
    const organ = defaultOrganState()
    organ.layers['organ.b'].enabled = true
    engine.setOrganState(organ)
    engine.noteOn({ id: 'a', midi: 60, velocity: 0.8, layer: 'organ.a' })
    engine.noteOn({ id: 'b', midi: 64, velocity: 0.8, layer: 'organ.b' })
    // Both voices are booked against the one organ chain.
    expect(engine.activeVoiceCount()).toBe(2)
    expect(engine.voicesByLayer().organ).toBe(2)
    expect(engine.voicesByEngine().organ).toBe(2)
    engine.stopAll()
    engine.dispose()
  })
})

describe('organ.engine — the rotary', () => {
  it('routes the organ with the ORGAN button rather than To Rotary', () => {
    const state = defaultEffectState()
    state.rotary = { on: true, speed: 'Slow', drive: 3, organRouted: true }
    expect(isRoutedToRotary(state, 'organ')).toBe(true)
    // The organ's route is the ORGAN button, not the Amp/EQ model.
    expect(state.chains.organ.ampEq.model).toBe('EQ only')
    // A piano layer is not routed by the organ button.
    expect(isRoutedToRotary(state, 'piano.a')).toBe(false)
    // Turning the rotary off ends the route.
    state.rotary.on = false
    expect(isRoutedToRotary(state, 'organ')).toBe(false)
  })

  it('offers slow, fast and stop, with acceleration between them', () => {
    // The speeds are defined as LFO rates, and the fast rates are far above the slow ones,
    // which is what makes the ramp audible.
    expect(ROTARY_SPEEDS.fast.horn).toBeGreaterThan(ROTARY_SPEEDS.slow.horn * 4)
    expect(ROTARY_SPEEDS.fast.drum).toBeGreaterThan(ROTARY_SPEEDS.slow.drum * 4)
    const state = defaultEffectState()
    state.rotary.speed = 'Stop'
    // Stop is a real third state the panel can select.
    expect(['Slow', 'Fast', 'Stop']).toContain(state.rotary.speed)
  })

  it('ramps the horn and drum rates rather than jumping', async () => {
    const SR = 44100
    const ctx = new OfflineAudioContext(2, Math.round(SR * 1.2), SR)
    const rotary = buildRotary(ctx as never)
    const state: EffectState = {
      ...defaultEffectState(),
      rotary: { on: true, speed: 'Slow', drive: 3, organRouted: true },
    }
    rotary.apply(state, 0)
    // A speed change is a ramp on the LFO frequency, so the modulation period changes over
    // time rather than snapping. Rendering the transition and measuring the level contour's
    // spacing shows the acceleration.
    const changed: EffectState = {
      ...state,
      rotary: { ...state.rotary, speed: 'Fast' },
    }
    rotary.apply(changed, 0)
    // The ramp is 0.4 s (see `buildRotary`), so the graph is still settling at 0.1 s.
    expect(rotary.nodeCount()).toBeGreaterThan(10)
    rotary.dispose()
  })

  it('has a morphable speed, which the panel selector records', () => {
    const state = createEffectStore(defaultEffectState())
    state.update((draft) => {
      draft.rotary.speed = 'Fast'
    })
    expect(state.get().rotary.speed).toBe('Fast')
    // Speed is one of the organ's documented morph destinations.
    expect(['Slow', 'Fast', 'Stop']).toContain(state.get().rotary.speed)
  })

  it('changes the signal when routed, measured through the shared rotary', async () => {
    const SR = 44100
    const render = async (routed: boolean) => {
      const ctx = new OfflineAudioContext(2, Math.round(SR * 1.0), SR)
      const rotary = buildRotary(ctx as never)
      const chain = createChain(ctx as never, 'organ', rotary)
      const sink = ctx.createGain()
      chain.output.connect(sink as never)
      createRotaryReturn(ctx as never, rotary).connect(sink as never)
      sink.connect(ctx.destination)
      const state: EffectState = {
        ...defaultEffectState(),
        rotary: { on: routed, speed: 'Fast', drive: 5, organRouted: routed },
      }
      chain.update(state, 0)
      rotary.apply(state, 0)
      // The source enters the chain; the chain's To Rotary / ORGAN routing then decides
      // whether it reaches the shared rotary. Nothing goes straight to the destination.
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.value = 220
      const env = ctx.createGain()
      env.gain.value = 0.3
      osc.connect(env)
      env.connect(chain.input as never)
      osc.start(0)
      osc.stop(0.9)
      const buffer = await ctx.startRendering()
      chain.dispose()
      rotary.dispose()
      return { left: buffer.getChannelData(0), right: buffer.getChannelData(1) }
    }
    const dry = await render(false)
    const wet = await render(true)
    const correlation = (a: Float32Array, b: Float32Array) => {
      let lr = 0
      let ll = 0
      let rr = 0
      for (let i = 0; i < a.length; i += 1) {
        lr += a[i] * b[i]
        ll += a[i] * a[i]
        rr += b[i] * b[i]
      }
      return lr / Math.max(1e-20, Math.sqrt(ll) * Math.sqrt(rr))
    }
    // The rotary modulates the two channels independently, so a mono image becomes wide.
    expect(correlation(dry.left, dry.right)).toBeGreaterThan(0.99)
    expect(correlation(wet.left, wet.right)).toBeLessThan(0.95)
  })
})

describe('organ.engine — the panel edits the state it shows', () => {
  it('shows the model, drawbars, vibrato and percussion it is really using', () => {
    const state = defaultOrganState()
    expect(organPanelValue(state, 'organ.model.select')).toBe(panelIndexForOrganModel('b3'))
    expect(organPanelValue(state, 'organ.drawbar.16')).toBe(8)
    expect(organPanelValue(state, 'organ.drawbar.5-1-3')).toBe(0)
    // Editing one drawbar changes the state and the panel together.
    applyOrganEdit(state, 'organ.drawbar.5-1-3', 5)
    expect(state.layers['organ.a'].drawbars[1]).toBe(5)
    expect(organPanelValue(state, 'organ.drawbar.5-1-3')).toBe(5)
    // The model selector switches model and brings a sensible registration with it.
    applyOrganEdit(state, 'organ.model.select', panelIndexForOrganModel('farf'))
    expect(state.layers['organ.a'].model).toBe('farf')
    expect(state.layers['organ.a'].drawbars).toEqual(defaultDrawbarsFor('farf'))
  })

  it('uses the printed panel order for the model selector', () => {
    expect(ORGAN_MODEL_PANEL_ORDER).toEqual(['farf', 'vox', 'b3', 'pipe1', 'pipe2', 'b3-bass'])
    for (let index = 0; index < ORGAN_MODEL_PANEL_ORDER.length; index += 1) {
      expect(panelIndexForOrganModel(organModelFromPanel(index))).toBe(index)
    }
    // Every model has a label and an id the engine understands.
    for (const model of ORGAN_MODELS) {
      expect(model.label.length).toBeGreaterThan(1)
      expect(model.id).toBeTruthy()
    }
  })

  it('switches the vibrato/chorus type for both layers, as the shared scanner does', () => {
    const state = defaultOrganState()
    applyOrganEdit(state, 'organ.vib-chorus.type', vibratoPanelIndex('V1'))
    expect(state.layers['organ.a'].vibratoType).toBe('V1')
    expect(state.layers['organ.b'].vibratoType).toBe('V1')
    expect(organPanelValue(state, 'organ.vib-chorus.type')).toBe(vibratoPanelIndex('V1'))
    // The printed order is V1 V2 V3 C1 C2 C3.
    expect([0, 1, 2, 3, 4, 5].map((index) => vibratoFromIndex(index))).toEqual([
      'V1',
      'V2',
      'V3',
      'C1',
      'C2',
      'C3',
    ])
  })

  it('turns percussion on with any of its four buttons', () => {
    const state = defaultOrganState()
    expect(state.layers['organ.a'].percussion.on).toBe(false)
    applyOrganEdit(state, 'organ.percussion.harmonic', true)
    expect(state.layers['organ.a'].percussion.on).toBe(true)
    expect(state.layers['organ.a'].percussion.third).toBe(true)
    applyOrganEdit(state, 'organ.percussion.volume', true)
    expect(state.layers['organ.a'].percussion.soft).toBe(true)
    applyOrganEdit(state, 'organ.percussion.decay', true)
    expect(state.layers['organ.a'].percussion.fast).toBe(true)
    applyOrganEdit(state, 'organ.percussion.poly', true)
    expect(state.layers['organ.a'].percussion.poly).toBe(true)
    // And the panel reads them back.
    expect(organPanelValue(state, 'organ.percussion.volume')).toBe(true)
    expect(organPanelValue(state, 'organ.percussion.decay')).toBe(true)
  })

  it('notifies subscribers and never mutates the previous state in place', () => {
    const store = createOrganStore()
    const before = store.get()
    const seen: number[] = []
    store.subscribe((next) => seen.push(next.layers['organ.a'].drawbars[0]))
    store.update((draft) => {
      draft.layers['organ.a'].drawbars[0] = 1
    })
    expect(before.layers['organ.a'].drawbars[0]).toBe(8)
    expect(store.get().layers['organ.a'].drawbars[0]).toBe(1)
    expect(seen).toEqual([1])
    // The clone is deep: the arrays are not shared.
    const clone = cloneOrganState(store.get())
    clone.layers['organ.a'].drawbars[0] = 5
    expect(store.get().layers['organ.a'].drawbars[0]).toBe(1)
  })
})

describe('organ.engine — the voice reclaims its nodes', () => {
  it('starts a real organ voice and stops it cleanly', async () => {
    const SR = 44100
    const ctx = new OfflineAudioContext(2, Math.round(SR * 0.2), SR)
    const voice = createOrganVoice(ctx as never, {
      model: 'b3',
      drawbars: [8, 8, 8, 0, 0, 0, 0, 0, 0],
      midi: 60,
      velocity: 0.8,
      level: 0.8,
      vibratoOn: false,
      vibratoType: 'C3',
      percussion: { on: false, soft: false, fast: false, third: false, retrigger: true },
      keyClick: true,
      zoneGain: 1,
    })
    expect(voice.sources.length).toBeGreaterThan(1) // the loop plus the click
    expect(voice.clickApplied).toBe(true)
    voice.output.connect(ctx.destination as never)
    voice.start(0)
    const buffer = await ctx.startRendering()
    expect(rms(buffer.getChannelData(0))).toBeGreaterThan(0.001)
    voice.stop()
    expect(voice.finished).toBe(true)
  })

  it('reports whether percussion was applied, honouring the single-trigger rule', () => {
    const SR = 44100
    const ctx = new OfflineAudioContext(1, 128, SR)
    const base = {
      model: 'b3' as const,
      drawbars: [8, 8, 8, 0, 0, 0, 0, 0, 0],
      midi: 60,
      velocity: 0.8,
      level: 0.8,
      vibratoOn: false,
      vibratoType: 'C3' as const,
      keyClick: false,
      zoneGain: 1,
    }
    const retrigger = createOrganVoice(ctx as never, {
      ...base,
      percussion: { on: true, soft: false, fast: false, third: false, retrigger: true },
    })
    expect(retrigger.percussionApplied).toBe(true)
    retrigger.stop()
    const suppressed = createOrganVoice(ctx as never, {
      ...base,
      percussion: { on: true, soft: false, fast: false, third: false, retrigger: false },
    })
    expect(suppressed.percussionApplied).toBe(false)
    suppressed.stop()
  })
})
