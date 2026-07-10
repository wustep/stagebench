/**
 * Bind hardware control IDs to piano/effects engine state.
 * Organ/Synth/Program stay presentation-only (honesty contract).
 */

import type { PianoEngine } from '../audio/piano-engine'
import {
  AMP_TYPES,
  cycleEnum,
  DELAY_FILTERS,
  dynCompFromKnob,
  kbTouchFromKnob,
  MOD1_TYPES,
  MOD2_TYPES,
  PIANO_TYPES,
  REVERB_TYPES,
  timbreFromKnob,
  type AmpType,
  type DelayFilter,
  type LayerId,
  type Mod1Type,
  type Mod2Type,
  type PianoType,
  type ReverbType,
  type Unison,
} from '../model/piano-types'
import { hardwareStore } from '../state/hardware-store'

const FUNCTIONAL_PREFIXES = ['piano-', 'fx-', 'perf-master-level', 'perf-panic']

export function isFunctionalControl(id: string): boolean {
  if (id === 'perf-master-level' || id === 'perf-panic') return true
  return id.startsWith('piano-') || id.startsWith('fx-')
}

const TYPE_BUTTONS: Record<string, PianoType> = {
  'piano-type-grand': 'Grand',
  'piano-type-upright': 'Upright',
  'piano-type-electric': 'Electric',
  'piano-type-clav': 'Clav',
  'piano-type-digital': 'Digital',
  'piano-type-misc': 'Misc',
}

let unisonPresses = 0
let mod1TypeIdx = 1
let mod2TypeIdx = 0
let reverbTypeIdx = 4

export function resetBindingCounters(): void {
  unisonPresses = 0
  mod1TypeIdx = 1
  mod2TypeIdx = 0
  reverbTypeIdx = 4
}

function focusedChainKey(engine: PianoEngine): 'PianoA' | 'PianoB' {
  const fx = engine.getEffectsState()
  if (fx.layerFocus === 'PianoB') return 'PianoB'
  return 'PianoA'
}

function editFocusedChain(engine: PianoEngine, mutate: (c: ReturnType<typeof engine.getEffectsState>['chains']['PianoA']) => void) {
  const key = focusedChainKey(engine)
  engine.updateChain(key, (c) => {
    const next = { ...c, mod1: { ...c.mod1 }, mod2: { ...c.mod2 }, delay: { ...c.delay }, ampEq: { ...c.ampEq }, compressor: { ...c.compressor }, reverb: { ...c.reverb } }
    mutate(next)
    return next
  })
}

/** Apply a control value change to the engine when functional */
export function applyControlToEngine(engine: PianoEngine, id: string, value: number): void {
  if (!isFunctionalControl(id)) return

  if (id === 'perf-master-level') {
    engine.setMasterLevel(value)
    return
  }

  // Piano continuous
  if (id === 'piano-level-a') {
    engine.updateLayer('A', { level: value })
    return
  }
  if (id === 'piano-level-b') {
    engine.updateLayer('B', { level: value })
    return
  }
  if (id === 'piano-kb-touch') {
    engine.setPianoState({ kbTouch: kbTouchFromKnob(value) })
    return
  }
  if (id === 'piano-dyn-comp') {
    engine.setPianoState({ dynComp: dynCompFromKnob(value) })
    return
  }
  if (id === 'piano-timbre') {
    engine.setPianoState({ timbre: timbreFromKnob(engine.getPianoState().type, value) })
    return
  }
  if (id === 'piano-model') {
    engine.setPianoState({ modelIndex: Math.floor(value * 8) })
    return
  }

  // Effects knobs
  if (id === 'fx-mod1-rate') {
    editFocusedChain(engine, (c) => {
      c.mod1.rate = value
    })
    return
  }
  if (id === 'fx-mod1-amount') {
    editFocusedChain(engine, (c) => {
      c.mod1.amount = value
    })
    return
  }
  if (id === 'fx-mod2-rate') {
    editFocusedChain(engine, (c) => {
      c.mod2.rate = value
    })
    return
  }
  if (id === 'fx-mod2-amount') {
    editFocusedChain(engine, (c) => {
      c.mod2.amount = value
    })
    return
  }
  if (id === 'fx-delay-time') {
    editFocusedChain(engine, (c) => {
      c.delay.tempo = value
    })
    return
  }
  if (id === 'fx-delay-feedback') {
    editFocusedChain(engine, (c) => {
      c.delay.feedback = value
    })
    return
  }
  if (id === 'fx-delay-mix') {
    editFocusedChain(engine, (c) => {
      c.delay.mix = value
    })
    return
  }
  if (id === 'fx-amp-drive') {
    editFocusedChain(engine, (c) => {
      c.ampEq.drive = value
    })
    return
  }
  if (id === 'fx-eq-bass') {
    editFocusedChain(engine, (c) => {
      c.ampEq.bass = value
    })
    return
  }
  if (id === 'fx-eq-mid') {
    editFocusedChain(engine, (c) => {
      c.ampEq.mid = value
    })
    return
  }
  if (id === 'fx-eq-treble') {
    editFocusedChain(engine, (c) => {
      c.ampEq.treble = value
    })
    return
  }
  if (id === 'fx-comp-amount') {
    editFocusedChain(engine, (c) => {
      c.compressor.amount = value
    })
    return
  }
  if (id === 'fx-reverb-amount') {
    editFocusedChain(engine, (c) => {
      c.reverb.mix = value
    })
    return
  }
  if (id === 'fx-reverb-time') {
    editFocusedChain(engine, (c) => {
      c.reverb.time = value
    })
    return
  }
}

/** Apply button press to engine */
export function applyButtonToEngine(engine: PianoEngine, id: string): void {
  if (!isFunctionalControl(id)) return

  if (id === 'perf-panic') {
    engine.allNotesOff()
    return
  }

  // Piano type exclusive selection
  if (id in TYPE_BUTTONS) {
    const type = TYPE_BUTTONS[id]!
    engine.setPianoState({ type })
    for (const [btn, t] of Object.entries(TYPE_BUTTONS)) {
      hardwareStore.setValue(btn, t === type ? 1 : 0)
    }
    // refresh timbre scale for type family
    const timbreKnob = hardwareStore.getValue('piano-timbre')
    engine.setPianoState({ timbre: timbreFromKnob(type, timbreKnob) })
    return
  }

  if (id === 'piano-section-on') {
    const on = hardwareStore.getValue(id) > 0.5
    engine.setPianoState({ sectionOn: on })
    return
  }

  if (id === 'piano-layer-a') {
    // focus + enable toggle pattern: first press focuses; if already focus, toggle enable
    const piano = engine.getPianoState()
    if (piano.focus !== 'A') {
      engine.setPianoState({ focus: 'A' })
      hardwareStore.setValue('piano-layer-a', 1)
      hardwareStore.setValue('piano-layer-b', piano.layers.B.enabled ? 1 : 0)
      engine.setEffectsState({ layerFocus: 'PianoA', focusSection: 'Piano' })
      syncFxFocusButtons('PianoA')
    } else {
      const en = !(hardwareStore.getValue(id) > 0.5)
      // store already toggled by pressButton — read inverted
      const enabled = hardwareStore.getValue(id) > 0.5
      engine.updateLayer('A', { enabled })
      void en
    }
    return
  }

  if (id === 'piano-layer-b') {
    const piano = engine.getPianoState()
    if (piano.focus !== 'B') {
      engine.setPianoState({ focus: 'B' })
      hardwareStore.setValue('piano-layer-b', 1)
      engine.setEffectsState({ layerFocus: 'PianoB', focusSection: 'Piano' })
      syncFxFocusButtons('PianoB')
      // enable B if it was off so focus is useful
      if (!piano.layers.B.enabled) {
        engine.updateLayer('B', { enabled: true, level: Math.max(0.5, piano.layers.B.level) })
        hardwareStore.setValue('piano-level-b', Math.max(0.5, piano.layers.B.level))
        hardwareStore.setValue('piano-layer-b', 1)
      }
    } else {
      const enabled = hardwareStore.getValue(id) > 0.5
      engine.updateLayer('B', { enabled })
    }
    return
  }

  if (id === 'piano-oct-a-down') {
    const o = Math.max(-2, engine.getPianoState().layers.A.octave - 1)
    engine.updateLayer('A', { octave: o })
    return
  }
  if (id === 'piano-oct-a-up') {
    const o = Math.min(2, engine.getPianoState().layers.A.octave + 1)
    engine.updateLayer('A', { octave: o })
    return
  }
  if (id === 'piano-oct-b-down') {
    const o = Math.max(-2, engine.getPianoState().layers.B.octave - 1)
    engine.updateLayer('B', { octave: o })
    return
  }
  if (id === 'piano-oct-b-up') {
    const o = Math.min(2, engine.getPianoState().layers.B.octave + 1)
    engine.updateLayer('B', { octave: o })
    return
  }

  if (id === 'piano-unison') {
    unisonPresses++
    const levels: Unison[] = ['Off', 1, 2, 3]
    const u = levels[unisonPresses % 4]!
    engine.setPianoState({ unison: u })
    hardwareStore.setValue('piano-unison', u === 'Off' ? 0 : 1)
    return
  }

  if (id === 'piano-soft-release') {
    engine.setPianoState({ softRelease: hardwareStore.getValue(id) > 0.5 })
    return
  }
  if (id === 'piano-string-res') {
    engine.setPianoState({ stringRes: hardwareStore.getValue(id) > 0.5 })
    return
  }
  if (id === 'piano-sustped') {
    engine.updateLayer('A', { sustped: hardwareStore.getValue(id) > 0.5 })
    engine.updateLayer('B', { sustped: hardwareStore.getValue(id) > 0.5 })
    return
  }
  if (id === 'piano-pstick') {
    engine.updateLayer('A', { pstick: hardwareStore.getValue(id) > 0.5 })
    engine.updateLayer('B', { pstick: hardwareStore.getValue(id) > 0.5 })
    return
  }

  // Effects focus
  if (id === 'fx-focus-piano-a') {
    engine.setEffectsState({ layerFocus: 'PianoA', focusSection: 'Piano' })
    syncFxFocusButtons('PianoA')
    engine.setPianoState({ focus: 'A' })
    return
  }
  if (id === 'fx-focus-piano-b') {
    engine.setEffectsState({ layerFocus: 'PianoB', focusSection: 'Piano' })
    syncFxFocusButtons('PianoB')
    engine.setPianoState({ focus: 'B' })
    return
  }
  if (id === 'fx-focus-organ-a' || id === 'fx-focus-organ-b') {
    engine.setEffectsState({ focusSection: 'Organ', layerFocus: id.endsWith('-b') ? 'OrganB' : 'OrganA' })
    syncFxFocusButtons(id.endsWith('-b') ? 'OrganB' : 'OrganA')
    return
  }
  if (id.startsWith('fx-focus-synth')) {
    const map: Record<string, 'SynthA' | 'SynthB' | 'SynthC'> = {
      'fx-focus-synth-a': 'SynthA',
      'fx-focus-synth-b': 'SynthB',
      'fx-focus-synth-c': 'SynthC',
    }
    engine.setEffectsState({ focusSection: 'Synth', layerFocus: map[id] ?? 'SynthA' })
    syncFxFocusButtons(map[id] ?? 'SynthA')
    return
  }

  if (id === 'fx-group-1') {
    engine.setEffectsState({ pianoGroup: hardwareStore.getValue(id) > 0.5 })
    return
  }
  if (id === 'fx-group-2') {
    // group 2 = ungroup piano (independent chains)
    const on = hardwareStore.getValue(id) > 0.5
    engine.setEffectsState({ pianoGroup: !on })
    return
  }

  if (id === 'fx-bypass') {
    engine.setEffectsState({ allBypass: hardwareStore.getValue(id) > 0.5 })
    return
  }

  if (id === 'fx-global') {
    // toggle global on delay/comp/reverb for focused chain
    const on = hardwareStore.getValue(id) > 0.5
    editFocusedChain(engine, (c) => {
      c.delay.global = on
      c.compressor.global = on
      c.reverb.global = on
    })
    if (on) {
      const chain = engine.getEffectsState().chains[focusedChainKey(engine)]
      engine.setEffectsState({
        globalDelay: { ...chain.delay, global: true, on: chain.delay.on },
        globalCompressor: { ...chain.compressor, global: true, on: chain.compressor.on },
        globalReverb: { ...chain.reverb, global: true, on: chain.reverb.on },
      })
    }
    return
  }

  if (id === 'fx-mod1-on') {
    editFocusedChain(engine, (c) => {
      c.mod1.on = hardwareStore.getValue(id) > 0.5
    })
    return
  }
  if (id === 'fx-mod2-on') {
    editFocusedChain(engine, (c) => {
      c.mod2.on = hardwareStore.getValue(id) > 0.5
    })
    return
  }
  if (id === 'fx-delay-on') {
    editFocusedChain(engine, (c) => {
      c.delay.on = hardwareStore.getValue(id) > 0.5
    })
    return
  }
  if (id === 'fx-amp-on') {
    editFocusedChain(engine, (c) => {
      c.ampEq.on = hardwareStore.getValue(id) > 0.5
    })
    return
  }
  if (id === 'fx-comp-on') {
    editFocusedChain(engine, (c) => {
      c.compressor.on = hardwareStore.getValue(id) > 0.5
    })
    return
  }
  if (id === 'fx-reverb-on') {
    editFocusedChain(engine, (c) => {
      c.reverb.on = hardwareStore.getValue(id) > 0.5
    })
    return
  }

  if (id === 'fx-mod1-type') {
    mod1TypeIdx = (mod1TypeIdx + 1) % MOD1_TYPES.length
    const t = MOD1_TYPES[mod1TypeIdx]!
    editFocusedChain(engine, (c) => {
      c.mod1.type = t
    })
    return
  }
  if (id === 'fx-mod2-type') {
    mod2TypeIdx = (mod2TypeIdx + 1) % MOD2_TYPES.length
    const t = MOD2_TYPES[mod2TypeIdx]!
    editFocusedChain(engine, (c) => {
      c.mod2.type = t
    })
    return
  }
  if (id === 'fx-reverb-type') {
    reverbTypeIdx = (reverbTypeIdx + 1) % REVERB_TYPES.length
    const t = REVERB_TYPES[reverbTypeIdx]!
    editFocusedChain(engine, (c) => {
      c.reverb.type = t
    })
    return
  }
  if (id === 'fx-to-rotary') {
    const on = hardwareStore.getValue(id) > 0.5
    editFocusedChain(engine, (c) => {
      if (on) {
        c.ampEq.type = 'To Rotary'
        c.ampEq.on = true
      } else {
        c.ampEq.type = 'EQ only'
      }
    })
    engine.setEffectsState({
      rotary: { ...engine.getEffectsState().rotary, on },
    })
    hardwareStore.setValue('fx-amp-on', on ? 1 : hardwareStore.getValue('fx-amp-on'))
    return
  }

  void FUNCTIONAL_PREFIXES
  void cycleEnum
  void AMP_TYPES
  void DELAY_FILTERS
  void PIANO_TYPES
}

function syncFxFocusButtons(focus: string) {
  const ids = [
    'fx-focus-organ-a',
    'fx-focus-organ-b',
    'fx-focus-piano-a',
    'fx-focus-piano-b',
    'fx-focus-synth-a',
    'fx-focus-synth-b',
    'fx-focus-synth-c',
  ]
  const map: Record<string, string> = {
    OrganA: 'fx-focus-organ-a',
    OrganB: 'fx-focus-organ-b',
    PianoA: 'fx-focus-piano-a',
    PianoB: 'fx-focus-piano-b',
    SynthA: 'fx-focus-synth-a',
    SynthB: 'fx-focus-synth-b',
    SynthC: 'fx-focus-synth-c',
  }
  const active = map[focus]
  for (const id of ids) {
    hardwareStore.setValue(id, id === active ? 1 : 0)
  }
}

/** Subscribe store → engine for continuous values */
export function attachEngineBindings(engine: PianoEngine): () => void {
  // Initial sync from store defaults
  applyControlToEngine(engine, 'perf-master-level', hardwareStore.getValue('perf-master-level'))
  applyControlToEngine(engine, 'piano-level-a', hardwareStore.getValue('piano-level-a'))
  applyControlToEngine(engine, 'piano-level-b', hardwareStore.getValue('piano-level-b'))
  applyControlToEngine(engine, 'piano-kb-touch', hardwareStore.getValue('piano-kb-touch'))
  applyControlToEngine(engine, 'piano-dyn-comp', hardwareStore.getValue('piano-dyn-comp'))
  applyControlToEngine(engine, 'piano-timbre', hardwareStore.getValue('piano-timbre'))

  let last = { ...hardwareStore.getValues() }
  return hardwareStore.subscribe(() => {
    const vals = hardwareStore.getValues()
    for (const id of Object.keys(vals)) {
      if (vals[id] !== last[id]) {
        if (isFunctionalControl(id)) {
          // buttons handled at press time; continuous here
          const kind = id.includes('level') || id.includes('rate') || id.includes('amount') ||
            id.includes('time') || id.includes('feedback') || id.includes('mix') ||
            id.includes('drive') || id.includes('bass') || id.includes('mid') ||
            id.includes('treble') || id.includes('kb-touch') || id.includes('dyn-comp') ||
            id.includes('timbre') || id.includes('model') || id === 'perf-master-level'
          if (kind) applyControlToEngine(engine, id, vals[id]!)
        }
      }
    }
    last = { ...vals }
  })
}

export function handleButtonPress(engine: PianoEngine, id: string): void {
  // hardwareStore.pressButton already toggled presentation; sync engine
  applyButtonToEngine(engine, id)
}

export type { LayerId, PianoType, Mod1Type, Mod2Type, AmpType, ReverbType, DelayFilter }
