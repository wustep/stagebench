/** Synth section types — Phase 3 */

export type SynthLayerId = 'A' | 'B' | 'C'
export type WaveCategory = 'Pure' | 'Sync' | 'Multi' | 'Super' | 'FM-H'
export type PureWave = 'Sine' | 'Triangle' | 'Saw' | 'Square' | 'Pulse 33' | 'Pulse 10' | 'White Noise'
export type SyncWave = 'Sync Saw' | 'Sync Square'
export type MultiWave = 'Multi Saw' | 'Multi Saw 8ve'
export type SuperWave = 'Super Saw' | 'Super Square'
export type FmWave = 'FM 2-op (algorithm A)'
export type SynthWaveform = PureWave | SyncWave | MultiWave | SuperWave | FmWave
export type FilterType = 'LP12' | 'LP24' | 'HP' | 'BP'
export type KbTrack = 'Off' | '1/3' | '2/3' | '1'
export type DriveLevel = 'Off' | 1 | 2 | 3
export type VoiceMode = 'Poly' | 'Mono' | 'Legato'
export type NotePriority = 'Off' | 'Low' | 'High'
export type UnisonLevel = 'Off' | 1 | 2 | 3
export type VibratoMode = 'Off' | 'On' | 'Wheel'
export type LfoWave = 'Triangle' | 'Saw down' | 'Saw up' | 'Square' | 'Sample & Hold'
export type LfoDest = 'Off' | 'Osc Pitch' | 'Osc Ctrl' | 'Filter Freq'
export type ArpMode = 'Arp' | 'Poly' | 'Gate'
export type ArpDirection = 'Up' | 'Down' | 'Up/Down' | 'Random'
export type AmpVel = 'Off' | 1 | 2 | 3

export const WAVEFORMS_BY_CATEGORY: Record<WaveCategory, SynthWaveform[]> = {
  Pure: ['Sine', 'Triangle', 'Saw', 'Square', 'Pulse 33', 'Pulse 10', 'White Noise'],
  Sync: ['Sync Saw', 'Sync Square'],
  Multi: ['Multi Saw', 'Multi Saw 8ve'],
  Super: ['Super Saw', 'Super Square'],
  'FM-H': ['FM 2-op (algorithm A)'],
}

export const ALL_REQUIRED_WAVEFORMS: SynthWaveform[] = [
  ...WAVEFORMS_BY_CATEGORY.Pure,
  ...WAVEFORMS_BY_CATEGORY.Sync,
  ...WAVEFORMS_BY_CATEGORY.Multi,
  ...WAVEFORMS_BY_CATEGORY.Super,
  ...WAVEFORMS_BY_CATEGORY['FM-H'],
]

export const FILTER_TYPES: FilterType[] = ['LP12', 'LP24', 'HP', 'BP']
export const LFO_WAVES: LfoWave[] = ['Triangle', 'Saw down', 'Saw up', 'Square', 'Sample & Hold']
export const LFO_DESTS: LfoDest[] = ['Off', 'Osc Pitch', 'Osc Ctrl', 'Filter Freq']
export const ARP_DIRS: ArpDirection[] = ['Up', 'Down', 'Up/Down', 'Random']

export function categoryOf(wave: SynthWaveform): WaveCategory {
  for (const [cat, list] of Object.entries(WAVEFORMS_BY_CATEGORY) as [WaveCategory, SynthWaveform[]][]) {
    if (list.includes(wave)) return cat
  }
  return 'Pure'
}

export interface EnvState {
  attack: number
  decay: number
  release: number
  velocity: boolean
  amount: number
}

export interface AmpEnvState {
  attack: number
  decay: number
  release: number
  velocity: AmpVel
}

export interface SynthLayerState {
  enabled: boolean
  level: number
  octave: number
  sustped: boolean
  pstick: boolean
  waveform: SynthWaveform
  oscCtrl: number
  filterType: FilterType
  filterFreq: number
  filterRes: number
  filterDrive: DriveLevel
  filterKbTrack: KbTrack
  filterEnvAmt: number
  oscEnv: EnvState
  filterEnv: EnvState
  ampEnv: AmpEnvState
  lfoWave: LfoWave
  lfoRate: number
  lfoAmount: number
  lfoDest: LfoDest
  lfoClockSync: boolean
  voiceMode: VoiceMode
  priority: NotePriority
  glide: number
  unison: UnisonLevel
  vibrato: VibratoMode
  vibratoRate: number
  vibratoAmount: number
  arpMode: ArpMode
  arpOn: boolean
  arpHold: boolean
  arpRun: boolean
  arpRate: number
  arpClockSync: boolean
  arpRange: number
  arpDirection: ArpDirection
  zones: [boolean, boolean, boolean, boolean]
}

export interface SynthSectionState {
  sectionOn: boolean
  focus: SynthLayerId
  layers: Record<SynthLayerId, SynthLayerState>
}

export function defaultEnv(): EnvState {
  return { attack: 0.05, decay: 0.4, release: 0.3, velocity: false, amount: 0.5 }
}

export function defaultAmpEnv(): AmpEnvState {
  return { attack: 0.02, decay: 0.5, release: 0.25, velocity: 2 }
}

export function defaultSynthLayer(enabled: boolean, level: number, wave: SynthWaveform = 'Saw'): SynthLayerState {
  return {
    enabled,
    level,
    octave: 0,
    sustped: true,
    pstick: false,
    waveform: wave,
    oscCtrl: 0.5,
    filterType: 'LP24',
    filterFreq: 0.65,
    filterRes: 0.15,
    filterDrive: 'Off',
    filterKbTrack: '2/3',
    filterEnvAmt: 0.4,
    oscEnv: defaultEnv(),
    filterEnv: defaultEnv(),
    ampEnv: defaultAmpEnv(),
    lfoWave: 'Triangle',
    lfoRate: 0.4,
    lfoAmount: 0,
    lfoDest: 'Off',
    lfoClockSync: false,
    voiceMode: 'Poly',
    priority: 'Off',
    glide: 0,
    unison: 'Off',
    vibrato: 'Off',
    vibratoRate: 5,
    vibratoAmount: 0.3,
    arpMode: 'Arp',
    arpOn: false,
    arpHold: false,
    arpRun: false,
    arpRate: 0.5,
    arpClockSync: false,
    arpRange: 1,
    arpDirection: 'Up',
    zones: [true, true, true, true],
  }
}

export function defaultSynthState(): SynthSectionState {
  return {
    sectionOn: false,
    focus: 'A',
    layers: {
      A: defaultSynthLayer(true, 0.7, 'Saw'),
      B: defaultSynthLayer(false, 0, 'Square'),
      C: defaultSynthLayer(false, 0, 'Sine'),
    },
  }
}
