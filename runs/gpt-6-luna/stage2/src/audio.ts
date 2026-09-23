import { WebAudioPianoGraph } from './audio-graph'

export type LayerId = 'A' | 'B'
export type PianoType = 'Grand' | 'Upright' | 'Electric' | 'Clav' | 'Digital' | 'Misc'

export function effectiveReleaseSeconds(baseSeconds: number, softRelease: boolean, type: PianoType): number {
  return Math.max(0.008, baseSeconds + (softRelease && type !== 'Clav' ? 0.18 : 0))
}

export interface PianoOutput {
  noteOn(id: string, midi: number, velocity: number, layers?: LayerId[]): void
  noteOff(id: string, releaseSeconds?: number, layers?: LayerId[]): void
  allNotesOff(): void
  setSustain?(isDown: boolean, layers: LayerId[]): void
  configure?(configuration: AudioConfiguration): void
  prepare?(type: PianoType): Promise<'ready' | 'fallback'>
  dispose(): void
}

export interface LayerAudioState {
  enabled: boolean
  level: number
  octave: number
  sustainPedal: boolean
  pitchStick: boolean
}

export type EffectUnitId = 'mod1' | 'mod2' | 'delay' | 'ampEq' | 'compressor' | 'reverb'

export interface EffectUnitState {
  type: string
  on: boolean
  rate: number
  amount: number
  mix: number
  time: number
  feedback: number
  filter: 'Off' | 'LP' | 'HP' | 'BP'
  drive: number
  bass: number
  mid: number
  midFrequency: number
  treble: number
  fast: boolean
  brightness: number
  decay: number
  global: boolean
}

export interface AudioConfiguration {
  pianoType: PianoType
  sectionOn: boolean
  masterLevel: number
  pitchBend: number
  layers: Record<LayerId, LayerAudioState>
  performance: {
    touch: 'Heavy' | 'Medium' | 'Light'
    dynComp: 0 | 1 | 2 | 3
    timbre: string
    unison: 0 | 1 | 2 | 3
    softRelease: boolean
    stringRes: boolean
  }
  effects: {
    focus: LayerId
    manualSection: 'Organ' | 'Piano' | 'Synth'
    group: boolean
    allBypass: boolean
    rotaryOn: boolean
    rotarySpeed: 'Slow' | 'Fast' | 'Stop'
    rotaryRate: number
    rotaryDrive: number
    units: Record<LayerId, Record<EffectUnitId, EffectUnitState>>
  }
}

export interface NoteRecord {
  id: string
  midi: number
  velocity: number
  order: number
  state: 'pressed' | 'sustained'
  layers: LayerId[]
}

export interface NoteLifecycleSnapshot {
  sustain: boolean
  sustainLayers: LayerId[]
  notes: NoteRecord[]
}

/** Shared note ownership for keybed, computer keyboard, and MIDI input. */
export class NoteLifecycle {
  private readonly notes = new Map<string, NoteRecord>()
  private order = 0
  private readonly sustainLayers = new Set<LayerId>()

  constructor(private readonly output: PianoOutput, private readonly maxVoices = 32) {}

  noteOn(id: string, midi: number, velocity: number, layers: LayerId[] = ['A']): void {
    this.noteOff(id, 0.012)
    if (this.notes.size >= this.maxVoices) {
      const oldest = [...this.notes.values()].sort((a, b) => a.order - b.order)[0]
      if (oldest) {
        this.notes.delete(oldest.id)
        this.output.noteOff(oldest.id, 0.012)
      }
    }
    const record: NoteRecord = {
      id,
      midi,
      velocity: clamp(Math.round(velocity), 1, 127),
      order: this.order++,
      state: 'pressed',
      layers: [...layers],
    }
    this.notes.set(id, record)
    try {
      this.output.noteOn(id, midi, record.velocity, record.layers)
    } catch (error) {
      this.notes.delete(id)
      throw error
    }
  }

  noteOff(id: string, releaseSeconds = 0.24): void {
    const record = this.notes.get(id)
    if (!record) return
    const releasedLayers = record.layers.filter((layer) => !this.sustainLayers.has(layer))
    const sustainedLayers = record.layers.filter((layer) => this.sustainLayers.has(layer))
    if (releasedLayers.length > 0) this.output.noteOff(id, releaseSeconds, releasedLayers)
    if (sustainedLayers.length > 0) {
      record.layers = sustainedLayers
      record.state = 'sustained'
      return
    }
    this.notes.delete(id)
  }

  setSustain(isDown: boolean, layers: LayerId[] = ['A', 'B']): void {
    const changed: LayerId[] = []
    for (const layer of layers) {
      const hadLayer = this.sustainLayers.has(layer)
      if (isDown && !hadLayer) {
        this.sustainLayers.add(layer)
        changed.push(layer)
      } else if (!isDown && hadLayer) {
        this.sustainLayers.delete(layer)
        changed.push(layer)
      }
    }
    if (changed.length === 0) return
    this.output.setSustain?.(isDown, changed)
    if (isDown) return
    for (const [id, note] of this.notes) {
      if (note.state !== 'sustained') continue
      const releasing = note.layers.filter((layer) => changed.includes(layer))
      if (releasing.length > 0) this.output.noteOff(id, undefined, releasing)
      note.layers = note.layers.filter((layer) => !releasing.includes(layer))
      if (note.layers.length === 0) this.notes.delete(id)
    }
  }

  allNotesOff(): void {
    this.notes.clear()
    this.sustainLayers.clear()
    this.output.allNotesOff()
  }

  snapshot(): NoteLifecycleSnapshot {
    return { sustain: this.sustainLayers.size > 0, sustainLayers: [...this.sustainLayers], notes: [...this.notes.values()].map((note) => ({ ...note, layers: [...note.layers] })) }
  }
}

const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value))

export const velocityAmplitude = (velocity: number): number => {
  const normalized = clamp(velocity, 1, 127) / 127
  return 0.025 + 0.72 * normalized ** 1.65
}

export const midiFrequency = (midi: number): number => 440 * 2 ** ((midi - 69) / 12)

/** Generated additive piano tone, used by the live Web Audio buffer renderer. */
export function renderPianoWave(midi: number, frameCount: number, sampleRate: number): Float32Array {
  const output = new Float32Array(frameCount)
  const frequency = midiFrequency(midi)
  const partials = [1, 0.43, 0.19, 0.075, 0.028]
  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = frame / sampleRate
    const envelope = Math.exp(-time * 2.8) * (0.94 + 0.06 * Math.exp(-time * 16))
    let sample = 0
    for (let harmonic = 1; harmonic <= partials.length; harmonic += 1) {
      const inharmonicFrequency = frequency * harmonic * (1 + 0.00018 * harmonic * harmonic)
      sample += Math.sin(2 * Math.PI * inharmonicFrequency * time) * (partials[harmonic - 1] ?? 0)
    }
    output[frame] = sample * envelope * 0.78
  }
  return output
}

export const createPianoOutput = (): PianoOutput => new WebAudioPianoGraph()
