import '@testing-library/jest-dom/vitest'

// Deterministic, silent AudioContext stub so audio-graph logic can be exercised
// in tests without requiring real audio output or a browser device.
class StubAudioParam {
  value = 0
  setValueAtTime() { return this }
  linearRampToValueAtTime() { return this }
  exponentialRampToValueAtTime() { return this }
  cancelScheduledValues() { return this }
}

class StubGainNode {
  gain = new StubAudioParam()
  connect() { return this }
  disconnect() { return this }
}

class StubOscillatorNode {
  type = 'sine'
  frequency = new StubAudioParam()
  connect() { return this }
  disconnect() { return this }
  start() {}
  stop() {}
}

class StubAudioContext {
  state: AudioContextState = 'running'
  currentTime = 0
  destination = {}
  createGain() { return new StubGainNode() }
  createOscillator() { return new StubOscillatorNode() }
  resume() { return Promise.resolve() }
  close() { return Promise.resolve() }
}

;(globalThis as unknown as { AudioContext: unknown }).AudioContext = StubAudioContext
