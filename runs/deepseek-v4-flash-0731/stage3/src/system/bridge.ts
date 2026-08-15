/**
 * Phase 3 — bridge from the normalized hardware presentation store to the
 * System4 instrument. This is the control-binding audit: every non-excluded
 * control reads its value from the store and drives a canonical System4
 * behaviour.
 *
 * The bridge is DELTA-based: program navigation (buttons/page/dial/Store/Live/
 * Scenes/Split) is edge-triggered from momentary or latching controls, and
 * sound controls are applied only when their value changes. This keeps a
 * freshly loaded program intact until the player actually moves a control —
 * moving a control edits the working program and marks it dirty (Live slots
 * auto-store). Master Level is routed outside the program (spec excludes it).
 *
 * Morph assignment: holding a morph source button and moving a morph-capable
 * control assigns {path, from: press-snapshot, to: new value}; Shift+the
 * source button clears the source's assignments.
 */

import { System4 } from '../audio/system4'
import type { HardwareState } from '../hardware/store'
import type { ControlValue } from '../hardware/types'
import type { ProgramState } from './program'

function num(v: ControlValue, fb = 0): number {
  return typeof v === 'number' ? v : fb
}
function bool(v: ControlValue, fb = false): boolean {
  return v === true ? true : v === false ? false : fb
}

/** incremental octave from a 3-step knob → -12,0,12. */
function octaveFrom(v: number): number {
  return (Math.max(0, Math.min(2, Math.round(v * 2))) - 1) * 12
}

export type MorphSource = 'wheel' | 'pedal' | null

/**
 * Morphable control id → program-state path (morph destination target).
 * Morph destinations are exactly the spec list (layer levels, drawbars,
 * rotary speed, synth LFO/OscCtrl/filter, arp rate, effect params).
 */
const MORPHABLE: Record<string, string> = {
  'organ.level': 'organ.layers.0.level',
  'synth.s1-level': 'synth.layers.0.level',
  'synth.s2-level': 'synth.layers.1.level',
  'synth.s3-level': 'synth.layers.2.level',
  'piano.layer-a-level': 'piano.layers.0.level',
  'piano.layer-b-level': 'piano.layers.1.level',
  'synth.osc-ctrl': 'synth.layers.0.oscCtrl',
  'synth.filter-cutoff': 'synth.layers.0.cutoff',
  'synth.filter-res': 'synth.layers.0.res',
  'synth.lfo-rate': 'synth.layers.0.lfo.rate',
  'synth.lfo-depth': 'synth.layers.0.lfo.modAmt',
  'fx.mod1-rate': 'piano.chains.0.params.mod1.rate',
  'fx.mod1-amount': 'piano.chains.0.params.mod1.amount',
  'fx.mod2-amount': 'piano.chains.0.params.mod2.amount',
  'fx.delay-rate': 'piano.chains.0.params.delay.rate',
  'fx.delay-feedback': 'piano.chains.0.params.delay.feedback',
  'fx.delay-mix': 'piano.chains.0.params.delay.mix',
  'fx.eq-mid': 'piano.chains.0.params.ampEq.res',
  'fx.reverb-mix': 'piano.chains.0.params.reverb.mix',
}

/** which source is held (persistent across sync calls). */
const heldSource: { value: MorphSource } = { value: null }
/** snapshots of morphable control values at the moment a source was held. */
const holdSnap: { at: Record<string, number> } = { at: {} }
/** last seen state, for edge detection. */
let lastState: HardwareState | null = null

/** apply one sound-control change to the working program. */
type ApplyFn = (p: ProgramState, v: ControlValue) => void

const APPLY: Record<string, ApplyFn> = {
  // organ
  'organ.db-16': (p, v) => { p.organ.drawbars[0] = Math.round(num(v)) },
  'organ.db-5-1-3': (p, v) => { p.organ.drawbars[1] = Math.round(num(v)) },
  'organ.db-8': (p, v) => { p.organ.drawbars[2] = Math.round(num(v)) },
  'organ.db-4': (p, v) => { p.organ.drawbars[3] = Math.round(num(v)) },
  'organ.db-2-2-3': (p, v) => { p.organ.drawbars[4] = Math.round(num(v)) },
  'organ.db-2': (p, v) => { p.organ.drawbars[5] = Math.round(num(v)) },
  'organ.db-1-3-5': (p, v) => { p.organ.drawbars[6] = Math.round(num(v)) },
  'organ.db-1-1-3': (p, v) => { p.organ.drawbars[7] = Math.round(num(v)) },
  'organ.db-1': (p, v) => { p.organ.drawbars[8] = Math.round(num(v)) },
  'organ.model-b3': (p, v) => { if (bool(v)) { p.organ.layers[0].model = 'B3'; p.organ.layers[1].model = 'B3' } },
  'organ.model-vox': (p, v) => { if (bool(v)) { p.organ.layers[0].model = 'Vox'; p.organ.layers[1].model = 'Vox' } },
  'organ.model-farf': (p, v) => { if (bool(v)) { p.organ.layers[0].model = 'Farf'; p.organ.layers[1].model = 'Farf' } },
  'organ.model-pipe': (p, v) => { if (bool(v)) { p.organ.layers[0].model = 'Pipe1'; p.organ.layers[1].model = 'Pipe1' } },
  'organ.percussion': (p, v) => { p.organ.percussion.on = bool(v) },
  'organ.perc-decay': (p, v) => { if (bool(v)) p.organ.percussion.fast = !p.organ.percussion.fast },
  'organ.perc-level': (p, v) => { if (bool(v)) p.organ.percussion.soft = !p.organ.percussion.soft },
  'organ.vibrato': (p, v) => { p.organ.layers[0].vibratoOn = bool(v) },
  'organ.vibrato-chorus': (p, v) => { p.organ.vibratoChorus = Math.round(num(v) * 5) },
  'organ.level': (p, v) => { p.organ.layers[0].level = num(v, 0.7) },
  'organ.rotary-speed': (p, v) => { p.organ.rotarySpeed = Math.round(num(v) * 2) },
  'organ.rotary-drive': (p, v) => { p.organ.rotaryDrive = num(v, 0.2) },
  // piano
  'piano.layer-a-on': (p, v) => { p.piano.layers[0].enabled = bool(v, true) },
  'piano.layer-b-on': (p, v) => { p.piano.layers[1].enabled = bool(v) },
  'piano.layer-a-level': (p, v) => { p.piano.layers[0].level = num(v, 0.8) },
  'piano.layer-b-level': (p, v) => { p.piano.layers[1].level = num(v, 0.6) },
  'piano.layer-a-octave': (p, v) => { p.piano.layers[0].octave = octaveFrom(num(v, 0.5)) },
  'piano.layer-b-octave': (p, v) => { p.piano.layers[1].octave = octaveFrom(num(v, 0.5)) },
  'piano.type-grand': (p, v) => { if (bool(v)) { p.piano.layers[0].type = 'Grand'; p.piano.layers[1].type = 'Grand' } },
  'piano.type-upright': (p, v) => { if (bool(v)) { p.piano.layers[0].type = 'Upright'; p.piano.layers[1].type = 'Upright' } },
  'piano.type-electric': (p, v) => { if (bool(v)) { p.piano.layers[0].type = 'Electric'; p.piano.layers[1].type = 'Electric' } },
  'piano.type-clav': (p, v) => { if (bool(v)) { p.piano.layers[0].type = 'Clav'; p.piano.layers[1].type = 'Clav' } },
  'piano.type-digital': (p, v) => { if (bool(v)) { p.piano.layers[0].type = 'Digital'; p.piano.layers[1].type = 'Digital' } },
  'piano.type-misc': (p, v) => { if (bool(v)) { p.piano.layers[0].type = 'Misc'; p.piano.layers[1].type = 'Misc' } },
  'piano.kb-touch': (p, v) => { p.piano.layers[0].kbTouch = Math.max(0, Math.min(2, Math.round(num(v, 0.5) * 2))) },
  'piano.dyn-comp': (p, v) => { p.piano.layers[0].dynComp = Math.max(0, Math.min(3, Math.round(num(v, 0) * 3))) },
  'piano.timbre': (p, v) => { p.piano.layers[0].timbre = num(v, 0) },
  'piano.unison': (p, v) => { p.piano.layers[0].unison = Math.max(0, Math.min(3, Math.round(num(v, 0) * 3))) },
  'piano.soft-release': (p, v) => { p.piano.layers[0].softRelease = bool(v) },
  'piano.string-res': (p, v) => { p.piano.layers[0].stringRes = bool(v) },
  'piano.sustain-pedal': (p, v) => { p.piano.layers[0].sustped = bool(v, true) },
  'piano.pitch-stick': (p, v) => { p.piano.layers[0].pstick = bool(v) },
  // synth
  'synth.s1-level': (p, v) => { p.synth.layers[0].level = num(v, 0.7) },
  'synth.s2-level': (p, v) => { p.synth.layers[1].level = num(v, 0.7) },
  'synth.s3-level': (p, v) => { p.synth.layers[2].level = num(v, 0.7) },
  'synth.osc-wave': (p, v) => {
    const w = Math.round(num(v, 0) * 9)
    const cat = w < 7 ? 'Pure' : w < 9 ? 'Sync' : 'Super'
    p.synth.layers[0].category = cat as ProgramState['synth']['layers'][number]['category']
    p.synth.layers[0].wave = cat === 'Pure' ? w % 7 : w % 2
  },
  'synth.osc-octave': (p, v) => { p.synth.layers[0].oscOctave = Math.round(num(v, 0.5) * 2) - 1 },
  'synth.osc-fine': (p, v) => { p.synth.layers[0].oscFine = (num(v, 0.5) - 0.5) * 100 },
  'synth.osc-ctrl': (p, v) => { p.synth.layers[0].oscCtrl = num(v, 0.2) * 10 },
  'synth.filter-cutoff': (p, v) => { p.synth.layers[0].cutoff = num(v, 0.8) },
  'synth.filter-res': (p, v) => { p.synth.layers[0].res = num(v, 0) },
  'synth.filter-keytrack': (p, v) => { p.synth.layers[0].keytrack = (num(v, 0.5) - 0.5) * 2 },
  'synth.env-amp-a': (p, v) => { p.synth.layers[0].envAmp.a = num(v, 0.1) * 2 },
  'synth.env-amp-d': (p, v) => { p.synth.layers[0].envAmp.d = num(v, 0.4) * 2 },
  'synth.env-amp-s': (p, v) => { p.synth.layers[0].envAmp.amount = num(v, 0.6) },
  'synth.env-amp-r': (p, v) => { p.synth.layers[0].envAmp.r = num(v, 0.3) * 2 },
  'synth.env-filt-a': (p, v) => { p.synth.layers[0].envFilt.amount = (num(v, 0) - 0.5) * 2 },
  'synth.lfo-rate': (p, v) => { p.synth.layers[0].lfo.rate = num(v, 0.2) },
  'synth.lfo-depth': (p, v) => { p.synth.layers[0].lfo.modAmt = num(v, 0) },
  'synth.lfo-shape': (p, v) => { p.synth.layers[0].lfo.wave = (Math.round(num(v, 0) * 3) % 5) as 0 | 1 | 2 | 3 | 4 },
  'synth.voice-mode': (p, v) => { p.synth.layers[0].voice.mode = Math.max(0, Math.min(2, Math.round(num(v, 0) * 2))) as 0 | 1 | 2 },
  'synth.unison': (p, v) => { p.synth.layers[0].voice.unison = bool(v) ? 2 : 0 },
  'synth.glide': (p, v) => { p.synth.layers[0].voice.glide = num(v, 0) },
  'synth.vibrato': (p, v) => { p.synth.layers[0].voice.vibratoOn = bool(v) },
  'synth.arp-on': (p, v) => { p.synth.layers[0].arp.run = bool(v) },
  'synth.arp-mode': (p, v) => { p.synth.layers[0].arp.rate = (num(v, 0) % 1) },
  // effects (focused piano chain; group/global reach other chains via engine)
  'fx.mod1-on': (p, v) => { p.piano.chains[0].on.mod1 = bool(v) },
  'fx.mod1-type': (p, v) => { p.piano.chains[0].params.mod1.type = Math.round(num(v)) % 6 },
  'fx.mod1-rate': (p, v) => { p.piano.chains[0].params.mod1.rate = num(v, 0.3) },
  'fx.mod1-amount': (p, v) => { p.piano.chains[0].params.mod1.amount = num(v, 0.4) },
  'fx.mod2-on': (p, v) => { p.piano.chains[0].on.mod2 = bool(v) },
  'fx.mod2-type': (p, v) => { p.piano.chains[0].params.mod2.type = Math.round(num(v)) % 6 },
  'fx.mod2-rate': (p, v) => { p.piano.chains[0].params.mod2.rate = num(v, 0.3) },
  'fx.mod2-amount': (p, v) => { p.piano.chains[0].params.mod2.amount = num(v, 0.4) },
  'fx.amp-type': (p, v) => { p.piano.chains[0].params.ampEq.type = Math.round(num(v)) % 6 },
  'fx.amp-drive': (p, v) => { p.piano.chains[0].params.ampEq.amount = num(v, 0.2) },
  'fx.eq-bass': (p, v) => { p.piano.chains[0].params.ampEq.bass = num(v, 0.5) },
  'fx.eq-mid': (p, v) => { p.piano.chains[0].params.ampEq.res = num(v, 0.5) },
  'fx.eq-mid-freq': (p, v) => { p.piano.chains[0].params.ampEq.freq = num(v, 0.5) },
  'fx.eq-treble': (p, v) => { p.piano.chains[0].params.ampEq.treble = num(v, 0.5) },
  'fx.amp-on': (p, v) => { p.piano.chains[0].on.ampEq = bool(v, true) },
  'fx.delay-rate': (p, v) => { p.piano.chains[0].params.delay.rate = num(v, 0.3) },
  'fx.delay-feedback': (p, v) => { p.piano.chains[0].params.delay.feedback = num(v, 0.3) },
  'fx.delay-mix': (p, v) => { p.piano.chains[0].params.delay.mix = num(v, 0.2) },
  'fx.delay-filter': (p, v) => { p.piano.chains[0].params.delay.filter = Math.max(0, Math.min(3, Math.round(num(v)))) },
  'fx.delay-on': (p, v) => { p.piano.chains[0].on.delay = bool(v) },
  'fx.comp-threshold': (p, v) => { p.piano.chains[0].params.compressor.amount = num(v, 0.3) },
  'fx.comp-fast': (p, v) => { p.piano.chains[0].params.compressor.fast = bool(v) },
  'fx.comp-on': (p, v) => { p.piano.chains[0].on.compressor = bool(v) },
  'fx.reverb-type': (p, v) => { p.piano.chains[0].params.reverb.type = Math.round(num(v)) % 6 },
  'fx.reverb-mix': (p, v) => { p.piano.chains[0].params.reverb.mix = num(v, 0.3) },
  'fx.reverb-bright': (p, v) => { p.piano.chains[0].params.reverb.bright = num(v, 0.5) },
  'fx.reverb-on': (p, v) => { p.piano.chains[0].on.reverb = bool(v) },
  'fx.all-bypass': (p, v) => { p.piano.chains[0].allBypass = bool(v) !== true },
}

/**
 * Synchronize the whole instrument from the store. Called on every store
 * change. Returns the master level for the graph.
 */
export function syncSystemFromStore(system: System4, state: HardwareState): number {
  const prev = lastState ?? state
  lastState = state

  const master = num(state['perf.master-level'], 0.8)
  system.setMasterLevel(master)

  /* ------------- Program section navigation (edge-triggered). ----------- */
  for (let i = 1; i <= 8; i++) {
    const id = `prog.btn-${i}`
    if (bool(state[id]) && !bool(prev[id])) system.selectProgram(system.page * 8 + (i - 1))
  }
  if (bool(state['prog.page-up']) && !bool(prev['prog.page-up'])) system.pageUp()
  if (bool(state['prog.page-down']) && !bool(prev['prog.page-down'])) system.pageDown()
  const dial = num(state['prog.dial'], 0)
  const prevDial = num(prev['prog.dial'], 0)
  if (dial !== prevDial) system.dialNudge(dial - prevDial)
  if (bool(state['prog.store']) && !bool(prev['prog.store'])) system.storePress()
  if (bool(state['prog.live-mode']) !== bool(prev['prog.live-mode'])) system.toggleLive()
  const sceneA = bool(state['prog.layer-scene-a'])
  const sceneB = bool(state['prog.layer-scene-b'])
  if (sceneB !== bool(prev['prog.layer-scene-b']) && sceneB) system.setScene('II')
  else if (sceneA !== bool(prev['prog.layer-scene-a']) && sceneA) system.setScene('I')
  if (bool(state['prog.split']) !== bool(prev['prog.split']) && bool(state['prog.split'])) system.toggleSplit()

  /* ------------- Morph assignment (hold + move; release assigns). ------- */
  const wheelHeld = bool(state['prog.morph-wheel'])
  const pedalHeld = bool(state['prog.morph-pedal'])
  const wheelRise = wheelHeld && !bool(prev['prog.morph-wheel'])
  const pedalRise = pedalHeld && !bool(prev['prog.morph-pedal'])
  if (wheelRise) beginHold('wheel', state)
  if (pedalRise) beginHold('pedal', state)
  if (!wheelHeld && heldSource.value === 'wheel') endHold(system, 'wheel', state)
  if (!pedalHeld && heldSource.value === 'pedal') endHold(system, 'pedal', state)

  /* ---------------- sound controls: apply only the deltas. -------------- */
  let changed = false
  const working = JSON.parse(JSON.stringify(system.currentProgram)) as ProgramState
  for (const id of Object.keys(APPLY)) {
    const now = state[id]
    const was = prev[id]
    if (now === was) continue
    APPLY[id](working, now)
    changed = true
    // live morph assignment: a held source + a moving morphable control.
    if (heldSource.value !== null && id in MORPHABLE) {
      const path = MORPHABLE[id]
      const snap = holdSnap.at[id]
      if (typeof snap === 'number') system.assignMorph(heldSource.value, path, snap, num(now))
    }
  }
  if (changed) system.setWorking(working)

  return master
}

function beginHold(source: 'wheel' | 'pedal', state: HardwareState): void {
  heldSource.value = source
  holdSnap.at = {}
  for (const id of Object.keys(MORPHABLE)) {
    const v = state[id]
    if (typeof v === 'number') holdSnap.at[id] = v
  }
}

function endHold(system: System4, source: 'wheel' | 'pedal', state: HardwareState): void {
  for (const id of Object.keys(MORPHABLE)) {
    const path = MORPHABLE[id]
    const snap = holdSnap.at[id]
    const now = state[id]
    if (snap === undefined || typeof now !== 'number') continue
    if (Math.abs(now - snap) > 1e-6 && !alreadyAssigned(system, source, path)) {
      system.assignMorph(source, path, snap, now)
    }
  }
  heldSource.value = null
  holdSnap.at = {}
}

function alreadyAssigned(system: System4, source: 'wheel' | 'pedal', path: string): boolean {
  const list = source === 'wheel' ? system.currentProgram.morph.wheel : system.currentProgram.morph.pedal
  return list.some((a) => a.path === path)
}
