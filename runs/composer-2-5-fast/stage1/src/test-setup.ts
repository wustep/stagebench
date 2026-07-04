import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => cleanup())

class MockGainNode {
  gain = { value: 1, setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, cancelScheduledValues: () => {} }
  connect() { return this }
  disconnect() {}
}

class MockOscillatorNode {
  type = 'sine'
  frequency = { setValueAtTime: () => {} }
  connect() { return this }
  start() {}
  stop() {}
}

class MockAudioContext {
  currentTime = 0
  destination = new MockGainNode()
  createGain() { return new MockGainNode() }
  createOscillator() { return new MockOscillatorNode() }
  resume = async () => {}
  close = async () => {}
}

class MockOfflineAudioContext extends MockAudioContext {
  #sampleRate: number
  #length: number
  constructor(_channels: number, length: number, sampleRate: number) {
    super()
    this.#sampleRate = sampleRate
    this.#length = length
  }
  startRendering = async () => {
    const data = new Float32Array(this.#length)
    for (let i = 0; i < data.length; i++) {
      data[i] = 0.1 * Math.sin((2 * Math.PI * 440 * i) / this.#sampleRate)
    }
    return { getChannelData: () => data, sampleRate: this.#sampleRate, length: this.#length }
  }
}

Object.assign(globalThis, {
  AudioContext: MockAudioContext,
  OfflineAudioContext: MockOfflineAudioContext,
  webkitAudioContext: MockAudioContext,
})
