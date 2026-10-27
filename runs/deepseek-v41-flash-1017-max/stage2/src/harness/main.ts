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
  // Debug hooks used by the capture probes; they expose the same objects the harness uses.
  __adapt: (ctx: OfflineAudioContext) => adaptAudioContext(ctx),
  __engine: (options: { createContext: () => unknown }) =>
    createWebAudioEngine(options as never),
  defaultState: () => cloneState(defaultEffectState()),
  store: () => createEffectStore(defaultEffectState()).get(),
}

declare global {
  interface Window {
    stagebench: typeof api
  }
}

window.stagebench = api
document.body.dataset.ready = 'true'
