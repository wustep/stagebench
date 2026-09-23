// One synth layer's note handling (synth spec voice + arpeggiatorGate): KB Hold latch →
// arpeggiator/gate → voices. Poly mode uses the shared NoteEngine (sustain, stealing); Mono and
// Legato keep one voice, choose the sounding key by note priority (last/low/high) and glide at a
// constant rate (time ∝ interval) when playing legato. Mono retriggers the envelopes on every new
// key; Legato does not while keys overlap.
import { Arpeggiator, type ArpSettings } from './arp'
import { NoteEngine, type EngineSnapshot, type VoiceFactory, type VoiceHandle, type VoiceInfo } from './noteEngine'
import type { Priority, VoiceMode } from '../model/synthState'

export interface SynthVoiceHandle extends VoiceHandle {
  /** Move the sounding pitch to `note`, gliding over `seconds` (0 = jump). */
  setPitch(note: number, seconds: number): void
  /** Restart the envelopes with a new velocity. */
  retrigger(velocity: number): void
}

export interface SynthVoiceFactory {
  startVoice(note: number, velocity: number, onEnded: () => void, gain?: number): SynthVoiceHandle | null
}

export interface SynthLayerParams {
  mode: VoiceMode
  priority: Priority
  /** Seconds per semitone of constant-rate glide (0 = off). */
  glide: number
  /** KB Hold latch. */
  hold: boolean
  /** Arpeggiator settings while ARP RUN is on, else null. */
  arp: ArpSettings | null
}

export const SYNTH_POLYPHONY = 16
const ARP_SOURCE = 'arp'

interface Key {
  note: number
  velocity: number
  gain: number
  seq: number
}

export class SynthLayerEngine {
  private readonly poly: NoteEngine
  private params: SynthLayerParams
  /** Physical keys by source (after routing), and keys latched by KB Hold. */
  private readonly holders = new Map<number, Set<string>>()
  private readonly keys = new Map<number, Key>()
  private latched = new Set<number>()
  private seq = 0
  // Mono/legato voice.
  private mono: { handle: SynthVoiceHandle; note: number; id: number } | null = null
  private monoKeys: Key[] = []
  private monoSustained = false
  private nextMonoId = 1
  private readonly sustainSources = new Set<string>()
  readonly arp: Arpeggiator
  private readonly listeners = new Set<() => void>()
  private cache: EngineSnapshot | null = null
  private disposed = false

  constructor(
    private readonly factory: SynthVoiceFactory,
    params: SynthLayerParams,
    private readonly now: () => number,
    onGate: (time: number, step: number) => void = () => undefined,
  ) {
    this.params = params
    this.poly = new NoteEngine(factory as VoiceFactory, SYNTH_POLYPHONY)
    this.poly.subscribe(() => this.changed())
    this.arp = new Arpeggiator(params.arp ?? idleArp, {
      play: (notes) => notes.forEach((n) => this.voiceOn(n.note, n.velocity, ARP_SOURCE, n.gain)),
      stop: (notes) => notes.forEach((n) => this.voiceOff(n.note, ARP_SOURCE)),
      gate: (time, step) => onGate(time, step),
    })
  }

  get sustain(): boolean {
    return this.sustainSources.size > 0
  }

  private get arpActive(): boolean {
    return this.params.arp !== null
  }

  setParams(next: SynthLayerParams): void {
    const prev = this.params
    this.params = next
    const now = this.now()
    if (prev.mode !== next.mode) this.allVoicesOff()
    if (next.arp) this.arp.configure(next.arp)
    // ARP RUN toggled: the held chord moves between the arpeggiator and direct play.
    if (!!prev.arp !== !!next.arp || (prev.arp && next.arp && prev.arp.mode !== next.arp.mode)) {
      const chord = [...this.keys.values()]
      this.arp.reset(now)
      this.allVoicesOff()
      for (const k of chord) this.route(k, now)
    }
    if (prev.hold && !next.hold) {
      for (const note of [...this.latched]) if (!this.holders.has(note)) this.release(note, now)
      this.latched.clear()
    }
    this.changed()
  }

  /** Advance the arpeggiator clock. */
  tick(now: number): void {
    if (this.arpActive) this.arp.tick(now)
  }

  noteOn(note: number, velocity: number, source: string, gain = 1): void {
    if (this.disposed) return
    let set = this.holders.get(note)
    if (!set) {
      set = new Set()
      this.holders.set(note, set)
    }
    if (set.has(source)) return
    const physicalWasEmpty = this.holders.size === 1 && set.size === 0
    set.add(source)
    const now = this.now()
    // KB Hold: a new key after every key was lifted replaces the latched notes.
    if (this.params.hold && physicalWasEmpty && this.latched.size) {
      for (const n of [...this.latched]) this.release(n, now)
      this.latched.clear()
    }
    if (this.keys.has(note)) {
      this.latched.delete(note)
      this.changed()
      return
    }
    const key: Key = { note, velocity: Math.min(127, Math.max(1, Math.round(velocity))), gain, seq: this.seq++ }
    this.keys.set(note, key)
    this.route(key, now)
    this.changed()
  }

  noteOff(note: number, source: string): void {
    const set = this.holders.get(note)
    if (!set || !set.delete(source)) return
    if (set.size) return
    this.holders.delete(note)
    if (this.params.hold) {
      this.latched.add(note)
      this.changed()
      return
    }
    this.release(note, this.now())
    this.changed()
  }

  private route(key: Key, now: number): void {
    const arp = this.params.arp
    if (arp && arp.mode !== 'gate') {
      this.arp.keyDown({ note: key.note, velocity: key.velocity, gain: key.gain }, now)
      return
    }
    this.voiceOn(key.note, key.velocity, 'key', key.gain)
    if (arp) this.arp.keyDown({ note: key.note, velocity: key.velocity, gain: key.gain }, now)
  }

  private release(note: number, now: number): void {
    if (!this.keys.delete(note)) return
    const arp = this.params.arp
    if (arp) this.arp.keyUp(note, now)
    if (!arp || arp.mode === 'gate') this.voiceOff(note, 'key')
  }

  // ---- voice stage ----

  private voiceOn(note: number, velocity: number, source: string, gain: number): void {
    if (this.params.mode === 'poly') {
      this.poly.noteOn(note, velocity, source, gain)
      return
    }
    const key: Key = { note, velocity, gain, seq: this.seq++ }
    const legatoPlaying = this.monoKeys.length > 0
    this.monoKeys = [...this.monoKeys.filter((k) => k.note !== note), key]
    this.monoSustained = false
    this.updateMono(legatoPlaying, key)
  }

  private voiceOff(note: number, source: string): void {
    if (this.params.mode === 'poly') {
      this.poly.noteOff(note, source)
      return
    }
    const before = this.monoKeys.length
    this.monoKeys = this.monoKeys.filter((k) => k.note !== note)
    if (this.monoKeys.length === before) return
    if (this.monoKeys.length === 0) {
      if (this.sustain) this.monoSustained = true
      else this.releaseMono(false)
      this.changed()
      return
    }
    this.updateMono(true, null)
  }

  private pick(): Key | undefined {
    const keys = this.monoKeys
    if (!keys.length) return undefined
    switch (this.params.priority) {
      case 'low':
        return keys.reduce((a, b) => (b.note < a.note ? b : a))
      case 'high':
        return keys.reduce((a, b) => (b.note > a.note ? b : a))
      default:
        return keys.reduce((a, b) => (b.seq > a.seq ? b : a))
    }
  }

  /** Point the single voice at the priority key; glide only when playing legato. */
  private updateMono(legatoPlaying: boolean, pressed: Key | null): void {
    const target = this.pick()
    if (!target) return
    const cur = this.mono
    if (!cur) {
      this.startMono(target)
      return
    }
    if (cur.note !== target.note) {
      const glide = legatoPlaying && this.params.glide > 0 ? Math.abs(target.note - cur.note) * this.params.glide : 0
      cur.handle.setPitch(target.note, glide)
      cur.note = target.note
    }
    // Mono retriggers the envelopes for every new key; Legato only when nothing was held.
    if (pressed && (this.params.mode === 'mono' || !legatoPlaying)) cur.handle.retrigger(pressed.velocity)
    this.changed()
  }

  private startMono(key: Key): void {
    const id = this.nextMonoId++
    const handle = this.factory.startVoice(key.note, key.velocity, () => {
      if (this.mono?.id === id) this.mono = null
      this.changed()
    }, key.gain)
    this.mono = handle ? { handle, note: key.note, id } : null
    this.changed()
  }

  private releaseMono(fast: boolean): void {
    const m = this.mono
    this.mono = null
    m?.handle.release(fast)
  }

  private allVoicesOff(): void {
    this.poly.allNotesOff()
    this.monoKeys = []
    this.monoSustained = false
    this.releaseMono(true)
  }

  setSustain(down: boolean, source: string): void {
    const was = this.sustain
    if (down) this.sustainSources.add(source)
    else this.sustainSources.delete(source)
    this.poly.setSustain(down, source)
    if (was && !this.sustain && this.monoSustained) {
      this.monoSustained = false
      this.releaseMono(false)
    }
    if (was !== this.sustain) this.changed()
  }

  releaseSources(prefix: string): void {
    for (const [note, set] of [...this.holders]) for (const s of [...set]) if (s.startsWith(prefix)) this.noteOff(note, s)
    for (const s of [...this.sustainSources]) if (s.startsWith(prefix)) this.setSustain(false, s)
  }

  /** Everything off: keys, KB Hold latch, arpeggiator, sustain and every voice (fast fade). */
  allNotesOff(): void {
    this.holders.clear()
    this.keys.clear()
    this.latched.clear()
    this.sustainSources.clear()
    this.arp.reset(this.now())
    this.allVoicesOff()
    this.changed()
  }

  dispose(): void {
    this.disposed = true
    this.holders.clear()
    this.keys.clear()
    this.latched.clear()
    this.arp.reset(this.now())
    this.poly.dispose()
    const m = this.mono
    this.mono = null
    m?.handle.stopNow()
    this.changed()
    this.listeners.clear()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Latched (KB Hold) notes. */
  get latchedNotes(): number[] {
    return [...this.latched].sort((a, b) => a - b)
  }

  snapshot(): EngineSnapshot {
    if (!this.cache) {
      const p = this.poly.snapshot()
      const monoVoice: VoiceInfo[] = this.mono ? [{ id: -this.mono.id, note: this.mono.note, velocity: 100, phase: this.monoKeys.length ? 'held' : 'sustained', seq: 0 }] : []
      const voices = [...p.voices, ...monoVoice]
      this.cache = {
        held: [...this.holders.keys()].sort((a, b) => a - b),
        sounding: [...new Set(voices.filter((v) => v.phase !== 'releasing').map((v) => v.note))].sort((a, b) => a - b),
        sustain: this.sustain,
        voices,
        steals: p.steals,
      }
    }
    return this.cache
  }

  private changed(): void {
    this.cache = null
    this.listeners.forEach((l) => l())
  }
}

const idleArp: ArpSettings = { mode: 'arp', step: 0.25, octaves: 1, direction: 'up', gridOrigin: null, kbSync: false }
