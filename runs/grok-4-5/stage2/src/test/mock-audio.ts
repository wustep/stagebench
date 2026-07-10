/** Minimal mock Web Audio for deterministic tests */

export class MockAudioParam {
  value = 0
  setValueAtTime(v: number, _t: number) {
    this.value = v
    return this
  }
  linearRampToValueAtTime(v: number, _t: number) {
    this.value = v
    return this
  }
  exponentialRampToValueAtTime(v: number, _t: number) {
    this.value = Math.max(0.0001, v)
    return this
  }
  cancelScheduledValues(_t: number) {
    return this
  }
}

export class MockAudioNode {
  connections: MockAudioNode[] = []
  context: MockAudioContext | null = null
  connect(dest: MockAudioNode | AudioNode) {
    this.connections.push(dest as unknown as MockAudioNode)
    return dest
  }
  disconnect() {
    this.connections = []
  }
}

export class MockGainNode extends MockAudioNode {
  gain = new MockAudioParam()
}

export class MockOscillatorNode extends MockAudioNode {
  type = 'sine'
  frequency = new MockAudioParam()
  started = false
  stopped = false
  start(_t?: number) {
    this.started = true
  }
  stop(_t?: number) {
    this.stopped = true
  }
}

export class MockBiquadFilterNode extends MockAudioNode {
  type = 'lowpass'
  frequency = new MockAudioParam()
  Q = new MockAudioParam()
  gain = new MockAudioParam()
}

export class MockDelayNode extends MockAudioNode {
  delayTime = new MockAudioParam()
}

export class MockStereoPannerNode extends MockAudioNode {
  pan = new MockAudioParam()
}

export class MockWaveShaperNode extends MockAudioNode {
  curve: Float32Array | null = null
  oversample: OverSampleType = 'none'
}

export class MockDynamicsCompressorNode extends MockAudioNode {
  threshold = new MockAudioParam()
  knee = new MockAudioParam()
  ratio = new MockAudioParam()
  attack = new MockAudioParam()
  release = new MockAudioParam()
}

export class MockConvolverNode extends MockAudioNode {
  buffer: AudioBuffer | null = null
}

export class MockBufferSourceNode extends MockAudioNode {
  buffer: AudioBuffer | null = null
  playbackRate = new MockAudioParam()
  started = false
  stopped = false
  start(_t?: number) {
    this.started = true
  }
  stop(_t?: number) {
    this.stopped = true
  }
}

export class MockAudioBuffer {
  numberOfChannels: number
  length: number
  sampleRate: number
  private channels: Float32Array[]
  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels
    this.length = length
    this.sampleRate = sampleRate
    this.channels = Array.from({ length: channels }, () => new Float32Array(length))
  }
  getChannelData(ch: number) {
    return this.channels[ch] ?? this.channels[0]!
  }
}

export class MockAudioContext {
  currentTime = 0
  state: AudioContextState = 'running'
  destination = new MockAudioNode()
  sampleRate = 48000
  private oscillators: MockOscillatorNode[] = []
  private sources: MockBufferSourceNode[] = []

  private tag<T extends MockAudioNode>(node: T): T {
    node.context = this
    return node
  }

  createGain() {
    return this.tag(new MockGainNode()) as unknown as GainNode
  }

  createOscillator() {
    const o = this.tag(new MockOscillatorNode())
    this.oscillators.push(o)
    return o as unknown as OscillatorNode
  }

  createBiquadFilter() {
    return this.tag(new MockBiquadFilterNode()) as unknown as BiquadFilterNode
  }

  createDelay(_max?: number) {
    return this.tag(new MockDelayNode()) as unknown as DelayNode
  }

  createStereoPanner() {
    return this.tag(new MockStereoPannerNode()) as unknown as StereoPannerNode
  }

  createWaveShaper() {
    return this.tag(new MockWaveShaperNode()) as unknown as WaveShaperNode
  }

  createDynamicsCompressor() {
    return this.tag(new MockDynamicsCompressorNode()) as unknown as DynamicsCompressorNode
  }

  createConvolver() {
    return this.tag(new MockConvolverNode()) as unknown as ConvolverNode
  }

  createBufferSource() {
    const s = this.tag(new MockBufferSourceNode())
    this.sources.push(s)
    return s as unknown as AudioBufferSourceNode
  }

  createBuffer(channels: number, length: number, sampleRate: number) {
    return new MockAudioBuffer(channels, length, sampleRate) as unknown as AudioBuffer
  }

  async decodeAudioData(data: ArrayBuffer) {
    // minimal silence buffer
    const n = Math.max(1, Math.floor(data.byteLength / 4))
    return this.createBuffer(1, Math.min(n, this.sampleRate), this.sampleRate)
  }

  async resume() {
    this.state = 'running'
  }

  async close() {
    this.state = 'closed'
  }

  getOscillators() {
    return this.oscillators
  }

  getSources() {
    return this.sources
  }
}

export function createMockContextFactory() {
  const contexts: MockAudioContext[] = []
  return {
    contexts,
    createContext: () => {
      const ctx = new MockAudioContext()
      contexts.push(ctx)
      return ctx as unknown as AudioContext
    },
  }
}
