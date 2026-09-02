/**
 * Panel → canonical state → engine. The hardware store keeps every control's position (it is the panel); this
 * controller interprets every functional control of the deck — Piano, Organ, Synth, Program, Layer Effects,
 * Master Level, Rotary, pitch stick and mod wheel — applies focus / group / global / Shift / hold semantics, keeps the
 * program bank (Store, Store As, Live auto-store, edit-discard, Undo), splits / zones / scenes / morphs / Master Clock /
 * Transpose / Panic, and pushes the effective (morphed) program to the engine.
 *
 * Focus swaps and program loads write the shown layer's / chain's values back into the hardware store (guarded, so
 * the write-back is not mistaken for a user edit) — exactly how the real panel re-shows a layer's settings.
 * Spec-excluded controls (see IMPLEMENTATION_DETAILS.json `controls.unsupported`) are deliberately not read here.
 */
import { PIANO_TYPES, defaultModelFor, getModel, modelsOfType, stepModel, type PianoType } from './pianoModels'
import type { LayerId, PianoEngine } from './engine'
import type { Timers } from './boundaries'
import { ORGAN_MODELS, ORGAN_VIBRATO_MODES } from '../dsp/organTypes'
import { ANALOG_CATEGORIES, ANALOG_WAVEFORMS, ARP_DIRECTIONS, ARP_MODES, ARP_SUBDIVISIONS, ENV_INDEX_MAX, FILTER_DRIVE, FILTER_TRACKING, FILTER_TYPES, FM_PARTIALS, LFO_DESTINATIONS, LFO_SUBDIVISIONS, LFO_WAVEFORMS, SYNTH_LAYER_IDS, SYNTH_MODES, SYNTH_VIBRATO_MODES, SYNTH_WAVE_TYPES, VIBRATO_DELAY_TIMES, VOICE_MODES, VOICE_PRIORITIES, arpKnobToBpm, formatEnvTime, subdivisionFromKnob, type SynthLayerId, waveName } from '../dsp/synthTypes'
import { clamp, secondsToTempoKnob, tempoKnobToSeconds } from '../dsp/types'
import { getControl, type ControlSpec } from '../hardware/controls'
import { midiToName } from '../hardware/keybed'
import type { HardwareStore } from '../state/hardwareStore'
import { ALL_CHAIN_KEYS, DELAY_SUBDIVISIONS, PIANO_CHAIN_KEYS, SYNTH_CHAIN_KEYS, UNIT_KEYS, chainParamsFor, focusedChainKey, isDirty, organParamsFor, pianoSettingsFor, rotaryParamsFor, synthParamsFor, synthToRotary, targetChainKeys, withProgram, type ChainKey, type ChainSettings, type InstrumentState, type InstrumentStore, type SynthPage, type UnitKey, type ViewMode } from '../state/instrumentState'
import { morphPathFor, morphPathLabel } from '../state/morphPaths'
import { CLOCK_BPM_MAX, CLOCK_BPM_MIN, NAME_CHARS, PROGRAM_NAME_MAX, SPLIT_POINT_KEYS, SPLIT_POSITIONS, SPLIT_XFADES, TRANSPOSE_RANGE, applyMorphs, cloneProgram, getPath, morphRange, nearestSplitPosition, programOf, programsEqual, sanitizeName, slotLabel, stepZone, toggleScene, type LayerKey, type MorphSource, type ProgramState, type SplitPointKey } from '../state/programState'

export const SHIFT_LATCH_MS = 8000
export const TAP_WINDOW_MS = 2500
export const CLOCK_TAP_WINDOW_MS = 3000
export const CLOCK_TAPS_REQUIRED = 4
/** Press-and-hold time that opens a button's page (Split, MST CLK, Transpose) or arms a morph source while held. */
export const HOLD_MS = 400
const TIMBRE_OPTIONS_ACOUSTIC = 4
const ENV_DIAL_STEP = 4

const PIANO_LAYER_BUTTON: Record<string, LayerId> = { 'piano.layer-a.on': 'A', 'piano.layer-b.on': 'B' }
const PIANO_LAYER_FADER: Record<string, LayerId> = { 'piano.layer-a.level': 'A', 'piano.layer-b.level': 'B' }
const ORGAN_LAYER_BUTTON: Record<string, LayerId> = { 'organ.layer-a.on': 'A', 'organ.layer-b.on': 'B' }
const ORGAN_LAYER_FADER: Record<string, LayerId> = { 'organ.layer-a.level': 'A', 'organ.layer-b.level': 'B' }
const SYNTH_LAYER_BUTTON: Record<string, SynthLayerId> = { 'synth.layer-a.on': 'A', 'synth.layer-b.on': 'B', 'synth.layer-c.on': 'C' }
const SYNTH_LAYER_FADER: Record<string, SynthLayerId> = { 'synth.layer-a.level': 'A', 'synth.layer-b.level': 'B', 'synth.layer-c.level': 'C' }
const MORPH_BUTTON: Record<string, MorphSource> = { 'program.morph.wheel': 'wheel', 'program.morph.control-pedal': 'pedal' }
const HOLD_PAGE: Record<string, ViewMode> = { 'program.split': 'split', 'program.master-clock': 'clock', 'program.transpose': 'transpose' }
const DRAWBAR_IDS = ['organ.drawbar.16', 'organ.drawbar.5-1-3', 'organ.drawbar.8', 'organ.drawbar.4', 'organ.drawbar.2-2-3', 'organ.drawbar.2', 'organ.drawbar.1-3-5', 'organ.drawbar.1-1-3', 'organ.drawbar.1']
const SPLIT_NOTE_OPTIONS: (number | null)[] = [null, ...SPLIT_POSITIONS]

export interface ControllerDeps {
  hardware: HardwareStore
  state: InstrumentStore
  engine: PianoEngine
  timers: Timers
  /** PANIC (Shift + Transpose): releases every held input and every voice. */
  panic?: () => void
  /** Persists the bank (Store, Live auto-store). */
  saveBank?: (bank: { programs: ProgramState[]; live: ProgramState[] }) => void
}

type Updater = (s: InstrumentState) => InstrumentState

export class InstrumentController {
  private lastValues: Readonly<Record<string, number>>
  private lastPressed: Readonly<Record<string, boolean>>
  private lastActivation = 0
  private syncing = 0
  private unsubscribe: (() => void) | null = null
  private shiftTimer: unknown = null
  private holdTimers = new Map<string, unknown>()
  private holdFired = new Set<string>()
  private saveTimer: unknown = null
  private lastModelByType: Record<LayerId, Partial<Record<PianoType, string>>> = { A: {}, B: {} }
  private pushedChains: Partial<Record<ChainKey, ChainSettings>> = {}
  private pushedEffectsOn: boolean | null = null
  private pushedBpm: number | null = null
  private pushedOrgan = ''
  private pushedSynth: Record<SynthLayerId, string> = { A: '', B: '', C: '' }
  private pushedRotary = ''

  constructor(private readonly deps: ControllerDeps) {
    this.lastValues = deps.hardware.get().values
    this.lastPressed = deps.hardware.get().pressed
    this.lastActivation = deps.hardware.get().activation.seq
  }

  /** Subscribes to the panel, shows the initial state on it and pushes everything to the engine. */
  attach(): () => void {
    this.syncPanel()
    this.pushEngine(true)
    this.unsubscribe = this.deps.hardware.subscribe(() => this.onHardware())
    return () => this.detach()
  }

  detach() {
    this.unsubscribe?.()
    this.unsubscribe = null
    if (this.shiftTimer !== null) this.deps.timers.clearTimeout(this.shiftTimer)
    this.shiftTimer = null
    for (const t of this.holdTimers.values()) this.deps.timers.clearTimeout(t)
    this.holdTimers.clear()
    if (this.saveTimer !== null) {
      this.deps.timers.clearTimeout(this.saveTimer)
      this.saveTimer = null
      this.saveNow()
    }
  }

  get state(): InstrumentState {
    return this.deps.state.get()
  }

  /** Every state change goes through here: Live programs are stored automatically (manual p. 13, 44). */
  private set(updater: Updater) {
    this.deps.state.set((s) => {
      const next = updater(s)
      if (next === s) return s
      if (!next.bank.liveMode || next.view.mode === 'store') return next
      const program = programOf(next)
      if (programsEqual(program, next.bank.live[next.bank.liveSlot])) return next
      const live = next.bank.live.slice()
      live[next.bank.liveSlot] = cloneProgram(program)
      this.scheduleSave()
      return { ...next, bank: { ...next.bank, live } }
    })
  }

  private scheduleSave() {
    if (!this.deps.saveBank) return
    if (this.saveTimer !== null) this.deps.timers.clearTimeout(this.saveTimer)
    this.saveTimer = this.deps.timers.setTimeout(() => {
      this.saveTimer = null
      this.saveNow()
    }, 250)
  }

  private saveNow() {
    const { bank } = this.state
    this.deps.saveBank?.({ programs: bank.programs, live: bank.live })
  }

  /* ---------- panel diffing ---------- */

  private onHardware() {
    const hw = this.deps.hardware.get()
    const values = hw.values
    const pressed = hw.pressed
    const prevValues = this.lastValues
    const prevPressed = this.lastPressed
    const activation = hw.activation
    const prevActivation = this.lastActivation
    this.lastValues = values
    this.lastPressed = pressed
    this.lastActivation = activation.seq
    if (this.syncing > 0) return
    for (const id of Object.keys(pressed)) if (pressed[id] && !prevPressed[id]) this.onPress(id)
    for (const id of Object.keys(prevPressed)) if (prevPressed[id] && !pressed[id]) this.onRelease(id)
    if (activation.seq !== prevActivation && activation.id) this.onActivate(activation.id)
    for (const id of Object.keys(values)) if (values[id] !== prevValues[id]) this.onValue(id, values[id], prevValues[id] ?? 0)
  }

  /** Writes a control value without treating it as a user edit. */
  private write(id: string, value: number) {
    this.syncing++
    try {
      this.deps.hardware.setValue(id, value)
    } finally {
      this.syncing--
      this.lastValues = this.deps.hardware.get().values
      this.lastPressed = this.deps.hardware.get().pressed
    }
  }

  private hint(text: string | null) {
    this.set((s) => (s.view.hint === text ? s : { ...s, view: { ...s.view, hint: text } }))
  }

  /* ---------- Shift latch ---------- */

  private armShift(on: boolean) {
    if (this.shiftTimer !== null) this.deps.timers.clearTimeout(this.shiftTimer)
    this.shiftTimer = null
    this.set((s) => (s.shiftArmed === on ? s : { ...s, shiftArmed: on }))
    if (on) this.shiftTimer = this.deps.timers.setTimeout(() => this.armShift(false), SHIFT_LATCH_MS)
  }

  /** Consumes the Shift latch; returns true when the current press is a Shift function. */
  private takeShift(): boolean {
    if (!this.state.shiftArmed) return false
    this.armShift(false)
    return true
  }

  /** SHIFT / EXIT: exits an open page (cancelling a pending Store), leaves morph latch mode, or arms Shift. */
  private onShiftPress() {
    const s = this.state
    if (s.shiftArmed) return this.armShift(false)
    if (s.view.mode !== 'program') return this.exitView()
    if (s.morphArmed.latched) return this.disarmMorph()
    this.armShift(true)
  }

  /* ---------- hold gestures ---------- */

  private startHold(id: string, onHold: () => void) {
    this.holdFired.delete(id)
    const existing = this.holdTimers.get(id)
    if (existing !== undefined) this.deps.timers.clearTimeout(existing)
    this.holdTimers.set(
      id,
      this.deps.timers.setTimeout(() => {
        this.holdTimers.delete(id)
        if (!this.deps.hardware.get().pressed[id]) return
        this.holdFired.add(id)
        onHold()
      }, HOLD_MS),
    )
  }

  private cancelHold(id: string) {
    const t = this.holdTimers.get(id)
    if (t !== undefined) this.deps.timers.clearTimeout(t)
    this.holdTimers.delete(id)
  }

  /* ---------- presses and releases ---------- */

  private onPress(id: string) {
    switch (id) {
      case 'effects.shift':
      case 'program.shift':
        return this.onShiftPress()
      case 'piano.octave-down':
      case 'piano.octave-up':
        if (this.takeShift()) return this.stepZoneOf(`piano${this.state.piano.focus}` as LayerKey, id.endsWith('up') ? 1 : -1)
        return this.updatePianoLayer(this.state.piano.focus, (l) => ({ ...l, octave: clamp(l.octave + (id.endsWith('up') ? 1 : -1), -1, 1) }))
      case 'organ.octave-down':
      case 'organ.octave-up':
        if (this.takeShift()) return this.stepZoneOf(`organ${this.state.organ.focus}` as LayerKey, id.endsWith('up') ? 1 : -1)
        return this.updateOrganLayer(this.state.organ.focus, (l) => ({ ...l, octave: clamp(l.octave + (id.endsWith('up') ? 1 : -1), -1, 1) }))
      case 'synth.octave-down':
      case 'synth.octave-up':
        if (this.takeShift()) return this.stepZoneOf(`synth${this.state.synth.focus}` as LayerKey, id.endsWith('up') ? 1 : -1)
        return this.updateSynthLayer(this.state.synth.focus, (l) => ({ ...l, octave: clamp(l.octave + (id.endsWith('up') ? 1 : -1), -1, 1) }))
      case 'effects.delay.tap':
        if (this.takeShift()) return this.hint('Analog delay mode: excluded (unsupported)')
        return this.tap()
      case 'program.page-prev':
      case 'program.page-next':
        if (this.takeShift()) return this.hint('Bank ◀ ▶: one bank only (excluded)')
        return this.onPage(id.endsWith('next') ? 1 : -1)
      case 'program.master-clock':
        if (this.takeShift()) return this.hint('Pedal Tap: excluded (unsupported)')
        return this.startHold(id, () => this.openView('clock'))
      case 'program.split':
      case 'program.transpose':
        if (this.state.shiftArmed) return
        return this.startHold(id, () => this.openView(HOLD_PAGE[id]))
      case 'program.morph.wheel':
      case 'program.morph.control-pedal': {
        const source = MORPH_BUTTON[id]
        if (this.state.shiftArmed) return
        this.armMorph(source, false)
        return this.startHold(id, () => undefined)
      }
      case 'program.prog-view':
        if (this.takeShift()) return this.hint('Preset Name: excluded (preset library cut)')
        return this.hint('Prog View modes: optional, not implemented')
      case 'program.mon-copy':
        if (this.takeShift()) return this.hint('Paste: excluded (unsupported)')
        return this.hint('Monitor / Copy: excluded (unsupported)')
      case 'synth.waveform':
        if (this.takeShift()) return this.soundInit()
        return this.openSynthPage('wave')
      case 'synth.osc.pitch':
        if (this.takeShift()) return this.updateSynthLayer(this.state.synth.focus, (l) => ({ ...l, oscEnv: { ...l.oscEnv, toPitch: !l.oscEnv.toPitch } }), (l) => `Env To Pitch: ${l.oscEnv.toPitch ? 'on' : 'off'}`)
        return this.openSynthPage('pitch')
      case 'synth.osc.envelope':
        if (this.takeShift()) return this.updateSynthLayer(this.state.synth.focus, (l) => ({ ...l, oscEnv: { ...l.oscEnv, velocity: !l.oscEnv.velocity } }), (l) => `Osc Env Velocity: ${l.oscEnv.velocity ? 'on' : 'off'}`)
        return this.openSynthPage('oscEnv')
      case 'synth.filter.type':
        if (this.takeShift()) return this.hint('Filter Group: excluded (unsupported)')
        return this.openSynthPage('filterType')
      case 'synth.filter.envelope':
        if (this.takeShift()) return this.updateSynthLayer(this.state.synth.focus, (l) => ({ ...l, filterEnv: { ...l.filterEnv, velocity: !l.filterEnv.velocity } }), (l) => `Filter Env Velocity: ${l.filterEnv.velocity ? 'on' : 'off'}`)
        return this.openSynthPage('filterEnv')
      case 'synth.amp.envelope':
        if (this.takeShift()) return this.updateSynthLayer(this.state.synth.focus, (l) => ({ ...l, ampEnv: { ...l.ampEnv, velocity: (l.ampEnv.velocity + 1) % 4 } }), (l) => `Amp Velocity: ${['Off', '1', '2', '3'][l.ampEnv.velocity]}`)
        return this.openSynthPage('ampEnv')
      case 'synth.lfo.waveform':
        if (this.takeShift()) return this.hint('LFO Group: excluded (unsupported)')
        return this.openSynthPage('lfoWave')
      default:
        return
    }
  }

  private onRelease(id: string) {
    const fired = this.holdFired.has(id)
    this.cancelHold(id)
    if (id === 'program.master-clock' && !fired) return this.clockTap()
    if (id in MORPH_BUTTON && fired) this.disarmMorph()
  }

  /* ---------- full clicks (toggles / selectors / radios) ---------- */

  private onActivate(id: string) {
    if (id === 'effects.focus.organ' || id === 'effects.focus.piano' || id === 'effects.focus.synth') return this.onFocusButton(id)
    if (/^program\.button\.[1-8]$/.test(id)) return this.onProgramButton(Number(id.slice(-1)) - 1)
  }

  private onFocusButton(id: string) {
    const section = id === 'effects.focus.organ' ? 'organ' : id === 'effects.focus.piano' ? 'piano' : 'synth'
    if (this.takeShift()) {
      if (section === 'piano') this.toggleGroup('piano')
      else if (section === 'synth') this.toggleGroup('synth')
      else this.hint('All FX Off (Shift + Organ focus): undocumented, unsupported')
      this.syncPanel()
      return
    }
    const s = this.state
    if (section === 'piano' && s.effects.focus === 'piano') {
      // Pressing the lit Piano focus again toggles the focused Piano layer when both layers are on.
      if (s.piano.layers.A.on && s.piano.layers.B.on) this.focusPianoLayer(s.piano.focus === 'A' ? 'B' : 'A')
      return
    }
    if (section === 'synth' && s.effects.focus === 'synth') {
      const on = SYNTH_LAYER_IDS.filter((l) => s.synth.layers[l].on)
      if (on.length > 1) this.focusSynthLayer(on[(on.indexOf(s.synth.focus) + 1) % on.length])
      return
    }
    if (section === 'organ' && s.effects.focus === 'organ') {
      if (s.organ.layers.A.on && s.organ.layers.B.on) this.focusOrganLayer(s.organ.focus === 'A' ? 'B' : 'A')
      return
    }
    this.setEffects((e) => ({ ...e, focus: section }))
  }

  /** Program buttons: soft buttons inside a page, Live / program selection otherwise; Shift = menus (excluded). */
  private onProgramButton(n: number) {
    const s = this.state
    if (this.takeShift()) {
      this.hint(`${['System', 'Sound', 'Organize', 'Aux KB', 'Output', 'Pedal', 'MIDI', 'Extern'][n]} menu: excluded (unsupported)`)
      return this.syncProgramButtons()
    }
    switch (s.view.mode) {
      case 'split':
        if (n === 0) this.set((st) => ({ ...st, view: { ...st.view, splitRow: st.view.splitRow === 'note' ? 'xfade' : 'note' } }))
        else if (n <= 3) this.selectSplitPoint(SPLIT_POINT_KEYS[n - 1])
        return this.syncProgramButtons()
      case 'storeAs':
        if (n === 0) this.set((st) => ({ ...st, view: { ...st.view, naming: st.view.naming && { ...st.view.naming, charMode: !st.view.naming.charMode } } }))
        else if (n === 1) this.hint('Category: optional, not implemented')
        else if (n === 2) this.editName((name, cursor) => ({ name: (name.slice(0, cursor) + ' ' + name.slice(cursor)).slice(0, PROGRAM_NAME_MAX), cursor }))
        else if (n === 3) this.editName((name, cursor) => ({ name: name.slice(0, cursor) + name.slice(cursor + 1), cursor: Math.min(cursor, Math.max(0, name.length - 2)) }))
        return this.syncProgramButtons()
      case 'clock':
        if (n === 0) this.set((st) => ({ ...st, clock: { ...st.clock, kbSync: !st.clock.kbSync } }))
        return this.syncProgramButtons()
      case 'undo':
        if (n === 0) this.undoConfirm()
        return this.syncProgramButtons()
      case 'store':
        return this.storeSelect(s.view.store?.live ?? s.bank.liveMode, (s.view.store?.live ?? s.bank.liveMode) ? n : s.bank.page * 8 + n)
      case 'list':
      case 'transpose':
      case 'program':
      default:
        if (s.bank.liveMode) return this.selectLive(n)
        return this.selectSlot(s.bank.page * 8 + n)
    }
  }

  /* ---------- value changes ---------- */

  private onValue(id: string, value: number, previous: number) {
    const s = this.state
    // A hold gesture already handled this press: undo the click's toggle.
    if (this.holdFired.has(id) && (id in HOLD_PAGE || id in MORPH_BUTTON)) {
      this.holdFired.delete(id)
      return this.write(id, previous)
    }
    // Morph capture: while a source is armed, moving a morphable control defines its start → end range.
    if (s.morphArmed.source && this.captureMorph(id, value, previous)) return
    if (id.startsWith('piano.')) return this.onPianoValue(id, value, previous)
    if (id.startsWith('organ.')) return this.onOrganValue(id, value, previous)
    if (id.startsWith('synth.')) return this.onSynthValue(id, value, previous)
    if (id.startsWith('program.')) return this.onProgramValue(id, value, previous)
    if (id.startsWith('effects.')) return this.onEffectsValue(id, value, previous)
    if (id.startsWith('performance.')) return this.onPerformanceValue(id, value, previous)
  }

  /* ---------- piano ---------- */

  private onPianoValue(id: string, value: number, previous: number) {
    const s = this.state
    if (id === 'piano.on') return this.setPiano((p) => ({ ...p, on: value === 1 }))
    if (id in PIANO_LAYER_BUTTON) return this.onPianoLayerButton(PIANO_LAYER_BUTTON[id], value === 1)
    if (id in PIANO_LAYER_FADER) return this.updatePianoLayer(PIANO_LAYER_FADER[id], (l) => ({ ...l, level: value }))
    if (id === 'piano.type') {
      if (this.takeShift()) {
        this.hint('Piano Info view: excluded (unsupported)')
        return this.write(id, previous)
      }
      return this.selectType(s.piano.focus, PIANO_TYPES[Math.round(value) % PIANO_TYPES.length])
    }
    if (id === 'piano.model') return this.turnModelDial(value, previous)
    if (id === 'piano.timbre') return this.setTimbre(Math.round(value))
    if (id === 'piano.acoustics') {
      if (this.takeShift()) {
        this.hint('Pedal noise: excluded (unsupported)')
        return this.write(id, previous)
      }
      const v = Math.round(value)
      return this.updatePianoLayer(s.piano.focus, (l) => ({ ...l, softRelease: (v & 1) === 1, stringRes: (v & 2) === 2 }))
    }
    if (id === 'piano.kb-touch') return this.updatePianoLayer(s.piano.focus, (l) => ({ ...l, kbTouch: Math.round(value) }))
    if (id === 'piano.unison') return this.updatePianoLayer(s.piano.focus, (l) => ({ ...l, unison: Math.round(value) }))
    if (id === 'piano.dyn-comp') return this.updatePianoLayer(s.piano.focus, (l) => ({ ...l, dynComp: Math.round(value) }))
  }

  private setPiano(updater: (p: InstrumentState['piano']) => InstrumentState['piano']) {
    this.set((s) => ({ ...s, piano: updater(s.piano) }))
    this.pushEngine()
  }

  private updatePianoLayer(id: LayerId, updater: (l: InstrumentState['piano']['layers'][LayerId]) => InstrumentState['piano']['layers'][LayerId]) {
    this.setPiano((p) => ({ ...p, layers: { ...p.layers, [id]: updater(p.layers[id]) } }))
  }

  private onPianoLayerButton(id: LayerId, on: boolean) {
    if (this.takeShift()) {
      // SUSTPED (Shift + Layer A) / PSTICK (Shift + Layer B): section toggles; the layer itself is untouched.
      this.write(id === 'A' ? 'piano.layer-a.on' : 'piano.layer-b.on', on ? 0 : 1)
      this.setPiano((p) => (id === 'A' ? { ...p, sustped: !p.sustped } : { ...p, pstick: !p.pstick }))
      return this.hint(id === 'A' ? `Piano SUSTPED: ${this.state.piano.sustped ? 'on' : 'off'}` : `Piano PSTICK: ${this.state.piano.pstick ? 'on' : 'off'}`)
    }
    const other: LayerId = id === 'A' ? 'B' : 'A'
    this.set((s) => {
      const layers = { ...s.piano.layers, [id]: { ...s.piano.layers[id], on } }
      let focus = s.piano.focus
      if (on) focus = id
      else if (s.piano.focus === id && layers[other].on) focus = other
      return { ...s, piano: { ...s.piano, layers, focus }, effects: { ...s.effects, focus: 'piano' } }
    })
    this.pushEngine()
    this.syncPanel()
  }

  focusLayer(id: LayerId) {
    this.focusPianoLayer(id)
  }

  focusPianoLayer(id: LayerId) {
    if (this.state.piano.focus === id) return
    this.set((s) => ({ ...s, piano: { ...s.piano, focus: id } }))
    this.syncPanel()
  }

  private selectType(layer: LayerId, type: PianoType) {
    const remembered = this.lastModelByType[layer][type]
    const modelId = remembered && modelsOfType(type).some((m) => m.id === remembered) ? remembered : defaultModelFor(type).id
    this.updatePianoLayer(layer, (l) => ({ ...l, modelId }))
    this.clampTimbre(layer)
  }

  private turnModelDial(value: number, previous: number) {
    const steps = dialSteps(value, previous)
    if (steps === 0) return
    const layer = this.state.piano.focus
    let modelId = this.state.piano.layers[layer].modelId
    const direction: 1 | -1 = steps > 0 ? 1 : -1
    for (let i = 0; i < Math.abs(steps); i++) modelId = stepModel(modelId, direction).id
    this.lastModelByType[layer][getModel(modelId).type] = modelId
    this.updatePianoLayer(layer, (l) => ({ ...l, modelId }))
    this.clampTimbre(layer)
  }

  private setTimbre(value: number) {
    const layer = this.state.piano.focus
    const family = getModel(this.state.piano.layers[layer].modelId).family
    const v = family === 'acoustic' && value >= TIMBRE_OPTIONS_ACOUSTIC ? 0 : value
    if (v !== value) this.write('piano.timbre', v)
    this.updatePianoLayer(layer, (l) => ({ ...l, timbre: v }))
  }

  /** Acoustic models only have Off/Soft/Mid/Bright: a Dyno setting inherited from an electric model resets. */
  private clampTimbre(layer: LayerId) {
    const l = this.state.piano.layers[layer]
    if (getModel(l.modelId).family === 'acoustic' && l.timbre >= TIMBRE_OPTIONS_ACOUSTIC) {
      this.updatePianoLayer(layer, (x) => ({ ...x, timbre: 0 }))
      if (layer === this.state.piano.focus) this.write('piano.timbre', 0)
    }
  }

  /* ---------- organ ---------- */

  private onOrganValue(id: string, value: number, previous: number) {
    const s = this.state
    const focus = s.organ.focus
    if (id === 'organ.on') return this.setOrgan((o) => ({ ...o, on: value === 1 }))
    if (id in ORGAN_LAYER_BUTTON) return this.onOrganLayerButton(ORGAN_LAYER_BUTTON[id], value === 1)
    if (id in ORGAN_LAYER_FADER) return this.updateOrganLayer(ORGAN_LAYER_FADER[id], (l) => ({ ...l, level: value }))
    if (id === 'organ.preset') {
      if (this.takeShift()) this.hint('Drawbar Sync: excluded (physical-drawbar concept)')
      else this.hint('Preset / Drawbar Live: excluded (virtual drawbars always show live values)')
      return
    }
    if (id === 'organ.model') return this.updateOrganLayer(focus, (l) => ({ ...l, model: Math.round(value) % ORGAN_MODELS.length }), (l) => `Organ ${focus}: ${ORGAN_MODELS[l.model]}`)
    if (id === 'organ.vibrato.mode') return this.setOrgan((o) => ({ ...o, vibratoMode: Math.round(value) % ORGAN_VIBRATO_MODES.length }), (o) => `Vibrato/Chorus: ${ORGAN_VIBRATO_MODES[o.vibratoMode]}`)
    if (id === 'organ.vibrato.on') return this.toggleOrganVibrato(value === 1)
    if (id === 'organ.percussion.volume') {
      if (this.takeShift()) {
        this.write(id, previous)
        return this.setOrgan((o) => ({ ...o, percussion: { ...o.percussion, poly: !o.percussion.poly } }), (o) => `Percussion Poly: ${o.percussion.poly ? 'on' : 'off'}`)
      }
      return this.setOrgan((o) => ({ ...o, percussion: { ...o.percussion, soft: value === 1 } }), (o) => `Percussion volume: ${o.percussion.soft ? 'Soft' : 'Normal'}`)
    }
    if (id === 'organ.percussion.decay') return this.setOrgan((o) => ({ ...o, percussion: { ...o.percussion, fast: value === 1 } }), (o) => `Percussion decay: ${o.percussion.fast ? 'Fast' : 'Slow'}`)
    if (id === 'organ.percussion.harmonic') return this.setOrgan((o) => ({ ...o, percussion: { ...o.percussion, third: value === 1 } }), (o) => `Percussion harmonic: ${o.percussion.third ? 'Third' : 'Second'}`)
    if (id === 'organ.percussion.on') return this.setOrgan((o) => ({ ...o, percussion: { ...o.percussion, on: value === 1 } }), (o) => `Percussion: ${o.percussion.on ? 'on' : 'off'}`)
    const drawbar = DRAWBAR_IDS.indexOf(id)
    if (drawbar >= 0) {
      return this.updateOrganLayer(focus, (l) => {
        const drawbars = l.drawbars.slice()
        drawbars[drawbar] = clamp(Math.round(value), 0, 8)
        return { ...l, drawbars }
      }, (l) => `Organ ${focus} drawbar ${drawbar + 1}: ${l.drawbars[drawbar]}`)
    }
  }

  private setOrgan(updater: (o: InstrumentState['organ']) => InstrumentState['organ'], hint?: (o: InstrumentState['organ']) => string) {
    this.set((s) => ({ ...s, organ: updater(s.organ) }))
    if (hint) this.hint(hint(this.state.organ))
    this.pushEngine()
  }

  private updateOrganLayer(id: LayerId, updater: (l: InstrumentState['organ']['layers'][LayerId]) => InstrumentState['organ']['layers'][LayerId], hint?: (l: InstrumentState['organ']['layers'][LayerId]) => string) {
    this.setOrgan((o) => ({ ...o, layers: { ...o.layers, [id]: updater(o.layers[id]) } }), hint ? (o) => hint(o.layers[id]) : undefined)
  }

  private onOrganLayerButton(id: LayerId, on: boolean) {
    if (this.takeShift()) {
      // SUSTPED (Shift + Layer A) / PSTICK (Shift + Layer B) for the focused organ layer (manual p. 18).
      this.write(id === 'A' ? 'organ.layer-a.on' : 'organ.layer-b.on', on ? 0 : 1)
      const focus = this.state.organ.focus
      this.updateOrganLayer(focus, (l) => (id === 'A' ? { ...l, sustped: !l.sustped } : { ...l, pstick: !l.pstick }), (l) => (id === 'A' ? `Organ ${focus} SUSTPED: ${l.sustped ? 'on' : 'off'}` : `Organ ${focus} PSTICK: ${l.pstick ? 'on' : 'off'}`))
      return
    }
    const other: LayerId = id === 'A' ? 'B' : 'A'
    this.set((s) => {
      const layers = { ...s.organ.layers, [id]: { ...s.organ.layers[id], on } }
      let focus = s.organ.focus
      if (on) focus = id
      else if (s.organ.focus === id && layers[other].on) focus = other
      return { ...s, organ: { ...s.organ, layers, focus }, effects: { ...s.effects, focus: 'organ' } }
    })
    this.pushEngine()
    this.syncPanel()
  }

  focusOrganLayer(id: LayerId) {
    if (this.state.organ.focus === id) return
    this.set((s) => ({ ...s, organ: { ...s.organ, focus: id } }))
    this.syncPanel()
  }

  /** Vibrato on/off is per layer for B3 / Pipe and shared by both layers for Vox / Farf (manual p. 20–21). */
  private toggleOrganVibrato(on: boolean) {
    const s = this.state
    const focus = s.organ.focus
    const transistor = (m: number) => m === 1 || m === 2
    this.setOrgan((o) => {
      const layers = { ...o.layers, [focus]: { ...o.layers[focus], vibrato: on } }
      const other: LayerId = focus === 'A' ? 'B' : 'A'
      if (transistor(o.layers[focus].model) && transistor(o.layers[other].model)) layers[other] = { ...layers[other], vibrato: on }
      return { ...o, layers }
    }, () => `Organ ${focus} vibrato/chorus: ${on ? 'on' : 'off'}`)
  }

  /* ---------- synth ---------- */

  private onSynthValue(id: string, value: number, previous: number) {
    const s = this.state
    const focus = s.synth.focus
    if (id === 'synth.on') return this.setSynth((y) => ({ ...y, on: value === 1 }))
    if (id in SYNTH_LAYER_BUTTON) return this.onSynthLayerButton(SYNTH_LAYER_BUTTON[id], value === 1)
    if (id in SYNTH_LAYER_FADER) return this.updateSynthLayer(SYNTH_LAYER_FADER[id], (l) => ({ ...l, level: value }))
    if (id === 'synth.kb-hold') {
      if (this.takeShift()) {
        this.write(id, previous)
        return this.hint('KB Hold Exclude: excluded (unsupported)')
      }
      return this.setSynth((y) => ({ ...y, kbHold: value === 1 }), (y) => `KB Hold: ${y.kbHold ? 'on' : 'off'}`)
    }
    if (id === 'synth.arp-run') {
      if (this.takeShift()) {
        this.write(id, previous)
        return this.updateSynthLayer(focus, (l) => ({ ...l, arp: { ...l.arp, kbSync: !l.arp.kbSync } }), (l) => `Arp KB Sync ${focus}: ${l.arp.kbSync ? 'on' : 'off'}`)
      }
      return this.updateSynthLayer(focus, (l) => ({ ...l, arp: { ...l.arp, run: value === 1 } }), (l) => `Arp Run ${focus}: ${l.arp.run ? 'on' : 'off'}`)
    }
    if (id === 'synth.dial-1' || id === 'synth.dial-2' || id === 'synth.dial-3') return this.onSynthDial(Number(id.slice(-1)), dialSteps(value, previous))
    if (id === 'synth.mode') {
      if (this.takeShift()) {
        this.write(id, previous)
        return this.hint('Extern mode: excluded (unsupported)')
      }
      const mode = Math.round(value) % SYNTH_MODES.length
      return this.updateSynthLayer(focus, (l) => ({ ...l, mode }), () => (mode === 0 ? 'Synth mode: Analog' : `Synth mode: ${SYNTH_MODES[mode]} — unsupported, Analog engine keeps sounding`))
    }
    if (id === 'synth.arp.rate') {
      if (this.takeShift()) return this.toggleSyncKnob(id, value, previous, (sync) => this.updateSynthLayer(focus, (l) => ({ ...l, arp: { ...l.arp, sync } }), (l) => `Arp MST CLK: ${l.arp.sync ? 'on' : 'off'}`))
      return this.updateSynthLayer(focus, (l) => ({ ...l, arp: { ...l.arp, rate: value } }), (l) => `Arp rate: ${l.arp.sync ? subdivisionFromKnob(ARP_SUBDIVISIONS, l.arp.rate).label : `${Math.round(arpKnobToBpm(l.arp.rate))} BPM`}`)
    }
    if (id === 'synth.arp.mode') return this.updateSynthLayer(focus, (l) => ({ ...l, arp: { ...l.arp, mode: Math.round(value) % ARP_MODES.length } }), (l) => `Arp mode: ${ARP_MODES[l.arp.mode]}`)
    if (id === 'synth.arp.range') return this.updateSynthLayer(focus, (l) => ({ ...l, arp: { ...l.arp, range: value } }), (l) => (l.arp.mode === 2 ? `Gate envelope: ${l.arp.range.toFixed(1)}` : `Arp range: ${(Math.round(l.arp.range * 3) / 3).toFixed(2)} oct`))
    if (id === 'synth.arp.menu') {
      if (this.takeShift()) {
        this.write(id, previous)
        return this.hint('Arp Group: excluded (unsupported)')
      }
      // The MENU LED shows that the arpeggiator menu is open on the Synth display.
      return this.openSynthPage(value === 1 ? 'arpMenu' : 'wave')
    }
    if (id === 'synth.voice.mode') {
      if (this.takeShift()) {
        this.write(id, previous)
        return this.updateSynthLayer(focus, (l) => ({ ...l, voice: { ...l.voice, priority: (l.voice.priority + 1) % VOICE_PRIORITIES.length } }), (l) => `Note priority: ${VOICE_PRIORITIES[l.voice.priority]}`)
      }
      return this.updateSynthLayer(focus, (l) => ({ ...l, voice: { ...l.voice, mode: Math.round(value) % VOICE_MODES.length } }), (l) => `Voice mode: ${VOICE_MODES[l.voice.mode]}`)
    }
    if (id === 'synth.voice.glide') return this.updateSynthLayer(focus, (l) => ({ ...l, voice: { ...l.voice, glide: value } }), (l) => `Glide: ${l.voice.glide.toFixed(1)}`)
    if (id === 'synth.vibrato.mode') return this.updateSynthLayer(focus, (l) => ({ ...l, vibrato: { ...l.vibrato, mode: Math.round(value) % SYNTH_VIBRATO_MODES.length } }), (l) => `Vibrato: ${SYNTH_VIBRATO_MODES[l.vibrato.mode]}${l.vibrato.mode === 4 ? ' (no aftertouch in a browser: excluded)' : ''}`)
    if (id === 'synth.vibrato.menu') return this.openSynthPage(value === 1 ? 'vibratoMenu' : 'wave')
    if (id === 'synth.lfo.mod-amount') return this.updateSynthLayer(focus, (l) => ({ ...l, lfo: { ...l.lfo, amount: value } }), (l) => `LFO amount: ${l.lfo.amount.toFixed(1)}`)
    if (id === 'synth.lfo.rate') {
      if (this.takeShift()) return this.toggleSyncKnob(id, value, previous, (sync) => this.updateSynthLayer(focus, (l) => ({ ...l, lfo: { ...l.lfo, sync } }), (l) => `LFO MST CLK: ${l.lfo.sync ? 'on' : 'off'}`))
      return this.updateSynthLayer(focus, (l) => ({ ...l, lfo: { ...l.lfo, rate: value } }), (l) => `LFO rate: ${l.lfo.sync ? subdivisionFromKnob(LFO_SUBDIVISIONS, l.lfo.rate).label : l.lfo.rate.toFixed(1)}`)
    }
    if (id === 'synth.lfo.destination') return this.updateSynthLayer(focus, (l) => ({ ...l, lfo: { ...l.lfo, destination: Math.round(value) % LFO_DESTINATIONS.length } }), (l) => `LFO destination: ${LFO_DESTINATIONS[l.lfo.destination]}`)
    if (id === 'synth.osc.ctrl') return this.updateSynthLayer(focus, (l) => ({ ...l, oscCtrl: value }), (l) => `Osc Ctrl: ${l.oscCtrl.toFixed(1)}`)
    if (id === 'synth.osc.env-amount') return this.updateSynthLayer(focus, (l) => ({ ...l, oscEnv: { ...l.oscEnv, amount: value } }), (l) => `Osc Env Amt: ${l.oscEnv.amount.toFixed(1)}`)
    if (id === 'synth.filter.env-amount') return this.updateSynthLayer(focus, (l) => ({ ...l, filter: { ...l.filter, envAmount: value } }), (l) => `Filter Env Amt: ${l.filter.envAmount.toFixed(1)}`)
    if (id === 'synth.filter.freq') return this.updateSynthLayer(focus, (l) => ({ ...l, filter: { ...l.filter, freq: value } }), (l) => `Filter Freq: ${l.filter.freq.toFixed(1)}`)
    if (id === 'synth.filter.resonance') return this.updateSynthLayer(focus, (l) => ({ ...l, filter: { ...l.filter, res: value } }), (l) => `Filter Res: ${l.filter.res.toFixed(1)}`)
    if (id === 'synth.filter.on') return this.updateSynthLayer(focus, (l) => ({ ...l, filter: { ...l.filter, on: value === 1 } }), (l) => `Filter: ${l.filter.on ? 'on' : 'off'}`)
    if (id === 'synth.unison') return this.updateSynthLayer(focus, (l) => ({ ...l, unison: Math.round(value) % 4 }), (l) => `Unison: ${['Off', '1', '2', '3'][l.unison]}`)
  }

  private setSynth(updater: (y: InstrumentState['synth']) => InstrumentState['synth'], hint?: (y: InstrumentState['synth']) => string) {
    this.set((s) => ({ ...s, synth: updater(s.synth) }))
    if (hint) this.hint(hint(this.state.synth))
    this.pushEngine()
  }

  private updateSynthLayer(id: SynthLayerId, updater: (l: InstrumentState['synth']['layers'][SynthLayerId]) => InstrumentState['synth']['layers'][SynthLayerId], hint?: (l: InstrumentState['synth']['layers'][SynthLayerId]) => string) {
    this.setSynth((y) => ({ ...y, layers: { ...y.layers, [id]: updater(y.layers[id]) } }), hint ? (y) => hint(y.layers[id]) : undefined)
  }

  private onSynthLayerButton(id: SynthLayerId, on: boolean) {
    if (this.takeShift()) {
      // SUSTPED (Shift + Layer A) for the section, PSTICK (Shift + Layer B) for the focused layer (manual p. 28).
      this.write(`synth.layer-${id.toLowerCase()}.on`, on ? 0 : 1)
      if (id === 'A') return this.setSynth((y) => ({ ...y, sustped: !y.sustped }), (y) => `Synth SUSTPED: ${y.sustped ? 'on' : 'off'}`)
      if (id === 'B') {
        const focus = this.state.synth.focus
        return this.updateSynthLayer(focus, (l) => ({ ...l, pstick: !l.pstick }), (l) => `Synth ${focus} PSTICK: ${l.pstick ? 'on' : 'off'}`)
      }
      return this.hint('Layer C Pan: excluded (unsupported)')
    }
    this.set((s) => {
      const layers = { ...s.synth.layers, [id]: { ...s.synth.layers[id], on } }
      let focus = s.synth.focus
      if (on) focus = id
      else if (s.synth.focus === id) {
        const other = SYNTH_LAYER_IDS.find((l) => layers[l].on)
        if (other) focus = other
      }
      return { ...s, synth: { ...s.synth, layers, focus }, effects: { ...s.effects, focus: 'synth' } }
    })
    this.pushEngine()
    this.syncPanel()
  }

  focusSynthLayer(id: SynthLayerId) {
    if (this.state.synth.focus === id) return
    this.set((s) => ({ ...s, synth: { ...s.synth, focus: id } }))
    this.syncPanel()
  }

  private openSynthPage(page: SynthPage) {
    this.set((s) => (s.view.synthPage === page ? s : { ...s, view: { ...s.view, synthPage: page } }))
    this.write('synth.arp.menu', page === 'arpMenu' ? 1 : 0)
    this.write('synth.vibrato.menu', page === 'vibratoMenu' ? 1 : 0)
  }

  /** SOUND INIT (Shift + Waveform): every synth parameter of the focused layer except mode and waveform (manual p. 37). */
  private soundInit() {
    const focus = this.state.synth.focus
    this.updateSynthLayer(focus, (l) => {
      const fresh = cloneProgram(this.state.bank.programs[0]).synth.layers.A
      return { ...fresh, on: l.on, level: l.level, octave: l.octave, mode: l.mode, wave: l.wave, pstick: l.pstick }
    }, () => `Sound Init: Synth ${focus} reset`)
    this.syncPanel()
  }

  /** The three dials under the Synth display edit the open page (manual p. 27, 33–37). */
  private onSynthDial(dial: number, steps: number) {
    if (steps === 0) return
    const s = this.state
    const focus = s.synth.focus
    const page = s.view.synthPage
    const step = (v: number, min: number, max: number, size = 1) => clamp(v + steps * size, min, max)
    const cycle = (v: number, n: number) => ((v + steps) % n + n) % n
    switch (page) {
      case 'wave':
        return this.updateSynthLayer(focus, (l) => {
          const w = { ...l.wave }
          if (dial === 1) w.type = cycle(w.type, SYNTH_WAVE_TYPES.length)
          else if (dial === 2) w.category = w.type === 1 ? 0 : cycle(w.category, ANALOG_CATEGORIES.length)
          else if (w.type === 1) w.partial = step(w.partial, 0, FM_PARTIALS.length - 1)
          else w.index = cycle(w.index, ANALOG_WAVEFORMS[clamp(w.category, 0, 3)].length)
          if (w.type === 1) w.category = 0
          w.index = clamp(w.index, 0, w.type === 1 ? 0 : ANALOG_WAVEFORMS[clamp(w.category, 0, 3)].length - 1)
          return { ...l, wave: w }
        }, (l) => `Waveform: ${waveName(l.wave)}`)
      case 'pitch':
        if (dial === 1) return this.updateSynthLayer(focus, (l) => ({ ...l, pitch: { ...l.pitch, coarse: step(l.pitch.coarse, -24, 24) } }), (l) => `Pitch: ${l.pitch.coarse >= 0 ? '+' : ''}${l.pitch.coarse} st`)
        if (dial === 2) return this.updateSynthLayer(focus, (l) => ({ ...l, pitch: { ...l.pitch, fine: step(l.pitch.fine, -50, 50) } }), (l) => `Fine tune: ${l.pitch.fine >= 0 ? '+' : ''}${l.pitch.fine} ct`)
        return this.hint('Sample options (Natural / No Dyn / Fast Atk): Samples mode is unsupported')
      case 'oscEnv':
      case 'filterEnv':
      case 'ampEnv': {
        const key = page === 'oscEnv' ? 'oscEnv' : page === 'filterEnv' ? 'filterEnv' : 'ampEnv'
        const field = dial === 1 ? 'attack' : dial === 2 ? 'decay' : 'release'
        return this.updateSynthLayer(focus, (l) => ({ ...l, [key]: { ...l[key], [field]: step(l[key][field], 0, ENV_INDEX_MAX, ENV_DIAL_STEP) } }), (l) => `${page === 'oscEnv' ? 'Osc' : page === 'filterEnv' ? 'Filter' : 'Amp'} env ${field}: ${formatEnvTime(l[key][field], field === 'decay')}`)
      }
      case 'filterType':
        if (dial === 1) return this.updateSynthLayer(focus, (l) => ({ ...l, filter: { ...l.filter, type: cycle(l.filter.type, FILTER_TYPES.length) } }), (l) => `Filter type: ${FILTER_TYPES[l.filter.type]}`)
        if (dial === 2) return this.updateSynthLayer(focus, (l) => ({ ...l, filter: { ...l.filter, tracking: step(l.filter.tracking, 0, FILTER_TRACKING.length - 1) } }), (l) => `KBD track: ${FILTER_TRACKING[l.filter.tracking]}`)
        return this.updateSynthLayer(focus, (l) => ({ ...l, filter: { ...l.filter, drive: step(l.filter.drive, 0, FILTER_DRIVE.length - 1) } }), (l) => `Filter drive: ${FILTER_DRIVE[l.filter.drive]}`)
      case 'lfoWave':
        if (dial === 1) return this.updateSynthLayer(focus, (l) => ({ ...l, lfo: { ...l.lfo, wave: cycle(l.lfo.wave, LFO_WAVEFORMS.length) } }), (l) => `LFO waveform: ${LFO_WAVEFORMS[l.lfo.wave]}`)
        return this.hint('LFO page: only the waveform dial is used')
      case 'arpMenu':
        if (dial === 1) return this.updateSynthLayer(focus, (l) => ({ ...l, arp: { ...l.arp, direction: cycle(l.arp.direction, ARP_DIRECTIONS.length) } }), (l) => `Arp direction: ${ARP_DIRECTIONS[l.arp.direction]}`)
        return this.hint('Zig Zag / Pattern pages: excluded (unsupported)')
      case 'vibratoMenu':
        if (dial === 1) return this.updateSynthLayer(focus, (l) => ({ ...l, vibrato: { ...l.vibrato, rate: Math.round(step(l.vibrato.rate, 2, 8, 0.1) * 10) / 10 } }), (l) => `Vibrato rate: ${l.vibrato.rate.toFixed(1)} Hz`)
        if (dial === 2) return this.updateSynthLayer(focus, (l) => ({ ...l, vibrato: { ...l.vibrato, amount: step(l.vibrato.amount, 0, 10, 0.5) } }), (l) => `Vibrato amount: ${l.vibrato.amount.toFixed(1)}`)
        return this.updateSynthLayer(focus, (l) => ({ ...l, vibrato: { ...l.vibrato, delay: step(l.vibrato.delay, 0, VIBRATO_DELAY_TIMES.length - 1) } }), (l) => `Vibrato delay: ${VIBRATO_DELAY_TIMES[l.vibrato.delay]} s`)
      default:
        return
    }
  }

  /** Shift + turning a Rate / Tempo knob clockwise enables Master Clock sync, counter-clockwise disables it (manual p. 36, 49, 51). */
  private toggleSyncKnob(id: string, value: number, previous: number, apply: (sync: boolean) => void) {
    this.write(id, previous)
    apply(value > previous)
  }

  /* ---------- program section ---------- */

  private onProgramValue(id: string, value: number, previous: number) {
    const s = this.state
    switch (id) {
      case 'program.dial':
        return this.onDial(dialSteps(value, previous))
      case 'program.split':
        if (this.takeShift()) {
          this.write(id, previous)
          this.set((st) => ({ ...st, view: { ...st.view, setKeyArmed: true } }))
          return this.hint(`Set Key: play a key to set the ${s.view.splitPoint} split point`)
        }
        return this.setSplit((sp) => ({ ...sp, on: value === 1 }), (sp) => `Split: ${sp.on ? 'on' : 'off'}`)
      case 'program.transpose':
        if (this.takeShift()) {
          this.write(id, previous)
          return this.panic()
        }
        return this.set((st) => ({ ...st, transpose: { ...st.transpose, on: value === 1 }, view: { ...st.view, hint: `Transpose: ${value === 1 ? formatTranspose(st.transpose.semitones) : 'off'}` } }))
      case 'program.store':
        // The STORE LED (the toggle's value) is lit while a Store / Store As is pending (manual p. 13).
        if (this.takeShift()) {
          this.storeAsBegin()
          return this.syncStoreLed()
        }
        this.storePress()
        return this.syncStoreLed()
      case 'program.live-mode':
        if (this.takeShift()) {
          this.write(id, previous)
          return this.hint('Num Pad mode: excluded (unsupported)')
        }
        // During a Store, LIVE MODE switches the destination between the Live slots and the bank (manual p. 40).
        if (s.view.mode === 'store' && s.view.store) return this.storeSelect(value === 1, value === 1 ? s.bank.liveSlot : s.bank.slot)
        return this.setLiveMode(value === 1)
      case 'program.layer-scene':
        if (this.takeShift()) {
          this.write(id, previous)
          return this.hint('Scene pedal: excluded (unsupported)')
        }
        return this.toggleLayerScene(value === 1)
      case 'program.morph.wheel':
      case 'program.morph.control-pedal': {
        const source = MORPH_BUTTON[id]
        if (this.takeShift()) {
          this.write(id, previous)
          return this.clearMorph(source)
        }
        if (value === 1) return this.armMorph(source, true)
        return this.disarmMorph()
      }
      case 'program.solo':
        if (this.takeShift()) {
          this.write(id, previous)
          return this.undoBegin()
        }
        return this.hint('Solo: optional, not implemented (LED is presentation only)')
      case 'program.morph.aftertouch':
        return this.hint('Aftertouch morph: excluded (browsers have no aftertouch)')
      case 'program.preset-library.organ':
      case 'program.preset-library.piano':
      case 'program.preset-library.synth':
        if (this.takeShift()) return this.hint('Single Layer preset: excluded (preset library cut)')
        return this.hint('Preset Library: excluded (cut benchmark-wide)')
      case 'program.section-edit':
        if (this.takeShift()) return this.hint('Layer Init: excluded (unsupported)')
        return this.hint('Section Edit: excluded (unsupported)')
      default:
        return
    }
  }

  /** The Program dial: browse programs, or edit the value of the open page (manual p. 41). */
  private onDial(steps: number) {
    if (steps === 0) return
    const s = this.state
    const direction: 1 | -1 = steps > 0 ? 1 : -1
    const count = Math.abs(steps)
    switch (s.view.mode) {
      case 'program':
        if (this.takeShift()) return this.openView('list')
        if (s.bank.liveMode) return this.selectLive(clamp(s.bank.liveSlot + steps, 0, 7))
        return this.selectSlot(clamp(s.bank.slot + steps, 0, 31))
      case 'list': {
        const index = clamp(s.view.listIndex + steps, 0, 31)
        this.set((st) => ({ ...st, view: { ...st.view, listIndex: index } }))
        return this.selectSlot(index)
      }
      case 'store': {
        const dest = s.view.store!
        if (dest.live) return this.storeSelect(true, clamp(dest.slot + steps, 0, 7))
        return this.storeSelect(false, clamp(dest.slot + steps, 0, 31))
      }
      case 'storeAs':
        return this.editName((name, cursor, charMode) => {
          if (!charMode) return { name, cursor: clamp(cursor + steps, 0, Math.max(0, name.length - 1)) }
          const chars = name.length ? name : ' '
          const current = NAME_CHARS.indexOf(chars[cursor] ?? ' ')
          const next = NAME_CHARS[(((current < 0 ? 0 : current) + steps) % NAME_CHARS.length + NAME_CHARS.length) % NAME_CHARS.length]
          return { name: chars.slice(0, cursor) + next + chars.slice(cursor + 1), cursor }
        })
      case 'split':
        return this.editSplitValue(steps)
      case 'clock':
        return this.setBpm(s.clock.bpm + steps)
      case 'transpose':
        for (let i = 0; i < count; i++) this.set((st) => ({ ...st, transpose: { on: true, semitones: clamp(st.transpose.semitones + direction, -TRANSPOSE_RANGE, TRANSPOSE_RANGE) } }))
        this.hint(`Transpose: ${formatTranspose(this.state.transpose.semitones)}`)
        return this.syncPanel()
      default:
        return
    }
  }

  private onPage(direction: 1 | -1) {
    const s = this.state
    if (s.view.mode === 'storeAs') return this.editName((name, cursor) => ({ name, cursor: clamp(cursor + direction, 0, Math.max(0, name.length - 1)) }))
    if (s.view.mode === 'store' && s.view.store && !s.view.store.live) return this.storeSelect(false, clamp(s.view.store.slot + direction * 8, 0, 31))
    if (s.view.mode === 'list') return this.onDial(direction * 8)
    if (s.bank.liveMode) return this.hint('Live programs have no pages')
    const page = clamp(s.bank.page + direction, 0, 3)
    if (page === s.bank.page) return
    // Changing the page loads the program with the same button number on the new page (manual p. 41).
    this.selectSlot(page * 8 + (s.bank.slot % 8))
  }

  private openView(mode: ViewMode) {
    this.set((s) => ({ ...s, view: { ...s.view, mode, listIndex: s.bank.slot } }))
    this.syncProgramButtons()
  }

  /** Shift/Exit: closes the open page; a pending Store is cancelled and the edited program restored. */
  exitView() {
    const s = this.state
    if (s.view.mode === 'store' && s.view.pending) {
      const pending = s.view.pending
      const origin = s.view.storeOrigin!
      this.set((st) => ({ ...withProgram(st, pending), bank: { ...st.bank, liveMode: origin.live, slot: origin.live ? st.bank.slot : origin.slot, liveSlot: origin.live ? origin.slot : st.bank.liveSlot, page: origin.live ? st.bank.page : Math.floor(origin.slot / 8) }, view: { ...st.view, mode: 'program', pending: null, storeOrigin: null, store: null, naming: null, hint: 'Store cancelled' } }))
      this.syncPanel()
      this.pushEngine()
      return
    }
    this.set((st) => ({ ...st, view: { ...st.view, mode: 'program', naming: null, store: null, pending: null, storeOrigin: null, setKeyArmed: false } }))
    this.syncStoreLed()
    this.syncProgramButtons()
  }

  /* ---------- programs: select, store, live, undo ---------- */

  /** Loads a bank program, discarding unstored edits (manual p. 13); the discarded program is kept for Undo. */
  selectSlot(slot: number) {
    const s = this.state
    const target = clamp(slot, 0, 31)
    const dirty = isDirty(s)
    const undo = dirty && !s.bank.liveMode ? { program: programOf(s), slot: s.bank.slot, live: false } : s.undo
    this.set((st) => ({ ...withProgram(st, st.bank.programs[target]), bank: { ...st.bank, slot: target, liveMode: false, page: Math.floor(target / 8) }, undo, view: { ...st.view, listIndex: target, hint: null } }))
    this.afterProgramLoad()
  }

  selectLive(slot: number) {
    const target = clamp(slot, 0, 7)
    this.set((st) => ({ ...withProgram(st, st.bank.live[target]), bank: { ...st.bank, liveSlot: target, liveMode: true }, view: { ...st.view, hint: null } }))
    this.afterProgramLoad()
  }

  private setLiveMode(on: boolean) {
    const s = this.state
    if (on === s.bank.liveMode) return
    if (on) return this.selectLive(s.bank.liveSlot)
    // Leaving Live mode returns to the bank program (its edits are auto-stored already).
    this.set((st) => ({ ...withProgram(st, st.bank.programs[st.bank.slot]), bank: { ...st.bank, liveMode: false }, view: { ...st.view, hint: null } }))
    this.afterProgramLoad()
  }

  private afterProgramLoad() {
    this.set((st) => ({ ...st, morphArmed: { source: null, latched: false }, view: { ...st.view, setKeyArmed: false } }))
    this.syncPanel()
    this.pushEngine(true)
  }

  /** STORE: first press opens the destination page (auditioning it), second press confirms (manual p. 13, 40). */
  private storePress() {
    const s = this.state
    if (s.view.mode === 'store') return this.storeConfirm()
    if (s.view.mode === 'storeAs') {
      const name = sanitizeName(s.view.naming?.name ?? s.name)
      return this.storeBegin({ ...programOf(s), name })
    }
    this.storeBegin(programOf(s))
  }

  private storeBegin(pending: ProgramState) {
    const s = this.state
    const origin = { live: s.bank.liveMode, slot: s.bank.liveMode ? s.bank.liveSlot : s.bank.slot }
    this.set((st) => ({ ...st, view: { ...st.view, mode: 'store', pending: cloneProgram(pending), storeOrigin: origin, store: { ...origin }, naming: null, hint: null } }))
    this.syncProgramButtons()
  }

  /** Store As (Shift + Store): name the program first, then choose the destination (manual p. 41). */
  private storeAsBegin() {
    if (this.state.view.mode === 'store') return
    this.set((st) => ({ ...st, view: { ...st.view, mode: 'storeAs', naming: { name: st.name, cursor: 0, charMode: false }, hint: null } }))
    this.syncProgramButtons()
  }

  private editName(edit: (name: string, cursor: number, charMode: boolean) => { name: string; cursor: number }) {
    this.set((st) => {
      if (!st.view.naming) return st
      const { name, cursor } = edit(st.view.naming.name, st.view.naming.cursor, st.view.naming.charMode)
      return { ...st, view: { ...st.view, naming: { ...st.view.naming, name: name.slice(0, PROGRAM_NAME_MAX), cursor: clamp(cursor, 0, Math.max(0, Math.min(name.length, PROGRAM_NAME_MAX) - 1)) } } }
    })
  }

  /** Selecting a destination makes that stored program audible for auditioning (manual p. 13, 40). */
  private storeSelect(live: boolean, slot: number) {
    this.set((st) => {
      const program = live ? st.bank.live[slot] : st.bank.programs[slot]
      return { ...withProgram(st, program), bank: { ...st.bank, liveMode: live, slot: live ? st.bank.slot : slot, liveSlot: live ? slot : st.bank.liveSlot, page: live ? st.bank.page : Math.floor(slot / 8) }, view: { ...st.view, store: { live, slot } } }
    })
    this.syncPanel()
    this.pushEngine(true)
  }

  private storeConfirm() {
    const s = this.state
    const dest = s.view.store
    const pending = s.view.pending
    if (!dest || !pending) return this.exitView()
    this.set((st) => {
      const programs = st.bank.programs.slice()
      const live = st.bank.live.slice()
      const stored = cloneProgram(pending)
      if (dest.live) live[dest.slot] = stored
      else programs[dest.slot] = stored
      return { ...withProgram(st, stored), bank: { ...st.bank, programs, live, liveMode: dest.live, slot: dest.live ? st.bank.slot : dest.slot, liveSlot: dest.live ? dest.slot : st.bank.liveSlot, page: dest.live ? st.bank.page : Math.floor(dest.slot / 8) }, undo: null, view: { ...st.view, mode: 'program', pending: null, storeOrigin: null, store: null, naming: null, hint: `Stored to ${slotLabel(dest.slot, dest.live)} ${stored.name}` } }
    })
    this.saveNow()
    this.syncPanel()
    this.pushEngine(true)
  }

  /** UNDO (Shift + Solo): offers to restore the program discarded by the last program change (manual p. 42). */
  private undoBegin() {
    if (!this.state.undo) return this.hint('Undo: nothing to undo')
    this.openView('undo')
  }

  private undoConfirm() {
    const u = this.state.undo
    if (!u) return this.exitView()
    this.set((st) => ({ ...withProgram(st, u.program), bank: { ...st.bank, liveMode: u.live, slot: u.live ? st.bank.slot : u.slot, liveSlot: u.live ? u.slot : st.bank.liveSlot, page: u.live ? st.bank.page : Math.floor(u.slot / 8) }, undo: null, view: { ...st.view, mode: 'program', hint: 'Undo: edited program restored' } }))
    this.afterProgramLoad()
  }

  /* ---------- live mode, scenes ---------- */

  /** LAYER SCENE II toggles between the two enable configurations; sounds are shared (manual p. 43). */
  private toggleLayerScene(toII: boolean) {
    const s = this.state
    if ((s.scenes.active === 'II') === toII) return
    this.set((st) => ({ ...st, ...toggleScene(programOf(st)), view: { ...st.view, hint: `Layer Scene ${toII ? 'II' : 'I'}` } }))
    this.syncPanel()
    this.pushEngine()
  }

  /* ---------- split, zones ---------- */

  private setSplit(updater: (sp: InstrumentState['split']) => InstrumentState['split'], hint?: (sp: InstrumentState['split']) => string) {
    this.set((s) => ({ ...s, split: updater(s.split) }))
    if (hint) this.hint(hint(this.state.split))
    this.syncPanel()
  }

  private selectSplitPoint(key: SplitPointKey) {
    const s = this.state
    if (s.view.splitPoint === key) {
      // Pressing the selected point's soft button again toggles it Off / On (manual p. 39).
      const point = s.split.points[key]
      const fallback = key === 'low' ? 48 : key === 'mid' ? 60 : 72
      return this.setSplit((sp) => ({ ...sp, points: { ...sp.points, [key]: { ...point, note: point.note === null ? this.orderedNote(key, fallback) : null } } }), (sp) => `${key} split: ${describeSplitPoint(sp.points[key])}`)
    }
    this.set((st) => ({ ...st, view: { ...st.view, splitPoint: key } }))
  }

  /** Keeps Low ≤ Mid ≤ High among the enabled points. */
  private orderedNote(key: SplitPointKey, note: number): number {
    const p = this.state.split.points
    let n = note
    if (key !== 'low' && p.low.note !== null) n = Math.max(n, p.low.note)
    if (key === 'high' && p.mid.note !== null) n = Math.max(n, p.mid.note)
    if (key !== 'high' && p.high.note !== null) n = Math.min(n, p.high.note)
    if (key === 'low' && p.mid.note !== null) n = Math.min(n, p.mid.note)
    return n
  }

  private editSplitValue(steps: number) {
    const s = this.state
    const key = s.view.splitPoint
    if (s.view.splitRow === 'xfade') {
      return this.setSplit((sp) => {
        const i = clamp(SPLIT_XFADES.indexOf(sp.points[key].xfade) + steps, 0, SPLIT_XFADES.length - 1)
        return { ...sp, points: { ...sp.points, [key]: { ...sp.points[key], xfade: SPLIT_XFADES[i] } } }
      }, (sp) => `${key} xFade: ${describeXfade(sp.points[key].xfade)}`)
    }
    return this.setSplit((sp) => {
      const i = clamp(SPLIT_NOTE_OPTIONS.indexOf(sp.points[key].note) + steps, 0, SPLIT_NOTE_OPTIONS.length - 1)
      const note = SPLIT_NOTE_OPTIONS[i]
      return { ...sp, points: { ...sp.points, [key]: { ...sp.points[key], note: note === null ? null : this.orderedNote(key, note) } } }
    }, (sp) => `${key} split: ${describeSplitPoint(sp.points[key])}`)
  }

  /** SET KEY: a played key sets the selected split point to the nearest documented position. Returns true when consumed. */
  onKey(midi: number): boolean {
    const s = this.state
    if (!s.view.setKeyArmed) return false
    const key = s.view.splitPoint
    const note = this.orderedNote(key, nearestSplitPosition(midi))
    this.set((st) => ({ ...st, split: { ...st.split, on: true, points: { ...st.split.points, [key]: { ...st.split.points[key], note } } }, view: { ...st.view, setKeyArmed: false, hint: `${key} split set to ${midiToName(note)}` } }))
    this.syncPanel()
    return true
  }

  private stepZoneOf(layer: LayerKey, direction: 1 | -1) {
    this.set((s) => ({ ...s, zones: { ...s.zones, [layer]: stepZone(s.zones[layer], direction) } }))
    const z = this.state.zones[layer]
    this.hint(`KB Zone ${layer}: ${z.from === 1 && z.to === 4 ? 'whole keyboard' : `zones ${z.from}–${z.to}`}`)
  }

  /* ---------- morph ---------- */

  private armMorph(source: MorphSource, latched: boolean) {
    this.set((s) => ({ ...s, morphArmed: { source, latched }, view: { ...s.view, hint: `Morph ${source === 'wheel' ? 'WHEEL' : 'CTRLPED'}: move a control from start to end${latched ? ' (latched, Exit leaves)' : ''}` } }))
  }

  private disarmMorph() {
    if (!this.state.morphArmed.source) return
    this.set((s) => ({ ...s, morphArmed: { source: null, latched: false } }))
    this.write('program.morph.wheel', 0)
    this.write('program.morph.control-pedal', 0)
    this.syncPanel()
    this.hint(null)
  }

  /** Records `control moved from its stored value to `value`` as the armed source's assignment (manual p. 38–39). */
  private captureMorph(id: string, value: number, _previous: number): boolean {
    const s = this.state
    const source = s.morphArmed.source!
    const path = morphPathFor(id, s)
    if (!path) return false
    const start = getPath(programOf(s), path)
    if (typeof start !== 'number') return false
    const { min, max } = morphRange(path)
    const end = clamp(value, min, max)
    this.set((st) => {
      const list = st.morph[source].filter((a) => a.path !== path)
      if (Math.abs(end - start) > 1e-9) list.push({ path, start, end })
      return { ...st, morph: { ...st.morph, [source]: list } }
    })
    this.hint(Math.abs(end - start) > 1e-9 ? `Morph ${source}: ${morphPathLabel(path)} ${fmt(start)} → ${fmt(end)}` : `Morph ${source}: ${morphPathLabel(path)} cleared`)
    this.pushEngine()
    return true
  }

  /** Shift + a morph source button clears every assignment of that source (manual p. 39). */
  private clearMorph(source: MorphSource) {
    this.set((s) => ({ ...s, morph: { ...s.morph, [source]: [] }, morphArmed: { source: null, latched: false } }))
    this.hint(`Morph ${source}: all assignments cleared`)
    this.syncPanel()
    this.pushEngine()
  }

  /** The virtual on-screen Control Pedal and MIDI CC11 both drive the Control Pedal morph source. */
  setControlPedal(value: number) {
    const v = clamp(value, 0, 1)
    this.set((s) => (s.morphSources.pedal === v ? s : { ...s, morphSources: { ...s.morphSources, pedal: v } }))
    this.pushEngine()
  }

  /* ---------- master clock, transpose, panic ---------- */

  private clockTap() {
    const now = this.deps.timers.now()
    const taps = [...this.state.clockTaps.filter((t) => now - t <= CLOCK_TAP_WINDOW_MS), now].slice(-8)
    this.set((s) => ({ ...s, clockTaps: taps }))
    if (taps.length < CLOCK_TAPS_REQUIRED) return this.hint(`Tap ${CLOCK_TAPS_REQUIRED - taps.length} more for the tempo`)
    const intervals = taps.slice(1).map((t, i) => t - taps[i])
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length
    this.setBpm(Math.round(60000 / avg))
  }

  private setBpm(bpm: number) {
    const v = clamp(Math.round(bpm), CLOCK_BPM_MIN, CLOCK_BPM_MAX)
    this.set((s) => ({ ...s, clock: { ...s.clock, bpm: v }, view: { ...s.view, hint: `Master Clock: ${v} BPM` } }))
    this.pushEngine()
  }

  /** PANIC (Shift + Transpose): internal All Notes Off and a reset of the held performance inputs (manual p. 40). */
  panic() {
    this.deps.panic?.()
    this.deps.engine.allNotesOff()
    this.deps.engine.setPitchBend(0)
    this.write('performance.pitch-stick', 0)
    this.set((s) => ({ ...s, morphSources: { wheel: 0, pedal: 0 }, view: { ...s.view, hint: 'PANIC: all notes off, performance inputs reset' } }))
    this.write('performance.mod-wheel', 0)
    this.pushEngine()
  }

  /* ---------- effects ---------- */

  private onEffectsValue(id: string, value: number, previous: number) {
    if (id === 'effects.on') return this.setEffects((e) => ({ ...e, on: value === 1 }))
    if (id === 'effects.focus.organ' || id === 'effects.focus.piano' || id === 'effects.focus.synth') return // handled by onActivate
    const unit = this.unitOf(id)
    if (unit) return this.onUnitControl(unit, id, value, previous)
  }

  private unitOf(id: string): UnitKey | null {
    if (id.startsWith('effects.mod1.')) return 'mod1'
    if (id.startsWith('effects.mod2.')) return 'mod2'
    if (id.startsWith('effects.delay.')) return 'delay'
    if (id.startsWith('effects.amp.')) return 'amp'
    if (id.startsWith('effects.comp.')) return 'comp'
    if (id.startsWith('effects.reverb.')) return 'reverb'
    return null
  }

  private onUnitControl(unit: UnitKey, id: string, value: number, previous: number) {
    const field = id.split('.')[2]
    if (this.state.shiftArmed) {
      if (field === 'on' && (unit === 'delay' || unit === 'comp' || unit === 'reverb')) {
        this.takeShift()
        this.write(id, previous)
        return this.toggleGlobal(unit)
      }
      if (unit === 'comp' && field === 'amount') {
        this.takeShift()
        this.write(id, previous)
        return this.editUnit('comp', (c) => ({ ...c, fast: !c.fast }))
      }
      if (unit === 'delay' && field === 'filter') {
        this.takeShift()
        this.write(id, previous)
        return this.editUnit('delay', (d) => ({ ...d, pingPong: !d.pingPong }))
      }
      if (unit === 'delay' && field === 'tempo') {
        this.takeShift()
        return this.toggleSyncKnob(id, value, previous, (sync) => {
          this.editUnit('delay', (d) => ({ ...d, sync }))
          this.hint(`Delay MST CLK: ${sync ? 'on' : 'off'}`)
        })
      }
      if (unit === 'mod1' && field === 'rate') {
        this.takeShift()
        return this.toggleSyncKnob(id, value, previous, (sync) => {
          this.editUnit('mod1', (m) => ({ ...m, sync }))
          this.hint(`Mod 1 MST CLK: ${sync ? 'on' : 'off'}`)
        })
      }
      if (field === 'type' || field === 'model' || field === 'effect') {
        // VARIATION / CHORALE are excluded from the benchmark: the selector does not cycle under Shift.
        this.takeShift()
        this.write(id, previous)
        return this.hint('Effect Variation / Chorale: excluded (unsupported)')
      }
    }
    switch (`${unit}.${field}`) {
      case 'mod1.on':
      case 'mod2.on':
      case 'delay.on':
      case 'amp.on':
      case 'comp.on':
      case 'reverb.on':
        return this.editUnit(unit, (u) => ({ ...u, on: value === 1 }))
      case 'mod1.type':
      case 'mod2.type':
      case 'reverb.type':
        return this.editUnit(unit, (u) => ({ ...u, type: Math.round(value) }))
      case 'mod1.rate':
        return this.editUnit('mod1', (m) => ({ ...m, rate: value }), (m) => `Mod 1 rate: ${m.sync ? subdivisionFromKnob(LFO_SUBDIVISIONS, m.rate).label : m.rate.toFixed(1)}`)
      case 'mod2.rate':
        return this.editUnit('mod2', (u) => ({ ...u, rate: value }))
      case 'mod1.amount':
      case 'mod2.amount':
      case 'comp.amount':
        return this.editUnit(unit, (u) => ({ ...u, amount: value }))
      case 'delay.tempo':
        return this.editUnit('delay', (d) => ({ ...d, tempo: value, seconds: tempoKnobToSeconds(value) }), (d) => `Delay tempo: ${d.sync ? subdivisionFromKnob(DELAY_SUBDIVISIONS, d.tempo).label : `${Math.round(d.seconds * 1000)} ms`}`)
      case 'delay.feedback':
        return this.editUnit('delay', (d) => ({ ...d, feedback: value }))
      case 'delay.dry-wet':
        return this.editUnit('delay', (d) => ({ ...d, dryWet: value }))
      case 'delay.filter':
        return this.editUnit('delay', (d) => ({ ...d, filter: Math.round(value) }))
      case 'delay.effect':
        return this.hint('Delay feedback effects (Chor/Vibe/Ens/Flam/Space): excluded (unsupported)')
      case 'amp.model':
        return this.editUnit('amp', (a) => ({ ...a, model: Math.round(value) }))
      case 'amp.drive':
        return this.editUnit('amp', (a) => ({ ...a, drive: value }))
      case 'amp.bass':
        return this.editUnit('amp', (a) => ({ ...a, bass: value }))
      case 'amp.mid':
        return this.editUnit('amp', (a) => ({ ...a, mid: value }))
      case 'amp.freq':
        return this.editUnit('amp', (a) => ({ ...a, midFreq: value }))
      case 'amp.treble':
        return this.editUnit('amp', (a) => ({ ...a, treble: value }))
      case 'reverb.dry-wet':
        return this.editUnit('reverb', (r) => ({ ...r, dryWet: value }))
      case 'reverb.tone':
        return this.editUnit('reverb', (r) => ({ ...r, tone: Math.round(value) }))
      default:
        return
    }
  }

  private setEffects(updater: (e: InstrumentState['effects']) => InstrumentState['effects']) {
    this.set((s) => ({ ...s, effects: updater(s.effects) }))
    this.syncPanel()
    this.pushEngine()
  }

  private editUnit<K extends UnitKey>(unit: K, updater: (u: ChainSettings[K]) => ChainSettings[K], hint?: (u: ChainSettings[K]) => string) {
    const targets = targetChainKeys(this.state, unit)
    this.set((s) => {
      const chains = { ...s.effects.chains }
      for (const key of targets) chains[key] = { ...chains[key], [unit]: updater(chains[key][unit]) }
      return { ...s, effects: { ...s.effects, chains } }
    })
    if (hint) this.hint(hint(this.state.effects.chains[targets[0]][unit]))
    this.pushEngine()
  }

  private toggleGroup(section: 'piano' | 'synth') {
    this.set((s) => {
      const chains = { ...s.effects.chains }
      if (section === 'piano') {
        const group = !s.effects.pianoGroup
        if (group) {
          // Entering Group mode applies the focused layer's settings to both Piano layers (manual p. 48).
          const src = chains[PIANO_CHAIN_KEYS[s.piano.focus]]
          chains.pianoA = { ...src }
          chains.pianoB = { ...src }
        }
        return { ...s, effects: { ...s.effects, pianoGroup: group, chains } }
      }
      const group = !s.effects.synthGroup
      if (group) {
        const src = chains[SYNTH_CHAIN_KEYS[s.synth.focus]]
        chains.synthA = { ...src }
        chains.synthB = { ...src }
        chains.synthC = { ...src }
      }
      return { ...s, effects: { ...s.effects, synthGroup: group, chains } }
    })
    this.pushEngine()
  }

  private toggleGlobal(unit: 'delay' | 'comp' | 'reverb') {
    this.set((s) => {
      const on = !s.effects.global[unit]
      const chains = { ...s.effects.chains }
      if (on) {
        // Global mode applies the focused chain's unit settings to every chain of every section.
        const src = chains[focusedChainKey(s)][unit]
        for (const key of ALL_CHAIN_KEYS) chains[key] = { ...chains[key], [unit]: { ...src } }
      }
      return { ...s, effects: { ...s.effects, global: { ...s.effects.global, [unit]: on }, chains } }
    })
    this.syncPanel()
    this.pushEngine()
  }

  private tap() {
    const now = this.deps.timers.now()
    const taps = [...this.state.delayTaps.filter((t) => now - t <= TAP_WINDOW_MS), now]
    this.set((s) => ({ ...s, delayTaps: taps }))
    if (taps.length < 2) return
    const intervals = taps.slice(1).map((t, i) => (t - taps[i]) / 1000)
    const seconds = Math.min(1.5, Math.max(0.02, intervals.reduce((a, b) => a + b, 0) / intervals.length))
    const tempo = secondsToTempoKnob(seconds)
    this.editUnit('delay', (d) => ({ ...d, seconds, tempo, sync: false }))
    this.write('effects.delay.tempo', Math.round(tempo * 10) / 10)
  }

  /* ---------- performance ---------- */

  private onPerformanceValue(id: string, value: number, previous: number) {
    switch (id) {
      case 'performance.master-level':
        this.set((st) => ({ ...st, master: { level: value } }))
        return this.deps.engine.setMasterLevel(value)
      case 'performance.rotary.speed':
        return this.setRotary((r) => ({ ...r, speed: Math.round(value) === 1 ? 1 : 0 }), (r) => `Rotary: ${r.stop && r.speed < 0.5 ? 'Stop' : r.speed >= 0.5 ? 'Fast' : 'Slow'}`)
      case 'performance.rotary.drive':
        return this.setRotary((r) => ({ ...r, drive: value }))
      case 'performance.rotary.organ':
        if (this.takeShift()) {
          this.write(id, previous)
          return this.hint('Rotary Close Mic: excluded (unsupported)')
        }
        return this.setRotary((r) => ({ ...r, organ: value === 1 }), (r) => `Organ → Rotary: ${r.organ ? 'on' : 'off'}`)
      case 'performance.rotary.stop-mode':
        if (this.takeShift()) {
          this.write(id, previous)
          return this.hint('Rotary Stop Angle: excluded (unsupported)')
        }
        return this.setRotary((r) => ({ ...r, stop: value === 1 }), (r) => `Rotary Stop Mode: ${r.stop ? 'on' : 'off'}`)
      case 'performance.pitch-stick':
        return this.deps.engine.setPitchBend(value)
      case 'performance.mod-wheel':
        this.set((st) => ({ ...st, morphSources: { ...st.morphSources, wheel: clamp(value, 0, 1) } }))
        return this.pushEngine()
      default:
        return
    }
  }

  private setRotary(updater: (r: InstrumentState['rotary']) => InstrumentState['rotary'], hint?: (r: InstrumentState['rotary']) => string) {
    this.set((s) => ({ ...s, rotary: updater(s.rotary) }))
    if (hint) this.hint(hint(this.state.rotary))
    this.pushEngine()
  }

  /* ---------- panel write-back ---------- */

  private syncStoreLed() {
    const mode = this.state.view.mode
    this.write('program.store', mode === 'store' || mode === 'storeAs' ? 1 : 0)
  }

  private syncProgramButtons() {
    const s = this.state
    const lit = s.view.mode === 'store' && s.view.store ? (s.view.store.live ? s.view.store.slot : s.view.store.slot % 8) : s.bank.liveMode ? s.bank.liveSlot : s.bank.slot % 8
    for (let n = 1; n <= 8; n++) this.write(`program.button.${n}`, n - 1 === lit ? 1 : 0)
  }

  /** Shows the focused layers, chain, program and performance state on the panel. */
  syncPanel() {
    const s = this.state
    // Piano
    const layer = s.piano.layers[s.piano.focus]
    const model = getModel(layer.modelId)
    this.write('piano.type', PIANO_TYPES.indexOf(model.type))
    this.write('piano.timbre', layer.timbre)
    this.write('piano.acoustics', (layer.softRelease ? 1 : 0) | (layer.stringRes ? 2 : 0))
    this.write('piano.kb-touch', layer.kbTouch)
    this.write('piano.unison', layer.unison)
    this.write('piano.dyn-comp', layer.dynComp)
    this.write('piano.layer-a.on', s.piano.layers.A.on ? 1 : 0)
    this.write('piano.layer-b.on', s.piano.layers.B.on ? 1 : 0)
    this.write('piano.layer-a.level', s.piano.layers.A.level)
    this.write('piano.layer-b.level', s.piano.layers.B.level)
    this.write('piano.on', s.piano.on ? 1 : 0)
    // Organ
    const organ = s.organ.layers[s.organ.focus]
    this.write('organ.on', s.organ.on ? 1 : 0)
    this.write('organ.layer-a.on', s.organ.layers.A.on ? 1 : 0)
    this.write('organ.layer-b.on', s.organ.layers.B.on ? 1 : 0)
    this.write('organ.layer-a.level', s.organ.layers.A.level)
    this.write('organ.layer-b.level', s.organ.layers.B.level)
    this.write('organ.model', organ.model)
    this.write('organ.vibrato.mode', s.organ.vibratoMode)
    this.write('organ.vibrato.on', organ.vibrato ? 1 : 0)
    this.write('organ.percussion.volume', s.organ.percussion.soft ? 1 : 0)
    this.write('organ.percussion.decay', s.organ.percussion.fast ? 1 : 0)
    this.write('organ.percussion.harmonic', s.organ.percussion.third ? 1 : 0)
    this.write('organ.percussion.on', s.organ.percussion.on ? 1 : 0)
    DRAWBAR_IDS.forEach((id, i) => this.write(id, organ.drawbars[i] ?? 0))
    // Synth
    const sl = s.synth.layers[s.synth.focus]
    this.write('synth.on', s.synth.on ? 1 : 0)
    for (const id of SYNTH_LAYER_IDS) {
      this.write(`synth.layer-${id.toLowerCase()}.on`, s.synth.layers[id].on ? 1 : 0)
      this.write(`synth.layer-${id.toLowerCase()}.level`, s.synth.layers[id].level)
    }
    this.write('synth.kb-hold', s.synth.kbHold ? 1 : 0)
    this.write('synth.arp-run', sl.arp.run ? 1 : 0)
    this.write('synth.mode', sl.mode)
    this.write('synth.arp.rate', sl.arp.rate)
    this.write('synth.arp.mode', sl.arp.mode)
    this.write('synth.arp.range', sl.arp.range)
    this.write('synth.voice.mode', sl.voice.mode)
    this.write('synth.voice.glide', sl.voice.glide)
    this.write('synth.vibrato.mode', sl.vibrato.mode)
    this.write('synth.lfo.mod-amount', sl.lfo.amount)
    this.write('synth.lfo.rate', sl.lfo.rate)
    this.write('synth.lfo.destination', sl.lfo.destination)
    this.write('synth.osc.ctrl', sl.oscCtrl)
    this.write('synth.osc.env-amount', sl.oscEnv.amount)
    this.write('synth.filter.env-amount', sl.filter.envAmount)
    this.write('synth.filter.freq', sl.filter.freq)
    this.write('synth.filter.resonance', sl.filter.res)
    this.write('synth.filter.on', sl.filter.on ? 1 : 0)
    this.write('synth.unison', sl.unison)
    this.write('synth.arp.menu', s.view.synthPage === 'arpMenu' ? 1 : 0)
    this.write('synth.vibrato.menu', s.view.synthPage === 'vibratoMenu' ? 1 : 0)
    // Effects
    const chain = s.effects.chains[focusedChainKey(s)]
    this.write('effects.on', s.effects.on ? 1 : 0)
    this.write('effects.mod1.on', chain.mod1.on ? 1 : 0)
    this.write('effects.mod1.type', chain.mod1.type)
    this.write('effects.mod1.rate', chain.mod1.rate)
    this.write('effects.mod1.amount', chain.mod1.amount)
    this.write('effects.mod2.on', chain.mod2.on ? 1 : 0)
    this.write('effects.mod2.type', chain.mod2.type)
    this.write('effects.mod2.rate', chain.mod2.rate)
    this.write('effects.mod2.amount', chain.mod2.amount)
    this.write('effects.delay.on', chain.delay.on ? 1 : 0)
    this.write('effects.delay.tempo', chain.delay.tempo)
    this.write('effects.delay.feedback', chain.delay.feedback)
    this.write('effects.delay.dry-wet', chain.delay.dryWet)
    this.write('effects.delay.filter', chain.delay.filter)
    this.write('effects.amp.on', chain.amp.on ? 1 : 0)
    this.write('effects.amp.model', chain.amp.model)
    this.write('effects.amp.drive', chain.amp.drive)
    this.write('effects.amp.bass', chain.amp.bass)
    this.write('effects.amp.mid', chain.amp.mid)
    this.write('effects.amp.freq', chain.amp.midFreq)
    this.write('effects.amp.treble', chain.amp.treble)
    this.write('effects.comp.on', chain.comp.on ? 1 : 0)
    this.write('effects.comp.amount', chain.comp.amount)
    this.write('effects.reverb.on', chain.reverb.on ? 1 : 0)
    this.write('effects.reverb.type', chain.reverb.type)
    this.write('effects.reverb.dry-wet', chain.reverb.dryWet)
    this.write('effects.reverb.tone', chain.reverb.tone)
    const focusId = s.effects.focus === 'organ' ? 'effects.focus.organ' : s.effects.focus === 'piano' ? 'effects.focus.piano' : 'effects.focus.synth'
    for (const id of ['effects.focus.organ', 'effects.focus.piano', 'effects.focus.synth']) this.write(id, id === focusId ? 1 : 0)
    // Program section
    this.write('program.split', s.split.on ? 1 : 0)
    this.write('program.transpose', s.transpose.on ? 1 : 0)
    this.write('program.live-mode', s.bank.liveMode ? 1 : 0)
    this.write('program.layer-scene', s.scenes.active === 'II' ? 1 : 0)
    this.write('program.morph.wheel', s.morphArmed.source === 'wheel' && s.morphArmed.latched ? 1 : 0)
    this.write('program.morph.control-pedal', s.morphArmed.source === 'pedal' && s.morphArmed.latched ? 1 : 0)
    this.syncStoreLed()
    this.syncProgramButtons()
    // Performance
    this.write('performance.rotary.speed', s.rotary.speed >= 0.5 ? 1 : 0)
    this.write('performance.rotary.stop-mode', s.rotary.stop ? 1 : 0)
    this.write('performance.rotary.organ', s.rotary.organ ? 1 : 0)
    this.write('performance.rotary.drive', s.rotary.drive)
    this.write('performance.mod-wheel', s.morphSources.wheel)
  }

  /* ---------- engine push ---------- */

  /** Pushes the effective (morphed) program to the engine, sending only what changed. */
  private pushEngine(force = false) {
    const s = this.state
    const { engine } = this.deps
    const eff = applyMorphs(programOf(s), s.morphSources)
    engine.setPiano(pianoSettingsFor(eff))
    const bpmChanged = this.pushedBpm !== eff.clock.bpm
    for (const key of ALL_CHAIN_KEYS) {
      const chain = eff.effects.chains[key]
      const prev = this.pushedChains[key]
      const params = chainParamsFor(chain, eff.effects.on, eff.clock.bpm)
      let patch: Record<string, unknown> | null = null
      if (force || !prev) patch = params
      else {
        patch = {}
        for (const unit of UNIT_KEYS) {
          const synced = (unit === 'delay' && chain.delay.sync) || (unit === 'mod1' && chain.mod1.sync)
          if (prev[unit] !== chain[unit] || (bpmChanged && synced)) {
            const dspKey = unit === 'amp' ? 'ampEq' : unit === 'comp' ? 'compressor' : unit
            patch[dspKey] = params[dspKey as keyof typeof params]
          }
        }
        if (this.pushedEffectsOn !== eff.effects.on) patch.effectsOn = eff.effects.on
        if (Object.keys(patch).length === 0) patch = null
      }
      if (patch) {
        if (key === 'pianoA') engine.setChain('A', patch)
        else if (key === 'pianoB') engine.setChain('B', patch)
        else if (key === 'organ') engine.setOrganChain(patch)
        else engine.setSynthChain(key.slice(-1) as SynthLayerId, patch)
      }
      this.pushedChains[key] = chain
    }
    this.pushedEffectsOn = eff.effects.on
    this.pushedBpm = eff.clock.bpm
    const organ = organParamsFor(eff, 0)
    const organJson = JSON.stringify(organ)
    if (force || organJson !== this.pushedOrgan) {
      engine.setOrgan(organ)
      this.pushedOrgan = organJson
    }
    engine.setOrganRouting(eff.rotary.organ)
    for (const id of SYNTH_LAYER_IDS) {
      const params = synthParamsFor(eff, id, { wheel: s.morphSources.wheel, pedal: s.morphSources.pedal, pitchBend: 0 })
      const json = JSON.stringify(params)
      if (force || json !== this.pushedSynth[id]) {
        engine.setSynth(id, params)
        this.pushedSynth[id] = json
      }
      engine.setSynthRouting(id, synthToRotary(eff, id))
    }
    const rotary = rotaryParamsFor(eff)
    const rotaryJson = JSON.stringify(rotary)
    if (force || rotaryJson !== this.pushedRotary) {
      engine.setRotary(rotary)
      this.pushedRotary = rotaryJson
    }
    if (force) engine.setMasterLevel(s.master.level)
  }

  /** Is this piano layer routed into the shared rotary (for the Rotary ON LED)? */
  static routedToRotary(state: InstrumentState, layer: LayerId): boolean {
    const chain = state.effects.chains[PIANO_CHAIN_KEYS[layer]]
    return state.piano.on && state.piano.layers[layer].on && chain.amp.on && chain.amp.model === 4
  }

  /** Any layer or the organ feeding the rotary right now (Rotary ON LED). */
  static rotaryActive(state: InstrumentState): boolean {
    if (state.rotary.organ && state.organ.on && (state.organ.layers.A.on || state.organ.layers.B.on)) return true
    if (InstrumentController.routedToRotary(state, 'A') || InstrumentController.routedToRotary(state, 'B')) return true
    return state.synth.on && SYNTH_LAYER_IDS.some((id) => state.synth.layers[id].on && synthToRotary(state, id))
  }
}

/* ---------- helpers ---------- */

/** Endless-dial movement in detents (15° steps, shortest way around). */
export function dialSteps(value: number, previous: number): number {
  const delta = ((value - previous + 180) % 360 + 360) % 360 - 180
  return Math.round(delta / 15)
}

export function formatTranspose(semitones: number): string {
  return semitones === 0 ? '0' : `${semitones > 0 ? '+' : ''}${semitones}`
}

export function describeXfade(xfade: number): string {
  return xfade === 0 ? 'Off' : `±${xfade}`
}

export function describeSplitPoint(point: { note: number | null; xfade: number }): string {
  return point.note === null ? 'Off' : `${midiToName(point.note)} (${describeXfade(point.xfade)})`
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

/** The printed option or value of a control (hints). */
export function describeControl(spec: ControlSpec, value: number): string {
  if (spec.kind === 'button') return spec.mode === 'select' ? (spec.options?.[value] ?? String(value)) : value ? 'on' : 'off'
  return fmt(value)
}

export { getControl }
