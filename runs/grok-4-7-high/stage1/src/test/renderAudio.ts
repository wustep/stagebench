import { OfflineAudioContext } from 'node-web-audio-api'
import { ManualTimers, type AudioBoundary, type AudioContextLike } from '../audio/boundaries'
import { PianoEngine, type PianoEngineOptions } from '../audio/engine'

export function testAudioBoundary(): AudioBoundary {
  const timers = new ManualTimers()
  const context = new OfflineAudioContext(1, 44100, 44100)
  return { createContext: () => context as unknown as AudioContextLike, timers }
}

export function rms(channel: Float32Array, start: number, end: number): number {
  const from = Math.max(0, Math.floor(start))
  const to = Math.min(channel.length, Math.floor(end))
  let sum = 0
  let count = 0
  for (let index = from; index < to; index++) {
    const sample = channel[index] ?? 0
    sum += sample * sample
    count += 1
  }
  return count === 0 ? 0 : Math.sqrt(sum / count)
}

export async function renderPiano(
  run: (engine: PianoEngine) => void,
  seconds = 1,
  options?: PianoEngineOptions,
) {
  const sampleRate = 44100
  const context = new OfflineAudioContext(1, Math.floor(sampleRate * seconds), sampleRate)
  const timers = new ManualTimers()
  const boundary: AudioBoundary = {
    createContext: () => context as unknown as AudioContextLike,
    timers,
  }
  const engine = new PianoEngine(boundary, options)
  engine.ensureStarted()
  run(engine)
  const rendered = await context.startRendering()
  return { engine, timers, channel: rendered.getChannelData(0), sampleRate }
}
