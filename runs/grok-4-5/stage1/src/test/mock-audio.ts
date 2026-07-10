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
  connect(dest: MockAudioNode) {
    this.connections.push(dest)
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

export class MockAudioContext {
  currentTime = 0
  state: AudioContextState = 'running'
  destination = new MockAudioNode()
  sampleRate = 48000
  private oscillators: MockOscillatorNode[] = []

  createGain() {
    return new MockGainNode() as unknown as GainNode
  }

  createOscillator() {
    const o = new MockOscillatorNode()
    this.oscillators.push(o)
    return o as unknown as OscillatorNode
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
