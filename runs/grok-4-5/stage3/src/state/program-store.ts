/** Program store: 32 slots, Live, dirty, store/store-as, navigation */

import {
  cloneProgramSound,
  defaultProgramSystem,
  type MorphAssignment,
  type MorphSource,
  type ProgramSlot,
  type ProgramSoundState,
  type ProgramSystemState,
  type SceneId,
} from '../model/program-types'

type Listener = () => void

export class ProgramStore {
  private state: ProgramSystemState = defaultProgramSystem()
  private listeners = new Set<Listener>()
  private working: ProgramSoundState
  private baseline: ProgramSoundState

  constructor() {
    this.working = cloneProgramSound(this.state.slots[0]!.state)
    this.baseline = cloneProgramSound(this.working)
  }

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  getState(): ProgramSystemState {
    return this.state
  }

  getWorking(): ProgramSoundState {
    return this.working
  }

  isDirty(): boolean {
    return this.state.dirty
  }

  private markDirty() {
    if (this.state.liveMode) {
      // auto-store live
      this.state.liveSlots[this.state.currentLive] = {
        name: this.state.liveSlots[this.state.currentLive]!.name,
        state: cloneProgramSound(this.working),
      }
      this.state.dirty = false
    } else {
      this.state.dirty = true
    }
    this.emit()
  }

  /** Replace working sound (from external engine sync) */
  setWorking(partial: Partial<ProgramSoundState>, markDirty = true): void {
    this.working = {
      ...this.working,
      ...partial,
      piano: partial.piano ? { ...this.working.piano, ...partial.piano } : this.working.piano,
      organ: partial.organ ? { ...this.working.organ, ...partial.organ } : this.working.organ,
      synth: partial.synth ? { ...this.working.synth, ...partial.synth } : this.working.synth,
      effects: partial.effects ? { ...this.working.effects, ...partial.effects } : this.working.effects,
      split: partial.split ? { ...this.working.split, ...partial.split } : this.working.split,
      scenes: partial.scenes ? { ...this.working.scenes, ...partial.scenes } : this.working.scenes,
      morph: partial.morph ? { ...this.working.morph, ...partial.morph } : this.working.morph,
    }
    if (markDirty) this.markDirty()
    else this.emit()
  }

  replaceWorking(state: ProgramSoundState, markDirty = false): void {
    this.working = cloneProgramSound(state)
    if (markDirty) this.markDirty()
    else {
      this.baseline = cloneProgramSound(state)
      this.state.dirty = false
      this.emit()
    }
  }

  private loadSlot(slot: ProgramSlot) {
    this.working = cloneProgramSound(slot.state)
    this.baseline = cloneProgramSound(slot.state)
    this.state.dirty = false
    this.state.storeMode = 'off'
    this.emit()
  }

  selectProgram(index: number): void {
    if (index < 0 || index >= 32) return
    // discard edits on change
    this.state.currentSlot = index
    this.state.page = Math.floor(index / 8)
    this.state.liveMode = false
    this.loadSlot(this.state.slots[index]!)
  }

  selectLive(index: number): void {
    if (index < 0 || index >= 8) return
    this.state.liveMode = true
    this.state.currentLive = index
    this.loadSlot(this.state.liveSlots[index]!)
  }

  setLiveMode(on: boolean): void {
    if (on) {
      this.state.liveMode = true
      this.loadSlot(this.state.liveSlots[this.state.currentLive]!)
    } else {
      this.state.liveMode = false
      this.loadSlot(this.state.slots[this.state.currentSlot]!)
    }
  }

  pageUp(): void {
    this.state.page = Math.min(3, this.state.page + 1)
    if (!this.state.liveMode) {
      const idx = this.state.page * 8 + (this.state.currentSlot % 8)
      this.selectProgram(idx)
    }
    this.emit()
  }

  pageDown(): void {
    this.state.page = Math.max(0, this.state.page - 1)
    if (!this.state.liveMode) {
      const idx = this.state.page * 8 + (this.state.currentSlot % 8)
      this.selectProgram(idx)
    }
    this.emit()
  }

  dialBrowse(delta: number): void {
    if (this.state.liveMode) {
      const next = Math.max(0, Math.min(7, this.state.currentLive + delta))
      this.selectLive(next)
    } else {
      const next = Math.max(0, Math.min(31, this.state.currentSlot + delta))
      this.selectProgram(next)
    }
  }

  setListView(on: boolean): void {
    this.state.listView = on
    this.emit()
  }

  /** Store flow: first press enters store mode; second confirms */
  storePress(): void {
    if (this.state.storeMode === 'off') {
      this.state.storeMode = 'store'
      this.state.storeDest = this.state.liveMode ? this.state.currentLive : this.state.currentSlot
      this.emit()
      return
    }
    if (this.state.storeMode === 'store' || this.state.storeMode === 'storeAs') {
      this.confirmStore()
    }
  }

  storeAsPress(): void {
    this.state.storeMode = 'naming'
    this.state.storeName = this.currentName()
    this.state.storeDest = this.state.liveMode ? this.state.currentLive : this.state.currentSlot
    this.emit()
  }

  setStoreName(name: string): void {
    this.state.storeName = name.slice(0, 24)
    if (this.state.storeMode === 'naming') {
      this.state.storeMode = 'storeAs'
    }
    this.emit()
  }

  setStoreDest(index: number): void {
    this.state.storeDest = Math.max(0, Math.min(this.state.liveMode ? 7 : 31, index))
    this.emit()
  }

  confirmStore(): void {
    const name =
      this.state.storeMode === 'storeAs' || this.state.storeName
        ? this.state.storeName || this.currentName()
        : this.currentName()
    const slot: ProgramSlot = { name, state: cloneProgramSound(this.working) }
    if (this.state.liveMode) {
      this.state.liveSlots[this.state.storeDest] = slot
      this.state.currentLive = this.state.storeDest
    } else {
      this.state.slots[this.state.storeDest] = slot
      this.state.currentSlot = this.state.storeDest
      this.state.page = Math.floor(this.state.storeDest / 8)
    }
    this.baseline = cloneProgramSound(this.working)
    this.state.dirty = false
    this.state.storeMode = 'off'
    this.emit()
  }

  cancelStore(): void {
    this.state.storeMode = 'off'
    this.emit()
  }

  currentName(): string {
    if (this.state.liveMode) return this.state.liveSlots[this.state.currentLive]!.name
    return this.state.slots[this.state.currentSlot]!.name
  }

  displayLabel(): string {
    const dirty = this.state.dirty ? ' E' : ''
    if (this.state.storeMode === 'store') return `STORE → ${this.state.storeDest + 1}`
    if (this.state.storeMode === 'storeAs' || this.state.storeMode === 'naming')
      return `STORE AS: ${this.state.storeName || '...'}`
    if (this.state.listView) {
      return this.state.slots.map((s, i) => `${i + 1}:${s.name}`).join(' | ').slice(0, 80)
    }
    if (this.state.liveMode) {
      return `Live ${this.state.currentLive + 1} ${this.currentName()}${dirty}`
    }
    const page = Math.floor(this.state.currentSlot / 8) + 1
    const btn = (this.state.currentSlot % 8) + 1
    return `${page}.${btn} ${this.currentName()}${dirty}`
  }

  setScene(scene: SceneId): void {
    this.working.scenes.active = scene
    const en = this.working.scenes[scene]
    this.working.piano.layers.A.enabled = en.pianoA
    this.working.piano.layers.B.enabled = en.pianoB
    this.working.organ.layers.A.enabled = en.organA
    this.working.organ.layers.B.enabled = en.organB
    this.working.synth.layers.A.enabled = en.synthA
    this.working.synth.layers.B.enabled = en.synthB
    this.working.synth.layers.C.enabled = en.synthC
    this.markDirty()
  }

  captureSceneEnables(): void {
    const scene = this.working.scenes.active
    this.working.scenes[scene] = {
      pianoA: this.working.piano.layers.A.enabled,
      pianoB: this.working.piano.layers.B.enabled,
      organA: this.working.organ.layers.A.enabled,
      organB: this.working.organ.layers.B.enabled,
      synthA: this.working.synth.layers.A.enabled,
      synthB: this.working.synth.layers.B.enabled,
      synthC: this.working.synth.layers.C.enabled,
    }
  }

  setSplitOn(on: boolean): void {
    this.working.split.on = on
    if (on && !this.working.split.points.Mid.enabled) {
      this.working.split.points.Mid = { enabled: true, note: 'C4', crossfade: 0 }
    }
    this.markDirty()
  }

  setSplitPoint(
    id: 'Low' | 'Mid' | 'High',
    partial: Partial<ProgramSoundState['split']['points']['Mid']>,
  ): void {
    this.working.split.points[id] = { ...this.working.split.points[id], ...partial }
    this.markDirty()
  }

  setMasterClock(bpm: number): void {
    this.working.masterClockBpm = Math.max(30, Math.min(300, bpm))
    this.markDirty()
  }

  tapTempo(timeMs: number, taps: number[]): number {
    taps.push(timeMs)
    while (taps.length > 6) taps.shift()
    if (taps.length < 4) return this.working.masterClockBpm
    const intervals: number[] = []
    for (let i = 1; i < taps.length; i++) intervals.push(taps[i]! - taps[i - 1]!)
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length
    const bpm = Math.round(60000 / avg)
    this.setMasterClock(bpm)
    return this.working.masterClockBpm
  }

  setTranspose(semitones: number): void {
    this.working.transpose = Math.max(-6, Math.min(6, semitones))
    this.markDirty()
  }

  setWheel(v: number): void {
    this.state.wheel = Math.max(0, Math.min(1, v))
    this.emit()
  }

  setControlPedal(v: number): void {
    this.state.controlPedal = Math.max(0, Math.min(1, v))
    this.emit()
  }

  beginMorphAssign(source: MorphSource, latch = false): void {
    this.state.morphAssignSource = source
    this.state.morphLatch = latch
    this.emit()
  }

  endMorphAssign(): void {
    this.state.morphAssignSource = null
    this.state.morphLatch = false
    this.emit()
  }

  assignMorph(controlPath: string, start: number, end: number): void {
    const src = this.state.morphAssignSource
    if (!src) return
    const list = src === 'Wheel' ? this.working.morph.wheel : this.working.morph.controlPedal
    const existing = list.findIndex((a) => a.controlPath === controlPath)
    const entry: MorphAssignment = { controlPath, start, end }
    if (existing >= 0) list[existing] = entry
    else list.push(entry)
    // remove if zero range
    if (Math.abs(end - start) < 0.001) {
      const i = list.findIndex((a) => a.controlPath === controlPath)
      if (i >= 0) list.splice(i, 1)
    }
    this.markDirty()
  }

  clearMorph(source: MorphSource): void {
    if (source === 'Wheel') this.working.morph.wheel = []
    else this.working.morph.controlPedal = []
    this.markDirty()
  }

  setShift(on: boolean): void {
    this.state.shift = on
    this.emit()
  }

  /** Serialize all 32 + 8 for roundtrip tests */
  exportAll(): { slots: ProgramSlot[]; liveSlots: ProgramSlot[] } {
    return {
      slots: this.state.slots.map((s) => ({ name: s.name, state: cloneProgramSound(s.state) })),
      liveSlots: this.state.liveSlots.map((s) => ({ name: s.name, state: cloneProgramSound(s.state) })),
    }
  }

  importSlot(index: number, slot: ProgramSlot): void {
    this.state.slots[index] = { name: slot.name, state: cloneProgramSound(slot.state) }
    this.emit()
  }

  getSlot(index: number): ProgramSlot {
    return {
      name: this.state.slots[index]!.name,
      state: cloneProgramSound(this.state.slots[index]!.state),
    }
  }

  getLiveSlot(index: number): ProgramSlot {
    return {
      name: this.state.liveSlots[index]!.name,
      state: cloneProgramSound(this.state.liveSlots[index]!.state),
    }
  }
}

export const programStore = new ProgramStore()
