/**
 * Panel bindings: the honesty boundary.
 *
 * FUNCTIONAL controls (Piano section, Layer Effects, Master Level, Panic)
 * write through to the engine's canonical state. Every other control remains
 * decorative: it moves, and changes presentation state only. The two sets are
 * explicit so tests can assert the contract both ways.
 */

import type { PianoEngine } from '../audio/engine'
import type { LayerId } from '../audio/render'
import type { PianoTypeId } from '../audio/piano-models'
import { getControlValue } from './hardware-store'
import { KB_TOUCH_LABELS } from './piano-state'
import { AMP_TYPES, MOD1_TYPES, MOD2_TYPES, REVERB_TYPES } from './effects-state'

/** Controls that drive real engine state in Phase 2. Everything else is decorative. */
export const FUNCTIONAL_CONTROLS: ReadonlySet<string> = new Set([
  'perf.masterLevel',
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
  'program.panic',
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

const TYPE_BY_INDEX: readonly PianoTypeId[] = ['grand', 'upright', 'electric', 'clav', 'digital', 'misc']

/** FX focus: the panel A/B buttons select which layer chain the unit controls edit. */
function focusedLayerFromPanel(): LayerId {
  // fx.focusB pressed (value 1) → edit chain B; otherwise A.
  return getControlValue('fx.focusB') === 1 ? 'pianoB' : 'pianoA'
}

/**
 * Push the current panel values for every functional control into the engine.
 * Called on initial mount and whenever any functional control changes.
 */
export function syncFunctionalControls(engine: PianoEngine): void {
  // ---- Master level
  engine.setMasterLevel(getControlValue('perf.masterLevel') / 127)

  // ---- Piano section
  const sectionOn = getControlValue('piano.on') === 1
  if (engine.isSectionOn() !== sectionOn) engine.setSectionOn(sectionOn)

  const aOn = getControlValue('piano.layerA') === 1
  const bOn = getControlValue('piano.layerB') === 1
  engine.update(() => {
    engine.layers.pianoA.enabled = aOn
    engine.layers.pianoB.enabled = bOn
  })

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

  // Octave shift cycles -12 / 0 / +12 per press (hardware-style) — applied
  // to the focused layer.
  const octPresses = Math.round(getControlValue('piano.octaveShift')) % 3
  const octave = octPresses === 0 ? 0 : octPresses === 1 ? 12 : -12
  engine.setLayerOctave(engine.getFocusedLayer(), octave)

  const type = TYPE_BY_INDEX[Math.round(getControlValue('piano.type')) % TYPE_BY_INDEX.length]
  engine.setLayerType(engine.getFocusedLayer(), type)

  engine.update(() => {
    engine.perf.kbTouch = (Math.round(getControlValue('piano.kbTouch')) % 3) as 0 | 1 | 2
    engine.perf.dynComp = (Math.round(getControlValue('piano.dynComp')) % 4) as 0 | 1 | 2 | 3
    const timbreMax = type === 'electric' ? 6 : 4
    engine.perf.timbre = Math.round(getControlValue('piano.timbre')) % timbreMax
    engine.perf.unison = (Math.round(getControlValue('piano.unison')) % 4) as 0 | 1 | 2 | 3
    engine.perf.softRelease = getControlValue('piano.softRelease') === 1
    engine.perf.stringRes = getControlValue('piano.stringRes') === 1
  })
  engine.setLayerSustainPedal(engine.getFocusedLayer(), getControlValue('piano.sustainPedal') === 1)
  engine.setLayerPitchStick(engine.getFocusedLayer(), getControlValue('piano.pitchStick') === 1)

  // ---- Layer effects (unit controls edit the focused chain)
  const chainId = focusedLayerFromPanel()
  engine.update(() => {
    const fx = engine.effects
    fx.allOn = getControlValue('fx.on') === 1
    fx.pianoGroup = getControlValue('fx.groupPiano') === 1
    fx.focusSection = 'piano'
    fx.focusLayer = chainId === 'pianoB' ? 'B' : 'A'
    const chain = fx.chains[chainId]

    chain.mod1.on = getControlValue('fx.effect1On') === 1
    chain.mod1.type = Math.round(getControlValue('fx.effect1Type')) % MOD1_TYPES.length
    chain.mod1.rate = getControlValue('fx.effect1Rate')
    chain.mod1.amount = getControlValue('fx.effect1Amount')

    chain.mod2.on = getControlValue('fx.effect2On') === 1
    chain.mod2.type = Math.round(getControlValue('fx.effect2Type')) % MOD2_TYPES.length
    chain.mod2.rate = getControlValue('fx.effect2Rate')
    chain.mod2.amount = getControlValue('fx.effect2Amount')

    chain.amp.on = getControlValue('fx.ampOn') === 1
    chain.amp.type = Math.round(getControlValue('fx.ampType')) % AMP_TYPES.length
    chain.amp.drive = getControlValue('fx.ampDrive')
    chain.amp.bass = getControlValue('fx.eqBassGain')
    chain.amp.midGain = getControlValue('fx.eqMidGain')
    chain.amp.midFreq = getControlValue('fx.eqMidGain')
    chain.amp.treble = getControlValue('fx.eqTrebleGain')

    chain.delay.on = getControlValue('fx.delayOn') === 1
    chain.delay.tempoMs = 60 + (getControlValue('fx.delayRate') / 127) * 1140
    chain.delay.feedback = getControlValue('fx.delayFeedback')
    chain.delay.mix = getControlValue('fx.delayMix')
    chain.delay.pingPong = getControlValue('fx.delayPingPong') === 1
    chain.delay.filterType = Math.round(getControlValue('fx.delayFilter')) % 4
    chain.delay.global = getControlValue('fx.delayGlobal') === 1

    chain.comp.on = getControlValue('fx.compOn') === 1
    chain.comp.amount = getControlValue('fx.compAmount')
    chain.comp.fast = getControlValue('fx.compFast') === 1
    chain.comp.global = getControlValue('fx.compGlobal') === 1

    chain.reverb.on = getControlValue('fx.reverbOn') === 1
    chain.reverb.type = Math.round(getControlValue('fx.reverbType')) % REVERB_TYPES.length
    chain.reverb.amount = getControlValue('fx.reverbAmount')
    chain.reverb.bright = getControlValue('fx.reverbBright') === 1
    chain.reverb.global = getControlValue('fx.reverbGlobal') === 1

    fx.rotary.on = getControlValue('fx.rotaryOn') === 1
    fx.rotary.fast = getControlValue('fx.rotarySpeed') === 1
    fx.rotary.drive = getControlValue('fx.rotaryDrive')
  })
}

/** Momentary actions invoked directly by the panel (not value-synced). */
export function pressFunctionalControl(engine: PianoEngine, id: string): void {
  if (id === 'program.panic') {
    engine.allNotesOff()
    return
  }
  if (id === 'piano.layerA') {
    engine.setFocusLayer('pianoA')
    return
  }
  if (id === 'piano.layerB') {
    engine.setFocusLayer('pianoB')
    return
  }
  if (id === 'fx.delayTempo') {
    tapTempo(engine)
    return
  }
}

let lastTap = 0
function tapTempo(engine: PianoEngine): void {
  const now = Date.now()
  if (lastTap > 0 && now - lastTap < 2500) {
    const ms = Math.min(2000, Math.max(60, now - lastTap))
    engine.update(() => {
      const chainId = engine.effects.focusLayer === 'A' ? 'pianoA' : 'pianoB'
      engine.effects.chains[chainId].delay.tempoMs = ms
    })
  }
  lastTap = now
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
