import { useSyncExternalStore } from 'react'
import { getControl, HARDWARE_CONTROLS } from '../model/hardware'
import { instrumentsOfType, type InstrumentSpec } from '../audio/library'
import type { InstrumentController } from '../input/controller'
import { mappings, type InstrumentStore } from './instrument'

/**
 * Panel front door for every physical control.
 *
 * Two truthful classes of controls:
 * - DECORATIVE (Organ/Synth/Program — Phase 3 scope): visual position/lit
 *   state lives here and connects to nothing else.
 * - FUNCTIONAL (Piano, Layer Effects, Rotary, Master Level, pitch stick,
 *   Panic, Shift): reads and writes are forwarded to the canonical
 *   InstrumentStore / note-lifecycle controller, so panel state, LEDs,
 *   displays and audible output always agree.
 */
export interface PresentationState {
  values: Readonly<Record<string, number>>
  toggles: Readonly<Record<string, boolean>>
}

type Listener = () => void

export interface PanelWiring {
  instrument: InstrumentStore
  controller: InstrumentController
  /** Monotonic ms clock for tap tempo (injectable for tests). */
  now?: () => number
}

export class PresentationStore {
  private state: PresentationState
  private listeners = new Set<Listener>()
  private wiring: PanelWiring | null
  private tapTimes: number[] = []
  private readonly now: () => number

  constructor(wiring: PanelWiring | null = null) {
    this.wiring = wiring
    this.now = wiring?.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
    const values: Record<string, number> = {}
    const toggles: Record<string, boolean> = {}
    for (const control of HARDWARE_CONTROLS) {
      if (control.type === 'button') toggles[control.id] = false
      else values[control.id] = control.initial ?? 0
    }
    this.state = { values, toggles }
    // Functional control positions/lights derive from canonical state.
    wiring?.instrument.subscribe(() => this.emit())
  }

  getState = (): PresentationState => this.state

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    // New identity so useSyncExternalStore consumers re-read derived values.
    this.state = { values: { ...this.state.values }, toggles: { ...this.state.toggles } }
    for (const listener of this.listeners) listener()
  }

  /* ------------------------------------------------------------- reads -- */

  getValue(id: string): number {
    const wiring = this.wiring
    if (wiring) {
      const state = wiring.instrument.getState()
      const chain = state.chains[state.focusedLayer]
      switch (id) {
        case 'perf-master-level':
          return state.masterVolume
        case 'rotary-drive':
          return state.rotary.drive
        case 'piano-level-a':
          return state.layers.A.level
        case 'piano-level-b':
          return state.layers.B.level
        case 'piano-model': {
          const layer = state.layers[state.focusedLayer]
          const models = instrumentsOfType(layer.type)
          return models.length > 1 ? Math.round((layer.model / (models.length - 1)) * 127) : 0
        }
        case 'mod1-rate':
          return chain.mod1.rate
        case 'mod1-amount':
          return chain.mod1.amount
        case 'mod2-rate':
          return chain.mod2.rate
        case 'mod2-amount':
          return chain.mod2.amount
        case 'delay-tempo':
          return chain.delay.tempo
        case 'delay-feedback':
          return chain.delay.feedback
        case 'delay-mix':
          return chain.delay.mix
        case 'amp-drive':
          return chain.ampEq.drive
        case 'amp-freq':
          return chain.ampEq.freq
        case 'eq-bass':
          return chain.ampEq.bass
        case 'eq-mid':
          return chain.ampEq.mid
        case 'eq-treble':
          return chain.ampEq.treble
        case 'comp-amount':
          return chain.comp.amount
        case 'reverb-mix':
          return chain.reverb.mix
      }
    }
    return this.state.values[id] ?? 0
  }

  getToggle(id: string): boolean {
    const wiring = this.wiring
    if (wiring) {
      const state = wiring.instrument.getState()
      const chain = state.chains[state.focusedLayer]
      switch (id) {
        case 'piano-on':
          return state.piano.sectionOn
        case 'piano-layer-a':
          return state.layers.A.enabled
        case 'piano-layer-b':
          return state.layers.B.enabled
        case 'effects-on':
          return !state.allFxOff
        case 'mod1-on':
          return chain.mod1.on
        case 'mod2-on':
          return chain.mod2.on
        case 'delay-on':
          return chain.delay.on
        case 'delay-analog':
          return chain.delay.analog
        case 'amp-on':
          return chain.ampEq.on
        case 'comp-on':
          return chain.comp.on
        case 'reverb-on':
          return chain.reverb.on
        case 'reverb-bright':
          return chain.reverb.bright
        case 'rotary-speed':
          return state.rotary.speed === 'fast'
        case 'rotary-stop-mode':
          return state.rotary.speed === 'stop'
      }
    }
    return this.state.toggles[id] ?? false
  }

  /* ------------------------------------------------------------ writes -- */

  setValue(id: string, value: number): void {
    const control = getControl(id)
    const min = control.min ?? 0
    const max = control.max ?? 127
    const clamped = Math.min(max, Math.max(min, Math.round(value)))
    const wiring = this.wiring
    if (wiring && !control.decorative) {
      const store = wiring.instrument
      switch (id) {
        case 'perf-master-level':
          store.setMasterVolume(clamped)
          return
        case 'perf-pitch-stick':
          // Visual position is local; the bend itself is canonical (±2 semitones).
          this.setLocalValue(id, clamped)
          wiring.controller.setPitchBend((clamped / 100) * 2)
          return
        case 'rotary-drive':
          store.setRotaryDrive(clamped)
          return
        case 'piano-level-a':
          store.setLayerLevel('A', clamped)
          return
        case 'piano-level-b':
          store.setLayerLevel('B', clamped)
          return
        case 'piano-model': {
          const layer = store.getState().layers[store.getState().focusedLayer]
          const models = instrumentsOfType(layer.type)
          store.selectPianoModel(models.length > 1 ? Math.round((clamped / 127) * (models.length - 1)) : 0)
          return
        }
        case 'mod1-rate':
          store.updateUnit('mod1', { rate: clamped }, `Mod 1 Rate ${clamped}`)
          return
        case 'mod1-amount':
          store.updateUnit('mod1', { amount: clamped }, `Mod 1 Amount ${clamped}`)
          return
        case 'mod2-rate':
          store.updateUnit('mod2', { rate: clamped }, `Mod 2 Rate ${clamped}`)
          return
        case 'mod2-amount':
          store.updateUnit('mod2', { amount: clamped }, `Mod 2 Amount ${clamped}`)
          return
        case 'delay-tempo':
          store.updateUnit('delay', { tempo: clamped }, `Delay Tempo ${Math.round(mappings.delayTempoMs(clamped))} ms`)
          return
        case 'delay-feedback':
          store.updateUnit('delay', { feedback: clamped }, `Delay Feedback ${clamped}`)
          return
        case 'delay-mix':
          store.updateUnit('delay', { mix: clamped }, `Delay Dry/Wet ${clamped}`)
          return
        case 'amp-drive':
          store.updateUnit('ampEq', { drive: clamped }, `Drive ${clamped}`)
          return
        case 'amp-freq':
          store.updateUnit('ampEq', { freq: clamped }, `Freq ${Math.round(mappings.midFreqHz(clamped))} Hz`)
          return
        case 'eq-bass':
          store.updateUnit('ampEq', { bass: clamped }, `Bass ${mappings.eqGainDb(clamped).toFixed(1)} dB`)
          return
        case 'eq-mid':
          store.updateUnit('ampEq', { mid: clamped }, `Mid ${mappings.eqGainDb(clamped).toFixed(1)} dB`)
          return
        case 'eq-treble':
          store.updateUnit('ampEq', { treble: clamped }, `Treble ${mappings.eqGainDb(clamped).toFixed(1)} dB`)
          return
        case 'comp-amount':
          store.updateUnit('comp', { amount: clamped }, `Comp Amount ${clamped}`)
          return
        case 'reverb-mix':
          store.updateUnit('reverb', { mix: clamped }, `Reverb Dry/Wet ${clamped}`)
          return
      }
    }
    this.setLocalValue(id, clamped)
  }

  private setLocalValue(id: string, clamped: number): void {
    if (this.state.values[id] === clamped) return
    this.state = { ...this.state, values: { ...this.state.values, [id]: clamped } }
    for (const listener of this.listeners) listener()
  }

  toggle(id: string): void {
    const control = getControl(id)
    const wiring = this.wiring
    if (wiring && !control.decorative) {
      const store = wiring.instrument
      const shift = this.state.toggles['shift'] === true
      switch (id) {
        case 'piano-on':
          store.setPianoSectionOn(!store.getState().piano.sectionOn)
          return
        case 'piano-layer-a':
          // SUSTPED = Shift + Layer A (manual p. 23): routes the sustain pedal to this section.
          if (shift) store.togglePianoSustped()
          else store.toggleLayerEnabled('A')
          return
        case 'piano-layer-b':
          // PSTICK = Shift + Layer B (manual p. 23): pitch stick bends this section ±2 semitones.
          if (shift) store.togglePianoPstick()
          else store.toggleLayerEnabled('B')
          return
        case 'piano-type':
          store.cyclePianoType()
          return
        case 'piano-timbre':
          store.cycleTimbre()
          return
        case 'piano-kb-touch':
          store.cycleKbTouch()
          return
        case 'piano-dyn-comp':
          store.cycleDynComp()
          return
        case 'piano-unison':
          store.cycleUnison()
          return
        case 'piano-acoustics':
          store.cycleAcoustics()
          return
        case 'piano-octave-down':
          store.shiftOctave(store.getState().focusedLayer, -1)
          return
        case 'piano-octave-up':
          store.shiftOctave(store.getState().focusedLayer, 1)
          return
        case 'piano-info': {
          const state = store.getState()
          const layer = state.layers[state.focusedLayer]
          const spec: InstrumentSpec | undefined = instrumentsOfType(layer.type)[layer.model]
          store.setLastEdit(
            spec
              ? `${spec.name}: ${spec.velocityLayers} vel layer(s), ${spec.zones.length} files — ${spec.license}`
              : `No ${layer.type} model bundled`,
          )
          return
        }
        case 'panic':
          wiring.controller.panic()
          store.setLastEdit('PANIC — all notes off')
          return
        case 'effects-on':
        case 'all-fx-off':
          store.toggleAllFxOff()
          return
        case 'fx-focus-piano': {
          // Cycle: focus A -> focus B -> Group (A+B) -> focus A …
          const state = store.getState()
          if (state.fxGroupPiano) {
            store.toggleFxGroupPiano()
            store.setFocusedLayer('A')
          } else if (state.focusedLayer === 'A') {
            store.setFocusedLayer('B')
          } else {
            store.toggleFxGroupPiano()
          }
          return
        }
        case 'mod1-on':
          store.toggleUnitOn('mod1')
          return
        case 'mod2-on':
          store.toggleUnitOn('mod2')
          return
        case 'amp-on':
          store.toggleUnitOn('ampEq')
          return
        case 'delay-on':
          if (shift) store.toggleFxGlobal('delay')
          else store.toggleUnitOn('delay')
          return
        case 'comp-on':
          if (shift) store.toggleFxGlobal('comp')
          else store.toggleUnitOn('comp')
          return
        case 'reverb-on':
          if (shift) store.toggleFxGlobal('reverb')
          else store.toggleUnitOn('reverb')
          return
        case 'mod1-variation':
          store.cycleMod1Type()
          return
        case 'mod2-variation':
          store.cycleMod2Type()
          return
        case 'amp-variation':
          store.cycleAmpType()
          return
        case 'delay-variation':
          store.cycleDelayEffect()
          return
        case 'delay-filter':
          store.cycleDelayFilter()
          return
        case 'delay-analog':
          store.toggleDelayAnalog()
          return
        case 'delay-tap': {
          const time = this.now()
          this.tapTimes = this.tapTimes.filter((t) => time - t < 3000)
          this.tapTimes.push(time)
          if (this.tapTimes.length >= 2) {
            const intervals: number[] = []
            for (let i = 1; i < this.tapTimes.length; i++) intervals.push(this.tapTimes[i]! - this.tapTimes[i - 1]!)
            const average = intervals.reduce((a, b) => a + b, 0) / intervals.length
            store.setDelayTempoMs(average)
          } else {
            store.setLastEdit('Delay Tap…')
          }
          return
        }
        case 'reverb-variation':
          store.cycleReverbType()
          return
        case 'reverb-bright':
          store.toggleReverbBright()
          return
        case 'rotary-speed':
          store.toggleRotarySpeed()
          return
        case 'rotary-stop-mode':
          store.toggleRotaryStop()
          return
        case 'shift':
          break // functional modifier; lit state kept locally below
      }
    }
    const current = this.state.toggles[id] ?? false
    this.state = { ...this.state, toggles: { ...this.state.toggles, [id]: !current } }
    for (const listener of this.listeners) listener()
  }
}

export function usePresentationValue(store: PresentationStore, id: string): number {
  return useSyncExternalStore(store.subscribe, () => store.getValue(id))
}

export function usePresentationToggle(store: PresentationStore, id: string): boolean {
  return useSyncExternalStore(store.subscribe, () => store.getToggle(id))
}
