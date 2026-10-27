/**
 * Panel bindings.
 *
 * Phase 1's control catalog describes every visible physical input. Phase 2 turns a subset
 * of them into real controls. This module is the single place that decides which catalog
 * IDs are functional and how a raw panel value maps into instrument state — so the panel,
 * the audio graph and the tests all agree, and a control that stays decorative is
 * decorative by omission from these maps rather than by accident.
 */
import { findControl } from '../hardware/catalog'
import { PIANO_TYPES, modelsForType } from './pianoLibrary'
import type { ChainOwner } from './types'
import type { EffectState } from './effectState'
import type { PianoState } from './pianoState'
import {
  AMP_MODELS,
  DELAY_FILTERS,
  MOD1_TYPES,
  MOD2_TYPES,
  REVERB_TYPES,
} from './effectTypes'

/** Catalog ids whose value is owned by the Piano section state. */
export const PIANO_CONTROL_IDS = new Set<string>([
  'piano.section.on',
  'piano.layer.a.on',
  'piano.layer.b.on',
  'piano.layer.a.level',
  'piano.layer.b.level',
  'piano.octave.down',
  'piano.octave.up',
  'piano.sustped',
  'piano.pstick',
  'piano.soft-release',
  'piano.string-res',
  'piano.unison',
  'piano.kb-touch',
  'piano.dyn-comp',
  'piano.type',
  'piano.model',
  'piano.timbre',
  'performance.master-level',
])

/** Catalog ids owned by the Layer Effects state. All are per-focused-layer edits. */
export const EFFECT_CONTROL_IDS = new Set<string>([
  'effects.mod1.type',
  'effects.mod1.rate',
  'effects.mod1.amount',
  'effects.mod1.on',
  'effects.mod2.type',
  'effects.mod2.rate',
  'effects.mod2.amount',
  'effects.mod2.on',
  'effects.delay.tempo',
  'effects.delay.feedback',
  'effects.delay.dry-wet',
  'effects.delay.filter',
  'effects.delay.ping-pong',
  'effects.delay.on',
  'effects.amp.model',
  'effects.amp.drive',
  'effects.amp.bass',
  'effects.amp.mid',
  'effects.amp.freq',
  'effects.amp.treble',
  'effects.amp.on',
  'effects.comp.amount',
  'effects.comp.fast',
  'effects.comp.on',
  'effects.reverb.dry-wet',
  'effects.reverb.type',
  'effects.reverb.tone',
  'effects.reverb.on',
  'effects.focus.piano-a',
  'effects.focus.piano-b',
  'performance.rotary.drive',
  'performance.rotary.on',
  'performance.rotary.speed',
])

/** Layer focus buttons that belong to sections which stay decorative keep their old role. */
export const DECORATIVE_FOCUS_IDS = new Set<string>([
  'effects.focus.organ-a',
  'effects.focus.organ-b',
  'effects.focus.synth-a',
  'effects.focus.synth-b',
  'effects.focus.synth-c',
])

/**
 * Reads the canonical value a functional control should present. Used by the panel to
 * render real state rather than a stale local copy, so the LEDs and the sound agree.
 */
export function isFunctionalControl(id: string): boolean {
  return PIANO_CONTROL_IDS.has(id) || EFFECT_CONTROL_IDS.has(id)
}

/* ------------------------------------------------------------------ */
/* Piano                                                              */
/* ------------------------------------------------------------------ */

/** Reads the catalog's initial value for a numeric control. */
function numericDefault(id: string): number {
  const control = findControl(id)
  return control && 'min' in control ? control.value : 0
}

/**
 * The Piano section's initial state, seeded from the same defaults the catalog prints, so
 * the panel's first render and the audio graph's first note agree exactly.
 */
export function pianoStateFromPanel(defaults: PianoState): PianoState {
  const next = {
    ...defaults,
    layers: { 'piano.a': { ...defaults.layers['piano.a'] }, 'piano.b': { ...defaults.layers['piano.b'] } },
  }
  next.masterLevel = numericDefault('performance.master-level')
  next.layers['piano.a'].level = numericDefault('piano.layer.a.level')
  next.layers['piano.b'].level = numericDefault('piano.layer.b.level')
  next.kbTouch = numericDefault('piano.kb-touch')
  next.dynComp = numericDefault('piano.dyn-comp')
  next.unison = numericDefault('piano.unison')
  next.timbre = numericDefault('piano.timbre')
  return next
}

/** Applies one catalog edit to Piano state. Returns the mutated draft. */
export function applyPianoEdit(state: PianoState, id: string, value: number | boolean): void {
  const num = typeof value === 'boolean' ? (value ? 1 : 0) : value
  switch (id) {
    case 'piano.section.on':
      state.sectionOn = Boolean(value)
      return
    case 'piano.layer.a.on':
      state.layers['piano.a'].enabled = Boolean(value)
      if (value) state.focused = 'piano.a'
      return
    case 'piano.layer.b.on':
      state.layers['piano.b'].enabled = Boolean(value)
      if (value) state.focused = 'piano.b'
      return
    case 'piano.layer.a.level':
      state.layers['piano.a'].level = num
      return
    case 'piano.layer.b.level':
      state.layers['piano.b'].level = num
      return
    case 'piano.octave.down':
      state.layers[state.focused].octave = Math.max(-12, state.layers[state.focused].octave - 12)
      return
    case 'piano.octave.up':
      state.layers[state.focused].octave = Math.min(12, state.layers[state.focused].octave + 12)
      return
    case 'piano.sustped':
      state.layers['piano.a'].sustPed = Boolean(value)
      state.layers['piano.b'].sustPed = Boolean(value)
      return
    case 'piano.pstick':
      state.layers[state.focused].pitchStick = Boolean(value)
      return
    case 'piano.soft-release':
      state.softRelease = Boolean(value)
      return
    case 'piano.string-res':
      state.stringRes = Boolean(value)
      return
    case 'piano.unison':
      state.unison = num
      return
    case 'piano.kb-touch':
      state.kbTouch = num
      return
    case 'piano.dyn-comp':
      state.dynComp = num
      return
    case 'piano.type': {
      const type = PIANO_TYPES[Math.max(0, Math.min(PIANO_TYPES.length - 1, Math.round(num)))].id
      state.layers[state.focused].type = type
      const models = modelsForType(type)
      // Selecting a type selects its first model. The timbre knob keeps its printed
      // position; the type's own voicing list interprets it (see timbreIndexFor).
      state.layers[state.focused].model = models[0].id
      return
    }
    case 'piano.model': {
      const layer = state.layers[state.focused]
      const models = modelsForType(layer.type)
      // The panel's model dial is 1-based and is not limited to the models that exist for
      // a type, so it clamps to the real list rather than inventing a model.
      const index = Math.max(0, Math.min(models.length - 1, Math.round(num) - 1))
      layer.model = models[index].id
      return
    }
    case 'piano.timbre':
      state.timbre = num
      return
    case 'performance.master-level':
      state.masterLevel = num
      return
    default:
      return
  }
}

/* ------------------------------------------------------------------ */
/* Effects                                                            */
/* ------------------------------------------------------------------ */

/**
 * The Piano layer a manual FX focus press selects, if the edit was one of the two focus
 * buttons. The instrument uses this to keep the Piano section's focused layer in step, so
 * both directions of the focus relationship agree.
 */
export function focusTargetFor(id: string, value: number | boolean): 'piano.a' | 'piano.b' | null {
  if (!value) return null
  if (id === 'effects.focus.piano-a') return 'piano.a'
  if (id === 'effects.focus.piano-b') return 'piano.b'
  return null
}

/**
 * The other half of the latched focus pair, so the panel can clear it when the focused layer
 * changes. A focus pair is a radio group: exactly one LED is lit at a time.
 */
export function focusCounterpart(id: string): string | null {
  if (id === 'effects.focus.piano-a') return 'effects.focus.piano-b'
  if (id === 'effects.focus.piano-b') return 'effects.focus.piano-a'
  return null
}

/** Which chain the panel edits: the focused layer, for the Piano section. */
export function editedChain(state: EffectState): ChainOwner {
  return state.focusedLayer
}

/** Applies one catalog edit to Layer Effects state. */
export function applyEffectEdit(state: EffectState, id: string, value: number | boolean): void {
  const chain = state.chains[editedChain(state)]
  const num = typeof value === 'boolean' ? (value ? 1 : 0) : value
  const on = Boolean(value)
  switch (id) {
    case 'effects.mod1.type':
      chain.mod1.type = MOD1_TYPES[clampIndex(num, MOD1_TYPES.length)]
      return
    case 'effects.mod1.rate':
      chain.mod1.rate = num
      return
    case 'effects.mod1.amount':
      chain.mod1.amount = num
      return
    case 'effects.mod1.on':
      chain.mod1.on = on
      return
    case 'effects.mod2.type':
      chain.mod2.type = MOD2_TYPES[clampIndex(num, MOD2_TYPES.length)]
      return
    case 'effects.mod2.rate':
      chain.mod2.rate = num
      return
    case 'effects.mod2.amount':
      chain.mod2.amount = num
      return
    case 'effects.mod2.on':
      chain.mod2.on = on
      return
    case 'effects.delay.tempo':
      chain.delay.tempo = num
      chain.delay.tapSeconds = null
      return
    case 'effects.delay.feedback':
      chain.delay.feedback = num
      return
    case 'effects.delay.dry-wet':
      chain.delay.dryWet = num
      return
    case 'effects.delay.filter':
      chain.delay.filter = DELAY_FILTERS[clampIndex(num, DELAY_FILTERS.length)]
      return
    case 'effects.delay.ping-pong':
      chain.delay.pingPong = on
      return
    case 'effects.delay.on':
      chain.delay.on = on
      return
    case 'effects.amp.model':
      chain.ampEq.model = AMP_MODELS[clampIndex(num, AMP_MODELS.length)]
      return
    case 'effects.amp.drive':
      chain.ampEq.drive = num
      return
    case 'effects.amp.bass':
      chain.ampEq.bass = num
      return
    case 'effects.amp.mid':
      chain.ampEq.mid = num
      return
    case 'effects.amp.freq':
      chain.ampEq.midFreq = num
      return
    case 'effects.amp.treble':
      chain.ampEq.treble = num
      return
    case 'effects.amp.on':
      chain.ampEq.on = on
      return
    case 'effects.comp.amount':
      chain.compressor.amount = num
      return
    case 'effects.comp.fast':
      chain.compressor.fast = on
      return
    case 'effects.comp.on':
      chain.compressor.on = on
      return
    case 'effects.reverb.dry-wet':
      chain.reverb.dryWet = num
      return
    case 'effects.reverb.type':
      chain.reverb.type = REVERB_TYPES[clampIndex(num, REVERB_TYPES.length)]
      return
    case 'effects.reverb.tone':
      chain.reverb.tone = num === 1 ? 'Dark' : 'Bright'
      return
    case 'effects.reverb.on':
      chain.reverb.on = on
      return
    // The two focus buttons are a radio pair: turning one on turns the other off, and a
    // press that would switch the already-focused layer off is ignored (a layer is always
    // focused, exactly as on the instrument).
    case 'effects.focus.piano-a':
      if (on) {
        state.focusedLayer = 'piano.a'
        state.focus = 'piano'
      }
      return
    case 'effects.focus.piano-b':
      if (on) {
        state.focusedLayer = 'piano.b'
        state.focus = 'piano'
      }
      return
    case 'performance.rotary.on':
      state.rotary.on = on
      return
    case 'performance.rotary.drive':
      state.rotary.drive = num
      return
    case 'performance.rotary.speed':
      state.rotary.speed = num === 1 ? 'Fast' : 'Slow'
      return
    default:
      return
  }
}

function clampIndex(value: number, length: number): number {
  return Math.max(0, Math.min(length - 1, Math.round(value)))
}

/**
 * The panel values the Panel should *display* for effects state, so an LED cannot claim a
 * setting the graph is not using. Returns the same units the catalog declares.
 */
export function effectPanelValue(state: EffectState, id: string): number | boolean | undefined {
  const chain = state.chains[editedChain(state)]
  switch (id) {
    case 'effects.mod1.type':
      return MOD1_TYPES.indexOf(chain.mod1.type)
    case 'effects.mod1.rate':
      return chain.mod1.rate
    case 'effects.mod1.amount':
      return chain.mod1.amount
    case 'effects.mod1.on':
      return chain.mod1.on
    case 'effects.mod2.type':
      return MOD2_TYPES.indexOf(chain.mod2.type)
    case 'effects.mod2.rate':
      return chain.mod2.rate
    case 'effects.mod2.amount':
      return chain.mod2.amount
    case 'effects.mod2.on':
      return chain.mod2.on
    case 'effects.delay.tempo':
      return chain.delay.tempo
    case 'effects.delay.feedback':
      return chain.delay.feedback
    case 'effects.delay.dry-wet':
      return chain.delay.dryWet
    case 'effects.delay.filter':
      return DELAY_FILTERS.indexOf(chain.delay.filter)
    case 'effects.delay.ping-pong':
      return chain.delay.pingPong
    case 'effects.delay.on':
      return chain.delay.on
    case 'effects.amp.model':
      return AMP_MODELS.indexOf(chain.ampEq.model)
    case 'effects.amp.drive':
      return chain.ampEq.drive
    case 'effects.amp.bass':
      return chain.ampEq.bass
    case 'effects.amp.mid':
      return chain.ampEq.mid
    case 'effects.amp.freq':
      return chain.ampEq.midFreq
    case 'effects.amp.treble':
      return chain.ampEq.treble
    case 'effects.amp.on':
      return chain.ampEq.on
    case 'effects.comp.amount':
      return chain.compressor.amount
    case 'effects.comp.fast':
      return chain.compressor.fast
    case 'effects.comp.on':
      return chain.compressor.on
    case 'effects.reverb.dry-wet':
      return chain.reverb.dryWet
    case 'effects.reverb.type':
      return REVERB_TYPES.indexOf(chain.reverb.type)
    case 'effects.reverb.tone':
      return chain.reverb.tone === 'Dark' ? 1 : 0
    case 'effects.reverb.on':
      return chain.reverb.on
    case 'effects.focus.piano-a':
      return state.focusedLayer === 'piano.a'
    case 'effects.focus.piano-b':
      return state.focusedLayer === 'piano.b'
    case 'performance.rotary.on':
      return state.rotary.on
    case 'performance.rotary.drive':
      return state.rotary.drive
    case 'performance.rotary.speed':
      return state.rotary.speed === 'Fast' ? 1 : 0
    default:
      return undefined
  }
}

/** The same for Piano state. */
export function pianoPanelValue(state: PianoState, id: string): number | boolean | undefined {
  switch (id) {
    case 'piano.section.on':
      return state.sectionOn
    case 'piano.layer.a.on':
      return state.layers['piano.a'].enabled
    case 'piano.layer.b.on':
      return state.layers['piano.b'].enabled
    case 'piano.layer.a.level':
      return state.layers['piano.a'].level
    case 'piano.layer.b.level':
      return state.layers['piano.b'].level
    case 'piano.sustped':
      return state.layers['piano.a'].sustPed
    case 'piano.pstick':
      return state.layers[state.focused].pitchStick
    case 'piano.soft-release':
      return state.softRelease
    case 'piano.string-res':
      return state.stringRes
    case 'piano.unison':
      return state.unison
    case 'piano.kb-touch':
      return state.kbTouch
    case 'piano.dyn-comp':
      return state.dynComp
    case 'piano.type':
      return PIANO_TYPES.findIndex((t) => t.id === state.layers[state.focused].type)
    case 'piano.model':
      return modelsForType(state.layers[state.focused].type).findIndex(
        (m) => m.id === state.layers[state.focused].model,
      ) + 1
    case 'piano.timbre':
      return state.timbre
    case 'performance.master-level':
      return state.masterLevel
    default:
      return undefined
  }
}
