/**
 * The Performer is the one NoteSink behind the NoteBus: it routes every key to the Piano, Organ and Synth layers of
 * the current program according to the keyboard zones and split crossfades (manual p. 39), applies Transpose
 * (manual p. 40), honours Layer Scenes (the live on-flags) and the Master Clock keyboard sync, and remembers where
 * each key went so a note released after a transpose or zone change still stops the right voices.
 */
import type { LayerId, PianoEngine } from './engine'
import type { SynthLayerId } from '../dsp/synthTypes'
import type { InstrumentStore } from '../state/instrumentState'
import { layerNoteGain, type LayerKey, type ProgramState } from '../state/programState'
import type { NoteSink } from '../input/noteBus'

interface Route {
  played: number
  piano: boolean
  organ: LayerId[]
  synth: SynthLayerId[]
}

export interface PerformerHooks {
  /** Called before routing a key; returning true consumes the key (SET KEY for a split point). */
  onKey?: (midi: number) => boolean
}

/** Gain with which a layer plays a note under the current program (0 when the layer or its section is off). */
export function layerGainFor(p: ProgramState, key: LayerKey, played: number): number {
  const section = key.startsWith('organ') ? p.organ : key.startsWith('piano') ? p.piano : p.synth
  if (!section.on) return 0
  const layerOn = key === 'organA' ? p.organ.layers.A.on : key === 'organB' ? p.organ.layers.B.on : key === 'pianoA' ? p.piano.layers.A.on : key === 'pianoB' ? p.piano.layers.B.on : key === 'synthA' ? p.synth.layers.A.on : key === 'synthB' ? p.synth.layers.B.on : p.synth.layers.C.on
  if (!layerOn) return 0
  return layerNoteGain(p.split, p.zones[key], played)
}

export function transposedNote(p: ProgramState, midi: number): number {
  return midi + (p.transpose.on ? p.transpose.semitones : 0)
}

export class Performer implements NoteSink {
  private routes = new Map<number, Route>()

  constructor(
    private readonly engine: PianoEngine,
    private readonly store: InstrumentStore,
    private readonly hooks: PerformerHooks = {},
  ) {}

  /** Keys currently routed (source note numbers). */
  heldKeys(): number[] {
    return [...this.routes.keys()].sort((a, b) => a - b)
  }

  routeOf(midi: number): Route | undefined {
    return this.routes.get(midi)
  }

  noteOn(midi: number, velocity: number): boolean {
    if (this.hooks.onKey?.(midi)) return false
    const p = this.store.get()
    const played = transposedNote(p, midi)
    const existing = this.routes.get(midi)
    if (existing && existing.played !== played) this.noteOff(midi)
    if (p.clock.kbSync && this.routes.size === 0) this.engine.synthClockReset()
    const route: Route = { played, piano: false, organ: [], synth: [] }
    const pianoGains: Partial<Record<LayerId, number>> = {}
    let anyPiano = false
    for (const id of ['A', 'B'] as const) {
      const g = layerGainFor(p, id === 'A' ? 'pianoA' : 'pianoB', played)
      if (g > 0) {
        pianoGains[id] = g
        anyPiano = true
      }
    }
    let started = false
    if (anyPiano) {
      route.piano = true
      if (this.engine.noteOn(played, velocity, pianoGains)) started = true
    }
    for (const id of ['A', 'B'] as const) {
      const g = layerGainFor(p, id === 'A' ? 'organA' : 'organB', played)
      if (g > 0) {
        route.organ.push(id)
        if (this.engine.organNoteOn(id, played, velocity, g)) started = true
      }
    }
    for (const id of ['A', 'B', 'C'] as const) {
      const g = layerGainFor(p, `synth${id}` as LayerKey, played)
      if (g > 0) {
        route.synth.push(id)
        if (this.engine.synthNoteOn(id, played, velocity, g)) started = true
      }
    }
    this.routes.set(midi, route)
    if (!route.piano && route.organ.length === 0 && route.synth.length === 0) this.engine.noteOn(played, velocity, {})
    return started
  }

  noteOff(midi: number): void {
    const route = this.routes.get(midi)
    if (!route) return
    this.routes.delete(midi)
    if (route.piano) this.engine.noteOff(route.played)
    for (const id of route.organ) this.engine.organNoteOff(id, route.played)
    for (const id of route.synth) this.engine.synthNoteOff(id, route.played)
  }

  setSustain(on: boolean): void {
    this.engine.setSustain(on)
    this.engine.organSetSustain(on)
    this.engine.synthSetSustain(on)
  }

  allNotesOff(): void {
    this.routes.clear()
    this.engine.allNotesOff()
  }
}
