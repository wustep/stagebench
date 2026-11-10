import { delayKnobToSeconds } from '../audio/dsp/params'
import type { StageState } from './model'

/**
 * Morphs. A morph source (the modulation wheel or the control pedal) carries a list of
 * assignments; each names one parameter of the program by its path and the value that
 * parameter reaches when the source is fully up. The value stored in the program is where the
 * morph starts. Nothing here changes the program: `applyMorphs` returns a copy with every
 * assigned parameter moved to where the sources currently put it, and that copy is what sounds
 * and what the level and drawbar LED graphs show.
 */

export const MORPH_SOURCES = ['wheel', 'pedal'] as const
export type MorphSource = (typeof MORPH_SOURCES)[number]
export const MORPH_SOURCE_NAMES: Record<MorphSource, string> = { wheel: 'Wheel', pedal: 'Ctrl Pedal' }

export interface MorphAssignment {
  /** Path of the parameter inside the program, e.g. `synth.layers.0.filter.freq`. */
  path: string
  /** Value at the top of the source's travel, in the parameter's own panel unit. */
  to: number
}

interface Destination {
  pattern: RegExp
  min: number
  max: number
  label: (match: RegExpMatchArray) => string
}

const LETTER = ['A', 'B', 'C']
const CHAINS = ['Piano A', 'Piano B', 'Organ', 'Synth A', 'Synth B', 'Synth C']

/** Every parameter a morph can be assigned to (manual p. 39). */
const DESTINATIONS: readonly Destination[] = [
  { pattern: /^organ\.layers\.([01])\.level$/, min: 0, max: 100, label: (m) => `Organ ${LETTER[+m[1]]} Level` },
  { pattern: /^organ\.layers\.([01])\.drawbars\.([0-8])$/, min: 0, max: 8, label: (m) => `Organ ${LETTER[+m[1]]} Drawbar ${+m[2] + 1}` },
  { pattern: /^rotary\.speed$/, min: 0, max: 1, label: () => 'Rotary Speed' },
  { pattern: /^piano\.layers\.([01])\.level$/, min: 0, max: 100, label: (m) => `Piano ${LETTER[+m[1]]} Level` },
  { pattern: /^synth\.layers\.([0-2])\.level$/, min: 0, max: 100, label: (m) => `Synth ${LETTER[+m[1]]} Level` },
  { pattern: /^synth\.layers\.([0-2])\.lfo\.rate$/, min: 0, max: 10, label: (m) => `Synth ${LETTER[+m[1]]} LFO Rate` },
  { pattern: /^synth\.layers\.([0-2])\.lfo\.amount$/, min: 0, max: 10, label: (m) => `Synth ${LETTER[+m[1]]} LFO Amount` },
  { pattern: /^synth\.layers\.([0-2])\.ctrl$/, min: 0, max: 10, label: (m) => `Synth ${LETTER[+m[1]]} Osc Ctrl` },
  { pattern: /^synth\.layers\.([0-2])\.oscEnv\.amount$/, min: -10, max: 10, label: (m) => `Synth ${LETTER[+m[1]]} Osc Env Amt` },
  { pattern: /^synth\.layers\.([0-2])\.filter\.freq$/, min: 0, max: 10, label: (m) => `Synth ${LETTER[+m[1]]} Filter Freq` },
  { pattern: /^synth\.layers\.([0-2])\.filter\.res$/, min: 0, max: 10, label: (m) => `Synth ${LETTER[+m[1]]} Filter Res` },
  { pattern: /^synth\.layers\.([0-2])\.filter\.envAmt$/, min: 0, max: 10, label: (m) => `Synth ${LETTER[+m[1]]} Filter Env Amt` },
  { pattern: /^synth\.layers\.([0-2])\.arp\.rate$/, min: 0, max: 10, label: (m) => `Synth ${LETTER[+m[1]]} Arp Rate` },
  { pattern: /^synth\.layers\.([0-2])\.arp\.range$/, min: 0, max: 10, label: (m) => `Synth ${LETTER[+m[1]]} Arp Range` },
  { pattern: /^fx\.chains\.([0-5])\.mod1\.rate$/, min: 0, max: 10, label: (m) => `${CHAINS[+m[1]]} Mod 1 Rate` },
  { pattern: /^fx\.chains\.([0-5])\.mod1\.amount$/, min: 0, max: 10, label: (m) => `${CHAINS[+m[1]]} Mod 1 Amount` },
  { pattern: /^fx\.chains\.([0-5])\.mod2\.rate$/, min: 0, max: 10, label: (m) => `${CHAINS[+m[1]]} Mod 2 Rate` },
  { pattern: /^fx\.chains\.([0-5])\.mod2\.amount$/, min: 0, max: 10, label: (m) => `${CHAINS[+m[1]]} Mod 2 Amount` },
  { pattern: /^fx\.chains\.([0-5])\.delay\.tempo$/, min: 0, max: 10, label: (m) => `${CHAINS[+m[1]]} Delay Tempo` },
  { pattern: /^fx\.chains\.([0-5])\.delay\.feedback$/, min: 0, max: 10, label: (m) => `${CHAINS[+m[1]]} Delay Feedback` },
  { pattern: /^fx\.chains\.([0-5])\.delay\.mix$/, min: 0, max: 10, label: (m) => `${CHAINS[+m[1]]} Delay Dry/Wet` },
  { pattern: /^fx\.chains\.([0-5])\.amp\.drive$/, min: 0, max: 10, label: (m) => `${CHAINS[+m[1]]} Drive` },
  { pattern: /^fx\.chains\.([0-5])\.amp\.freq$/, min: 0, max: 10, label: (m) => `${CHAINS[+m[1]]} EQ Mid/Filter Freq` },
  { pattern: /^fx\.chains\.([0-5])\.reverb\.mix$/, min: 0, max: 10, label: (m) => `${CHAINS[+m[1]]} Reverb Dry/Wet` },
]

export interface MorphTarget {
  path: string
  min: number
  max: number
  label: string
}

/** The destination a path names, or null when the path is not something a morph may move. */
export function morphTarget(path: string): MorphTarget | null {
  for (const destination of DESTINATIONS) {
    const match = path.match(destination.pattern)
    if (match) return { path, min: destination.min, max: destination.max, label: destination.label(match) }
  }
  return null
}

type Program = Pick<StageState, 'organ' | 'piano' | 'synth' | 'fx' | 'rotary'>

/** The stored (start) value of a destination. */
export function morphBase(state: Program, path: string): number {
  if (path === 'rotary.speed') return state.rotary.fast ? 1 : 0
  let node: unknown = state
  for (const key of path.split('.')) {
    if (node === null || typeof node !== 'object') return 0
    node = (node as Record<string, unknown>)[key]
  }
  return typeof node === 'number' ? node : 0
}

function write(state: Program, path: string, value: number): void {
  if (path === 'rotary.speed') {
    state.rotary.speed = value
    return
  }
  const keys = path.split('.')
  let node = state as unknown as Record<string, unknown>
  for (let index = 0; index < keys.length - 1; index += 1) node = node[keys[index]] as Record<string, unknown>
  node[keys[keys.length - 1]] = value
}

/** Where a destination sits right now: its start value moved by every source assigned to it. */
export function morphedValue(state: StageState, path: string): number {
  const target = morphTarget(path)
  const base = morphBase(state, path)
  if (!target) return base
  let value = base
  for (const source of MORPH_SOURCES) {
    const position = state[source]
    for (const assignment of state.morph[source]) {
      if (assignment.path === path) value += (assignment.to - base) * position
    }
  }
  return Math.min(target.max, Math.max(target.min, value))
}

/** Sources that have an assignment on `path`. */
export function morphSourcesOf(state: Pick<StageState, 'morph'>, path: string): MorphSource[] {
  return MORPH_SOURCES.filter((source) => state.morph[source].some((assignment) => assignment.path === path))
}

/**
 * A copy of the state with every morph applied at the sources' current positions. When no
 * source has moved anything the state itself is returned, untouched.
 */
export function applyMorphs(state: StageState): StageState {
  const paths = new Set<string>()
  for (const source of MORPH_SOURCES) {
    if (state[source] === 0) continue
    for (const assignment of state.morph[source]) if (morphTarget(assignment.path)) paths.add(assignment.path)
  }
  if (paths.size === 0) return state
  const copy: StageState = {
    ...state,
    organ: structuredClone(state.organ),
    piano: structuredClone(state.piano),
    synth: structuredClone(state.synth),
    fx: structuredClone(state.fx),
    rotary: { ...state.rotary },
  }
  for (const path of paths) {
    write(copy, path, morphedValue(state, path))
    // A morphed Delay Tempo knob moves the delay time with it.
    const delay = path.match(/^fx\.chains\.([0-5])\.delay\.tempo$/)
    if (delay) {
      const chain = copy.fx.chains[Number(delay[1])]
      chain.delay.seconds = delayKnobToSeconds(chain.delay.tempo / 10)
    }
  }
  return copy
}
