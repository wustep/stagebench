/**
 * Program bank persistence through the injectable storage boundary (browser: localStorage; tests: an in-memory map).
 * Live programs auto-store every edit (manual p. 13, 44), so the bank is written back debounced; regular slots are
 * written on Store. Corrupt or missing data falls back to the factory bank, program by program.
 */
import { parseProgram, type ProgramState } from './programState'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

export const BANK_STORAGE_KEY = 'stagebench.nord-stage-4-73.bank.v1'
export const BANK_SAVE_DEBOUNCE_MS = 250

export interface BankData {
  programs: ProgramState[]
  live: ProgramState[]
}

interface StoredBank {
  version: 1
  programs: unknown[]
  live: unknown[]
}

export function loadBank(storage: StorageLike | null | undefined, factory: BankData): BankData | null {
  if (!storage) return null
  let raw: string | null
  try {
    raw = storage.getItem(BANK_STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StoredBank>
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.programs) || !Array.isArray(parsed.live)) return null
    const programs = factory.programs.map((fallback, i) => (i < parsed.programs!.length ? (parseProgram(parsed.programs![i] as object, fallback) ?? fallback) : fallback))
    const live = factory.live.map((fallback, i) => (i < parsed.live!.length ? (parseProgram(parsed.live![i] as object, fallback) ?? fallback) : fallback))
    return { programs, live }
  } catch {
    return null
  }
}

export function saveBank(storage: StorageLike | null | undefined, bank: BankData): boolean {
  if (!storage) return false
  try {
    const data: StoredBank = { version: 1, programs: bank.programs, live: bank.live }
    storage.setItem(BANK_STORAGE_KEY, JSON.stringify(data))
    return true
  } catch {
    return false
  }
}

/** An in-memory StorageLike (tests, and the browser fallback when localStorage is unavailable). */
export function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v)
    },
    removeItem: (k) => {
      data.delete(k)
    },
  }
}
