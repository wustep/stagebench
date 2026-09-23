// Wheel and Control Pedal morphs (programs spec morph): each source holds destination → end
// offset assignments. The engine plays `applyMorphs(state, wheel, pedal)`: every assigned
// destination moves linearly from its stored value toward value + offset as the source travels
// 0…127, clamped to the destination's range. Offsets may be negative (a morph can raise one
// destination while lowering another). Destination keys name one parameter of one layer/chain.
import type { ChainId, LayerId, MorphSource, SoundState } from './sound'
import type { OrganLayerId } from './organState'
import type { SynthLayerId } from './synthState'

export interface MorphDest {
  key: string
  label: string
  min: number
  max: number
  get: (s: SoundState) => number
  set: (s: SoundState, v: number) => SoundState
}

const pianoLevel = (l: LayerId): MorphDest => ({
  key: `piano.${l}.level`,
  label: `Piano ${l} level`,
  min: 0,
  max: 127,
  get: (s) => s.piano.layers[l].level,
  set: (s, v) => ({ ...s, piano: { ...s.piano, layers: { ...s.piano.layers, [l]: { ...s.piano.layers[l], level: v } } } }),
})

const organLayer = (l: OrganLayerId, name: string, label: string, max: number, get: (x: SoundState['organ']['layers']['A']) => number, patch: (x: SoundState['organ']['layers']['A'], v: number) => Partial<SoundState['organ']['layers']['A']>): MorphDest => ({
  key: `organ.${l}.${name}`,
  label: `Organ ${l} ${label}`,
  min: 0,
  max,
  get: (s) => get(s.organ.layers[l]),
  set: (s, v) => ({ ...s, organ: { ...s.organ, layers: { ...s.organ.layers, [l]: { ...s.organ.layers[l], ...patch(s.organ.layers[l], v) } } } }),
})

type SynthL = SoundState['synth']['layers']['A']
const synthLayer = (l: SynthLayerId, name: string, label: string, get: (x: SynthL) => number, patch: (x: SynthL, v: number) => Partial<SynthL>): MorphDest => ({
  key: `synth.${l}.${name}`,
  label: `Synth ${l} ${label}`,
  min: 0,
  max: 127,
  get: (s) => get(s.synth.layers[l]),
  set: (s, v) => ({ ...s, synth: { ...s.synth, layers: { ...s.synth.layers, [l]: { ...s.synth.layers[l], ...patch(s.synth.layers[l], v) } } } }),
})

type Chain = SoundState['fx']['chains']['A']
const fxParam = <U extends keyof Chain>(c: ChainId, unit: U, param: keyof Chain[U] & string, label: string): MorphDest => ({
  key: `fx.${c}.${unit}.${param}`,
  label: `${label} (${c})`,
  min: 0,
  max: 127,
  get: (s) => s.fx.chains[c][unit][param] as unknown as number,
  set: (s, v) => ({ ...s, fx: { ...s.fx, chains: { ...s.fx.chains, [c]: { ...s.fx.chains[c], [unit]: { ...s.fx.chains[c][unit], [param]: v } } } } }),
})

/** Every morphable destination (programs spec morph.destinations), keyed by destination key. */
export const MORPH_DESTS: ReadonlyMap<string, MorphDest> = (() => {
  const list: MorphDest[] = []
  for (const l of ['A', 'B'] as const) {
    list.push(organLayer(l, 'level', 'level', 127, (x) => x.level, (_x, v) => ({ level: v })))
    for (let i = 0; i < 9; i++) {
      list.push(organLayer(l, `drawbar${i + 1}`, `drawbar ${i + 1}`, 8, (x) => x.drawbars[i], (x, v) => ({ drawbars: x.drawbars.map((d, j) => (j === i ? v : d)) })))
    }
    list.push(pianoLevel(l))
  }
  list.push({
    key: 'rotary.speed',
    label: 'Rotary speed',
    min: 0,
    max: 1,
    get: (s) => (s.rotary.fast ? 1 : 0),
    set: (s, v) => ({ ...s, rotary: { ...s.rotary, fast: v >= 0.5 } }),
  })
  for (const l of ['A', 'B', 'C'] as const) {
    list.push(synthLayer(l, 'level', 'level', (x) => x.level, (_x, v) => ({ level: v })))
    list.push(synthLayer(l, 'lfoRate', 'LFO rate', (x) => x.lfo.rate, (x, v) => ({ lfo: { ...x.lfo, rate: v } })))
    list.push(synthLayer(l, 'lfoAmount', 'LFO amount', (x) => x.lfo.amount, (x, v) => ({ lfo: { ...x.lfo, amount: v } })))
    list.push(synthLayer(l, 'oscCtrl', 'Osc Ctrl', (x) => x.oscCtrl, (_x, v) => ({ oscCtrl: v })))
    list.push(synthLayer(l, 'filterFreq', 'filter freq', (x) => x.filter.freq, (x, v) => ({ filter: { ...x.filter, freq: v } })))
    list.push(synthLayer(l, 'filterRes', 'filter resonance', (x) => x.filter.res, (x, v) => ({ filter: { ...x.filter, res: v } })))
    list.push(synthLayer(l, 'arpRate', 'arp/gate rate', (x) => x.arp.rate, (x, v) => ({ arp: { ...x.arp, rate: v } })))
  }
  for (const c of ['organ', 'A', 'B', 'synthA', 'synthB', 'synthC'] as const) {
    list.push(fxParam(c, 'mod1', 'rate', 'Mod 1 rate'))
    list.push(fxParam(c, 'mod1', 'amount', 'Mod 1 amount'))
    list.push(fxParam(c, 'mod2', 'amount', 'Mod 2 amount'))
    list.push(fxParam(c, 'delay', 'tempo', 'Delay tempo'))
    list.push(fxParam(c, 'delay', 'feedback', 'Delay feedback'))
    list.push(fxParam(c, 'delay', 'dryWet', 'Delay dry/wet'))
    list.push(fxParam(c, 'amp', 'freq', 'EQ mid/filter freq'))
    list.push(fxParam(c, 'amp', 'drive', 'Drive amount'))
    list.push(fxParam(c, 'reverb', 'dryWet', 'Reverb dry/wet'))
  }
  return new Map(list.map((d) => [d.key, d]))
})()

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** The value a destination takes with its offset at source position `pos` (0…127). */
export function morphedValue(base: number, offset: number, pos: number, dest: MorphDest): number {
  const v = base + (offset * clamp(pos, 0, 127)) / 127
  return dest.max <= 8 && dest.key !== 'rotary.speed' ? clamp(Math.round(v), dest.min, dest.max) : clamp(v, dest.min, dest.max)
}

/** The sound the engine plays: every assignment of both sources applied at their positions. */
export function applyMorphs(s: SoundState, wheel: number, pedal: number): SoundState {
  const wheelKeys = Object.keys(s.morph.wheel)
  const pedalKeys = Object.keys(s.morph.pedal)
  // Sources at rest leave the stored sound untouched (same object: nothing to re-apply).
  if ((wheel <= 0 || !wheelKeys.length) && (pedal <= 0 || !pedalKeys.length)) return s
  let out = s
  const keys = new Set([...wheelKeys, ...pedalKeys])
  for (const key of keys) {
    const dest = MORPH_DESTS.get(key)
    if (!dest) continue
    const base = dest.get(s)
    const offset = (s.morph.wheel[key] ?? 0) * (wheel / 127) + (s.morph.pedal[key] ?? 0) * (pedal / 127)
    out = dest.set(out, morphedValue(base, offset, 127, dest))
  }
  return out
}

/** Assign (or re-assign) a source's end value for a destination; returning to the start removes it. */
export function assignMorph(s: SoundState, source: MorphSource, key: string, endValue: number): SoundState {
  const dest = MORPH_DESTS.get(key)
  if (!dest) return s
  const offset = clamp(endValue, dest.min, dest.max) - dest.get(s)
  const map = { ...s.morph[source] }
  if (Math.abs(offset) < 1e-9) delete map[key]
  else map[key] = offset
  return { ...s, morph: { ...s.morph, [source]: map } }
}

/** Shift + source button: clear every assignment of that source. */
export function clearMorph(s: SoundState, source: MorphSource): SoundState {
  return { ...s, morph: { ...s.morph, [source]: {} } }
}

/** The end value of a destination for a source (its base when unassigned). */
export function morphEnd(s: SoundState, source: MorphSource, key: string): number | null {
  const dest = MORPH_DESTS.get(key)
  if (!dest) return null
  return clamp(dest.get(s) + (s.morph[source][key] ?? 0), dest.min, dest.max)
}

export function isMorphed(s: SoundState, key: string): boolean {
  return key in s.morph.wheel || key in s.morph.pedal
}
