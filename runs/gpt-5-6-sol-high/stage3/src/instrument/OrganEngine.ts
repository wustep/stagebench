export type OrganModel = 'b3' | 'b3-bass' | 'vox' | 'farf' | 'pipe1' | 'pipe2'
export type RotarySpeed = 'stop' | 'slow' | 'fast'

export interface OrganPercussion {
  enabled: boolean
  harmonic: 2 | 3
  soft: boolean
  fast: boolean
}

export interface OrganVoice {
  id: string
  layer: string
  midi: number
  velocity: number
  harmonics: number[]
}

export interface OrganAudioBackend {
  resume(): Promise<void>
  startVoice(layer: string, midi: number, velocity: number, harmonics: number[], percussion: OrganPercussion, model: OrganModel): OrganVoice
  stopVoice(voice: OrganVoice): void
  setRotary(speed: RotarySpeed): void
  setDrive(value: number): void
}

export interface OrganSnapshot {
  model: OrganModel
  drawbars: number[]
  percussion: OrganPercussion
  rotary: RotarySpeed
  drive: number
  activeNotes: Array<{ layer: string; midi: number }>
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const DEFAULT_DRAWBARS = [8, 5, 4, 3, 2, 2, 1, 1, 0]

export class OrganEngine {
  private model: OrganModel = 'b3'
  private drawbars = [...DEFAULT_DRAWBARS]
  private percussion: OrganPercussion = { enabled: false, harmonic: 3, soft: false, fast: false }
  private rotary: RotarySpeed = 'slow'
  private drive = 0.25
  private active = new Map<string, OrganVoice>()
  private listeners = new Set<(snapshot: OrganSnapshot) => void>()

  constructor(private readonly audio: OrganAudioBackend) {
    audio.setRotary(this.rotary)
    audio.setDrive(this.drive)
  }

  setModel(model: OrganModel) { this.model = model; this.emit() }
  setDrawbar(index: number, value: number) {
    if (index < 0 || index >= 9) return
    this.drawbars[index] = Math.round(clamp(value, 0, 8))
    this.emit()
  }
  setPercussion(patch: Partial<OrganPercussion>) { this.percussion = { ...this.percussion, ...patch }; this.emit() }
  setRotary(speed: RotarySpeed) { this.rotary = speed; this.audio.setRotary(speed); this.emit() }
  setDrive(value: number) { this.drive = clamp(value, 0, 1); this.audio.setDrive(this.drive); this.emit() }

  noteOn(layer: string, midi: number, velocity = 100) {
    if (midi < 0 || midi > 127 || velocity <= 0) return
    void this.audio.resume()
    const key = `${layer}:${Math.round(midi)}`
    const old = this.active.get(key)
    if (old) this.audio.stopVoice(old)
    const harmonics = this.drawbars.map((value) => value / 8)
    const voice = this.audio.startVoice(layer, Math.round(midi), clamp(velocity, 1, 127), harmonics, this.percussion, this.model)
    this.active.set(key, voice)
    this.emit()
  }

  noteOff(layer: string, midi: number) {
    const key = `${layer}:${Math.round(midi)}`
    const voice = this.active.get(key)
    if (!voice) return
    this.audio.stopVoice(voice)
    this.active.delete(key)
    this.emit()
  }

  allNotesOff() { for (const voice of this.active.values()) this.audio.stopVoice(voice); this.active.clear(); this.emit() }
  snapshot(): OrganSnapshot {
    return {
      model: this.model, drawbars: [...this.drawbars], percussion: { ...this.percussion }, rotary: this.rotary, drive: this.drive,
      activeNotes: [...this.active.values()].map(({ layer, midi }) => ({ layer, midi })).sort((a, b) => a.midi - b.midi || a.layer.localeCompare(b.layer)),
    }
  }
  subscribe(listener: (snapshot: OrganSnapshot) => void) { this.listeners.add(listener); listener(this.snapshot()); return () => this.listeners.delete(listener) }
  restore(snapshot: OrganSnapshot) {
    this.model = snapshot.model
    this.drawbars = snapshot.drawbars.slice(0, 9).map((value) => clamp(Math.round(value), 0, 8))
    this.percussion = { ...snapshot.percussion }
    this.rotary = snapshot.rotary
    this.drive = snapshot.drive
    this.audio.setRotary(this.rotary)
    this.audio.setDrive(this.drive)
    this.emit()
  }
  private emit() { const snapshot = this.snapshot(); for (const listener of this.listeners) listener(snapshot) }
}

class SilentOrganBackend implements OrganAudioBackend {
  private id = 0
  async resume() {}
  startVoice(layer: string, midi: number, velocity: number, harmonics: number[]) { return { id: `silent-organ-${this.id++}`, layer, midi, velocity, harmonics } }
  stopVoice() {}
  setRotary() {}
  setDrive() {}
}

class WebAudioOrganBackend implements OrganAudioBackend {
  private output: GainNode
  private rotary: StereoPannerNode
  private voices = new Map<string, { oscillators: OscillatorNode[]; gain: GainNode }>()
  private id = 0
  constructor(private readonly context: AudioContext) {
    this.output = context.createGain()
    this.rotary = context.createStereoPanner()
    this.output.connect(this.rotary).connect(context.destination)
    this.setDrive(0.25)
  }
  async resume() { if (this.context.state === 'suspended') await this.context.resume() }
  startVoice(layer: string, midi: number, velocity: number, harmonics: number[], percussion: OrganPercussion, model: OrganModel) {
    const id = `organ-${this.id++}`
    const gain = this.context.createGain()
    const frequency = 440 * 2 ** ((midi - 69) / 12)
    const ratios = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8]
    const oscillators = harmonics.flatMap((level, index) => {
      if (level <= 0) return []
      const oscillator = this.context.createOscillator()
      oscillator.type = model === 'vox' ? 'square' : model === 'farf' ? 'sawtooth' : 'sine'
      oscillator.frequency.value = frequency * ratios[index]
      const partial = this.context.createGain()
      partial.gain.value = level * 0.08 * (velocity / 127)
      oscillator.connect(partial).connect(gain)
      oscillator.start()
      return [oscillator]
    })
    if (percussion.enabled && model === 'b3') {
      const oscillator = this.context.createOscillator()
      const partial = this.context.createGain()
      oscillator.frequency.value = frequency * percussion.harmonic
      partial.gain.setValueAtTime(percussion.soft ? 0.06 : 0.12, this.context.currentTime)
      partial.gain.exponentialRampToValueAtTime(0.0001, this.context.currentTime + (percussion.fast ? 0.18 : 0.65))
      oscillator.connect(partial).connect(gain); oscillator.start(); oscillator.stop(this.context.currentTime + 0.7); oscillators.push(oscillator)
    }
    gain.connect(this.output)
    this.voices.set(id, { oscillators, gain })
    return { id, layer, midi, velocity, harmonics: [...harmonics] }
  }
  stopVoice(voice: OrganVoice) {
    const nodes = this.voices.get(voice.id); if (!nodes) return
    const now = this.context.currentTime
    nodes.gain.gain.setTargetAtTime(0.0001, now, 0.025)
    for (const oscillator of nodes.oscillators) { try { oscillator.stop(now + 0.16) } catch { /* already stopped */ } }
    this.voices.delete(voice.id)
  }
  setRotary(speed: RotarySpeed) {
    const pan = speed === 'stop' ? 0 : speed === 'slow' ? 0.22 : 0.7
    this.rotary.pan.setTargetAtTime(pan, this.context.currentTime, speed === 'fast' ? 0.15 : 0.5)
  }
  setDrive(value: number) { this.output.gain.setTargetAtTime(0.35 + value * 0.45, this.context.currentTime, 0.02) }
}

export function createBrowserOrganBackend(): OrganAudioBackend {
  const Ctor = globalThis.AudioContext ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  return Ctor ? new WebAudioOrganBackend(new Ctor({ latencyHint: 'interactive' })) : new SilentOrganBackend()
}
