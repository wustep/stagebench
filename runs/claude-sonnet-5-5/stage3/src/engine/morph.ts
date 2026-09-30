/**
 * Morph assignments (programs spec `morph`). A morph source (Wheel or Control Pedal) moves every assigned destination
 * from the value stored in the program (the start) to the assigned end value as the source goes 0 → 1.
 *
 * The canonical state keeps the *stored* values; `resolveMorph` derives the *effective* state the audio follows, so the
 * program always round-trips exactly what the player edited.
 */
import type { ChainId, EngineState, LayerFx } from './state'

export type MorphSource = 'wheel' | 'pedal'
export const MORPH_SOURCES: readonly MorphSource[] = ['wheel', 'pedal']
export const MORPH_SOURCE_LABEL: Record<MorphSource, string> = { wheel: 'Wheel', pedal: 'Control Pedal' }

export interface MorphAssign {
  /** destination id, see `morphDest` */
  dest: string
  /** end value, in the destination's own domain */
  to: number
}
export type MorphState = Record<MorphSource, MorphAssign[]>
export const emptyMorph = (): MorphState => ({ wheel: [], pedal: [] })

export interface MorphDest {
  id: string
  label: string
  min: number
  max: number
  get(s: EngineState): number
  set(s: EngineState, v: number): EngineState
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

const SYNTH_IDS = ['A', 'B', 'C'] as const
const ORGAN_IDS = ['A', 'B'] as const
const CHAINS: readonly ChainId[] = ['A', 'B', 'organ', 'sA', 'sB', 'sC']

/** read / write one effect chain by id without importing runtime code from state.ts (avoids an import cycle) */
export const chainFx = (s: EngineState, id: ChainId): LayerFx => (id === 'A' || id === 'B' ? s.fx[id] : id === 'organ' ? s.organFx : s.synthFx[id === 'sA' ? 'A' : id === 'sB' ? 'B' : 'C'])
export const withChainFx = (s: EngineState, id: ChainId, fx: LayerFx): EngineState => {
  if (id === 'A' || id === 'B') return { ...s, fx: { ...s.fx, [id]: fx } }
  if (id === 'organ') return { ...s, organFx: fx }
  const key = id === 'sA' ? 'A' : id === 'sB' ? 'B' : 'C'
  return { ...s, synthFx: { ...s.synthFx, [key]: fx } }
}

type FxParam = 'mod1Rate' | 'mod1Amount' | 'mod2Amount' | 'delayTempo' | 'delayFeedback' | 'delayDryWet' | 'ampFreq' | 'ampDrive' | 'reverbDryWet'
const FX_PARAMS: Record<FxParam, { label: string; get: (f: LayerFx) => number; set: (f: LayerFx, v: number) => LayerFx }> = {
  mod1Rate: { label: 'Mod 1 Rate', get: (f) => f.mod1.rate, set: (f, v) => ({ ...f, mod1: { ...f.mod1, rate: v } }) },
  mod1Amount: { label: 'Mod 1 Amount', get: (f) => f.mod1.amount, set: (f, v) => ({ ...f, mod1: { ...f.mod1, amount: v } }) },
  mod2Amount: { label: 'Mod 2 Amount', get: (f) => f.mod2.amount, set: (f, v) => ({ ...f, mod2: { ...f.mod2, amount: v } }) },
  delayTempo: { label: 'Delay Tempo', get: (f) => f.delay.tempo, set: (f, v) => ({ ...f, delay: { ...f.delay, tempo: v } }) },
  delayFeedback: { label: 'Delay Feedback', get: (f) => f.delay.feedback, set: (f, v) => ({ ...f, delay: { ...f.delay, feedback: v } }) },
  delayDryWet: { label: 'Delay Dry/Wet', get: (f) => f.delay.dryWet, set: (f, v) => ({ ...f, delay: { ...f.delay, dryWet: v } }) },
  ampFreq: { label: 'EQ Mid/Filter Freq', get: (f) => f.amp.freq, set: (f, v) => ({ ...f, amp: { ...f.amp, freq: v } }) },
  ampDrive: { label: 'Drive Amount', get: (f) => f.amp.drive, set: (f, v) => ({ ...f, amp: { ...f.amp, drive: v } }) },
  reverbDryWet: { label: 'Reverb Dry/Wet', get: (f) => f.reverb.dryWet, set: (f, v) => ({ ...f, reverb: { ...f.reverb, dryWet: v } }) },
}

type SynthParam = 'lfoRate' | 'oscCtrl' | 'lfoAmount' | 'filterFreq' | 'filterRes' | 'arpRate'
const SYNTH_PARAMS: Record<SynthParam, { label: string; get: (p: EngineState['synth']['A']['patch']) => number; set: (p: EngineState['synth']['A']['patch'], v: number) => EngineState['synth']['A']['patch'] }> = {
  lfoRate: { label: 'LFO Rate', get: (p) => p.lfo.rate, set: (p, v) => ({ ...p, lfo: { ...p.lfo, rate: v } }) },
  oscCtrl: { label: 'Osc Ctrl', get: (p) => p.oscCtrl, set: (p, v) => ({ ...p, oscCtrl: v }) },
  lfoAmount: { label: 'LFO Amount', get: (p) => p.lfo.amount, set: (p, v) => ({ ...p, lfo: { ...p.lfo, amount: v } }) },
  filterFreq: { label: 'Filter Freq', get: (p) => p.filter.freq, set: (p, v) => ({ ...p, filter: { ...p.filter, freq: v } }) },
  filterRes: { label: 'Filter Resonance', get: (p) => p.filter.res, set: (p, v) => ({ ...p, filter: { ...p.filter, res: v } }) },
  arpRate: { label: 'Arp/Gate Rate', get: (p) => p.arp.rate, set: (p, v) => ({ ...p, arp: { ...p.arp, rate: v } }) },
}

/** All destinations the programs spec lists, keyed by a stable id. Returns null for an unknown id. */
export function morphDest(id: string): MorphDest | null {
  const [kind, name, layer, extra] = id.split('.')
  if (kind === 'level' && (name === 'piano' || name === 'organ') && (layer === 'A' || layer === 'B')) {
    const L = layer
    return name === 'piano'
      ? { id, label: `Piano ${L} level`, min: 0, max: 1, get: (s) => s.layers[L].level, set: (s, v) => ({ ...s, layers: { ...s.layers, [L]: { ...s.layers[L], level: clamp(v, 0, 1) } } }) }
      : {
          id,
          label: `Organ ${L} level`,
          min: 0,
          max: 1,
          get: (s) => s.organ.layers[L].level,
          set: (s, v) => ({ ...s, organ: { ...s.organ, layers: { ...s.organ.layers, [L]: { ...s.organ.layers[L], level: clamp(v, 0, 1) } } } }),
        }
  }
  if (kind === 'level' && name === 'synth' && (SYNTH_IDS as readonly string[]).includes(layer)) {
    const L = layer as (typeof SYNTH_IDS)[number]
    return { id, label: `Synth ${L} level`, min: 0, max: 1, get: (s) => s.synth[L].level, set: (s, v) => ({ ...s, synth: { ...s.synth, [L]: { ...s.synth[L], level: clamp(v, 0, 1) } } }) }
  }
  if (kind === 'drawbar' && name === 'organ' && (ORGAN_IDS as readonly string[]).includes(layer)) {
    const L = layer as 'A' | 'B'
    const i = Number(extra)
    if (!Number.isInteger(i) || i < 0 || i > 8) return null
    return {
      id,
      label: `Organ ${L} drawbar ${i + 1}`,
      min: 0,
      max: 8,
      get: (s) => s.organ.layers[L].drawbars[i],
      set: (s, v) => {
        const drawbars = [...s.organ.layers[L].drawbars]
        drawbars[i] = clamp(v, 0, 8)
        return { ...s, organ: { ...s.organ, layers: { ...s.organ.layers, [L]: { ...s.organ.layers[L], drawbars } } } }
      },
    }
  }
  if (kind === 'rotary' && name === 'speed') {
    // 0 = slow (or stopped in stop mode), 1 = fast; `speed` is the effective speed the rotary follows
    return { id, label: 'Rotary speed', min: 0, max: 1, get: (s) => s.rotary.speed ?? (s.rotary.fast ? 1 : 0), set: (s, v) => ({ ...s, rotary: { ...s.rotary, speed: clamp(v, 0, 1) } }) }
  }
  if (kind === 'synth' && name in SYNTH_PARAMS && (SYNTH_IDS as readonly string[]).includes(layer)) {
    const L = layer as (typeof SYNTH_IDS)[number]
    const p = SYNTH_PARAMS[name as SynthParam]
    return {
      id,
      label: `Synth ${L} ${p.label}`,
      min: 0,
      max: 1,
      get: (s) => p.get(s.synth[L].patch),
      set: (s, v) => ({ ...s, synth: { ...s.synth, [L]: { ...s.synth[L], patch: p.set(s.synth[L].patch, clamp(v, 0, 1)) } } }),
    }
  }
  if (kind === 'fx' && name in FX_PARAMS && (CHAINS as readonly string[]).includes(layer)) {
    const chain = layer as ChainId
    const p = FX_PARAMS[name as FxParam]
    return { id, label: `${chain} ${p.label}`, min: 0, max: 1, get: (s) => p.get(chainFx(s, chain)), set: (s, v) => withChainFx(s, chain, p.set(chainFx(s, chain), clamp(v, 0, 1))) }
  }
  return null
}

export const morphDestId = {
  level: (section: 'piano' | 'organ' | 'synth', layer: string) => `level.${section}.${layer}`,
  drawbar: (layer: 'A' | 'B', index: number) => `drawbar.organ.${layer}.${index}`,
  rotarySpeed: () => 'rotary.speed',
  synth: (param: SynthParam, layer: string) => `synth.${param}.${layer}`,
  fx: (param: FxParam, chain: ChainId) => `fx.${param}.${chain}`,
}

export const isMorphed = (m: MorphState, dest: string): MorphSource[] => MORPH_SOURCES.filter((src) => m[src].some((a) => a.dest === dest))
export const morphCount = (m: MorphState, source: MorphSource): number => m[source].length

/** the assignment's end value for `dest` under `source`, if any */
export const assignmentFor = (m: MorphState, source: MorphSource, dest: string): MorphAssign | undefined => m[source].find((a) => a.dest === dest)

/**
 * Assign / edit while a source is in assign mode: `start` is the stored value of the destination, `end` where the player
 * moved it. Moving it back to the start removes just that assignment.
 */
export function assignMorph(m: MorphState, source: MorphSource, dest: string, start: number, end: number): MorphState {
  const info = morphDest(dest)
  if (!info) return m
  const list = m[source].filter((a) => a.dest !== dest)
  const span = info.max - info.min
  const same = Math.abs(end - start) <= span * 0.004
  if (!same) list.push({ dest, to: clamp(end, info.min, info.max) })
  return { ...m, [source]: list }
}

export const clearMorph = (m: MorphState, source: MorphSource): MorphState => (m[source].length === 0 ? m : { ...m, [source]: [] })

/** Effective state: every assigned destination moved by its source's position. Identity when nothing is assigned. */
export function resolveMorph(s: EngineState): EngineState {
  const positions: Record<MorphSource, number> = { wheel: s.modWheel, pedal: s.pedalPos }
  if (s.morph.wheel.length === 0 && s.morph.pedal.length === 0) return s
  // several sources on one destination add their offsets to the stored value
  const offsets = new Map<string, number>()
  for (const src of MORPH_SOURCES) {
    for (const a of s.morph[src]) {
      const info = morphDest(a.dest)
      if (!info) continue
      const base = info.get(s)
      offsets.set(a.dest, (offsets.get(a.dest) ?? 0) + (a.to - base) * positions[src])
    }
  }
  let out = s
  for (const [dest, delta] of offsets) {
    const info = morphDest(dest)!
    if (delta !== 0) out = info.set(out, clamp(info.get(s) + delta, info.min, info.max))
  }
  return out
}

/** stored-value range → LED graph range on faders / drawbars: [from, to] in the destination's domain */
export function morphRange(m: MorphState, dest: string, s: EngineState): { from: number; to: number } | null {
  const info = morphDest(dest)
  if (!info) return null
  const assigned = MORPH_SOURCES.map((src) => assignmentFor(m, src, dest)).filter((a): a is MorphAssign => !!a)
  if (assigned.length === 0) return null
  const base = info.get(s)
  const ends = assigned.map((a) => a.to)
  return { from: base, to: clamp(base + ends.reduce((acc, e) => acc + (e - base), 0), info.min, info.max) }
}
