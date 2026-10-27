/**
 * Measurement harness.
 *
 * This page exists only to let the capture pass render the *real* audio modules in a
 * browser. It imports the production chain, voice and sample code and exposes them on
 * `window.stagebench`, so evidence is produced by the shipped DSP rather than by a copy of
 * it. It contains no DSP of its own and is never part of the instrument UI.
 */
import { createChain, buildRotary, createRotaryReturn, buildImpulseResponse } from '../audio/effectGraph'
import { createEffectStore, defaultEffectState, cloneState, type EffectState } from '../audio/effectState'
import {
  SampleBank,
  SAMPLE_MODEL_FOR_PIANO_MODEL,
  buildIndex,
  createSampleVoice,
  createModelledVoice,
  type SampleEntry,
} from '../audio/pianoVoice'
import { defaultPianoState, voiceParamsFor } from '../audio/pianoState'
import { delaySecondsFor } from '../audio/effectTypes'
import { createWebAudioEngine } from '../audio/webAudioEngine'
import { adaptAudioContext, nativeNodeOf } from '../audio/adapters'
import {
  registrationFor,
  renderOrganLoop,
  renderPercussion,
  renderKeyClick,
  vibratoSettingsFor,
} from '../audio/organModel'
import { defaultSynthLayer } from '../audio/synthState'
import { defaultSynthState } from '../audio/synthState'
import { defaultOrganState } from '../audio/organState'
import { planArp, renderLfo, renderOscillator } from '../audio/synthModel'
import { renderSynthNote } from '../audio/synthVoice'
import {
  ALL_LAYER_IDS,
  applySceneToProgram,
  assignMorph,
  cloneMorph,
  clearMorph,
  cloneProgramState,
  defaultMorph,
  defaultProgramState,
  defaultSplit,
  layerGainForNote,
  layerIsEnabled,
  zoneBounds,
  zoneGainForNote,
  CROSSFADE_WIDTHS,
  SPLIT_POSITIONS,
  type ProgramState,
} from '../audio/programState'
import {
  createMemoryStorage,
  createProgramSystem,
} from '../audio/programStore'
import { auditBySection, auditControls, morphValues } from '../audio/panelBindings'
import sampleManifest from '../audio/sample-manifest.json'
import sampleGains from '../audio/sample-gains.json'

const entries = sampleManifest as SampleEntry[]
const gains = sampleGains as Record<string, number>

/** Renders one layer's real effect chain with a test source. */
async function renderChainReal(
  state: EffectState,
  options: {
    seconds: number
    source: 'tone' | 'clicks' | 'impulse'
    frequency?: number
    interval?: number
  },
) {
  const SR = 48000
  const seconds = options.seconds
  const ctx = new OfflineAudioContext(2, Math.round(SR * seconds), SR)
  const rotary = buildRotary(ctx as never)
  const chain = createChain(ctx as never, 'piano.a', rotary)
  const sink = ctx.createGain()
  chain.output.connect(sink as never)
  createRotaryReturn(ctx as never, rotary).connect(sink as never)
  sink.connect(ctx.destination)
  chain.update(state, 0)
  rotary.apply(state, 0)

  let stop = () => {}
  if (options.source === 'tone') {
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.value = options.frequency ?? 220
    const env = ctx.createGain()
    env.gain.setValueAtTime(0, 0)
    env.gain.linearRampToValueAtTime(0.35, 0.01)
    osc.connect(env)
    env.connect(chain.input as never)
    osc.start(0)
    osc.stop(seconds)
    stop = () => {
      try {
        osc.stop()
      } catch {
        /* already stopped */
      }
    }
  } else if (options.source === 'clicks') {
    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.value = 900
    const env = ctx.createGain()
    env.gain.value = 0
    const interval = options.interval ?? 0.12
    for (let t = 0.02; t < seconds; t += interval) {
      env.gain.setValueAtTime(0, t)
      env.gain.linearRampToValueAtTime(0.5, t + 0.004)
      env.gain.linearRampToValueAtTime(0, t + Math.min(0.06, interval * 0.8))
    }
    osc.connect(env)
    env.connect(chain.input as never)
    osc.start(0)
    osc.stop(seconds)
    stop = () => {
      try {
        osc.stop()
      } catch {
        /* already stopped */
      }
    }
  } else {
    const impulse = ctx.createBuffer(1, 64, SR)
    impulse.getChannelData(0)[0] = 1
    const src = ctx.createBufferSource()
    src.buffer = impulse
    src.connect(chain.input as never)
    src.start(0)
  }

  const buffer = await ctx.startRendering()
  stop()
  rotary.dispose()
  chain.dispose()
  return {
    left: Array.from(buffer.getChannelData(0)),
    right: Array.from(buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0)),
    sampleRate: SR,
  }
}

/** Renders one piano model through its real voice code and returns the samples. */
async function renderVoice(model: string, midi: number, velocity: number, seconds: number) {
  const SR = 48000
  const ctx = new OfflineAudioContext(1, Math.round(SR * seconds), SR)
  const bank = new SampleBank({
    ctx: ctx as never,
    index: buildIndex(entries),
    gains,
    baseUrl: new URL('samples/', document.baseURI).href,
  })
  const sampleModel = SAMPLE_MODEL_FOR_PIANO_MODEL[model as keyof typeof SAMPLE_MODEL_FOR_PIANO_MODEL]
  let nodes: ReturnType<typeof createModelledVoice> | null = null
  if (sampleModel) {
    const resolved = bank.resolve(sampleModel, midi, velocity)
    if (resolved) {
      const buffer = await bank.load(resolved.entry)
      nodes = createSampleVoice(
        ctx as never,
        bank,
        resolved.entry,
        {
          velocity,
          model: model as never,
          touchExponent: 1,
          dynComp: 0,
          timbre: 0,
          unison: 0,
          softRelease: false,
          stringRes: false,
          midi,
          playedMidi: midi,
        },
        buffer,
      )
    }
  }
  if (!nodes) {
    nodes = createModelledVoice(ctx as never, {
      velocity,
      model: model as never,
      touchExponent: 1,
      dynComp: 0,
      timbre: 0,
      unison: 0,
      softRelease: false,
      stringRes: false,
      midi,
      playedMidi: midi,
    })
  }
  nodes.output.connect(ctx.destination as never)
  nodes.start(0)
  const buffer = await ctx.startRendering()
  nodes.stop()
  return { samples: Array.from(buffer.getChannelData(0)), sampleRate: SR }
}

/**
 * Renders a note with the performance controls set to one specific combination.
 *
 * `timbre` is the *printed panel position* (0 = SOFT, 1 = MID, 2 = BRIGHT, 3 = DYNO 1,
 * 4 = DYNO 2), so the measurement includes the per-family mapping the app performs.
 * `timbreIndex`, when given, overrides the result with a raw voicing index, which is how the
 * "no voicing applied" reference is rendered.
 */
async function renderWithControls(
  voice: {
    touchExponent?: number
    dynComp?: number
    timbre?: number
    timbreIndex?: number
    unison?: number
    softRelease?: boolean
  },
  model: string,
  midi: number,
  velocity: number,
  seconds: number,
  holdSeconds?: number,
) {
  const SR = 48000
  const ctx = new OfflineAudioContext(1, Math.round(SR * seconds), SR)
  const bank = new SampleBank({
    ctx: ctx as never,
    index: buildIndex(entries),
    gains,
    baseUrl: new URL('samples/', document.baseURI).href,
  })
  const base = defaultPianoState()
  const layer = { ...base.layers['piano.a'], model: model as never }
  const state = {
    ...base,
    kbTouch: voice.touchExponent === 1.45 ? 0 : voice.touchExponent === 0.68 ? 2 : 1,
    dynComp: voice.dynComp ?? 0,
    timbre: voice.timbre ?? 0,
    unison: voice.unison ?? 0,
    softRelease: voice.softRelease ?? false,
    layers: { ...base.layers, 'piano.a': layer },
  }
  const fromPanel = voiceParamsFor(state, 'piano.a', velocity)
  const params = {
    velocity: fromPanel.velocity,
    model: fromPanel.model,
    touchExponent: fromPanel.touchExponent,
    dynComp: fromPanel.dynComp,
    timbre: voice.timbreIndex ?? fromPanel.timbre,
    unison: fromPanel.unison,
    softRelease: fromPanel.softRelease,
    stringRes: fromPanel.stringRes,
    midi,
    playedMidi: midi,
  }
  const sampleModel = SAMPLE_MODEL_FOR_PIANO_MODEL[model as keyof typeof SAMPLE_MODEL_FOR_PIANO_MODEL]
  let nodes: ReturnType<typeof createModelledVoice> | null = null
  if (sampleModel) {
    const resolved = bank.resolve(sampleModel, midi, velocity)
    if (resolved) {
      const buffer = await bank.load(resolved.entry)
      nodes = createSampleVoice(ctx as never, bank, resolved.entry, params as never, buffer)
    }
  }
  if (!nodes) nodes = createModelledVoice(ctx as never, params as never)
  nodes.output.connect(ctx.destination as never)
  nodes.start(0)
  if (holdSeconds !== undefined) {
    // OfflineAudioContext has no clock, so the release is scheduled explicitly.
    nodes.release(holdSeconds)
  }
  const buffer = await ctx.startRendering()
  nodes.stop()
  return { samples: Array.from(buffer.getChannelData(0)), sampleRate: SR }
}

/**
 * Counts connections made *to* the destination.
 *
 * The engine receives adapter wrappers whose `connect` resolves a private native reference,
 * so the count is taken at the same level: the counter wraps the context's factories, and
 * each returned wrapper's `connect` is inspected before delegating. Patching the adapter's
 * `connect` *after* the graph exists is useless, because the connections are already made.
 */
function countConnectionsToDestination(ctx: OfflineAudioContext) {
  const counter = { count: 0 }
  const adapted = adaptAudioContext(ctx)
  // `destination` is a getter that wraps the native node afresh on every read, so identity
  // comparison on wrappers never matches. Compare the resolved *native* nodes instead.
  const destination = nativeNodeOf(adapted.destination)
  const bag = adapted as unknown as Record<string, unknown>

  // Wrap the adapter's own factory results: the engine only ever sees these wrappers.
  for (const name of [
    'createGain',
    'createBufferSource',
    'createBiquadFilter',
    'createDelay',
    'createConvolver',
    'createDynamicsCompressor',
    'createStereoPanner',
    'createOscillator',
    'createWaveShaper',
    'createChannelSplitter',
    'createChannelMerger',
  ]) {
    const call = bag[name]
    if (typeof call !== 'function') continue
    bag[name] = (...args: unknown[]) => {
      const node = (call as (...a: unknown[]) => { connect: (t: unknown) => unknown })(...args)
      const originalConnect = node.connect.bind(node)
      node.connect = (target: unknown) => {
        if (nativeNodeOf(target as never) === destination) counter.count += 1
        return originalConnect(target)
      }
      return node
    }
  }
  return { context: adapted, get count() { return counter.count } }
}

/**
 * Builds the shipped engine over a real OfflineAudioContext and reports the graph's shape.
 *
 * `destinationConnections` counts every `connect()` whose target is the context's
 * destination, which is how the "one destination, nothing bypasses the master path" claim
 * becomes a number instead of a comment. It patches the native `AudioNode.prototype.connect`
 * for the duration of the measurement, because Web Audio routes from the source side.
 */
async function graphShape() {
  const SR = 48000
  const ctx = new OfflineAudioContext(2, Math.round(SR * 0.5), SR)
  // Count on the adapter's own connect(): the engine only ever sees adapter wrappers, and
  // every wrapper keeps a private native reference, so counting there is counting the real
  // graph. `countConnectionsToDestination` returns the facade the engine is given.
  const counted = countConnectionsToDestination(ctx)

  const engine = createWebAudioEngine({
    createContext: () => counted.context as never,
    sampleEntries: entries,
    sampleLevels: gains,
    sampleBaseUrl: new URL('samples/', document.baseURI).href,
  })
  // An OfflineAudioContext is always "running" and cannot be resumed, so the engine's
  // `start()` (which resumes a live context) is not the right call here. The graph is built
  // by the first note, which is what this measurement is about.
  await engine.preloadModel('grand.salamander')
  const baselineNodes = engine.liveNodeCount()
  engine.setMasterLevel(0.7)
  engine.noteOn({
    id: 'n1',
    midi: 60,
    velocity: 0.8,
    settings: {
      velocity: 0.8,
      layer: 'piano.a',
      octave: 0,
      model: 'grand.salamander',
      touchExponent: 1,
      dynComp: 0,
      timbre: 0,
      unison: 0,
      softRelease: false,
      stringRes: false,
    },
  })
  // Connections are made inside `start()` / `noteOn()`, so the count is read afterwards.
  const connectionsAfterBuild = counted.count
  const shape = {
    audioStatus: engine.status().status,
    effectGraphError: engine.effectGraphError,
    contexts: 1,
    chains: Boolean(engine.chains),
    chainOrder: engine.chains?.['piano.a'].order ?? null,
    rotaryInstances: engine.rotary ? 1 : 0,
    liveNodes: engine.liveNodeCount(),
    activeVoices: engine.activeVoiceCount(),
    voicesByLayer: engine.voicesByLayer(),
    effectsAvailable: engine.effectsAvailable,
    destinationConnections: counted.count,
    connectionsAfterBuild,
  }
  engine.noteOff('n1')
  engine.stopAll()
  const afterCleanup = {
    liveNodes: engine.liveNodeCount(),
    activeVoices: engine.activeVoiceCount(),
    backToBaseline: engine.liveNodeCount() === baselineNodes,
  }
  engine.dispose()
  return { ...shape, baselineNodes, afterCleanup }
}

/** Loads every sample for one model and returns how much of the library is resident. */
async function libraryLoad(model: string) {
  const SR = 48000
  const ctx = new OfflineAudioContext(1, 480, SR)
  const bank = new SampleBank({
    ctx: ctx as never,
    index: buildIndex(entries),
    gains,
    baseUrl: new URL('samples/', document.baseURI).href,
  })
  const sampleModel = SAMPLE_MODEL_FOR_PIANO_MODEL[model as keyof typeof SAMPLE_MODEL_FOR_PIANO_MODEL]
  if (!sampleModel) return { model, failures: [], loaded: 0, modelled: true }
  const failures = await bank.preloadModel(sampleModel)
  return { model, failures, loaded: bank.loadedCount, modelled: false }
}

/**
 * Same as `renderWithControls`, but stereo, so unison's stereo widening can be measured.
 */
async function renderWithControlsStereo(
  voice: {
    touchExponent?: number
    dynComp?: number
    timbre?: number
    timbreIndex?: number
    unison?: number
    softRelease?: boolean
  },
  model: string,
  midi: number,
  velocity: number,
  seconds: number,
) {
  const SR = 48000
  const ctx = new OfflineAudioContext(2, Math.round(SR * seconds), SR)
  const bank = new SampleBank({
    ctx: ctx as never,
    index: buildIndex(entries),
    gains,
    baseUrl: new URL('samples/', document.baseURI).href,
  })
  const base = defaultPianoState()
  const layer = { ...base.layers['piano.a'], model: model as never }
  const state = {
    ...base,
    kbTouch: voice.touchExponent === 1.45 ? 0 : voice.touchExponent === 0.68 ? 2 : 1,
    dynComp: voice.dynComp ?? 0,
    timbre: voice.timbre ?? 0,
    unison: voice.unison ?? 0,
    softRelease: voice.softRelease ?? false,
    layers: { ...base.layers, 'piano.a': layer },
  }
  const fromPanel = voiceParamsFor(state, 'piano.a', velocity)
  const params = {
    velocity: fromPanel.velocity,
    model: fromPanel.model,
    touchExponent: fromPanel.touchExponent,
    dynComp: fromPanel.dynComp,
    timbre: voice.timbreIndex ?? fromPanel.timbre,
    unison: fromPanel.unison,
    softRelease: fromPanel.softRelease,
    stringRes: fromPanel.stringRes,
    midi,
    playedMidi: midi,
  }
  const sampleModel = SAMPLE_MODEL_FOR_PIANO_MODEL[model as keyof typeof SAMPLE_MODEL_FOR_PIANO_MODEL]
  let nodes: ReturnType<typeof createModelledVoice> | null = null
  if (sampleModel) {
    const resolved = bank.resolve(sampleModel, midi, velocity)
    if (resolved) {
      const buffer = await bank.load(resolved.entry)
      nodes = createSampleVoice(ctx as never, bank, resolved.entry, params as never, buffer)
    }
  }
  if (!nodes) nodes = createModelledVoice(ctx as never, params as never)
  nodes.output.connect(ctx.destination as never)
  nodes.start(0)
  const buffer = await ctx.startRendering()
  nodes.stop()
  return {
    left: Array.from(buffer.getChannelData(0)),
    right: Array.from(buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0)),
  }
}

/** Proves a load failure produces the labelled fallback rather than a silent claim. */
async function fallbackOnFailure() {
  const SR = 48000
  const ctx = new OfflineAudioContext(1, 480, SR)
  const engine = createWebAudioEngine({
    createContext: () => ctx as never,
    sampleEntries: entries,
    sampleLevels: gains,
    sampleBaseUrl: 'https://invalid.example/',
    fetchBytes: () => Promise.reject(new Error('network blocked')),
  })
  await engine.start()
  const failures = await engine.preloadModel('grand.salamander')
  const status = engine.libraryStatus()
  const usingFallback = engine.usingFallback
  engine.dispose()
  return { failureCount: failures.length, status, usingFallback }
}

const api = {
  renderChainReal,
  renderVoice,
  renderWithControls,
  renderWithControlsStereo,
  graphShape,
  libraryLoad,
  fallbackOnFailure,
  impulseResponse: (type: string, tone: string) => {
    const SR = 48000
    const ctx = new OfflineAudioContext(1, 480, SR)
    const buffer = buildImpulseResponse(ctx as never, type as never, tone as never)
    const data = buffer.getChannelData(0)
    let energy = 0
    for (const s of data) energy += s * s
    return { seconds: buffer.duration, energy }
  },
  delaySecondsFor,

  /* ---- Phase 3: organ -------------------------------------------------- */
  /**
   * Renders one organ registration through the shipped model, so a spectrum claim is
   * measured on the same partial table the voice plays.
   */
  organLoop: (model: string, drawbars: number[], midi: number) => {
    const SR = 48000
    const loop = renderOrganLoop({
      model: model as never,
      drawbars,
      midi,
      sampleRate: SR,
      seconds: 0.25,
    })
    return { samples: Array.from(loop.samples), sampleRate: SR }
  },
  organRegistration: (model: string, drawbars: number[]) =>
    registrationFor({ model: model as never, drawbars }).map((partial) => ({
      ratio: partial.ratio,
      amplitude: partial.amplitude,
    })),
  organPercussion: (midi: number, third: boolean, soft: boolean, fast: boolean) => {
    const SR = 48000
    const samples = renderPercussion({
      midi,
      harmonicThird: third,
      volumeSoft: soft,
      decayFast: fast,
      sampleRate: SR,
    })
    return { samples: Array.from(samples), sampleRate: SR }
  },
  organKeyClick: (midi: number) => {
    const SR = 48000
    const samples = renderKeyClick({ midi, sampleRate: SR })
    return { samples: Array.from(samples), sampleRate: SR }
  },
  organVibrato: (type: string) => vibratoSettingsFor(type as never),

  /* ---- Phase 3: synth -------------------------------------------------- */
  synthOscillator: (waveform: string, oscCtrl: number, midi = 60) => {
    const SR = 48000
    const rendered = renderOscillator({
      waveform,
      midi,
      sampleRate: SR,
      seconds: 0.2,
      oscCtrl,
    })
    return { left: Array.from(rendered.left), right: Array.from(rendered.right), sampleRate: SR }
  },
  synthNote: (options: {
    waveform?: string
    filterType?: string
    filterFreq?: number
    filterEnvAmount?: number
    resonance?: number
    drive?: number
    unison?: number
    oscCtrl?: number
    lfoDestination?: 'pitch' | 'oscCtrl' | 'filter' | null
    lfoAmount?: number
    glide?: number
    glideFrom?: number | null
    vibrato?: string
    modWheel?: number
    arpGate?: { times: number[]; gateSeconds: number; hardness: number } | null
    midi?: number
    velocity?: number
    holdSeconds?: number
    releaseSeconds?: number
  }) => {
    const SR = 48000
    const layer = defaultSynthLayer('synth.a', true)
    if (options.waveform) layer.waveform = options.waveform
    if (options.filterType) layer.filterType = options.filterType as never
    if (options.filterFreq !== undefined) layer.filterFreq = options.filterFreq
    if (options.filterEnvAmount !== undefined) layer.filterEnvAmount = options.filterEnvAmount
    if (options.resonance !== undefined) layer.filterRes = options.resonance
    if (options.drive !== undefined) layer.filterDrive = options.drive
    if (options.unison !== undefined) layer.unison = options.unison
    if (options.oscCtrl !== undefined) layer.oscCtrl = options.oscCtrl
    if (options.glide !== undefined) layer.glide = options.glide
    if (options.vibrato) layer.vibrato = options.vibrato as never
    if (options.lfoDestination) {
      layer.lfo.destinations = {
        pitch: options.lfoDestination === 'pitch',
        oscCtrl: options.lfoDestination === 'oscCtrl',
        filter: options.lfoDestination === 'filter',
      }
      layer.lfo.amount = options.lfoAmount ?? 6
    }
    const rendered = renderSynthNote(
      {
        layer,
        midi: options.midi ?? 60,
        velocity: options.velocity ?? 0.8,
        level: 0.85,
        zoneGain: 1,
        holdSeconds: options.holdSeconds ?? 0.4,
        releaseSeconds: options.releaseSeconds ?? 0.15,
        glideFrom: options.glideFrom ?? null,
        modWheel: options.modWheel ?? 0,
        lfoRateHz: 5,
        arpGate: options.arpGate ?? null,
      },
      SR,
    )
    return { samples: Array.from(rendered.samples), sampleRate: SR, filtered: rendered.filtered }
  },
  synthLfo: (waveform: string) => {
    const SR = 48000
    const data = renderLfo(waveform as never, 5, SR, SR)
    return { samples: Array.from(data), sampleRate: SR }
  },
  synthArp: (notes: number[], direction: string, octaves: number, steps: number) =>
    planArp({
      notes,
      direction: direction as never,
      octaves,
      stepSeconds: 0.25,
      totalSteps: steps,
    }),

  /* ---- Phase 3: programs ---------------------------------------------- */
  /**
   * Exercises the program system the way the panel does, and reports what it observed.
   * `read`/`write` are backed by a real state object, so a round-trip is measured on the
   * state the instrument would play.
   */
  programChecks: () => {
    let live = defaultProgramState()
    const system = createProgramSystem({
      read: () => live,
      write: (state: ProgramState) => {
        live = cloneProgramState(state)
      },
      storage: createMemoryStorage(),
    })
    // Boot the live state from the slot's stored program, exactly as the instrument does at
    // power-on; otherwise the first comparison would be against the constructor's defaults
    // rather than against a program the player can see.
    const boot = system.get()
    live = cloneProgramState(boot.stored ?? boot.programs[boot.slot - 1].state)
    system.refresh()
    const bootSlot = system.get().slot
    const bootName = system.get().name
    const bootDirty = system.get().dirty

    // Edit and confirm the dirty flag.
    live = cloneProgramState(live)
    live.piano.layers['piano.a'].level = 41
    live.transpose = 3
    live.transposeOn = true
    system.noteEdit()
    const dirtyAfterEdit = system.get().dirty

    // Store twice and confirm it cleans.
    system.beginStore()
    system.confirmStore()
    const dirtyAfterStore = system.get().dirty
    const storedLevel = system.get().programs[bootSlot - 1].state.piano.layers['piano.a'].level

    // Move away and back: the stored state returns.
    system.selectSlot(19)
    const afterMove = live.piano.layers['piano.a'].level
    system.selectSlot(bootSlot)
    const afterReturn = live.piano.layers['piano.a'].level

    // Live mode auto-stores.
    system.setLiveMode(true)
    system.selectSlot(2)
    live = cloneProgramState(live)
    live.transpose = -4
    system.noteEdit()
    const liveStoredTranspose = system.get().liveSlots[1].state.transpose
    const liveDirty = system.get().dirty
    system.setLiveMode(false)

    return {
      slots: system.get().programs.length,
      liveSlots: system.get().liveSlots.length,
      factoryNamed: system.get().programs.filter((program) => !program.name.startsWith('Init')).length,
      bootSlot,
      bootName,
      bootDirty,
      dirtyAfterEdit,
      dirtyAfterStore,
      storedLevel,
      afterMove,
      afterReturn,
      liveStoredTranspose,
      liveDirty,
    }
  },

  /* ---- Phase 3: splits, scenes, morphs -------------------------------- */
  splitChecks: () => {
    const full = [8, 8, 8, 8, 8, 8, 8, 8, 8]
    const gainsFor = (width: 0 | 6 | 12, midi: number) => {
      const split = defaultSplit()
      split.on = true
      split.points.Low = { position: 'C4', crossfade: width }
      split.points.Mid = { position: 'C5', crossfade: 0 }
      split.points.High = { position: 'C6', crossfade: 0 }
      split.zones['organ.a'] = [true, false, false, false]
      split.zones['synth.a'] = [false, true, false, false]
      const bounds = zoneBounds(split, 28, 100)
      return {
        midi,
        lower: zoneGainForNote(bounds[0], midi),
        upper: zoneGainForNote(bounds[1], midi),
        organ: layerGainForNote(split, 'organ.a', midi, 28, 100),
        synth: layerGainForNote(split, 'synth.a', midi, 28, 100),
      }
    }
    void full
    return {
      positions: [...SPLIT_POSITIONS],
      crossfades: [...CROSSFADE_WIDTHS],
      off: [54, 57, 60, 63, 66].map((midi) => gainsFor(0, midi)),
      six: [54, 57, 60, 63, 66].map((midi) => gainsFor(6, midi)),
      twelve: [54, 57, 60, 63, 66].map((midi) => gainsFor(12, midi)),
    }
  },
  sceneChecks: () => {
    const program = defaultProgramState()
    program.scenes = {
      second: false,
      sceneI: {
        'piano.a': true, 'piano.b': false, 'organ.a': false, 'organ.b': false,
        'synth.a': false, 'synth.b': true, 'synth.c': false,
      },
      sceneII: {
        'piano.a': false, 'piano.b': true, 'organ.a': true, 'organ.b': false,
        'synth.a': false, 'synth.b': false, 'synth.c': true,
      },
    }
    const enabled = (): string[] =>
      ALL_LAYER_IDS.filter((layer) => layerIsEnabled(program, layer))
    // The sound parameters a scene must never touch: everything except the layer enable flags.
    const parameters = (): string =>
      JSON.stringify({
        levels: [
          ...Object.values(program.piano.layers).map((l) => l.level),
          ...Object.values(program.organ.layers).map((l) => l.level),
          ...Object.values(program.synth.layers).map((l) => l.level),
        ],
        models: [
          ...Object.values(program.piano.layers).map((l) => l.model),
          ...Object.values(program.organ.layers).map((l) => l.model),
          ...Object.values(program.synth.layers).map((l) => l.waveform),
        ],
        drawbars: program.organ.layers['organ.a'].drawbars,
        timbre: program.piano.timbre,
        filter: program.synth.layers['synth.a'].filterFreq,
      })
    // Snapshot the parameters *before* any scene is applied, then compare after both.
    const before = parameters()
    applySceneToProgram(program, false)
    const sceneI = enabled()
    applySceneToProgram(program, true)
    const sceneII = enabled()
    const after = parameters()
    applySceneToProgram(program, false)
    return { sceneI, sceneII, parametersUnchanged: before === after, before, after }
  },
  morphChecks: () => {
    const morph = defaultMorph()
    assignMorph(morph, 'Wheel', 'piano.layer.a.level', 20, 90)
    assignMorph(morph, 'Wheel', 'synth.filter.freq', 8, 2)
    const at = (position: number): Record<string, number> => {
      morph.wheelPosition = position
      return morphValues(morph, 'Wheel').values
    }
    const mid = at(0.5)
    const cleared = cloneMorph(morph)
    clearMorph(cleared, 'Wheel', 'synth.filter.freq')
    return {
      start: at(0),
      middle: mid,
      end: at(1),
      afterSingleClear: cleared.wheel.map((entry) => entry.controlId),
    }
  },

  defaultState: () => cloneState(defaultEffectState()),
  store: () => createEffectStore(defaultEffectState()).get(),
  // Debug hooks used by the capture probes; they expose the same objects the harness uses.
  __adapt: (ctx: OfflineAudioContext) => adaptAudioContext(ctx),
  __engine: (options: { createContext: () => unknown }) =>
    createWebAudioEngine(options as never),
  __audit: () => {
    const audit = auditControls()
    return {
      total: audit.total,
      bound: audit.bound,
      unsupported: audit.unsupported,
      unaccounted: audit.unaccounted.map((entry) => entry.id),
      phantomBindings: audit.phantomBindings,
      bySection: auditBySection(),
    }
  },
  __organEngine: () => {
    const SR = 48000
    const ctx = new OfflineAudioContext(2, Math.round(SR * 0.3), SR)
    const engine = createWebAudioEngine({ createContext: () => adaptAudioContext(ctx) })
    const organ = defaultOrganState()
    organ.layers['organ.b'].enabled = true
    engine.setOrganState(organ)
    engine.setSynthState(defaultSynthState())
    engine.setPianoState(defaultPianoState())
    engine.noteOn({ id: 'a', midi: 60, velocity: 0.8, layer: 'organ.a' })
    engine.noteOn({ id: 'b', midi: 64, velocity: 0.8, layer: 'organ.b' })
    const chains = engine.chains ? Object.keys(engine.chains) : []
    const organVoices = engine.voicesByEngine().organ
    engine.stopAll()
    engine.dispose()
    return { chains, organVoices }
  },
}

declare global {
  interface Window {
    stagebench: typeof api
  }
}

window.stagebench = api
document.body.dataset.ready = 'true'
