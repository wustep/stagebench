import {
  AmpType,
  Chain,
  DELAY_MAX_SECONDS,
  DELAY_MIN_SECONDS,
  ENV_STEPS,
  arpBpm,
  arpOctaves,
  attackSeconds,
  clockDivision,
  decaySeconds,
  delayKnobToSeconds,
  delaySecondsToKnob,
  lfoRate,
} from '../audio/dsp/params'
import { ORGAN_MODELS, VIB_TYPES, organModel } from '../organ/catalog'
import { PIANO_TYPES } from '../piano/catalog'
import type { StorageBoundary } from '../platform/types'
import { ProgramBank } from '../programs/bank'
import {
  ARP_DIRECTIONS,
  ARP_MODES,
  FILTER_TYPES,
  KB_TRACKS,
  LFO_DESTS,
  LFO_WAVES,
  PRIORITIES,
  SYNTH_CATEGORIES,
  SYNTH_WAVEFORMS,
  VIBRATO_MODES,
  VOICE_MODES,
  waveform,
  wavesOf,
} from '../synth/catalog'
import {
  AMP_TYPES,
  BPM_MAX,
  BPM_MIN,
  CHAIN_NAMES,
  DELAY_FILTERS,
  GLOBAL_UNITS,
  KB_TOUCHES,
  LAYER_NAMES,
  LEVELS,
  LIVE_COUNT,
  MOD1_TYPES,
  MOD2_TYPES,
  NAME_CHARACTERS,
  NAME_LENGTH,
  PROGRAM_COUNT,
  PROGRAMS_PER_PAGE,
  REVERB_TONES,
  REVERB_TYPES,
  SECTION_NAMES,
  SPLIT_POINT_NAMES,
  SPLIT_POSITIONS,
  TIMBRES,
  UNIT_NAMES,
  XFADE_WIDTHS,
  chainOf,
  chainOwner,
  createInitialState,
  effectiveSoftRelease,
  effectiveStringRes,
  extractProgram,
  fxTargets,
  initialSynthLayer,
  initialUi,
  layerModel,
  modelCount,
  programSignature,
  sceneEnables,
  slotLabel,
  timbreCount,
  zoneChoiceIndex,
  zoneChoices,
  type FxChainState,
  type GlobalUnitId,
  type OrganLayerState,
  type PianoLayerState,
  type SlotRef,
  type SoundSection,
  type StageState,
  type SynthLayerState,
  type SynthPage,
  type UnitId,
} from './model'
import { MORPH_SOURCE_NAMES, morphBase, morphTarget, type MorphSource } from './morph'

type Listener = () => void

/** Knob parameters of the effect units, by unit. */
export type FxParam =
  | ['mod1', 'rate' | 'amount']
  | ['mod2', 'rate' | 'amount']
  | ['delay', 'tempo' | 'feedback' | 'mix']
  | ['amp', 'drive' | 'bass' | 'mid' | 'freq' | 'treble']
  | ['comp', 'amount']
  | ['reverb', 'mix']

/** Knobs of the Synth section, as paths inside a Synth layer. */
export type SynthKnob =
  | 'ctrl'
  | 'oscEnv.amount'
  | 'filter.freq'
  | 'filter.res'
  | 'filter.envAmt'
  | 'lfo.rate'
  | 'lfo.amount'
  | 'arp.rate'
  | 'arp.range'
  | 'voice.glide'

const SYNTH_KNOB_NAMES: Record<SynthKnob, string> = {
  ctrl: 'Osc Ctrl',
  'oscEnv.amount': 'Osc Env Amt',
  'filter.freq': 'Filter Freq',
  'filter.res': 'Filter Res',
  'filter.envAmt': 'Filter Env Amt',
  'lfo.rate': 'LFO Rate',
  'lfo.amount': 'LFO Amount',
  'arp.rate': 'Arp Rate',
  'arp.range': 'Arp Range',
  'voice.glide': 'Glide',
}

const TYPE_LISTS: Partial<Record<UnitId, readonly string[]>> = {
  mod1: MOD1_TYPES,
  mod2: MOD2_TYPES,
  amp: AMP_TYPES,
  reverb: REVERB_TYPES,
}

const LAYER_COUNTS: Record<SoundSection, number> = { organ: 2, piano: 2, synth: 3 }

export interface StageStoreOptions {
  /** Where stored programs and Live slots are kept. Without it they last as long as the store. */
  storage?: StorageBoundary | null
  bank?: ProgramBank
}

/**
 * The canonical state and every action that can change it. Panel controls (through the
 * binder), tests, and nothing else call these methods; the audio engine and the UI only read.
 * Each action is a complete, named panel operation — the same thing a hand does on the
 * instrument — so there is exactly one implementation of what a control means.
 *
 * The store also owns the program memory. After every change it compares the program part of
 * the state with what is stored in the loaded slot: that comparison *is* the "E" (edited)
 * indicator, so it cannot be wrong, and in Live Mode it is what triggers the automatic store.
 */
export class StageStore {
  readonly bank: ProgramBank
  private state: StageState = createInitialState()
  private listeners = new Set<Listener>()
  /** Signature of the program stored in the loaded slot. */
  private storedSignature: string

  constructor(options: StageStoreOptions = {}) {
    this.bank = options.bank ?? new ProgramBank(options.storage ?? null)
    this.state = this.loaded(createInitialState(), { live: false, slot: 0 })
    this.storedSignature = this.bank.signature({ live: false, slot: 0 })
  }

  getState = (): StageState => this.state

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  get listenerCount(): number {
    return this.listeners.size
  }

  /** Back to program 1.1 as stored, out of Live Mode and out of every editing page. */
  reset(): void {
    this.state = this.loaded(createInitialState(), { live: false, slot: 0 })
    this.storedSignature = this.bank.signature({ live: false, slot: 0 })
    this.emit()
  }

  /** Apply a change that may touch the program, then settle the edited flag (or auto-store in Live Mode). */
  private update(change: (draft: StageState) => void): void {
    const draft = structuredClone(this.state)
    change(draft)
    const signature = programSignature(draft)
    if (draft.nav.live) {
      // Live Mode: every edit is stored as it is made.
      if (signature !== this.storedSignature) {
        this.bank.store({ live: true, slot: draft.nav.slot }, extractProgram(draft))
        this.storedSignature = signature
      }
      draft.nav.dirty = false
    } else {
      draft.nav.dirty = signature !== this.storedSignature
    }
    this.state = draft
    this.emit()
  }

  /** Apply a change to performance or editing state only; the program is not compared. */
  private perform(change: (draft: StageState) => void): void {
    const draft = { ...this.state, nav: { ...this.state.nav }, ui: structuredClone(this.state.ui) }
    change(draft)
    this.state = draft
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  // ── Programs ────────────────────────────────────────────────────────────────

  /** `state` with the program stored at `ref` loaded into it, on the plain playing page. */
  private loaded(state: StageState, ref: SlotRef): StageState {
    const program = this.bank.get(ref)
    const next: StageState = { ...state, ...program }
    next.nav = {
      live: ref.live,
      slot: ref.slot,
      program: ref.live ? state.nav.program : ref.slot,
      liveSlot: ref.live ? ref.slot : state.nav.liveSlot,
      dirty: false,
    }
    next.ui = { ...initialUi(), synthPage: state.ui.synthPage, section: displaySection(next) }
    return next
  }

  /** Load a program or Live slot. Unstored edits of the program being left are discarded. */
  load(ref: SlotRef): void {
    const slot = clamp(Math.round(ref.slot), 0, (ref.live ? LIVE_COUNT : PROGRAM_COUNT) - 1)
    const target = { live: ref.live, slot }
    const discarded = this.state.nav.dirty
    const next = this.loaded(structuredClone(this.state), target)
    next.notice = `${slotLabel(target)} ${next.name}${discarded ? ' (edits discarded)' : ''}`
    this.storedSignature = this.bank.signature(target)
    this.state = next
    this.emit()
  }

  /** The slot that is loaded. */
  get current(): SlotRef {
    return { live: this.state.nav.live, slot: this.state.nav.slot }
  }

  /** A Program button, 0..7. What it does depends on the page the display is on. */
  pressProgramButton(button: number): void {
    const { ui, nav } = this.state
    switch (ui.mode) {
      case 'store': {
        const dest = ui.store.dest
        this.setStoreDest(dest.live ? { live: true, slot: button } : { live: false, slot: pageOf(dest.slot) * PROGRAMS_PER_PAGE + button })
        return
      }
      case 'name':
        if (button === 0) this.nameInsert()
        else if (button === 1) this.nameDelete()
        else this.setNotice('Name: 1 inserts a space, 2 deletes; the dial picks the character')
        return
      case 'split':
        if (button === 0) this.splitToggleRow()
        else if (button <= 3) this.splitSelect(button - 1)
        else this.setNotice('Split: 1 Note/xFade, 2 Low, 3 Mid, 4 High')
        return
      case 'clock':
        if (button === 0) {
          this.toggleClockKbSync()
          return
        }
        break
    }
    if (nav.live) this.load({ live: true, slot: button })
    else this.load({ live: false, slot: pageOf(nav.slot) * PROGRAMS_PER_PAGE + button })
  }

  /** The Page buttons. */
  page(direction: -1 | 1): void {
    const { ui, nav } = this.state
    switch (ui.mode) {
      case 'store': {
        const dest = ui.store.dest
        if (dest.live) this.setNotice('The Live slots are a single page')
        else this.setStoreDest({ live: false, slot: wrap(dest.slot + direction * PROGRAMS_PER_PAGE, PROGRAM_COUNT) })
        return
      }
      case 'name':
        this.perform((s) => {
          s.ui.store.cursor = clamp(s.ui.store.cursor + direction, 0, NAME_LENGTH - 1)
        })
        return
      case 'split':
        this.splitSelect(clamp(ui.split.point + direction, 0, 2), false)
        return
      case 'list':
        this.listMove(direction * PROGRAMS_PER_PAGE)
        return
    }
    if (nav.live) {
      this.setNotice('The Live slots are a single page')
      return
    }
    // The same button on the next page.
    this.load({ live: false, slot: wrap(nav.slot + direction * PROGRAMS_PER_PAGE, PROGRAM_COUNT) })
  }

  /** The Program dial, by detents. */
  turnProgramDial(detents: number): void {
    if (detents === 0) return
    const { ui, nav } = this.state
    switch (ui.mode) {
      case 'list':
        this.listMove(detents)
        return
      case 'store': {
        const dest = ui.store.dest
        this.setStoreDest({ live: dest.live, slot: clamp(dest.slot + detents, 0, (dest.live ? LIVE_COUNT : PROGRAM_COUNT) - 1) })
        return
      }
      case 'name':
        this.nameTurn(detents)
        return
      case 'split':
        this.splitTurn(detents)
        return
      case 'clock':
        this.setBpm(this.state.clock.bpm + detents)
        return
      case 'transpose':
        this.setTranspose(this.state.transpose.semitones + detents)
        return
    }
    const count = nav.live ? LIVE_COUNT : PROGRAM_COUNT
    const next = clamp(nav.slot + detents, 0, count - 1)
    if (next !== nav.slot) this.load({ live: nav.live, slot: next })
  }

  /** Shift + Program dial: the numeric list of all 32 programs. Turning on moves through it. */
  openList(detents = 0): void {
    if (this.state.nav.live) {
      this.setNotice('The list shows the 32 programs; leave Live Mode to use it')
      return
    }
    this.perform((s) => {
      s.ui = { ...s.ui, mode: 'list', audition: null, listCursor: s.nav.slot }
      s.notice = 'Program list'
    })
    if (detents !== 0) this.listMove(detents)
  }

  private listMove(amount: number): void {
    const next = clamp(this.state.ui.listCursor + amount, 0, PROGRAM_COUNT - 1)
    if (next === this.state.ui.listCursor) return
    // Moving through the list loads what it highlights, as the dial does on the instrument.
    this.load({ live: false, slot: next })
    this.perform((s) => {
      s.ui.mode = 'list'
      s.ui.listCursor = next
    })
  }

  /** Live Mode: the eight Program buttons become the eight Live slots, whose edits store themselves. */
  toggleLive(): void {
    const { ui, nav } = this.state
    if (ui.mode === 'store') {
      // During a Store, Live Mode chooses between the Live slots and the program slots as the destination.
      const dest = ui.store.dest
      this.setStoreDest(dest.live ? { live: false, slot: nav.program } : { live: true, slot: nav.liveSlot })
      return
    }
    if (nav.live) this.load({ live: false, slot: nav.program })
    else this.load({ live: true, slot: nav.liveSlot })
    this.perform((s) => {
      s.notice = s.nav.live ? `Live Mode: ${slotLabel(this.current)} ${s.name}` : `Live Mode Off: ${slotLabel(this.current)} ${s.name}`
    })
  }

  /**
   * The Store button. From the playing page it opens "Store program to"; pressed again it
   * stores. With `as` (Shift + Store) it first opens the naming page.
   */
  pressStore(as = false): void {
    const { ui } = this.state
    if (ui.mode === 'store') {
      this.confirmStore()
      return
    }
    if (ui.mode === 'name') {
      // Name done: on to the destination.
      this.perform((s) => {
        s.ui.mode = 'store'
        s.notice = `Store "${trimName(s.ui.store.name)}" to ${slotLabel(s.ui.store.dest)}: Store confirms, Shift cancels`
      })
      return
    }
    this.perform((s) => {
      s.ui = {
        ...s.ui,
        mode: as ? 'name' : 'store',
        audition: null,
        morphAssign: null,
        store: { dest: { live: s.nav.live, slot: s.nav.slot }, name: s.name, cursor: 0, naming: as },
      }
      s.notice = as ? 'Store As: name the program, then press Store' : `Store to ${slotLabel(s.ui.store.dest)}: Store confirms, Shift cancels`
    })
  }

  private setStoreDest(dest: SlotRef): void {
    this.perform((s) => {
      s.ui.store.dest = dest
      // The program already in the destination can be heard before it is overwritten.
      const same = dest.live === s.nav.live && dest.slot === s.nav.slot
      s.ui.audition = same ? null : this.bank.get(dest)
      s.notice = `Store to ${slotLabel(dest)} ${this.bank.name(dest)}`
    })
  }

  private confirmStore(): void {
    const { store } = this.state.ui
    const dest = store.dest
    const name = trimName(store.name) || 'Untitled'
    const draft = structuredClone(this.state)
    draft.name = name
    this.bank.store(dest, extractProgram(draft))
    draft.nav = {
      live: dest.live,
      slot: dest.slot,
      program: dest.live ? draft.nav.program : dest.slot,
      liveSlot: dest.live ? dest.slot : draft.nav.liveSlot,
      dirty: false,
    }
    draft.ui = { ...draft.ui, mode: 'play', audition: null }
    draft.notice = `Stored to ${slotLabel(dest)} ${name}`
    this.storedSignature = this.bank.signature(dest)
    this.state = draft
    this.emit()
  }

  private nameTurn(detents: number): void {
    this.perform((s) => {
      const { store } = s.ui
      const padded = store.name.padEnd(NAME_LENGTH, ' ')
      const at = Math.max(0, NAME_CHARACTERS.indexOf(padded[store.cursor]))
      const next = NAME_CHARACTERS[wrap(at + detents, NAME_CHARACTERS.length)]
      store.name = (padded.slice(0, store.cursor) + next + padded.slice(store.cursor + 1)).slice(0, NAME_LENGTH)
    })
  }

  /** Naming: insert a space at the cursor. */
  nameInsert(): void {
    this.perform((s) => {
      const { store } = s.ui
      const padded = store.name.padEnd(NAME_LENGTH, ' ')
      store.name = (padded.slice(0, store.cursor) + ' ' + padded.slice(store.cursor)).slice(0, NAME_LENGTH)
    })
  }

  /** Naming: delete the character at the cursor. */
  nameDelete(): void {
    this.perform((s) => {
      const { store } = s.ui
      const padded = store.name.padEnd(NAME_LENGTH, ' ')
      store.name = (padded.slice(0, store.cursor) + padded.slice(store.cursor + 1)).padEnd(NAME_LENGTH, ' ')
    })
  }

  /** Set the whole name being edited (tests, and anything that can type). */
  setStoreName(name: string): void {
    this.perform((s) => {
      s.ui.store.name = name.slice(0, NAME_LENGTH)
    })
  }

  /** True while the display is on an editing page or a Morph Assign is latched. */
  get editing(): boolean {
    return this.state.ui.mode !== 'play' || this.state.ui.morphAssign !== null
  }

  /** Shift / Exit: leave the editing page. A Store in progress is cancelled; nothing is written. */
  exit(): void {
    if (!this.editing) return
    this.perform((s) => {
      const was = s.ui.mode
      s.ui = { ...s.ui, mode: 'play', audition: null, morphAssign: null }
      s.notice = was === 'store' || was === 'name' ? 'Store cancelled' : 'Exit'
    })
  }

  // ── Layer Scenes ────────────────────────────────────────────────────────────

  /**
   * Layer Scene II. A scene is only a set of on/off switches for the sections and layers: the
   * two scenes share every sound parameter. Switching swaps the live switches with the other
   * scene's stored ones.
   */
  toggleScene(): void {
    this.update((s) => {
      const leaving = sceneEnables(s)
      const entering = s.scene.other
      for (const section of ['organ', 'piano', 'synth'] as const) {
        s[section].on = entering[section].on
        s[section].layers.forEach((layer, index) => {
          layer.on = entering[section].layers[index] ?? layer.on
        })
        // Keep the focus on a layer that is on.
        if (!s[section].layers[s[section].focus].on) {
          const first = s[section].layers.findIndex((layer) => layer.on)
          if (first >= 0) s[section].focus = first
        }
      }
      s.scene.other = leaving
      s.scene.active = s.scene.active === 0 ? 1 : 0
      s.ui.section = displaySection(s)
      s.fx.focus = chainOf(s.ui.section, s[s.ui.section].focus)
      s.notice = `Layer Scene ${s.scene.active === 0 ? 'I' : 'II'}`
    })
  }

  // ── Splits and zones ────────────────────────────────────────────────────────

  /** Split On: one press splits the keyboard at the Mid point (C4 unless it has been moved). */
  toggleSplit(): void {
    this.update((s) => {
      s.split.on = !s.split.on
      if (s.split.on && !s.split.points.some((point) => point.on)) s.split.points[1].on = true
      s.notice = s.split.on ? `Split On: ${describeSplit(s)}` : 'Split Off'
    })
  }

  /** The Keyboard Split page: each point's note and crossfade. */
  openSplit(): void {
    this.perform((s) => {
      s.ui = { ...s.ui, mode: 'split', audition: null }
      s.notice = 'Keyboard Split: 1 Note/xFade, 2 Low, 3 Mid, 4 High, dial sets'
    })
  }

  private splitToggleRow(): void {
    this.perform((s) => {
      s.ui.split.row = s.ui.split.row === 'note' ? 'xfade' : 'note'
      s.notice = `Split: ${s.ui.split.row === 'note' ? 'Note' : 'xFade'} row`
    })
  }

  /** Select a split point on the split page. Selecting the selected point again switches it on or off. */
  private splitSelect(point: number, toggle = true): void {
    if (toggle && this.state.ui.split.point === point && this.state.ui.split.row === 'note') {
      this.setSplitPoint(point, { on: !this.state.split.points[point].on })
      return
    }
    this.perform((s) => {
      s.ui.split.point = point
      s.notice = `Split point ${SPLIT_POINT_NAMES[point]}`
    })
  }

  private splitTurn(detents: number): void {
    const { point, row } = this.state.ui.split
    const current = this.state.split.points[point]
    if (row === 'xfade') {
      const index = clamp(XFADE_WIDTHS.indexOf(current.xfade as 0 | 6 | 12) + detents, 0, XFADE_WIDTHS.length - 1)
      this.setSplitPoint(point, { xfade: XFADE_WIDTHS[index] })
      return
    }
    // Off, then the positions this point may take: the points stay in order, so a neighbour
    // that is on limits how far it can go, and the dial steps straight past what is not allowed.
    const points = this.state.split.points
    const allowed = SPLIT_POSITIONS.filter((note) =>
      points.every((other, index) => index === point || !other.on || (index < point ? other.note < note : other.note > note)),
    )
    const now = current.on ? allowed.indexOf(current.note as (typeof SPLIT_POSITIONS)[number]) + 1 : 0
    const next = clamp(now + detents, 0, allowed.length)
    if (next === now) {
      const blocker = detents > 0 ? points.findIndex((other, index) => index > point && other.on) : -1
      if (blocker >= 0) this.setNotice(`${SPLIT_POINT_NAMES[point]} must stay below ${SPLIT_POINT_NAMES[blocker]} (${noteLabel(points[blocker].note)})`)
      return
    }
    if (next === 0) this.setSplitPoint(point, { on: false })
    else this.setSplitPoint(point, { on: true, note: allowed[next - 1] })
  }

  /**
   * Change one split point. The points stay in order — Low below Mid below High — so a change
   * that would cross a neighbour is refused and says why.
   */
  setSplitPoint(point: number, change: Partial<{ on: boolean; note: number; xfade: number }>): void {
    const points = this.state.split.points
    const next = { ...points[point], ...change }
    if (!SPLIT_POSITIONS.includes(next.note as (typeof SPLIT_POSITIONS)[number])) return
    if (next.on) {
      // Its nearest neighbours that are on, below and above.
      const below = [point - 1, point - 2].find((other) => other >= 0 && points[other].on)
      const above = [point + 1, point + 2].find((other) => other <= 2 && points[other].on)
      const clash = below !== undefined && points[below].note >= next.note ? below : above !== undefined && points[above].note <= next.note ? above : undefined
      if (clash !== undefined) {
        this.setNotice(`${SPLIT_POINT_NAMES[point]} must stay ${clash < point ? 'above' : 'below'} ${SPLIT_POINT_NAMES[clash]} (${noteLabel(points[clash].note)})`)
        return
      }
    }
    this.update((s) => {
      s.split.points[point] = { on: next.on, note: next.note, xfade: XFADE_WIDTHS.includes(next.xfade as 0 | 6 | 12) ? next.xfade : 0 }
      // A point switched on from the page turns the split itself on.
      if (next.on) s.split.on = true
      if (!s.split.points.some((each) => each.on)) s.split.on = false
      s.notice = `Split ${SPLIT_POINT_NAMES[point]}: ${next.on ? noteLabel(next.note) : 'Off'}, xFade ${next.xfade === 0 ? 'Off' : `±${next.xfade}`}`
    })
  }

  /** KB Zone (Shift + Octave Shift): step the focused layer through the zones the split offers. */
  shiftZone(section: SoundSection, direction: -1 | 1): void {
    this.update((s) => {
      const layer = s[section].layers[s[section].focus]
      const choices = zoneChoices(s)
      if (choices.length === 1) {
        s.notice = 'KB Zone: turn Split on first'
        return
      }
      const index = wrap(zoneChoiceIndex(s, layer.zone) + direction, choices.length)
      layer.zone = [choices[index][0], choices[index][1]]
      touch(s, section)
      s.notice = `${layerLabel(section, s[section].focus)} KB Zone ${describeZone(choices[index])}`
    })
  }

  setZone(section: SoundSection, index: number, zone: [number, number]): void {
    this.update((s) => {
      s[section].layers[index].zone = [clamp(Math.round(zone[0]), 0, 3), clamp(Math.round(zone[1]), 0, 3)]
    })
  }

  // ── Master Clock, transpose ─────────────────────────────────────────────────

  /** The Master Clock page: the dial sets the tempo. */
  openClock(): void {
    if (this.state.ui.mode === 'clock') return
    this.perform((s) => {
      s.ui = { ...s.ui, mode: 'clock', audition: null }
      s.notice = `Master Clock ${s.clock.bpm} BPM: dial sets, tap 4 times, Shift exits`
    })
  }

  setBpm(bpm: number, how = 'Master Clock'): void {
    this.update((s) => {
      s.clock.bpm = clamp(Math.round(bpm), BPM_MIN, BPM_MAX)
      s.notice = `${how} ${s.clock.bpm} BPM`
    })
  }

  toggleClockKbSync(): void {
    this.update((s) => {
      s.clock.kbSync = !s.clock.kbSync
      s.notice = `Master Clock Keyboard Sync ${s.clock.kbSync ? 'On' : 'Off'}`
    })
  }

  /** The Transpose button: on or off, and the page where the dial sets the amount. */
  pressTranspose(): void {
    this.update((s) => {
      s.transpose.on = !s.transpose.on
      s.ui = { ...s.ui, mode: s.transpose.on ? 'transpose' : s.ui.mode === 'transpose' ? 'play' : s.ui.mode, audition: null }
      s.notice = s.transpose.on ? `Transpose On ${signedInt(s.transpose.semitones)}: dial sets, Shift exits` : 'Transpose Off'
    })
  }

  /** Holding Transpose: switch it on and open its page, ready for the dial. */
  openTranspose(): void {
    this.update((s) => {
      s.transpose.on = true
      s.ui = { ...s.ui, mode: 'transpose', audition: null }
      s.notice = `Transpose On ${signedInt(s.transpose.semitones)}: dial sets, Shift exits`
    })
  }

  setTranspose(semitones: number): void {
    this.update((s) => {
      s.transpose.semitones = clamp(Math.round(semitones), -6, 6)
      s.transpose.on = true
      s.notice = `Transpose ${signedInt(s.transpose.semitones)} semitones`
    })
  }

  // ── Morphs ──────────────────────────────────────────────────────────────────

  /** A Morph Assign button: latch (or unlatch) assignment for that source. */
  toggleMorphAssign(source: MorphSource): void {
    this.perform((s) => {
      s.ui.morphAssign = s.ui.morphAssign === source ? null : source
      s.notice = s.ui.morphAssign
        ? `Morph ${MORPH_SOURCE_NAMES[source]}: move a control to where the morph should end`
        : `Morph ${MORPH_SOURCE_NAMES[source]} assign off`
    })
  }

  /** Shift + Morph Assign: clear every assignment of that source. */
  clearMorph(source: MorphSource): void {
    this.update((s) => {
      s.morph[source] = []
      s.notice = `Morph ${MORPH_SOURCE_NAMES[source]} cleared`
    })
  }

  /**
   * Assign `path` to a source, with `to` as the value at the top of the source's travel. Setting
   * it back to the stored value removes the assignment.
   */
  setMorph(source: MorphSource, path: string, to: number): void {
    const target = morphTarget(path)
    if (!target) {
      this.setNotice('That control is not a morph destination')
      return
    }
    this.update((s) => {
      const base = morphBase(s, path)
      const end = clamp(to, target.min, target.max)
      const list = s.morph[source].filter((assignment) => assignment.path !== path)
      if (Math.abs(end - base) < 1e-6) {
        s.notice = `Morph ${MORPH_SOURCE_NAMES[source]}: ${target.label} removed`
      } else {
        list.push({ path, to: end })
        s.notice = `Morph ${MORPH_SOURCE_NAMES[source]}: ${target.label} ${formatNumber(base)} to ${formatNumber(end)}`
      }
      s.morph[source] = list
    })
  }

  /** Modulation wheel position, 0..1. */
  setWheel(value: number): void {
    const next = clamp(value, 0, 1)
    if (next === this.state.wheel) return
    this.perform((s) => {
      s.wheel = next
    })
  }

  /** Control pedal position, 0..1 (the on-screen pedal, or MIDI CC11). */
  setPedal(value: number): void {
    const next = clamp(value, 0, 1)
    if (next === this.state.pedal) return
    this.perform((s) => {
      s.pedal = next
    })
  }

  // ── Master, rotary, pitch stick ─────────────────────────────────────────────

  setMaster(value: number): void {
    this.perform((s) => {
      s.master = clamp(value, 0, 10)
      s.notice = `Master Level ${s.master.toFixed(1)}`
    })
  }

  setPitchStick(value: number): void {
    if (value === this.state.pitchStick) return
    this.perform((s) => {
      s.pitchStick = clamp(value, -100, 100)
    })
  }

  toggleRotarySpeed(): void {
    this.update((s) => {
      s.rotary.fast = !s.rotary.fast
      s.notice = `Rotary ${s.rotary.fast ? 'Fast' : s.rotary.stopMode ? 'Stop' : 'Slow'}`
    })
  }

  toggleRotaryStopMode(): void {
    this.update((s) => {
      s.rotary.stopMode = !s.rotary.stopMode
      s.notice = `Rotary Stop Mode ${s.rotary.stopMode ? 'On' : 'Off'}`
    })
  }

  setRotaryDrive(value: number): void {
    this.update((s) => {
      s.rotary.drive = clamp(value, 0, 10)
      s.notice = `Rotary Drive ${s.rotary.drive.toFixed(1)}`
    })
  }

  /** The Rotary Speaker's Organ button: send the organ through the rotor. */
  toggleRotaryOrgan(): void {
    this.update((s) => {
      s.rotary.organ = !s.rotary.organ
      s.notice = `Organ to Rotary ${s.rotary.organ ? 'On' : 'Off'}`
    })
  }

  // ── Sections and layers (Organ, Piano, Synth alike) ─────────────────────────

  toggleSectionOn(section: SoundSection): void {
    this.update((s) => {
      s[section].on = !s[section].on
      if (s[section].on) {
        touch(s, section)
        s.fx.focus = chainOf(section, s[section].focus)
      }
      s.notice = `${SECTION_NAMES[section]} ${s[section].on ? 'On' : 'Off'}`
    })
  }

  togglePianoOn(): void {
    this.toggleSectionOn('piano')
  }

  /**
   * A layer button. Off → the layer turns on and takes focus. On but not focused → it takes
   * focus. On and focused → it turns off and focus passes to another layer that is on (the last
   * layer stays on; the section's On button silences the section). Effect focus follows.
   */
  pressSectionLayer(section: SoundSection, index: number): void {
    this.update((s) => {
      const layers = s[section].layers
      const layer = layers[index]
      const label = layerLabel(section, index)
      const other = layers.findIndex((each, at) => at !== index && each.on)
      if (!layer.on) {
        layer.on = true
        focus(s, section, index)
        s.notice = `${label} On`
      } else if (s[section].focus !== index) {
        focus(s, section, index)
        s.notice = `${label} focus`
      } else if (other >= 0) {
        layer.on = false
        focus(s, section, other)
        s.notice = `${label} Off`
      } else {
        focus(s, section, index)
        s.notice = `${label} is the only layer on`
      }
    })
  }

  pressLayer(index: number): void {
    this.pressSectionLayer('piano', index)
  }

  /** Set a layer on or off directly (keeps at least the focus valid). */
  setSectionLayerOn(section: SoundSection, index: number, on: boolean): void {
    this.update((s) => {
      const layers = s[section].layers
      layers[index].on = on
      if (on) focus(s, section, index)
      else if (s[section].focus === index) {
        const other = layers.findIndex((each) => each.on)
        if (other >= 0) focus(s, section, other)
      }
    })
  }

  setLayerOn(index: number, on: boolean): void {
    this.setSectionLayerOn('piano', index, on)
  }

  focusSectionLayer(section: SoundSection, index: number): void {
    this.update((s) => focus(s, section, index))
  }

  focusLayer(index: number): void {
    this.focusSectionLayer('piano', index)
  }

  toggleSectionSustPed(section: SoundSection): void {
    this.update((s) => {
      s[section].sustPed = !s[section].sustPed
      const prefix = section === 'piano' ? '' : `${SECTION_NAMES[section]} `
      s.notice = `${prefix}Sustain Pedal ${s[section].sustPed ? 'On' : 'Off'}`
    })
  }

  toggleSustPed(): void {
    this.toggleSectionSustPed('piano')
  }

  toggleSectionPStick(section: SoundSection): void {
    this.update((s) => {
      s[section].pStick = !s[section].pStick
      const prefix = section === 'piano' ? '' : `${SECTION_NAMES[section]} `
      s.notice = `${prefix}Pitch Stick ${s[section].pStick ? 'On' : 'Off'}`
    })
  }

  togglePStick(): void {
    this.toggleSectionPStick('piano')
  }

  setSectionLayerLevel(section: SoundSection, index: number, value: number): void {
    this.update((s) => {
      const layer = s[section].layers[index]
      layer.level = clamp(value, 0, 100)
      s.notice = `${layerLabel(section, index)} Level ${Math.round(layer.level)}`
    })
  }

  setLayerLevel(index: number, value: number): void {
    this.setSectionLayerLevel('piano', index, value)
  }

  shiftSectionOctave(section: SoundSection, direction: -1 | 1): void {
    this.update((s) => {
      const layer = s[section].layers[s[section].focus]
      layer.octave = clamp(layer.octave + direction, -1, 1)
      touch(s, section)
      s.notice = `${layerLabel(section, s[section].focus)} Octave ${layer.octave > 0 ? '+' : ''}${layer.octave}`
    })
  }

  shiftOctave(direction: -1 | 1): void {
    this.shiftSectionOctave('piano', direction)
  }

  // ── Piano section ───────────────────────────────────────────────────────────

  /** The Piano Select type button: next of the six types. */
  nextType(): void {
    this.setType((this.focused().type + 1) % PIANO_TYPES.length)
  }

  setType(type: number): void {
    this.editLayer((layer, s, name) => {
      layer.type = clamp(Math.round(type), 0, PIANO_TYPES.length - 1)
      if (layer.timbre >= timbreCount(layer)) layer.timbre = 0
      s.notice = `Layer ${name}: ${layerModel(layer).name}`
    })
  }

  /** The Piano Select dial: step through the models of the current type (stops at either end). */
  turnModel(detents: number): void {
    this.editLayer((layer, s, name) => {
      const next = clamp((layer.models[layer.type] ?? 0) + detents, 0, modelCount(layer) - 1)
      layer.models[layer.type] = next
      if (layer.timbre >= timbreCount(layer)) layer.timbre = 0
      s.notice = `Layer ${name}: ${layerModel(layer).name} (${next + 1}/${modelCount(layer)})`
    })
  }

  nextTimbre(): void {
    this.editLayer((layer, s) => {
      layer.timbre = (layer.timbre + 1) % timbreCount(layer)
      s.notice = `Timbre ${TIMBRES[layer.timbre]}`
    })
  }

  setTimbre(timbre: number): void {
    this.editLayer((layer) => {
      layer.timbre = clamp(Math.round(timbre), 0, timbreCount(layer) - 1)
    })
  }

  nextKbTouch(): void {
    this.editLayer((layer, s) => {
      layer.kbTouch = (layer.kbTouch + 1) % KB_TOUCHES.length
      s.notice = `KB Touch ${KB_TOUCHES[layer.kbTouch]}`
    })
  }

  nextDynComp(): void {
    this.editLayer((layer, s) => {
      layer.dynComp = (layer.dynComp + 1) % LEVELS.length
      s.notice = `Dyn Comp ${LEVELS[layer.dynComp]}`
    })
  }

  nextUnison(): void {
    this.editLayer((layer, s) => {
      layer.unison = (layer.unison + 1) % LEVELS.length
      s.notice = `Unison ${LEVELS[layer.unison]}`
    })
  }

  /**
   * The Acoustics button steps Off → Soft Release → String Res → both, skipping whatever the
   * current model does not support (no Soft Release on a Clav, no string resonance without strings).
   */
  nextAcoustics(): void {
    this.editLayer((layer, s) => {
      const model = layerModel(layer)
      const options: Array<[boolean, boolean]> = [[false, false]]
      if (model.softRelease) options.push([true, false])
      if (model.stringRes) options.push([false, true])
      if (model.softRelease && model.stringRes) options.push([true, true])
      const now = options.findIndex(
        ([soft, res]) => soft === effectiveSoftRelease(layer) && res === effectiveStringRes(layer),
      )
      const [soft, res] = options[(now + 1) % options.length]
      if (model.softRelease) layer.softRelease = soft
      if (model.stringRes) layer.stringRes = res
      s.notice =
        options.length === 1
          ? `${model.name}: no Soft Release or String Res`
          : `Soft Release ${soft ? 'On' : 'Off'}, String Res ${res ? 'On' : 'Off'}`
    })
  }

  setLayer(index: number, change: (layer: PianoLayerState) => void): void {
    this.update((s) => change(s.piano.layers[index]))
  }

  // ── Organ section ───────────────────────────────────────────────────────────

  /** The Organ Model button: next model for the focused layer. */
  nextOrganModel(): void {
    this.setOrganModel((this.state.organ.layers[this.state.organ.focus].model + 1) % ORGAN_MODELS.length)
  }

  setOrganModel(model: number): void {
    this.editOrgan((layer, s, name) => {
      layer.model = clamp(Math.round(model), 0, ORGAN_MODELS.length - 1)
      s.notice = `Organ ${name}: ${organModel(layer.model).name}`
    })
  }

  /** A drawbar of the focused Organ layer, 0..8. */
  setDrawbar(bar: number, value: number): void {
    this.editOrgan((layer, s, name) => {
      const info = organModel(layer.model)
      layer.drawbars[bar] = clamp(Math.round(value), 0, 8)
      const legend = info.drawbars[bar]
      s.notice =
        legend === null
          ? `Organ ${name} drawbar ${bar + 1}: not used by ${info.name}`
          : info.tabs
            ? `Organ ${name} ${legend} ${layer.drawbars[bar] > 4 ? 'On' : 'Off'}`
            : `Organ ${name} ${legend} ${layer.drawbars[bar]}`
    })
  }

  /** The Vibrato/Chorus selector, shared by both layers. */
  nextVibType(): void {
    this.update((s) => {
      s.organ.vibType = (s.organ.vibType + 1) % VIB_TYPES.length
      touch(s, 'organ')
      s.notice = `Vibrato/Chorus ${VIB_TYPES[s.organ.vibType]}`
    })
  }

  /** Vibrato/Chorus On for the focused layer. */
  toggleVibrato(): void {
    this.editOrgan((layer, s, name) => {
      layer.vibOn = !layer.vibOn
      s.notice = `Organ ${name} Vibrato/Chorus ${layer.vibOn ? `${VIB_TYPES[s.organ.vibType]} On` : 'Off'}`
    })
  }

  /** The B3 Percussion buttons, for the focused layer. */
  togglePercussion(what: 'on' | 'soft' | 'fast' | 'third'): void {
    this.editOrgan((layer, s, name) => {
      layer.perc[what] = !layer.perc[what]
      const model = organModel(layer.model)
      const text =
        what === 'on'
          ? `Percussion ${layer.perc.on ? 'On' : 'Off'}`
          : what === 'soft'
            ? `Percussion Volume ${layer.perc.soft ? 'Soft' : 'Normal'}`
            : what === 'fast'
              ? `Percussion Decay ${layer.perc.fast ? 'Fast' : 'Slow'}`
              : `Percussion Harmonic ${layer.perc.third ? 'Third' : 'Second'}`
      s.notice = `Organ ${name} ${text}${model.percussion ? '' : ` (${model.name} has no percussion)`}`
    })
  }

  setOrganLayer(index: number, change: (layer: OrganLayerState) => void): void {
    this.update((s) => change(s.organ.layers[index]))
  }

  private editOrgan(change: (layer: OrganLayerState, state: StageState, name: string) => void): void {
    this.update((s) => {
      change(s.organ.layers[s.organ.focus], s, LAYER_NAMES[s.organ.focus])
      touch(s, 'organ')
    })
  }

  // ── Synth section ───────────────────────────────────────────────────────────

  /** Which page the Synth display and its three dials are on. */
  setSynthPage(page: SynthPage): void {
    this.perform((s) => {
      s.ui.synthPage = page
      s.ui.section = 'synth'
    })
  }

  /** A page button: show its page, or go back to the oscillator page if it is already showing. */
  toggleSynthPage(page: SynthPage): void {
    this.setSynthPage(this.state.ui.synthPage === page ? 'osc' : page)
  }

  /** One of the three dials under the Synth display, by detents. What it edits depends on the page. */
  turnSynthDial(dial: number, detents: number): void {
    if (detents === 0) return
    const page = this.state.ui.synthPage
    this.editSynth((layer, s, name) => {
      const env = page === 'oscEnv' ? layer.oscEnv : page === 'filterEnv' ? layer.filterEnv : page === 'ampEnv' ? layer.ampEnv : null
      if (env) {
        const key = (['attack', 'decay', 'release'] as const)[dial]
        env[key] = clamp(env[key] + detents, 0, ENV_STEPS)
        const title = page === 'oscEnv' ? 'Osc Env' : page === 'filterEnv' ? 'Filter Env' : 'Amp Env'
        s.notice = `Synth ${name} ${title} ${key} ${describeEnvStep(key, env[key])}`
        return
      }
      switch (page) {
        case 'pitch':
          if (dial === 0) layer.coarse = clamp(layer.coarse + detents, -24, 24)
          else if (dial === 1) layer.fine = clamp(layer.fine + detents, -50, 50)
          s.notice = `Synth ${name} Pitch ${signedInt(layer.coarse)} semitones, ${signedInt(layer.fine)} cents`
          return
        case 'filter':
          if (dial === 0) layer.filter.type = clamp(layer.filter.type + detents, 0, FILTER_TYPES.length - 1)
          else if (dial === 1) layer.filter.track = clamp(layer.filter.track + detents, 0, KB_TRACKS.length - 1)
          else layer.filter.drive = clamp(layer.filter.drive + detents, 0, 3)
          s.notice = `Synth ${name} Filter ${FILTER_TYPES[layer.filter.type]}, KB Track ${KB_TRACKS[layer.filter.track]}, Drive ${LEVELS[layer.filter.drive]}`
          return
        case 'lfo':
          if (dial === 0) layer.lfo.wave = clamp(layer.lfo.wave + detents, 0, LFO_WAVES.length - 1)
          s.notice = `Synth ${name} LFO ${LFO_WAVES[layer.lfo.wave]}`
          return
        case 'arp':
          if (dial === 0) layer.arp.direction = clamp(layer.arp.direction + detents, 0, ARP_DIRECTIONS.length - 1)
          s.notice = `Synth ${name} Arp Direction ${ARP_DIRECTIONS[layer.arp.direction]}`
          return
        case 'vibrato':
          if (dial === 0) layer.voice.vibRate = clamp(Math.round((layer.voice.vibRate + detents * 0.5) * 2) / 2, 2, 8)
          else if (dial === 1) layer.voice.vibAmount = clamp(layer.voice.vibAmount + detents * 0.5, 0, 10)
          s.notice = `Synth ${name} Vibrato ${layer.voice.vibRate.toFixed(1)} Hz, Amount ${layer.voice.vibAmount.toFixed(1)}`
          return
        default: {
          // Oscillator page. Dial 1 walks the whole waveform list, dial 2 the categories,
          // dial 3 the waveforms inside the category.
          const now = waveform(layer.wave)
          if (dial === 0) layer.wave = clamp(layer.wave + detents, 0, SYNTH_WAVEFORMS.length - 1)
          else if (dial === 1) {
            const category = SYNTH_CATEGORIES[clamp(SYNTH_CATEGORIES.indexOf(now.category) + detents, 0, SYNTH_CATEGORIES.length - 1)]
            if (category !== now.category) layer.wave = wavesOf(category)[0].id
          } else {
            const list = wavesOf(now.category)
            layer.wave = list[clamp(list.findIndex((wave) => wave.id === now.id) + detents, 0, list.length - 1)].id
          }
          const chosen = waveform(layer.wave)
          s.notice = `Synth ${name}: ${chosen.category} ${chosen.name}`
        }
      }
    })
  }

  setSynthWave(wave: number): void {
    this.editSynth((layer, s, name) => {
      layer.wave = clamp(Math.round(wave), 0, SYNTH_WAVEFORMS.length - 1)
      s.notice = `Synth ${name}: ${waveform(layer.wave).category} ${waveform(layer.wave).name}`
    })
  }

  /** A Synth knob of the focused layer, in panel units. */
  setSynthKnob(knob: SynthKnob, value: number): void {
    this.editSynth((layer, s, name) => {
      const [group, key] = knob.includes('.') ? knob.split('.') : [null, knob]
      const target = (group ? (layer as unknown as Record<string, Record<string, number>>)[group] : (layer as unknown as Record<string, number>)) as Record<string, number>
      target[key] = knob === 'oscEnv.amount' ? clamp(value, -10, 10) : clamp(value, 0, 10)
      s.notice = `Synth ${name} ${describeSynthKnob(layer, knob, s.clock.bpm)}`
    })
  }

  /** Sound Init (Shift + Waveform): the focused layer back to the initial sound; its level, zone, and octave stay. */
  initSynthSound(): void {
    this.editSynth((layer, s, name) => {
      const fresh = initialSynthLayer(layer.on, layer.level)
      fresh.zone = layer.zone
      fresh.octave = layer.octave
      s.synth.layers[s.synth.focus] = fresh
      s.notice = `Synth ${name} Sound Init`
    })
  }

  nextFilterType(): void {
    this.editSynth((layer, s, name) => {
      layer.filter.type = (layer.filter.type + 1) % FILTER_TYPES.length
      s.notice = `Synth ${name} Filter ${FILTER_TYPES[layer.filter.type]}`
    })
  }

  toggleFilterOn(): void {
    this.editSynth((layer, s, name) => {
      layer.filter.on = !layer.filter.on
      s.notice = `Synth ${name} Filter ${layer.filter.on ? 'On' : 'Off'}`
    })
  }

  nextLfoWave(): void {
    this.editSynth((layer, s, name) => {
      layer.lfo.wave = (layer.lfo.wave + 1) % LFO_WAVES.length
      s.notice = `Synth ${name} LFO ${LFO_WAVES[layer.lfo.wave]}`
    })
  }

  nextLfoDest(): void {
    this.editSynth((layer, s, name) => {
      layer.lfo.dest = (layer.lfo.dest + 1) % LFO_DESTS.length
      s.notice = `Synth ${name} LFO to ${LFO_DESTS[layer.lfo.dest]}`
    })
  }

  /** Lock the LFO or the arpeggiator of the focused layer to the Master Clock (Shift + turn its Rate knob). */
  setSynthSync(what: 'lfo' | 'arp', on: boolean): void {
    this.editSynth((layer, s, name) => {
      layer[what].sync = on
      s.notice = `Synth ${name} ${what === 'lfo' ? 'LFO' : 'Arp'} Master Clock ${on ? `On (${clockDivision(layer[what].rate).label})` : 'Off'}`
    })
  }

  nextVoiceMode(): void {
    this.editSynth((layer, s, name) => {
      layer.voice.mode = (layer.voice.mode + 1) % VOICE_MODES.length
      s.notice = `Synth ${name} Voice ${VOICE_MODES[layer.voice.mode]}`
    })
  }

  /** Note priority for Mono and Legato (Shift + Voice mode): last note, Low, High. */
  nextPriority(): void {
    this.editSynth((layer, s, name) => {
      layer.voice.priority = (layer.voice.priority + 1) % PRIORITIES.length
      s.notice = `Synth ${name} Priority ${PRIORITIES[layer.voice.priority]}`
    })
  }

  nextSynthUnison(): void {
    this.editSynth((layer, s, name) => {
      layer.voice.unison = (layer.voice.unison + 1) % LEVELS.length
      s.notice = `Synth ${name} Unison ${LEVELS[layer.voice.unison]}`
    })
  }

  nextVibratoMode(): void {
    this.editSynth((layer, s, name) => {
      layer.voice.vibrato = (layer.voice.vibrato + 1) % VIBRATO_MODES.length
      s.notice = `Synth ${name} Vibrato ${VIBRATO_MODES[layer.voice.vibrato]}`
    })
  }

  nextArpMode(): void {
    this.editSynth((layer, s, name) => {
      layer.arp.mode = (layer.arp.mode + 1) % ARP_MODES.length
      s.notice = `Synth ${name} Arpeggiator mode ${ARP_MODES[layer.arp.mode]}`
    })
  }

  toggleArpRun(): void {
    this.editSynth((layer, s, name) => {
      layer.arp.run = !layer.arp.run
      s.notice = `Synth ${name} ${ARP_MODES[layer.arp.mode]} ${layer.arp.run ? 'Run' : 'Stop'}`
    })
  }

  /** KB Sync (Shift + Arp Run): playing from silence restarts the pattern. */
  toggleKbSync(): void {
    this.editSynth((layer, s, name) => {
      layer.arp.kbSync = !layer.arp.kbSync
      s.notice = `Synth ${name} KB Sync ${layer.arp.kbSync ? 'On' : 'Off'}`
    })
  }

  /** KB Hold, for the whole Synth section. */
  toggleHold(): void {
    this.update((s) => {
      s.synth.hold = !s.synth.hold
      touch(s, 'synth')
      s.notice = `KB Hold ${s.synth.hold ? 'On' : 'Off'}`
    })
  }

  toggleEnvVelocity(which: 'oscEnv' | 'filterEnv'): void {
    this.editSynth((layer, s, name) => {
      layer[which].velocity = !layer[which].velocity
      s.notice = `Synth ${name} ${which === 'oscEnv' ? 'Osc' : 'Filter'} Env Velocity ${layer[which].velocity ? 'On' : 'Off'}`
    })
  }

  nextAmpVelocity(): void {
    this.editSynth((layer, s, name) => {
      layer.ampEnv.velocity = (layer.ampEnv.velocity + 1) % LEVELS.length
      s.notice = `Synth ${name} Amp Velocity ${LEVELS[layer.ampEnv.velocity]}`
    })
  }

  toggleEnvToPitch(): void {
    this.editSynth((layer, s, name) => {
      layer.oscEnv.toPitch = !layer.oscEnv.toPitch
      s.notice = `Synth ${name} Env To Pitch ${layer.oscEnv.toPitch ? 'On' : 'Off'}`
    })
  }

  setSynthLayer(index: number, change: (layer: SynthLayerState) => void): void {
    this.update((s) => change(s.synth.layers[index]))
  }

  private editSynth(change: (layer: SynthLayerState, state: StageState, name: string) => void): void {
    this.update((s) => {
      change(s.synth.layers[s.synth.focus], s, LAYER_NAMES[s.synth.focus])
      touch(s, 'synth')
    })
  }

  // ── Layer Effects ───────────────────────────────────────────────────────────

  toggleFxOn(): void {
    this.update((s) => {
      s.fx.on = !s.fx.on
      s.notice = s.fx.on ? 'Layer Effects On' : 'All Effects Off'
    })
  }

  /**
   * An FX Focus button. Organ focuses the organ's one chain. Piano and Synth focus their
   * section's chain, and pressed again step to the section's next layer.
   */
  nextFxFocus(section: SoundSection = 'piano'): void {
    this.update((s) => {
      const owner = chainOwner(s.fx.focus)
      const count = LAYER_COUNTS[section]
      const layer = owner.section === section ? (owner.layer + 1) % (section === 'organ' ? 1 : count) : section === 'organ' ? 0 : s[section].focus
      s.fx.focus = chainOf(section, layer)
      s.notice = section === 'organ' ? 'FX Focus Organ' : `FX Focus ${SECTION_NAMES[section]} ${LAYER_NAMES[layer]}`
    })
  }

  /** Focus a chain directly (0..5, see CHAIN_NAMES). */
  setFxFocus(chain: number): void {
    this.update((s) => {
      s.fx.focus = clamp(Math.round(chain), 0, s.fx.chains.length - 1)
    })
  }

  /** Group (Shift + FX Focus Piano / Synth): entering copies the focused layer's effects to the section's other layers. */
  toggleGroup(section: 'piano' | 'synth' = 'piano'): void {
    this.update((s) => {
      const key = section === 'piano' ? 'pianoGroup' : 'synthGroup'
      s.fx[key] = !s.fx[key]
      if (s.fx[key]) {
        const owner = chainOwner(s.fx.focus)
        const source = chainOf(section, owner.section === section ? owner.layer : s[section].focus)
        for (let layer = 0; layer < LAYER_COUNTS[section]; layer += 1) {
          const chain = chainOf(section, layer)
          if (chain !== source) s.fx.chains[chain] = structuredClone(s.fx.chains[source])
        }
      }
      s.notice = `${SECTION_NAMES[section]} FX Group ${s.fx[key] ? 'On' : 'Off'}`
    })
  }

  /** A unit's On button. */
  toggleUnit(unit: UnitId): void {
    this.update((s) => {
      const on = !s.fx.chains[s.fx.focus][unit].on
      for (const index of fxTargets(s, unit)) s.fx.chains[index][unit].on = on
      s.notice = `${UNIT_NAMES[unit]} ${on ? 'On' : 'Off'}`
    })
  }

  /** Global (Shift + On) for Delay, Compressor, Reverb: entering copies the focused unit to every chain. */
  toggleGlobal(unit: GlobalUnitId): void {
    this.update((s) => {
      s.fx.global[unit] = !s.fx.global[unit]
      if (s.fx.global[unit]) {
        const source = s.fx.chains[s.fx.focus]
        s.fx.chains.forEach((target, index) => {
          if (index === s.fx.focus) return
          if (unit === 'delay') target.delay = { ...source.delay }
          else if (unit === 'comp') target.comp = { ...source.comp }
          else target.reverb = { ...source.reverb }
        })
      }
      s.notice = `${UNIT_NAMES[unit]} Global ${s.fx.global[unit] ? 'On' : 'Off'}`
    })
  }

  /** A unit's type selector: next type. */
  nextUnitType(unit: 'mod1' | 'mod2' | 'amp' | 'reverb'): void {
    const list = TYPE_LISTS[unit] ?? []
    this.setUnitType(unit, (this.state.fx.chains[this.state.fx.focus][unit].type + 1) % list.length)
  }

  setUnitType(unit: 'mod1' | 'mod2' | 'amp' | 'reverb', type: number): void {
    const list = TYPE_LISTS[unit] ?? []
    this.update((s) => {
      const next = clamp(Math.round(type), 0, list.length - 1)
      for (const index of fxTargets(s, unit)) s.fx.chains[index][unit].type = next
      s.notice = `${UNIT_NAMES[unit]}: ${list[next]}`
    })
  }

  nextDelayFilter(): void {
    this.update((s) => {
      const next = (s.fx.chains[s.fx.focus].delay.filter + 1) % DELAY_FILTERS.length
      for (const index of fxTargets(s, 'delay')) s.fx.chains[index].delay.filter = next
      s.notice = `Delay Filter ${DELAY_FILTERS[next]}`
    })
  }

  toggleDelayPingPong(): void {
    this.update((s) => {
      const next = !s.fx.chains[s.fx.focus].delay.pingPong
      for (const index of fxTargets(s, 'delay')) s.fx.chains[index].delay.pingPong = next
      s.notice = `Delay Ping Pong ${next ? 'On' : 'Off'}`
    })
  }

  nextReverbTone(): void {
    this.update((s) => {
      const next = (s.fx.chains[s.fx.focus].reverb.tone + 1) % REVERB_TONES.length
      for (const index of fxTargets(s, 'reverb')) s.fx.chains[index].reverb.tone = next
      s.notice = `Reverb ${REVERB_TONES[next] === 'Off' ? 'Bright/Dark Off' : REVERB_TONES[next]}`
    })
  }

  setCompFast(fast: boolean): void {
    this.update((s) => {
      for (const index of fxTargets(s, 'comp')) s.fx.chains[index].comp.fast = fast
      s.notice = `Compressor Fast ${fast ? 'On' : 'Off'}`
    })
  }

  /** Lock Mod 1's rate or the Delay's tempo to the Master Clock (Shift + turn the knob). */
  setFxSync(unit: 'mod1' | 'delay', on: boolean): void {
    this.update((s) => {
      for (const index of fxTargets(s, unit)) s.fx.chains[index][unit].sync = on
      const chain = s.fx.chains[s.fx.focus]
      const knob = unit === 'mod1' ? chain.mod1.rate : chain.delay.tempo
      s.notice = `${UNIT_NAMES[unit]} Master Clock ${on ? `On (${clockDivision(knob).label})` : 'Off'}`
    })
  }

  /** A knob of an effect unit, in panel units. */
  setFxParam(param: FxParam, value: number): void {
    const [unit, name] = param
    this.update((s) => {
      for (const index of fxTargets(s, unit)) {
        const chain = s.fx.chains[index]
        const target = chain[unit] as unknown as Record<string, number>
        const bipolar = unit === 'amp' && (name === 'bass' || name === 'mid' || name === 'treble')
        target[name] = bipolar ? clamp(value, -15, 15) : clamp(value, 0, 10)
        if (unit === 'delay' && name === 'tempo') chain.delay.seconds = delayKnobToSeconds(chain.delay.tempo / 10)
      }
      s.notice = describeParam(s.fx.chains[s.fx.focus], param)
    })
  }

  /** Tap tempo: set the delay time to an exact interval; the Tempo knob follows. */
  setDelaySeconds(seconds: number): void {
    this.update((s) => {
      const time = clamp(seconds, DELAY_MIN_SECONDS, DELAY_MAX_SECONDS)
      for (const index of fxTargets(s, 'delay')) {
        s.fx.chains[index].delay.seconds = time
        s.fx.chains[index].delay.tempo = Math.round(delaySecondsToKnob(time) * 100) / 10
      }
      s.notice = `Delay Tap ${Math.round(time * 1000)} ms (${Math.round(60 / time)} BPM)`
    })
  }

  setChain(index: number, change: (chain: FxChainState) => void): void {
    this.update((s) => change(s.fx.chains[index]))
  }

  /** Replace any part of the state directly (tests and factory tooling). */
  edit(change: (state: StageState) => void): void {
    this.update(change)
  }

  setNotice(notice: string): void {
    if (notice === this.state.notice) return
    this.perform((s) => {
      s.notice = notice
    })
  }

  private focused(): PianoLayerState {
    return this.state.piano.layers[this.state.piano.focus]
  }

  private editLayer(change: (layer: PianoLayerState, state: StageState, name: string) => void): void {
    this.update((s) => {
      change(s.piano.layers[s.piano.focus], s, LAYER_NAMES[s.piano.focus])
      touch(s, 'piano')
    })
  }
}

/** Pressing a layer button focuses the layer and, with it, its effects (manual p. 23, 48). */
function focus(state: StageState, section: SoundSection, index: number): void {
  state[section].focus = index
  state.fx.focus = chainOf(section, index)
  state.ui.section = section
}

/** The Program display follows the section that was edited last. */
function touch(state: StageState, section: SoundSection): void {
  state.ui.section = section
}

/** The section the display should describe after a program is loaded or a scene switched. */
function displaySection(state: StageState): SoundSection {
  const owner = chainOwner(state.fx.focus).section
  if (state[owner].on) return owner
  for (const section of ['piano', 'organ', 'synth'] as const) if (state[section].on) return section
  return owner
}

function layerLabel(section: SoundSection, index: number): string {
  return section === 'piano' ? `Layer ${LAYER_NAMES[index]}` : `${SECTION_NAMES[section]} ${LAYER_NAMES[index]}`
}

function pageOf(slot: number): number {
  return Math.floor(slot / PROGRAMS_PER_PAGE)
}

function trimName(name: string): string {
  return name.replace(/\s+$/, '')
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function wrap(value: number, count: number): number {
  return ((value % count) + count) % count
}

function signedInt(value: number): string {
  return `${value > 0 ? '+' : ''}${value}`
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
export function noteLabel(note: number): string {
  return `${NOTE_NAMES[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`
}

export function describeZone(zone: readonly number[]): string {
  if (zone[0] === 0 && zone[1] === 3) return 'All'
  return zone[0] === zone[1] ? `${zone[0] + 1}` : `${zone[0] + 1}-${zone[1] + 1}`
}

export function describeSplit(state: Pick<StageState, 'split'>): string {
  const parts = state.split.points
    .map((point, index) => (state.split.on && point.on ? `${SPLIT_POINT_NAMES[index]} ${noteLabel(point.note)}${point.xfade ? ` ±${point.xfade}` : ''}` : null))
    .filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : 'Off'
}

export function formatHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz` : `${hz >= 100 ? Math.round(hz) : hz.toFixed(hz >= 10 ? 1 : 2)} Hz`
}

export function formatSeconds(seconds: number): string {
  return seconds < 1 ? `${seconds < 0.01 ? (seconds * 1000).toFixed(1) : Math.round(seconds * 1000)} ms` : `${seconds.toFixed(seconds < 10 ? 2 : 1)} s`
}

/** An envelope dial step in real units. */
export function describeEnvStep(key: 'attack' | 'decay' | 'release', step: number): string {
  if (key === 'decay' && step >= ENV_STEPS) return 'Sustain'
  return formatSeconds(key === 'attack' ? attackSeconds(step) : decaySeconds(step))
}

/** A Synth knob's value in real units, for the display and for assistive tech. */
export function describeSynthKnob(layer: SynthLayerState, knob: SynthKnob, bpm: number): string {
  const title = SYNTH_KNOB_NAMES[knob]
  switch (knob) {
    case 'lfo.rate':
      return layer.lfo.sync ? `${title} ${clockDivision(layer.lfo.rate).label} at ${bpm} BPM` : `${title} ${formatHz(lfoRate(layer.lfo.rate))}`
    case 'arp.rate':
      return layer.arp.sync ? `${title} ${clockDivision(layer.arp.rate).label} at ${bpm} BPM` : `${title} ${Math.round(arpBpm(layer.arp.rate))} BPM`
    case 'arp.range':
      return layer.arp.mode === 1 ? `Gate Env ${layer.arp.range.toFixed(1)}` : `${title} ${arpOctaves(layer.arp.range)} oct`
    case 'filter.freq':
      return `${title} ${formatHz(Math.min(20000, 20 * Math.pow(2, layer.filter.freq)))}`
    case 'ctrl':
      return `${title} ${layer.ctrl.toFixed(1)}`
    case 'oscEnv.amount':
      return `${title} ${layer.oscEnv.amount > 0 ? '+' : ''}${layer.oscEnv.amount.toFixed(1)}`
    case 'filter.res':
      return `${title} ${layer.filter.res.toFixed(1)}`
    case 'filter.envAmt':
      return `${title} ${layer.filter.envAmt.toFixed(1)}`
    case 'lfo.amount':
      return `${title} ${layer.lfo.amount.toFixed(1)}`
    default:
      return `${title} ${layer.voice.glide.toFixed(1)}`
  }
}

export function describeParam(chain: FxChainState, [unit, name]: FxParam): string {
  const label = UNIT_NAMES[unit]
  if (unit === 'delay' && name === 'tempo') {
    return chain.delay.sync ? `Delay ${clockDivision(chain.delay.tempo).label}` : `Delay ${Math.round(chain.delay.seconds * 1000)} ms`
  }
  if (unit === 'mod1' && name === 'rate' && chain.mod1.sync) return `Mod 1 Rate ${clockDivision(chain.mod1.rate).label}`
  if (unit === 'amp') {
    const filter = chain.amp.type === AmpType.LP24 || chain.amp.type === AmpType.HP24
    if (name === 'freq') return filter ? `Filter Freq ${chain.amp.freq.toFixed(1)}` : `EQ Mid Freq ${chain.amp.freq.toFixed(1)}`
    if (name === 'mid') return filter ? `Filter Res ${(((chain.amp.mid + 15) / 30) * 10).toFixed(1)}` : `EQ Mid ${signed(chain.amp.mid)} dB`
    if (name === 'bass') return `EQ Bass ${signed(chain.amp.bass)} dB`
    if (name === 'treble') return `EQ Treble ${signed(chain.amp.treble)} dB`
    return `Drive ${chain.amp.drive.toFixed(1)}`
  }
  const value = (chain[unit] as unknown as Record<string, number>)[name]
  const title = name === 'mix' ? 'Dry/Wet' : name.charAt(0).toUpperCase() + name.slice(1)
  return `${label} ${title} ${value.toFixed(1)}`
}

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}`
}

export { CHAIN_NAMES, Chain, GLOBAL_UNITS }
