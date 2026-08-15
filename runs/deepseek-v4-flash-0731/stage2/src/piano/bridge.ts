import { StageEngine, defaultLayer, type LayerState } from '../audio/stage'
import { AMPEQ_TYPES, MOD1_TYPES, MOD2_TYPES, REVERB_TYPES } from '../audio/effects'
import type { LayerChainState } from '../audio/chain'
import { PIANO_TYPES, type PianoType } from '../audio/samples'
import type { ControlValue } from '../hardware/types'
import type { HardwareState } from '../hardware/store'

/**
 * Bridge from the normalized hardware presentation store to the two-layer
 * StageEngine. Every functional Phase 2 piano and FX control reads its value
 * from the store and pushes it into the engine. This keeps the panel and the
 * audible signal path in lockstep, satisfying "control agrees with its panel
 * feedback", while Organ/Synth/Program controls never reach the engine (they
 * stay decorative).
 */

function num(v: ControlValue, fallback = 0): number {
  return typeof v === 'number' ? v : fallback
}

function bool(v: ControlValue, fallback = false): boolean {
  return v === true ? true : v === false ? false : fallback
}

export type LayerName = 'A' | 'B'

/** read the focused piano layer from the store. */
export function focusedLayer(state: HardwareState): LayerName {
  return bool(state['piano.layer-a-focus']) ? 'A' : 'B'
}

/** integer octave from a 3-step knob (indices 0,1,2 -> -1, 0, +1). */
function octaveFrom(v: number): number {
  const idx = Math.max(0, Math.min(2, Math.round(v * 2)))
  return (idx - 1) * 12
}

/** piano type from the six type buttons. */
function typeFrom(state: HardwareState): PianoType {
  for (let i = 0; i < PIANO_TYPES.length; i++) {
    const id = `piano.type-${PIANO_TYPES[i].toLowerCase()}`
    if (bool(state[id])) return PIANO_TYPES[i]
  }
  return 'Grand'
}

/** KB Touch: 3-step knob -> 0 Heavy, 1 Medium, 2 Light. */
function kbTouchFrom(v: number): number {
  return Math.max(0, Math.min(2, Math.round(v * 2)))
}

/** Dyn Comp: 4-step knob -> 0..3. */
function dynCompFrom(v: number): number {
  return Math.max(0, Math.min(3, Math.round(v * 3)))
}

/** Unison: 4-step knob -> 0..3. */
function unisonFrom(v: number): number {
  return Math.max(0, Math.min(3, Math.round(v * 3)))
}

function buildLayer(name: LayerName, state: HardwareState): LayerState {
  const focused = focusedLayer(state)
  const layer = defaultLayer()
  layer.enabled = bool(state[`piano.layer-${name.toLowerCase()}-on`], name === 'A')
  layer.level = num(state[`piano.layer-${name.toLowerCase()}-level`], name === 'A' ? 0.8 : 0.6)
  layer.octave = octaveFrom(num(state[`piano.layer-${name.toLowerCase()}-octave`], 0.5))
  layer.sustped = bool(state['piano.sustain-pedal'], true)
  layer.pstick = bool(state['piano.pitch-stick'])
  layer.type = typeFrom(state)
  layer.kbTouch = kbTouchFrom(num(state['piano.kb-touch'], 0.5))
  layer.dynComp = dynCompFrom(num(state['piano.dyn-comp'], 0))
  layer.timbre = num(state['piano.timbre'], 0)
  layer.unison = unisonFrom(num(state['piano.unison'], 0))
  layer.softRelease = bool(state['piano.soft-release'])
  layer.stringRes = bool(state['piano.string-res'])

  // FX chain: focus follows layer focus; grouped layers share the focused chain.
  const active = state['fx.all-bypass'] !== false // Layer effects ON (true = effects active)
  const group = bool(state['fx.group'])
  const delayGlobal = bool(state['fx.delay-global'])
  const compGlobal = bool(state['fx.comp-global'])
  const reverbGlobal = bool(state['fx.reverb-global'])

  const chain: LayerChainState = {
    on: {
      mod1: bool(state['fx.mod1-on']),
      mod2: bool(state['fx.mod2-on']),
      delay: bool(state['fx.delay-on']),
      ampEq: bool(state['fx.amp-on'], true),
      compressor: bool(state['fx.comp-on']),
      reverb: bool(state['fx.reverb-on']),
    },
    params: {
      mod1: { type: Math.round(num(state['fx.mod1-type'], 0)) % MOD1_TYPES.length, rate: num(state['fx.mod1-rate'], 0.3), amount: num(state['fx.mod1-amount'], 0.4) },
      mod2: { type: Math.round(num(state['fx.mod2-type'], 0)) % MOD2_TYPES.length, rate: num(state['fx.mod2-rate'], 0.3), amount: num(state['fx.mod2-amount'], 0.4) },
      delay: {
        rate: num(state['fx.delay-rate'], 0.3),
        feedback: num(state['fx.delay-feedback'], 0.3),
        mix: num(state['fx.delay-mix'], 0.2),
        filter: Math.max(0, Math.min(3, Math.round(num(state['fx.delay-filter'], 0)))),
      },
      ampEq: {
        type: Math.round(num(state['fx.amp-type'], 0)) % AMPEQ_TYPES.length,
        amount: num(state['fx.amp-drive'], 0.2),
        bass: num(state['fx.eq-bass'], 0.5),
        res: num(state['fx.eq-mid'], 0.5),
        treble: num(state['fx.eq-treble'], 0.5),
        freq: num(state['fx.eq-mid-freq'], 0.5),
      },
      compressor: { amount: num(state['fx.comp-threshold'], 0.3), fast: bool(state['fx.comp-fast']) },
      reverb: {
        type: Math.round(num(state['fx.reverb-type'], 0)) % REVERB_TYPES.length,
        mix: num(state['fx.reverb-mix'], 0.3),
        bright: num(state['fx.reverb-bright'], 0.5),
      },
    },
    allBypass: !active,
    // To Rotary routes the specific layer into the shared rotary.
    toRotary: name === 'A' ? bool(state['fx.to-rotary-a']) : bool(state['fx.to-rotary-b']),
  }

  // Group / global routing: a non-focused layer inherits the focused chain
  // when grouped, or when a global-capable unit is globally applied.
  if (name !== focused) {
    const focusedChain = buildFocusedChain(state)
    if (group) {
      chain.on = { ...focusedChain.on }
      chain.params = { ...focusedChain.params }
      chain.allBypass = focusedChain.allBypass
      chain.toRotary = focusedChain.toRotary
    } else {
      // even ungrouped: global-capable units reach every layer of all sections
      if (delayGlobal) { chain.on.delay = focusedChain.on.delay; chain.params.delay = focusedChain.params.delay }
      if (compGlobal) { chain.on.compressor = focusedChain.on.compressor; chain.params.compressor = focusedChain.params.compressor }
      if (reverbGlobal) { chain.on.reverb = focusedChain.on.reverb; chain.params.reverb = focusedChain.params.reverb }
    }
  }

  layer.chain = chain
  return layer
}

/** Rebuild the focused layer's chain (pure, for group inheritance). */
function buildFocusedChain(state: HardwareState) {
  return buildLayer(focusedLayer(state), state).chain
}

/**
 * Synchronize the whole engine from the store. Called on every store change.
 */
export function syncEngineFromStore(engine: StageEngine, state: HardwareState): void {
  engine.setLayer('A', buildLayer('A', state))
  engine.setLayer('B', buildLayer('B', state))
}

/** Current master level from the store (0..1). */
export function masterLevelFrom(state: HardwareState): number {
  return num(state['perf.master-level'], 0.8)
}

void null
