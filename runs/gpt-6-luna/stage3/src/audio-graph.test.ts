import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyDynComp, defaultConfiguration, driveCurve, dryWetGains, EFFECT_TYPE_OPTIONS, SAMPLE_ROOTS, selectedVelocityFile, touchVelocity } from './audio-graph'
import { renderPianoWave, velocityAmplitude, type AudioConfiguration } from './audio'
import { WebAudioPianoGraph } from './audio-graph'
import { createDefaultPatch, SYNTH_WAVEFORMS } from './stage3'

class FakeAudioParam {
  value = 0
  events: Array<{ kind: string; value: number }> = []
  cancelScheduledValues() { this.events.push({ kind: 'cancel', value: this.value }) }
  setValueAtTime(value: number) { this.value = value; this.events.push({ kind: 'set', value }) }
  linearRampToValueAtTime(value: number) { this.value = value; this.events.push({ kind: 'ramp', value }) }
  exponentialRampToValueAtTime(value: number) { this.value = value; this.events.push({ kind: 'exponential', value }) }
}

type FakeConnection = FakeAudioNode | FakeAudioParam

class FakeAudioNode {
  connections: FakeConnection[] = []
  disconnected = false
  connect(destination: FakeConnection) { this.connections.push(destination) }
  disconnect() { this.disconnected = true; this.connections = [] }
}

class FakeGainNode extends FakeAudioNode { gain = new FakeAudioParam() }
class FakeStereoPannerNode extends FakeAudioNode { pan = new FakeAudioParam() }
class FakeWaveShaperNode extends FakeAudioNode { curve: Float32Array | null = null; oversample: OverSampleType = 'none' }
class FakeBiquadFilterNode extends FakeAudioNode {
  type: BiquadFilterType = 'lowpass'
  frequency = new FakeAudioParam()
  Q = new FakeAudioParam()
  gain = new FakeAudioParam()
}
class FakeDelayNode extends FakeAudioNode {
  delayTime = new FakeAudioParam()
  constructor(readonly maxDelayTime: number) { super() }
}
class FakeConvolverNode extends FakeAudioNode { buffer: FakeAudioBuffer | null = null }
class FakeOscillatorNode extends FakeAudioNode {
  type: OscillatorType = 'sine'
  frequency = new FakeAudioParam()
  detune = new FakeAudioParam()
  onended: (() => void) | null = null
  started = false
  stopped = false
  start() { this.started = true }
  stop() { this.stopped = true }
}
class FakeDynamicsCompressorNode extends FakeAudioNode {
  threshold = new FakeAudioParam()
  knee = new FakeAudioParam()
  ratio = new FakeAudioParam()
  attack = new FakeAudioParam()
  release = new FakeAudioParam()
}
class FakeBufferSourceNode extends FakeAudioNode {
  buffer: FakeAudioBuffer | null = null
  loop = false
  playbackRate = new FakeAudioParam()
  detune = new FakeAudioParam()
  onended: (() => void) | null = null
  start() {}
  stopped = false
  stop() { this.stopped = true }
}

class FakeAudioBuffer {
  private readonly channels: Float32Array[]
  constructor(channelCount: number, readonly length: number) { this.channels = Array.from({ length: channelCount }, () => new Float32Array(length)) }
  getChannelData(channel: number) { return this.channels[channel] ?? new Float32Array() }
}

class FakeAudioContext {
  currentTime = 0
  sampleRate = 8000
  state: AudioContextState = 'running'
  readonly destination = new FakeAudioNode()
  readonly nodes: FakeAudioNode[] = []
  createGain() { return this.add(new FakeGainNode()) }
  createStereoPanner() { return this.add(new FakeStereoPannerNode()) }
  createWaveShaper() { return this.add(new FakeWaveShaperNode()) }
  createBiquadFilter() { return this.add(new FakeBiquadFilterNode()) }
  createDelay(maxDelayTime = 1) { return this.add(new FakeDelayNode(maxDelayTime)) }
  createConvolver() { return this.add(new FakeConvolverNode()) }
  createOscillator() { return this.add(new FakeOscillatorNode()) }
  createDynamicsCompressor() { return this.add(new FakeDynamicsCompressorNode()) }
  createBufferSource() { return this.add(new FakeBufferSourceNode()) }
  createBuffer(channels: number, length: number) { return new FakeAudioBuffer(channels, length) }
  resume() { return Promise.resolve() }
  close() { this.state = 'closed'; return Promise.resolve() }
  private add<T extends FakeAudioNode>(node: T): T { this.nodes.push(node); return node }
}

const fakeConstructors: Record<string, unknown> = {
  GainNode: FakeGainNode,
  StereoPannerNode: FakeStereoPannerNode,
  WaveShaperNode: FakeWaveShaperNode,
  BiquadFilterNode: FakeBiquadFilterNode,
  DelayNode: FakeDelayNode,
  ConvolverNode: FakeConvolverNode,
  OscillatorNode: FakeOscillatorNode,
  DynamicsCompressorNode: FakeDynamicsCompressorNode,
}
const globals = globalThis as unknown as Record<string, unknown>
const originalConstructors = new Map<string, unknown>()

function useFakeAudioConstructors() {
  for (const [name, constructor] of Object.entries(fakeConstructors)) {
    originalConstructors.set(name, globals[name])
    globals[name] = constructor
  }
}

function restoreAudioConstructors() {
  for (const [name, constructor] of originalConstructors) {
    if (constructor === undefined) delete globals[name]
    else globals[name] = constructor
  }
  originalConstructors.clear()
}

function newGraph(context: FakeAudioContext) {
  return new WebAudioPianoGraph(() => context as unknown as AudioContext)
}

function rms(samples: Float32Array): number {
  return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length)
}

function processorSignature(nodes: FakeAudioNode[]): string {
  return nodes.map((node) => {
    if (node instanceof FakeBiquadFilterNode) return `filter:${node.type}:${node.frequency.value.toFixed(2)}:${node.Q.value.toFixed(2)}`
    if (node instanceof FakeDelayNode) return `delay:${node.delayTime.value.toFixed(4)}`
    if (node instanceof FakeDynamicsCompressorNode) return `compressor:${node.threshold.value.toFixed(2)}`
    if (node instanceof FakeGainNode) return `gain:${node.gain.value.toFixed(3)}`
    if (node instanceof FakeOscillatorNode) return `osc:${node.type}:${node.frequency.value.toFixed(2)}`
    if (node instanceof FakeStereoPannerNode) return 'stereo-pan'
    if (node instanceof FakeWaveShaperNode) return `shape:${[0, 64, 128, 192, 255, 320, 384, 448, 511].map((index) => node.curve?.[index]?.toFixed(3) ?? 'empty').join(':')}`
    if (node instanceof FakeConvolverNode) return `convolver:${node.buffer?.length ?? 0}`
    return node.constructor.name
  }).join('|')
}

describe('Phase 2 recorded sample library', () => {
  const sampleDirectory = join(process.cwd(), 'public', 'samples')
  const manifest = JSON.parse(readFileSync(join(sampleDirectory, 'library.json'), 'utf8')) as {
    files: Array<{ path: string; instrument: string; root: string; midi: number; velocityLayer: string; bytes: number }>
  }

  it('declares and bundles every selected root and velocity recording', () => {
    expect(manifest.files).toHaveLength(105)
    expect(manifest.files.filter((file) => file.instrument === 'Grand')).toHaveLength(36)
    expect(manifest.files.filter((file) => file.instrument === 'Upright')).toHaveLength(24)
    expect(manifest.files.filter((file) => file.instrument === 'Electric')).toHaveLength(45)
    for (const file of manifest.files) {
      expect(file.bytes).toBeGreaterThan(1000)
      expect(readFileSync(join(sampleDirectory, file.path)).byteLength).toBe(file.bytes)
      expect(file.root).toBeTruthy()
      expect(file.midi).toBeGreaterThan(0)
      expect(file.velocityLayer).toBeTruthy()
    }
  })

  it('keeps recordings distinct and picks their documented nearest root and velocity layer', () => {
    expect(new Set(SAMPLE_ROOTS.Grand.map((root) => root.note)).size).toBe(12)
    expect(new Set(SAMPLE_ROOTS.Upright.map((root) => root.note)).size).toBe(12)
    expect(new Set(SAMPLE_ROOTS.Electric.map((root) => root.note)).size).toBe(15)
    expect(selectedVelocityFile('Grand', 28)).toBe('3')
    expect(selectedVelocityFile('Grand', 72)).toBe('8')
    expect(selectedVelocityFile('Upright', 96)).toBe('hard')
    expect(selectedVelocityFile('Electric', 115)).toBe('5')
    expect(SAMPLE_ROOTS.Clav).toEqual([])
    const grandC3 = readFileSync(join(sampleDirectory, 'grand/C3-v8.ogg'))
    const uprightC3 = readFileSync(join(sampleDirectory, 'upright/C3-vhard.ogg'))
    expect(grandC3.equals(uprightC3)).toBe(false)
    expect(readFileSync(join(sampleDirectory, 'ATTRIBUTION.md'), 'utf8')).toContain('CC BY-NC 4.0')
  })

  it('renders non-silent velocity layers and confirms touch and dynamic compression alter the PCM signal', () => {
    const source = renderPianoWave(60, 12_000, 48_000)
    expect(rms(source)).toBeGreaterThan(0.01)
    const renderAtVelocity = (velocity: number, touch: 'Heavy' | 'Medium' | 'Light', compression: number) => {
      const level = velocityAmplitude(applyDynComp(touchVelocity(velocity, touch), compression))
      return Float32Array.from(source, (sample) => sample * level)
    }
    const heavy = renderAtVelocity(42, 'Heavy', 0)
    const light = renderAtVelocity(42, 'Light', 0)
    const compressed = renderAtVelocity(42, 'Medium', 3)
    const loud = renderAtVelocity(112, 'Medium', 0)
    expect(rms(light)).toBeGreaterThan(rms(heavy))
    expect(rms(compressed)).toBeGreaterThan(rms(renderAtVelocity(42, 'Medium', 0)))
    expect(rms(loud)).toBeGreaterThan(rms(heavy))
    expect(Array.from(light)).not.toEqual(Array.from(heavy))
  })
})

describe('Phase 2 Web Audio graph', () => {
  beforeEach(useFakeAudioConstructors)
  afterEach(restoreAudioConstructors)

  it('builds one ordered two-layer graph that reaches one destination through the limiter', () => {
    const context = new FakeAudioContext()
    const graph = newGraph(context)
    graph.configure(defaultConfiguration())
    const destinationConnections = context.nodes.flatMap((node) => node.connections).filter((node) => node === context.destination)
    expect(destinationConnections).toHaveLength(1)
    const limiter = context.nodes.find((node) => node instanceof FakeDynamicsCompressorNode) as FakeDynamicsCompressorNode
    expect(limiter.ratio.value).toBe(20)
    expect(context.nodes.filter((node) => node instanceof FakeStereoPannerNode).length).toBeGreaterThanOrEqual(2)
    const pianoBuses = context.nodes.filter((node) => node instanceof FakeGainNode && node.connections[0] instanceof FakeBiquadFilterNode && (node.connections[0] as FakeBiquadFilterNode).connections[0] instanceof FakeGainNode)
    expect(pianoBuses).toHaveLength(6)
    for (const bus of pianoBuses) {
      let cursor = (bus.connections[0] as FakeBiquadFilterNode).connections[0]
      for (let index = 0; index < 6; index += 1) {
        expect(cursor).toBeInstanceOf(FakeGainNode)
        const input = cursor as FakeGainNode
        const dryPath = input.connections[0] as FakeGainNode
        const output = dryPath.connections[0] as FakeGainNode
        cursor = output.connections[0]
      }
      expect(cursor).toBeInstanceOf(FakeWaveShaperNode)
      cursor = (cursor as FakeWaveShaperNode).connections[0]
      expect(cursor).toBeInstanceOf(FakeGainNode)
      cursor = (cursor as FakeGainNode).connections[0]
      expect(cursor).toBeInstanceOf(FakeStereoPannerNode)
      cursor = (cursor as FakeStereoPannerNode).connections[0]
      expect(cursor).toBeInstanceOf(FakeGainNode)
      cursor = (cursor as FakeGainNode).connections[0]
      expect(cursor).toBeInstanceOf(FakeGainNode)
      expect((cursor as FakeGainNode).connections[0]).toBe(limiter)
    }
    graph.dispose()
    expect(context.state).toBe('closed')
    expect(context.nodes.every((node) => node.disconnected || node instanceof FakeOscillatorNode)).toBe(true)
  })

  it('changes layer level, timbre, pitch stick, unison voices, and string resonance at the audio nodes', () => {
    const context = new FakeAudioContext()
    const graph = newGraph(context)
    const configuration = defaultConfiguration()
    configuration.layers.B.enabled = true
    configuration.layers.B.octave = 1
    configuration.performance.timbre = 'Bright'
    configuration.performance.unison = 3
    configuration.performance.stringRes = true
    configuration.masterLevel = 0.5
    graph.configure(configuration)
    const pianoTimbre = context.nodes.find((node) => node instanceof FakeBiquadFilterNode) as FakeBiquadFilterNode
    expect(pianoTimbre.gain.value).toBe(8)
    const master = context.nodes.find((node) => node instanceof FakeGainNode) as FakeGainNode
    expect(master.gain.value).toBeCloseTo(0.5 ** 1.7 * 0.86, 6)
    const baseOscillators = context.nodes.filter((node) => node instanceof FakeOscillatorNode).length
    graph.noteOn('stack', 60, 90, ['A', 'B'])
    expect(context.nodes.filter((node) => node instanceof FakeBufferSourceNode)).toHaveLength(8)
    const voices = context.nodes.filter((node) => node instanceof FakeBufferSourceNode) as FakeBufferSourceNode[]
    expect(voices.some((voice) => Math.abs(voice.detune.value) > 0)).toBe(true)
    expect(voices[0]?.playbackRate.value).toBeCloseTo(1, 6)
    graph.noteOn('second', 64, 78, ['A', 'B'])
    expect(context.nodes.filter((node) => node instanceof FakeOscillatorNode)).toHaveLength(baseOscillators + 2)
    configuration.pitchBend = 2
    graph.configure(configuration)
    expect(voices[0]?.playbackRate.value).toBeGreaterThan(1.1)
    graph.dispose()
  })

  it('creates distinct processors for every listed type and applies live parameters, bypass, and mix', () => {
    const context = new FakeAudioContext()
    const graph = newGraph(context)
    const configuration: AudioConfiguration = defaultConfiguration()
    graph.configure(configuration)
    const signatures: Record<keyof typeof EFFECT_TYPE_OPTIONS, Set<string>> = {
      mod1: new Set(), mod2: new Set(), delay: new Set(), ampEq: new Set(), compressor: new Set(), reverb: new Set(),
    }
    configuration.effects.units.A.mod1.type = 'Tremolo'
    graph.configure(configuration)
    for (const type of EFFECT_TYPE_OPTIONS.mod1) {
      const firstNewNode = context.nodes.length
      configuration.effects.units.A.mod1 = { ...configuration.effects.units.A.mod1, type, on: true, mix: 0.8 }
      graph.configure(configuration)
      const created = context.nodes.slice(firstNewNode)
      signatures.mod1.add(processorSignature(created))
      expect(created.some((node) => node.connections.length > 0)).toBe(true)
    }
    expect(signatures.mod1.size).toBe(EFFECT_TYPE_OPTIONS.mod1.length)
    configuration.effects.units.A.mod2.type = 'Flanger'
    graph.configure(configuration)
    for (const type of EFFECT_TYPE_OPTIONS.mod2) {
      const firstNewNode = context.nodes.length
      configuration.effects.units.A.mod2 = { ...configuration.effects.units.A.mod2, type, on: true, mix: 0.8 }
      graph.configure(configuration)
      signatures.mod2.add(processorSignature(context.nodes.slice(firstNewNode)))
    }
    expect(signatures.mod2.size).toBe(EFFECT_TYPE_OPTIONS.mod2.length)
    configuration.effects.units.A.ampEq.type = 'Twin'
    graph.configure(configuration)
    for (const type of EFFECT_TYPE_OPTIONS.ampEq) {
      const firstNewNode = context.nodes.length
      configuration.effects.units.A.ampEq = { ...configuration.effects.units.A.ampEq, type, on: true, mix: 0.8 }
      graph.configure(configuration)
      signatures.ampEq.add(processorSignature(context.nodes.slice(firstNewNode)))
    }
    expect(signatures.ampEq.size).toBe(EFFECT_TYPE_OPTIONS.ampEq.length)
    configuration.effects.units.A.reverb.type = 'Booth'
    graph.configure(configuration)
    for (const type of EFFECT_TYPE_OPTIONS.reverb) {
      const firstNewNode = context.nodes.length
      configuration.effects.units.A.reverb = { ...configuration.effects.units.A.reverb, type, on: true, mix: 0.8 }
      graph.configure(configuration)
      signatures.reverb.add(processorSignature(context.nodes.slice(firstNewNode)))
    }
    expect(signatures.reverb.size).toBe(EFFECT_TYPE_OPTIONS.reverb.length)
    configuration.effects.units.A.delay = { ...configuration.effects.units.A.delay, on: true, mix: 0.8, time: 0.9, feedback: 0.75, filter: 'LP' }
    configuration.effects.units.A.compressor = { ...configuration.effects.units.A.compressor, on: true, amount: 0.9, fast: true }
    graph.configure(configuration)
    const delay = context.nodes.find((node) => node instanceof FakeDelayNode && node.maxDelayTime === 4) as FakeDelayNode
    expect(delay.delayTime.value).toBeCloseTo(0.89, 2)
    const compressor = context.nodes.find((node) => node instanceof FakeDynamicsCompressorNode && node.threshold.value < -25) as FakeDynamicsCompressorNode
    expect(compressor.threshold.value).toBeCloseTo(-30.8, 1)
    expect(compressor.attack.value).toBe(0.003)
    expect(context.nodes.some((node) => node instanceof FakeBiquadFilterNode && node.type === 'lowpass')).toBe(true)
    const wetDryRamps = context.nodes.filter((node) => node instanceof FakeGainNode).flatMap((node) => [(node as FakeGainNode).gain.value])
    expect(wetDryRamps).toContain(0.8)
    expect(dryWetGains(0.8, true)).toEqual({ dry: 0.19999999999999996, wet: 0.8 })
    expect(dryWetGains(0.8, false)).toEqual({ dry: 1, wet: 0 })
    const dry = new Float32Array([0.2, -0.4, 0.6])
    const wet = new Float32Array([-0.6, 0.4, -0.2])
    const mixed = Float32Array.from(dry, (sample, index) => sample * dryWetGains(0.8, true).dry + (wet[index] ?? 0) * dryWetGains(0.8, true).wet)
    const bypassed = Float32Array.from(dry, (sample, index) => sample * dryWetGains(0.8, false).dry + (wet[index] ?? 0) * dryWetGains(0.8, false).wet)
    expect(rms(mixed)).toBeGreaterThan(0)
    expect(Array.from(mixed)).not.toEqual(Array.from(dry))
    expect(Array.from(bypassed)).toEqual(Array.from(dry))
    const softCurve = driveCurve(0.7, 'soft')
    const brightCurve = driveCurve(0.7, 'bright')
    const smallCurve = driveCurve(0.7, 'small')
    expect(Array.from(softCurve)).not.toEqual(Array.from(brightCurve))
    expect(Array.from(brightCurve)).not.toEqual(Array.from(smallCurve))
    configuration.effects.allBypass = true
    graph.configure(configuration)
    expect(context.nodes.filter((node) => node instanceof FakeGainNode).some((node) => (node as FakeGainNode).gain.value === 1)).toBe(true)
    graph.dispose()
  })
})

describe('Phase 3 engine audio graph', () => {
  beforeEach(useFakeAudioConstructors)
  afterEach(restoreAudioConstructors)

  it('generates four distinct organ spectra and changes partials with drawbar positions', () => {
    const context = new FakeAudioContext()
    const graph = newGraph(context)
    const configuration = defaultConfiguration()
    graph.configure(configuration)
    const patch = createDefaultPatch(configuration)
    patch.organ.layers.A.enabled = true
    patch.organ.layers.A.drawbars = Array(9).fill(8) as number[]
    const signatures: string[] = []
    for (const model of ['B3', 'Vox', 'Farf', 'Pipe 1'] as const) {
      patch.organ.layers.A.model = model
      const before = context.nodes.length
      graph.noteOnStage3(`organ:${model}`, 60, 100, ['organ-A'], patch)
      const partials = context.nodes.slice(before).filter((node): node is FakeOscillatorNode => node instanceof FakeOscillatorNode && node.frequency.value > 100)
      signatures.push(partials.map((node) => `${node.type}:${node.frequency.value.toFixed(2)}`).join('|'))
      expect(partials.length).toBeGreaterThanOrEqual(7)
      graph.noteOffStage3(`organ:${model}`)
      partials.forEach((source) => source.onended?.())
    }
    expect(new Set(signatures).size).toBe(4)

    patch.organ.layers.A.model = 'B3'
    patch.organ.layers.A.drawbars = Array(9).fill(0) as number[]
    patch.organ.layers.A.drawbars[0] = 8
    const firstBefore = context.nodes.length
    graph.noteOnStage3('drawbar:low', 60, 100, ['organ-A'], patch)
    const onePartialCount = context.nodes.slice(firstBefore).filter((node) => node instanceof FakeOscillatorNode && (node as FakeOscillatorNode).frequency.value > 100).length
    graph.noteOffStage3('drawbar:low')
    context.nodes.slice(firstBefore).filter((node): node is FakeOscillatorNode => node instanceof FakeOscillatorNode).forEach((source) => source.onended?.())
    patch.organ.layers.A.drawbars[8] = 8
    const secondBefore = context.nodes.length
    graph.noteOnStage3('drawbar:high', 60, 100, ['organ-A'], patch)
    const twoPartialSignature = context.nodes.slice(secondBefore).filter((node) => node instanceof FakeOscillatorNode && (node as FakeOscillatorNode).frequency.value > 100).map((node) => (node as FakeOscillatorNode).frequency.value)
    graph.noteOffStage3('drawbar:high')
    context.nodes.slice(secondBefore).filter((node): node is FakeOscillatorNode => node instanceof FakeOscillatorNode).forEach((source) => source.onended?.())
    expect(onePartialCount).toBe(1)
    expect(twoPartialSignature).toHaveLength(2)
    graph.dispose()
  })

  it('adds B3 percussion, key click, and vibrato sources to the organ note signal', () => {
    const context = new FakeAudioContext()
    const graph = newGraph(context)
    const configuration = defaultConfiguration()
    graph.configure(configuration)
    const patch = createDefaultPatch(configuration)
    patch.organ.layers.A.enabled = true
    patch.organ.layers.A.model = 'B3'
    patch.organ.layers.A.drawbars = Array(9).fill(4) as number[]
    const baselineStart = context.nodes.length
    graph.noteOnStage3('b3:plain', 60, 100, ['organ-A'], patch)
    const baseline = context.nodes.slice(baselineStart).filter((node) => node instanceof FakeOscillatorNode && (node as FakeOscillatorNode).frequency.value > 100).length
    graph.noteOffStage3('b3:plain')
    context.nodes.slice(baselineStart).filter((node): node is FakeOscillatorNode => node instanceof FakeOscillatorNode).forEach((source) => source.onended?.())
    patch.organ.layers.A.percussionOn = true
    patch.organ.layers.A.keyClick = true
    patch.organ.layers.A.vibratoOn = true
    patch.organ.layers.A.vibratoMode = 'V3'
    const featureStart = context.nodes.length
    graph.noteOnStage3('b3:features', 60, 100, ['organ-A'], patch)
    const featureOscillators = context.nodes.slice(featureStart).filter((node) => node instanceof FakeOscillatorNode)
    expect(featureOscillators.filter((node) => node.frequency.value > 100).length).toBeGreaterThanOrEqual(baseline + 2)
    expect(featureOscillators.some((node) => node.type === 'square' && node.frequency.value > 2500)).toBe(true)
    expect(featureOscillators.some((node) => node.frequency.value > 500 && node.frequency.value < 1000)).toBe(true)
    expect(featureOscillators.some((node) => node.frequency.value > 5 && node.frequency.value < 8)).toBe(true)
    graph.noteOffStage3('b3:features')
    featureOscillators.forEach((source) => source.onended?.())
    graph.dispose()
  })

  it('uses distinct source topologies for every required Synth category and honors Osc Ctrl', () => {
    const context = new FakeAudioContext()
    const graph = newGraph(context)
    const configuration = defaultConfiguration()
    graph.configure(configuration)
    const patch = createDefaultPatch(configuration)
    patch.organ.layers.A.enabled = true
    patch.synth.layers.A.enabled = true
    patch.synth.layers.B.enabled = true
    patch.synth.layers.C.enabled = true
    const signatures: string[] = []
    for (const category of ['Pure', 'Sync', 'Multi', 'Super', 'FM-H'] as const) {
      patch.synth.layers.A.category = category
      patch.synth.layers.A.waveform = SYNTH_WAVEFORMS[category][0]!
      patch.synth.layers.A.oscCtrl = 0.35
      const before = context.nodes.length
      graph.noteOnStage3(`synth:${category}`, 60, 100, ['synth-A'], patch)
      const oscillators = context.nodes.slice(before).filter((node): node is FakeOscillatorNode => node instanceof FakeOscillatorNode)
      signatures.push(oscillators.map((node) => `${node.type}:${node.frequency.value.toFixed(2)}:${node.detune.value.toFixed(2)}`).join('|'))
      expect(oscillators.length).toBeGreaterThan(0)
      graph.noteOffStage3(`synth:${category}`)
      oscillators.forEach((source) => source.onended?.())
    }
    expect(new Set(signatures).size).toBe(5)
    const pure = context.nodes.filter((node) => node instanceof FakeOscillatorNode).slice(0, 1)[0] as FakeOscillatorNode
    patch.synth.layers.A.category = 'Multi'
    patch.synth.layers.A.waveform = 'Multi Saw'
    patch.synth.layers.A.oscCtrl = 0.05
    const lowBefore = context.nodes.length
    graph.noteOnStage3('multi:low', 60, 100, ['synth-A'], patch)
    const lowDetune = context.nodes.slice(lowBefore).filter((node) => node instanceof FakeOscillatorNode).map((node) => (node as FakeOscillatorNode).detune.value)
    graph.noteOffStage3('multi:low')
    context.nodes.slice(lowBefore).filter((node): node is FakeOscillatorNode => node instanceof FakeOscillatorNode).forEach((source) => source.onended?.())
    patch.synth.layers.A.oscCtrl = 0.9
    const highBefore = context.nodes.length
    graph.noteOnStage3('multi:high', 60, 100, ['synth-A'], patch)
    const highDetune = context.nodes.slice(highBefore).filter((node) => node instanceof FakeOscillatorNode).map((node) => (node as FakeOscillatorNode).detune.value)
    graph.noteOffStage3('multi:high')
    context.nodes.slice(highBefore).filter((node): node is FakeOscillatorNode => node instanceof FakeOscillatorNode).forEach((source) => source.onended?.())
    expect(lowDetune).not.toEqual(highDetune)
    expect(pure.type).toBe('sine')
    graph.dispose()
  })

  it('routes Synth filters, envelopes, LFO, voice mode, and cleanup through the shared master path', () => {
    const context = new FakeAudioContext()
    const graph = newGraph(context)
    const configuration = defaultConfiguration()
    graph.configure(configuration)
    const patch = createDefaultPatch(configuration)
    patch.organ.layers.A.enabled = true
    patch.synth.layers.A.enabled = true
    patch.synth.layers.B.enabled = true
    patch.synth.layers.C.enabled = true
    patch.synth.layers.A.filterType = 'LP24'
    patch.synth.layers.A.drive = 3
    patch.synth.layers.A.resonance = 0.84
    patch.synth.layers.A.amplifierEnvelope.attack = 0.4
    patch.synth.layers.A.filterEnvelope.amount = 0.55
    patch.synth.layers.A.lfoDestination = 'Filter Freq'
    patch.synth.layers.A.lfoWaveform = 'Sample & Hold'
    patch.synth.layers.A.lfoAmount = 0.4
    const before = context.nodes.length
    graph.noteOnStage3('synth:first', 60, 100, ['organ-A', 'synth-A', 'synth-B', 'synth-C'], patch)
    const firstNodes = context.nodes.slice(before)
    expect(firstNodes.filter((node) => node instanceof FakeBiquadFilterNode).slice(0, 2).map((node) => (node as FakeBiquadFilterNode).type)).toEqual(['lowpass', 'lowpass'])
    expect(firstNodes.filter((node) => node instanceof FakeBiquadFilterNode).some((node) => (node as FakeBiquadFilterNode).Q.value > 10)).toBe(true)
    expect(firstNodes.some((node) => node instanceof FakeWaveShaperNode && node.curve?.some((value) => Math.abs(value) > 0.01))).toBe(true)
    expect(firstNodes.some((node) => node instanceof FakeGainNode && (node as FakeGainNode).gain.events.some((event) => event.kind === 'ramp'))).toBe(true)
    expect(firstNodes.filter((node) => node instanceof FakeOscillatorNode).length).toBeGreaterThan(0)
    expect(firstNodes.some((node) => node instanceof FakeBufferSourceNode && node.loop)).toBe(true)
    expect(firstNodes.some((node) => node instanceof FakeOscillatorNode && (node as FakeOscillatorNode).frequency.value > 100)).toBe(true)

    patch.synth.layers.A.voiceMode = 'Mono'
    patch.synth.layers.A.filterType = 'HP'
    const secondStart = context.nodes.length
    graph.noteOnStage3('synth:second', 67, 90, ['synth-A'], patch)
    expect(context.nodes.slice(secondStart).find((node) => node instanceof FakeBiquadFilterNode && (node as FakeBiquadFilterNode).type === 'highpass')).toBeDefined()
    graph.allNotesOff()
    expect(context.nodes.flatMap((node) => node.connections).filter((node) => node === context.destination)).toHaveLength(1)
    graph.dispose()
    expect(context.state).toBe('closed')
  })
})
