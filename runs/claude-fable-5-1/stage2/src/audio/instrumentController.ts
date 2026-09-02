/**
 * Panel → canonical state → engine. The hardware store keeps every control's position (it is the panel);
 * this controller interprets the Piano section, Layer Effects section, Master Level, Rotary and pitch
 * stick controls, applies focus / group / global / Shift semantics, and pushes the result to the engine.
 * Organ, Synth and Program controls are never read here: they stay decorative.
 *
 * Focus swaps write the focused layer's / chain's values back into the hardware store (guarded, so the
 * write-back is not mistaken for a user edit) — exactly how the real panel re-shows a layer's settings.
 */
import { PIANO_TYPES, defaultModelFor, getModel, modelsOfType, stepModel, type PianoType } from './pianoModels'
import { LAYER_IDS, type LayerId, type PianoEngine } from './engine'
import type { Timers } from './boundaries'
import type { HardwareStore } from '../state/hardwareStore'
import { ALL_CHAIN_KEYS, AMP_MODEL_TO_ROTARY, PIANO_CHAIN_KEYS, UNIT_KEYS, chainParamsFor, focusedChainKey, pianoSettingsFor, targetChainKeys, type ChainKey, type ChainSettings, type InstrumentState, type InstrumentStore, type UnitKey } from '../state/instrumentState'
import { secondsToTempoKnob, tempoKnobToSeconds } from '../dsp/types'

export const SHIFT_LATCH_MS = 8000
export const TAP_WINDOW_MS = 2500
const TIMBRE_OPTIONS_ACOUSTIC = 4

const LAYER_BUTTON: Record<string, LayerId> = { 'piano.layer-a.on': 'A', 'piano.layer-b.on': 'B' }
const LAYER_FADER: Record<string, LayerId> = { 'piano.layer-a.level': 'A', 'piano.layer-b.level': 'B' }

export interface ControllerDeps {
  hardware: HardwareStore
  state: InstrumentStore
  engine: PianoEngine
  timers: Timers
}

export class InstrumentController {
  private lastValues: Readonly<Record<string, number>>
  private lastPressed: Readonly<Record<string, boolean>>
  private lastActivation = 0
  private syncing = 0
  private unsubscribe: (() => void) | null = null
  private shiftTimer: unknown = null
  private lastModelByType: Record<LayerId, Partial<Record<PianoType, string>>> = { A: {}, B: {} }
  private pushedChains: Partial<Record<ChainKey, ChainSettings>> = {}
  private pushedEffectsOn: boolean | null = null

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
  }

  get state(): InstrumentState {
    return this.deps.state.get()
  }

  private set(updater: (s: InstrumentState) => InstrumentState) {
    this.deps.state.set(updater)
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
    if (activation.seq !== prevActivation && activation.id) this.onActivate(activation.id)
    for (const id of Object.keys(values)) if (values[id] !== prevValues[id]) this.onValue(id, values[id], prevValues[id] ?? 0)
  }

  /** Full clicks of the FX focus radio buttons, including a click on the already-lit one. */
  private onActivate(id: string) {
    if (id !== 'effects.focus.organ' && id !== 'effects.focus.piano' && id !== 'effects.focus.synth') return
    const section = id === 'effects.focus.organ' ? 'organ' : id === 'effects.focus.piano' ? 'piano' : 'synth'
    if (this.takeShift()) {
      // GROUP (Piano) — Organ's ALL FX OFF and the Synth group need chains that only exist in Phase 3.
      if (section === 'piano') this.toggleGroup()
      this.syncPanel()
      return
    }
    if (section === 'piano' && this.state.effects.focus === 'piano') {
      // Pressing the lit Piano focus again toggles the focused Piano layer when both layers are on.
      const p = this.state.piano
      if (p.layers.A.on && p.layers.B.on) this.focusLayer(p.focus === 'A' ? 'B' : 'A')
      return
    }
    this.setEffects((e) => ({ ...e, focus: section }))
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

  /* ---------- presses (momentary / radio buttons) ---------- */

  private onPress(id: string) {
    switch (id) {
      case 'effects.shift':
      case 'program.shift':
        this.armShift(!this.state.shiftArmed)
        return
      case 'piano.octave-down':
      case 'piano.octave-up':
        if (this.takeShift()) return // KB ZONE: Phase 3 (unsupported here)
        this.updateLayer(this.state.piano.focus, (l) => ({ ...l, octave: Math.max(-1, Math.min(1, l.octave + (id === 'piano.octave-up' ? 1 : -1))) }))
        return
      case 'effects.delay.tap':
        if (this.takeShift()) return // ANALOG mode is excluded
        this.tap()
        return
      default:
        return
    }
  }

  /* ---------- values ---------- */

  private onValue(id: string, value: number, previous: number) {
    const s = this.state
    // Piano section
    if (id === 'piano.on') return this.setPiano((p) => ({ ...p, on: value === 1 }))
    if (id in LAYER_BUTTON) return this.onLayerButton(LAYER_BUTTON[id], value === 1)
    if (id in LAYER_FADER) return this.updateLayer(LAYER_FADER[id], (l) => ({ ...l, level: value }))
    if (id === 'piano.type') {
      if (this.takeShift()) return this.write(id, previous) // INFO view is excluded
      return this.selectType(s.piano.focus, PIANO_TYPES[Math.round(value) % PIANO_TYPES.length])
    }
    if (id === 'piano.model') return this.turnModelDial(value, previous)
    if (id === 'piano.timbre') return this.setTimbre(Math.round(value))
    if (id === 'piano.acoustics') {
      if (this.takeShift()) return this.write(id, previous) // PED NOISE is excluded
      const v = Math.round(value)
      return this.updateLayer(s.piano.focus, (l) => ({ ...l, softRelease: (v & 1) === 1, stringRes: (v & 2) === 2 }))
    }
    if (id === 'piano.kb-touch') return this.updateLayer(s.piano.focus, (l) => ({ ...l, kbTouch: Math.round(value) }))
    if (id === 'piano.unison') return this.updateLayer(s.piano.focus, (l) => ({ ...l, unison: Math.round(value) }))
    if (id === 'piano.dyn-comp') return this.updateLayer(s.piano.focus, (l) => ({ ...l, dynComp: Math.round(value) }))
    // Layer effects section
    if (id === 'effects.on') return this.setEffects((e) => ({ ...e, on: value === 1 }))
    if (id === 'effects.focus.organ' || id === 'effects.focus.piano' || id === 'effects.focus.synth') return // handled by onActivate
    const unit = this.unitOf(id)
    if (unit) return this.onUnitControl(unit, id, value, previous)
    // Performance section (only the Phase 2 functional pieces)
    if (id === 'performance.master-level') {
      this.set((st) => ({ ...st, master: { level: value } }))
      this.deps.engine.setMasterLevel(value)
      return
    }
    if (id === 'performance.rotary.speed') {
      this.set((st) => ({ ...st, rotary: { ...st.rotary, fast: Math.round(value) === 1 } }))
      this.deps.engine.setRotary({ fast: this.state.rotary.fast, drive: this.state.rotary.drive })
      return
    }
    if (id === 'performance.rotary.drive') {
      this.set((st) => ({ ...st, rotary: { ...st.rotary, drive: value } }))
      this.deps.engine.setRotary({ fast: this.state.rotary.fast, drive: this.state.rotary.drive })
      return
    }
    if (id === 'performance.pitch-stick') {
      this.deps.engine.setPitchBend(value)
      return
    }
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
    const shifted = this.state.shiftArmed
    // Shift functions on the unit controls
    if (shifted) {
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
      if (field === 'type' || field === 'model' || field === 'effect') {
        // VARIATION / CHORALE are excluded from the benchmark: the selector does not cycle under Shift.
        this.takeShift()
        this.write(id, previous)
        return
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
      case 'mod2.rate':
        return this.editUnit(unit, (u) => ({ ...u, rate: value }))
      case 'mod1.amount':
      case 'mod2.amount':
      case 'comp.amount':
        return this.editUnit(unit, (u) => ({ ...u, amount: value }))
      case 'delay.tempo':
        return this.editUnit('delay', (d) => ({ ...d, tempo: value, seconds: tempoKnobToSeconds(value) }))
      case 'delay.feedback':
        return this.editUnit('delay', (d) => ({ ...d, feedback: value }))
      case 'delay.dry-wet':
        return this.editUnit('delay', (d) => ({ ...d, dryWet: value }))
      case 'delay.filter':
        return this.editUnit('delay', (d) => ({ ...d, filter: Math.round(value) }))
      case 'delay.effect':
        return // delay feedback-loop effects are excluded: decorative
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

  /* ---------- piano state ---------- */

  private setPiano(updater: (p: InstrumentState['piano']) => InstrumentState['piano']) {
    this.set((s) => ({ ...s, piano: updater(s.piano) }))
    this.pushEngine()
  }

  private updateLayer(id: LayerId, updater: (l: InstrumentState['piano']['layers'][LayerId]) => InstrumentState['piano']['layers'][LayerId]) {
    this.setPiano((p) => ({ ...p, layers: { ...p.layers, [id]: updater(p.layers[id]) } }))
  }

  private onLayerButton(id: LayerId, on: boolean) {
    if (this.takeShift()) {
      // SUSTPED (Shift + Layer A) / PSTICK (Shift + Layer B): section toggles; the layer itself is untouched.
      this.write(id === 'A' ? 'piano.layer-a.on' : 'piano.layer-b.on', on ? 0 : 1)
      this.setPiano((p) => (id === 'A' ? { ...p, sustped: !p.sustped } : { ...p, pstick: !p.pstick }))
      return
    }
    const other: LayerId = id === 'A' ? 'B' : 'A'
    this.setPiano((p) => {
      const layers = { ...p.layers, [id]: { ...p.layers[id], on } }
      let focus = p.focus
      if (on) focus = id
      else if (p.focus === id && layers[other].on) focus = other
      return { ...p, layers, focus }
    })
    this.syncPanel()
  }

  focusLayer(id: LayerId) {
    if (this.state.piano.focus === id) return
    this.setPiano((p) => ({ ...p, focus: id }))
    this.syncPanel()
  }

  private selectType(layer: LayerId, type: PianoType) {
    const remembered = this.lastModelByType[layer][type]
    const modelId = remembered && modelsOfType(type).some((m) => m.id === remembered) ? remembered : defaultModelFor(type).id
    this.updateLayer(layer, (l) => ({ ...l, modelId }))
    this.clampTimbre(layer)
  }

  private turnModelDial(value: number, previous: number) {
    const delta = ((value - previous + 180) % 360 + 360) % 360 - 180
    const steps = Math.round(delta / 15)
    if (steps === 0) return
    const layer = this.state.piano.focus
    let modelId = this.state.piano.layers[layer].modelId
    const direction: 1 | -1 = steps > 0 ? 1 : -1
    for (let i = 0; i < Math.abs(steps); i++) modelId = stepModel(modelId, direction).id
    this.lastModelByType[layer][getModel(modelId).type] = modelId
    this.updateLayer(layer, (l) => ({ ...l, modelId }))
    this.clampTimbre(layer)
  }

  private setTimbre(value: number) {
    const layer = this.state.piano.focus
    const family = getModel(this.state.piano.layers[layer].modelId).family
    const v = family === 'acoustic' && value >= TIMBRE_OPTIONS_ACOUSTIC ? 0 : value
    if (v !== value) this.write('piano.timbre', v)
    this.updateLayer(layer, (l) => ({ ...l, timbre: v }))
  }

  /** Acoustic models only have Off/Soft/Mid/Bright: a Dyno setting inherited from an electric model resets. */
  private clampTimbre(layer: LayerId) {
    const l = this.state.piano.layers[layer]
    if (getModel(l.modelId).family === 'acoustic' && l.timbre >= TIMBRE_OPTIONS_ACOUSTIC) {
      this.updateLayer(layer, (x) => ({ ...x, timbre: 0 }))
      if (layer === this.state.piano.focus) this.write('piano.timbre', 0)
    }
  }

  /* ---------- effects state ---------- */

  private setEffects(updater: (e: InstrumentState['effects']) => InstrumentState['effects']) {
    this.set((s) => ({ ...s, effects: updater(s.effects) }))
    this.syncPanel()
    this.pushEngine()
  }

  private editUnit<K extends UnitKey>(unit: K, updater: (u: ChainSettings[K]) => ChainSettings[K]) {
    const targets = targetChainKeys(this.state, unit)
    this.set((s) => {
      const chains = { ...s.effects.chains }
      for (const key of targets) chains[key] = { ...chains[key], [unit]: updater(chains[key][unit]) }
      return { ...s, effects: { ...s.effects, chains } }
    })
    this.pushEngine()
  }

  private toggleGroup() {
    this.set((s) => {
      const group = !s.effects.pianoGroup
      const chains = { ...s.effects.chains }
      if (group) {
        // Entering Group mode applies the focused layer's settings to both Piano layers (manual p. 48).
        const src = chains[PIANO_CHAIN_KEYS[s.piano.focus]]
        chains.pianoA = { ...src }
        chains.pianoB = { ...src }
      }
      return { ...s, effects: { ...s.effects, pianoGroup: group, chains } }
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
    this.editUnit('delay', (d) => ({ ...d, seconds, tempo }))
    this.write('effects.delay.tempo', Math.round(tempo * 10) / 10)
  }

  /* ---------- panel write-back ---------- */

  /** Shows the focused layer and chain on the panel. */
  syncPanel() {
    const s = this.state
    const layer = s.piano.layers[s.piano.focus]
    const model = getModel(layer.modelId)
    const type = PIANO_TYPES.indexOf(model.type)
    this.write('piano.type', type)
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
  }

  /* ---------- engine push ---------- */

  private pushEngine(force = false) {
    const s = this.state
    const { engine } = this.deps
    engine.setPiano(pianoSettingsFor(s))
    for (const layer of LAYER_IDS) {
      const key = PIANO_CHAIN_KEYS[layer]
      const chain = s.effects.chains[key]
      const prev = this.pushedChains[key]
      const params = chainParamsFor(chain, s.effects.on)
      if (force || !prev) {
        engine.setChain(layer, params)
      } else {
        const patch: Record<string, unknown> = {}
        for (const unit of UNIT_KEYS) {
          if (prev[unit] !== chain[unit]) {
            const dspKey = unit === 'amp' ? 'ampEq' : unit === 'comp' ? 'compressor' : unit
            patch[dspKey] = params[dspKey as keyof typeof params]
          }
        }
        if (this.pushedEffectsOn !== s.effects.on) patch.effectsOn = s.effects.on
        if (Object.keys(patch).length) engine.setChain(layer, patch)
      }
      this.pushedChains[key] = chain
    }
    this.pushedEffectsOn = s.effects.on
    if (force) {
      engine.setRotary({ fast: s.rotary.fast, drive: s.rotary.drive })
      engine.setMasterLevel(s.master.level)
    }
  }

  /** Is this layer routed into the shared rotary (for the Rotary ON LED)? */
  static routedToRotary(state: InstrumentState, layer: LayerId): boolean {
    const chain = state.effects.chains[PIANO_CHAIN_KEYS[layer]]
    return state.piano.layers[layer].on && chain.amp.on && chain.amp.model === AMP_MODEL_TO_ROTARY
  }
}
