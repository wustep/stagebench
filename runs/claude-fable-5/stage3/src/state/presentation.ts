import { useSyncExternalStore } from 'react'
import { getControl, HARDWARE_CONTROLS } from '../model/hardware'
import { instrumentsOfType, type InstrumentSpec } from '../audio/library'
import type { InstrumentController } from '../input/controller'
import { mappings, type InstrumentStore } from './instrument'
import { chainForFocus, synthMappings } from './program-types'

/**
 * Panel front door for every physical control.
 *
 * Phase 3: FUNCTIONAL controls (everything except the documented unsupported
 * set) forward reads and writes to the canonical InstrumentStore / controller,
 * so panel state, LEDs, displays and audible output always agree. The
 * remaining UNSUPPORTED controls (aftertouch morph, preset libraries,
 * section-edit/copy menus, Samples/Extern modes) keep truthful local-only
 * visual state and affect nothing else.
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

/** What the three Synth display dials edit (selected by the red display buttons). */
export type SynthMenu = 'wave' | 'oscEnv' | 'filterEnv' | 'ampEnv' | 'voice'

/** Encoders are relative controls: their local value is only a detent accumulator. */
const RELATIVE_ENCODERS = new Set(['program-dial', 'synth-dial-1', 'synth-dial-2', 'synth-dial-3'])

export class PresentationStore {
  private state: PresentationState
  private listeners = new Set<Listener>()
  private wiring: PanelWiring | null
  private tapTimes: number[] = []
  private clockTapTimes: number[] = []
  private synthMenu: SynthMenu = 'wave'
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

  getSynthMenu(): SynthMenu {
    return this.synthMenu
  }

  private setSynthMenu(menu: SynthMenu): void {
    if (this.synthMenu === menu) return
    this.synthMenu = menu
    this.emit()
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
      const chain = state.chains[chainForFocus(state.fxFocus)]
      const synth = state.synth.layers[state.synth.focusedLayer]
      const drawbarMatch = /^organ-drawbar-(\d)$/.exec(id)
      if (drawbarMatch) return state.organ.layers[state.organ.focusedLayer].drawbars[Number(drawbarMatch[1]) - 1] ?? 0
      switch (id) {
        case 'perf-master-level':
          return state.masterVolume
        case 'perf-mod-wheel':
          return Math.round(state.morphValues.wheel * 127)
        case 'perf-ctrl-pedal':
          return Math.round(state.morphValues.pedal * 127)
        case 'rotary-drive':
          return state.rotary.drive
        case 'organ-level-a':
          return state.organ.layers.A.level
        case 'organ-level-b':
          return state.organ.layers.B.level
        case 'piano-level-a':
          return state.layers.A.level
        case 'piano-level-b':
          return state.layers.B.level
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
          return synth.oscCtrl
        case 'osc-env-amt':
          return synth.oscEnv.amount
        case 'filter-freq':
          return synth.filter.freq
        case 'filter-res':
          return synth.filter.res
        case 'filter-env-amt':
          return synth.filter.envAmt
        case 'lfo-rate':
          return synth.lfo.rate
        case 'lfo-mod-amt':
          return synth.lfo.amount
        case 'glide':
          return synth.voice.glide
        case 'arp-rate':
          return synth.arp.rate
        case 'arp-range':
          return Math.round(((synth.arp.range - 1) / 3) * 127)
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
      const chain = state.chains[chainForFocus(state.fxFocus)]
      const synth = state.synth.layers[state.synth.focusedLayer]
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
        case 'organ-vib-on':
          return state.organ.layers[state.organ.focusedLayer].vibratoOn
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
        case 'synth-on':
          return state.synth.sectionOn
        case 'synth-layer-a':
          return state.synth.layers.A.enabled
        case 'synth-layer-b':
          return state.synth.layers.B.enabled
        case 'synth-layer-c':
          return state.synth.layers.C.enabled
        case 'filter-on':
          return synth.filter.on
        case 'arp-run':
          return synth.arp.run
        case 'kb-hold':
          return synth.arp.hold
        case 'live-mode':
          return state.programs.liveMode
        case 'layer-scene':
          return state.scenes.active === 'II'
        case 'split-onset':
          return state.split.on
        case 'transpose-onset':
          return state.transpose.on
        case 'morph-wheel':
          return state.morphCapture === 'wheel'
        case 'morph-ctrlped':
          return state.morphCapture === 'pedal'
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
      const shift = this.state.toggles['shift'] === true
      if (RELATIVE_ENCODERS.has(id)) {
        // Encoders are relative: convert the absolute widget value into detents.
        const previous = this.state.values[id] ?? 0
        const raw = clamped - previous
        const detents = Math.abs(raw) < 4 ? Math.sign(raw) : Math.round(raw / 4)
        this.setLocalValue(id, clamped)
        if (detents !== 0) this.turnEncoder(id, detents, shift)
        return
      }
      const drawbarMatch = /^organ-drawbar-(\d)$/.exec(id)
      if (drawbarMatch) {
        store.setDrawbar(Number(drawbarMatch[1]) - 1, clamped)
        return
      }
      switch (id) {
        case 'perf-master-level':
          store.setMasterVolume(clamped)
          return
        case 'perf-pitch-stick':
          // Visual position is local; the bend itself is canonical (±2 semitones).
          this.setLocalValue(id, clamped)
          wiring.controller.setPitchBend((clamped / 100) * 2)
          return
        case 'perf-mod-wheel':
          store.setMorphValue('wheel', clamped / 127)
          return
        case 'perf-ctrl-pedal':
          store.setMorphValue('pedal', clamped / 127)
          return
        case 'rotary-drive':
          store.setRotaryDrive(clamped)
          return
        case 'organ-level-a':
          store.setOrganLevel('A', clamped)
          return
        case 'organ-level-b':
          store.setOrganLevel('B', clamped)
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
          store.setSynthLevel('A', clamped)
          return
        case 'synth-level-b':
          store.setSynthLevel('B', clamped)
          return
        case 'synth-level-c':
          store.setSynthLevel('C', clamped)
          return
        case 'osc-ctrl':
          store.setOscCtrl(clamped)
          return
        case 'osc-env-amt':
          store.setOscEnv({ amount: clamped }, `Osc Env Amt ${clamped - 64 >= 0 ? '+' : ''}${clamped - 64}`)
          return
        case 'filter-freq':
          store.setSynthFilter({ freq: clamped }, `Filter Freq ${Math.round(mappings.filterFreqHz(clamped))} Hz`)
          return
        case 'filter-res':
          store.setSynthFilter({ res: clamped }, `Filter Res ${clamped}`)
          return
        case 'filter-env-amt':
          store.setSynthFilter({ envAmt: clamped }, `Filter Env Amt ${clamped}`)
          return
        case 'lfo-rate':
          if (shift) store.setClockSyncedRate('lfo', clamped)
          else store.setSynthLfo({ rate: clamped, clockSync: false }, `LFO Rate ${clamped}`)
          return
        case 'lfo-mod-amt':
          store.setSynthLfo({ amount: clamped }, `LFO Amount ${clamped}`)
          return
        case 'glide':
          store.setSynthVoice({ glide: clamped }, `Glide ${clamped}`)
          return
        case 'arp-rate':
          if (shift) store.setClockSyncedRate('arp', clamped)
          else store.setSynthArp({ rate: clamped, clockSync: false }, `Arp Rate ${Math.round(synthMappings.arpBpm(clamped))} BPM`)
          return
        case 'arp-range': {
          const range = (1 + Math.min(3, Math.floor((clamped / 128) * 4))) as 1 | 2 | 3 | 4
          const gate = store.getState().synth.layers[store.getState().synth.focusedLayer].arp.mode === 'Gate'
          store.setSynthArp({ range }, gate ? `Gate Env ${range}` : `Arp Range ${range} oct`)
          return
        }
        case 'mod1-rate':
          if (shift) store.setClockSyncedRate('mod1', clamped)
          else store.updateUnit('mod1', { rate: clamped }, `Mod 1 Rate ${clamped}`)
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
          if (shift) store.setClockSyncedRate('delay', clamped)
          else store.updateUnit('delay', { tempo: clamped }, `Delay Tempo ${Math.round(mappings.delayTempoMs(clamped))} ms`)
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

  /** Relative encoder movement, routed by encoder identity and the active Synth display menu. */
  private turnEncoder(id: string, detents: number, shift: boolean): void {
    const store = this.wiring!.instrument
    if (id === 'program-dial') {
      store.turnDial(detents, shift)
      return
    }
    const dial = id === 'synth-dial-1' ? 0 : id === 'synth-dial-2' ? 1 : 2
    const stepParam = (current: number) => Math.max(0, Math.min(127, current + detents * 4))
    const synth = store.getState().synth.layers[store.getState().synth.focusedLayer]
    switch (this.synthMenu) {
      case 'wave':
        if (dial === 0) store.selectSynthWave(detents)
        else store.setLastEdit('Dial: no parameter on this page')
        return
      case 'oscEnv': {
        const key = (['attack', 'decay', 'release'] as const)[dial]!
        const next = stepParam(synth.oscEnv[key])
        store.setOscEnv({ [key]: next }, `Osc Env ${key} ${envLabel(next)}`)
        return
      }
      case 'filterEnv': {
        const key = (['attack', 'decay', 'release'] as const)[dial]!
        const next = stepParam(synth.filterEnv[key])
        store.setFilterEnv({ [key]: next }, `Filter Env ${key} ${envLabel(next)}`)
        return
      }
      case 'ampEnv': {
        const key = (['attack', 'decay', 'release'] as const)[dial]!
        const next = stepParam(synth.ampEnv[key])
        store.setAmpEnv({ [key]: next }, `Amp Env ${key} ${envLabel(next)}`)
        return
      }
      case 'voice':
        if (dial === 0) {
          const next = stepParam(synth.voice.vibRate)
          store.setSynthVoice({ vibRate: next }, `Vibrato Rate ${synthMappings.vibratoHz(next).toFixed(1)} Hz`)
        } else if (dial === 1) {
          const next = stepParam(synth.voice.vibAmount)
          store.setSynthVoice({ vibAmount: next }, `Vibrato Amount ${(synth.voice.vibAmount / 12.7).toFixed(1)}`)
        } else {
          store.setLastEdit('Dial: no parameter on this page')
        }
        return
    }
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
        /* ---------------------------------------------------------- piano -- */
        case 'piano-on':
          store.setPianoSectionOn(!store.getState().piano.sectionOn)
          return
        case 'piano-layer-a':
          store.toggleLayerEnabled('A')
          return
        case 'piano-layer-b':
          store.toggleLayerEnabled('B')
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
        /* ---------------------------------------------------------- organ -- */
        case 'organ-on':
          store.setOrganSectionOn(!store.getState().organ.sectionOn)
          return
        case 'organ-layer-a':
          store.toggleOrganLayer('A')
          return
        case 'organ-layer-b':
          store.toggleOrganLayer('B')
          return
        case 'organ-model':
          store.cycleOrganModel()
          return
        case 'organ-vib-select':
          store.cycleVibratoMode()
          return
        case 'organ-vib-on':
          store.toggleVibratoOn()
          return
        case 'organ-perc-on':
          store.togglePercussion('on')
          return
        case 'organ-perc-volume':
          store.togglePercussion('soft')
          return
        case 'organ-perc-decay':
          store.togglePercussion('fast')
          return
        case 'organ-perc-harmonic':
          store.togglePercussion('third')
          return
        case 'organ-octave-down':
          store.shiftOrganOctave(-1)
          return
        case 'organ-octave-up':
          store.shiftOrganOctave(1)
          return
        /* --------------------------------------------------------- rotary -- */
        case 'rotary-speed':
          store.toggleRotarySpeed()
          return
        case 'rotary-stop-mode':
          store.toggleRotaryStop()
          return
        case 'rotary-source':
          store.toggleOrganToRotary()
          return
        case 'rotary-morph':
          store.toggleRotarySpeedMorph()
          return
        /* -------------------------------------------------------- program -- */
        case 'panic':
          wiring.controller.panic()
          store.setLastEdit('PANIC — all notes off')
          return
        case 'morph-wheel':
          if (shift) store.clearMorphAssignments('wheel')
          else store.toggleMorphCapture('wheel')
          return
        case 'morph-ctrlped':
          if (shift) store.clearMorphAssignments('pedal')
          else store.toggleMorphCapture('pedal')
          return
        case 'split-onset':
          if (shift) store.toggleSplitEdit()
          else store.toggleSplit()
          return
        case 'mstclk-tap': {
          if (shift) {
            store.toggleClockSet()
            return
          }
          const time = this.now()
          this.clockTapTimes = this.clockTapTimes.filter((t) => time - t < 3000)
          this.clockTapTimes.push(time)
          if (this.clockTapTimes.length >= 2) {
            const intervals: number[] = []
            for (let i = 1; i < this.clockTapTimes.length; i++) intervals.push(this.clockTapTimes[i]! - this.clockTapTimes[i - 1]!)
            const average = intervals.reduce((a, b) => a + b, 0) / intervals.length
            store.setClockBpm(60000 / average)
          } else {
            store.setLastEdit('Mst Clk tap…')
          }
          return
        }
        case 'transpose-onset':
          if (shift) store.toggleTransposeSet()
          else store.toggleTranspose()
          return
        case 'prog-view':
          store.toggleListView()
          return
        case 'store':
          if (shift) store.cancelStore()
          else store.pressStore()
          return
        case 'store-as':
          store.pressStoreAs()
          return
        case 'page-left':
          store.stepPage(-1)
          return
        case 'page-right':
          store.stepPage(1)
          return
        case 'live-mode':
          store.toggleLiveMode()
          return
        case 'layer-scene':
          store.toggleScene()
          return
        case 'solo-undo':
          if (shift) store.toggleSolo()
          else store.undoProgramChange()
          return
        case 'program-1':
        case 'program-2':
        case 'program-3':
        case 'program-4':
        case 'program-5':
        case 'program-6':
        case 'program-7':
        case 'program-8':
          store.selectProgramButton(Number(id.slice(-1)) - 1)
          return
        /* ---------------------------------------------------------- synth -- */
        case 'synth-on':
          store.setSynthSectionOn(!store.getState().synth.sectionOn)
          return
        case 'synth-layer-a':
          store.toggleSynthLayer('A')
          return
        case 'synth-layer-b':
          store.toggleSynthLayer('B')
          return
        case 'synth-layer-c':
          store.toggleSynthLayer('C')
          return
        case 'waveform-select':
          store.cycleSynthCategory()
          this.setSynthMenu('wave')
          return
        case 'sound-init':
          store.soundInit()
          return
        case 'osc-pitch-smp':
          this.setSynthMenu('wave')
          store.setLastEdit('Display: waveform (dial 1 selects)')
          return
        case 'osc-envelope':
          if (shift) {
            const toPitch = !focusedSynth(store).oscEnv.toPitch
            store.setOscEnv({ toPitch }, `Osc Env → ${toPitch ? 'Pitch' : 'Osc Ctrl'}`)
          } else if (this.synthMenu === 'oscEnv') {
            const velocity = !focusedSynth(store).oscEnv.velocity
            store.setOscEnv({ velocity }, `Osc Env Velocity ${velocity ? 'On' : 'Off'}`)
          } else {
            this.setSynthMenu('oscEnv')
            store.setLastEdit('Display: osc envelope A/D/R (press again: velocity)')
          }
          return
        case 'filter-envelope':
          if (this.synthMenu === 'filterEnv') {
            const velocity = !focusedSynth(store).filterEnv.velocity
            store.setFilterEnv({ velocity }, `Filter Env Velocity ${velocity ? 'On' : 'Off'}`)
          } else {
            this.setSynthMenu('filterEnv')
            store.setLastEdit('Display: filter envelope A/D/R (press again: velocity)')
          }
          return
        case 'amp-envelope':
          if (this.synthMenu === 'ampEnv') {
            const next = ((focusedSynth(store).ampEnv.velocity + 1) % 4) as 0 | 1 | 2 | 3
            store.setAmpEnv({ velocity: next }, `Amp Env Velocity ${next === 0 ? 'Off' : next}`)
          } else {
            this.setSynthMenu('ampEnv')
            store.setLastEdit('Display: amp envelope A/D/R (press again: velocity)')
          }
          return
        case 'filter-type':
          if (shift) store.cycleFilterTracking()
          else store.cycleFilterType()
          return
        case 'filter-on':
          if (shift) store.cycleFilterDrive()
          else store.setSynthFilter({ on: !focusedSynth(store).filter.on }, `Filter ${focusedSynth(store).filter.on ? 'Off' : 'On'}`)
          return
        case 'lfo-waveform':
          if (shift) store.cycleLfoDestination()
          else store.cycleLfoWave()
          return
        case 'voice-mode':
          if (shift) store.cycleNotePriority()
          else store.cycleVoiceMode()
          return
        case 'vibrato-mode':
          store.cycleSynthVibrato()
          return
        case 'vibrato-menu':
          this.setSynthMenu('voice')
          store.setLastEdit('Display: vibrato rate/amount')
          return
        case 'synth-unison':
          store.cycleSynthUnison()
          return
        case 'arp-mode':
          store.cycleArpMode()
          return
        case 'arp-menu':
          store.cycleArpDirection()
          return
        case 'arp-run':
          store.setSynthArp({ run: !focusedSynth(store).arp.run }, `Arp Run ${focusedSynth(store).arp.run ? 'Off' : 'On'}`)
          return
        case 'kb-hold':
          store.setSynthArp({ hold: !focusedSynth(store).arp.hold }, `KB Hold ${focusedSynth(store).arp.hold ? 'Off' : 'On'}`)
          return
        case 'synth-octave-down':
          store.shiftSynthOctave(-1)
          return
        case 'synth-octave-up':
          store.shiftSynthOctave(1)
          return
        /* -------------------------------------------------------- effects -- */
        case 'effects-on':
        case 'all-fx-off':
          store.toggleAllFxOff()
          return
        case 'fx-focus-piano': {
          // Cycle: focus A -> focus B -> Group (A+B) -> focus A …
          const state = store.getState()
          if (state.fxFocus.section !== 'piano') {
            store.setFxFocus({ section: 'piano', layer: state.focusedLayer })
          } else if (state.fxGroupPiano) {
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
          // Cycle: focus A -> B -> C -> Group (A+B+C) -> A …
          const state = store.getState()
          if (state.fxFocus.section !== 'synth') {
            store.setFxFocus({ section: 'synth', layer: state.synth.focusedLayer })
          } else if (state.fxGroupSynth) {
            store.toggleFxGroupSynth()
            store.setFxFocus({ section: 'synth', layer: 'A' })
          } else if (state.synth.focusedLayer === 'C') {
            store.toggleFxGroupSynth()
          } else {
            store.setFxFocus({ section: 'synth', layer: state.synth.focusedLayer === 'A' ? 'B' : 'C' })
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
        case 'shift': {
          // Functional modifier; latched state kept locally below. Pressing
          // Shift exits transient modes ("EXIT"); releasing it loads the
          // numeric list-view selection.
          const wasDown = this.state.toggles['shift'] === true
          if (!wasDown) store.exitModes()
          else store.closeListView()
          break
        }
      }
    }
    const current = this.state.toggles[id] ?? false
    this.state = { ...this.state, toggles: { ...this.state.toggles, [id]: !current } }
    for (const listener of this.listeners) listener()
  }
}

function focusedSynth(store: InstrumentStore) {
  const state = store.getState()
  return state.synth.layers[state.synth.focusedLayer]
}

function envLabel(value: number): string {
  const seconds = synthMappings.envSeconds(value)
  if (synthMappings.isSustainDecay(value)) return 'Sustain'
  return seconds >= 1 ? `${seconds.toFixed(1)} s` : `${Math.round(seconds * 1000)} ms`
}

export function usePresentationValue(store: PresentationStore, id: string): number {
  return useSyncExternalStore(store.subscribe, () => store.getValue(id))
}

export function usePresentationToggle(store: PresentationStore, id: string): boolean {
  return useSyncExternalStore(store.subscribe, () => store.getToggle(id))
}
