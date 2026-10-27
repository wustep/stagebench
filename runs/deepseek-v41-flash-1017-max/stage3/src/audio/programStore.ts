/**
 * The Program section: 32 slots, 8 Live slots, factory content, and the dirty lifecycle.
 *
 * One bank of 32 programs in 4 pages of 8, exactly as `specs/nord-stage-4.programs.json`
 * reduces the hardware's 512. Everything here is plain state plus pure functions, so the
 * whole program system can be exercised without React, audio, or a browser.
 *
 * ## Why the live state is read, not copied
 *
 * The system does **not** keep a second copy of "what the instrument currently is". It is
 * handed `read` (read the live program state out of the instrument's own stores) and
 * `write` (load a program state back into those stores). That is the only way the dirty
 * indicator can be truthful:
 *
 *  - `read()` and `stored` are compared field by field; `dirty` is that comparison.
 *  - A program change writes the slot's state through `write()`, so nothing is left over.
 *  - Store commits `read()` into the slot, so `dirty` becomes false for the right reason.
 *
 * Selecting another program while dirty discards the edits, because that is what the
 * manual's "selecting another program without storing discards the edits" means. The
 * single-level undo the spec allows as optional keeps the discarded state, and nothing
 * claims undo beyond that one step.
 */
import {
  ALL_LAYER_IDS,
  cloneProgramState,
  defaultProgramState,
  defaultScenes,
  programStatesEqual,
  type ProgramState,
  type StoredProgram,
} from './programState'
import type { LayerId } from './types'
import { B3_DEFAULT_DRAWBARS } from './organState'

/** Slots per page and pages, from the spec's 4 × 8 layout. */
export const PROGRAM_PAGES = 4
export const SLOTS_PER_PAGE = 8
export const PROGRAM_SLOTS = PROGRAM_PAGES * SLOTS_PER_PAGE
/** Live slots: the eight program buttons switch to these in Live Mode. */
export const LIVE_SLOTS = 8

/** The page.button label the display prints, e.g. "3.2". */
export function slotLabel(slot: number): string {
  const page = Math.floor((slot - 1) / SLOTS_PER_PAGE) + 1
  const button = ((slot - 1) % SLOTS_PER_PAGE) + 1
  return `${page}.${button}`
}

export function pageForSlot(slot: number): number {
  return Math.floor((slot - 1) / SLOTS_PER_PAGE) + 1
}

export function buttonForSlot(slot: number): number {
  return ((slot - 1) % SLOTS_PER_PAGE) + 1
}

export function slotFor(page: number, button: number): number {
  return (page - 1) * SLOTS_PER_PAGE + button
}

export function clampSlot(slot: number): number {
  if (!Number.isFinite(slot)) return 1
  return Math.min(PROGRAM_SLOTS, Math.max(1, Math.round(slot)))
}

/* ------------------------------------------------------------------ */
/* Factory content                                                    */
/* ------------------------------------------------------------------ */

interface FactorySpec {
  slot: number
  name: string
  /** Applies the sound design to a fully silent default, so only this decides what sounds. */
  build: (state: ProgramState) => void
}

/** Silences every section and layer, so a factory design starts from nothing. */
function silenceAll(state: ProgramState): void {
  state.piano.sectionOn = false
  state.organ.sectionOn = false
  state.synth.sectionOn = false
  for (const layer of ALL_LAYER_IDS) {
    if (layer.startsWith('piano')) state.piano.layers[layer as 'piano.a'].enabled = false
    else if (layer.startsWith('organ')) state.organ.layers[layer as 'organ.a'].enabled = false
    else state.synth.layers[layer as 'synth.a'].enabled = false
  }
}

/** Writes the current enable state into both scenes, so a fresh program has sane scenes. */
function syncScenes(state: ProgramState): void {
  const enabled = {} as Record<LayerId, boolean>
  for (const layer of ALL_LAYER_IDS) {
    enabled[layer] = layer.startsWith('piano')
      ? state.piano.sectionOn && state.piano.layers[layer as 'piano.a'].enabled
      : layer.startsWith('organ')
        ? state.organ.sectionOn && state.organ.layers[layer as 'organ.a'].enabled
        : state.synth.sectionOn && state.synth.layers[layer as 'synth.a'].enabled
  }
  const scenes = defaultScenes(state.piano, state.organ, state.synth)
  scenes.sceneI = { ...enabled }
  scenes.sceneII = { ...enabled }
  state.scenes = scenes
}

const FACTORY: FactorySpec[] = [
  {
    slot: 1,
    name: 'Init Stage',
    build: (state) => {
      // The power-on program: one piano layer and nothing else. An instrument that booted
      // with all three engines sounding would be a different instrument.
      silenceAll(state)
      state.piano.sectionOn = true
      state.piano.layers['piano.a'].enabled = true
      // The organ's drawbars keep the positions the panel prints, because a drawbar's
      // physical position is its setting.
      state.organ.layers['organ.a'].drawbars = [...B3_DEFAULT_DRAWBARS]
    },
  },
  {
    slot: 2,
    name: 'Concert Grand',
    build: (state) => {
      silenceAll(state)
      state.piano.sectionOn = true
      const layer = state.piano.layers['piano.a']
      layer.enabled = true
      layer.type = 'grand'
      layer.model = 'grand.salamander'
      layer.level = 84
      state.effects.chains['piano.a'].reverb = { on: true, type: 'Hall', dryWet: 3.5, tone: 'Bright', global: false }
    },
  },
  {
    slot: 3,
    name: 'Tine Stack',
    build: (state) => {
      silenceAll(state)
      state.piano.sectionOn = true
      const a = state.piano.layers['piano.a']
      a.enabled = true
      a.type = 'electric'
      a.model = 'electric.cp80'
      a.level = 80
      const b = state.piano.layers['piano.b']
      b.enabled = true
      b.type = 'electric'
      b.model = 'electric.wurlitzer'
      b.level = 58
      b.octave = 12
      state.piano.timbre = 3
      state.effects.chains['piano.a'].mod2 = { on: true, type: 'Chorus', rate: 4.5, amount: 5 }
    },
  },
  {
    slot: 4,
    name: 'Drawbar Blues',
    build: (state) => {
      silenceAll(state)
      state.organ.sectionOn = true
      const layer = state.organ.layers['organ.a']
      layer.enabled = true
      layer.model = 'b3'
      layer.drawbars = [8, 8, 8, 6, 0, 0, 0, 0, 0]
      layer.percussion = { on: true, soft: false, fast: false, third: true, poly: false }
      layer.vibratoOn = true
      layer.vibratoType = 'C3'
      state.effects.rotary = { on: true, speed: 'Fast', drive: 4, organRouted: true }
    },
  },
  {
    slot: 5,
    name: 'Vox Combo',
    build: (state) => {
      silenceAll(state)
      state.organ.sectionOn = true
      const layer = state.organ.layers['organ.a']
      layer.enabled = true
      layer.model = 'vox'
      layer.drawbars = [8, 8, 8, 6, 4, 2, 0, 4, 0]
      layer.vibratoOn = true
      layer.vibratoType = 'V3'
      state.effects.rotary = { on: true, speed: 'Slow', drive: 2, organRouted: true }
    },
  },
  {
    slot: 6,
    name: 'Farf Buzz',
    build: (state) => {
      silenceAll(state)
      state.organ.sectionOn = true
      const layer = state.organ.layers['organ.a']
      layer.enabled = true
      layer.model = 'farf'
      layer.drawbars = [0, 0, 8, 8, 0, 8, 0, 0, 0]
      state.effects.chains.organ.ampEq = {
        on: true,
        model: 'Small',
        drive: 4,
        bass: 1,
        mid: 2,
        midFreq: 5,
        treble: 1,
      }
    },
  },
  {
    slot: 7,
    name: 'Cathedral Pipe',
    build: (state) => {
      silenceAll(state)
      state.organ.sectionOn = true
      const layer = state.organ.layers['organ.a']
      layer.enabled = true
      layer.model = 'pipe1'
      layer.drawbars = [6, 8, 0, 6, 0, 4, 0, 0, 3]
      state.effects.chains.organ.reverb = { on: true, type: 'Cathedral', dryWet: 6, tone: 'Bright', global: false }
    },
  },
  {
    slot: 8,
    name: 'Super Wide',
    build: (state) => {
      silenceAll(state)
      state.synth.sectionOn = true
      const layer = state.synth.layers['synth.a']
      layer.enabled = true
      layer.waveform = 'Super Saw'
      layer.oscCtrl = 6.5
      layer.filterType = 'LP24'
      layer.filterFreq = 5.6
      layer.filterRes = 2.4
      layer.ampEnv = { attack: 4.2, decay: 7, release: 6, velocity: 0.3, amount: 0 }
      state.effects.chains['synth.a'].reverb = { on: true, type: 'Stage', dryWet: 4, tone: 'Bright', global: false }
    },
  },
  {
    slot: 9,
    name: 'Sync Lead',
    build: (state) => {
      silenceAll(state)
      state.synth.sectionOn = true
      const layer = state.synth.layers['synth.a']
      layer.enabled = true
      layer.waveform = 'Sync Saw'
      layer.oscCtrl = 5
      layer.oscEnvAmount = 6
      layer.filterType = 'LP12'
      layer.filterFreq = 8
      layer.voiceMode = 'Mono'
      layer.priority = 'High'
      layer.glide = 3
      layer.ampEnv = { attack: 0.4, decay: 5, release: 2, velocity: 0.7, amount: 0 }
      layer.lfo.destinations.pitch = true
      layer.lfo.amount = 1.6
      layer.vibrato = 'Wheel'
    },
  },
  {
    slot: 10,
    name: 'Split Bass / Lead',
    build: (state) => {
      silenceAll(state)
      state.split.on = true
      state.split.points.Low = { position: 'C3', crossfade: 0 }
      state.split.points.Mid = { position: 'F4', crossfade: 6 }
      state.split.points.High = { position: 'C6', crossfade: 0 }
      // The B3 Bass register plays the bottom zone; a saw lead takes everything above the
      // Mid point and fades in across six semitones.
      state.organ.sectionOn = true
      const bass = state.organ.layers['organ.a']
      bass.enabled = true
      bass.model = 'b3-bass'
      bass.drawbars = [8, 0, 8, 0, 0, 0, 0, 0, 0]
      bass.zones = [true, false, false, false]
      state.synth.sectionOn = true
      const lead = state.synth.layers['synth.a']
      lead.enabled = true
      lead.zones = [false, true, true, true]
      lead.waveform = 'Saw'
      lead.filterFreq = 7
    },
  },
  {
    slot: 11,
    name: 'Piano + Pad',
    build: (state) => {
      silenceAll(state)
      state.piano.sectionOn = true
      const piano = state.piano.layers['piano.a']
      piano.enabled = true
      piano.type = 'grand'
      piano.model = 'grand.studio'
      piano.level = 78
      state.synth.sectionOn = true
      const pad = state.synth.layers['synth.a']
      pad.enabled = true
      pad.level = 48
      pad.waveform = 'Multi Saw'
      pad.oscCtrl = 3
      pad.filterFreq = 4.4
      pad.ampEnv = { attack: 5.5, decay: 6.5, release: 5.5, velocity: 0.2, amount: 0 }
      state.effects.chains['synth.a'].reverb = { on: true, type: 'Hall', dryWet: 5, tone: 'Bright', global: false }
    },
  },
  {
    slot: 12,
    name: 'Arp Pulse',
    build: (state) => {
      silenceAll(state)
      state.clock.bpm = 126
      state.synth.sectionOn = true
      const layer = state.synth.layers['synth.a']
      layer.enabled = true
      layer.waveform = 'Pulse 33'
      layer.filterType = 'BP'
      layer.filterFreq = 6
      layer.filterRes = 4
      layer.arp = {
        ...layer.arp,
        mode: 'Arp',
        run: true,
        rate: 6.5,
        range: 1,
        direction: 'Up/Down',
        hold: false,
        clockSync: true,
      }
      layer.ampEnv = { attack: 0.2, decay: 3, release: 1.2, velocity: 0.6, amount: 0 }
    },
  },
]

/** The factory bank: 32 slots, twelve designed programs and `Init` slots for the rest. */
export function createFactoryBank(): StoredProgram[] {
  const bySlot = new Map(FACTORY.map((spec) => [spec.slot, spec]))
  const programs: StoredProgram[] = []
  for (let slot = 1; slot <= PROGRAM_SLOTS; slot += 1) {
    const spec = bySlot.get(slot)
    if (!spec) {
      programs.push({ slot, name: `Init ${slotLabel(slot)}`, live: false, state: defaultProgramState() })
      continue
    }
    const state = defaultProgramState()
    spec.build(state)
    syncScenes(state)
    programs.push({ slot, name: spec.name, live: false, state })
  }
  return programs
}

/** The Live slots start as copies of the power-on program, each still `Init`. */
export function createLiveSlots(): StoredProgram[] {
  const slots: StoredProgram[] = []
  for (let slot = 1; slot <= LIVE_SLOTS; slot += 1) {
    slots.push({ slot, name: `Live ${slot}`, live: true, state: defaultProgramState() })
  }
  return slots
}

/* ------------------------------------------------------------------ */
/* Persistence                                                        */
/* ------------------------------------------------------------------ */

/** The injectable persistence boundary. The browser passes `localStorage`. */
export interface ProgramStorage {
  read(): string | null
  write(value: string): void
  clear(): void
}

export function createMemoryStorage(initial?: string): ProgramStorage {
  let value = initial ?? null
  return {
    read: () => value,
    write: (next) => {
      value = next
    },
    clear: () => {
      value = null
    },
  }
}

/** The browser's `localStorage`, guarded so a denied quota cannot break the instrument. */
export function browserProgramStorage(key = 'nord-stage-4.programs'): ProgramStorage {
  const safe = (): Storage | null => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage
    } catch {
      return null
    }
  }
  return {
    read: () => {
      try {
        return safe()?.getItem(key) ?? null
      } catch {
        return null
      }
    },
    write: (value) => {
      try {
        safe()?.setItem(key, value)
      } catch {
        // Quota or privacy mode: the program is still stored in memory for this session.
      }
    },
    clear: () => {
      try {
        safe()?.removeItem(key)
      } catch {
        /* nothing to clear */
      }
    },
  }
}

/* ------------------------------------------------------------------ */
/* The system                                                         */
/* ------------------------------------------------------------------ */

export interface ProgramSnapshot {
  /** The bank of 32 programs. */
  programs: StoredProgram[]
  /** The eight auto-storing Live slots. */
  liveSlots: StoredProgram[]
  /** True when the eight program buttons address the Live slots. */
  liveMode: boolean
  /** The selected slot, 1..32 or 1..8 in Live mode. */
  slot: number
  /** The page the eight buttons currently show, 1..4. */
  page: number
  /** The name of the selected program. */
  name: string
  /** The last state committed to the current slot, or null if never stored. */
  stored: ProgramState | null
  /** True when the live state differs from `stored`. Computed from the live state, never set. */
  dirty: boolean
  /** The slot a pending Store / Store As is targeting, or null when no store is in progress. */
  storeTarget: number | null
  /** The name being edited during Store As, or null when not naming. */
  naming: string | null
  /** The numeric list view (Shift + the Program dial, manual p. 41). */
  listView: boolean
  /** The single-level undo entry offered for a program change from a dirty state. */
  undo: { slot: number; state: ProgramState } | null
  /** Layer Scene II engaged (manual p. 43). */
  sceneII: boolean
  /** True when the eight buttons address the Live slots. */
  isLive: boolean
}

export interface ProgramSystemOptions {
  /** Reads the instrument's live program state. */
  read: () => ProgramState
  /** Loads a program state into the instrument. */
  write: (state: ProgramState) => void
  /** Called after a program change, so the engine can be resynchronised. */
  onLoad?: (state: ProgramState, meta: { slot: number; name: string; live: boolean }) => void
  programs?: StoredProgram[]
  liveSlots?: StoredProgram[]
  slot?: number
  storage?: ProgramStorage
  /** Start in Live mode, with the eight buttons addressing the Live slots. */
  liveMode?: boolean
}

export interface ProgramSystem {
  get(): ProgramSnapshot
  subscribe(listener: (snapshot: ProgramSnapshot) => void): () => void
  /** Recomputes the snapshot, e.g. after an edit elsewhere changed the live state. */
  refresh(): void
  /**
   * Records that the live state changed and returns whether that edit was auto-stored.
   *
   * In Live mode every edit is stored, so this commits the current state into the selected
   * Live slot before returning. In bank mode it only refreshes the snapshot. The instrument
   * calls this after any panel edit, which is what keeps a Live slot from ever being dirty.
   */
  noteEdit(): void

  selectSlot(slot: number): void
  browse(delta: number): void
  setPage(page: number): void
  setLiveMode(on: boolean): void

  beginStore(): void
  confirmStore(): void
  storeBrowse(delta: number): void
  storeSelect(slot: number): void
  beginStoreAs(): void
  setName(name: string): void
  cancelStore(): void

  setListView(on: boolean): void
  setSceneII(on: boolean): void
  undoLastChange(): void

  /** Serializes the whole bank, so persistence can be verified. */
  serialize(): string
  /** Restores a serialized bank. */
  restore(text: string): void
}

/**
 * Builds the program system.
 *
 * `read` and `write` are required because the dirty flag has to be computed from the live
 * instrument state, not from a cached copy. Loading a program calls `write` and then
 * `onLoad`, so the audio graph and the panel are resynchronised together.
 */
export function createProgramSystem(options: ProgramSystemOptions): ProgramSystem {
  const storage = options.storage ?? null
  let programs = options.programs ?? createFactoryBank()
  let liveSlots = options.liveSlots ?? createLiveSlots()

  // A stored bank from the last session takes precedence over the factory content, so Live
  // slots survive a reload.
  const persisted = readPersisted()
  if (persisted) {
    programs = persisted.programs
    liveSlots = persisted.liveSlots
  }

  const startSlot = options.liveMode ? 1 : clampSlot(options.slot ?? 1)
  let liveMode = false
  let slot = startSlot
  let page = pageForSlot(startSlot)
  let storeTarget: number | null = null
  let naming: string | null = null
  let listView = false
  let undo: { slot: number; state: ProgramState } | null = null

  const listeners = new Set<(snapshot: ProgramSnapshot) => void>()
  let snapshot: ProgramSnapshot = build()

  function readPersisted(): { programs: StoredProgram[]; liveSlots: StoredProgram[] } | null {
    if (!storage) return null
    try {
      const raw = storage.read()
      if (!raw) return null
      const parsed = JSON.parse(raw) as { programs?: StoredProgram[]; liveSlots?: StoredProgram[] }
      if (!Array.isArray(parsed.programs) || !Array.isArray(parsed.liveSlots)) return null
      if (parsed.programs.length !== PROGRAM_SLOTS || parsed.liveSlots.length !== LIVE_SLOTS) return null
      return { programs: parsed.programs, liveSlots: parsed.liveSlots }
    } catch {
      // A corrupt or version-mismatched bank falls back to the factory content rather than
      // half-loading a program the player cannot trust.
      return null
    }
  }

  function currentRecord(): StoredProgram {
    return liveMode ? liveSlots[slot - 1] : programs[slot - 1]
  }

  function build(): ProgramSnapshot {
    const record = currentRecord()
    const live = options.read()
    // Dirty is a comparison, computed fresh on every snapshot. It can never be assigned.
    const dirty = !programStatesEqual(live, record.state)
    return {
      programs,
      liveSlots,
      liveMode,
      slot,
      page,
      name: record.name,
      stored: record.state,
      dirty,
      storeTarget,
      naming,
      listView,
      undo,
      sceneII: live.scenes.second,
      isLive: liveMode,
    }
  }

  function publish(): void {
    snapshot = build()
    for (const listener of listeners) listener(snapshot)
  }

  function persist(): void {
    if (!storage) return
    try {
      storage.write(JSON.stringify({ version: 1, programs, liveSlots }))
    } catch {
      // A storage failure must never make the instrument unsound.
    }
  }

  /**
   * Loads a slot's state into the instrument.
   *
   * A program change discards unsaved edits (manual p. 13). The discarded state is kept as
   * the single-level undo entry the spec allows as optional.
   */
  function loadSlot(target: number, keepUndo: boolean): void {
    const limit = liveMode ? LIVE_SLOTS : PROGRAM_SLOTS
    const next = Math.min(limit, Math.max(1, Math.round(target)))
    const record = liveMode ? liveSlots[next - 1] : programs[next - 1]
    if (!record) return
    const wasDirty = !programStatesEqual(options.read(), currentRecord().state)
    if (keepUndo && wasDirty) undo = { slot, state: cloneProgramState(options.read()) }
    else if (!keepUndo) undo = null
    slot = next
    page = liveMode ? page : pageForSlot(next)
    storeTarget = null
    naming = null
    options.write(cloneProgramState(record.state))
    options.onLoad?.(record.state, { slot: next, name: record.name, live: liveMode })
    publish()
  }

  /**
   * Commits the live state to a slot.
   *
   * The store flow lets the destination differ from the selected slot ("select with
   * dial/page/program buttons; STORE again confirms"), so the commit writes to `target`, not
   * to `slot`. After a successful store, `target` is also the selected slot — the destination
   * becomes the program the instrument is playing, which is what makes the dirty flag fall to
   * false for the right reason.
   */
  function commitTo(target: number, name?: string): void {
    const limit = liveMode ? LIVE_SLOTS : PROGRAM_SLOTS
    const next = Math.min(limit, Math.max(1, Math.round(target)))
    const list = liveMode ? liveSlots : programs
    const record = list[next - 1]
    if (!record) return
    const committed = cloneProgramState(options.read())
    const updated: StoredProgram = { ...record, state: committed, name: name ?? record.name }
    if (liveMode) liveSlots = liveSlots.map((entry) => (entry.slot === next ? updated : entry))
    else programs = programs.map((entry) => (entry.slot === next ? updated : entry))
    // Storing to a destination also selects it, exactly as the manual's Store flow does.
    slot = next
    page = liveMode ? page : pageForSlot(next)
    storeTarget = null
    naming = null
    undo = null
    persist()
    publish()
  }

  // Entering Live mode loads the Live slot matching the button just pressed.
  const initialLive = options.liveMode === true
  if (initialLive) {
    liveMode = true
    slot = 1
    page = 1
    options.write(cloneProgramState(liveSlots[0].state))
  }

  return {
    get: () => snapshot,

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    refresh: publish,

    /**
     * An edit happened. In Live mode this is the store — that is what "all edits are stored
     * automatically" means — so the Live slot is written immediately and can never be dirty.
     */
    noteEdit() {
      if (!liveMode) {
        publish()
        return
      }
      const committed = cloneProgramState(options.read())
      const record = liveSlots[slot - 1]
      if (!record) {
        publish()
        return
      }
      const updated: StoredProgram = { ...record, state: committed }
      liveSlots = liveSlots.map((entry) => (entry.slot === slot ? updated : entry))
      persist()
      publish()
    },

    selectSlot(target) {
      // Re-selecting the selected program is a no-op, so it cannot throw edits away when the
      // player taps the button that is already lit.
      if (target === slot) {
        page = liveMode ? page : pageForSlot(target)
        publish()
        return
      }
      loadSlot(target, true)
    },

    browse(delta) {
      const limit = liveMode ? LIVE_SLOTS : PROGRAM_SLOTS
      const next = ((((slot - 1 + Math.round(delta)) % limit) + limit) % limit) + 1
      loadSlot(next, true)
    },

    setPage(nextPage) {
      if (liveMode) return
      page = Math.min(PROGRAM_PAGES, Math.max(1, Math.round(nextPage)))
      publish()
    },

    setLiveMode(on) {
      if (on === liveMode) return
      if (on) {
        liveMode = true
        undo = null
        slot = buttonForSlot(slot)
        page = 1
        options.write(cloneProgramState(liveSlots[slot - 1].state))
      } else {
        liveMode = false
        undo = null
        slot = clampSlot(slot)
        page = pageForSlot(slot)
        options.write(cloneProgramState(programs[slot - 1].state))
      }
      storeTarget = null
      naming = null
      publish()
    },

    beginStore() {
      storeTarget = slot
      naming = null
      publish()
    },

    confirmStore() {
      // A second STORE press confirms the destination and commits.
      commitTo(storeTarget ?? slot, naming ?? undefined)
    },

    storeBrowse(delta) {
      if (storeTarget === null) return
      const limit = liveMode ? LIVE_SLOTS : PROGRAM_SLOTS
      const next = ((((storeTarget - 1 + Math.round(delta)) % limit) + limit) % limit) + 1
      storeTarget = next
      if (!liveMode) page = pageForSlot(next)
      publish()
    },

    storeSelect(target) {
      if (storeTarget === null) return
      const limit = liveMode ? LIVE_SLOTS : PROGRAM_SLOTS
      storeTarget = Math.min(limit, Math.max(1, Math.round(target)))
      if (!liveMode) page = pageForSlot(storeTarget)
      publish()
    },

    beginStoreAs() {
      const record = currentRecord()
      // A new program is named "New Program" rather than inheriting the slot's name, which
      // would silently overwrite a program under a name the player never typed.
      naming = record.name.startsWith('Init') || record.name.startsWith('Live') ? 'New Program' : `${record.name} 2`
      storeTarget = slot
      publish()
    },

    setName(name) {
      if (naming === null) return
      naming = name.slice(0, 16)
      publish()
    },

    cancelStore() {
      if (storeTarget === null && naming === null) return
      storeTarget = null
      naming = null
      publish()
    },

    setListView(on) {
      listView = on
      publish()
    },

    setSceneII(on) {
      // The scene switch is itself part of the program state, so it is written through the
      // instrument like any other edit; that is what makes it store and round-trip.
      const live = options.read()
      const next = cloneProgramState(live)
      next.scenes.second = on
      options.write(next)
      publish()
    },

    undoLastChange() {
      if (!undo) return
      const entry = undo
      undo = null
      if (entry.slot === slot) {
        options.write(cloneProgramState(entry.state))
        publish()
        return
      }
      slot = entry.slot
      page = pageForSlot(entry.slot)
      options.write(cloneProgramState(entry.state))
      publish()
    },

    serialize() {
      return JSON.stringify({ version: 1, programs, liveSlots })
    },

    restore(text) {
      const parsed = JSON.parse(text) as { programs: StoredProgram[]; liveSlots: StoredProgram[] }
      programs = parsed.programs
      liveSlots = parsed.liveSlots
      slot = liveMode ? Math.min(LIVE_SLOTS, slot) : clampSlot(slot)
      page = liveMode ? page : pageForSlot(slot)
      options.write(cloneProgramState(currentRecord().state))
      storeTarget = null
      naming = null
      undo = null
      persist()
      publish()
    },
  }
}

/** The slot list a mode shows, for the numeric list view. */
export function visibleSlots(snapshot: ProgramSnapshot): StoredProgram[] {
  return snapshot.liveMode ? snapshot.liveSlots : snapshot.programs
}
