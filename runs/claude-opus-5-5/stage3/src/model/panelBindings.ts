// Panel bindings for the Piano section, Layer Effects section (six chains), Rotary, Master Level
// and pitch stick (Phase 2, extended in Phase 3): controls write canonical SoundState; the panel
// shows that state back (focused layer and focused effect chain). Organ/Synth bindings live in
// bindings/organSynth.ts, the Program section in system/controller.ts. Shift functions follow the
// manual: Shift+Layer A = SUSTPED, Shift+Layer B = PSTICK (p. 23), Shift+Piano/Synth FX focus =
// GROUP, Shift+Organ FX focus = ALL FX OFF, Shift+Delay/Comp/Reverb ON = GLOBAL (p. 48), Shift+Comp
// Amount = FAST (p. 52), Shift + turn Mod 1 Rate / Delay Tempo = MST CLK sync, Shift+Octave = KB zone.
import { KB_TOUCH, modelsOfType, PIANO_TYPES, timbresFor, TIMBRES, type KbTouch } from '../audio/instruments'
import { MOD1_TYPES, MOD2_TYPES } from '../audio/fx/modulation'
import { TapTempo, tempoForSeconds } from '../audio/fx/delay'
import {
  AMP_TYPES,
  CHAINS,
  currentModel,
  editUnit,
  focusedUnit,
  focusLayer,
  PIANO_CHAINS,
  pressLayerButton,
  REVERB_TYPES,
  routesToRotary,
  setGlobal,
  setGroup,
  setSynthGroup,
  stepModel,
  SYNTH_CHAINS,
  updateLayer,
  type ChainId,
  type DelayFilter,
  type GlobalUnit,
  type ReverbTone,
  type SoundState,
} from './sound'
import { octaveButton, ORGAN_SYNTH_FUNCTIONAL } from './bindings/organSynth'

export type Indicator = 'on' | 'off' | 'flash'

/** Program-section controls bound by the controller (system/controller.ts). */
export const PROGRAM_FUNCTIONAL: Readonly<Record<string, string>> = {
  'program-morph-wheel': 'Morph assign for the Wheel: click to latch, then move destinations to their end values (Shift: clear Wheel morphs)',
  'program-morph-ctrlped': 'Morph assign for the Control Pedal: click to latch, then move destinations (Shift: clear pedal morphs)',
  'program-split': 'Split on/off (Shift: split edit — points, positions, crossfades)',
  'program-master-clock': 'Master Clock: tap four or more times, or press and turn the dial (30–300 BPM)',
  'program-transpose': 'Transpose on/off and set with the dial ±6 (Shift: Panic)',
  'program-store': 'Store the program (Shift: Store As with naming)',
  'program-dial': 'Program dial: browse programs (Shift: numeric list); sets values in store, clock, transpose and split modes',
  'program-page-left': 'Program page left',
  'program-page-right': 'Program page right',
  'program-live-mode': 'Live Mode: the program buttons select 8 auto-storing Live slots',
  'program-layer-scene': 'Layer Scene I/II: toggles layer enables only',
  ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`program-slot-${i + 1}`, `Program button ${i + 1}`])),
  'program-solo': 'Solo: only the focused section sounds (Shift: Undo the last program change from an edited program)',
}

/** Every functional control id with what it controls (used for accessible descriptions). */
export const FUNCTIONAL: Readonly<Record<string, string>> = {
  'performance-master-level': 'Master output level',
  'performance-rotary-speed': 'Shared Rotary speaker slow/fast (morphable)',
  'performance-rotary-drive': 'Shared Rotary speaker drive',
  'performance-rotary-organ': 'Route the Organ section to the shared Rotary speaker',
  'performance-rotary-stop-mode': 'Rotary Stop mode: Slow stops the rotors',
  'performance-pitch-stick': 'Pitch bend ±2 semitones for layers with PSTICK on',
  'performance-mod-wheel': 'Modulation wheel: Wheel morph source and synth vibrato (Wheel mode)',
  'piano-on': 'Piano section on/off',
  'piano-level-a': 'Piano layer A level',
  'piano-level-b': 'Piano layer B level',
  'piano-layer-a': 'Piano layer A on/focus/off (Shift: SUSTPED for the focused layer)',
  'piano-layer-b': 'Piano layer B on/focus/off (Shift: PSTICK for the focused layer)',
  'piano-acoustics': 'Soft Release and String Resonance of the focused layer',
  'piano-unison': 'Unison of the focused layer',
  'piano-kb-touch': 'KB Touch velocity curve of the focused layer',
  'piano-dyn-comp': 'Dynamic compression of the focused layer',
  'piano-type': 'Piano type of the focused layer',
  'piano-model': 'Piano model within the type, focused layer',
  'piano-timbre': 'Timbre of the focused layer',
  'piano-octave-down': 'Octave shift down, focused layer (Shift: KB zone)',
  'piano-octave-up': 'Octave shift up, focused layer (Shift: KB zone)',
  'effects-on': 'Layer Effects on (off bypasses every effect)',
  'effects-focus-organ': 'Effects focus: the shared organ chain (Shift: ALL FX OFF)',
  'effects-focus-piano': 'Effects focus: piano layer A/B (Shift: GROUP)',
  'effects-focus-synth': 'Effects focus: synth layer A/B/C (Shift: GROUP)',
  'effects-mod1-rate': 'Mod 1 rate / A-Wah sensitivity (morphable; Shift + turn: MST CLK sync)',
  'effects-mod1-amount': 'Mod 1 amount (morphable)',
  'effects-mod1-type': 'Mod 1 type',
  'effects-mod1-on': 'Mod 1 on',
  'effects-mod2-rate': 'Mod 2 rate',
  'effects-mod2-amount': 'Mod 2 amount (morphable)',
  'effects-mod2-type': 'Mod 2 type',
  'effects-mod2-on': 'Mod 2 on',
  'effects-amp-drive': 'Amp Sim drive (morphable)',
  'effects-eq-freq': 'EQ mid frequency / filter cutoff (morphable)',
  'effects-amp-type': 'Amp Sim type (unlit = EQ only)',
  'effects-eq-bass': 'EQ bass',
  'effects-eq-mid': 'EQ mid gain / filter resonance',
  'effects-eq-treble': 'EQ treble',
  'effects-amp-on': 'Amp Sim/EQ on',
  'effects-delay-tempo': 'Delay time (morphable; Shift + turn: MST CLK sync)',
  'effects-delay-feedback': 'Delay feedback (morphable)',
  'effects-delay-filter': 'Delay feedback filter (off/HP/LP/BP)',
  'effects-delay-tap': 'Delay tap tempo',
  'effects-delay-dry-wet': 'Delay dry/wet (morphable)',
  'effects-delay-on': 'Delay on (Shift: GLOBAL)',
  'effects-comp-amount': 'Compressor amount (Shift + turn: FAST on/off)',
  'effects-comp-on': 'Compressor on (Shift: GLOBAL)',
  'effects-reverb-tone': 'Reverb tone bright/dark',
  'effects-reverb-type': 'Reverb type',
  'effects-reverb-dry-wet': 'Reverb dry/wet (morphable)',
  'effects-reverb-on': 'Reverb on (Shift: GLOBAL)',
  // Shift rockers are functional modifiers for the controls above; a short press alone is EXIT.
  'effects-shift': 'Shift modifier (hold); press alone = Exit',
  'program-shift': 'Shift modifier (hold); press alone = Exit',
  ...ORGAN_SYNTH_FUNCTIONAL,
  ...PROGRAM_FUNCTIONAL,
}

export const isFunctional = (id: string) => Object.prototype.hasOwnProperty.call(FUNCTIONAL, id)

const KB_INDEX: Record<KbTouch, number> = { heavy: 1, medium: 2, light: 3 }
const TONES: ReverbTone[] = ['normal', 'bright', 'dark']
const FILTERS: DelayFilter[] = ['off', 'hp', 'lp', 'bp']
const cycle = (i: number, lo: number, hi: number) => (i >= hi ? lo : i + 1)

/** Panel values (store value per control id) that show a sound state. */
export function presentation(s: SoundState): Record<string, number> {
  const focus = s.piano.focus
  const l = s.piano.layers[focus]
  const f = <K extends 'mod1' | 'mod2' | 'delay' | 'amp' | 'comp' | 'reverb'>(k: K) => focusedUnit(s, k)
  return {
    'performance-master-level': s.master,
    'performance-rotary-speed': s.rotary.fast ? 2 : 1,
    'performance-rotary-drive': s.rotary.drive,
    'performance-pitch-stick': s.pitchStick,
    'piano-on': s.piano.on ? 1 : 0,
    'piano-level-a': s.piano.layers.A.level,
    'piano-level-b': s.piano.layers.B.level,
    'piano-layer-a': s.piano.layers.A.enabled ? 1 : 0,
    'piano-layer-b': s.piano.layers.B.enabled ? 1 : 0,
    'piano-acoustics': (l.softRelease ? 1 : 0) + (l.stringRes ? 2 : 0),
    'piano-unison': l.unison,
    'piano-kb-touch': KB_INDEX[l.kbTouch],
    'piano-dyn-comp': l.dynComp,
    'piano-type': PIANO_TYPES.indexOf(l.type) + 1,
    'piano-model': l.models[l.type],
    'piano-timbre': TIMBRES.indexOf(l.timbre),
    'performance-rotary-organ': s.rotary.organ ? 1 : 0,
    'performance-rotary-stop-mode': s.rotary.stopMode ? 1 : 0,
    'effects-on': s.fx.on ? 1 : 0,
    'effects-focus-organ': s.fx.focus === 'organ' ? 1 : 0,
    'effects-focus-piano': s.fx.focus === 'A' ? 1 : s.fx.focus === 'B' ? 2 : 0,
    'effects-focus-synth': SYNTH_CHAINS.indexOf(s.fx.focus) + 1,
    'effects-mod1-rate': f('mod1').rate,
    'effects-mod1-amount': f('mod1').amount,
    'effects-mod1-type': MOD1_TYPES.indexOf(f('mod1').type) + 1,
    'effects-mod1-on': f('mod1').on ? 1 : 0,
    'effects-mod2-rate': f('mod2').rate,
    'effects-mod2-amount': f('mod2').amount,
    'effects-mod2-type': MOD2_TYPES.indexOf(f('mod2').type) + 1,
    'effects-mod2-on': f('mod2').on ? 1 : 0,
    'effects-amp-drive': f('amp').drive,
    'effects-eq-freq': f('amp').freq,
    'effects-amp-type': AMP_TYPES.indexOf(f('amp').type),
    'effects-eq-bass': f('amp').bass,
    'effects-eq-mid': f('amp').mid,
    'effects-eq-treble': f('amp').treble,
    'effects-amp-on': f('amp').on ? 1 : 0,
    'effects-delay-tempo': f('delay').tempo,
    'effects-delay-feedback': f('delay').feedback,
    'effects-delay-filter': FILTERS.indexOf(f('delay').filter),
    'effects-delay-dry-wet': f('delay').dryWet,
    'effects-delay-on': f('delay').on ? 1 : 0,
    'effects-comp-amount': f('comp').amount,
    'effects-comp-on': f('comp').on ? 1 : 0,
    'effects-reverb-tone': TONES.indexOf(f('reverb').tone),
    'effects-reverb-type': REVERB_TYPES.indexOf(f('reverb').type) + 1,
    'effects-reverb-dry-wet': f('reverb').dryWet,
    'effects-reverb-on': f('reverb').on ? 1 : 0,
  }
}

/** LED indicators driven by sound state (LEDs that have no owning button, plus flashing). */
export function indicators(s: SoundState, failedModel: (layer: 'A' | 'B') => boolean): Record<string, Indicator> {
  const focus = s.piano.focus
  const l = s.piano.layers[focus]
  const both = s.piano.layers.A.enabled && s.piano.layers.B.enabled
  const on = (b: boolean): Indicator => (b ? 'on' : 'off')
  const pianoFocus = PIANO_CHAINS.includes(s.fx.focus)
  const synthFocus = SYNTH_CHAINS.includes(s.fx.focus)
  const out: Record<string, Indicator> = {
    'piano-led-fx-focus': on(pianoFocus),
    'piano-led-sustped': on(l.sustPed),
    'piano-led-pstick': on(l.pStick),
    'effects-led-focus-piano-a': on(pianoFocus && (s.fx.group || s.fx.focus === 'A')),
    'effects-led-focus-piano-b': on(pianoFocus && (s.fx.group || s.fx.focus === 'B')),
    'effects-led-focus-synth-a': on(synthFocus && (s.fx.synthGroup || s.fx.focus === 'synthA')),
    'effects-led-focus-synth-b': on(synthFocus && (s.fx.synthGroup || s.fx.focus === 'synthB')),
    'effects-led-focus-synth-c': on(synthFocus && (s.fx.synthGroup || s.fx.focus === 'synthC')),
    'effects-led-mod1-mst-clk': on(focusedUnit(s, 'mod1').sync),
    'effects-led-delay-mst-clk': on(focusedUnit(s, 'delay').sync),
    'effects-led-delay-global': on(s.fx.global.delay),
    'effects-led-comp-global': on(s.fx.global.comp),
    'effects-led-reverb-global': on(s.fx.global.reverb),
    'effects-led-comp-fast': on(focusedUnit(s, 'comp').fast),
    'effects-led-comp-active': on(s.fx.on && focusedUnit(s, 'comp').on),
    'effects-led-eq-on': on(focusedUnit(s, 'amp').on),
    'performance-led-rotary-on': on(CHAINS.some((c) => (c === 'organ' ? s.organ.on && routesToRotary(s, c) : routesToRotary(s, c)))),
    // With both layers on, the focused layer's LED blinks (manual p. 23).
    'piano-led-a-on': both && focus === 'A' ? 'flash' : on(s.piano.layers.A.enabled),
    'piano-led-b-on': both && focus === 'B' ? 'flash' : on(s.piano.layers.B.enabled),
  }
  // A model whose source failed: its type LED flashes (manual p. 24).
  for (const t of PIANO_TYPES) out[`piano-led-type-${t}`] = t === l.type ? (failedModel(focus) ? 'flash' : 'on') : 'off'
  return out
}

export interface BindingContext {
  shift: boolean
  nowMs: number
}

/** A button press on a functional button → next sound state (null = not a functional button). */
export function activate(s: SoundState, id: string, ctx: BindingContext, tap: TapTempo): SoundState | null {
  const focus = s.piano.focus
  const l = s.piano.layers[focus]
  switch (id) {
    case 'piano-on':
      return { ...s, piano: { ...s.piano, on: !s.piano.on } }
    case 'piano-layer-a':
      return ctx.shift ? updateLayer(s, focus, { sustPed: !l.sustPed }) : pressLayerButton(s, 'A')
    case 'piano-layer-b':
      return ctx.shift ? updateLayer(s, focus, { pStick: !l.pStick }) : pressLayerButton(s, 'B')
    case 'piano-acoustics': {
      const next = ((l.softRelease ? 1 : 0) + (l.stringRes ? 2 : 0) + 1) % 4
      return updateLayer(s, focus, { softRelease: (next & 1) === 1, stringRes: (next & 2) === 2 })
    }
    case 'piano-unison':
      return updateLayer(s, focus, { unison: (l.unison + 1) % 4 })
    case 'piano-dyn-comp':
      return updateLayer(s, focus, { dynComp: (l.dynComp + 1) % 4 })
    case 'piano-kb-touch':
      return updateLayer(s, focus, { kbTouch: KB_TOUCH[KB_INDEX[l.kbTouch] % 3] })
    case 'piano-type': {
      const i = PIANO_TYPES.indexOf(l.type)
      const type = PIANO_TYPES[(i + 1) % PIANO_TYPES.length]
      const next = updateLayer(s, focus, { type })
      // Keep the timbre valid for the new type family (Dyno is electric-only).
      const fam = currentModel(next.piano.layers[focus]).timbre
      return timbresFor(fam).includes(l.timbre) ? next : updateLayer(next, focus, { timbre: 'off' })
    }
    case 'piano-timbre': {
      const list = timbresFor(currentModel(l).timbre)
      const i = list.indexOf(l.timbre)
      return updateLayer(s, focus, { timbre: list[(i + 1) % list.length] })
    }
    case 'piano-octave-down':
    case 'piano-octave-up':
      return octaveButton(s, id, ctx.shift)
    case 'performance-rotary-speed':
      return { ...s, rotary: { ...s.rotary, fast: !s.rotary.fast } }
    case 'performance-rotary-organ':
      // Shift = Close Mic: excluded by the effects spec, ignored.
      return ctx.shift ? s : { ...s, rotary: { ...s.rotary, organ: !s.rotary.organ } }
    case 'performance-rotary-stop-mode':
      // Shift = stop Angle: excluded by the effects spec, ignored.
      return ctx.shift ? s : { ...s, rotary: { ...s.rotary, stopMode: !s.rotary.stopMode } }
    case 'effects-on':
      return { ...s, fx: { ...s.fx, on: !s.fx.on } }
    case 'effects-focus-organ':
      if (ctx.shift) return { ...s, fx: { ...s.fx, on: !s.fx.on } }
      return { ...s, fx: { ...s.fx, focus: 'organ' } }
    case 'effects-focus-piano': {
      if (ctx.shift) return setGroup(s, !s.fx.group)
      const f: ChainId = PIANO_CHAINS.includes(s.fx.focus) ? (s.fx.focus === 'A' ? 'B' : 'A') : s.piano.focus
      return { ...s, fx: { ...s.fx, focus: f } }
    }
    case 'effects-focus-synth': {
      if (ctx.shift) return setSynthGroup(s, !s.fx.synthGroup)
      const i = SYNTH_CHAINS.indexOf(s.fx.focus)
      const f: ChainId = i < 0 ? (`synth${s.synth.focus}` as ChainId) : SYNTH_CHAINS[(i + 1) % SYNTH_CHAINS.length]
      return { ...s, fx: { ...s.fx, focus: f } }
    }
    case 'effects-mod1-on':
      return editUnit(s, 'mod1', { on: !focusedUnit(s, 'mod1').on })
    case 'effects-mod1-type': {
      const i = MOD1_TYPES.indexOf(focusedUnit(s, 'mod1').type)
      return editUnit(s, 'mod1', { type: MOD1_TYPES[(i + 1) % MOD1_TYPES.length] })
    }
    case 'effects-mod2-on':
      return editUnit(s, 'mod2', { on: !focusedUnit(s, 'mod2').on })
    case 'effects-mod2-type': {
      const i = MOD2_TYPES.indexOf(focusedUnit(s, 'mod2').type)
      return editUnit(s, 'mod2', { type: MOD2_TYPES[(i + 1) % MOD2_TYPES.length] })
    }
    case 'effects-amp-on':
      return editUnit(s, 'amp', { on: !focusedUnit(s, 'amp').on })
    case 'effects-amp-type': {
      const i = AMP_TYPES.indexOf(focusedUnit(s, 'amp').type)
      return editUnit(s, 'amp', { type: AMP_TYPES[cycle(i, 0, AMP_TYPES.length - 1)] })
    }
    case 'effects-delay-filter': {
      const i = FILTERS.indexOf(focusedUnit(s, 'delay').filter)
      // Shift+Filter is Ping Pong (optional, not implemented): ignored rather than faked.
      return ctx.shift ? s : editUnit(s, 'delay', { filter: FILTERS[(i + 1) % FILTERS.length] })
    }
    case 'effects-delay-tap': {
      const seconds = tap.tap(ctx.nowMs)
      return seconds === null ? s : editUnit(s, 'delay', { tempo: tempoForSeconds(seconds) })
    }
    case 'effects-reverb-tone': {
      const i = TONES.indexOf(focusedUnit(s, 'reverb').tone)
      return editUnit(s, 'reverb', { tone: TONES[(i + 1) % TONES.length] })
    }
    case 'effects-reverb-type': {
      const i = REVERB_TYPES.indexOf(focusedUnit(s, 'reverb').type)
      return editUnit(s, 'reverb', { type: REVERB_TYPES[(i + 1) % REVERB_TYPES.length] })
    }
    case 'effects-delay-on':
    case 'effects-comp-on':
    case 'effects-reverb-on': {
      const unit = id.slice('effects-'.length, -'-on'.length) as GlobalUnit
      if (ctx.shift) return setGlobal(s, unit, !s.fx.global[unit])
      return editUnit(s, unit, { on: !focusedUnit(s, unit).on })
    }
  }
  return null
}

/** A continuous functional control moved to `value` → next sound state (null = not bound). */
export function setValue(s: SoundState, id: string, value: number, delta: number, ctx: BindingContext): SoundState | null {
  const focus = s.piano.focus
  switch (id) {
    case 'performance-master-level':
      return { ...s, master: value }
    case 'performance-rotary-drive':
      return { ...s, rotary: { ...s.rotary, drive: value } }
    case 'performance-pitch-stick':
      return { ...s, pitchStick: value }
    case 'piano-level-a':
      return updateLayer(s, 'A', { level: value })
    case 'piano-level-b':
      return updateLayer(s, 'B', { level: value })
    case 'piano-model':
      return stepModel(s, focus, delta === 0 ? 0 : Math.sign(delta))
    case 'effects-mod1-rate':
      if (ctx.shift) return delta === 0 ? s : editUnit(s, 'mod1', { sync: delta > 0 })
      return editUnit(s, 'mod1', { rate: value })
    case 'effects-mod1-amount':
      return editUnit(s, 'mod1', { amount: value })
    case 'effects-mod2-rate':
      return editUnit(s, 'mod2', { rate: value })
    case 'effects-mod2-amount':
      return editUnit(s, 'mod2', { amount: value })
    case 'effects-amp-drive':
      return editUnit(s, 'amp', { drive: value })
    case 'effects-eq-freq':
      return editUnit(s, 'amp', { freq: value })
    case 'effects-eq-bass':
      return editUnit(s, 'amp', { bass: value })
    case 'effects-eq-mid':
      return editUnit(s, 'amp', { mid: value })
    case 'effects-eq-treble':
      return editUnit(s, 'amp', { treble: value })
    case 'effects-delay-tempo':
      if (ctx.shift) return delta === 0 ? s : editUnit(s, 'delay', { sync: delta > 0 })
      return editUnit(s, 'delay', { tempo: value })
    case 'effects-delay-feedback':
      return editUnit(s, 'delay', { feedback: value })
    case 'effects-delay-dry-wet':
      return editUnit(s, 'delay', { dryWet: value })
    case 'effects-comp-amount':
      // Shift + Amount toggles FAST (turn up = on, down = off) and leaves the amount alone.
      if (ctx.shift) return delta === 0 ? s : editUnit(s, 'comp', { fast: delta > 0 })
      return editUnit(s, 'comp', { amount: value })
    case 'effects-reverb-dry-wet':
      return editUnit(s, 'reverb', { dryWet: value })
  }
  return null
}

/** Short lines for the Program OLED describing the focused piano layer. */
export function pianoDisplay(s: SoundState, failed: boolean): string[] {
  const l = s.piano.layers[s.piano.focus]
  const m = currentModel(l)
  const count = modelsOfType(l.type).length
  const oct = l.octave === 0 ? '' : ` · Oct ${l.octave > 0 ? '+' : ''}${l.octave}`
  return [`${m.name}${count > 1 ? ` (${l.models[l.type] + 1}/${count})` : ''}`, failed ? 'LOAD FAILED · fallback' : `${m.source.kind === 'recorded' ? 'Samples' : 'Synth'}${oct}`]
}

export { focusLayer }
