// Routes the one shared input lifecycle (pointer, touch, computer keys, MIDI) to every layer of
// every section: Piano A/B, Organ A/B, Synth A/B/C. Each key is routed by section on/layer enable,
// KB zone and split-crossfade gain (programs spec split), then shifted by the layer's octave and the
// global Transpose. Each layer owns its voices through its own engine, so enable/disable, octave
// shift, SUSTPED and cleanup act per layer without touching the others; a released key always frees
// exactly the voices it started.
import { NoteEngine, type EngineSnapshot, type VoiceFactory, type VoiceInfo } from './noteEngine'
import { SynthLayerEngine, type SynthLayerParams, type SynthVoiceFactory } from './synthEngine'
import { zoneGain } from '../model/zones'
import { LAYERS, SLOTS, slotActive, slotLayerState, slotSection, type LayerId, type SlotId, type SoundState } from '../model/sound'

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

/** One layer's note engine (NoteEngine for piano/organ, SynthLayerEngine for synth). */
export interface SlotEngine {
  noteOn(note: number, velocity: number, source: string, gain?: number): void
  noteOff(note: number, source: string): void
  setSustain(down: boolean, source: string): void
  releaseSources(prefix: string): void
  allNotesOff(): void
  dispose(): void
  subscribe(listener: () => void): () => void
  snapshot(): EngineSnapshot
}

export interface LayeredSnapshot extends EngineSnapshot {
  voices: readonly (VoiceInfo & { layer: SlotId })[]
  /** Piano layers (Phase 2 shape). */
  perLayer: Record<LayerId, number>
  /** Every layer of every section. */
  perSlot: Record<SlotId, number>
}

export const LAYER_POLYPHONY = 24
const MIN_NOTE = 12
const MAX_NOTE = 115

export type SlotFactories = Partial<Record<SlotId, VoiceFactory | SynthVoiceFactory>>

export interface LayeredOptions {
  /** Synth layer voice-mode/arp parameters derived from the sound (null = defaults). */
  synthParams?: (slot: SlotId, sound: SoundState) => SynthLayerParams
  /** Audio time (seconds) for the arpeggiators. */
  now?: () => number
  /** Arpeggiator Gate mode steps. */
  onGate?: (slot: SlotId, time: number, step: number) => void
}

const DEFAULT_SYNTH: SynthLayerParams = { mode: 'poly', priority: 'last', glide: 0, hold: false, arp: null }

export class LayeredEngine implements PlayEngine {
  readonly engines: Partial<Record<SlotId, SlotEngine>> = {}
  private readonly holders = new Map<number, Set<string>>()
  private readonly routes = new Map<string, [SlotId, number][]>()
  private readonly sustainSources = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private readonly unsubs: (() => void)[] = []
  private cache: LayeredSnapshot | null = null
  private disposed = false

  constructor(
    factories: SlotFactories,
    private sound: SoundState,
    private readonly onLayerSustain: (layer: SlotId, down: boolean) => void = () => undefined,
    private readonly options: LayeredOptions = {},
  ) {
    for (const slot of SLOTS) {
      const f = factories[slot]
      if (!f) continue
      const engine: SlotEngine =
        slotSection(slot) === 'synth'
          ? new SynthLayerEngine(f as SynthVoiceFactory, this.synthParams(slot, sound), options.now ?? (() => 0), (t, step) => options.onGate?.(slot, t, step))
          : new NoteEngine(f as VoiceFactory, LAYER_POLYPHONY)
      this.engines[slot] = engine
      this.unsubs.push(engine.subscribe(() => this.changed()))
    }
  }

  private synthParams(slot: SlotId, sound: SoundState): SynthLayerParams {
    return this.options.synthParams ? this.options.synthParams(slot, sound) : DEFAULT_SYNTH
  }

  private slots(): SlotId[] {
    return SLOTS.filter((s) => this.engines[s])
  }

  get sustain(): boolean {
    return this.sustainSources.size > 0
  }

  private layerSustain(id: SlotId): boolean {
    return this.sustain && slotLayerState(this.sound, id).sustPed
  }

  /** New canonical sound state: disabled layers stop, SUSTPED changes follow the pedal. */
  setSound(next: SoundState): void {
    const prev = this.sound
    this.sound = next
    for (const id of this.slots()) {
      const engine = this.engines[id]!
      if (slotActive(prev, id) && !slotActive(next, id)) engine.allNotesOff()
      const pedWas = slotLayerState(prev, id).sustPed
      const pedIs = slotLayerState(next, id).sustPed
      if (pedWas !== pedIs) {
        for (const s of this.sustainSources) engine.setSustain(pedIs, s)
        this.onLayerSustain(id, this.layerSustain(id))
      }
      if (engine instanceof SynthLayerEngine) engine.setParams(this.synthParams(id, next))
    }
  }

  /** The layers (and gains) a physical key reaches right now. */
  routeFor(note: number): { slot: SlotId; note: number; gain: number }[] {
    const s = this.sound
    const out: { slot: SlotId; note: number; gain: number }[] = []
    const transpose = s.transpose.on ? s.transpose.semitones : 0
    for (const id of this.slots()) {
      if (!slotActive(s, id)) continue
      const layer = slotLayerState(s, id)
      const gain = zoneGain(s.split, layer.zone, note)
      if (gain <= 0) continue
      const shifted = Math.min(MAX_NOTE, Math.max(MIN_NOTE, note + 12 * layer.octave + transpose))
      out.push({ slot: id, note: shifted, gain })
    }
    return out
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
    const route: [SlotId, number][] = []
    for (const r of this.routeFor(note)) {
      this.engines[r.slot]!.noteOn(r.note, velocity, source, r.gain)
      route.push([r.slot, r.note])
    }
    this.routes.set(`${source}|${note}`, route)
    this.changed()
  }

  noteOff(note: number, source: string): void {
    const set = this.holders.get(note)
    if (!set || !set.delete(source)) return
    if (set.size === 0) this.holders.delete(note)
    const key = `${source}|${note}`
    // The note releases exactly the layer voices it started, even if octave/zones changed meanwhile.
    for (const [id, shifted] of this.routes.get(key) ?? []) this.engines[id]?.noteOff(shifted, source)
    this.routes.delete(key)
    this.changed()
  }

  setSustain(down: boolean, source: string): void {
    const was = this.sustain
    if (down) this.sustainSources.add(source)
    else this.sustainSources.delete(source)
    for (const id of this.slots()) if (slotLayerState(this.sound, id).sustPed) this.engines[id]!.setSustain(down, source)
    if (was !== this.sustain) {
      for (const id of this.slots()) this.onLayerSustain(id, this.layerSustain(id))
      this.changed()
    }
  }

  releaseSources(prefix: string): void {
    for (const [note, set] of [...this.holders]) {
      for (const source of [...set]) if (source.startsWith(prefix)) this.noteOff(note, source)
    }
    for (const s of [...this.sustainSources]) if (s.startsWith(prefix)) this.setSustain(false, s)
    for (const id of this.slots()) this.engines[id]!.releaseSources(prefix)
  }

  /** Advance the synth arpeggiators to audio time `now`. */
  tick(now: number): void {
    for (const id of this.slots()) {
      const e = this.engines[id]
      if (e instanceof SynthLayerEngine) e.tick(now)
    }
  }

  allNotesOff(): void {
    this.holders.clear()
    this.routes.clear()
    const hadSustain = this.sustain
    this.sustainSources.clear()
    for (const id of this.slots()) this.engines[id]!.allNotesOff()
    if (hadSustain) for (const id of this.slots()) this.onLayerSustain(id, false)
    this.changed()
  }

  dispose(): void {
    this.disposed = true
    this.holders.clear()
    this.routes.clear()
    this.sustainSources.clear()
    for (const u of this.unsubs) u()
    for (const id of this.slots()) this.engines[id]!.dispose()
    this.changed()
    this.listeners.clear()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot(): LayeredSnapshot {
    if (!this.cache) {
      const perSlot = Object.fromEntries(SLOTS.map((s) => [s, 0])) as Record<SlotId, number>
      const voices: (VoiceInfo & { layer: SlotId })[] = []
      const sounding = new Set<number>()
      let steals = 0
      for (const id of this.slots()) {
        const snap = this.engines[id]!.snapshot()
        perSlot[id] = snap.voices.length
        for (const v of snap.voices) voices.push({ ...v, layer: id })
        for (const n of snap.sounding) sounding.add(n)
        steals += snap.steals
      }
      this.cache = {
        held: [...this.holders.keys()].sort((x, y) => x - y),
        sounding: [...sounding].sort((x, y) => x - y),
        sustain: this.sustain,
        voices,
        steals,
        perLayer: { A: perSlot.A, B: perSlot.B },
        perSlot,
      }
    }
    return this.cache
  }

  private changed(): void {
    this.cache = null
    this.listeners.forEach((l) => l())
  }
}

export { LAYERS }
