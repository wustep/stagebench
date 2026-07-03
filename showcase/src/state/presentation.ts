import { useSyncExternalStore } from 'react'
import { getControl, HARDWARE_CONTROLS } from '../model/hardware'
import { instrumentsOfType, SYNTH_SAMPLE_SETS, type InstrumentSpec } from '../audio/library'
import type { InstrumentController } from '../input/controller'
import {
  mappings,
  MORPH_DESTINATIONS,
  SPLIT_POSITIONS,
  SYNTH_LFO_DESTINATIONS,
  SYNTH_WAVEFORMS,
  type InstrumentStore,
  type MorphSource,
} from './instrument'

/**
 * Panel front door for every physical control.
 *
 * Two truthful classes of controls:
 * - DECORATIVE (Synth, remaining Program scope, spec-excluded Organ preset):
 *   visual position/lit state lives here and connects to nothing else.
 * - FUNCTIONAL (Piano, Organ, Layer Effects, Rotary, Master Level, pitch
 *   stick, Panic, Shift): reads and writes are forwarded to the canonical
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
  private mstTapTimes: number[] = []
  private readonly now: () => number
  private morphRangeCache = new Map<string, { start: number; end: number; range: { from: number; to: number } }>()

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
      const chain = wiring.instrument.focusedChain()
      if (id.startsWith('organ-drawbar-')) {
        const index = Number(id.slice('organ-drawbar-'.length)) - 1
        return state.organ.layers[state.organ.focusedLayer].drawbars[index] ?? 0
      }
      switch (id) {
        case 'perf-master-level':
          return state.masterVolume
        case 'perf-mod-wheel':
          return state.morphValues.wheel
        case 'program-dial': {
          const edit = state.splitEdit
          if (edit) {
            const index = SPLIT_POSITIONS.indexOf(state.split.points[edit.point].note)
            return index < 0 ? 0 : Math.round((index / (SPLIT_POSITIONS.length - 1)) * 127)
          }
          if (state.clockEdit) return Math.round(((state.masterClock.bpm - 30) / 270) * 127)
          if (state.transposeEdit) return Math.round(((state.transpose.semitones + 6) / 12) * 127)
          return wiring.instrument.programDialValue()
        }
        case 'rotary-drive':
          return state.rotary.drive
        case 'piano-level-a':
          return state.layers.A.level
        case 'piano-level-b':
          return state.layers.B.level
        case 'organ-level-a':
          return state.organ.layers.A.level
        case 'organ-level-b':
          return state.organ.layers.B.level
        case 'piano-model': {
          const layer = state.layers[state.focusedLayer]
          const models = instrumentsOfType(layer.type)
          return models.length > 1 ? Math.round((layer.model / (models.length - 1)) * 127) : 0
        }
        case 'synth-level-a':
          return state.synth.layers.A.level
        case 'synth-level-b':
          return state.synth.layers.B.level
        case 'synth-level-c':
          return state.synth.layers.C.level
        case 'osc-ctrl':
          return state.synth.layers[state.synth.focusedLayer].oscCtrl
        case 'filter-freq':
          return state.synth.layers[state.synth.focusedLayer].filter.freq
        case 'filter-res':
          return state.synth.layers[state.synth.focusedLayer].filter.res
        case 'filter-env-amt':
          return state.synth.layers[state.synth.focusedLayer].filter.envAmount
        case 'osc-env-amt':
          return state.synth.layers[state.synth.focusedLayer].oscEnvelope.amount
        case 'lfo-rate':
          return state.synth.layers[state.synth.focusedLayer].lfo.rate
        case 'lfo-mod-amt':
          return state.synth.layers[state.synth.focusedLayer].lfo.amount
        case 'glide':
          return state.synth.layers[state.synth.focusedLayer].voice.glide
        case 'arp-rate':
          return state.synth.arp.rate
        case 'arp-range':
          return Math.round(((state.synth.arp.range - 1) / 3) * 127)
        case 'synth-dial-1': {
          const synth = state.synth.layers[state.synth.focusedLayer]
          if (state.synthEnvEdit === 'amp') return synth.ampEnvelope.attack
          if (state.synthEnvEdit === 'filter') return synth.filter.envelope.attack
          if (state.synthEnvEdit === 'osc') return synth.oscEnvelope.attack
          return 0
        }
        case 'synth-dial-2': {
          const synth = state.synth.layers[state.synth.focusedLayer]
          if (state.synthEnvEdit === 'amp') return synth.ampEnvelope.decay
          if (state.synthEnvEdit === 'filter') return synth.filter.envelope.decay
          if (state.synthEnvEdit === 'osc') return synth.oscEnvelope.decay
          // Samples mode reuses this dial for the 2-item sample-set list
          // (spec.scope.optional Samples mode) instead of the waveform list.
          if (synth.mode === 'Samples') return Math.round((synth.waveform / (SYNTH_SAMPLE_SETS.length - 1)) * 127)
          return Math.round((synth.waveform / (SYNTH_WAVEFORMS.length - 1)) * 127)
        }
        case 'synth-dial-3': {
          const synth = state.synth.layers[state.synth.focusedLayer]
          if (state.synthEnvEdit === 'amp') return synth.ampEnvelope.release
          if (state.synthEnvEdit === 'filter') return synth.filter.envelope.release
          if (state.synthEnvEdit === 'osc') return synth.oscEnvelope.release
          const destIndex = synth.lfo.destination === null ? 0 : SYNTH_LFO_DESTINATIONS.indexOf(synth.lfo.destination) + 1
          return Math.round((destIndex / SYNTH_LFO_DESTINATIONS.length) * 127)
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

  /** Destination indicator: space-separated sources with an assignment for this control. */
  morphTag(id: string): string | null {
    const wiring = this.wiring
    if (!wiring) return null
    const sources = wiring.instrument.morphSourcesFor(id)
    return sources.length > 0 ? sources.join(' ') : null
  }

  /** Morph assignment range (manual p. 39 indicator nicety), mapped to LED
   *  ladder indices (0..ledCount-1) for a control with `ledCount` LEDs
   *  spanning its full 0..max range — null when unassigned. Resolves the
   *  same layer/chain context `setValue`'s capture path used.
   *
   *  Returns a cached object reference while the underlying assignment is
   *  unchanged so useSyncExternalStore snapshots stay referentially stable
   *  (required to avoid tearing/render loops). */
  morphRange(id: string, ledCount: number): { from: number; to: number } | null {
    const wiring = this.wiring
    const cacheKey = `${id}:${ledCount}`
    if (!wiring) return null
    const assignment = wiring.instrument.morphAssignmentFor(id)
    if (!assignment) {
      this.morphRangeCache.delete(cacheKey)
      return null
    }
    const cached = this.morphRangeCache.get(cacheKey)
    if (cached && cached.start === assignment.start && cached.end === assignment.end) return cached.range
    const control = getControl(id)
    const max = control.max ?? 127
    const toLed = (value: number) => Math.max(0, Math.min(ledCount - 1, Math.round((value / Math.max(1, max)) * (ledCount - 1))))
    const range = { from: toLed(assignment.start), to: toLed(assignment.end) }
    this.morphRangeCache.set(cacheKey, { start: assignment.start, end: assignment.end, range })
    return range
  }

  getToggle(id: string): boolean {
    const wiring = this.wiring
    if (wiring) {
      const state = wiring.instrument.getState()
      const chain = wiring.instrument.focusedChain()
      switch (id) {
        case 'piano-on':
          return state.piano.sectionOn
        case 'piano-layer-a':
          return state.layers.A.enabled
        case 'piano-layer-b':
          return state.layers.B.enabled
        case 'organ-on':
          return state.organ.sectionOn
        case 'organ-layer-a':
          return state.organ.layers.A.enabled
        case 'organ-layer-b':
          return state.organ.layers.B.enabled
        case 'synth-on':
          return state.synth.sectionOn
        case 'synth-layer-a':
          return state.synth.layers.A.enabled
        case 'synth-layer-b':
          return state.synth.layers.B.enabled
        case 'synth-layer-c':
          return state.synth.layers.C.enabled
        case 'amp-envelope':
          return state.synthEnvEdit === 'amp'
        case 'filter-envelope':
          return state.synthEnvEdit === 'filter'
        case 'osc-envelope':
          return state.synthEnvEdit === 'osc'
        case 'filter-on':
          return state.synth.layers[state.synth.focusedLayer].filter.on
        case 'arp-run':
          return state.synth.arp.run
        case 'kb-hold':
          return state.kbHold
        case 'organ-vib-on':
          return state.organ.layers[state.organ.focusedLayer].vibrato
        case 'organ-perc-on':
          return state.organ.percussion.on
        case 'organ-perc-volume':
          return state.organ.percussion.soft
        case 'organ-perc-decay':
          return state.organ.percussion.fast
        case 'organ-perc-harmonic':
          return state.organ.percussion.third
        case 'rotary-source':
          return state.organ.toRotary
        case 'live-mode':
          return state.programs.liveMode
        case 'layer-scene':
          return state.scenes.active === 'II'
        case 'split-onset':
          return state.split.on
        case 'transpose-onset':
          return state.transpose.on
        case 'morph-wheel':
          return state.morphArming === 'wheel'
        case 'morph-ctrlped':
          return state.morphArming === 'pedal'
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
    // Morph capture (manual p. 38): while a source is armed, an edit to a
    // morphable destination records its start→end range as it applies.
    const arming = wiring && !control.decorative ? wiring.instrument.getState().morphArming : null
    const previous = arming && MORPH_DESTINATIONS.has(id) ? this.getValue(id) : null
    this.applyValue(id, clamped)
    if (wiring && arming && previous !== null && previous !== clamped) {
      const state = wiring.instrument.getState()
      // Drawbar/level destinations capture the organ layer they live on;
      // effect-field destinations capture the shared organ chain when FX
      // focus is on the Organ section, or the focused synth layer's own
      // chain when FX focus is on Synth (manual p. 18/38, and manual p. 48's
      // per-chain pattern applied to Synth since each layer keeps its own).
      // Synth voice/filter/LFO knobs (osc-ctrl, filter-freq/res, lfo-rate/
      // mod-amt) always act on the focused synth layer, regardless of FX
      // focus; synth-level-a/b/c encode their own layer in the control id
      // (applyMorphWrite reads it back off the id, not `layer`); arp-rate is
      // section-wide so its captured layer is a don't-care ('SA').
      const layer =
        id === 'osc-ctrl' || id === 'filter-freq' || id === 'filter-res' || id === 'lfo-rate' || id === 'lfo-mod-amt'
          ? (`S${state.synth.focusedLayer}` as 'SA' | 'SB' | 'SC')
          : id === 'synth-level-a' || id === 'synth-level-b' || id === 'synth-level-c'
            ? 'SA'
            : id === 'arp-rate'
              ? 'SA'
              : id.startsWith('organ')
                ? state.organ.focusedLayer
                : state.fxSection === 'organ'
                  ? 'organ'
                  : state.fxSection === 'synth'
                    ? (`S${state.synth.focusedLayer}` as 'SA' | 'SB' | 'SC')
                    : state.focusedLayer
      wiring.instrument.recordMorphEdit(arming, id, layer, previous, clamped)
    }
  }

  private applyValue(id: string, clamped: number): void {
    const control = getControl(id)
    const wiring = this.wiring
    if (wiring && !control.decorative) {
      const store = wiring.instrument
      if (id.startsWith('organ-drawbar-')) {
        store.setOrganDrawbar(Number(id.slice('organ-drawbar-'.length)) - 1, clamped)
        return
      }
      switch (id) {
        case 'perf-master-level':
          store.setMasterVolume(clamped)
          return
        case 'perf-mod-wheel':
          // The mod wheel is the Wheel morph source (manual p. 38).
          store.setMorphSource('wheel', clamped)
          return
        case 'program-dial':
          // Split-edit mode repurposes the dial for the point position.
          if (store.getState().splitEdit) {
            store.setSplitPosition(clamped)
            return
          }
          if (store.getState().clockEdit) {
            store.setMasterClockBpm(30 + Math.round((clamped / 127) * 270))
            return
          }
          if (store.getState().transposeEdit) {
            store.setTransposeSemitones(Math.round((clamped / 127) * 12) - 6)
            return
          }
          // Shift + dial browses in the numeric list view (manual p. 41).
          if (this.state.toggles['shift'] === true && !store.getState().programs.naming) {
            store.setProgramListView(true)
          }
          store.dialProgram(clamped)
          return
        case 'organ-level-a':
          store.setOrganLayerLevel('A', clamped)
          return
        case 'organ-level-b':
          store.setOrganLayerLevel('B', clamped)
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
        case 'synth-level-a':
          store.setSynthLayerLevel('A', clamped)
          return
        case 'synth-level-b':
          store.setSynthLayerLevel('B', clamped)
          return
        case 'synth-level-c':
          store.setSynthLayerLevel('C', clamped)
          return
        case 'osc-ctrl':
          store.setSynthOscCtrl(clamped)
          return
        case 'filter-freq':
          store.setSynthFilterParam('freq', clamped)
          return
        case 'filter-res':
          store.setSynthFilterParam('res', clamped)
          return
        case 'filter-env-amt':
          store.setSynthFilterParam('envAmount', clamped)
          return
        case 'osc-env-amt':
          store.setSynthOscEnvelope({ amount: clamped })
          return
        case 'lfo-rate':
          store.setSynthLfoRate(clamped)
          return
        case 'lfo-mod-amt':
          store.setSynthLfoAmount(clamped)
          return
        case 'glide':
          store.setSynthGlide(clamped)
          return
        case 'arp-rate':
          store.setArpRate(clamped)
          return
        case 'arp-range':
          store.setArpRange(clamped)
          return
        case 'synth-dial-1': {
          const edit = store.getState().synthEnvEdit
          if (edit === 'amp') store.setSynthAmpEnvelope({ attack: clamped })
          else if (edit === 'filter') store.setSynthFilterEnvelope({ attack: clamped })
          else if (edit === 'osc') store.setSynthOscEnvelope({ attack: clamped })
          return
        }
        case 'synth-dial-2': {
          const edit = store.getState().synthEnvEdit
          if (edit === 'amp') store.setSynthAmpEnvelope({ decay: clamped })
          else if (edit === 'filter') store.setSynthFilterEnvelope({ decay: clamped })
          else if (edit === 'osc') store.setSynthOscEnvelope({ decay: clamped })
          else if (store.getState().synth.layers[store.getState().synth.focusedLayer].mode === 'Samples') {
            store.selectSynthWaveform(Math.round((clamped / 127) * (SYNTH_SAMPLE_SETS.length - 1)))
          } else store.selectSynthWaveform(Math.round((clamped / 127) * (SYNTH_WAVEFORMS.length - 1)))
          return
        }
        case 'synth-dial-3': {
          const edit = store.getState().synthEnvEdit
          if (edit === 'amp') store.setSynthAmpEnvelope({ release: clamped })
          else if (edit === 'filter') store.setSynthFilterEnvelope({ release: clamped })
          else if (edit === 'osc') store.setSynthOscEnvelope({ release: clamped })
          // Outside envelope editing, dial 3 selects the LFO destination by
          // absolute position (Off/Osc Pitch/Osc Ctrl/Filter Freq) — the
          // same "dial = absolute list position" convention dial 2 uses for
          // the waveform list, since the panel has no dedicated destination
          // button (manual p. 34's destination LEDs sit beside Mod Amt).
          else store.selectSynthLfoDestination(Math.round((clamped / 127) * SYNTH_LFO_DESTINATIONS.length))
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
        case 'organ-on':
          store.setOrganSectionOn(!store.getState().organ.sectionOn)
          return
        case 'organ-layer-a':
          // Same Shift pattern as Piano (manual p. 18): SUSTPED = Shift + Layer A.
          if (shift) store.toggleOrganSustped()
          else store.toggleOrganLayerEnabled('A')
          return
        case 'organ-layer-b':
          if (shift) store.toggleOrganPstick()
          else store.toggleOrganLayerEnabled('B')
          return
        case 'organ-model':
          store.cycleOrganModel()
          return
        case 'organ-vib-select':
          store.cycleOrganVibratoType()
          return
        case 'organ-vib-on':
          store.toggleOrganVibrato()
          return
        case 'organ-perc-on':
          store.toggleOrganPercussion('on')
          return
        case 'organ-perc-volume':
          // Shift + Percussion Volume toggles POLY mode (manual p. 20).
          if (shift) store.toggleOrganPercussion('poly')
          else store.toggleOrganPercussion('soft')
          return
        case 'organ-perc-decay':
          store.toggleOrganPercussion('fast')
          return
        case 'organ-perc-harmonic':
          store.toggleOrganPercussion('third')
          return
        case 'organ-octave-down':
          if (shift) store.cycleLayerZone('organ', store.getState().organ.focusedLayer, -1)
          else store.shiftOrganOctave(store.getState().organ.focusedLayer, -1)
          return
        case 'organ-octave-up':
          if (shift) store.cycleLayerZone('organ', store.getState().organ.focusedLayer, 1)
          else store.shiftOrganOctave(store.getState().organ.focusedLayer, 1)
          return
        case 'rotary-source':
          store.toggleOrganRotary()
          return
        case 'synth-on':
          store.setSynthSectionOn(!store.getState().synth.sectionOn)
          return
        case 'synth-layer-a':
          // SUSTPED = Shift + Layer A (manual p. 18/23 pattern, applied to Synth).
          if (shift) store.toggleSynthSustped()
          else store.toggleSynthLayerEnabled('A')
          return
        case 'synth-layer-b':
          // PSTICK = Shift + Layer B.
          if (shift) store.toggleSynthPstick()
          else store.toggleSynthLayerEnabled('B')
          return
        case 'synth-layer-c':
          store.toggleSynthLayerEnabled('C')
          return
        case 'synth-octave-down':
          // KB ZONE ◂ = Shift + Octave Down (manual p. 39 pattern, applied to Synth).
          if (shift) store.cycleLayerZone('synth', store.getState().synth.focusedLayer, -1)
          else store.shiftSynthOctave(store.getState().synth.focusedLayer, -1)
          return
        case 'synth-octave-up':
          if (shift) store.cycleLayerZone('synth', store.getState().synth.focusedLayer, 1)
          else store.shiftSynthOctave(store.getState().synth.focusedLayer, 1)
          return
        case 'waveform-select':
          store.cycleSynthWaveformCategory()
          return
        case 'sound-init':
          store.synthSoundInit()
          return
        case 'synth-mode':
          store.cycleSynthLayerMode()
          return
        case 'amp-envelope':
          store.setSynthEnvEdit(store.getState().synthEnvEdit === 'amp' ? null : 'amp')
          return
        case 'filter-on':
          store.toggleSynthFilterOn()
          return
        case 'filter-type':
          // Shift + FILTER TYPE = keyboard tracking (manual adaptation — the
          // hardware's Group-mode legend has no dedicated Tracking button).
          if (shift) store.cycleSynthFilterTracking()
          else store.cycleSynthFilterType()
          return
        case 'filter-envelope':
          // Shift + FILTER ENVELOPE = drive stage (same pairing convention).
          if (shift) store.cycleSynthFilterDrive()
          else store.setSynthEnvEdit(store.getState().synthEnvEdit === 'filter' ? null : 'filter')
          return
        case 'osc-envelope':
          // Shift + OSC ENVELOPE = Env To Pitch retarget (same convention).
          if (shift) store.toggleOscEnvToPitch()
          else store.setSynthEnvEdit(store.getState().synthEnvEdit === 'osc' ? null : 'osc')
          return
        case 'lfo-waveform':
          // Shift + LFO WAVEFORM = master-clock rate sync (Shift + Rate knob
          // is awkward on a continuous control, so the pairing moves here).
          if (shift) store.toggleSynthLfoClockSync()
          else store.cycleSynthLfoWaveform()
          return
        case 'voice-mode':
          // Shift + VOICE MODE = note priority (manual adaptation: Priority
          // shares the Voice button's menu, no dedicated panel control).
          if (shift) store.cycleSynthVoicePriority()
          else store.cycleSynthVoiceMode()
          return
        case 'synth-unison':
          store.cycleSynthUnison()
          return
        case 'vibrato-mode':
          store.cycleSynthVibratoMode()
          return
        case 'arp-run':
          // Shift + ARP RUN = master-clock rate sync (the brief's own note:
          // Shift + the Rate knob is impossible, so the pairing moves here).
          if (shift) store.toggleArpClockSync()
          else store.toggleArpRun()
          return
        case 'arp-mode':
          // Shift + ARP MODE = direction (manual adaptation: Direction shares
          // the Mode button's menu, no dedicated panel control).
          if (shift) store.cycleArpDirection()
          else store.cycleArpMode()
          return
        case 'kb-hold':
          store.toggleKbHold()
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
          // KB ZONE ◂ = Shift + Octave Down (manual p. 39).
          if (shift) store.cycleLayerZone('piano', store.getState().focusedLayer, -1)
          else store.shiftOctave(store.getState().focusedLayer, -1)
          return
        case 'piano-octave-up':
          if (shift) store.cycleLayerZone('piano', store.getState().focusedLayer, 1)
          else store.shiftOctave(store.getState().focusedLayer, 1)
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
        case 'store':
          store.storePress()
          return
        case 'store-as':
          store.storeAsPress()
          return
        case 'page-left':
          if (store.getState().splitEdit) store.selectSplitPoint(-1)
          else store.shiftProgramPage(-1)
          return
        case 'page-right':
          if (store.getState().splitEdit) store.selectSplitPoint(1)
          else store.shiftProgramPage(1)
          return
        case 'live-mode':
          store.toggleLiveMode()
          return
        case 'solo-undo':
          store.undoProgramChange()
          return
        case 'layer-scene':
          store.toggleLayerScene()
          return
        case 'morph-wheel':
        case 'morph-ctrlped': {
          const source: MorphSource = id === 'morph-wheel' ? 'wheel' : 'pedal'
          // Shift + source clears its assignments (manual p. 39).
          if (shift) store.clearMorph(source)
          else store.toggleMorphArming(source)
          return
        }
        case 'split-onset':
          // SPLIT ON/SET toggles the split; Shift opens the point editor (our
          // panel adaptation of the manual's press-and-hold, p. 39).
          if (shift) store.setSplitEdit(!store.getState().splitEdit)
          else store.toggleSplit()
          return
        case 'mstclk-tap': {
          // Shift opens the dial-edit mode; otherwise MST CLK TAP (4+ taps sets the BPM).
          if (shift) {
            store.setClockEdit(!store.getState().clockEdit)
            return
          }
          const time = this.now()
          this.mstTapTimes = this.mstTapTimes.filter((t) => time - t < 3000)
          this.mstTapTimes.push(time)
          if (this.mstTapTimes.length >= 4) {
            const intervals: number[] = []
            for (let i = 1; i < this.mstTapTimes.length; i++) intervals.push(this.mstTapTimes[i]! - this.mstTapTimes[i - 1]!)
            const average = intervals.reduce((a, b) => a + b, 0) / intervals.length
            store.setMasterClockBpm(Math.round(60000 / average))
          } else {
            store.setLastEdit('Mst Clk: tap 4+ times to set')
          }
          return
        }
        case 'transpose-onset':
          // Shift opens the dial-edit mode; otherwise TRANSPOSE ON/OFF.
          if (shift) store.setTransposeEdit(!store.getState().transposeEdit)
          else store.toggleTranspose()
          return
        case 'program-1':
        case 'program-2':
        case 'program-3':
        case 'program-4':
        case 'program-5':
        case 'program-6':
        case 'program-7':
        case 'program-8': {
          const button = Number(id.slice('program-'.length)) - 1
          if (store.getState().clockEdit) {
            // Clock-edit mode: PROG 1 syncs the Delay, PROG 2 syncs Mod 1.
            if (button === 0) store.toggleDelayClockSync()
            else if (button === 1) store.toggleMod1ClockSync()
            else store.setLastEdit('Mst Clk Edit — PROG 1: delay · PROG 2: mod 1')
            return
          }
          if (store.getState().splitEdit) {
            // Split-edit mode: PROG 1 toggles the point, PROG 2 cycles crossfade.
            if (button === 0) store.toggleSplitPointActive()
            else if (button === 1) store.cycleSplitXf()
            else store.setLastEdit('Split Edit — PROG 1: on/off · PROG 2: xfade')
            return
          }
          store.selectProgramButton(button)
          return
        }
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
        case 'fx-focus-synth': {
          // Cycle: focus A -> focus B -> focus C -> Group (A+B+C) -> focus A …
          const state = store.getState()
          if (state.fxGroupSynth) {
            store.toggleFxGroupSynth()
            store.setSynthFxFocus('A')
          } else if (state.fxSection !== 'synth' || state.synth.focusedLayer === 'A') {
            store.setSynthFxFocus('B')
          } else if (state.synth.focusedLayer === 'B') {
            store.setSynthFxFocus('C')
          } else {
            store.toggleFxGroupSynth()
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
        case 'rotary-speed': {
          // Morphable rotary speed: while a source is armed, the press
          // records a slow↔fast morph range (0/127 binary destination).
          const arming = store.getState().morphArming
          const wasFast = store.getState().rotary.speed === 'fast'
          store.toggleRotarySpeed()
          if (arming) store.recordMorphEdit(arming, 'rotary-speed', 'A', wasFast ? 127 : 0, wasFast ? 0 : 127)
          return
        }
        case 'rotary-stop-mode':
          store.toggleRotaryStop()
          return
        case 'shift':
          // Shift/Exit first aborts an ongoing Store or naming step (manual p. 13)…
          if (store.cancelStoreFlow()) return
          // …then exits split-edit mode…
          if (store.getState().splitEdit) {
            store.setSplitEdit(false)
            return
          }
          if (store.getState().clockEdit) {
            store.setClockEdit(false)
            return
          }
          if (store.getState().transposeEdit) {
            store.setTransposeEdit(false)
            return
          }
          // …and dropping Shift closes the numeric list view.
          if (shift) store.setProgramListView(false)
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

/** LED-index-mapped morph range for a control with `ledCount` LEDs spanning
 *  its full range (manual p. 39 indicator nicety) — null when unassigned. */
export function usePresentationMorphRange(store: PresentationStore, id: string, ledCount: number): { from: number; to: number } | null {
  return useSyncExternalStore(store.subscribe, () => store.morphRange(id, ledCount))
}
