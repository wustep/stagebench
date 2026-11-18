import { groupTargets, selectedTarget } from '../piano/settings'
import type { Chain, EffectTarget, Settings } from '../piano/settings'
import { clamp, morphSources } from './parameters'
import type { MorphSource } from './parameters'

type Path = readonly string[]
type Destination = { path: Path; min: number; max: number; rotary?: boolean }
type EffectParameter = { unit: keyof Chain; param: string }
const effects: Record<string, EffectParameter> = {
  'effects-mod-1-rate': { unit: 'mod1', param: 'rate' },
  'effects-mod-1-amount': { unit: 'mod1', param: 'amount' },
  'effects-mod-2-amount': { unit: 'mod2', param: 'amount' },
  'effects-delay-tempo': { unit: 'delay', param: 'bpm' },
  'effects-delay-feedback': { unit: 'delay', param: 'feedback' },
  'effects-delay-mix': { unit: 'delay', param: 'mix' },
  'effects-eq-frequency': { unit: 'amp', param: 'frequency' },
  'effects-amp-drive': { unit: 'amp', param: 'drive' },
  'effects-reverb-mix': { unit: 'reverb', param: 'mix' },
}
const synth: Record<string, Path> = {
  'synth-lfo-rate': ['lfo', 'rate'],
  'synth-osc-control': ['control'],
  'synth-lfo-amount': ['lfo', 'amount'],
  'synth-filter-frequency': ['filter', 'frequency'],
  'synth-filter-resonance': ['filter', 'resonance'],
  'synth-arp-rate': ['arp', 'rate'],
}

function fxPath(target: EffectTarget): Path {
  if (target === 'A' || target === 'B') return ['layers', target, 'chain']
  if (target === 'Organ') return ['organ', 'chain']
  return ['synth', 'layers', target.slice(-1), 'chain']
}

function numberAt(state: unknown, path: Path): number | undefined {
  let value = state
  for (const key of path) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return
    value = (value as Record<string, unknown>)[key]
  }
  return typeof value === 'number' ? value : undefined
}

function writePath<T>(state: T, path: Path, value: number): T {
  if (!path.length) return value as T
  const [key, ...rest] = path
  const original = state as Record<string, unknown>
  const child = writePath(original[key], rest, value)
  if (Array.isArray(state)) {
    const updated = [...state]
    updated[Number(key)] = child
    return updated as T
  }
  return { ...original, [key]: child } as T
}

function targets(state: Settings, id: string): Destination[] {
  if (id === 'rotary-speed') return [{ path: ['effects', 'rotary', 'fast'], min: 0, max: 1, rotary: true }]
  const layer = /^(piano|organ|synth)-layer-([abc])-level$/.exec(id)
  if (layer) {
    const [ , section, letter] = layer
    const base = section === 'piano' ? ['layers'] : [section, 'layers']
    return [{ path: [...base, letter.toUpperCase(), 'level'], min: 0, max: 12 }]
  }
  const drawbar = /^organ-drawbar-([1-9])$/.exec(id)
  if (drawbar) return [{ path: ['organ', 'layers', state.organ.focus, 'drawbars', String(Number(drawbar[1]) - 1)], min: 0, max: 8 }]
  const synthPath = synth[id]
  if (synthPath) return [{ path: ['synth', 'layers', state.synth.focus, ...synthPath], min: 0, max: 10 }]
  const effect = effects[id]
  if (!effect) return []
  const { unit } = effect
  const bases = (state.effects.global as Partial<Chain>)[unit] ? [['effects', 'global']] : groupTargets(state, selectedTarget(state)).map(fxPath)
  return bases.map((base) => {
    const delay = id === 'effects-delay-tempo'
    const delayState = base.reduce<unknown>((object, key) => (object as Record<string, unknown>)[key], state) as Chain
    const sync = delay && delayState.delay.sync
    return { path: [...base, unit, sync ? 'division' : effect.param], min: delay && !sync ? 30 : 0, max: delay && !sync ? 300 : 10 }
  })
}

const rotaryPath = 'effects.rotary.fast'
function resetBounds(path: string): [number, number] {
  if (path.endsWith('.bpm')) return [30, 300]
  if (path.endsWith('.level')) return [0, 12]
  if (path.includes('.drawbars.')) return [0, 8]
  return [0, 10]
}

export function assignMorph(state: Settings, source: MorphSource, id: string, moved: Settings): Settings | undefined {
  const destinations = targets(state, id)
  if (!destinations.length) return
  const assignments = { ...state.morph[source] }
  for (const { path, min, max, rotary } of destinations) {
    const key = path.join('.')
    const base = rotary ? Number(state.effects.rotary.fast) : numberAt(state, path)
    const end = rotary ? Number(moved.effects.rotary.fast) : numberAt(moved, path)
    if (base === undefined || end === undefined) continue
    if (base === end) delete assignments[key]
    else assignments[key] = clamp(end, min, max)
  }
  return { ...state, morph: { ...state.morph, [source]: assignments } }
}

export function isMorphed(state: Settings, id: string) {
  return targets(state, id).some(({ path }) => morphSources.some((source) => Object.hasOwn(state.morph[source], path.join('.'))))
}

export function morphEditState(state: Settings, source: MorphSource, id: string): Settings {
  let next = state
  for (const { path, rotary } of targets(state, id)) {
    const endpoint = state.morph[source][path.join('.')]
    if (endpoint === undefined) continue
    if (rotary) next = { ...next, effects: { ...next.effects, rotary: { ...next.effects.rotary, fast: endpoint === 1 } } }
    else next = writePath(next, path, endpoint)
  }
  return next
}

export function effectiveSettings(state: Settings): Settings {
  const { wheel, pedal } = state.performance
  if (wheel === 0 && pedal === 0) return state
  let effective = state
  for (const key of new Set([...Object.keys(state.morph.wheel), ...Object.keys(state.morph.pedal)])) {
    const path = key.split('.')
    const rotary = key === rotaryPath
    const base = rotary ? Number(state.effects.rotary.fast) : numberAt(state, path)
    if (base === undefined) continue
    const endWheel = state.morph.wheel[key] ?? base
    const endPedal = state.morph.pedal[key] ?? base
    const value = base + (endWheel - base) * wheel + (endPedal - base) * pedal
    if (rotary) {
      effective = { ...effective, effects: { ...effective.effects, rotary: { ...effective.effects.rotary, speed: clamp(value, 0, 1) } } }
    } else effective = writePath(effective, path, clamp(value, ...resetBounds(key)))
  }
  return effective
}

export function clearMorph(state: Settings, source: MorphSource, key?: string): Settings {
  const assignments = key ? { ...state.morph[source] } : {}
  if (key) delete assignments[key]
  return { ...state, morph: { ...state.morph, [source]: assignments } }
}
