/**
 * Canonical Organ state (two layers A, B sharing one effect chain) and the pure mappings the audio engine and the
 * panel share.
 */
export type OrganModel = 'B3' | 'Vox' | 'Farf' | 'Pipe 1' | 'Pipe 2' | 'B3 Bass'
/** order of the panel model button states / LEDs */
export const ORGAN_MODELS: readonly OrganModel[] = ['B3', 'Vox', 'Farf', 'Pipe 1', 'Pipe 2', 'B3 Bass']

/** vibrato/chorus selector in panel order: V1, C1, V2, C2, V3, C3 */
export const VIB_MODES = ['V1', 'C1', 'V2', 'C2', 'V3', 'C3'] as const
export type VibMode = (typeof VIB_MODES)[number]
export const vibIsChorus = (mode: VibMode): boolean => mode.startsWith('C')
export const vibDepthStep = (mode: VibMode): 1 | 2 | 3 => Number(mode[1]) as 1 | 2 | 3

export const DRAWBAR_COUNT = 9

export interface OrganLayerState {
  enabled: boolean
  /** fader position 0..1 */
  level: number
  octave: -1 | 0 | 1
  model: OrganModel
  /** nine drawbar positions 0..8 (Farf: pulled past half = on) */
  drawbars: number[]
  sustPed: boolean
  pitchStick: boolean
  /** vibrato/chorus on for this layer */
  vibOn: boolean
}

export interface PercussionState {
  on: boolean
  /** true = soft level, false = normal */
  soft: boolean
  /** true = fast decay, false = slow */
  fast: boolean
  /** true = third harmonic, false = second */
  third: boolean
  /** poly mode (optional): every key retriggers the percussion; default is single-triggered */
  poly: boolean
}

export interface OrganSettings {
  layers: Record<'A' | 'B', OrganLayerState>
  vibMode: VibMode
  perc: PercussionState
}

/** classic registration: 88 8000 000 style presets per model so every engine sounds musical when selected */
export const DEFAULT_DRAWBARS: Record<OrganModel, number[]> = {
  B3: [8, 8, 8, 0, 0, 0, 0, 0, 0],
  Vox: [6, 8, 5, 3, 0, 0, 0, 4, 4],
  Farf: [0, 8, 8, 0, 8, 0, 0, 0, 0],
  'Pipe 1': [6, 8, 5, 4, 2, 0, 0, 0, 0],
  'Pipe 2': [3, 8, 6, 5, 4, 3, 2, 0, 0],
  'B3 Bass': [8, 0, 6, 0, 0, 0, 0, 0, 0],
}

export const defaultOrganLayer = (level: number, enabled: boolean, model: OrganModel = 'B3'): OrganLayerState => ({
  enabled,
  level,
  octave: 0,
  model,
  drawbars: [...DEFAULT_DRAWBARS[model]],
  sustPed: true,
  pitchStick: true,
  vibOn: false,
})

export const defaultOrgan = (): OrganSettings => ({
  layers: { A: defaultOrganLayer(0.7, false), B: defaultOrganLayer(0.5, false, 'Vox') },
  vibMode: 'V1',
  perc: { on: false, soft: false, fast: true, third: false, poly: false },
})

// ---------------------------------------------------------------------------------------------------------------
// drawbar → spectrum mappings (pure; used by the engine and by the panel LED graphs)
// ---------------------------------------------------------------------------------------------------------------
/**
 * Partial number of each drawbar relative to a 16' fundamental (the pitch of the lowest tonewheel):
 * 16' 5⅓' 8' 4' 2⅔' 2' 1⅗' 1⅓' 1'  →  1 3 2 4 6 8 10 12 16.
 * Every registration of a tonewheel organ is therefore a harmonic series of note/2, so one periodic wave per note is exact.
 */
export const B3_PARTIALS: readonly number[] = [1, 3, 2, 4, 6, 8, 10, 12, 16]
/** Vox: seven register partials (16' 8' 4' 2⅔' 2' 1⅗' 1'), then two mix drawbars (filtered / unfiltered) */
export const VOX_PARTIALS: readonly number[] = [1, 2, 4, 6, 8, 10, 16]
/** Pipe ranks: 16' 8' 4' 2⅔' 2' 1⅗' 1⅓' 1' and a three-rank mixture */
export const PIPE_PARTIALS: readonly number[] = [1, 2, 4, 6, 8, 10, 12, 16, 3]

/** drawbar position 0..8 → linear amplitude (each step is about 3 dB, as on a real drawbar) */
export const drawbarGain = (position: number): number => (position <= 0 ? 0 : Math.pow(10, (-3 * (8 - Math.min(8, position))) / 20))

/** Farfisa registers are switches: pulled past half = on */
export const farfSwitchOn = (position: number): boolean => position > 4

/** how many LED rows a drawbar shows for its model (Farf switches light fully or not at all) */
export const drawbarGraph = (model: OrganModel, position: number): number => (model === 'Farf' ? (farfSwitchOn(position) ? 8 : 0) : Math.round(position))

/** B3 Bass only has the 16' and 8' drawbars (indices 0 and 2) */
export const B3_BASS_ACTIVE: readonly number[] = [0, 2]
export const drawbarActive = (model: OrganModel, index: number): boolean => (model === 'B3 Bass' ? B3_BASS_ACTIVE.includes(index) : true)

export const DRAWBAR_NAMES: Record<OrganModel, string[]> = {
  B3: ["16'", "5 1/3'", "8'", "4'", "2 2/3'", "2'", "1 3/5'", "1 1/3'", "1'"],
  'B3 Bass': ["16'", "5 1/3' (unused)", "8'", '4\' (unused)', "2 2/3' (unused)", "2' (unused)", "1 3/5' (unused)", "1 1/3' (unused)", "1' (unused)"],
  Vox: ["16'", "8'", "4'", "2 2/3'", "2'", "1 3/5'", "1'", 'filtered mix', 'unfiltered mix'],
  Farf: ["16' switch", "8' flute switch", "4' flute switch", "2' flute switch", 'strings 8\' switch', 'oboe switch', 'trumpet switch', 'brilliant switch', 'bass switch'],
  'Pipe 1': ["16'", "8'", "4'", "2 2/3'", "2'", "1 3/5'", "1 1/3'", "1'", 'mixture'],
  'Pipe 2': ["16'", "8'", "4'", "2 2/3'", "2'", "1 3/5'", "1 1/3'", "1'", 'mixture'],
}

/** percussion partial as a multiple of the played pitch */
export const percussionPartial = (third: boolean): number => (third ? 3 : 2)
export const percussionDecaySeconds = (fast: boolean): number => (fast ? 0.18 : 0.6)
export const percussionLevel = (soft: boolean): number => (soft ? 0.5 : 1)

/** rotary speed targets */
export const ROTARY_SPEEDS = ['Slow', 'Fast', 'Stop'] as const
