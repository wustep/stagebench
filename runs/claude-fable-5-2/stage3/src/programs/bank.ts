import type { StorageBoundary } from '../platform/types'
import {
  LIVE_COUNT,
  PROGRAM_COUNT,
  conformProgram,
  programSignature,
  type ProgramData,
  type SlotRef,
} from '../state/model'
import { factoryLive, factoryPrograms } from './factory'

export const PROGRAM_STORAGE_KEY = 'stage4.programs.v1'

interface Stored {
  version: 1
  /** Slots the user has stored to, by slot number. Untouched slots keep their factory content. */
  programs: Record<string, ProgramData>
  live: Record<string, ProgramData>
}

/**
 * The program memory: one bank of 32 programs and the 8 Live slots.
 *
 * Every slot starts with its factory content. A slot that has been stored to is kept in the
 * storage boundary (localStorage in the browser, nothing at all when none is given), so stored
 * programs and Live edits survive a reload. Everything read back is run through
 * `conformProgram`, so a damaged or out-of-date entry can never put the instrument in a state
 * it cannot show.
 */
export class ProgramBank {
  private readonly storage: StorageBoundary | null
  private readonly programs: ProgramData[]
  private readonly live: ProgramData[]
  private readonly stored: Stored = { version: 1, programs: {}, live: {} }

  constructor(storage: StorageBoundary | null = null) {
    this.storage = storage
    this.programs = factoryPrograms()
    this.live = factoryLive()
    this.restore()
  }

  private restore(): void {
    if (!this.storage) return
    let parsed: unknown
    try {
      const text = this.storage.getItem(PROGRAM_STORAGE_KEY)
      if (!text) return
      parsed = JSON.parse(text)
    } catch {
      return
    }
    if (!parsed || typeof parsed !== 'object') return
    const { programs, live } = parsed as Partial<Stored>
    this.adopt(programs, this.programs, this.stored.programs, PROGRAM_COUNT)
    this.adopt(live, this.live, this.stored.live, LIVE_COUNT)
  }

  private adopt(source: unknown, into: ProgramData[], record: Record<string, ProgramData>, count: number): void {
    if (!source || typeof source !== 'object') return
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      const slot = Number(key)
      if (!Number.isInteger(slot) || slot < 0 || slot >= count || !value || typeof value !== 'object') continue
      into[slot] = conformProgram(value)
      record[key] = into[slot]
    }
  }

  private slots(ref: SlotRef): ProgramData[] {
    return ref.live ? this.live : this.programs
  }

  private index(ref: SlotRef): number {
    const count = ref.live ? LIVE_COUNT : PROGRAM_COUNT
    return Math.min(count - 1, Math.max(0, Math.round(ref.slot)))
  }

  /** A private copy of the program stored in a slot. */
  get(ref: SlotRef): ProgramData {
    return structuredClone(this.slots(ref)[this.index(ref)])
  }

  name(ref: SlotRef): string {
    return this.slots(ref)[this.index(ref)].name
  }

  signature(ref: SlotRef): string {
    return programSignature(this.slots(ref)[this.index(ref)])
  }

  /** Overwrite a slot and persist it. */
  store(ref: SlotRef, program: ProgramData): void {
    const index = this.index(ref)
    const copy = conformProgram(program)
    this.slots(ref)[index] = copy
    ;(ref.live ? this.stored.live : this.stored.programs)[String(index)] = copy
    this.storage?.setItem(PROGRAM_STORAGE_KEY, JSON.stringify(this.stored))
  }

  /** True when the slot has been stored to since the factory state. */
  isUserStored(ref: SlotRef): boolean {
    return String(this.index(ref)) in (ref.live ? this.stored.live : this.stored.programs)
  }

  /** Names of all 32 programs, in slot order. */
  names(): string[] {
    return this.programs.map((program) => program.name)
  }

  liveNames(): string[] {
    return this.live.map((program) => program.name)
  }
}
