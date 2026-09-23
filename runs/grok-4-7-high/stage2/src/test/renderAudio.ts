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

export function meanAbsDiff(left: Float32Array, right: Float32Array): number {
  const length = Math.min(left.length, right.length)
  let sum = 0
  for (let index = 0; index < length; index++) sum += Math.abs((left[index] ?? 0) - (right[index] ?? 0))
  return length === 0 ? 0 : sum / length
}

export function peak(channel: Float32Array, start = 0, end = channel.length): number {
  let max = 0
  const from = Math.max(0, Math.floor(start))
  const to = Math.min(channel.length, Math.floor(end))
  for (let index = from; index < to; index++) max = Math.max(max, Math.abs(channel[index] ?? 0))
  return max
}

export function zeroCrossings(channel: Float32Array, start: number, end: number): number {
  const from = Math.max(1, Math.floor(start))
  const to = Math.min(channel.length, Math.floor(end))
  let count = 0
  for (let index = from; index < to; index++) {
    const previous = channel[index - 1] ?? 0
    const sample = channel[index] ?? 0
    if ((previous < 0 && sample >= 0) || (previous >= 0 && sample < 0)) count += 1
  }
  return count
}

export async function renderPiano(
  run: (engine: PianoEngine) => void,
  seconds = 1,
  options?: PianoEngineOptions,
  channels = 1,
) {
  const sampleRate = 44100
  const context = new OfflineAudioContext(channels, Math.floor(sampleRate * seconds), sampleRate)
  const timers = new ManualTimers()
  const boundary: AudioBoundary = {
    createContext: () => context as unknown as AudioContextLike,
    timers,
  }
  const engine = new PianoEngine(boundary, options)
  engine.ensureStarted()
  run(engine)
  const rendered = await context.startRendering()
  const mixed = rendered.getChannelData(0).slice()
  if (rendered.numberOfChannels > 1) {
    const side = rendered.getChannelData(1)
    for (let index = 0; index < mixed.length; index++) mixed[index] = ((mixed[index] ?? 0) + (side[index] ?? 0)) * 0.5
  }
  return { engine, timers, channel: mixed, sampleRate, context }
}
