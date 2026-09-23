import type { UnitState } from './stage'

export type Engine = 'Piano' | 'Organ' | 'Synth'
export type SoundLayer = 'A' | 'B' | 'C'
export type VoiceKey = `Piano:${'A' | 'B'}` | `Organ:${'A' | 'B'}` | `Synth:${SoundLayer}`
export type Waveform = 'Sine' | 'Triangle' | 'Saw' | 'Square' | 'Pulse 33' | 'Pulse 10' | 'White Noise' | 'Sync Saw' | 'Sync Square' | 'Multi Saw' | 'Multi Saw 8ve' | 'Super Saw' | 'Super Square' | 'FM 2-op (algorithm A)'
export const waveforms: Waveform[] = ['Sine', 'Triangle', 'Saw', 'Square', 'Pulse 33', 'Pulse 10', 'White Noise', 'Sync Saw', 'Sync Square', 'Multi Saw', 'Multi Saw 8ve', 'Super Saw', 'Super Square', 'FM 2-op (algorithm A)']
export const filterTypes = ['LP12', 'LP24', 'HP', 'BP'] as const
export const lfoWaves = ['Triangle', 'Saw down', 'Saw up', 'Square', 'Sample & Hold'] as const
export const splitNotes = [36, 41, 48, 53, 60, 65, 72, 77, 84, 89, 96]
export type Zone = 0 | 1 | 2 | 3
export interface Envelope { attack: number; decay: number; release: number; amount: number; velocity: boolean }
export interface OrganLayer { enabled: boolean; level: number; octave: number; zones: [Zone, Zone]; model: 'B3' | 'Vox' | 'Farf' | 'Pipe 1' | 'B3 Bass' | 'Pipe 2'; drawbars: number[]; percussion: boolean; percussionSoft: boolean; percussionFast: boolean; percussionThird: boolean; keyClick: boolean; vibrato: boolean; chorus: 'C1' | 'C2' | 'C3' | 'V1' | 'V2' | 'V3'; sustped: boolean }
export interface SynthLayer { enabled: boolean; level: number; octave: number; zones: [Zone, Zone]; waveform: Waveform; oscCtrl: number; coarse: number; fine: number; filterType: typeof filterTypes[number]; cutoff: number; resonance: number; tracking: 0 | 1 | 2 | 3; drive: 0 | 1 | 2 | 3; oscEnv: Envelope; oscEnvToPitch: boolean; filterEnv: Envelope; ampEnv: Envelope; lfoWave: typeof lfoWaves[number]; lfoTarget: 'Off' | 'Osc Pitch' | 'Osc Ctrl' | 'Filter Freq'; lfoRate: number; lfoAmount: number; lfoSync: boolean; voiceMode: 'Poly' | 'Mono' | 'Legato'; priority: 'Off' | 'Low' | 'High'; glide: number; unison: 0 | 1 | 2 | 3; vibrato: 'Off' | 'On' | 'Wheel'; vibratoRate: number; vibratoAmount: number; arpMode: 'Arp' | 'Poly' | 'Gate'; arpRate: number; arpSync: boolean; arpRange: 1 | 2 | 3 | 4; arpDirection: 'Up' | 'Down' | 'Up/Down' | 'Random'; arpHold: boolean; arpRun: boolean; units: Record<string, UnitState> }
export interface SplitPoint { on: boolean; note: number; fade: 0 | 6 | 12 }
export interface MorphAssignment { from: number; to: number }
export interface SystemState { organOn: boolean; synthOn: boolean; organFocus: 'A' | 'B'; synthFocus: SoundLayer; organ: Record<'A' | 'B', OrganLayer>; synth: Record<SoundLayer, SynthLayer>; organUnits: Record<string, UnitState>; splits: [SplitPoint, SplitPoint, SplitPoint]; scene: 0 | 1; scenes: [Record<VoiceKey, boolean>, Record<VoiceKey, boolean>]; morphs: Record<'Wheel' | 'Control Pedal', Record<string, MorphAssignment>>; wheel: number; pedal: number; tempo: number; transpose: number; clockSync: boolean }
export const voiceKeys: VoiceKey[] = ['Piano:A', 'Piano:B', 'Organ:A', 'Organ:B', 'Synth:A', 'Synth:B', 'Synth:C']
const envelope = (): Envelope => ({ attack: .01, decay: .4, release: .25, amount: .5, velocity: true })
const organLayer = (enabled: boolean): OrganLayer => ({ enabled, level: .65, octave: 0, zones: [0, 3], model: 'B3', drawbars: [8, 0, 8, 0, 4, 0, 0, 0, 0], percussion: false, percussionSoft: false, percussionFast: false, percussionThird: false, keyClick: true, vibrato: false, chorus: 'C1', sustped: true })
const synthLayer = (enabled: boolean, units: Record<string, UnitState>): SynthLayer => ({ enabled, level: .55, octave: 0, zones: [0, 3], waveform: 'Saw', oscCtrl: .3, coarse: 0, fine: 0, filterType: 'LP12', cutoff: .65, resonance: .1, tracking: 0, drive: 0, oscEnv: envelope(), oscEnvToPitch: false, filterEnv: envelope(), ampEnv: envelope(), lfoWave: 'Triangle', lfoTarget: 'Off', lfoRate: .4, lfoAmount: .3, lfoSync: false, voiceMode: 'Poly', priority: 'Off', glide: 0, unison: 0, vibrato: 'Off', vibratoRate: 5, vibratoAmount: .2, arpMode: 'Arp', arpRate: .5, arpSync: false, arpRange: 1, arpDirection: 'Up', arpHold: false, arpRun: false, units: structuredClone(units) })
export function initialSystemState(units: Record<string, UnitState>): SystemState {
  const scenes = [Object.fromEntries(voiceKeys.map(key => [key, key === 'Piano:A'])), Object.fromEntries(voiceKeys.map(key => [key, key === 'Piano:A']))] as SystemState['scenes']
  return { organOn: false, synthOn: false, organFocus: 'A', synthFocus: 'A', organ: { A: organLayer(false), B: organLayer(false) }, synth: { A: synthLayer(false, units), B: synthLayer(false, units), C: synthLayer(false, units) }, organUnits: structuredClone(units), splits: [{ on: false, note: 48, fade: 0 }, { on: false, note: 60, fade: 0 }, { on: false, note: 72, fade: 0 }], scene: 0, scenes, morphs: { Wheel: {}, 'Control Pedal': {} }, wheel: 0, pedal: 0, tempo: 120, transpose: 0, clockSync: false }
}
export function zoneForNote(note: number, splits: SystemState['splits']): number { return splits.filter(point => point.on && note >= point.note).length }
export function zoneGain(note: number, zones: [Zone, Zone], splits: SystemState['splits']): number {
  const active = splits.filter(point => point.on).sort((a, b) => a.note - b.note)
  let gain = zoneForNote(note, splits) >= zones[0] && zoneForNote(note, splits) <= zones[1] ? 1 : 0
  active.forEach((point, index) => { if (!point.fade || Math.abs(note - point.note) >= point.fade) return; const left = index, right = index + 1; const l = left >= zones[0] && left <= zones[1], r = right >= zones[0] && right <= zones[1]; if (l !== r) gain = l ? Math.max(0, Math.min(1, (point.note + point.fade - note) / (2 * point.fade))) : Math.max(0, Math.min(1, (note - point.note + point.fade) / (2 * point.fade))) })
  return gain
}
export function morphed(base: number, assignments: SystemState['morphs'], path: string, wheel: number, pedal: number): number {
  let result = base
  for (const [source, amount] of [['Wheel', wheel], ['Control Pedal', pedal]] as const) { const assigned = assignments[source][path]; if (assigned) result += (assigned.to - assigned.from) * amount }
  return Math.max(0, Math.min(1, result))
}
export function arpStep(notes: readonly number[], step: number, direction: SynthLayer['arpDirection'], range: number): number | null {
  if (!notes.length) return null
  const sequence = Array.from({ length: Math.max(1, range) }, (_, octave) => [...notes].sort((a, b) => a - b).map(note => note + octave * 12)).flat()
  if (direction === 'Down') sequence.reverse()
  if (direction === 'Up/Down') sequence.push(...sequence.slice(1, -1).reverse())
  if (direction === 'Random') return sequence[(Math.imul(step + 1, 1103515245) >>> 16) % sequence.length]
  return sequence[step % sequence.length]
}

export interface ProgramDocument { name: string; state: Record<string, unknown> }
export function programSnapshot<T extends { master: number; pitch: number; wheel: number; pedal: number }>(state: T): Omit<T, 'master' | 'pitch' | 'wheel' | 'pedal'> { const copy = structuredClone(state); delete (copy as Partial<T>).master; delete (copy as Partial<T>).pitch; delete (copy as Partial<T>).wheel; delete (copy as Partial<T>).pedal; return copy }
export function factoryPrograms<T extends { organOn: boolean; synthOn: boolean; pianoOn: boolean; organ: SystemState['organ']; synth: SystemState['synth']; layers: Record<'A' | 'B', { enabled: boolean; type: string }> }>(base: T): ProgramDocument[] {
  const names = ['Concert Grand', 'Upright Room', 'Electric Tines', 'B3 Gospel', 'Vox Combo', 'Pipe Chapel', 'Analog Brass', 'Layered Stage']
  return Array.from({ length: 32 }, (_, index) => { const s = structuredClone(base); const kind = index % 8; if (kind >= 3 && kind <= 5) { s.pianoOn = false; s.organOn = true; s.organ.A.enabled = true; s.organ.A.model = (['B3', 'Vox', 'Pipe 1'] as const)[kind - 3] } if (kind === 6) { s.pianoOn = false; s.synthOn = true; s.synth.A.enabled = true } if (kind === 7) { s.organOn = true; s.organ.A.enabled = true; s.synthOn = true; s.synth.A.enabled = true; const system = s as T & SystemState; system.splits[1].on = true; system.organ.A.zones = [0, 1]; system.synth.A.zones = [2, 3] } if (kind === 1) s.layers.A.type = 'Upright'; if (kind === 2) s.layers.A.type = 'Electric'; const scene = (s as T & SystemState).scenes; if (scene) { for (const view of scene) { view['Piano:A'] = s.pianoOn && s.layers.A.enabled; view['Organ:A'] = s.organOn && s.organ.A.enabled; view['Synth:A'] = s.synthOn && s.synth.A.enabled } } return { name: index < 8 ? names[index] : `${names[kind]} ${index + 1}`, state: programSnapshot(s as T & { master: number; pitch: number; wheel: number; pedal: number }) as Record<string, unknown> } })
}
export function loadPrograms<T extends { master: number; pitch: number; wheel: number; pedal: number }>(base: T, storage?: Pick<Storage, 'getItem'>): { slots: ProgramDocument[]; live: ProgramDocument[] } {
  const defaults = factoryPrograms(base as T & Parameters<typeof factoryPrograms>[0])
  try { const raw = storage?.getItem('stage4-programs-v3'); if (raw) { const parsed = JSON.parse(raw); if (parsed.slots?.length === 32 && parsed.live?.length === 8) return parsed } } catch { /* storage unavailable */ }
  return { slots: defaults, live: Array.from({ length: 8 }, (_, i) => ({ name: `Live ${i + 1}`, state: programSnapshot(base) as Record<string, unknown> })) }
}
