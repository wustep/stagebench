/** Deterministic rendered-audio helpers for tests. */

export function rms(buffer: AudioBuffer, startSample = 0, length?: number): number {
  const data = buffer.getChannelData(0)
  const end = length == null ? data.length : Math.min(data.length, startSample + length)
  if (end <= startSample) return 0
  let sum = 0
  for (let i = startSample; i < end; i++) sum += data[i]! ** 2
  return Math.sqrt(sum / (end - startSample))
}

export function peak(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0)
  let max = 0
  for (let i = 0; i < data.length; i++) max = Math.max(max, Math.abs(data[i]!))
  return max
}

export function signalsDiffer(a: AudioBuffer, b: AudioBuffer, threshold = 0.001): boolean {
  const len = Math.min(a.length, b.length)
  const da = a.getChannelData(0)
  const db = b.getChannelData(0)
  let diff = 0
  for (let i = 0; i < len; i++) diff += Math.abs(da[i]! - db[i]!)
  return diff / len > threshold
}

export async function renderEngine(
  setup: (ctx: OfflineAudioContext) => void | Promise<void>,
  durationSec = 1,
  sampleRate = 44100,
): Promise<AudioBuffer> {
  const offline = new OfflineAudioContext(2, Math.ceil(durationSec * sampleRate), sampleRate)
  await setup(offline)
  return offline.startRendering()
}

export function tailRms(buffer: AudioBuffer, tailMs = 200): number {
  const tailSamples = Math.floor((tailMs / 1000) * buffer.sampleRate)
  return rms(buffer, Math.max(0, buffer.length - tailSamples), tailSamples)
}

export function earlyRms(buffer: AudioBuffer, earlyMs = 100): number {
  const earlySamples = Math.floor((earlyMs / 1000) * buffer.sampleRate)
  return rms(buffer, 0, earlySamples)
}
