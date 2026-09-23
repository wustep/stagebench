// Routes the one shared input lifecycle (pointer, touch, computer keys, MIDI) to the two piano
// layers. Each layer owns its voices through its own NoteEngine, so enable/disable, octave shift,
// SUSTPED and cleanup act per layer without touching the other layer's voices.
import { NoteEngine, type EngineSnapshot, type VoiceFactory, type VoiceInfo } from './noteEngine'
import { LAYERS, type LayerId, type SoundState } from '../model/sound'

/** What every input needs from the note lifecycle (NoteEngine and LayeredEngine both satisfy it). */
export interface PlayEngine {
  readonly sustain: boolean
  noteOn(note: number, velocity: number, source: string): void
  noteOff(note: number, source: string): void
  setSustain(down: boolean, source: string): void
  releaseSources(prefix: string): void
  allNotesOff(): void
  dispose(): void
  subscribe(listener: () => void): () => void
  snapshot(): EngineSnapshot
}

export interface LayeredSnapshot extends EngineSnapshot {
  voices: readonly (VoiceInfo & { layer: LayerId })[]
  perLayer: Record<LayerId, number>
}

export const LAYER_POLYPHONY = 24
const MIN_NOTE = 12
const MAX_NOTE = 115

export class LayeredEngine implements PlayEngine {
  readonly engines: Record<LayerId, NoteEngine>
  private readonly holders = new Map<number, Set<string>>()
  private readonly routes = new Map<string, [LayerId, number][]>()
  private readonly sustainSources = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private readonly unsubs: (() => void)[] = []
  private cache: LayeredSnapshot | null = null
  private disposed = false

  constructor(
    factories: Record<LayerId, VoiceFactory>,
    private sound: SoundState,
    private readonly onLayerSustain: (layer: LayerId, down: boolean) => void = () => undefined,
  ) {
    this.engines = { A: new NoteEngine(factories.A, LAYER_POLYPHONY), B: new NoteEngine(factories.B, LAYER_POLYPHONY) }
    for (const id of LAYERS) this.unsubs.push(this.engines[id].subscribe(() => this.changed()))
  }

  get sustain(): boolean {
    return this.sustainSources.size > 0
  }

  private layerSustain(id: LayerId): boolean {
    return this.sustain && this.sound.piano.layers[id].sustPed
  }

  /** New canonical sound state: disabled layers stop, SUSTPED changes follow the pedal. */
  setSound(next: SoundState): void {
    const prev = this.sound
    this.sound = next
    for (const id of LAYERS) {
      const was = prev.piano.on && prev.piano.layers[id].enabled
      const is = next.piano.on && next.piano.layers[id].enabled
      if (was && !is) this.engines[id].allNotesOff()
      const pedWas = prev.piano.layers[id].sustPed
      const pedIs = next.piano.layers[id].sustPed
      if (pedWas !== pedIs) {
        for (const s of this.sustainSources) this.engines[id].setSustain(pedIs, s)
        this.onLayerSustain(id, this.layerSustain(id))
      }
    }
  }

  noteOn(note: number, velocity: number, source: string): void {
    if (this.disposed) return
    let set = this.holders.get(note)
    if (!set) {
      set = new Set()
      this.holders.set(note, set)
    }
    if (set.has(source)) return
    set.add(source)
    const route: [LayerId, number][] = []
    if (this.sound.piano.on) {
      for (const id of LAYERS) {
        const layer = this.sound.piano.layers[id]
        if (!layer.enabled) continue
        const shifted = Math.min(MAX_NOTE, Math.max(MIN_NOTE, note + 12 * layer.octave))
        this.engines[id].noteOn(shifted, velocity, source)
        route.push([id, shifted])
      }
    }
    this.routes.set(`${source}|${note}`, route)
    this.changed()
  }

  noteOff(note: number, source: string): void {
    const set = this.holders.get(note)
    if (!set || !set.delete(source)) return
    if (set.size === 0) this.holders.delete(note)
    const key = `${source}|${note}`
    // The note releases exactly the layer voices it started, even if the octave changed meanwhile.
    for (const [id, shifted] of this.routes.get(key) ?? []) this.engines[id].noteOff(shifted, source)
    this.routes.delete(key)
    this.changed()
  }

  setSustain(down: boolean, source: string): void {
    const was = this.sustain
    if (down) this.sustainSources.add(source)
    else this.sustainSources.delete(source)
    for (const id of LAYERS) if (this.sound.piano.layers[id].sustPed) this.engines[id].setSustain(down, source)
    if (was !== this.sustain) {
      for (const id of LAYERS) this.onLayerSustain(id, this.layerSustain(id))
      this.changed()
    }
  }

  releaseSources(prefix: string): void {
    for (const [note, set] of [...this.holders]) {
      for (const source of [...set]) if (source.startsWith(prefix)) this.noteOff(note, source)
    }
    for (const s of [...this.sustainSources]) if (s.startsWith(prefix)) this.setSustain(false, s)
    for (const id of LAYERS) this.engines[id].releaseSources(prefix)
  }

  allNotesOff(): void {
    this.holders.clear()
    this.routes.clear()
    const hadSustain = this.sustain
    this.sustainSources.clear()
    for (const id of LAYERS) this.engines[id].allNotesOff()
    if (hadSustain) for (const id of LAYERS) this.onLayerSustain(id, false)
    this.changed()
  }

  dispose(): void {
    this.disposed = true
    this.holders.clear()
    this.routes.clear()
    this.sustainSources.clear()
    for (const u of this.unsubs) u()
    for (const id of LAYERS) this.engines[id].dispose()
    this.changed()
    this.listeners.clear()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot(): LayeredSnapshot {
    if (!this.cache) {
      const a = this.engines.A.snapshot()
      const b = this.engines.B.snapshot()
      const voices = [...a.voices.map((v) => ({ ...v, layer: 'A' as const })), ...b.voices.map((v) => ({ ...v, layer: 'B' as const }))]
      this.cache = {
        held: [...this.holders.keys()].sort((x, y) => x - y),
        sounding: [...new Set([...a.sounding, ...b.sounding])].sort((x, y) => x - y),
        sustain: this.sustain,
        voices,
        steals: a.steals + b.steals,
        perLayer: { A: a.voices.length, B: b.voices.length },
      }
    }
    return this.cache
  }

  private changed(): void {
    this.cache = null
    this.listeners.forEach((l) => l())
  }
}
