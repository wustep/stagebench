import type { Chain, Layer, Step } from '../piano/settings'

export const organModels = ['B3', 'B3 Bass', 'Vox', 'Farf', 'Pipe 1', 'Pipe 2'] as const
export const organChorus = ['C1', 'C2', 'C3', 'V1', 'V2', 'V3'] as const
export const waves = {
  Pure: ['Sine', 'Triangle', 'Saw', 'Square', 'Pulse 33', 'Pulse 10', 'White Noise'],
  Sync: ['Sync Saw', 'Sync Square'],
  Multi: ['Multi Saw', 'Multi Saw 8ve'],
  Super: ['Super Saw', 'Super Square'],
  'FM-H': ['FM 2-op (algorithm A)'],
} as const
export type Category = keyof typeof waves
export const categories = Object.keys(waves) as Category[]
export const filterTypes = ['LP12', 'LP24', 'HP', 'BP'] as const
export const lfoWaves = ['Triangle', 'Saw down', 'Saw up', 'Square', 'Sample & Hold'] as const
export const lfoTargets = ['Off', 'Osc Pitch', 'Osc Ctrl', 'Filter Freq'] as const
export const voiceModes = ['Poly', 'Mono', 'Legato'] as const
export const priorities = ['Off', 'Low', 'High'] as const
export const arpModes = ['Arp', 'Poly', 'Gate'] as const
export const directions = ['Up', 'Down', 'Up/Down', 'Random'] as const
export const synthLayers = ['A', 'B', 'C'] as const
export type SynthId = typeof synthLayers[number]
export type ZoneRange = readonly [first: number, last: number]
export const allZones: ZoneRange = [0, 3]
export const splitNotes = [36, 41, 48, 53, 60, 65, 72, 77, 84, 89, 96] as const
export const splitLabels = ['C2', 'F2', 'C3', 'F3', 'C4', 'F4', 'C5', 'F5', 'C6', 'F6', 'C7'] as const
export const splitIds = ['Low', 'Mid', 'High'] as const
export type SplitId = typeof splitIds[number]
export interface SplitPoint { note: number | null; fade: 0 | 6 | 12 }
export type Splits = Record<SplitId, SplitPoint>
export type MorphSource = 'wheel' | 'pedal'
export const morphSources = ['wheel', 'pedal'] as const
export type MorphAssignments = Record<MorphSource, Record<string, number>>
export type LayerKey = `piano${Layer}` | `organ${Layer}` | `synth${SynthId}`
export const layerKeys = ['pianoA', 'pianoB', 'organA', 'organB', 'synthA', 'synthB', 'synthC'] as const

export interface LayerParameters {
  on: boolean
  level: number
  octave: number
  sustain: boolean
  pitch: boolean
  zone: ZoneRange
}

export interface OrganLayer extends LayerParameters {
  model: typeof organModels[number]
  drawbars: number[]
  chorus: typeof organChorus[number]
  vibrato: boolean
  percussion: { on: boolean; soft: boolean; fast: boolean; third: boolean }
}

export interface Envelope {
  attack: number
  decay: number
  release: number
}

export interface SynthLayer extends LayerParameters {
  chain: Chain
  category: Category
  wave: number
  control: number
  coarse: number
  fine: number
  osc: Envelope & { amount: number; velocity: boolean; toPitch: boolean }
  filter: Envelope & {
    on: boolean; type: typeof filterTypes[number]; tracking: Step; drive: Step
    frequency: number; resonance: number; amount: number; velocity: boolean
  }
  amp: Envelope & { velocity: Step }
  lfo: { wave: typeof lfoWaves[number]; target: typeof lfoTargets[number]; rate: number; amount: number; sync: boolean }
  voice: { mode: typeof voiceModes[number]; priority: typeof priorities[number]; glide: number; unison: Step }
  vibrato: { mode: 'Off' | 'On' | 'Wheel'; rate: number; amount: number }
  arp: {
    run: boolean; mode: typeof arpModes[number]; rate: number; range: number
    direction: typeof directions[number]; sync: boolean; hold: boolean
  }
}

export type Values<T, K extends string> = Record<K, T>
export type Section<T, K extends string> = { on: boolean; focus: K; layers: Values<T, K> }

export function makeOrgan(layer: Layer): OrganLayer {
  return {
    on: layer === 'A', level: layer === 'A' ? 9 : 7, sustain: false, pitch: false, octave: 0, zone: allZones,
    model: 'B3', drawbars: [8, 5, 8, 4, 3, 5, 8, 5, 5], chorus: 'C1', vibrato: true,
    percussion: { on: false, soft: false, fast: false, third: false },
  }
}

export function makeSynth(layer: SynthId, chain: Chain): SynthLayer {
  return {
    on: layer === 'A', level: { A: 12, B: 3, C: 9 }[layer], sustain: true, pitch: false, octave: 0, zone: allZones,
    chain, category: 'Super', wave: 0, control: 4, coarse: 0, fine: 0,
    osc: { attack: 0, decay: 4, release: 3, amount: 5, velocity: false, toPitch: false },
    filter: { on: true, type: 'LP24', tracking: 0, drive: 0, frequency: 6, resonance: 3, amount: 5,
      attack: 1, decay: 5, release: 4, velocity: false },
    amp: { attack: 1, decay: 10, release: 3, velocity: 2 },
    lfo: { wave: 'Triangle', target: 'Off', rate: 4, amount: 7, sync: false },
    voice: { mode: 'Poly', priority: 'Off', glide: 0, unison: 0 },
    vibrato: { mode: 'Off', rate: 5, amount: 3 },
    arp: { run: false, mode: 'Arp', rate: 6, range: 0, direction: 'Up', sync: false, hold: false },
  }
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function envelopeTime(step: number) {
  return 0.003 * 2 ** (step * 1.02)
}

export const clockDivisions = [
  [1 / 6, '1/16 T'], [1 / 4, '1/16'], [1 / 3, '1/8 T'], [3 / 8, 'Dotted 1/16'],
  [1 / 2, '1/8'], [2 / 3, '1/4 T'], [3 / 4, 'Dotted 1/8'], [1, '1/4'],
  [4 / 3, '1/2 T'], [1.5, 'Dotted 1/4'], [2, '1/2'],
] as const

export function divisionBeats(divisions: readonly (readonly [number, string])[], position: number) {
  const step = clamp(position, 0, divisions.length - 1)
  const low = Math.floor(step)
  const high = Math.ceil(step)
  return divisions[low][0] * (divisions[high][0] / divisions[low][0]) ** (step - low)
}

export function synthPeriod(rate: number, sync: boolean, bpm: number, arp = false) {
  return sync ? 60 * divisionBeats(clockDivisions, rate) / bpm
    : arp ? 60 / (30 + rate * 27) : 1 / (0.08 * 2 ** rate)
}

export function splitPoints(splits: Splits) {
  return Object.values(splits).filter((point): point is SplitPoint & { note: number } => point.note !== null)
    .sort((a, b) => a.note - b.note)
}

/** The two outer boundaries of a contiguous assignment are its only fade edges. */
export function zoneGain(points: ReturnType<typeof splitPoints>, zone: ZoneRange, note: number) {
  if (!points.length) return 1
  const [first, end] = zone
  if (first > points.length) return 0
  const boundaries = [1]
  for (const point of points) {
    const rise = point.fade ? clamp((note - point.note + point.fade) / (2 * point.fade), 0, 1)
      : Number(note >= point.note)
    boundaries.push(Math.min(boundaries.at(-1)!, rise))
  }
  return boundaries[first] - (boundaries[end + 1] ?? 0)
}
