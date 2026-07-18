/**
 * Panel bindings: the honesty boundary (Phase 3).
 *
 * FUNCTIONAL controls write through to the engine's canonical state. The
 * spec-excluded set stays decorative (moves, presentation only) and is
 * listed in UNSUPPORTED_CONTROLS with its spec citation — the UI notes and
 * the hardware.bindings audit both read these tables. Everything is
 * explicit so tests can assert the contract both ways.
 */

import type { PianoEngine } from '../audio/engine'
import type { PianoTypeId } from '../audio/piano-models'
import { getControlValue, getControlPresses, setControlValue } from './hardware-store'
import { KB_TOUCH_LABELS } from './piano-state'
import { AMP_TYPES, MOD1_TYPES, MOD2_TYPES, REVERB_TYPES, focusedChainId, type ChainId } from './effects-state'
import { ORGAN_MODELS, VIBRATO_MODES } from './organ-state'
import { SYNTH_WAVES, FILTER_TYPES } from './synth-state'
import { SPLIT_POSITIONS, type RoutableLayerId } from './program-state'
import type { MorphSource } from './morph'

/** Controls that drive real engine state in Phase 3. Everything else is decorative. */
export const FUNCTIONAL_CONTROLS: ReadonlySet<string> = new Set([
  'perf.pitchStick',
  'perf.modWheel',
  'perf.ctrlPedal',
  'perf.masterLevel',
  // Piano (inherited)
  'piano.on',
  'piano.layerA',
  'piano.layerB',
  'piano.level',
  'piano.octaveShift',
  'piano.type',
  'piano.kbTouch',
  'piano.dynComp',
  'piano.timbre',
  'piano.unison',
  'piano.softRelease',
  'piano.stringRes',
  'piano.sustainPedal',
  'piano.pitchStick',
  // Organ
  'organ.on',
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `organ.drawbar.${n}`),
  'organ.model',
  'organ.vibratoChorus',
  'organ.vibratoChorusOn',
  'organ.percussionOn',
  'organ.percussionDecay',
  'organ.percussionHarmonic',
  'organ.percussionSoft',
  'organ.rotarySpeed',
  'organ.rotaryDrive',
  'organ.rotaryRoute',
  'organ.layerA',
  'organ.layerB',
  'organ.sustainPedal',
  'organ.pitchStick',
  'organ.octaveShift',
  'organ.level',
  // Program / morph / clock
  'program.dial',
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `program.button.${n}`),
  'program.pageLeft',
  'program.pageRight',
  'program.liveMode',
  'program.layerScene',
  'program.store',
  'program.split',
  'program.splitLow',
  'program.splitMid',
  'program.splitHigh',
  'program.kbZone',
  'program.morphWheel',
  'program.morphCtrlPedal',
  'program.kbHold',
  'program.panic',
  'program.transpose',
  'program.shift',
  'program.mstClock',
  // Synth
  'synth.on',
  'synth.layerA',
  'synth.layerB',
  'synth.layerC',
  'synth.level',
  'synth.octaveShift',
  'synth.sustainPedal',
  'synth.pitchStick',
  'synth.oscShape',
  'synth.oscWave',
  'synth.oscCoarse',
  'synth.oscFine',
  'synth.envToPitch',
  'synth.filterCutoff',
  'synth.filterResonance',
  'synth.filterType',
  'synth.filterEnvAmount',
  'synth.filterKbTrack',
  'synth.filterDrive',
  'synth.ampAttack',
  'synth.ampDecay',
  'synth.ampRelease',
  'synth.modAttack',
  'synth.modDecay',
  'synth.modRelease',
  'synth.lfoRate',
  'synth.lfoAmount',
  'synth.lfoWave',
  'synth.lfoDest',
  'synth.arpRate',
  'synth.arpOn',
  'synth.arpMode',
  'synth.arpPattern',
  'synth.arpRange',
  'synth.unison',
  'synth.voiceMode',
  'synth.priority',
  'synth.glideRate',
  'synth.vibrato',
  'synth.arpHold',
  // Layer effects (inherited)
  'fx.on',
  'fx.focusA',
  'fx.focusB',
  'fx.groupPiano',
  'fx.effect1Type',
  'fx.effect1Rate',
  'fx.effect1Amount',
  'fx.effect1On',
  'fx.effect2Type',
  'fx.effect2Rate',
  'fx.effect2Amount',
  'fx.effect2On',
  'fx.eqBassGain',
  'fx.eqMidGain',
  'fx.eqMidFreq',
  'fx.eqTrebleGain',
  'fx.ampType',
  'fx.ampDrive',
  'fx.ampOn',
  'fx.delayRate',
  'fx.delayFeedback',
  'fx.delayMix',
  'fx.delayOn',
  'fx.delayTempo',
  'fx.delayPingPong',
  'fx.delayFilter',
  'fx.delayGlobal',
  'fx.compAmount',
  'fx.compOn',
  'fx.compFast',
  'fx.compGlobal',
  'fx.reverbAmount',
  'fx.reverbType',
  'fx.reverbOn',
  'fx.reverbBright',
  'fx.reverbGlobal',
  'fx.rotaryOn',
  'fx.rotarySpeed',
  'fx.rotaryDrive',
])

export function isFunctionalControl(id: string): boolean {
  return FUNCTIONAL_CONTROLS.has(id)
}

/**
 * Spec-excluded controls: they exist visually, move/press accessibly, and do
 * nothing — listed here with citations (the UI notes surface this list).
 */
export const UNSUPPORTED_CONTROLS: Readonly<Record<string, string>> = {
  'program.morphAftertouch': 'Aftertouch morph source — excluded (programs spec; browser keyboards have no aftertouch)',
  'program.panelASelect': 'Dual panel / Section Edit — excluded (programs spec: Num Pad, Section Edit, Layer Init)',
  'program.panelBSelect': 'Dual panel / Section Edit — excluded (programs spec: Num Pad, Section Edit, Layer Init)',
  'organ.panelASelect': 'Dual panel select — excluded (organ spec: preset/drawbar-live panel concepts)',
  'organ.panelBSelect': 'Dual panel select — excluded (organ spec: preset/drawbar-live panel concepts)',
  'piano.modelSelect': 'Per-section preset library — excluded (piano + programs specs)',
  'synth.oscMix': 'Osc Mix — not in the required Analog-mode parameter list (synth spec; Osc Ctrl list is required instead)',
}

export function isUnsupportedControl(id: string): boolean {
  return id in UNSUPPORTED_CONTROLS
}

const TYPE_BY_INDEX: readonly PianoTypeId[] = ['grand', 'upright', 'electric', 'clav', 'digital', 'misc']

// ------------------------------------------------------------------ helpers

/** FX focus: A/B buttons + the section that owns panel focus. */
function focusedChainFromPanel(engine: PianoEngine): ChainId {
  const fx = engine.effects
  // Panel section focus follows the last-touched section's focus controls;
  // the stored effects.focusSection/focusLayer are authoritative.
  return focusedChainId(fx)
}

function cycle(current: number, count: number): number {
  return ((Math.round(current) % count) + count) % count
}

/** Octave cycle: 0 → +12 → −12 → 0. */
function octaveFromPresses(pressValue: number): number {
  const m = cycle(pressValue, 3)
  return m === 0 ? 0 : m === 1 ? 12 : -12
}

// ------------------------------------------------------------------ main sync

/**
 * Push the current panel values for every functional control into the engine.
 * Called on initial mount and whenever any functional control changes.
 * Pass `{ adoptSnapshot: true }` after a bulk panel reflection so the dirty
 * baseline follows the panel (mount-time sync is not a user edit).
 */
export function syncFunctionalControls(engine: PianoEngine, opts: { adoptSnapshot?: boolean } = {}): void {
  // ---- Performance
  engine.setMasterLevel(getControlValue('perf.masterLevel') / 127)
  engine.setMorphPosition('wheel', getControlValue('perf.modWheel') / 127)
  engine.setMorphPosition('ctrlPedal', getControlValue('perf.ctrlPedal') / 127)
  applyMorphDestinations(engine)

  // ---- Piano section (inherited Phase 2 behavior)
  const sectionOn = getControlValue('piano.on') === 1
  if (engine.isSectionOn() !== sectionOn) engine.setSectionOn(sectionOn)

  const aOn = getControlValue('piano.layerA') === 1
  const bOn = getControlValue('piano.layerB') === 1
  if (engine.layers.pianoA.enabled !== aOn) engine.setLayerEnabled('pianoA', aOn)
  if (engine.layers.pianoB.enabled !== bOn) engine.setLayerEnabled('pianoB', bOn)

  // Focus: exactly one layer on → that layer has focus. Both on → explicit
  // focus button presses decide (pressFunctionalControl).
  if (aOn && !bOn && engine.getFocusedLayer() !== 'pianoA') engine.setFocusLayer('pianoA')
  else if (bOn && !aOn && engine.getFocusedLayer() !== 'pianoB') engine.setFocusLayer('pianoB')
  if (!engine.layers[engine.getFocusedLayer()].enabled && (aOn || bOn)) {
    engine.setFocusLayer(aOn ? 'pianoA' : 'pianoB')
  }

  const level = getControlValue('piano.level') / 127
  engine.setLayerLevel('pianoA', level)
  engine.setLayerLevel('pianoB', level)

  engine.setLayerOctave(engine.getFocusedLayer(), octaveFromPresses(getControlValue('piano.octaveShift')))

  const type = TYPE_BY_INDEX[cycle(getControlValue('piano.type'), TYPE_BY_INDEX.length)]
  engine.setLayerType(engine.getFocusedLayer(), type)

  engine.update(() => {
    engine.perf.kbTouch = cycle(getControlValue('piano.kbTouch'), 3) as 0 | 1 | 2
    engine.perf.dynComp = cycle(getControlValue('piano.dynComp'), 4) as 0 | 1 | 2 | 3
    const timbreMax = type === 'electric' ? 6 : 4
    engine.perf.timbre = cycle(getControlValue('piano.timbre'), timbreMax)
    engine.perf.unison = cycle(getControlValue('piano.unison'), 4) as 0 | 1 | 2 | 3
    engine.perf.softRelease = getControlValue('piano.softRelease') === 1
    engine.perf.stringRes = getControlValue('piano.stringRes') === 1
  })
  engine.setLayerSustainPedal(engine.getFocusedLayer(), getControlValue('piano.sustainPedal') === 1)
  engine.setLayerPitchStick(engine.getFocusedLayer(), getControlValue('piano.pitchStick') === 1)

  // ---- Organ section
  syncOrgan(engine)

  // ---- Synth section
  syncSynth(engine)

  // ---- Layer effects (unit controls edit the focused chain)
  syncEffects(engine)

  if (opts.adoptSnapshot) engine.adoptSnapshot()
}

/** Transpose stepping (TRANSPOSE button; Shift+TRANSPOSE is Panic). */
export function stepTranspose(engine: PianoEngine): void {
  engine.setTranspose(engine.transpose + 1 > 6 ? -6 : engine.transpose + 1)
}

// ------------------------------------------------------------------ organ

function syncOrgan(engine: PianoEngine): void {
  const o = engine.organ
  const organOn = getControlValue('organ.on') === 1
  if (o.sectionOn !== organOn) engine.setOrganSectionOn(organOn)
  const aOn = getControlValue('organ.layerA') === 1
  const bOn = getControlValue('organ.layerB') === 1
  if (o.layers.A.enabled !== aOn) engine.setOrganLayerEnabled('A', aOn)
  if (o.layers.B.enabled !== bOn) engine.setOrganLayerEnabled('B', bOn)
  // Focus: layer buttons focus their layer when both are on.
  if (aOn && !bOn) o.focusLayer = 'A'
  else if (bOn && !aOn) o.focusLayer = 'B'
  const focus = o.focusLayer
  engine.update(() => {
    const layer = o.layers[focus]
    layer.level = getControlValue('organ.level')
    layer.octave = octaveFromPresses(getControlValue('organ.octaveShift'))
    layer.model = cycle(getControlValue('organ.model'), ORGAN_MODELS.length)
    layer.vibratoMode = cycle(getControlValue('organ.vibratoChorus'), VIBRATO_MODES.length)
    layer.vibratoOn = getControlValue('organ.vibratoChorusOn') === 1
    layer.percussion.on = getControlValue('organ.percussionOn') === 1
    layer.percussion.fast = getControlValue('organ.percussionDecay') === 1
    layer.percussion.third = getControlValue('organ.percussionHarmonic') === 1
    layer.percussion.soft = getControlValue('organ.percussionSoft') === 1
    layer.sustainPedal = getControlValue('organ.sustainPedal') === 1
    layer.pitchStick = getControlValue('organ.pitchStick') === 1
    for (let i = 0; i < 9; i++) layer.drawbars[i] = Math.round(getControlValue(`organ.drawbar.${i + 1}`))
    // Rotary: organ panel owns speed + routing; drive combines with fx knob.
    engine.effects.rotary.speed = cycle(getControlValue('organ.rotarySpeed'), 3)
    engine.effects.rotary.fast = engine.effects.rotary.speed === 2
    engine.effects.rotary.organRouted = getControlValue('organ.rotaryRoute') === 1
    engine.effects.rotary.organDrive = getControlValue('organ.rotaryDrive')
  })
}

// ------------------------------------------------------------------ synth

function syncSynth(engine: PianoEngine): void {
  const s = engine.synth
  const synthOn = getControlValue('synth.on') === 1
  if (s.sectionOn !== synthOn) engine.setSynthSectionOn(synthOn)
  const aOn = getControlValue('synth.layerA') === 1
  const bOn = getControlValue('synth.layerB') === 1
  const cOn = getControlValue('synth.layerC') === 1
  if (s.layers.A.enabled !== aOn) engine.setSynthLayerEnabled('A', aOn)
  if (s.layers.B.enabled !== bOn) engine.setSynthLayerEnabled('B', bOn)
  if (s.layers.C.enabled !== cOn) engine.setSynthLayerEnabled('C', cOn)
  const onLayers = ([['A', aOn], ['B', bOn], ['C', cOn]] as const).filter(([, on]) => on).map(([id]) => id)
  if (onLayers.length === 1) s.focusLayer = onLayers[0]
  else if (!s.layers[s.focusLayer].enabled && onLayers.length > 0) s.focusLayer = onLayers[0]
  const focus = s.focusLayer
  engine.update(() => {
    const layer = s.layers[focus]
    layer.level = getControlValue('synth.level')
    layer.octave = octaveFromPresses(getControlValue('synth.octaveShift'))
    layer.sustainPedal = getControlValue('synth.sustainPedal') === 1
    layer.pitchStick = getControlValue('synth.pitchStick') === 1
    layer.oscWave = cycle(getControlValue('synth.oscWave'), SYNTH_WAVES.length)
    layer.oscCtrl = getControlValue('synth.oscShape')
    layer.oscCoarse = Math.round((getControlValue('synth.oscCoarse') / 127) * 48 - 24)
    layer.oscFine = Math.round((getControlValue('synth.oscFine') / 127) * 100 - 50)
    layer.envToPitch = getControlValue('synth.envToPitch') === 1
    layer.filterType = cycle(getControlValue('synth.filterType'), FILTER_TYPES.length)
    layer.filterFreq = getControlValue('synth.filterCutoff')
    layer.filterRes = getControlValue('synth.filterResonance')
    layer.filterEnvAmt = getControlValue('synth.filterEnvAmount')
    layer.filterKbTrack = cycle(getControlValue('synth.filterKbTrack'), 4)
    layer.filterDrive = cycle(getControlValue('synth.filterDrive'), 4)
    layer.ampEnv.attack = getControlValue('synth.ampAttack')
    layer.ampEnv.decay = getControlValue('synth.ampDecay')
    layer.ampEnv.release = getControlValue('synth.ampRelease')
    layer.filterEnv.attack = getControlValue('synth.modAttack')
    layer.filterEnv.decay = getControlValue('synth.modDecay')
    layer.filterEnv.release = getControlValue('synth.modRelease')
    layer.oscEnv.attack = getControlValue('synth.modAttack')
    layer.oscEnv.decay = getControlValue('synth.modDecay')
    layer.oscEnv.release = getControlValue('synth.modRelease')
    layer.lfoRate = getControlValue('synth.lfoRate')
    layer.lfoAmount = getControlValue('synth.lfoAmount')
    layer.lfoWave = cycle(getControlValue('synth.lfoWave'), 5)
    layer.lfoDest = cycle(getControlValue('synth.lfoDest'), 4)
    layer.arpRate = getControlValue('synth.arpRate')
    layer.arpRun = getControlValue('synth.arpOn') === 1
    layer.arpMode = cycle(getControlValue('synth.arpMode'), 3)
    layer.arpDirection = cycle(getControlValue('synth.arpPattern'), 4)
    layer.arpRange = cycle(getControlValue('synth.arpRange'), 4) + 1
    layer.arpHold = getControlValue('synth.arpHold') === 1 || getControlValue('program.kbHold') === 1
    layer.unison = cycle(getControlValue('synth.unison'), 4)
    layer.voiceMode = cycle(getControlValue('synth.voiceMode'), 3)
    layer.priority = cycle(getControlValue('synth.priority'), 3)
    layer.glide = getControlValue('synth.glideRate')
    layer.vibrato = cycle(getControlValue('synth.vibrato'), 3)
  })
}

// ------------------------------------------------------------------ effects

function syncEffects(engine: PianoEngine): void {
  engine.update(() => {
    const fx = engine.effects
    fx.allOn = getControlValue('fx.on') === 1
    fx.pianoGroup = getControlValue('fx.groupPiano') === 1
    // FX focus A/B selects the layer within the section whose controls were
    // last touched (fx.focusSection); synth's third layer is reached by
    // pressing the focused synth layer button (see pressFunctionalControl).
    const chainId = focusedChainFromPanel(engine)
    const chain = fx.chains[chainId]

    chain.mod1.on = getControlValue('fx.effect1On') === 1
    chain.mod1.type = cycle(getControlValue('fx.effect1Type'), MOD1_TYPES.length)
    chain.mod1.rate = getControlValue('fx.effect1Rate')
    chain.mod1.amount = getControlValue('fx.effect1Amount')

    chain.mod2.on = getControlValue('fx.effect2On') === 1
    chain.mod2.type = cycle(getControlValue('fx.effect2Type'), MOD2_TYPES.length)
    chain.mod2.rate = getControlValue('fx.effect2Rate')
    chain.mod2.amount = getControlValue('fx.effect2Amount')

    chain.amp.on = getControlValue('fx.ampOn') === 1
    chain.amp.type = cycle(getControlValue('fx.ampType'), AMP_TYPES.length)
    chain.amp.drive = getControlValue('fx.ampDrive')
    chain.amp.bass = getControlValue('fx.eqBassGain')
    chain.amp.midGain = getControlValue('fx.eqMidGain')
    chain.amp.midFreq = getControlValue('fx.eqMidFreq')
    chain.amp.treble = getControlValue('fx.eqTrebleGain')

    chain.delay.on = getControlValue('fx.delayOn') === 1
    chain.delay.tempoMs = 60 + (getControlValue('fx.delayRate') / 127) * 1140
    chain.delay.feedback = getControlValue('fx.delayFeedback')
    chain.delay.mix = getControlValue('fx.delayMix')
    chain.delay.pingPong = getControlValue('fx.delayPingPong') === 1
    chain.delay.filterType = cycle(getControlValue('fx.delayFilter'), 4)
    chain.delay.global = getControlValue('fx.delayGlobal') === 1

    chain.comp.on = getControlValue('fx.compOn') === 1
    chain.comp.amount = getControlValue('fx.compAmount')
    chain.comp.fast = getControlValue('fx.compFast') === 1
    chain.comp.global = getControlValue('fx.compGlobal') === 1

    chain.reverb.on = getControlValue('fx.reverbOn') === 1
    chain.reverb.type = cycle(getControlValue('fx.reverbType'), REVERB_TYPES.length)
    chain.reverb.amount = getControlValue('fx.reverbAmount')
    chain.reverb.bright = getControlValue('fx.reverbBright') === 1
    chain.reverb.global = getControlValue('fx.reverbGlobal') === 1

    fx.rotary.on = getControlValue('fx.rotaryOn') === 1
    // The FX rotary speed button (Slow/Fast) maps onto the canonical speed;
    // the organ panel's 3-way selector owns Stop.
    if (getControlPresses('fx.rotarySpeed') > 0) {
      const fxFast = cycle(getControlValue('fx.rotarySpeed'), 2) === 1
      fx.rotary.speed = fxFast ? 2 : 0
      fx.rotary.fast = fxFast
      setControlValue('organ.rotarySpeed', fx.rotary.speed)
    }
    fx.rotary.drive = getControlValue('fx.rotaryDrive')
  })
}

// ------------------------------------------------------------------ morphs

/** Morph assignment mode: which source button is currently held/latched. */
let morphAssignSource: MorphSource | null = null
/** While assigning, the start value captured when a control is first moved. */
const morphAssignStart = new Map<string, number>()

export function getMorphAssignSource(): MorphSource | null {
  return morphAssignSource
}

/** Apply interpolated morph destinations through canonical state + panel values. */
export function applyMorphDestinations(engine: PianoEngine): void {
  for (const source of ['wheel', 'ctrlPedal'] as const) {
    const pos = engine.morphPositions[source]
    for (const a of engine.morphs[source]) {
      const value = a.from + (a.to - a.from) * pos
      setControlValue(a.controlId, Math.round(value))
    }
  }
}

/** While a morph source is held/latched, record a destination move. */
export function recordMorphMove(engine: PianoEngine, controlId: string, value: number): void {
  if (!morphAssignSource) return
  if (!morphAssignStart.has(controlId)) {
    morphAssignStart.set(controlId, value)
    return
  }
  const from = morphAssignStart.get(controlId)!
  engine.assignMorph(morphAssignSource, controlId, from, value)
}

// ------------------------------------------------------------------ presses

let lastTap = 0
/** Split edit state: which split point is being edited (position/xfade via dial). */
let splitEditPoint: 'Low' | 'Mid' | 'High' | null = null
/** KB Zone assign mode: next zone LED presses set the focused layer's range. */
let kbZoneArmed = false
/** Store flow state. */
let storeArmed: 'store' | 'storeAs' | null = null
let storeNameBuffer = ''
let storeDest: number | null = null
const lastMorphPress: Record<string, number> = {}

export function getStoreState(): { armed: 'store' | 'storeAs' | null; name: string; dest: number | null } {
  return { armed: storeArmed, name: storeNameBuffer, dest: storeDest }
}

export function getSplitEditPoint(): 'Low' | 'Mid' | 'High' | null {
  return splitEditPoint
}

export function isKbZoneArmed(): boolean {
  return kbZoneArmed
}

/** Momentary actions invoked directly by the panel (not value-synced). */
export function pressFunctionalControl(engine: PianoEngine, id: string): void {
  const shift = getControlValue('program.shift') === 1

  switch (id) {
    case 'program.panic':
      engine.panic()
      return
    case 'piano.layerA':
      engine.setFocusLayer('pianoA')
      engine.effects.focusSection = 'piano'
      engine.effects.focusLayer = 'A'
      return
    case 'piano.layerB':
      engine.setFocusLayer('pianoB')
      engine.effects.focusSection = 'piano'
      engine.effects.focusLayer = 'B'
      return
    case 'organ.layerA':
      engine.organ.focusLayer = 'A'
      engine.effects.focusSection = 'organ'
      return
    case 'organ.layerB':
      engine.organ.focusLayer = 'B'
      engine.effects.focusSection = 'organ'
      return
    case 'synth.layerA':
      engine.synth.focusLayer = 'A'
      engine.effects.focusSection = 'synth'
      engine.effects.focusLayer = 'A'
      return
    case 'synth.layerB':
      engine.synth.focusLayer = 'B'
      engine.effects.focusSection = 'synth'
      engine.effects.focusLayer = 'B'
      return
    case 'synth.layerC':
      engine.synth.focusLayer = 'C'
      engine.effects.focusSection = 'synth'
      engine.effects.focusLayer = 'C'
      return
    case 'fx.focusA':
      engine.effects.focusLayer = 'A'
      return
    case 'fx.focusB':
      engine.effects.focusLayer = 'B'
      return
    case 'fx.delayTempo':
      tapTempo(engine)
      return
    case 'program.mstClock':
      if (shift) {
        engine.clock.kbSync = !engine.clock.kbSync
        engine.update(() => {})
        return
      }
      engine.tapMasterClock(Date.now())
      return
  }

  // ---- Program navigation
  if (id.startsWith('program.button.')) {
    const n = Number(id.split('.')[2])
    if (storeArmed) {
      // Destination select: program button picks the slot on the shown page.
      storeDest = (engine.liveMode ? 0 : engine.page * 8) + (n - 1)
      confirmStore(engine)
      return
    }
    engine.selectProgramButton(n)
    syncPanelFromEngine(engine)
    return
  }
  if (id === 'program.pageLeft') {
    if (storeArmed) return
    engine.setPage(engine.page - 1)
    return
  }
  if (id === 'program.pageRight') {
    if (storeArmed) return
    engine.setPage(engine.page + 1)
    return
  }
  if (id === 'program.liveMode') {
    engine.setLiveMode(getControlValue('program.liveMode') === 1)
    syncPanelFromEngine(engine)
    return
  }
  if (id === 'program.layerScene') {
    engine.setScene(cycle(getControlValue('program.layerScene'), 2) === 0 ? 'I' : 'II')
    syncPanelFromEngine(engine)
    return
  }
  if (id === 'program.store') {
    if (shift) {
      // STORE AS: open naming first.
      storeArmed = 'storeAs'
      storeNameBuffer = engine.currentName
      storeDest = null
      return
    }
    if (storeArmed) {
      // Second STORE press confirms to the current slot when no destination
      // was picked since arming.
      confirmStore(engine)
      return
    }
    storeArmed = 'store'
    storeDest = null
    return
  }
  if (id === 'program.shift') {
    // Shift pressed on its own cancels an armed store flow.
    if (storeArmed) cancelStore()
    return
  }
  if (id === 'program.split') {
    // SPLIT ON/SET toggles a single Mid split at C4 (manual p. 39).
    const on = getControlValue('program.split') === 1
    engine.update(() => {
      engine.split.on = on
      if (on) {
        engine.split.points.Mid.enabled = true
      }
    })
    return
  }
  if (id === 'program.splitLow' || id === 'program.splitMid' || id === 'program.splitHigh') {
    const point = id === 'program.splitLow' ? 'Low' : id === 'program.splitMid' ? 'Mid' : 'High'
    if (shift) {
      // Shift + point: cycle crossfade Off/±6/±12.
      engine.update(() => {
        const p = engine.split.points[point]
        p.xfade = (p.xfade + 1) % 3
      })
      return
    }
    engine.update(() => {
      const p = engine.split.points[point]
      p.enabled = !p.enabled
      if (p.enabled) engine.split.on = true
    })
    splitEditPoint = engine.split.points[point].enabled ? point : null
    return
  }
  if (id === 'program.kbZone') {
    kbZoneArmed = !kbZoneArmed
    return
  }
  if (id === 'program.transpose') {
    if (shift) {
      engine.panic()
      setControlValue('program.shift', 0)
      return
    }
    stepTranspose(engine)
    return
  }
  if (id === 'program.morphWheel' || id === 'program.morphCtrlPedal') {
    const source: MorphSource = id === 'program.morphWheel' ? 'wheel' : 'ctrlPedal'
    if (shift) {
      engine.clearMorph(source)
      setControlValue('program.shift', 0)
      return
    }
    // Double-tap latches the assign mode; single tap while latched releases.
    const now = Date.now()
    const last = lastMorphPress[source] ?? 0
    lastMorphPress[source] = now
    if (morphAssignSource === source && now - last > 400) {
      morphAssignSource = null
      morphAssignStart.clear()
    } else {
      morphAssignSource = source
    }
    return
  }
}

/** Confirm an armed store to the picked (or current) destination. */
function confirmStore(engine: PianoEngine): void {
  const dest = storeDest ?? (engine.liveMode ? engine.currentLiveSlot : (engine.currentSlot ?? 0))
  const name = storeArmed === 'storeAs' ? storeNameBuffer : engine.currentName
  engine.storeTo(dest, name)
  cancelStore()
  syncPanelFromEngine(engine)
}

function cancelStore(): void {
  storeArmed = null
  storeDest = null
  storeNameBuffer = ''
}

/** Naming input for Store As (character entry + insert/delete via the dial row). */
export function storeNameEdit(action: 'backspace' | 'insert-space' | 'next-char' | 'prev-char'): void {
  if (storeArmed !== 'storeAs') return
  if (action === 'backspace') storeNameBuffer = storeNameBuffer.slice(0, -1)
  else if (action === 'insert-space') storeNameBuffer = (storeNameBuffer + ' ').slice(0, 12)
  else {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -'
    if (storeNameBuffer.length === 0) storeNameBuffer = 'A'
    const last = storeNameBuffer[storeNameBuffer.length - 1]
    const idx = chars.indexOf(last.toUpperCase())
    const next = action === 'next-char' ? chars[(idx + 1) % chars.length] : chars[(idx - 1 + chars.length) % chars.length]
    storeNameBuffer = storeNameBuffer.slice(0, -1) + next
  }
}

/** Split edit via the program dial (while a point is in edit mode). */
export function splitEditDial(engine: PianoEngine, delta: number): void {
  if (!splitEditPoint) return
  engine.update(() => {
    const p = engine.split.points[splitEditPoint!]
    p.position = Math.max(0, Math.min(SPLIT_POSITIONS.length - 1, p.position + delta))
  })
}

/** KB Zone: assign the focused layer to zone `zone` (toggles that zone in its range). */
export function kbZoneAssign(engine: PianoEngine, zone: number): void {
  if (!kbZoneArmed) return
  const layer = focusedRoutableLayer(engine)
  engine.update(() => {
    const cur = engine.split.zones[layer]
    // Expand or shrink the contiguous range toward the pressed zone.
    if (zone < cur.lo) cur.lo = zone
    else if (zone > cur.hi) cur.hi = zone
    else if (cur.lo === cur.hi) return // single-zone range stays
    else if (zone === cur.lo) cur.lo = zone + 1
    else if (zone === cur.hi) cur.hi = zone - 1
  })
}

/** The routable layer that currently has panel focus. */
export function focusedRoutableLayer(engine: PianoEngine): RoutableLayerId {
  const sec = engine.effects.focusSection
  if (sec === 'organ') return engine.organ.focusLayer === 'A' ? 'organA' : 'organB'
  if (sec === 'synth') return `synth${engine.synth.focusLayer}` as RoutableLayerId
  return engine.getFocusedLayer()
}

/** Program dial rotation: browse programs, or edit split point while armed. */
export function programDialDelta(engine: PianoEngine, delta: number): void {
  if (delta === 0) return
  if (getStoreState().armed === 'storeAs') {
    storeNameEdit(delta > 0 ? 'next-char' : 'prev-char')
    return
  }
  if (getSplitEditPoint()) {
    splitEditDial(engine, delta > 0 ? 1 : -1)
    return
  }
  engine.browse(delta > 0 ? 1 : -1)
  syncPanelFromEngine(engine)
}

function tapTempo(engine: PianoEngine): void {
  const now = Date.now()
  if (lastTap > 0 && now - lastTap < 2500) {
    const ms = Math.min(2000, Math.max(60, now - lastTap))
    engine.update(() => {
      const chainId = focusedChainFromPanel(engine)
      engine.effects.chains[chainId].delay.tempoMs = ms
    })
  }
  lastTap = now
}

// ------------------------------------------------- engine → panel reflection

/**
 * Reflect engine state back onto panel control values (after program load,
 * scene switch, store, morph application) so the surface always shows the
 * canonical state.
 */
export function syncPanelFromEngine(engine: PianoEngine): void {
  const set = (id: string, v: number) => setControlValue(id, v)

  // Piano
  set('piano.on', engine.isSectionOn() ? 1 : 0)
  set('piano.layerA', engine.layers.pianoA.enabled ? 1 : 0)
  set('piano.layerB', engine.layers.pianoB.enabled ? 1 : 0)
  const pf = engine.getFocusedLayer()
  set('piano.level', Math.round(engine.layers[pf].level * 127))
  set('piano.type', TYPE_BY_INDEX.indexOf(engine.layers[pf].type))
  set('piano.kbTouch', engine.perf.kbTouch)
  set('piano.dynComp', engine.perf.dynComp)
  set('piano.timbre', engine.perf.timbre)
  set('piano.unison', engine.perf.unison)
  set('piano.softRelease', engine.perf.softRelease ? 1 : 0)
  set('piano.stringRes', engine.perf.stringRes ? 1 : 0)
  set('piano.sustainPedal', engine.layers[pf].sustainPedal ? 1 : 0)

  // Organ
  const o = engine.organ
  set('organ.on', o.sectionOn ? 1 : 0)
  set('organ.layerA', o.layers.A.enabled ? 1 : 0)
  set('organ.layerB', o.layers.B.enabled ? 1 : 0)
  const of = o.layers[o.focusLayer]
  set('organ.level', of.level)
  set('organ.model', of.model)
  set('organ.vibratoChorus', of.vibratoMode)
  set('organ.vibratoChorusOn', of.vibratoOn ? 1 : 0)
  set('organ.percussionOn', of.percussion.on ? 1 : 0)
  set('organ.percussionDecay', of.percussion.fast ? 1 : 0)
  set('organ.percussionHarmonic', of.percussion.third ? 1 : 0)
  set('organ.percussionSoft', of.percussion.soft ? 1 : 0)
  for (let i = 0; i < 9; i++) set(`organ.drawbar.${i + 1}`, of.drawbars[i])
  set('organ.rotarySpeed', engine.effects.rotary.speed)
  set('organ.rotaryRoute', engine.effects.rotary.organRouted ? 1 : 0)
  set('organ.rotaryDrive', engine.effects.rotary.organDrive)

  // Synth
  const s = engine.synth
  set('synth.on', s.sectionOn ? 1 : 0)
  set('synth.layerA', s.layers.A.enabled ? 1 : 0)
  set('synth.layerB', s.layers.B.enabled ? 1 : 0)
  set('synth.layerC', s.layers.C.enabled ? 1 : 0)
  const sf = s.layers[s.focusLayer]
  set('synth.level', sf.level)
  set('synth.oscWave', sf.oscWave)
  set('synth.oscShape', sf.oscCtrl)
  set('synth.oscCoarse', Math.round(((sf.oscCoarse + 24) / 48) * 127))
  set('synth.oscFine', Math.round(((sf.oscFine + 50) / 100) * 127))
  set('synth.envToPitch', sf.envToPitch ? 1 : 0)
  set('synth.filterType', sf.filterType)
  set('synth.filterCutoff', sf.filterFreq)
  set('synth.filterResonance', sf.filterRes)
  set('synth.filterEnvAmount', sf.filterEnvAmt)
  set('synth.filterKbTrack', sf.filterKbTrack)
  set('synth.filterDrive', sf.filterDrive)
  set('synth.ampAttack', sf.ampEnv.attack)
  set('synth.ampDecay', sf.ampEnv.decay)
  set('synth.ampRelease', sf.ampEnv.release)
  set('synth.modAttack', sf.filterEnv.attack)
  set('synth.modDecay', sf.filterEnv.decay)
  set('synth.modRelease', sf.filterEnv.release)
  set('synth.lfoRate', sf.lfoRate)
  set('synth.lfoAmount', sf.lfoAmount)
  set('synth.lfoWave', sf.lfoWave)
  set('synth.lfoDest', sf.lfoDest)
  set('synth.arpRate', sf.arpRate)
  set('synth.arpOn', sf.arpRun ? 1 : 0)
  set('synth.arpMode', sf.arpMode)
  set('synth.arpPattern', sf.arpDirection)
  set('synth.arpRange', sf.arpRange - 1)
  set('synth.arpHold', sf.arpHold ? 1 : 0)
  set('synth.unison', sf.unison)
  set('synth.voiceMode', sf.voiceMode)
  set('synth.priority', sf.priority)
  set('synth.glideRate', sf.glide)
  set('synth.vibrato', sf.vibrato)

  // Effects: reflect the focused chain.
  const fx = engine.effects
  set('fx.on', fx.allOn ? 1 : 0)
  set('fx.groupPiano', fx.pianoGroup ? 1 : 0)
  const chain = fx.chains[focusedChainFromPanel(engine)]
  set('fx.effect1On', chain.mod1.on ? 1 : 0)
  set('fx.effect1Type', chain.mod1.type)
  set('fx.effect1Rate', chain.mod1.rate)
  set('fx.effect1Amount', chain.mod1.amount)
  set('fx.effect2On', chain.mod2.on ? 1 : 0)
  set('fx.effect2Type', chain.mod2.type)
  set('fx.effect2Rate', chain.mod2.rate)
  set('fx.effect2Amount', chain.mod2.amount)
  set('fx.ampOn', chain.amp.on ? 1 : 0)
  set('fx.ampType', chain.amp.type)
  set('fx.ampDrive', chain.amp.drive)
  set('fx.eqBassGain', chain.amp.bass)
  set('fx.eqMidGain', chain.amp.midGain)
  set('fx.eqMidFreq', chain.amp.midFreq)
  set('fx.eqTrebleGain', chain.amp.treble)
  set('fx.delayOn', chain.delay.on ? 1 : 0)
  set('fx.delayFeedback', chain.delay.feedback)
  set('fx.delayMix', chain.delay.mix)
  set('fx.delayPingPong', chain.delay.pingPong ? 1 : 0)
  set('fx.delayFilter', chain.delay.filterType)
  set('fx.delayGlobal', chain.delay.global ? 1 : 0)
  set('fx.compOn', chain.comp.on ? 1 : 0)
  set('fx.compAmount', chain.comp.amount)
  set('fx.compFast', chain.comp.fast ? 1 : 0)
  set('fx.compGlobal', chain.comp.global ? 1 : 0)
  set('fx.reverbOn', chain.reverb.on ? 1 : 0)
  set('fx.reverbType', chain.reverb.type)
  set('fx.reverbAmount', chain.reverb.amount)
  set('fx.reverbBright', chain.reverb.bright ? 1 : 0)
  set('fx.reverbGlobal', chain.reverb.global ? 1 : 0)
  set('fx.rotaryOn', fx.rotary.on ? 1 : 0)
  set('fx.rotaryDrive', fx.rotary.drive)

  // Program section
  set('program.liveMode', engine.liveMode ? 1 : 0)
  set('program.layerScene', engine.scene === 'I' ? 0 : 1)
  set('program.split', engine.split.on ? 1 : 0)
  set('program.splitLow', engine.split.points.Low.enabled ? 1 : 0)
  set('program.splitMid', engine.split.points.Mid.enabled ? 1 : 0)
  set('program.splitHigh', engine.split.points.High.enabled ? 1 : 0)
}

/** Human-readable summary of what a functional control currently selects (panel feedback). */
export function describeControlState(engine: PianoEngine, id: string): string {
  switch (id) {
    case 'piano.kbTouch':
      return KB_TOUCH_LABELS[engine.perf.kbTouch]
    case 'piano.type':
      return engine.layers[engine.getFocusedLayer()].type
    default:
      return ''
  }
}
