/**
 * The Program system (programs spec): 32 program slots in 4 pages of 8, 8 Live slots that store every edit, Store / Store As
 * with naming, a truthful edited ("E") indicator, edit-discard on program change and a single-level undo of that discard.
 *
 * A program is exactly `ProgramData`: the whole canonical state minus the performance inputs (master level, wheel, pitch
 * stick, control pedal, solo). Slots are plain JSON, persisted through an injectable storage.
 */
import type { Scheduler } from '../audio/types'
import { defaultState, PERFORMANCE_KEYS, type EngineState, type EngineStore, type ProgramData } from './state'
import { FACTORY_PROGRAMS } from './factory'
import { NAME_CHARSET, NAME_MAX, canonical, cleanName, loadProgramData, programOf, sanitizeProgram } from './programData'

export { NAME_CHARSET, NAME_MAX, canonical, cleanName, loadProgramData, programOf, sanitizeProgram }

export const PROGRAM_COUNT = 32
export const LIVE_COUNT = 8
export const PAGE_COUNT = 4
export const BUTTONS_PER_PAGE = 8
export const PROGRAM_STORAGE_KEY = 'stagebench.nord-stage-4.programs.v1'
export const LIST_IDLE_MS = 5000
export const MESSAGE_MS = 2500
const PERSIST_DELAY_MS = 250

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export type BankMode = 'program' | 'live'
export interface ProgramSlot {
  name: string
  data: ProgramData
}

export interface StoreFlow {
  /** Store As: name first, then destination */
  as: boolean
  step: 'name' | 'dest'
  name: string
  cursor: number
  dest: { mode: BankMode; index: number }
}

export interface ProgramsSnapshot {
  mode: BankMode
  /** selected slot inside the current bank */
  index: number
  programIndex: number
  liveIndex: number
  /** page shown on the program buttons (0-based) */
  page: number
  name: string
  /** "3.2" for programs, "L3" for live slots */
  slotLabel: string
  /** the E indicator: the loaded program has unsaved edits */
  dirty: boolean
  undoAvailable: boolean
  listView: boolean
  listCursor: number
  store: StoreFlow | null
  names: string[]
  liveNames: string[]
  message: string | null
  storageOk: boolean
}

export const slotLabel = (mode: BankMode, index: number): string => (mode === 'live' ? `L${index + 1}` : `${Math.floor(index / BUTTONS_PER_PAGE) + 1}.${(index % BUTTONS_PER_PAGE) + 1}`)
export const pageOf = (index: number): number => Math.floor(index / BUTTONS_PER_PAGE)

const sanitizeSlot = (raw: unknown, fallback: ProgramSlot): ProgramSlot => {
  if (!raw || typeof raw !== 'object') return fallback
  const r = raw as { name?: unknown; data?: unknown }
  const name = typeof r.name === 'string' ? cleanName(r.name) : fallback.name
  return { name: name || fallback.name, data: sanitizeProgram(r.data) }
}

const initSlot = (label: string): ProgramSlot => ({ name: `Init ${label}`, data: programOf(defaultState()) })

// --- the system -------------------------------------------------------------------------------------------------------
export interface ProgramSystem {
  getSnapshot(): ProgramsSnapshot
  subscribe(listener: () => void): () => void
  /** the slot content (program or live) */
  slot(mode: BankMode, index: number): ProgramSlot
  select(index: number): void
  setMode(mode: BankMode): void
  /** move through the bank by dial detents (wraps) */
  step(delta: number): void
  setPage(page: number): void
  stepPage(delta: number): void
  openList(): void
  closeList(): void
  /** STORE (or STORE AS): begin, or confirm the current step of, the store flow */
  pressStore(as: boolean): void
  cancelStore(): void
  /** choose the store destination (audible for auditioning) */
  storeDestination(mode: BankMode, index: number): void
  stepDestination(delta: number): void
  toggleDestinationBank(): void
  nameChar(direction: 1 | -1): void
  nameInsert(): void
  nameDelete(): void
  nameCursor(direction: 1 | -1): void
  nameSet(text: string): void
  /** restore the edits discarded by the last program change */
  undo(): void
  /** write pending changes to storage now */
  flush(): void
  message(text: string): void
  dispose(): void
  listenerCount(): number
  pendingTimerCount(): number
}

export interface ProgramSystemDeps {
  engine: EngineStore
  storage: StorageLike | null
  scheduler: Scheduler
  factory?: ProgramSlot[]
}

export function createProgramSystem(deps: ProgramSystemDeps): ProgramSystem {
  const { engine, scheduler } = deps
  const factory = deps.factory ?? FACTORY_PROGRAMS()
  const programs: ProgramSlot[] = Array.from({ length: PROGRAM_COUNT }, (_, i) => factory[i] ?? initSlot(slotLabel('program', i)))
  const live: ProgramSlot[] = Array.from({ length: LIVE_COUNT }, (_, i) => ({ name: `Live ${i + 1}`, data: structuredClone((factory[i] ?? initSlot('')).data) }))
  const userPrograms = new Set<number>()

  let mode: BankMode = 'program'
  let programIndex = 0
  let liveIndex = 0
  let page = 0
  let dirty = false
  let baseline = ''
  let undoSlot: { mode: BankMode; index: number; data: ProgramData } | null = null
  let listView = false
  let listCursor = 0
  let store: StoreFlow | null = null
  let origin: { data: ProgramData; name: string } | null = null
  let messageText: string | null = null
  let storageOk = deps.storage !== null
  let loading = false
  let disposed = false
  let persistTimer: number | null = null
  let listTimer: number | null = null
  let messageTimer: number | null = null
  let snapshot: ProgramsSnapshot
  const listeners = new Set<() => void>()
  let previous = engine.get()

  const current = (): ProgramSlot => (mode === 'live' ? live[liveIndex] : programs[programIndex])
  const index = () => (mode === 'live' ? liveIndex : programIndex)

  const build = (): ProgramsSnapshot => ({
    mode,
    index: index(),
    programIndex,
    liveIndex,
    page,
    name: store && store.step === 'name' ? store.name : current().name,
    slotLabel: slotLabel(mode, index()),
    dirty,
    undoAvailable: undoSlot !== null,
    listView,
    listCursor,
    store,
    names: programs.map((p) => p.name),
    liveNames: live.map((p) => p.name),
    message: messageText,
    storageOk,
  })
  const emit = () => {
    if (disposed) return
    snapshot = build()
    for (const l of Array.from(listeners)) l()
  }

  // --- persistence ----------------------------------------------------------------------------------------------
  const persistNow = () => {
    if (persistTimer !== null) scheduler.clearTimeout(persistTimer)
    persistTimer = null
    if (!deps.storage) return
    try {
      const payload = {
        v: 1,
        programs: Object.fromEntries([...userPrograms].map((i) => [i, programs[i]])),
        live,
        current: { mode, programIndex, liveIndex },
      }
      deps.storage.setItem(PROGRAM_STORAGE_KEY, JSON.stringify(payload))
      if (!storageOk) {
        storageOk = true
        emit()
      }
    } catch {
      if (storageOk) {
        storageOk = false
        messageText = 'Storage is full or blocked: programs are kept for this session only'
        emit()
      }
    }
  }
  const schedulePersist = () => {
    if (!deps.storage || persistTimer !== null) return
    persistTimer = scheduler.setTimeout(persistNow, PERSIST_DELAY_MS)
  }

  const say = (text: string) => {
    messageText = text
    if (messageTimer !== null) scheduler.clearTimeout(messageTimer)
    messageTimer = scheduler.setTimeout(() => {
      messageTimer = null
      messageText = null
      emit()
    }, MESSAGE_MS)
  }

  // --- loading ----------------------------------------------------------------------------------------------------
  const apply = (data: ProgramData) => {
    loading = true
    try {
      engine.update((s) => loadProgramData(s, data))
    } finally {
      loading = false
    }
    previous = engine.get()
  }
  const loadSlot = (m: BankMode, i: number) => {
    mode = m
    if (m === 'live') liveIndex = i
    else {
      programIndex = i
      page = pageOf(i)
    }
    const slot = current()
    apply(slot.data)
    baseline = canonical(programOf(engine.get()))
    dirty = false
  }

  // --- restore ---------------------------------------------------------------------------------------------------------
  if (deps.storage) {
    try {
      const text = deps.storage.getItem(PROGRAM_STORAGE_KEY)
      if (text) {
        const raw = JSON.parse(text) as { v?: number; programs?: Record<string, unknown>; live?: unknown[]; current?: { mode?: string; programIndex?: number; liveIndex?: number } }
        if (raw && raw.v === 1) {
          for (const [k, v] of Object.entries(raw.programs ?? {})) {
            const i = Number(k)
            if (Number.isInteger(i) && i >= 0 && i < PROGRAM_COUNT) {
              programs[i] = sanitizeSlot(v, programs[i])
              userPrograms.add(i)
            }
          }
          if (Array.isArray(raw.live)) raw.live.slice(0, LIVE_COUNT).forEach((v, i) => (live[i] = sanitizeSlot(v, live[i])))
          const c = raw.current
          if (c) {
            mode = c.mode === 'live' ? 'live' : 'program'
            programIndex = Number.isInteger(c.programIndex) ? Math.min(PROGRAM_COUNT - 1, Math.max(0, c.programIndex as number)) : 0
            liveIndex = Number.isInteger(c.liveIndex) ? Math.min(LIVE_COUNT - 1, Math.max(0, c.liveIndex as number)) : 0
          }
        }
      }
    } catch {
      messageText = 'Stored programs could not be read: factory programs loaded'
    }
  }
  loadSlot(mode, index())
  listCursor = programIndex
  snapshot = build()

  // --- edit tracking ------------------------------------------------------------------------------------------------
  const programKeyChanged = (a: EngineState, b: EngineState): boolean => {
    for (const key of Object.keys(b) as Array<keyof EngineState>) {
      if ((PERFORMANCE_KEYS as readonly string[]).includes(key)) continue
      if (a[key] !== b[key]) return true
    }
    return false
  }
  const offEngine = engine.subscribe(() => {
    const next = engine.get()
    const changed = programKeyChanged(previous, next)
    previous = next
    if (loading || !changed || store?.step === 'dest') return
    if (undoSlot) {
      undoSlot = null // a new edit ends the undo of the last program change
      emit()
    }
    if (mode === 'live') {
      // Live Mode: every edit is stored automatically
      live[liveIndex] = { name: live[liveIndex].name, data: programOf(next) }
      baseline = canonical(live[liveIndex].data)
      dirty = false
      schedulePersist()
      emit()
      return
    }
    const isDirty = canonical(programOf(next)) !== baseline
    if (isDirty !== dirty) {
      dirty = isDirty
      emit()
    }
  })

  // --- list view ------------------------------------------------------------------------------------------------------
  const touchList = () => {
    if (listTimer !== null) scheduler.clearTimeout(listTimer)
    listTimer = scheduler.setTimeout(() => {
      listTimer = null
      listView = false
      emit()
    }, LIST_IDLE_MS)
  }

  const discardTo = (m: BankMode, i: number) => {
    // leaving an edited program discards its edits (manual p. 13); one level of undo keeps them
    if (dirty && mode === 'program') undoSlot = { mode, index: programIndex, data: programOf(engine.get()) }
    loadSlot(m, i)
  }

  const wrap = (i: number, n: number) => ((i % n) + n) % n

  const flowSlot = (): ProgramSlot => (store ? (store.dest.mode === 'live' ? live[store.dest.index] : programs[store.dest.index]) : current())
  const audition = () => {
    if (store && origin) apply(flowSlot().data)
  }

  const system: ProgramSystem = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    slot: (m, i) => (m === 'live' ? live[i] : programs[i]),
    select(i) {
      if (store) return system.storeDestination(store.dest.mode, i)
      const n = mode === 'live' ? LIVE_COUNT : PROGRAM_COUNT
      const target = wrap(i, n)
      if (mode === 'program' && target === programIndex && !dirty) {
        listCursor = target
        return emit()
      }
      // choosing the current slot again while edited reloads it and discards the edits
      discardTo(mode, target)
      if (mode === 'program') listCursor = target
      if (listView) touchList()
      emit()
    },
    setMode(m) {
      if (store) {
        if (store.step === 'dest' && store.dest.mode !== m) system.toggleDestinationBank()
        return
      }
      if (m === mode) return
      const previousMode = mode
      if (dirty && previousMode === 'program') undoSlot = { mode: 'program', index: programIndex, data: programOf(engine.get()) }
      loadSlot(m, m === 'live' ? liveIndex : programIndex)
      schedulePersist()
      emit()
    },
    step(delta) {
      const n = mode === 'live' ? LIVE_COUNT : PROGRAM_COUNT
      if (store && store.step === 'dest') return system.stepDestination(delta)
      if (store && store.step === 'name') return system.nameChar(delta > 0 ? 1 : -1)
      const base = listView ? listCursor : index()
      const target = wrap(base + delta, n)
      listCursor = target
      discardTo(mode, target)
      if (listView) touchList()
      schedulePersist()
      emit()
    },
    setPage(p) {
      page = wrap(p, PAGE_COUNT)
      emit()
    },
    stepPage(delta) {
      system.setPage(page + delta)
    },
    openList() {
      if (mode !== 'program') return
      listView = true
      listCursor = programIndex
      touchList()
      emit()
    },
    closeList() {
      if (!listView) return
      listView = false
      if (listTimer !== null) scheduler.clearTimeout(listTimer)
      listTimer = null
      emit()
    },
    pressStore(as) {
      if (store) {
        if (store.step === 'name') {
          store = { ...store, step: 'dest', name: store.name.trim() ? store.name : 'Untitled' }
          audition()
        } else {
          // STORE again: write
          const flow = store
          const data = origin!.data
          const slot: ProgramSlot = { name: flow.name, data: structuredClone(data) }
          if (flow.dest.mode === 'live') live[flow.dest.index] = slot
          else {
            programs[flow.dest.index] = slot
            userPrograms.add(flow.dest.index)
          }
          store = null
          origin = null
          mode = flow.dest.mode
          if (mode === 'live') liveIndex = flow.dest.index
          else {
            programIndex = flow.dest.index
            page = pageOf(programIndex)
            listCursor = programIndex
          }
          apply(slot.data)
          baseline = canonical(programOf(engine.get()))
          dirty = false
          undoSlot = null
          persistNow()
          say(`Stored ${slotLabel(mode, index())} ${slot.name}`)
        }
        return emit()
      }
      origin = { data: programOf(engine.get()), name: current().name }
      store = { as, step: as ? 'name' : 'dest', name: current().name, cursor: 0, dest: { mode, index: index() } }
      emit()
    },
    cancelStore() {
      if (!store || !origin) return
      const restore = origin.data
      store = null
      origin = null
      apply(restore)
      emit()
    },
    storeDestination(m, i) {
      if (!store || store.step !== 'dest') return
      const n = m === 'live' ? LIVE_COUNT : PROGRAM_COUNT
      store = { ...store, dest: { mode: m, index: wrap(i, n) } }
      audition()
      emit()
    },
    stepDestination(delta) {
      if (!store) return
      const n = store.dest.mode === 'live' ? LIVE_COUNT : PROGRAM_COUNT
      system.storeDestination(store.dest.mode, wrap(store.dest.index + delta, n))
    },
    toggleDestinationBank() {
      if (!store || store.step !== 'dest') return
      system.storeDestination(store.dest.mode === 'live' ? 'program' : 'live', store.dest.index % (store.dest.mode === 'live' ? PROGRAM_COUNT : LIVE_COUNT))
    },
    nameChar(direction) {
      if (!store || store.step !== 'name') return
      const chars = Array.from(store.name)
      const at = Math.min(store.cursor, NAME_MAX - 1)
      const currentChar = chars[at] ?? ' '
      const i = Math.max(0, NAME_CHARSET.indexOf(currentChar))
      const next = NAME_CHARSET[wrap(i + direction, NAME_CHARSET.length)]
      if (at >= chars.length) chars.push('A')
      else chars[at] = next
      store = { ...store, name: chars.join('').slice(0, NAME_MAX), cursor: at }
      emit()
    },
    nameInsert() {
      if (!store || store.step !== 'name' || Array.from(store.name).length >= NAME_MAX) return
      const chars = Array.from(store.name)
      chars.splice(store.cursor, 0, ' ')
      store = { ...store, name: chars.join(''), cursor: store.cursor }
      emit()
    },
    nameDelete() {
      if (!store || store.step !== 'name') return
      const chars = Array.from(store.name)
      if (chars.length === 0) return
      chars.splice(Math.min(store.cursor, chars.length - 1), 1)
      store = { ...store, name: chars.join(''), cursor: Math.max(0, Math.min(store.cursor, chars.length)) }
      emit()
    },
    nameCursor(direction) {
      if (!store || store.step !== 'name') return
      const len = Array.from(store.name).length
      store = { ...store, cursor: Math.min(Math.min(len, NAME_MAX - 1), Math.max(0, store.cursor + direction)) }
      emit()
    },
    nameSet(text) {
      if (!store || store.step !== 'name') return
      const name = cleanName(text)
      store = { ...store, name, cursor: Math.min(name.length, NAME_MAX - 1) }
      emit()
    },
    undo() {
      if (!undoSlot) return
      const u = undoSlot
      undoSlot = null
      mode = u.mode
      if (u.mode === 'program') {
        programIndex = u.index
        page = pageOf(u.index)
        listCursor = u.index
      } else liveIndex = u.index
      baseline = canonical(current().data)
      apply(u.data)
      dirty = canonical(programOf(engine.get())) !== baseline
      say('Undo: edits restored')
      emit()
    },
    flush: persistNow,
    message(text) {
      say(text)
      emit()
    },
    dispose() {
      if (disposed) return
      offEngine()
      if (persistTimer !== null) persistNow()
      for (const t of [persistTimer, listTimer, messageTimer]) if (t !== null) scheduler.clearTimeout(t)
      persistTimer = listTimer = messageTimer = null
      disposed = true
      listeners.clear()
    },
    listenerCount: () => listeners.size,
    pendingTimerCount: () => [persistTimer, listTimer, messageTimer].filter((t) => t !== null).length,
  }
  return system
}
