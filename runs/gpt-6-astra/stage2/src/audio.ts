/** Original additive synthesis. These are generated waveforms, never recordings. */
export const SAMPLE_RATE = 22050
export const RELEASE_SECONDS = .22
export function pianoSignal(midi: number, seconds = 8, sampleRate = SAMPLE_RATE): Float32Array {
  const data = new Float32Array(Math.ceil(seconds * sampleRate))
  const frequency = 440 * 2 ** ((midi - 69) / 12)
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate
    let sample = 0
    for (let h = 1; h <= 6; h++) {
      const hz = frequency * h * (1 + .00006 * h * h)
      if (hz < sampleRate * .45) sample += Math.sin(2 * Math.PI * hz * t) * Math.exp(-t * (0.65 + h * .38)) / (h * h ** .2)
    }
    data[i] = sample * .5 * Math.min(1, t / .004) * Math.min(1, (seconds - t) / .06)
  }
  return data
}
export function velocityGain(velocity: number) { return Math.max(0, Math.min(1, velocity / 127)) ** 1.6 }
export interface VoiceHandle { release(): void; stop(): void }
export interface AudioBoundary { start(): Promise<void>; voice(midi: number, velocity: number, ended: () => void): VoiceHandle; close(): void }
export class BrowserAudio implements AudioBoundary {
  private context?: AudioContext
  private master?: GainNode
  private cache = new Map<number, AudioBuffer>()
  private handles = new Set<VoiceHandle>()
  constructor(private factory: () => AudioContext = () => new AudioContext()) {}
  async start() {
    if (!this.context) {
      this.context = this.factory()
      this.master = this.context.createGain()
      this.master.gain.value = .32
      this.master.connect(this.context.destination)
    }
    if (this.context.state !== 'running') await this.context.resume()
    if (this.context.state !== 'running') throw new Error('Audio could not resume. Activate audio to retry.')
  }
  voice(midi: number, velocity: number, ended: () => void) {
    const ctx = this.context
    if (!ctx || !this.master) throw new Error('Audio has not started')
    let buffer = this.cache.get(midi)
    if (!buffer) {
      const signal = pianoSignal(midi)
      buffer = ctx.createBuffer(1, signal.length, SAMPLE_RATE)
      buffer.getChannelData(0).set(signal)
      if (this.cache.size >= 16) this.cache.delete(this.cache.keys().next().value!)
      this.cache.set(midi, buffer)
    }
    const source = ctx.createBufferSource()
    const gain = ctx.createGain()
    source.buffer = buffer
    gain.gain.value = velocityGain(velocity)
    source.connect(gain)
    gain.connect(this.master)
    let done = false
    const cleanup = () => { if (done) return; done = true; source.onended = null; source.disconnect(); gain.disconnect(); this.handles.delete(handle); ended() }
    const handle: VoiceHandle = {
      release: () => {
        if (done) return
        const now = ctx.currentTime
        gain.gain.cancelScheduledValues(now)
        gain.gain.setValueAtTime(gain.gain.value, now)
        gain.gain.linearRampToValueAtTime(0, now + RELEASE_SECONDS)
        source.stop(now + RELEASE_SECONDS)
      },
      stop: () => { if (!done) { source.stop(); cleanup() } },
    }
    source.onended = cleanup
    this.handles.add(handle)
    source.start()
    return handle
  }
  close() { for (const voice of this.handles) voice.stop(); this.cache.clear(); this.master?.disconnect(); void this.context?.close().catch(() => {}); this.context = undefined; this.master = undefined }
}
export type AudioStatus = 'idle' | 'loading' | 'ready' | 'error'
interface Note { owner: string; midi: number; velocity: number; held: boolean; released: boolean; handle?: VoiceHandle }
export class PianoEngine {
  readonly notes = new Map<string, Note>()
  readonly pedals = new Set<string>()
  status: AudioStatus = 'idle'
  error = ''
  private listeners = new Set<() => void>()
  private generation = 0
  private starting?: Promise<void>
  constructor(readonly audio: AudioBoundary, readonly polyphony = 32) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private notify() { for (const listener of this.listeners) listener() }
  async activate() {
    if (this.status === 'ready') return
    if (this.starting) return this.starting
    const generation = this.generation
    this.status = 'loading'; this.error = ''; this.notify()
    this.starting = this.audio.start().then(() => { if (generation === this.generation) { this.status = 'ready'; this.notify() } }).catch((error: unknown) => {
      if (generation === this.generation) { this.status = 'error'; this.error = error instanceof Error ? error.message : 'Audio unavailable'; this.allOff(); this.notify() }
    }).finally(() => { if (generation === this.generation) this.starting = undefined })
    return this.starting
  }
  async on(owner: string, midi: number, velocity = 96) {
    if (midi < 0 || midi > 127 || !Number.isInteger(midi) || velocity <= 0) return
    this.remove(owner)
    while (this.notes.size >= this.polyphony) {
      // Prefer oldest released voice, then oldest sustained voice, then oldest held voice.
      const notes = [...this.notes.values()]
      this.remove((notes.find(n => n.released) ?? notes.find(n => !n.held) ?? notes[0]).owner)
    }
    const note: Note = { owner, midi, velocity, held: true, released: false }
    this.notes.set(owner, note); this.notify()
    await this.activate()
    if (this.status !== 'ready' || this.notes.get(owner) !== note || (!note.held && !this.pedals.size)) return
    try { note.handle = this.audio.voice(midi, velocity, () => { if (this.notes.get(owner) === note) { this.notes.delete(owner); this.notify() } }) }
    catch (error) { this.error = String(error); this.status = 'error'; this.allOff() }
  }
  off(owner: string) {
    const note = this.notes.get(owner)
    if (!note || !note.held) return
    note.held = false
    if (!this.pedals.size) this.release(note)
    this.notify()
  }
  private release(note: Note) {
    if (note.released) return
    note.released = true
    if (note.handle) note.handle.release()
    else this.notes.delete(note.owner)
  }
  sustain(owner: string, down: boolean) {
    if (down) this.pedals.add(owner); else this.pedals.delete(owner)
    if (!this.pedals.size) for (const note of this.notes.values()) if (!note.held) this.release(note)
    this.notify()
  }
  private remove(owner: string) { const note = this.notes.get(owner); this.notes.delete(owner); note?.handle?.stop() }
  allOff() { for (const owner of this.notes.keys()) this.remove(owner); this.pedals.clear(); this.notify() }
  dispose() { this.generation++; this.allOff(); this.audio.close(); this.status = 'idle'; this.starting = undefined }
}
