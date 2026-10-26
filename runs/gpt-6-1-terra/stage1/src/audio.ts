export interface Voice { release(): void; stop(): void }
export interface AudioBackend { start(note: number, velocity: number): Voice; stopAll?(): void; close(): void }

export class PianoEngine {
  private voices = new Map<string, { voice: Voice; note: number; held: boolean; order: number }>()
  private serial = 0
  private pedal = false
  constructor(private backend: AudioBackend, private limit = 32) {}
  on(id: string, note: number, velocity: number) {
    const previous = this.voices.get(id)
    if (previous) {
      this.voices.delete(id)
      if (this.pedal) { previous.held = false; this.voices.set(`sustained-${this.serial++}`, previous) }
      else previous.voice.release()
    }
    if (this.voices.size >= this.limit) {
      const oldest = [...this.voices.entries()].sort((a, b) => a[1].order - b[1].order)[0]
      oldest[1].voice.stop(); this.voices.delete(oldest[0])
    }
    this.voices.set(id, { voice: this.backend.start(note, velocity), note, held: true, order: this.serial++ })
  }
  off(id: string) {
    const item = this.voices.get(id)
    if (!item) return
    item.held = false
    if (!this.pedal) { item.voice.release(); this.voices.delete(id) }
  }
  sustain(down: boolean) {
    this.pedal = down
    if (!down) for (const [id, item] of this.voices) if (!item.held) { item.voice.release(); this.voices.delete(id) }
  }
  allOff() { for (const item of this.voices.values()) item.voice.stop(); this.voices.clear(); this.backend.stopAll?.(); this.pedal = false }
  close() { this.allOff(); this.backend.close() }
}

export class WebAudioBackend implements AudioBackend {
  private active = new Set<() => void>()
  constructor(private context: AudioContext) {}
  start(note: number, velocity: number): Voice {
    const t = this.context.currentTime
    const gain = this.context.createGain()
    const fundamental = this.context.createOscillator()
    const overtone = this.context.createOscillator()
    const overtoneGain = this.context.createGain()
    const hz = 440 * 2 ** ((note - 69) / 12)
    fundamental.type = 'triangle'; fundamental.frequency.value = hz
    overtone.type = 'sine'; overtone.frequency.value = hz * 2
    overtoneGain.gain.value = 0.22
    fundamental.connect(gain); overtone.connect(overtoneGain); overtoneGain.connect(gain); gain.connect(this.context.destination)
    const level = Math.max(0.001, velocity / 127 * 0.23)
    gain.gain.setValueAtTime(0.0001, t); gain.gain.exponentialRampToValueAtTime(level, t + 0.008)
    gain.gain.exponentialRampToValueAtTime(level * 0.24, t + 1.2)
    fundamental.start(); overtone.start()
    let stopped = false
    const end = (quick: boolean) => {
      if (stopped && !quick) return
      stopped = true
      const now = this.context.currentTime
      gain.gain.cancelScheduledValues(now); gain.gain.setTargetAtTime(0.0001, now, quick ? 0.005 : 0.12)
      const finish = now + (quick ? 0.04 : 0.8)
      fundamental.stop(finish); overtone.stop(finish)
      fundamental.onended = () => { this.active.delete(force); fundamental.disconnect(); overtone.disconnect(); overtoneGain.disconnect(); gain.disconnect() }
    }
    const force = () => end(true)
    this.active.add(force)
    return { release: () => end(false), stop: force }
  }
  stopAll() { for (const stop of this.active) stop() }
  close() { this.stopAll(); void this.context.close() }
}
