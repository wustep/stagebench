export type SynthWaveform = OscillatorType
export type FilterType = 'lp12' | 'lp24' | 'hp24' | 'bandpass'
export type ModDestination = 'off' | 'pitch' | 'filter' | 'shape' | 'amp'

export interface SynthParameters {
  oscillator: { waveform: SynthWaveform; shape: number; detune: number }
  filter: { type: FilterType; frequency: number; resonance: number; drive: number }
  envelope: { attack: number; decay: number; sustain: number; release: number }
  modulation: { lfoRate: number; lfoAmount: number; destination: ModDestination }
}
export interface SynthVoice { id: string; layer: string; midi: number; velocity: number; parameters: SynthParameters }
export interface SynthAudioBackend {
  resume(): Promise<void>
  startVoice(layer: string, midi: number, velocity: number, parameters: SynthParameters): SynthVoice
  stopVoice(voice: SynthVoice): void
  update(parameters: SynthParameters): void
}
export interface SynthSnapshot { parameters: SynthParameters; activeNotes: Array<{ layer: string; midi: number }> }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const cloneParameters = (parameters: SynthParameters): SynthParameters => ({
  oscillator: { ...parameters.oscillator }, filter: { ...parameters.filter }, envelope: { ...parameters.envelope }, modulation: { ...parameters.modulation },
})

export const DEFAULT_SYNTH_PARAMETERS: SynthParameters = {
  oscillator: { waveform: 'sawtooth', shape: 0.35, detune: 0 },
  filter: { type: 'lp24', frequency: 5200, resonance: 0.22, drive: 0.1 },
  envelope: { attack: 0.015, decay: 0.45, sustain: 0.72, release: 0.6 },
  modulation: { lfoRate: 4.5, lfoAmount: 0.12, destination: 'filter' },
}

export class SynthEngine {
  private parameters = cloneParameters(DEFAULT_SYNTH_PARAMETERS)
  private active = new Map<string, SynthVoice>()
  private listeners = new Set<(snapshot: SynthSnapshot) => void>()
  constructor(private readonly audio: SynthAudioBackend) { audio.update(this.parameters) }
  setOscillator(patch: Partial<SynthParameters['oscillator']>) {
    this.parameters.oscillator = { ...this.parameters.oscillator, ...patch }
    this.parameters.oscillator.shape = clamp(this.parameters.oscillator.shape, 0, 1)
    this.parameters.oscillator.detune = clamp(this.parameters.oscillator.detune, -100, 100)
    this.changed()
  }
  setFilter(patch: Partial<SynthParameters['filter']>) {
    this.parameters.filter = { ...this.parameters.filter, ...patch }
    this.parameters.filter.frequency = clamp(this.parameters.filter.frequency, 20, 20000)
    this.parameters.filter.resonance = clamp(this.parameters.filter.resonance, 0, 1)
    this.parameters.filter.drive = clamp(this.parameters.filter.drive, 0, 1)
    this.changed()
  }
  setEnvelope(patch: Partial<SynthParameters['envelope']>) {
    this.parameters.envelope = { ...this.parameters.envelope, ...patch }
    this.parameters.envelope.attack = clamp(this.parameters.envelope.attack, 0, 10)
    this.parameters.envelope.decay = clamp(this.parameters.envelope.decay, 0, 10)
    this.parameters.envelope.sustain = clamp(this.parameters.envelope.sustain, 0, 1)
    this.parameters.envelope.release = clamp(this.parameters.envelope.release, 0, 10)
    this.changed()
  }
  setModulation(patch: Partial<SynthParameters['modulation']>) {
    this.parameters.modulation = { ...this.parameters.modulation, ...patch }
    this.parameters.modulation.lfoRate = clamp(this.parameters.modulation.lfoRate, 0.01, 20)
    this.parameters.modulation.lfoAmount = clamp(this.parameters.modulation.lfoAmount, 0, 1)
    this.changed()
  }
  noteOn(layer: string, midi: number, velocity = 100) {
    if (midi < 0 || midi > 127 || velocity <= 0) return
    void this.audio.resume()
    const key = `${layer}:${Math.round(midi)}`
    const old = this.active.get(key); if (old) this.audio.stopVoice(old)
    this.active.set(key, this.audio.startVoice(layer, Math.round(midi), clamp(velocity, 1, 127), cloneParameters(this.parameters)))
    this.emit()
  }
  noteOff(layer: string, midi: number) { const key = `${layer}:${Math.round(midi)}`; const voice = this.active.get(key); if (!voice) return; this.audio.stopVoice(voice); this.active.delete(key); this.emit() }
  allNotesOff() { for (const voice of this.active.values()) this.audio.stopVoice(voice); this.active.clear(); this.emit() }
  snapshot(): SynthSnapshot { return { parameters: cloneParameters(this.parameters), activeNotes: [...this.active.values()].map(({ layer, midi }) => ({ layer, midi })).sort((a, b) => a.midi - b.midi || a.layer.localeCompare(b.layer)) } }
  subscribe(listener: (snapshot: SynthSnapshot) => void) { this.listeners.add(listener); listener(this.snapshot()); return () => this.listeners.delete(listener) }
  restore(snapshot: SynthSnapshot) { this.parameters = cloneParameters(snapshot.parameters); this.changed() }
  private changed() { this.audio.update(cloneParameters(this.parameters)); this.emit() }
  private emit() { const snapshot = this.snapshot(); for (const listener of this.listeners) listener(snapshot) }
}

class SilentSynthBackend implements SynthAudioBackend {
  private id = 0
  async resume() {}
  startVoice(layer: string, midi: number, velocity: number, parameters: SynthParameters) { return { id: `silent-synth-${this.id++}`, layer, midi, velocity, parameters } }
  stopVoice() {}
  update() {}
}

class WebAudioSynthBackend implements SynthAudioBackend {
  private id = 0
  private output: GainNode
  private voices = new Map<string, { oscillator: OscillatorNode; lfo: OscillatorNode; gain: GainNode; filter: BiquadFilterNode; parameters: SynthParameters }>()
  constructor(private readonly context: AudioContext) { this.output = context.createGain(); this.output.gain.value = 0.3; this.output.connect(context.destination) }
  async resume() { if (this.context.state === 'suspended') await this.context.resume() }
  startVoice(layer: string, midi: number, velocity: number, parameters: SynthParameters) {
    const id = `synth-${this.id++}`
    const now = this.context.currentTime
    const oscillator = this.context.createOscillator(); oscillator.type = parameters.oscillator.waveform; oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12); oscillator.detune.value = parameters.oscillator.detune
    const filter = this.context.createBiquadFilter(); filter.type = parameters.filter.type.startsWith('hp') ? 'highpass' : parameters.filter.type === 'bandpass' ? 'bandpass' : 'lowpass'; filter.frequency.value = parameters.filter.frequency; filter.Q.value = parameters.filter.resonance * 18
    const gain = this.context.createGain(); gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, velocity / 127), now + Math.max(0.005, parameters.envelope.attack)); gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, parameters.envelope.sustain * velocity / 127), now + parameters.envelope.attack + Math.max(0.01, parameters.envelope.decay))
    const lfo = this.context.createOscillator(); const lfoGain = this.context.createGain(); lfo.frequency.value = parameters.modulation.lfoRate; lfoGain.gain.value = parameters.modulation.lfoAmount * (parameters.modulation.destination === 'pitch' ? 40 : 1800); lfo.connect(lfoGain); if (parameters.modulation.destination === 'pitch') lfoGain.connect(oscillator.detune); else if (parameters.modulation.destination === 'filter') lfoGain.connect(filter.frequency)
    oscillator.connect(filter).connect(gain).connect(this.output); oscillator.start(); lfo.start()
    this.voices.set(id, { oscillator, lfo, gain, filter, parameters })
    return { id, layer, midi, velocity, parameters: cloneParameters(parameters) }
  }
  stopVoice(voice: SynthVoice) { const nodes = this.voices.get(voice.id); if (!nodes) return; const now = this.context.currentTime; const end = now + Math.max(0.02, nodes.parameters.envelope.release); nodes.gain.gain.setTargetAtTime(0.0001, now, Math.max(0.01, nodes.parameters.envelope.release / 5)); nodes.oscillator.stop(end); nodes.lfo.stop(end); this.voices.delete(voice.id) }
  update(parameters: SynthParameters) { for (const nodes of this.voices.values()) { nodes.filter.frequency.setTargetAtTime(parameters.filter.frequency, this.context.currentTime, 0.02); nodes.filter.Q.setTargetAtTime(parameters.filter.resonance * 18, this.context.currentTime, 0.02) } }
}

export function createBrowserSynthBackend(): SynthAudioBackend {
  const Ctor = globalThis.AudioContext ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  return Ctor ? new WebAudioSynthBackend(new Ctor({ latencyHint: 'interactive' })) : new SilentSynthBackend()
}
