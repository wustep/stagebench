export const pianoTypes = ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'] as const
export type PianoType = typeof pianoTypes[number]
export type RecordedType = 'Grand' | 'Upright' | 'Electric'
export const models: Record<PianoType, string> = {
  Grand: 'Salamander C5', Upright: 'Upright Piano KW', Electric: 'Rhodes Mark I',
  Clav: 'Clavinet', Digital: 'FM Stage Piano', Misc: 'Rosewood Marimba',
}
export function isRecorded(type: PianoType): type is RecordedType {
  return type === 'Grand' || type === 'Upright' || type === 'Electric'
}

export const pitchSteps = 100
export const layers = ['A', 'B'] as const
export type Layer = typeof layers[number]
export const touchNames = ['Heavy', 'Medium', 'Light'] as const
export const timbres = ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'] as const
export const modulation1 = ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump'] as const
export const modulation2 = ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin'] as const
export const ampTypes = ['EQ only', 'Twin', 'JC', 'Small', 'LP24 Filter', 'HP24 Filter', 'To Rotary'] as const
export const delayFilters = ['Off', 'LP', 'HP', 'BP'] as const
export const delayDivisions = [
  [1 / 6, '1/16 triplet'], [1 / 4, '1/16'], [1 / 3, '1/8 triplet'], [1 / 2, '1/8'],
  [2 / 3, '1/4 triplet'], [3 / 4, 'Dotted 1/8'], [1, '1/4'],
  [1.5, 'Dotted 1/4'], [2, '1/2'], [3, 'Dotted 1/2'], [4, 'Whole note'],
] as const
export const reverbTypes = ['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral'] as const
export const reverbTones = ['Neutral', 'Bright', 'Dark'] as const
export const globalUnits = ['delay', 'compressor', 'reverb'] as const
export type GlobalUnit = typeof globalUnits[number]
type Choice<T extends readonly string[]> = T[number]
export type Step = 0 | 1 | 2 | 3

export interface Chain {
  mod1: { on: boolean; type: Choice<typeof modulation1>; rate: number; amount: number; sync: boolean }
  mod2: { on: boolean; type: Choice<typeof modulation2>; rate: number; amount: number }
  delay: { on: boolean; bpm: number; division: number; feedback: number; mix: number; filter: Choice<typeof delayFilters>; sync: boolean }
  amp: { on: boolean; type: Choice<typeof ampTypes>; drive: number; frequency: number; bass: number; mid: number; treble: number }
  compressor: { on: boolean; amount: number; fast: boolean }
  reverb: { on: boolean; type: Choice<typeof reverbTypes>; tone: Choice<typeof reverbTones>; mix: number }
}

export interface PianoLayer {
  on: boolean
  level: number
  octave: number
  sustain: boolean
  pitch: boolean
  type: PianoType
  touch: Choice<typeof touchNames>
  dynamics: Step
  timbre: Choice<typeof timbres>
  unison: Step
  softRelease: boolean
  resonance: boolean
  chain: Chain
}

export interface Settings {
  on: boolean
  focus: Layer
  layers: Record<Layer, PianoLayer>
  master: number
  pitch: number
  effects: {
    on: boolean
    focus: 'Organ' | 'Piano' | 'Synth'
    layer: Layer
    group: boolean
    global: Record<GlobalUnit, Chain[GlobalUnit] | undefined>
    clockBpm: number
    rotary: { on: boolean; fast: boolean; drive: number }
  }
}

function makeLayer(layer: Layer): PianoLayer {
  return {
    on: layer === 'A', level: layer === 'A' ? 12 : 5, octave: 0, sustain: true, pitch: false,
    type: 'Upright', touch: 'Medium', dynamics: 0, timbre: 'Off', unison: 0, softRelease: false,
    resonance: true,
    chain: {
      mod1: { on: false, type: 'A-Pan', rate: 3, amount: 6, sync: false },
      mod2: { on: false, type: 'Chorus', rate: 6, amount: 4 },
      delay: { on: false, bpm: 120, division: 6, feedback: 6, mix: 3, filter: 'Off', sync: false },
      amp: { on: false, type: 'Twin', drive: 4, frequency: 5, bass: 7, mid: 5, treble: 5 },
      compressor: { on: false, amount: 3, fast: false },
      reverb: { on: false, type: 'Spring', tone: 'Neutral', mix: 6 },
    },
  }
}

export function initialSettings(): Settings {
  return {
    on: true, focus: 'A', layers: { A: makeLayer('A'), B: makeLayer('B') }, master: 3, pitch: 0,
    effects: {
      on: true, focus: 'Piano', layer: 'A', group: false,
      global: { delay: undefined, compressor: undefined, reverb: undefined }, clockBpm: 120,
      rotary: { on: false, fast: false, drive: 3 },
    },
  }
}

export function setLayer(settings: Settings, layer: Layer, patch: Partial<PianoLayer>): Settings {
  return { ...settings, layers: { ...settings.layers, [layer]: { ...settings.layers[layer], ...patch } } }
}

export function focusLayer(settings: Settings, focus: Layer): Settings {
  return { ...settings, focus, effects: { ...settings.effects, focus: 'Piano', layer: focus } }
}

export function effectiveUnit<K extends keyof Chain>(settings: Settings, layer: Layer, unit: K): Chain[K] {
  return (settings.effects.global as Partial<Chain>)[unit] ?? settings.layers[layer].chain[unit]
}

export function editUnit<K extends keyof Chain>(settings: Settings, unit: K, patch: Partial<Chain[K]>): Settings {
  const layer = settings.effects.layer
  const value = { ...effectiveUnit(settings, layer, unit), ...patch }
  if ((settings.effects.global as Partial<Chain>)[unit]) {
    return { ...settings, effects: { ...settings.effects, global: { ...settings.effects.global, [unit]: value } } }
  }
  const targets: readonly Layer[] = settings.effects.group ? layers : [layer]
  return targets.reduce<Settings>((next, target) => (
    setLayer(next, target, { chain: { ...next.layers[target].chain, [unit]: value } })
  ), settings)
}

export function toggleGroup(settings: Settings): Settings {
  const group = !settings.effects.group
  const next = { ...settings, effects: { ...settings.effects, focus: 'Piano' as const, group } }
  if (!group) return next
  const layer = settings.effects.layer
  return setLayer(next, layer === 'A' ? 'B' : 'A', { chain: settings.layers[layer].chain })
}

export function toggleGlobal(settings: Settings, unit: GlobalUnit): Settings {
  const value = settings.effects.global[unit] ? undefined : { ...settings.layers[settings.effects.layer].chain[unit], on: true }
  return { ...settings, effects: { ...settings.effects, global: { ...settings.effects.global, [unit]: value } } }
}

export function cycle<T>(items: readonly T[], current: T): T {
  return items[(items.indexOf(current) + 1) % items.length]
}
