// The instrument controller: one serialisable program (canonical SoundState) bound to the panel.
// It owns the program bank (32 programs + 8 Live slots), the program UI modes (Store, Store As
// naming, numeric list, Master Clock set, Transpose set, split edit), morph assignment, Layer
// Scenes, Solo, Undo, Panic, the Synth OLED page, and both OLEDs' content. Every panel action goes
// through `binding`; every state change goes through `commit`, which applies the morph-resolved
// sound to the one audio engine and note router and writes the panel feedback back.
import { TapTempo } from '../audio/fx/delay'
import type { LayeredEngine } from '../audio/layeredEngine'
import type { StageAudio } from '../audio/stageAudio'
import { isEdited, LIVE_SLOTS, NAME_LENGTH, PAGES, PER_PAGE, PROGRAM_SLOTS, programLocation, withPerformance, type ProgramBank } from '../model/programs'
import type { ControlBinding, HardwareAction, HardwareStore, MorphRange } from '../model/hardwareStore'
import { PANEL } from '../model/panel'
import { activate, FUNCTIONAL, indicators, isFunctional, pianoDisplay, presentation, setValue, type BindingContext, type Indicator } from '../model/panelBindings'
import {
  activateSection,
  sectionIndicators,
  sectionPresentation,
  setSectionValue,
  stepSynthDial,
  SYNTH_DIALS,
  SYNTH_PAGES,
  synthDialText,
  type SynthPage,
} from '../model/bindings/organSynth'
import { UNSUPPORTED, UNSUPPORTED_SHIFT } from '../model/bindings/audit'
import { applyMorphs, assignMorph, clearMorph, isMorphed, MORPH_DESTS, morphEnd } from '../model/morph'
import { ORGAN_MODEL_NAMES } from '../model/organState'
import { PIANO_CHAINS, SPLIT_POINT_NAMES, SPLIT_POSITION_NAMES, switchScene, syncScene, XFADES, type MorphSource, type SectionId, type SoundState } from '../model/sound'
import { arpBpm, envAttack, envDecay, envRelease, syncDivision, waveDef, type Envelope } from '../model/synthState'
import { stepSplitPoint } from '../model/zones'
import type { OledContent } from '../components/PanelSection'
import { BPM_MAX, BPM_MIN, ClockTap } from './clockTap'

export interface Location {
  live: boolean
  index: number
}

export type Mode =
  | { kind: 'play' }
  | { kind: 'store'; dest: Location; name: string; edited: SoundState; from: Location }
  | { kind: 'name'; name: string; cursor: number }
  | { kind: 'list' }
  | { kind: 'clock' }
  | { kind: 'transpose' }
  | { kind: 'split'; field: number }

export interface ControllerView {
  sound: SoundState
  location: Location
  name: string
  dirty: boolean
  mode: Mode
  morph: MorphSource | null
  synthPage: SynthPage
  section: SectionId
  solo: SectionId | null
  message: string | null
  wheel: number
  pedal: number
  canUndo: boolean
  programOled: OledContent
  synthOled: OledContent
}

export interface ControllerOptions {
  store: HardwareStore
  stage: StageAudio
  engine: LayeredEngine
  bank: ProgramBank
  /** Monotonic milliseconds (tap tempo). */
  nowMs: () => number
  /** Audio time in seconds (master-clock grid for the arpeggiators). */
  audioTime: () => number
  /** Initial performance state (Master Level). */
  initial: SoundState
  /** Called when the panel requests Panic (the UI also releases its own held inputs). */
  onPanic?: () => void
  /** Whether a piano model currently plays its labelled fallback. */
  pianoFailed?: (layer: 'A' | 'B', s: SoundState) => boolean
}

export const SHIFTS = ['effects-shift', 'program-shift']
const ENCODERS = new Set(['program-dial', 'piano-model', ...SYNTH_DIALS])
/** Knobs whose Shift + turn is a toggle (FAST, MST CLK) rather than a value. */
const SHIFT_TURN = new Set(['effects-comp-amount', 'effects-mod1-rate', 'effects-delay-tempo', 'synth-lfo-rate', 'synth-arp-rate'])
const NAME_CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-+/&.#'

/** Keybed split-point LEDs in keyboard order (C2 … C7), found by position across the sections. */
export const SPLIT_LEDS: readonly string[] = PANEL.leds
  .filter((l) => /-led-split-\d$/.test(l.id))
  .sort((a, b) => a.x - b.x)
  .map((l) => l.id)

const sectionOfControl = (id: string): SectionId | null => (id.startsWith('organ-') ? 'organ' : id.startsWith('piano-') ? 'piano' : id.startsWith('synth-') ? 'synth' : null)

/** The morph destination key a control edits right now (focused layer/chain), or null. */
export function morphKeyFor(s: SoundState, id: string): string | null {
  const level = /^(organ|piano|synth)-level-([abc])$/.exec(id)
  if (level) return `${level[1]}.${level[2].toUpperCase()}.level`
  const bar = /^organ-drawbar-(\d)$/.exec(id)
  if (bar) return `organ.${s.organ.focus}.drawbar${bar[1]}`
  const synth: Record<string, string> = {
    'synth-lfo-rate': 'lfoRate',
    'synth-lfo-mod-amt': 'lfoAmount',
    'synth-osc-ctrl': 'oscCtrl',
    'synth-filter-freq': 'filterFreq',
    'synth-filter-res': 'filterRes',
    'synth-arp-rate': 'arpRate',
  }
  if (synth[id]) return `synth.${s.synth.focus}.${synth[id]}`
  const fx: Record<string, string> = {
    'effects-mod1-rate': 'mod1.rate',
    'effects-mod1-amount': 'mod1.amount',
    'effects-mod2-amount': 'mod2.amount',
    'effects-delay-tempo': 'delay.tempo',
    'effects-delay-feedback': 'delay.feedback',
    'effects-delay-dry-wet': 'delay.dryWet',
    'effects-eq-freq': 'amp.freq',
    'effects-amp-drive': 'amp.drive',
    'effects-reverb-dry-wet': 'reverb.dryWet',
  }
  if (fx[id]) return `fx.${s.fx.focus}.${fx[id]}`
  if (id === 'performance-rotary-speed') return 'rotary.speed'
  return null
}

/** Controls whose morph LED shows an assignment. */
const MORPH_LEDS: Record<string, string> = {
  'effects-mod1-rate': 'effects-led-mod1-rate',
  'effects-mod1-amount': 'effects-led-mod1-amount',
  'effects-mod2-amount': 'effects-led-mod2-amount',
  'effects-amp-drive': 'effects-led-amp-drive',
  'effects-eq-freq': 'effects-led-eq-freq',
  'effects-delay-tempo': 'effects-led-delay-tempo',
  'effects-delay-feedback': 'effects-led-delay-feedback',
  'synth-arp-rate': 'synth-led-arp-rate',
  'synth-lfo-rate': 'synth-led-lfo-rate',
  'synth-lfo-mod-amt': 'synth-led-lfo-mod-amt',
  'synth-osc-ctrl': 'synth-led-osc-ctrl',
  'synth-filter-freq': 'synth-led-filter-freq',
  'synth-filter-res': 'synth-led-filter-res',
  'performance-rotary-speed': 'performance-led-rotary-morph',
}

/** Level faders and drawbars whose LED graph shows the morph range. */
const GRAPH_OWNERS = ['organ-level-a', 'organ-level-b', 'piano-level-a', 'piano-level-b', 'synth-level-a', 'synth-level-b', 'synth-level-c', ...Array.from({ length: 9 }, (_, i) => `organ-drawbar-${i + 1}`)]

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export class StageController {
  sound: SoundState
  location: Location = { live: false, index: 0 }
  name: string
  mode: Mode = { kind: 'play' }
  morph: MorphSource | null = null
  synthPage: SynthPage = 'wave'
  section: SectionId = 'piano'
  solo: SectionId | null = null
  message: string | null = null
  wheel = 0
  pedal = 0
  private undo: { location: Location; sound: SoundState; name: string } | null = null
  private shiftUsed = false
  private readonly tap = new TapTempo()
  private readonly clockTap = new ClockTap()
  /** Master-clock grid origin (audio seconds): restarts when the tempo changes. */
  gridOrigin = 0
  private readonly listeners = new Set<() => void>()
  private view: ControllerView | null = null
  private readonly store: HardwareStore
  private readonly bank: ProgramBank

  constructor(private readonly o: ControllerOptions) {
    this.store = o.store
    this.bank = o.bank
    const first = this.bank.get(false, 0)
    this.sound = withPerformance(first.sound, o.initial)
    this.name = first.name
  }

  // ---- binding ----

  readonly binding: ControlBinding = {
    intercept: (action) => this.intercept(action),
    observe: (id, value, delta) => this.observe(id, value, delta),
    describe: (id) => FUNCTIONAL[id],
    unsupported: (id) => UNSUPPORTED[id],
    valueText: (id) => this.valueText(id),
  }

  private get shift(): boolean {
    return SHIFTS.some((id) => this.store.get(id)?.pressed)
  }

  private ctx(): BindingContext {
    return { shift: this.shift, nowMs: this.o.nowMs() }
  }

  private intercept(action: HardwareAction): boolean {
    if (action.type === 'reset') return false
    const id = action.id
    if (SHIFTS.includes(id)) {
      if (action.type === 'press') this.shiftUsed = false
      // Shift pressed and released alone = EXIT (manual p. 13).
      if (action.type === 'release' && this.store.get(id)?.pressed && !this.shiftUsed) this.exit()
      return false
    }
    if (this.shift && action.type !== 'release') this.shiftUsed = true
    // Unsupported, but its LEDs must stay truthful: the engine is Analog only, so the button
    // presses without cycling SAMPLES/EXTERN (listed in the unsupported-controls notes).
    if (id === 'synth-mode' && action.type === 'activate') return true
    if (!isFunctional(id)) return false
    if (action.type === 'activate') {
      this.activate(id)
      return true
    }
    if ((action.type === 'step' || action.type === 'set') && ENCODERS.has(id)) {
      const cur = this.store.get(id)?.value ?? 0
      const delta = action.type === 'step' ? action.delta : Math.round(action.value - cur)
      if (delta !== 0) this.dial(id, delta)
      return true
    }
    if ((action.type === 'step' || action.type === 'set') && this.shift && SHIFT_TURN.has(id)) {
      const cur = this.store.get(id)?.value ?? 0
      const delta = action.type === 'step' ? action.delta : action.value - cur
      const next = SHIFT_TURN.has(id) && id.startsWith('synth-') ? setSectionValue(this.sound, id, cur, delta, this.sectionCtx()) : setValue(this.sound, id, cur, delta, this.ctx())
      if (next) this.edit(next, id)
      return true
    }
    if ((action.type === 'step' || action.type === 'set') && this.morph) {
      const key = morphKeyFor(this.sound, id)
      if (key) {
        const cur = this.store.get(id)?.value ?? 0
        const control = this.store.control(id)
        const max = control && 'max' in control ? control.max : 127
        const min = control && 'min' in control ? control.min : 0
        const target = clamp(Math.round(action.type === 'step' ? cur + action.delta : action.value), min, max)
        this.edit(assignMorph(this.sound, this.morph, key, target), id)
        return true
      }
    }
    return false
  }

  private observe(id: string, value: number, delta: number): void {
    if (!isFunctional(id)) return
    if (id === 'performance-mod-wheel') {
      this.setWheel(value)
      return
    }
    const next = setSectionValue(this.sound, id, value, delta, this.sectionCtx()) ?? setValue(this.sound, id, value, delta, this.ctx())
    if (next && next !== this.sound) this.edit(next, id)
  }

  private sectionCtx() {
    return { shift: this.shift, page: this.synthPage }
  }

  // ---- actions ----

  private activate(id: string): void {
    this.message = null
    if (id.startsWith('program-')) {
      this.programButton(id)
      return
    }
    if (this.morph && id === 'performance-rotary-speed') {
      // Morph assign on the speed button toggles the source's end speed: opposite of stored, or none.
      const base = this.sound.rotary.fast ? 1 : 0
      const assigned = 'rotary.speed' in this.sound.morph[this.morph]
      this.edit(assignMorph(this.sound, this.morph, 'rotary.speed', assigned ? base : 1 - base), id)
      return
    }
    if (this.shift && UNSUPPORTED_SHIFT[id]) {
      this.flash(`Shift function unsupported: ${UNSUPPORTED_SHIFT[id]}`)
      return
    }
    const section = activateSection(this.sound, id, this.sectionCtx())
    if (section) {
      if (section.page) this.synthPage = section.page
      this.edit(section.sound, id)
      return
    }
    const next = activate(this.sound, id, this.ctx(), this.tap)
    if (next) this.edit(next, id)
  }

  private dial(id: string, delta: number): void {
    this.message = null
    if (id === 'piano-model') {
      const next = setValue(this.sound, id, 0, delta, this.ctx())
      if (next) this.edit(next, id)
      return
    }
    if ((SYNTH_DIALS as readonly string[]).includes(id)) {
      const next = stepSynthDial(this.sound, id, delta, this.synthPage)
      if (next) this.edit(next, id)
      return
    }
    // Program dial.
    const d = Math.sign(delta) * Math.min(Math.abs(delta), 8)
    const mode = this.mode
    switch (mode.kind) {
      case 'store': {
        const size = mode.dest.live ? LIVE_SLOTS : PROGRAM_SLOTS
        this.chooseDestination({ live: mode.dest.live, index: (((mode.dest.index + d) % size) + size) % size })
        return
      }
      case 'name': {
        const chars = [...mode.name.padEnd(mode.cursor + 1, ' ')]
        const i = NAME_CHARS.indexOf(chars[mode.cursor])
        chars[mode.cursor] = NAME_CHARS[(((i < 0 ? 0 : i) + d) % NAME_CHARS.length + NAME_CHARS.length) % NAME_CHARS.length]
        this.mode = { ...mode, name: chars.join('').slice(0, NAME_LENGTH) }
        this.refresh()
        return
      }
      case 'clock':
        this.setBpm(this.sound.clock.bpm + d)
        return
      case 'transpose': {
        const semitones = clamp(this.sound.transpose.semitones + d, -6, 6)
        this.edit({ ...this.sound, transpose: { on: semitones !== 0, semitones } }, 'program-transpose')
        return
      }
      case 'split': {
        const point = Math.floor(mode.field / 2)
        const split = this.sound.split
        if (mode.field % 2 === 0) this.edit({ ...this.sound, split: stepSplitPoint(split, point, d) }, 'program-split')
        else {
          const x = XFADES[clamp(XFADES.indexOf(split.points[point].xfade) + Math.sign(d), 0, XFADES.length - 1)]
          const points = split.points.map((p, i) => (i === point ? { ...p, xfade: x } : p)) as SoundState['split']['points']
          this.edit({ ...this.sound, split: { ...split, points } }, 'program-split')
        }
        return
      }
      case 'play':
      case 'list': {
        if (this.shift) this.mode = { kind: 'list' }
        const size = this.location.live ? LIVE_SLOTS : PROGRAM_SLOTS
        this.load({ live: this.location.live, index: (((this.location.index + d) % size) + size) % size })
        return
      }
    }
  }

  private programButton(id: string): void {
    const shift = this.shift
    const mode = this.mode
    const slot = /^program-slot-(\d)$/.exec(id)
    if (slot) {
      const n = Number(slot[1]) - 1
      if (shift) {
        this.flash(`Shift function unsupported: ${UNSUPPORTED_SHIFT[id]}`)
        return
      }
      if (mode.kind === 'name' && n < 3) {
        this.nameEdit(n)
        return
      }
      const page = mode.kind === 'store' ? (mode.dest.live ? 0 : Math.floor(mode.dest.index / PER_PAGE)) : Math.floor(this.location.index / PER_PAGE)
      const live = mode.kind === 'store' ? mode.dest.live : this.location.live
      const loc = { live, index: live ? n : page * PER_PAGE + n }
      if (mode.kind === 'store') this.chooseDestination(loc)
      else {
        this.mode = { kind: 'play' }
        this.load(loc)
      }
      return
    }
    switch (id) {
      case 'program-page-left':
      case 'program-page-right': {
        const d = id.endsWith('right') ? 1 : -1
        if (shift) return this.flash(`Shift function unsupported: ${UNSUPPORTED_SHIFT[id]}`)
        if (mode.kind === 'name') {
          this.mode = { ...mode, cursor: clamp(mode.cursor + d, 0, Math.min(NAME_LENGTH - 1, mode.name.length)) }
          return this.refresh()
        }
        if (mode.kind === 'split') {
          this.mode = { kind: 'split', field: (mode.field + d + 6) % 6 }
          return this.refresh()
        }
        if (mode.kind === 'store') {
          if (mode.dest.live) return this.flash('Live slots have one page')
          const page = (Math.floor(mode.dest.index / PER_PAGE) + d + PAGES) % PAGES
          return this.chooseDestination({ live: false, index: page * PER_PAGE + (mode.dest.index % PER_PAGE) })
        }
        if (this.location.live) return this.flash('Live Mode: 8 slots on one page')
        const page = (Math.floor(this.location.index / PER_PAGE) + d + PAGES) % PAGES
        return this.load({ live: false, index: page * PER_PAGE + (this.location.index % PER_PAGE) })
      }
      case 'program-store':
        if (shift) {
          // Store As: naming first, then the destination step (manual p. 41).
          this.mode = { kind: 'name', name: this.name, cursor: 0 }
          return this.refresh()
        }
        if (mode.kind === 'name') return this.startStore(mode.name)
        if (mode.kind === 'store') return this.confirmStore()
        return this.startStore(this.name)
      case 'program-live-mode':
        if (mode.kind === 'store') return this.chooseDestination({ live: !mode.dest.live, index: mode.dest.live ? mode.dest.index : Math.min(mode.dest.index, LIVE_SLOTS - 1) })
        this.mode = { kind: 'play' }
        return this.load(this.location.live ? this.lastRegular : { live: true, index: this.lastLive })
      case 'program-layer-scene':
        return this.edit(switchScene(this.sound, this.sound.scenes.active === 'I' ? 'II' : 'I'), id)
      case 'program-split':
        if (shift) {
          this.mode = { kind: 'split', field: 2 }
          return this.edit({ ...this.sound, split: { ...this.sound.split, on: true } }, id)
        }
        if (mode.kind === 'split') {
          this.mode = { kind: 'play' }
          return this.refresh()
        }
        return this.edit({ ...this.sound, split: { ...this.sound.split, on: !this.sound.split.on } }, id)
      case 'program-master-clock': {
        this.mode = { kind: 'clock' }
        const bpm = this.clockTap.tap(this.o.nowMs())
        if (bpm !== null) return this.setBpm(bpm)
        return this.refresh()
      }
      case 'program-transpose': {
        if (shift) return this.panic()
        const t = this.sound.transpose
        this.mode = { kind: 'transpose' }
        return this.edit({ ...this.sound, transpose: { ...t, on: !t.on && t.semitones !== 0 } }, id)
      }
      case 'program-morph-wheel':
      case 'program-morph-ctrlped': {
        const source: MorphSource = id === 'program-morph-wheel' ? 'wheel' : 'pedal'
        if (shift) {
          if (this.morph === source) this.morph = null
          this.flash(`${source === 'wheel' ? 'Wheel' : 'Control pedal'} morphs cleared`)
          return this.edit(clearMorph(this.sound, source), id)
        }
        this.morph = this.morph === source ? null : source
        return this.refresh()
      }
      case 'program-solo':
        if (shift) return this.undoProgramChange()
        this.solo = this.solo ? null : this.section
        return this.refresh()
    }
  }

  private lastLive = 0
  private lastRegular: Location = { live: false, index: 0 }

  private nameEdit(op: number): void {
    const mode = this.mode
    if (mode.kind !== 'name') return
    const chars = [...mode.name]
    if (op === 0) chars.splice(mode.cursor, 0, ' ')
    else if (op === 1) chars.splice(mode.cursor, 1)
    else {
      const c = chars[mode.cursor] ?? ' '
      chars[mode.cursor] = c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()
    }
    this.mode = { ...mode, name: chars.join('').slice(0, NAME_LENGTH) }
    this.refresh()
  }

  /** Accessible naming (the status panel's text field edits the same buffer). */
  setPendingName(name: string): void {
    if (this.mode.kind !== 'name') return
    this.mode = { ...this.mode, name: name.slice(0, NAME_LENGTH), cursor: Math.min(name.length, NAME_LENGTH - 1) }
    this.refresh()
  }

  private startStore(name: string): void {
    this.mode = { kind: 'store', dest: { ...this.location }, name, edited: this.sound, from: { ...this.location } }
    this.refresh()
  }

  /** Pick the store destination; it becomes audible for auditioning (manual p. 13). */
  private chooseDestination(dest: Location): void {
    const mode = this.mode
    if (mode.kind !== 'store') return
    this.mode = { ...mode, dest }
    const record = this.bank.get(dest.live, dest.index)
    this.commit(withPerformance(record.sound, this.sound), 'load')
  }

  private confirmStore(): void {
    const mode = this.mode
    if (mode.kind !== 'store') return
    const name = mode.name.trim() || 'Untitled'
    this.bank.store(mode.dest.live, mode.dest.index, { name, sound: mode.edited })
    this.mode = { kind: 'play' }
    this.location = { ...mode.dest }
    this.remember()
    this.name = name
    this.undo = null
    this.flash(`Stored ${this.locationLabel(mode.dest)} ${name}`)
    this.commit(mode.edited, 'load')
  }

  /** Shift/Exit: leave the current mode; Store cancels and restores the edited program. */
  exit(): void {
    const mode = this.mode
    this.morph = null
    if (mode.kind === 'store') {
      this.mode = { kind: 'play' }
      this.location = { ...mode.from }
      this.commit(mode.edited, 'load')
      return
    }
    this.mode = { kind: 'play' }
    this.refresh()
  }

  /** Load a program or Live slot; unstored edits are discarded (manual p. 13). */
  load(loc: Location): void {
    if (this.dirty) this.undo = { location: { ...this.location }, sound: this.sound, name: this.name }
    const record = this.bank.get(loc.live, loc.index)
    this.location = { ...loc }
    this.remember()
    this.name = record.name
    this.section = this.focusSection(record.sound)
    this.commit(withPerformance(record.sound, this.sound), 'load')
  }

  /** The section a program is focused on (its effects focus), shown on the Program OLED. */
  private focusSection(s: SoundState): SectionId {
    return s.fx.focus === 'organ' ? 'organ' : PIANO_CHAINS.includes(s.fx.focus) ? 'piano' : 'synth'
  }

  private remember(): void {
    if (this.location.live) this.lastLive = this.location.index
    else this.lastRegular = { ...this.location }
  }

  private undoProgramChange(): void {
    const u = this.undo
    if (!u) return this.flash('Nothing to undo')
    this.undo = null
    this.location = { ...u.location }
    this.name = u.name
    this.flash(`Undo: back to edited ${this.locationLabel(u.location)}`)
    this.commit(u.sound, 'load')
  }

  setBpm(bpm: number): void {
    const b = clamp(Math.round(bpm), BPM_MIN, BPM_MAX)
    if (b === this.sound.clock.bpm) return this.refresh()
    this.gridOrigin = this.o.audioTime()
    this.edit({ ...this.sound, clock: { ...this.sound.clock, bpm: b } }, 'program-master-clock')
  }

  setWheel(v: number): void {
    this.wheel = clamp(v, 0, 127)
    this.refresh()
  }

  setPedal(v: number): void {
    this.pedal = clamp(v, 0, 127)
    this.refresh()
  }

  /** Panic (Shift+Transpose): all notes off and every held performance input reset (manual p. 40). */
  panic(): void {
    this.o.engine.allNotesOff()
    this.o.onPanic?.()
    this.morph = null
    if (this.mode.kind !== 'store') this.mode = { kind: 'play' }
    this.flash('PANIC: all notes off')
    this.commit({ ...this.sound, pitchStick: 0 }, 'perf')
  }

  private flash(message: string): void {
    this.message = message
    this.refresh()
  }

  // ---- commit / derived state ----

  private edit(next: SoundState, id: string): void {
    const section = sectionOfControl(id)
    if (section) this.section = section
    else if (id.startsWith('effects-')) this.section = next.fx.focus === 'organ' ? 'organ' : PIANO_CHAINS.includes(next.fx.focus) ? 'piano' : 'synth'
    this.commit(next, 'edit')
  }

  /** Apply a new canonical state. Edits in Live Mode are stored automatically. */
  commit(next: SoundState, kind: 'edit' | 'load' | 'perf'): void {
    this.sound = kind === 'edit' ? syncScene(next) : next
    if (kind === 'edit' && this.location.live && this.mode.kind !== 'store') {
      this.bank.store(true, this.location.index, { name: this.name, sound: this.sound })
    }
    this.refresh()
  }

  /** The sound the engine plays: morphs at the current wheel/pedal, and Solo. */
  get effective(): SoundState {
    const m = applyMorphs(this.sound, this.wheel, this.pedal)
    const solo = this.solo
    if (!solo) return m
    return { ...m, organ: { ...m.organ, on: m.organ.on && solo === 'organ' }, piano: { ...m.piano, on: m.piano.on && solo === 'piano' }, synth: { ...m.synth, on: m.synth.on && solo === 'synth' } }
  }

  get dirty(): boolean {
    if (this.location.live) return false
    return isEdited(this.sound, this.bank.get(false, this.location.index).sound)
  }

  get canUndo(): boolean {
    return this.undo !== null
  }

  refresh(): void {
    const eff = this.effective
    this.o.stage.apply(eff, this.wheel)
    this.o.engine.setSound(eff)
    this.store.sync(this.presentation(), this.indicators())
    this.store.syncRanges(this.ranges())
    this.store.touch([...SYNTH_DIALS, 'program-dial'])
    this.view = null
    this.listeners.forEach((l) => l())
  }

  /** Advance the arpeggiators (called by the runtime timer). */
  tick(): void {
    this.o.engine.tick(this.o.audioTime())
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot(): ControllerView {
    if (!this.view) {
      this.view = {
        sound: this.sound,
        location: this.location,
        name: this.name,
        dirty: this.dirty,
        mode: this.mode,
        morph: this.morph,
        synthPage: this.synthPage,
        section: this.section,
        solo: this.solo,
        message: this.message,
        wheel: this.wheel,
        pedal: this.pedal,
        canUndo: this.canUndo,
        programOled: this.programOled(),
        synthOled: this.synthOled(),
      }
    }
    return this.view
  }

  // ---- panel feedback ----

  private presentation(): Record<string, number> {
    const s = this.sound
    const out: Record<string, number> = { ...presentation(s), ...sectionPresentation(s, this.synthPage) }
    // Morph assign: morphable controls show the source's end value (manual p. 38).
    if (this.morph) {
      for (const id of Object.keys(out)) {
        const key = morphKeyFor(s, id)
        if (!key || id === 'performance-rotary-speed') continue
        const end = morphEnd(s, this.morph, key)
        if (end !== null) out[id] = end
      }
    }
    const loc = this.mode.kind === 'store' ? this.mode.dest : this.location
    const page = loc.live ? -1 : Math.floor(loc.index / PER_PAGE)
    for (let i = 0; i < 8; i++) {
      const selected = loc.live ? loc.index === i : page * PER_PAGE + i === loc.index
      out[`program-slot-${i + 1}`] = selected ? 1 : 0
    }
    out['program-live-mode'] = loc.live ? 1 : 0
    out['program-layer-scene'] = s.scenes.active === 'II' ? 1 : 0
    const mode = this.mode.kind
    out['program-transpose'] = (s.transpose.on && s.transpose.semitones !== 0) || mode === 'transpose' ? 1 : 0
    out['program-solo'] = this.solo ? 1 : 0
    // Mode buttons are "pressed" while their mode is active; their LEDs also flash via indicators.
    out['program-store'] = mode === 'store' || mode === 'name' ? 1 : 0
    out['program-master-clock'] = mode === 'clock' ? 1 : 0
    out['program-morph-wheel'] = this.morph === 'wheel' ? 1 : 0
    out['program-morph-ctrlped'] = this.morph === 'pedal' ? 1 : 0
    // The split button's LEDs show every active point (indicators), not one button state.
    out['program-split'] = 0
    out['program-dial'] = this.location.index
    return out
  }

  private indicators(): Record<string, Indicator> {
    const s = this.sound
    const failed = (l: 'A' | 'B') => this.o.pianoFailed?.(l, s) ?? false
    const out: Record<string, Indicator> = { ...indicators(s, failed), ...sectionIndicators(s, this.synthPage) }
    const on = (b: boolean): Indicator => (b ? 'on' : 'off')
    const mode = this.mode
    out['program-led-store'] = mode.kind === 'store' || mode.kind === 'name' ? 'flash' : 'off'
    out['program-led-master-clock'] = mode.kind === 'clock' ? 'on' : 'flash'
    const split = s.split
    split.points.forEach((p, i) => {
      const led = ['program-led-split-low', 'program-led-split-mid', 'program-led-split-high'][i]
      out[led] = mode.kind === 'split' && Math.floor(mode.field / 2) === i ? 'flash' : on(split.on && p.pos !== null)
    })
    const active = new Set(split.on ? split.points.filter((p) => p.pos !== null).map((p) => p.pos as number) : [])
    SPLIT_LEDS.forEach((led, i) => (out[led] = on(active.has(i))))
    // KB zone LEDs: the focused layer's zones while Split is on.
    for (const section of ['organ', 'piano', 'synth'] as const) {
      const layer = section === 'organ' ? s.organ.layers[s.organ.focus] : section === 'piano' ? s.piano.layers[s.piano.focus] : s.synth.layers[s.synth.focus]
      for (let z = 1; z <= 4; z++) out[`${section}-led-kb-zone-${z}`] = on(split.on && z >= layer.zone[0] && z <= layer.zone[1])
    }
    for (const [source, led] of [
      ['wheel', 'program-led-morph-wheel'],
      ['pedal', 'program-led-morph-ctrlped'],
    ] as const) {
      out[led] = this.morph === source ? 'flash' : on(Object.keys(s.morph[source]).length > 0)
    }
    for (const [id, led] of Object.entries(MORPH_LEDS)) {
      const key = morphKeyFor(s, id)
      const assigned = key ? (this.morph ? key in s.morph[this.morph] : isMorphed(s, key)) : false
      out[led] = assigned ? (this.morph ? 'flash' : 'on') : 'off'
    }
    return out
  }

  private ranges(): Record<string, MorphRange> {
    const s = this.sound
    const out: Record<string, MorphRange> = {}
    for (const id of GRAPH_OWNERS) {
      const key = morphKeyFor(s, id)
      if (!key) continue
      const dest = MORPH_DESTS.get(key)!
      const source: MorphSource | null = this.morph ?? (key in s.morph.wheel ? 'wheel' : key in s.morph.pedal ? 'pedal' : null)
      if (!source || !(key in s.morph[source])) continue
      out[id] = [dest.get(s), morphEnd(s, source, key)!]
    }
    return out
  }

  private valueText(id: string): string | undefined {
    if ((SYNTH_DIALS as readonly string[]).includes(id)) return synthDialText(this.sound, id, this.synthPage)
    if (id === 'program-dial') return `program ${this.locationLabel(this.location)} ${this.name}`
    return undefined
  }

  // ---- OLEDs ----

  locationLabel(loc: Location): string {
    return loc.live ? `Live ${loc.index + 1}` : programLocation(loc.index)
  }

  private sectionLines(): { lines: string[]; footer: string } {
    const s = this.sound
    switch (this.section) {
      case 'organ': {
        const l = s.organ.layers[s.organ.focus]
        const perc = l.model === 'b3' && l.perc.on ? ` · Perc ${l.perc.third ? '3rd' : '2nd'}` : ''
        return {
          lines: [`${ORGAN_MODEL_NAMES[l.model]} ${l.drawbars.join('')}`, `Vib ${l.vibOn ? s.organ.vibType : 'off'}${perc}${l.octave ? ` · Oct ${l.octave > 0 ? '+' : ''}${l.octave}` : ''}`],
          footer: `ORGAN ${s.organ.focus}${s.organ.on ? '' : ' · OFF'}`,
        }
      }
      case 'synth': {
        const l = s.synth.layers[s.synth.focus]
        const w = waveDef(l.wave)
        return {
          lines: [w.name, `${w.category} · ${l.filter.on ? l.filter.type : 'Filter off'} · ${l.voice.mode}${l.arp.run ? ' · Arp' : ''}`],
          footer: `SYNTH ${s.synth.focus}${s.synth.on ? '' : ' · OFF'}`,
        }
      }
      default: {
        const failed = this.o.pianoFailed?.(s.piano.focus, s) ?? false
        return { lines: pianoDisplay(s, failed), footer: `PIANO ${s.piano.focus}${s.piano.on ? '' : ' · OFF'}` }
      }
    }
  }

  programOled(): OledContent {
    const s = this.sound
    const loc = this.location
    const title = `${this.locationLabel(loc)} ${this.name}${this.dirty ? ' E' : ''}`
    const mode = this.mode
    switch (mode.kind) {
      case 'store':
        return { title: `STORE ${mode.name}`, lines: [`To ${this.locationLabel(mode.dest)}`, `now: ${this.bank.get(mode.dest.live, mode.dest.index).name}`], footer: 'STORE = confirm · EXIT = cancel' }
      case 'name': {
        const padded = mode.name.padEnd(mode.cursor + 1, ' ')
        return { title: 'STORE AS — NAME', lines: [`${padded.slice(0, mode.cursor)}[${padded[mode.cursor]}]${padded.slice(mode.cursor + 1)}`.trimEnd(), 'Dial char · ◂▸ cursor · 1 ins 2 del 3 case'], footer: 'STORE = choose destination' }
      }
      case 'list': {
        const size = loc.live ? LIVE_SLOTS : PROGRAM_SLOTS
        const rows = [-1, 0, 1].map((d) => {
          const i = (((loc.index + d) % size) + size) % size
          const r = this.bank.get(loc.live, i)
          return `${d === 0 ? '▸' : ' '} ${this.locationLabel({ live: loc.live, index: i })} ${r.name}`
        })
        return { title: `LIST ${loc.live ? 'LIVE' : '1–32'}`, lines: rows, footer: 'Dial = browse · EXIT = back' }
      }
      case 'clock':
        return { title, lines: [`${s.clock.bpm} BPM`, 'Master Clock · tap ×4 or dial'], footer: `KB sync ${s.clock.kbSync ? 'on' : 'off'}` }
      case 'transpose':
        return { title, lines: [`Transpose ${s.transpose.semitones > 0 ? '+' : ''}${s.transpose.semitones}`, s.transpose.on ? 'On' : 'Off'], footer: 'Dial ±6 · EXIT = back' }
      case 'split': {
        const parts = s.split.points.map((p, i) => `${SPLIT_POINT_NAMES[i]} ${p.pos === null ? 'Off' : `${SPLIT_POSITION_NAMES[p.pos]}${p.xfade ? ` ±${p.xfade}` : ''}`}`)
        const point = Math.floor(mode.field / 2)
        return { title: 'SPLIT', lines: [parts.join(' | '), `▸ ${SPLIT_POINT_NAMES[point]} ${mode.field % 2 === 0 ? 'note' : 'crossfade'}`], footer: '◂▸ field · dial value · SPLIT = done' }
      }
      default: {
        const sec = this.sectionLines()
        const extra = [
          this.message,
          this.morph ? `MORPH ${this.morph === 'wheel' ? 'WHEEL' : 'PEDAL'}: move controls` : null,
          this.solo ? `SOLO ${this.solo.toUpperCase()}` : null,
        ].filter(Boolean) as string[]
        const status = [s.split.on ? `Split ${activeSplitNames(s)}` : null, s.transpose.on ? `Tr ${s.transpose.semitones > 0 ? '+' : ''}${s.transpose.semitones}` : null, `Scene ${s.scenes.active}`].filter(Boolean).join(' · ')
        return { title, lines: [...sec.lines, ...extra, status], footer: sec.footer }
      }
    }
  }

  synthOled(): OledContent {
    const s = this.sound
    const l = s.synth.layers[s.synth.focus]
    const page = SYNTH_PAGES[this.synthPage]
    const env = this.synthPage === 'oscEnv' ? l.oscEnv : this.synthPage === 'filterEnv' ? l.filterEnv : this.synthPage === 'ampEnv' ? l.ampEnv : null
    const arp = l.arp.sync ? `${syncDivision(l.arp.rate).label} @ ${s.clock.bpm} BPM` : `${arpBpm(l.arp.rate)} BPM`
    return {
      title: `SYNTH ${s.synth.focus}${s.synth.on ? '' : ' OFF'} · ${page.title}`,
      lines: [waveDef(l.wave).name, ...page.dials.map((d) => `${d.label}: ${d.text(l, s)}`)],
      curve: env ? envelopeCurve(env) : undefined,
      footer: `ANALOG · ${waveDef(l.wave).category}${this.synthPage === 'arp' || l.arp.run ? ` · ARP ${l.arp.run ? 'RUN' : 'off'} ${arp}` : ''}`,
    }
  }
}

/** An ADR envelope drawn on the Synth OLED: log-scaled attack, decay (or sustain) and release. */
export function envelopeCurve(env: Envelope): [number, number][] {
  const w = (t: number) => Math.log10(1 + 1000 * t) / Math.log10(1 + 1000 * 20)
  const a = w(envAttack(env.attack)) * 0.3
  const sustain = !Number.isFinite(envDecay(env.decay))
  const d = sustain ? 0.3 : w(envDecay(env.decay)) * 0.3
  const hold = a + d
  const level = sustain ? 1 : 0.02
  const r = w(envRelease(env.release)) * 0.3
  const pts: [number, number][] = [[0, 0], [a, 1]]
  if (sustain) pts.push([hold, 1])
  else for (let i = 1; i <= 6; i++) pts.push([a + (d * i) / 6, Math.exp(-4 * (i / 6))])
  pts.push([0.7, level], [Math.min(1, 0.7 + r), 0])
  if (0.7 + r < 1) pts.push([1, 0])
  return pts
}

function activeSplitNames(s: SoundState): string {
  return s.split.points
    .filter((p) => p.pos !== null)
    .map((p) => `${SPLIT_POSITION_NAMES[p.pos as number]}${p.xfade ? `±${p.xfade}` : ''}`)
    .join('/')
}

