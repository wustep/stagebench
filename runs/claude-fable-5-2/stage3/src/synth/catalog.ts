import { SynthWave } from '../audio/dsp/params'

/**
 * The Synth's oscillator waveforms: the exact required list of the synth spec, in five
 * categories. Everything here is live synthesis; there are no samples in the Synth section.
 */

export const SYNTH_CATEGORIES = ['Pure', 'Sync', 'Multi', 'Super', 'FM-H'] as const
export type SynthCategory = (typeof SYNTH_CATEGORIES)[number]

export interface SynthWaveform {
  id: number
  name: string
  category: SynthCategory
}

export const SYNTH_WAVEFORMS: readonly SynthWaveform[] = [
  { id: SynthWave.Sine, name: 'Sine', category: 'Pure' },
  { id: SynthWave.Triangle, name: 'Triangle', category: 'Pure' },
  { id: SynthWave.Saw, name: 'Saw', category: 'Pure' },
  { id: SynthWave.Square, name: 'Square', category: 'Pure' },
  { id: SynthWave.Pulse33, name: 'Pulse 33', category: 'Pure' },
  { id: SynthWave.Pulse10, name: 'Pulse 10', category: 'Pure' },
  { id: SynthWave.Noise, name: 'White Noise', category: 'Pure' },
  { id: SynthWave.SyncSaw, name: 'Sync Saw', category: 'Sync' },
  { id: SynthWave.SyncSquare, name: 'Sync Square', category: 'Sync' },
  { id: SynthWave.MultiSaw, name: 'Multi Saw', category: 'Multi' },
  { id: SynthWave.MultiSawOct, name: 'Multi Saw 8ve', category: 'Multi' },
  { id: SynthWave.SuperSaw, name: 'Super Saw', category: 'Super' },
  { id: SynthWave.SuperSquare, name: 'Super Square', category: 'Super' },
  { id: SynthWave.Fm2Op, name: 'FM 2-op A', category: 'FM-H' },
]

/** What the Osc Ctrl knob does in each category (manual p. 29-30). */
export const OSC_CTRL_ROLE: Record<SynthCategory, string> = {
  Pure: 'no effect',
  Sync: 'synced oscillator pitch',
  Multi: 'detune',
  Super: 'detune and width',
  'FM-H': 'FM amount',
}

export function waveform(id: number): SynthWaveform {
  return SYNTH_WAVEFORMS[Math.min(SYNTH_WAVEFORMS.length - 1, Math.max(0, Math.round(id)))]
}

export function wavesOf(category: SynthCategory): SynthWaveform[] {
  return SYNTH_WAVEFORMS.filter((wave) => wave.category === category)
}

export const FILTER_TYPES = ['LP12', 'LP24', 'HP', 'BP'] as const
export const KB_TRACKS = ['Off', '1/3', '2/3', '1'] as const
export const LFO_WAVES = ['Triangle', 'Saw down', 'Saw up', 'Square', 'Sample & Hold'] as const
export const LFO_DESTS = ['Off', 'Osc Pitch', 'Osc Ctrl', 'Filter Freq'] as const
export const VOICE_MODES = ['Poly', 'Mono', 'Legato'] as const
export const PRIORITIES = ['Last note', 'Low', 'High'] as const
export const VIBRATO_MODES = ['Off', 'On', 'Delay', 'Wheel', 'Pedal'] as const
export const ARP_MODES = ['Arp', 'Gate', 'Poly'] as const
export const ARP_DIRECTIONS = ['Up', 'Down', 'Up/Down', 'Random'] as const
