// Program storage (programs spec storage): one bank of 32 programs (4 pages × 8 buttons) and 8
// Live slots. A program is the canonical SoundState minus Master Level and the pitch stick.
// Storage is injectable (localStorage in the browser, a Map in tests); anything read back is
// normalised against the current schema so a stale or corrupt entry can never break the engine.
import { MORPH_DESTS } from './morph'
import { defaultSound, type SoundState } from './sound'
import { factoryPrograms } from './factory'

export const PROGRAM_SLOTS = 32
export const PAGES = 4
export const PER_PAGE = 8
export const LIVE_SLOTS = 8
export const NAME_LENGTH = 16

export interface ProgramRecord {
  name: string
  sound: SoundState
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const STORAGE_KEYS = { programs: 'stagebench.ns4.v3.programs', live: 'stagebench.ns4.v3.live' } as const

/** "3.2" style location of a bank index (page.button, both 1-based). */
export const programLocation = (index: number) => `${Math.floor(index / PER_PAGE) + 1}.${(index % PER_PAGE) + 1}`

/** The part of the state a program stores (Master Level and pitch stick are performance state). */
export function programPart(s: SoundState): Omit<SoundState, 'master' | 'pitchStick'> {
  const { master: _m, pitchStick: _p, ...rest } = s
  void _m
  void _p
  return rest
}

/** Load a stored sound, keeping the performance state of the current one. */
export function withPerformance(stored: SoundState, current: SoundState): SoundState {
  return { ...stored, master: current.master, pitchStick: current.pitchStick }
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  for (const k of ka) if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
  return true
}

/** True when `s` differs from the stored program in any stored field (the E indicator). */
export function isEdited(s: SoundState, stored: SoundState): boolean {
  return !deepEqual(programPart(s), programPart(stored))
}

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Merge `raw` onto `template`, keeping only values whose type matches the template. */
function merge(template: unknown, raw: unknown, path: string): unknown {
  if (raw === undefined) return template
  if (path.endsWith('morph.wheel') || path.endsWith('morph.pedal')) {
    const out: Record<string, number> = {}
    if (isPlain(raw)) for (const [k, v] of Object.entries(raw)) if (MORPH_DESTS.has(k) && typeof v === 'number' && Number.isFinite(v)) out[k] = v
    return out
  }
  if (Array.isArray(template)) {
    if (!Array.isArray(raw) || raw.length !== template.length) return template
    return template.map((t, i) => merge(t, raw[i], `${path}[]`))
  }
  if (isPlain(template)) {
    if (!isPlain(raw)) return template
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(template)) out[k] = merge(template[k], raw[k], `${path}.${k}`)
    return out
  }
  if (template === null) return raw === null || typeof raw === 'number' ? raw : template
  if (typeof template === 'number') return typeof raw === 'number' && Number.isFinite(raw) ? raw : template
  if (typeof template === typeof raw) {
    // Enumerated strings keep the template when unknown to the engine; callers validate enums.
    return raw
  }
  // Split point positions may be null or a number.
  if (typeof raw === 'number' && path.endsWith('.pos')) return raw
  return template
}

/** A schema-valid SoundState from anything read back from storage. */
export function normalizeSound(raw: unknown): SoundState {
  const merged = merge(defaultSound(), raw, '') as SoundState
  return { ...merged, version: 3 }
}

export function normalizeRecord(raw: unknown, fallback: ProgramRecord): ProgramRecord {
  if (!isPlain(raw)) return fallback
  const name = typeof raw.name === 'string' ? raw.name.slice(0, NAME_LENGTH) : fallback.name
  return { name, sound: normalizeSound(raw.sound) }
}

function initialPrograms(): ProgramRecord[] {
  const factory = factoryPrograms()
  return Array.from({ length: PROGRAM_SLOTS }, (_, i) => factory[i] ?? { name: 'Init Program', sound: defaultSound() })
}

function initialLive(): ProgramRecord[] {
  const factory = factoryPrograms()
  return Array.from({ length: LIVE_SLOTS }, (_, i) => ({ name: factory[i]?.name ?? 'Init Program', sound: factory[i]?.sound ?? defaultSound() }))
}

/** The 32 programs and 8 Live slots, persisted through injectable storage. */
export class ProgramBank {
  programs: ProgramRecord[]
  live: ProgramRecord[]
  private readonly listeners = new Set<() => void>()

  constructor(private readonly storage: StorageLike | null) {
    this.programs = initialPrograms()
    this.live = initialLive()
    if (storage) {
      this.programs = this.read(STORAGE_KEYS.programs, this.programs)
      this.live = this.read(STORAGE_KEYS.live, this.live)
    }
  }

  private read(key: string, fallback: ProgramRecord[]): ProgramRecord[] {
    try {
      const text = this.storage?.getItem(key)
      if (!text) return fallback
      const raw = JSON.parse(text) as unknown
      if (!Array.isArray(raw)) return fallback
      return fallback.map((f, i) => normalizeRecord(raw[i], f))
    } catch {
      return fallback
    }
  }

  private write(key: string, list: ProgramRecord[]): void {
    try {
      this.storage?.setItem(key, JSON.stringify(list.map((r) => ({ name: r.name, sound: programPart(r.sound) }))))
    } catch {
      // Storage full or unavailable: the bank keeps working in memory.
    }
    this.listeners.forEach((l) => l())
  }

  get(live: boolean, index: number): ProgramRecord {
    return (live ? this.live : this.programs)[index]
  }

  store(live: boolean, index: number, record: ProgramRecord): void {
    const list = live ? this.live : this.programs
    list[index] = { name: record.name.slice(0, NAME_LENGTH), sound: record.sound }
    this.write(live ? STORAGE_KEYS.live : STORAGE_KEYS.programs, list)
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

/** In-memory storage (tests, and browsers where localStorage is blocked). */
export class MemoryStorage implements StorageLike {
  readonly map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
}
