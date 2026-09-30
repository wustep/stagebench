/**
 * The Synth engine: three independent layers (A, B, C), each with its own voices, LFO clock, gate and arpeggiator, all
 * summed into the layer outputs the graph provides (`deps.outputs`). It never touches `ctx.destination`.
 *
 * Voice model
 *  - poly   : one voice per key (cap 8 per layer, 24 in total, oldest active voice is faded out first)
 *  - mono   : one voice; every new note retriggers the envelopes; glide applies while another key is held
 *  - legato : one voice; envelopes retrigger only when no key was held, otherwise the pitch glides
 *  - priority Off = last note, Low / High = lowest / highest held key; releasing the sounding key returns to the next held one
 *  - KB Hold keeps voices (or the arpeggio) alive after the keys are lifted; the next fresh chord replaces them
 *  - Arp / Poly / Gate: steps are scheduled at exact AudioContext times from a master-clock-anchored grid (pump)
 */
import type { EngineState } from '../../engine/state'
import { arpOctaves, arpStepSeconds, type ArpState, type SynthLayerId, type SynthPatch } from '../../engine/synth'
import type { EngineDeps, LayerVoiceEngine } from '../engineTypes'
import type { AudioContextLike, AudioNodeLike, GainNodeLike, Scheduler } from '../types'
import {
  ARP_NOTE_LENGTH,
  arpStepNotes,
  gateStep,
  gridStartIndex,
  gridTime,
  retimeGrid,
  takeSteps,
  type Grid,
} from './arp'
import { Tables } from './tables'
import { lfoCycleHz, SynthVoice, type VoiceEnv, type VoiceParams } from './voice'

export const LAYER_POLYPHONY = 8
export const TOTAL_POLYPHONY = 24
export const STEAL_FADE = 0.02
export const LOOKAHEAD_SECONDS = 0.12
export const PUMP_INTERVAL_MS = 25
const DEFAULT_VELOCITY = 100

interface ArpRuntime {
  /** held notes in press order */
  notes: number[]
  velocity: Map<number, number>
  grid: Grid | null
  /** position in the arpeggio cycle */
  seqPos: number
}

interface LayerRuntime {
  id: SynthLayerId
  voices: Set<SynthVoice>
  /** keys physically down (press order) */
  keysDown: Set<number>
  /** mono/legato: keys held, in press order */
  stack: number[]
  mono: SynthVoice | null
  lfoT0: number
  lfoCycle: number
  gate: GainNodeLike | null
  gateGrid: Grid | null
  arp: ArpRuntime
}

const frac = (x: number) => x - Math.floor(x)

export const arpIsActive = (arp: ArpState): boolean => arp.run && arp.mode !== 'gate'
export const gateIsActive = (arp: ArpState): boolean => arp.run && arp.mode === 'gate'

/** the note that sounds for a held-key stack under a priority setting */
export function pickPriority(stack: readonly number[], priority: SynthPatch['voice']['priority']): number | null {
  if (stack.length === 0) return null
  if (priority === 'low') return Math.min(...stack)
  if (priority === 'high') return Math.max(...stack)
  return stack[stack.length - 1]
}

export class SynthEngine implements LayerVoiceEngine<SynthLayerId> {
  private readonly ctx: AudioContextLike
  private readonly scheduler: Scheduler
  private readonly outputs: Record<SynthLayerId, AudioNodeLike>
  private readonly tables: Tables
  private state: EngineState
  private readonly layers: Record<SynthLayerId, LayerRuntime>
  private readonly voiceTimers = new Map<SynthVoice, number>()
  private chainTimer: number | null = null
  private disposed = false

  constructor(deps: EngineDeps<SynthLayerId>) {
    this.ctx = deps.ctx
    this.scheduler = deps.scheduler
    this.outputs = deps.outputs
    this.state = deps.state
    this.tables = new Tables(deps.ctx)
    const make = (id: SynthLayerId): LayerRuntime => ({
      id,
      voices: new Set(),
      keysDown: new Set(),
      stack: [],
      mono: null,
      lfoT0: 0,
      lfoCycle: lfoCycleHz(deps.state.synth[id].patch, deps.state.clock.bpm),
      gate: null,
      gateGrid: null,
      arp: { notes: [], velocity: new Map(), grid: null, seqPos: 0 },
    })
    this.layers = { A: make('A'), B: make('B'), C: make('C') }
  }

  // --- LayerVoiceEngine ---------------------------------------------------------------------------------
  /** `when`: audio time of the key press (defaults to now; tests pre-schedule whole performances with it) */
  noteOn(layer: SynthLayerId, note: number, velocity: number, gain: number, when?: number): void {
    if (this.disposed) return
    const L = this.layers[layer]
    const patch = this.patch(layer)
    const t = when ?? this.ctx.currentTime
    const fresh = L.keysDown.size === 0
    L.keysDown.delete(note)
    L.keysDown.add(note)
    this.zoneGains.set(`${layer}:${note}`, gain)
    if (fresh && patch.kbSync) this.restartLfo(L, t)

    if (arpIsActive(patch.arp)) {
      this.arpNoteOn(L, patch, note, velocity, fresh, t)
      return
    }
    if (fresh && patch.arp.hold) this.releaseHeld(L, t)
    if (gateIsActive(patch.arp)) this.startGate(L, patch, t)

    if (patch.voice.mode === 'poly') {
      this.spawn(L, note, velocity, gain, t)
      return
    }
    // mono / legato
    const hadKeys = L.stack.length > 0
    L.stack = L.stack.filter((n) => n !== note)
    L.stack.push(note)
    const sounding = pickPriority(L.stack, patch.voice.priority) as number
    const voice = L.mono
    if (voice && !voice.released && !voice.disposed) {
      if (sounding !== voice.note) {
        voice.zoneGain = gain
        voice.retune(sounding, velocity, t, this.params(layer), { retrigger: patch.voice.mode === 'mono', glide: hadKeys })
      }
    } else {
      L.mono = this.spawn(L, sounding, velocity, gain, t)
    }
  }

  noteOff(layer: SynthLayerId, note: number, when?: number): void {
    if (this.disposed) return
    const L = this.layers[layer]
    const patch = this.patch(layer)
    const t = when ?? this.ctx.currentTime
    L.keysDown.delete(note)
    if (arpIsActive(patch.arp)) {
      if (!patch.arp.hold) {
        L.arp.notes = L.arp.notes.filter((n) => n !== note)
        if (L.arp.notes.length === 0) L.arp.grid = null
      }
      return
    }
    if (patch.voice.mode === 'poly') {
      for (const v of L.voices) {
        if (v.note !== note || v.released || v.arp || v.disposed) continue
        if (patch.arp.hold) v.held = true
        else this.releaseVoice(v, t)
      }
      return
    }
    L.stack = L.stack.filter((n) => n !== note)
    const voice = L.mono
    if (!voice || voice.released || voice.disposed) return
    if (patch.arp.hold) {
      voice.held = true
      return
    }
    const sounding = pickPriority(L.stack, patch.voice.priority)
    if (sounding === null) {
      this.releaseVoice(voice, t)
      L.mono = null
    } else if (sounding !== voice.note) {
      voice.retune(sounding, voice.velocity, t, this.params(layer), { retrigger: patch.voice.mode === 'mono', glide: true })
    }
  }

  stealNote(layer: SynthLayerId, note: number): void {
    if (this.disposed) return
    const L = this.layers[layer]
    const t = this.ctx.currentTime
    L.stack = L.stack.filter((n) => n !== note)
    for (const v of L.voices) {
      if (v.note === note && !v.arp && !v.disposed && (!v.released || (v.endTime ?? 0) > t + STEAL_FADE)) this.fadeVoice(L, v, t)
    }
  }

  setState(state: EngineState): void {
    if (this.disposed) return
    const before = this.state
    this.state = state
    const t = this.ctx.currentTime
    for (const id of ['A', 'B', 'C'] as const) {
      const L = this.layers[id]
      const prev = before.synth[id].patch
      const patch = state.synth[id].patch
      // LFO clock keeps its phase across rate changes
      const cycle = lfoCycleHz(patch, state.clock.bpm)
      if (Math.abs(cycle - L.lfoCycle) > 1e-9) {
        const phase = frac((t - L.lfoT0) * L.lfoCycle)
        L.lfoT0 = t - phase / cycle
        L.lfoCycle = cycle
      }
      const params = this.params(id)
      for (const v of L.voices) if (!v.disposed) v.applyParams(params, true)
      this.transitions(L, prev, patch, t)
    }
    this.ensureChain()
  }

  panic(): void {
    if (this.disposed) return
    const t = this.ctx.currentTime
    for (const id of ['A', 'B', 'C'] as const) {
      const L = this.layers[id]
      for (const v of L.voices) if (!v.disposed) this.fadeVoice(L, v, t)
      L.keysDown.clear()
      L.stack = []
      L.mono = null
      L.arp = { notes: [], velocity: new Map(), grid: null, seqPos: 0 }
      this.stopGate(L, t)
    }
    this.zoneGains.clear()
    this.ensureChain()
  }

  liveVoiceCount(): number {
    let n = 0
    for (const L of Object.values(this.layers)) for (const v of L.voices) if (!v.disposed) n++
    return n
  }

  pendingTimerCount(): number {
    return this.voiceTimers.size + (this.chainTimer === null ? 0 : 1)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.chainTimer !== null) this.scheduler.clearTimeout(this.chainTimer)
    this.chainTimer = null
    for (const timer of this.voiceTimers.values()) this.scheduler.clearTimeout(timer)
    this.voiceTimers.clear()
    for (const L of Object.values(this.layers)) {
      for (const v of L.voices) v.dispose()
      L.voices.clear()
      if (L.gate) {
        try {
          L.gate.disconnect()
        } catch {
          // already disconnected
        }
        L.gate = null
      }
    }
  }

  // --- arpeggiator / gate ----------------------------------------------------------------------------------
  /** the current arpeggiator state of a layer, for the OLED and tests */
  arpStatus(layer: SynthLayerId): { running: boolean; step: number; notes: number[] } {
    const L = this.layers[layer]
    const patch = this.patch(layer)
    const running = (arpIsActive(patch.arp) && L.arp.grid !== null) || (gateIsActive(patch.arp) && L.gateGrid !== null)
    return { running, step: L.arp.seqPos, notes: [...L.arp.notes] }
  }

  /**
   * Schedule every arpeggiator / gate step that starts before audio time `until`. Deterministic and idempotent: steps that
   * were already scheduled are never scheduled again. Driven by a 25 ms timer chain in normal use; tests call it directly.
   */
  pump(until: number): void {
    if (this.disposed) return
    for (const id of ['A', 'B', 'C'] as const) {
      const L = this.layers[id]
      const patch = this.patch(id)
      const stepSeconds = arpStepSeconds(patch.arp, this.state.clock.bpm)
      if (arpIsActive(patch.arp) && L.arp.grid && L.arp.notes.length > 0) {
        retimeGrid(L.arp.grid, stepSeconds)
        for (const step of takeSteps(L.arp.grid, until)) this.arpStep(L, patch, step.time, stepSeconds)
      }
      if (gateIsActive(patch.arp) && L.gateGrid) {
        if (L.keysDown.size === 0 && !this.hasHeldVoices(L)) {
          this.stopGate(L, this.ctx.currentTime)
        } else {
          retimeGrid(L.gateGrid, stepSeconds)
          for (const step of takeSteps(L.gateGrid, until)) this.gateStep(L, patch, step.time, stepSeconds)
        }
      }
    }
    this.ensureChain()
  }

  private arpNoteOn(L: LayerRuntime, patch: SynthPatch, note: number, velocity: number, fresh: boolean, t: number) {
    const arp = L.arp
    if (fresh) {
      if (patch.arp.hold) arp.notes = []
      arp.seqPos = 0
    }
    arp.velocity.set(note, velocity)
    if (!arp.notes.includes(note)) arp.notes.push(note)
    const stepSeconds = arpStepSeconds(patch.arp, this.state.clock.bpm)
    if (!arp.grid || (fresh && patch.kbSync)) {
      // locked to the master clock: steps fall on multiples of the step length from time 0 (KB Sync restarts the grid at the key press)
      const origin = patch.kbSync ? t : 0
      arp.grid = { origin, index: gridStartIndex(origin, stepSeconds, t), stepSeconds }
    }
    this.ensureChain()
  }

  private arpStep(L: LayerRuntime, patch: SynthPatch, time: number, stepSeconds: number) {
    const mode = patch.arp.mode === 'poly' ? 'poly' : 'arp'
    const notes = arpStepNotes(mode, L.arp.notes, arpOctaves(patch.arp.range), patch.arp.direction, L.arp.seqPos)
    L.arp.seqPos++
    for (const note of notes) {
      const velocity = this.arpVelocity(L, note)
      const voice = this.spawn(L, note, velocity, this.zoneGains.get(`${L.id}:${note}`) ?? 1, time, true)
      this.releaseVoice(voice, time + stepSeconds * ARP_NOTE_LENGTH)
    }
  }

  private arpVelocity(L: LayerRuntime, note: number): number {
    for (const [base, v] of L.arp.velocity) if ((note - base) % 12 === 0 && note >= base) return v
    return DEFAULT_VELOCITY
  }

  private startGate(L: LayerRuntime, patch: SynthPatch, t: number) {
    if (L.gateGrid) return
    const stepSeconds = arpStepSeconds(patch.arp, this.state.clock.bpm)
    const origin = patch.kbSync ? t : 0
    L.gateGrid = { origin, index: gridStartIndex(origin, stepSeconds, t), stepSeconds }
    const gate = this.gateNode(L)
    gate.gain.cancelScheduledValues(t)
    gate.gain.setValueAtTime(0, t)
    this.ensureChain()
  }

  private stopGate(L: LayerRuntime, t: number) {
    L.gateGrid = null
    if (L.gate) {
      L.gate.gain.cancelScheduledValues(t)
      L.gate.gain.setValueAtTime(1, t)
    }
  }

  private gateStep(L: LayerRuntime, patch: SynthPatch, time: number, stepSeconds: number) {
    const g = this.gateNode(L).gain
    const s = gateStep(time, stepSeconds, patch.arp.range)
    g.setValueAtTime(0, s.open)
    g.linearRampToValueAtTime(1, s.openEnd)
    g.setValueAtTime(1, Math.max(s.openEnd, s.close))
    g.linearRampToValueAtTime(0, s.closeEnd)
  }

  private gateNode(L: LayerRuntime): GainNodeLike {
    if (!L.gate) {
      L.gate = this.ctx.createGain()
      L.gate.gain.value = 1
      L.gate.connect(this.outputs[L.id])
    }
    return L.gate
  }

  private hasHeldVoices(L: LayerRuntime): boolean {
    for (const v of L.voices) if (!v.disposed && !v.released) return true
    return false
  }

  /** react to a control change that alters what is held or sounding */
  private transitions(L: LayerRuntime, prev: SynthPatch, patch: SynthPatch, t: number) {
    const wasArp = arpIsActive(prev.arp)
    const isArp = arpIsActive(patch.arp)
    if (isArp && !wasArp) {
      // the keys that are down move into the arpeggiator; their plain voices let go
      L.arp.notes = [...L.keysDown]
      L.arp.seqPos = 0
      for (const v of L.voices) if (!v.released && !v.arp && !v.disposed) this.releaseVoice(v, t)
      L.stack = []
      L.mono = null
      if (L.arp.notes.length) {
        const stepSeconds = arpStepSeconds(patch.arp, this.state.clock.bpm)
        const origin = patch.kbSync ? t : 0
        L.arp.grid = { origin, index: gridStartIndex(origin, stepSeconds, t), stepSeconds }
      }
    } else if (!isArp && wasArp) {
      L.arp.notes = []
      L.arp.grid = null
      L.arp.seqPos = 0
      for (const v of L.voices) if (v.arp && !v.released && !v.disposed) this.releaseVoice(v, t)
    }
    if (gateIsActive(patch.arp) && !gateIsActive(prev.arp) && (L.keysDown.size > 0 || this.hasHeldVoices(L))) this.startGate(L, patch, t)
    if (!gateIsActive(patch.arp) && gateIsActive(prev.arp)) this.stopGate(L, t)
    if (prev.arp.hold && !patch.arp.hold) {
      // KB Hold released: whatever is no longer physically down lets go
      for (const v of L.voices) if (v.held && !v.released && !v.disposed && !L.keysDown.has(v.note)) this.releaseVoice(v, t)
      for (const v of L.voices) v.held = false
      if (isArp) {
        L.arp.notes = L.arp.notes.filter((n) => L.keysDown.has(n))
        if (L.arp.notes.length === 0) L.arp.grid = null
      }
      if (L.mono && L.stack.length === 0 && !L.mono.released) {
        this.releaseVoice(L.mono, t)
        L.mono = null
      }
    }
  }

  // --- voices -------------------------------------------------------------------------------------------
  private readonly zoneGains = new Map<string, number>()

  private patch(layer: SynthLayerId): SynthPatch {
    return this.state.synth[layer].patch
  }

  private params(layer: SynthLayerId): VoiceParams {
    const s = this.state
    const L = s.synth[layer]
    return { patch: L.patch, bpm: s.clock.bpm, modWheel: s.modWheel, bendCents: L.pitchStick ? s.pitchBend * 200 : 0 }
  }

  private voiceEnv(L: LayerRuntime): VoiceEnv {
    return {
      ctx: this.ctx,
      tables: this.tables,
      out: this.gateNode(L),
      lfoPhase: (t: number) => frac((t - L.lfoT0) * L.lfoCycle),
    }
  }

  private restartLfo(L: LayerRuntime, t: number) {
    L.lfoT0 = t
  }

  private spawn(L: LayerRuntime, note: number, velocity: number, gain: number, when: number, arp = false): SynthVoice {
    this.capVoices(L, when)
    const voice = new SynthVoice(this.voiceEnv(L), note, velocity, gain, when, this.params(L.id))
    voice.arp = arp
    L.voices.add(voice)
    return voice
  }

  /** keep at most LAYER_POLYPHONY active voices per layer and TOTAL_POLYPHONY overall: the oldest active voice fades out */
  private capVoices(L: LayerRuntime, when: number) {
    const active = (layer: LayerRuntime) => [...layer.voices].filter((v) => !v.released && !v.disposed).sort((a, b) => a.startedAt - b.startedAt)
    for (let guard = 0; guard < 64; guard++) {
      const mine = active(L)
      if (mine.length >= LAYER_POLYPHONY) {
        this.fadeVoice(L, mine[0], Math.max(when, this.ctx.currentTime))
        continue
      }
      const all = Object.values(this.layers).flatMap((layer) => active(layer).map((v) => ({ layer, v })))
      if (all.length >= TOTAL_POLYPHONY) {
        all.sort((a, b) => a.v.startedAt - b.v.startedAt)
        this.fadeVoice(all[0].layer, all[0].v, Math.max(when, this.ctx.currentTime))
        continue
      }
      break
    }
  }

  private releaseVoice(voice: SynthVoice, t: number) {
    if (voice.released || voice.disposed) return
    const L = this.layers[this.layerOf(voice)]
    voice.release(t, this.patch(L.id))
    this.scheduleDispose(L, voice)
  }

  private fadeVoice(L: LayerRuntime, voice: SynthVoice, t: number) {
    if (voice.disposed) return
    voice.fade(t, STEAL_FADE)
    if (L.mono === voice) L.mono = null
    this.scheduleDispose(L, voice)
  }

  private layerOf(voice: SynthVoice): SynthLayerId {
    for (const id of ['A', 'B', 'C'] as const) if (this.layers[id].voices.has(voice)) return id
    return 'A'
  }

  private scheduleDispose(L: LayerRuntime, voice: SynthVoice) {
    const previous = this.voiceTimers.get(voice)
    if (previous !== undefined) this.scheduler.clearTimeout(previous)
    const ms = Math.max(0, (voice.audibleUntil - this.ctx.currentTime) * 1000)
    const id = this.scheduler.setTimeout(() => {
      this.voiceTimers.delete(voice)
      voice.dispose()
      L.voices.delete(voice)
      if (L.mono === voice) L.mono = null
    }, ms)
    this.voiceTimers.set(voice, id)
  }

  private releaseHeld(L: LayerRuntime, t: number) {
    for (const v of L.voices) {
      if (v.held && !v.released && !v.disposed) this.releaseVoice(v, t)
      v.held = false
    }
    if (L.mono && L.mono.released) L.mono = null
    L.stack = []
  }

  // --- timer chain -----------------------------------------------------------------------------------------
  private needsChain(): boolean {
    for (const id of ['A', 'B', 'C'] as const) {
      const L = this.layers[id]
      const patch = this.patch(id)
      if (arpIsActive(patch.arp) && L.arp.grid && L.arp.notes.length > 0) return true
      if (gateIsActive(patch.arp) && L.gateGrid) return true
    }
    return false
  }

  private ensureChain() {
    if (this.disposed) return
    const need = this.needsChain()
    if (need && this.chainTimer === null) {
      this.chainTimer = this.scheduler.setTimeout(() => {
        this.chainTimer = null
        this.pump(this.ctx.currentTime + LOOKAHEAD_SECONDS)
      }, PUMP_INTERVAL_MS)
    } else if (!need && this.chainTimer !== null) {
      this.scheduler.clearTimeout(this.chainTimer)
      this.chainTimer = null
    }
  }

  /** for tests and diagnostics */
  voiceNotes(layer: SynthLayerId): number[] {
    return [...this.layers[layer].voices].filter((v) => !v.disposed).map((v) => v.note)
  }
  nextArpStepTime(layer: SynthLayerId): number | null {
    const g = this.layers[layer].arp.grid
    return g ? gridTime(g) : null
  }
}
