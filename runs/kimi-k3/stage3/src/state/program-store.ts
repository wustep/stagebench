/**
 * Program storage + navigation lifecycle (Phase 3, programs spec).
 *
 * 32 slots in 4 pages of 8 plus 8 auto-storing Live slots. Storage is
 * injectable (`StorageLike`) so tests run without a browser; the app passes
 * localStorage. The store owns the slot contents; the engine owns the live
 * (current) state and the dirty lifecycle.
 */

import { cloneProgramState, defaultProgramState, type ProgramState, type StoredProgram } from './program-state'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const PROGRAM_SLOTS = 32
export const PROGRAM_PAGES = 4
export const SLOTS_PER_PAGE = 8
export const LIVE_SLOTS = 8
export const MAX_NAME_LENGTH = 12

const STORAGE_KEY = 'nord-stage-4.programs.v1'

function emptySlot(): StoredProgram {
  return { name: 'Init', state: defaultProgramState() }
}

/** Factory content: at least 8 programs demonstrating piano, organ, synth, split, and layered setups. */
export function factoryPrograms(): StoredProgram[] {
  const mk = (name: string, mutate: (s: ProgramState) => void): StoredProgram => {
    const state = defaultProgramState()
    mutate(state)
    return { name, state }
  }
  return [
    mk('Grand Piano', () => {}),
    mk('Tine Stack', (s) => {
      s.piano.layers.pianoA.type = 'electric'
      s.piano.layers.pianoB.enabled = true
      s.piano.layers.pianoB.type = 'clav'
      s.effects.chains.pianoA.mod1.on = true
      s.effects.chains.pianoA.mod1.type = 1
      s.effects.chains.pianoA.mod1.amount = 70
    }),
    mk('B3 Jazz', (s) => {
      s.piano.sectionOn = false
      s.piano.layers.pianoA.enabled = false
      s.piano.layers.pianoB.enabled = false
      s.organ.sectionOn = true
      s.organ.layers.A.drawbars = [8, 8, 8, 0, 0, 0, 0, 0, 0]
      s.organ.layers.A.percussion.on = true
      s.effects.rotary.on = true
      s.effects.rotary.organRouted = true
      s.effects.rotary.speed = 0
    }),
    mk('Full Drawbar B3', (s) => {
      s.piano.sectionOn = false
      s.piano.layers.pianoA.enabled = false
      s.piano.layers.pianoB.enabled = false
      s.organ.sectionOn = true
      s.organ.layers.A.drawbars = [8, 8, 8, 8, 6, 8, 6, 8, 8]
      s.organ.layers.A.vibratoOn = true
      s.organ.layers.A.vibratoMode = 5 // C3
      s.effects.rotary.on = true
      s.effects.rotary.organRouted = true
      s.effects.rotary.speed = 2
    }),
    mk('Vox Continental', (s) => {
      s.piano.sectionOn = false
      s.piano.layers.pianoA.enabled = false
      s.piano.layers.pianoB.enabled = false
      s.organ.sectionOn = true
      s.organ.layers.A.model = 2 // Vox
      s.organ.layers.A.drawbars = [8, 6, 8, 5, 0, 8, 0, 0, 8]
    }),
    mk('Pipe Cathedral', (s) => {
      s.piano.sectionOn = false
      s.piano.layers.pianoA.enabled = false
      s.piano.layers.pianoB.enabled = false
      s.organ.sectionOn = true
      s.organ.layers.A.model = 4 // Pipe 1
      s.organ.layers.A.drawbars = [8, 4, 8, 6, 4, 8, 2, 4, 2]
      s.effects.chains.organ.reverb.on = true
      s.effects.chains.organ.reverb.type = 5
      s.effects.chains.organ.reverb.amount = 90
    }),
    mk('Analog Brass', (s) => {
      s.piano.sectionOn = false
      s.piano.layers.pianoA.enabled = false
      s.piano.layers.pianoB.enabled = false
      s.synth.sectionOn = true
      s.synth.layers.A.oscWave = 11 // Super Saw
      s.synth.layers.A.oscCtrl = 70
      s.synth.layers.A.filterFreq = 82
      s.synth.layers.A.ampEnv.attack = 22
      s.synth.layers.A.ampEnv.release = 60
    }),
    mk('FM Lead', (s) => {
      s.piano.sectionOn = false
      s.piano.layers.pianoA.enabled = false
      s.piano.layers.pianoB.enabled = false
      s.synth.sectionOn = true
      s.synth.layers.A.oscWave = 13 // FM 2-op A
      s.synth.layers.A.oscCtrl = 90
      s.synth.layers.A.voiceMode = 1 // Mono
      s.synth.layers.A.glide = 40
    }),
    mk('Split Bass/Piano', (s) => {
      s.split.on = true
      s.split.points.Mid.enabled = true
      s.split.points.Mid.position = 3 // F3
      // Zone 0 (below F3): organ bass; zones 1+: piano.
      s.split.zones.organA = { lo: 0, hi: 0 }
      s.split.zones.pianoA = { lo: 1, hi: 1 }
      s.split.zones.pianoB = { lo: 1, hi: 1 }
      s.split.zones.organB = { lo: 0, hi: 0 }
      s.split.zones.synthA = { lo: 1, hi: 1 }
      s.split.zones.synthB = { lo: 0, hi: 0 }
      s.split.zones.synthC = { lo: 0, hi: 0 }
      s.organ.sectionOn = true
      s.organ.layers.A.model = 1 // B3 Bass
      s.organ.layers.A.drawbars = [8, 0, 8, 0, 0, 0, 0, 0, 0]
    }),
    mk('Arp Pad', (s) => {
      s.piano.sectionOn = false
      s.piano.layers.pianoA.enabled = false
      s.piano.layers.pianoB.enabled = false
      s.synth.sectionOn = true
      s.synth.layers.A.oscWave = 9 // Multi Saw
      s.synth.layers.A.arpRun = true
      s.synth.layers.A.arpSync = true
      s.synth.layers.A.arpRate = 5 // 1/16
      s.synth.layers.A.arpRange = 2
      s.synth.layers.A.filterFreq = 96
      s.clock.bpm = 100
    }),
  ]
}

/**
 * The program bank. Slot indexes are 0..31 (page*8 + button). Live slots are
 * kept in a parallel array of 8. Both persist through the storage seam.
 * Loading new contents from storage is explicit (`reloadFromStorage`), never
 * implicit on writes.
 */
export class ProgramBank {
  private slots: StoredProgram[]
  private live: StoredProgram[]
  private storage: StorageLike | null
  /** Test hook: read the raw persisted payload (proves what was written). */
  debugRawStorage(): string | null {
    return this.storage?.getItem(STORAGE_KEY) ?? null
  }

  constructor(storage: StorageLike | null = null) {
    this.storage = storage
    const factory = factoryPrograms()
    this.slots = Array.from({ length: PROGRAM_SLOTS }, (_, i) => (i < factory.length ? factory[i] : emptySlot()))
    this.live = Array.from({ length: LIVE_SLOTS }, () => emptySlot())
    this.reloadFromStorage()
  }

  get(index: number): StoredProgram {
    return this.slots[index]
  }

  getLive(index: number): StoredProgram {
    return this.live[index]
  }

  set(index: number, name: string, state: ProgramState): void {
    this.slots[index] = { name: name.slice(0, MAX_NAME_LENGTH) || 'Init', state: cloneProgramState(state) }
    this.persist()
  }

  setLive(index: number, name: string, state: ProgramState): void {
    this.live[index] = { name: name.slice(0, MAX_NAME_LENGTH) || `Live ${index + 1}`, state: cloneProgramState(state) }
    this.persist()
  }

  /** Restore the factory bank (drops user programs; used by tests). */
  resetToFactory(): void {
    const factory = factoryPrograms()
    this.slots = Array.from({ length: PROGRAM_SLOTS }, (_, i) => (i < factory.length ? factory[i] : emptySlot()))
    this.live = Array.from({ length: LIVE_SLOTS }, () => emptySlot())
    this.persist()
  }

  /** Persist everything through the storage seam (never throws). */
  private persist(): void {
    if (!this.storage) return
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify({ slots: this.slots, live: this.live }))
    } catch {
      // Storage full/unavailable: programs stay in memory; nothing pretends.
    }
  }

  /** Pull persisted contents (constructor + explicit reload; never on writes). */
  reloadFromStorage(): void {
    if (!this.storage) return
    try {
      const raw = this.storage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as { slots?: StoredProgram[]; live?: StoredProgram[] }
      if (Array.isArray(parsed.slots) && parsed.slots.length === PROGRAM_SLOTS) this.slots = parsed.slots
      if (Array.isArray(parsed.live) && parsed.live.length === LIVE_SLOTS) this.live = parsed.live
    } catch {
      // Corrupt storage: fall back to factory content.
    }
  }
}
