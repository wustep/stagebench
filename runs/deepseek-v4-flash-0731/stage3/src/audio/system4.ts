/**
 * Phase 3 — System4: the complete Stage 4 instrument as one serializable
 * system.
 *
 * Composes the Piano engine (StageEngine, extended), the Organ engine and the
 * Synth engine over the SAME shared Rotary and ONE master/limiter path. Owns
 * the Program bank (32 regular slots + 8 Live), Store / Store As / dirty
 * lifecycle, splits & zones with crossfades, Layer Scenes I/II, Wheel and
 * Control Pedal morphs, the Master Clock, Transpose and Panic. Note input is
 * transposed, scene/zone routed and crossfade-gained before it reaches any
 * engine; effect chains and the rotary remain the Phase 2 bus architecture.
 *
 * Pure DSP on an injectable clock: render mixes real PCM from every engine
 * through the shared master path, so tests prove one-context routing and that
 * nothing bypasses the master.
 */

import { StageEngine, type LayerState } from './stage'
import { OrganEngine } from './organ'
import { SynthEngine, type ClockRef } from './synth'
import { Rotary } from './effects'
import { SampleLibrary } from './samples'
import type { RenderResult } from './types'
import type { LayerChainState } from './chain'
import {
  ALL_LAYER_REFS, type LayerRef, type ProgramState, type SceneState, type ZoneRange,
} from '../system/program'
import { defaultProgramState, defaultPianoLayer, factoryPrograms } from '../system/factory'
import { applyMorphs, assignMorph, clearMorphs, cloneProgram, removeMorph } from '../system/morph'

const SLOTS = 32
const LIVE_SLOTS = 8

const REF_TO_ENUM: Record<LayerRef, { kind: 'piano' | 'organ' | 'synth'; index: number }> = {
  'piano.A': { kind: 'piano', index: 0 },
  'piano.B': { kind: 'piano', index: 1 },
  'organ.A': { kind: 'organ', index: 0 },
  'organ.B': { kind: 'organ', index: 1 },
  'synth.A': { kind: 'synth', index: 0 },
  'synth.B': { kind: 'synth', index: 1 },
  'synth.C': { kind: 'synth', index: 2 },
}

function zoneOf(midi: number, points: { low: number; mid: number; high: number }): number {
  if (midi < points.low) return 0
  if (midi < points.mid) return 1
  if (midi < points.high) return 2
  return 3
}

function crossfadeGain(midi: number, split: ProgramState['split'], zr: ZoneRange): number {
  if (!split.on) return 1
  const z = zoneOf(midi, split.points)
  if (zr === 'full') return 1
  if (z >= zr.low && z <= zr.high) {
    // fade near the upper edge when the next zone is unassigned
    if (z === zr.high && z < 3) {
      const boundary = [split.points.low, split.points.mid, split.points.high][z] ?? split.points.high
      const w = split.crossfade[z === 0 ? 'low' : z === 1 ? 'mid' : 'high']
      if (w === 0) return 1
      return Math.min(1, Math.max(0, ((boundary + w) - midi) / w))
    }
    if (z === zr.low && z > 0) {
      const boundary = [split.points.low, split.points.mid][z - 1] ?? split.points.low
      const w = split.crossfade[z === 1 ? 'low' : z === 2 ? 'mid' : 'high']
      if (w === 0) return 1
      return Math.min(1, Math.max(0, (midi - (boundary - w)) / w))
    }
    return 1
  }
  if (z < zr.low) {
    if (zr.low === 0) return 0
    const boundary = [split.points.low, split.points.mid, split.points.high][zr.low - 1] ?? split.points.low
    const w = split.crossfade[zr.low === 1 ? 'low' : zr.low === 2 ? 'mid' : 'high']
    if (w === 0) return 0
    return Math.min(1, Math.max(0, (midi - (boundary - w)) / w))
  }
  // z > zr.high
  if (zr.high === 3) return 0
  const boundary = [split.points.low, split.points.mid, split.points.high][zr.high] ?? split.points.high
  const w = split.crossfade[zr.high === 0 ? 'low' : zr.high === 1 ? 'mid' : 'high']
  if (w === 0) return 0
  return Math.min(1, Math.max(0, ((boundary + w) - midi) / w))
}

export interface System4Options {
  sampleRate?: number
  library?: SampleLibrary
  programs?: ProgramState[]
}

export class System4 {
  readonly sampleRate: number
  readonly piano: StageEngine
  readonly organ: OrganEngine
  readonly synth: SynthEngine
  readonly rotary: Rotary
  private master = 0.8
  private clockRef: ClockRef

  // program memory
  private slots: ProgramState[]
  private liveSlots: ProgramState[]
  private liveMode = false
  private currentRegular = 0
  private currentLive = 0
  private storedBase: ProgramState // stored state of current program (dirty compare)
  private working: ProgramState // the editable working program
  private dirtyFlag = false
  private storeArmed = false
  private storeTarget: number | null = null
  private storingToLive = false
  private wheelVal = 0
  private pedalVal = 0
  private panicked = false
  private version = 0
  private listeners = new Set<() => void>()

  constructor(options: System4Options = {}) {
    this.sampleRate = options.sampleRate ?? 44_100
    this.rotary = new Rotary(this.sampleRate)
    this.clockRef = { tempo: 120, sync: true }
    this.piano = new StageEngine({ sampleRate: this.sampleRate, library: options.library, rotary: this.rotary })
    this.organ = new OrganEngine({ sampleRate: this.sampleRate, rotary: this.rotary })
    this.synth = new SynthEngine({ sampleRate: this.sampleRate, rotary: this.rotary })
    this.synth.bindClock(this.clockRef)
    const factory = factoryPrograms()
    this.slots = Array.from({ length: SLOTS }, (_, i) => cloneProgram(factory[i] ?? defaultProgramState()))
    this.liveSlots = Array.from({ length: LIVE_SLOTS }, () => cloneProgram(factory[5] ?? defaultProgramState()))
    this.working = cloneProgram(this.slots[this.currentRegular])
    this.storedBase = cloneProgram(this.slots[this.currentRegular])
    this.piano.setMasterLevel(1)
    this.applyEngines()
  }

  /* ----------------------------- program memory ----------------------- */

  get currentProgram(): ProgramState {
    return this.working
  }

  get isLiveMode(): boolean {
    return this.liveMode
  }

  get currentIndex(): number {
    return this.liveMode ? this.currentLive : this.currentRegular
  }

  get page(): number {
    return Math.floor((this.liveMode ? this.currentLive : this.currentRegular) / 8)
  }

  get isDirty(): boolean {
    return this.dirtyFlag
  }

  get storeArmedState(): boolean {
    return this.storeArmed
  }

  slotAt(i: number): ProgramState {
    const s = this.liveMode ? this.liveSlots : this.slots
    return cloneProgram(s[Math.max(0, Math.min(s.length - 1, i))])
  }

  /** mark a control edit (only marks dirty; live slots auto-store). */
  markEdited(): void {
    if (this.liveMode) {
      this.liveSlots[this.currentLive] = cloneProgram(this.working)
      return
    }
    this.dirtyFlag = true
  }

  /** select a program slot (0-based within the active set). */
  selectProgram(i: number): void {
    const bank = this.liveMode ? this.liveSlots : this.slots
    const idx = ((i % bank.length) + bank.length) % bank.length
    if (this.liveMode) {
      this.currentLive = idx
    } else {
      // edit-discard on program change.
      this.dirtyFlag = false
      this.currentRegular = idx
    }
    this.storeArmed = false
    this.storeTarget = null
    this.working = cloneProgram(bank[idx])
    this.storedBase = cloneProgram(bank[idx])
    this.applyEngines()
  }

  pageUp(): void {
    this.selectProgram(this.currentIndex + 8)
  }

  pageDown(): void {
    this.selectProgram(this.currentIndex - 8)
  }

  dialNudge(delta: number): void {
    this.selectProgram(this.currentIndex + Math.sign(delta))
  }

  /** STORE first press: arm and pick destination; second press: confirm. */
  storePress(): void {
    if (!this.storeArmed) {
      this.storeArmed = true
      this.storeTarget = this.currentIndex
      this.storingToLive = this.liveMode
      return
    }
    this.storeConfirm()
  }

  storeConfirm(): void {
    if (this.storeTarget === null) this.storeTarget = this.currentIndex
    const target = this.storeTarget
    if (this.liveMode || this.storingToLive) {
      this.liveSlots[Math.max(0, Math.min(LIVE_SLOTS - 1, target))] = cloneProgram(this.working)
      if (!this.liveMode) {
        // copied a regular program into a Live slot — regular stays clean.
        this.dirtyFlag = false
      }
    } else {
      const idx = Math.max(0, Math.min(SLOTS - 1, target))
      this.slots[idx] = cloneProgram(this.working)
      this.dirtyFlag = false
    }
    this.storedBase = cloneProgram(this.working)
    this.storeArmed = false
    this.storeTarget = null
    this.storingToLive = false
    this.applyEngines()
  }

  cancelStore(): void {
    this.storeArmed = false
    this.storeTarget = null
    this.storingToLive = false
  }

  /** STORE AS with a name; calls back with the armed store flow. */
  storeAs(name: string): void {
    this.working.name = name
    this.dirtyFlag = true
    this.storeArmed = true
    this.storeTarget = this.currentIndex
    this.storingToLive = this.liveMode
  }

  /** Layer Scenes I/II: swaps the active enable mask (sound params shared). */
  setScene(which: 'I' | 'II'): void {
    this.working.scenes.active = which
    this.markEdited()
    this.applyEngines()
  }

  get activeScene(): 'I' | 'II' {
    return this.working.scenes.active
  }

  /** SPLIT ON/SET toggles a single Mid split at C4 (default). */
  toggleSplit(): void {
    this.working.split.on = !this.working.split.on
    if (this.working.split.on && this.working.split.points.mid !== 60) this.working.split.points.mid = 60
    this.markEdited()
    this.applyEngines()
  }

  toggleLive(): void {
    this.liveMode = !this.liveMode
    this.storeArmed = false
    this.storeTarget = null
    this.currentLive = Math.min(this.currentLive, LIVE_SLOTS - 1)
    this.working = cloneProgram((this.liveMode ? this.liveSlots : this.slots)[this.liveMode ? this.currentLive : this.currentRegular])
    this.storedBase = cloneProgram(this.working)
    this.dirtyFlag = false
    this.applyEngines()
  }

  /** adopt a program as the editable working program (never mutates the
   *  caller's object). */
  setWorking(p: ProgramState): void {
    const adopted = cloneProgram(p)
    if (JSON.stringify(this.working) === JSON.stringify(adopted)) return // no-op
    this.working = adopted
    this.markEdited()
    this.applyEngines()
  }

  /* ------------------------------ persistence ------------------------- */

  serialize(): unknown {
    return {
      slots: this.slots.map(cloneProgram),
      liveSlots: this.liveSlots.map(cloneProgram),
      liveMode: this.liveMode,
    }
  }

  hydrate(data: { slots?: ProgramState[]; liveSlots?: ProgramState[]; liveMode?: boolean } | unknown): void {
    const d = data as { slots?: ProgramState[]; liveSlots?: ProgramState[]; liveMode?: boolean }
    if (d?.slots && d.slots.length === SLOTS) this.slots = d.slots.map(cloneProgram)
    if (d?.liveSlots && d.liveSlots.length === LIVE_SLOTS) this.liveSlots = d.liveSlots.map(cloneProgram)
    if (typeof d?.liveMode === 'boolean') this.liveMode = d.liveMode
    this.working = cloneProgram(this.slots[this.liveMode ? this.currentLive : this.currentRegular])
    this.storedBase = cloneProgram(this.working)
    this.applyEngines()
  }

  /* -------------------------------- morphs ---------------------------- */

  setWheel(v: number): void {
    this.wheelVal = Math.max(0, Math.min(1, v))
    this.applyEngines()
  }

  setPedal(v: number): void {
    this.pedalVal = Math.max(0, Math.min(1, v))
    this.applyEngines()
  }

  get wheel(): number {
    return this.wheelVal
  }

  get pedal(): number {
    return this.pedalVal
  }

  assignMorph(source: 'wheel' | 'pedal', path: string, from: number, to: number): void {
    this.working.morph = assignMorph(this.working.morph, source === 'wheel' ? 0 : 1, { path, from, to })
    this.markEdited()
    this.applyEngines()
  }

  clearMorph(source: 'wheel' | 'pedal'): void {
    this.working.morph = clearMorphs(this.working.morph, source === 'wheel' ? 0 : 1)
    this.markEdited()
    this.applyEngines()
  }

  removeMorph(source: 'wheel' | 'pedal', path: string): void {
    this.working.morph = removeMorph(this.working.morph, source === 'wheel' ? 0 : 1, path)
    this.markEdited()
    this.applyEngines()
  }

  /** how many assignments a morph source carries. */
  morphAssignmentCount(source: 'wheel' | 'pedal'): number {
    return (source === 'wheel' ? this.working.morph.wheel : this.working.morph.pedal).length
  }

  /** assigned paths for a morph source (drives the green morph LEDs). */
  morphLEDs(source: 'wheel' | 'pedal'): string[] {
    return (source === 'wheel' ? this.working.morph.wheel : this.working.morph.pedal).map((a) => a.path)
  }

  /** the program with both morph sources applied (never mutates stored state). */
  private morphed(): ProgramState {
    let p = this.working
    if (this.working.morph.wheel.length > 0) p = applyMorphs(p, 0, this.wheelVal)
    if (this.working.morph.pedal.length > 0) p = applyMorphs(p, 1, this.pedalVal)
    return p
  }

  /* --------------------------- clock / transpose ---------------------- */

  setTempo(bpm: number): void {
    this.clockRef.tempo = Math.max(30, Math.min(300, bpm))
    this.working.clock.tempo = this.clockRef.tempo
  }

  tap(): void {
    this.masterClockTap()
  }

  private taps: number[] = []
  private masterClockTap(): void {
    const now = performance.now()
    this.taps.push(now)
    if (this.taps.length > 4) this.taps.shift()
    if (this.taps.length >= 2) {
      const n = this.taps.length - 1
      const span = this.taps[n] - this.taps[0]
      if (span > 0) {
        const bpm = 60000 / (span / n)
        if (bpm >= 30 && bpm <= 300) this.setTempo(Math.round(bpm))
      }
    }
  }

  setTranspose(st: number): void {
    this.working.transpose = Math.max(-6, Math.min(6, st))
  }

  /** Shift+Transpose Panic: all-notes-off + reset held inputs. */
  panic(): void {
    this.piano.allNotesOff()
    this.organ.allNotesOff()
    this.synth.allNotesOff()
    this.rotary.reset()
    this.panicked = true
  }

  get isPanicked(): boolean {
    return this.panicked
  }

  allNotesOff(): void {
    this.piano.allNotesOff()
    this.organ.allNotesOff()
    this.synth.allNotesOff()
  }

  setMasterLevel(level: number): void {
    this.master = Math.max(0, Math.min(1, level))
  }

  get masterLevel(): number {
    return this.master
  }

  setSustain(on: boolean): void {
    this.piano.setSustain(on)
    this.organ.setSustain(on)
    this.synth.setSustain(on)
  }

  get sustainInput(): boolean {
    return this.piano.sustainInput
  }

  get voiceCount(): number {
    return this.piano.voiceCount + this.organ.voiceCount + this.synth.voiceCount
  }

  /* --------------------------- ui subscription ------------------------ */

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshotVersion = (): number => this.version

  private emit(): void {
    this.version++
    for (const listener of this.listeners) listener()
  }

  /* --------------------------- engine state push ---------------------- */

  private applyEngines(): void {
    const p = this.morphed()
    const scene = sceneMask(p.scenes, p.scenes.active)
    // piano
    const piaA: LayerState = this.toPianoLayer(p, 0, scene)
    const piaB: LayerState = this.toPianoLayer(p, 1, scene)
    this.piano.setLayer('A', piaA)
    this.piano.setLayer('B', piaB)
    this.piano.setMasterLevel(1)
    this.ensurePianoSilence(0, piaA.enabled)
    this.ensurePianoSilence(1, piaB.enabled)
    // organ
    const org = cloneProgram(p).organ
    org.layers[0].enabled = p.organ.sectionOn && scene['organ.A'] !== false && p.organ.layers[0].enabled
    org.layers[1].enabled = p.organ.sectionOn && scene['organ.B'] !== false && p.organ.layers[1].enabled
    this.organ.setOrgan(org)
    if (!org.layers[0].enabled) this.organ.releaseLayer(0)
    if (!org.layers[1].enabled) this.organ.releaseLayer(1)
    // shared rotary target (slow/fast/stop) + drive, from program state.
    this.rotary.params.fast = org.rotarySpeed === 1
    this.rotary.params.stop = org.rotarySpeed === 2
    this.rotary.params.amount = org.rotaryDrive
    // synth
    const s = p.synth
    const synthChains: LayerChainState[] = [s.chains[0], s.chains[1], s.chains[2]]
    for (let i = 0; i < 3; i++) {
      s.layers[i].enabled = p.synth.sectionOn && scene[`synth.${'ABC'[i]}` as LayerRef] !== false && p.synth.layers[i].enabled
      if (!s.layers[i].enabled) this.synth.releaseLayer(i as 0 | 1 | 2)
    }
    this.synth.setSynth(s, synthChains)
    // clock
    this.clockRef.tempo = p.clock.tempo
    this.clockRef.sync = p.clock.sync
    this.emit()
  }

  private toPianoLayer(p: ProgramState, i: 0 | 1, scene: Record<string, boolean>): LayerState {
    const lp = p.piano.layers[i]
    const ref = i === 0 ? 'piano.A' : 'piano.B'
    const enabled = p.piano.sectionOn && scene[ref] !== false && lp.enabled
    return {
      enabled, level: lp.level, octave: lp.octave, sustped: lp.sustped, pstick: lp.pstick,
      type: lp.type, kbTouch: lp.kbTouch, dynComp: lp.dynComp, timbre: lp.timbre,
      unison: lp.unison, softRelease: lp.softRelease, stringRes: lp.stringRes,
      chain: p.piano.chains[i],
    }
  }

  private ensurePianoSilence(idx: 0 | 1, enabled: boolean): void {
    if (enabled) return
    const name = idx === 0 ? 'A' : ('B' as 'A' | 'B')
    for (const v of this.piano.activeVoiceDetails) if (v.layer === name) this.piano.noteOff(name, v.midi)
  }

  /* ------------------------------ note routing ------------------------ */

  noteOn(midi: number, velocity: number): { ref: LayerRef; midi: number }[] {
    const fired: { ref: LayerRef; midi: number }[] = []
    const p = this.morphed()
    const transposed = Math.max(1, Math.min(127, midi + p.transpose))
    const scene = sceneMask(p.scenes, p.scenes.active)
    for (const ref of ALL_LAYER_REFS) {
      if (scene[ref] === false) continue
      const enabled = this.layerEnabled(p, ref)
      if (!enabled) continue
      const zr = p.split.zones[ref] ?? (p.split.on ? { low: 0, high: 3 } : 'full')
      const gain = crossfadeGain(transposed, p.split, zr)
      if (gain <= 0.001) continue
      this.fire(ref, transposed, velocity * (0.35 + 0.65 * gain))
      fired.push({ ref, midi: transposed })
    }
    return fired
  }

  private layerEnabled(p: ProgramState, ref: LayerRef): boolean {
    const e = REF_TO_ENUM[ref]
    if (e.kind === 'piano') return p.piano.sectionOn && p.piano.layers[e.index].enabled
    if (e.kind === 'organ') return p.organ.sectionOn && p.organ.layers[e.index].enabled
    return p.synth.sectionOn && p.synth.layers[e.index].enabled
  }

  private fire(ref: LayerRef, midi: number, velocity: number): void {
    const e = REF_TO_ENUM[ref]
    if (e.kind === 'piano') { const n = e.index === 0 ? 'A' : 'B'; this.piano.noteOn(n, midi, velocity) }
    else if (e.kind === 'organ') this.organ.noteOn(e.index as 0 | 1, midi, velocity)
    else this.synth.noteOn(e.index as 0 | 1 | 2, midi, velocity)
  }

  noteOff(midi: number): void {
    const p = this.morphed()
    const transposed = Math.max(1, Math.min(127, midi + p.transpose))
    this.piano.noteOff('A', transposed)
    this.piano.noteOff('B', transposed)
    this.organ.noteOff(0, transposed)
    this.organ.noteOff(1, transposed)
    for (let i = 0 as 0 | 1 | 2; i < 3; i = (i + 1) as 0 | 1 | 2) this.synth.noteOff(i, transposed)
  }

  /* -------------------------------- render ---------------------------- */

  render(frames: number): RenderResult {
    const n = Math.floor(frames)
    const pAout = this.piano.render(n).samples
    const orgOut = this.organ.render(n).samples
    const synOut = this.synth.render(n).samples
    const out = new Float32Array(n)
    for (let i = 0; i < n; i++) out[i] = (pAout[i] + orgOut[i] + synOut[i]) * this.master
    // master limiter.
    let peak = 0
    for (let i = 0; i < n; i++) {
      const a = Math.abs(out[i])
      if (a > peak) peak = a
    }
    for (let i = 0; i < n; i++) {
      if (out[i] > 0.99) out[i] = 0.99
      else if (out[i] < -0.99) out[i] = -0.99
    }
    return { samples: out, peak }
  }

  dispose(): void {
    this.piano.dispose()
    this.organ.dispose()
    this.synth.dispose()
    this.rotary.reset()
  }
}

function sceneMask(scenes: SceneState, active: 'I' | 'II'): Record<string, boolean> {
  const mask = active === 'I' ? scenes.I : scenes.II
  const out: Record<string, boolean> = {}
  for (const ref of ALL_LAYER_REFS) out[ref] = mask[ref] !== false
  return out
}

export { defaultPianoLayer }
