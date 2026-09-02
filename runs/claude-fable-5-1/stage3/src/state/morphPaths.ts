/**
 * Which program value a panel control edits right now (it depends on the focused layer / chain), used both to capture
 * morph assignments (programs spec `morph.destinations`, manual p. 38) and to light the green morph LEDs.
 */
import { focusedChainKey, SYNTH_CHAIN_KEYS, PIANO_CHAIN_KEYS } from './instrumentState'
import { applyMorphs, getPath, programOf, type MorphAssignment, type MorphSource, type ProgramState } from './programState'

const DRAWBAR_IDS = ['organ.drawbar.16', 'organ.drawbar.5-1-3', 'organ.drawbar.8', 'organ.drawbar.4', 'organ.drawbar.2-2-3', 'organ.drawbar.2', 'organ.drawbar.1-3-5', 'organ.drawbar.1-1-3', 'organ.drawbar.1']
export const DRAWBAR_CONTROL_IDS: readonly string[] = DRAWBAR_IDS

const SYNTH_KNOBS: Record<string, string> = {
  'synth.lfo.rate': 'lfo.rate',
  'synth.osc.ctrl': 'oscCtrl',
  'synth.lfo.mod-amount': 'lfo.amount',
  'synth.filter.freq': 'filter.freq',
  'synth.filter.resonance': 'filter.res',
  'synth.arp.rate': 'arp.rate',
}
const EFFECT_KNOBS: Record<string, string> = {
  'effects.mod1.rate': 'mod1.rate',
  'effects.mod1.amount': 'mod1.amount',
  'effects.mod2.amount': 'mod2.amount',
  'effects.delay.tempo': 'delay.tempo',
  'effects.delay.feedback': 'delay.feedback',
  'effects.delay.dry-wet': 'delay.dryWet',
  'effects.amp.freq': 'amp.midFreq',
  'effects.amp.drive': 'amp.drive',
  'effects.reverb.dry-wet': 'reverb.dryWet',
}

/** The program path a morphable control edits under the current focus, or null when the control is not morphable. */
export function morphPathFor(id: string, p: ProgramState): string | null {
  switch (id) {
    case 'piano.layer-a.level':
      return 'piano.layers.A.level'
    case 'piano.layer-b.level':
      return 'piano.layers.B.level'
    case 'organ.layer-a.level':
      return 'organ.layers.A.level'
    case 'organ.layer-b.level':
      return 'organ.layers.B.level'
    case 'synth.layer-a.level':
      return 'synth.layers.A.level'
    case 'synth.layer-b.level':
      return 'synth.layers.B.level'
    case 'synth.layer-c.level':
      return 'synth.layers.C.level'
    case 'performance.rotary.speed':
      return 'rotary.speed'
    default:
      break
  }
  const drawbar = DRAWBAR_IDS.indexOf(id)
  if (drawbar >= 0) return `organ.layers.${p.organ.focus}.drawbars.${drawbar}`
  if (id in SYNTH_KNOBS) return `synth.layers.${p.synth.focus}.${SYNTH_KNOBS[id]}`
  if (id in EFFECT_KNOBS) return `effects.chains.${focusedChainKey(p)}.${EFFECT_KNOBS[id]}`
  return null
}

/** Human label of a morph destination path (display hints). */
export function morphPathLabel(path: string): string {
  const parts = path.split('.')
  if (parts[0] === 'rotary') return 'Rotary speed'
  if (parts[0] === 'effects') return `${parts[2]} ${parts[3]} ${parts[4]}`
  const section = parts[0][0].toUpperCase() + parts[0].slice(1)
  const rest = parts.slice(3).join(' ')
  return `${section} ${parts[2]} ${rest === 'drawbars 0' ? "16'" : rest}`.replace(/drawbars (\d)/, (_m, i) => `drawbar ${Number(i) + 1}`)
}

/** Assignments (per source) that target the value a control currently edits. */
export function morphAssignmentsFor(id: string, p: ProgramState): Partial<Record<MorphSource, MorphAssignment>> {
  const path = morphPathFor(id, p)
  if (!path) return {}
  const out: Partial<Record<MorphSource, MorphAssignment>> = {}
  const wheel = p.morph.wheel.find((a) => a.path === path)
  const pedal = p.morph.pedal.find((a) => a.path === path)
  if (wheel) out.wheel = wheel
  if (pedal) out.pedal = pedal
  return out
}

/** The value a control's destination has under the current morph sources (LED ladders show this, manual p. 39). */
export function morphedValueFor(id: string, state: ProgramState & { morphSources: Record<MorphSource, number> }): number | null {
  const path = morphPathFor(id, state)
  if (!path) return null
  const assigned = state.morph.wheel.some((a) => a.path === path) || state.morph.pedal.some((a) => a.path === path)
  if (!assigned) return null
  const value = getPath(applyMorphs(programOf(state), state.morphSources), path)
  return typeof value === 'number' ? value : null
}

/** Which chain / layer the effects and synth knobs edit (for the morph LED context and hints). */
export function focusedTargets(p: ProgramState) {
  return { chain: focusedChainKey(p), pianoChain: PIANO_CHAIN_KEYS[p.piano.focus], synthChain: SYNTH_CHAIN_KEYS[p.synth.focus] }
}
