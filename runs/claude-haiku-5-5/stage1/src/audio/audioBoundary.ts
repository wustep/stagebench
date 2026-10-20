// Injectable Web Audio boundary. The piano voice only talks to these minimal shapes, so tests can
// supply a fake graph that records every node, connection, and stop, with no real audio output.

export interface AudioParamLike {
  value: number
  setValueAtTime(value: number, time: number): void
  linearRampToValueAtTime(value: number, time: number): void
  exponentialRampToValueAtTime(value: number, time: number): void
  setTargetAtTime(target: number, startTime: number, timeConstant: number): void
  cancelScheduledValues(time: number): void
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): AudioNodeLike
  disconnect(): void
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike
}

export interface OscillatorNodeLike extends AudioNodeLike {
  type: 'sine' | 'square' | 'sawtooth' | 'triangle'
  readonly frequency: AudioParamLike
  start(when?: number): void
  stop(when?: number): void
  onended: (() => void) | null
}

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: 'lowpass' | 'highpass' | 'peaking'
  readonly frequency: AudioParamLike
  readonly Q: AudioParamLike
}

export interface AudioContextLike {
  readonly state: 'suspended' | 'running' | 'closed'
  readonly currentTime: number
  readonly destination: AudioNodeLike
  resume(): Promise<void>
  close(): Promise<void>
  createGain(): GainNodeLike
  createOscillator(): OscillatorNodeLike
  createBiquadFilter(): BiquadFilterNodeLike
}

/** Creates an audio context. Throws when Web Audio is unavailable. */
export type AudioContextFactory = () => AudioContextLike

export function createBrowserAudioContext(): AudioContextLike {
  const globals = globalThis as unknown as {
    AudioContext?: new () => AudioContextLike
    webkitAudioContext?: new () => AudioContextLike
  }
  const Constructor = globals.AudioContext ?? globals.webkitAudioContext
  if (!Constructor) {
    throw new Error('Web Audio is not available in this browser')
  }
  return new Constructor()
}
