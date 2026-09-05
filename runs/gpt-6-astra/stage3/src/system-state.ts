import { chainDefaults, initialState, type ChainSettings, type InstrumentState } from './phase2-state'
export const extraIds = ['Oa', 'Ob', 'Sa', 'Sb', 'Sc'] as const
export type ExtraId = typeof extraIds[number]
export const allIds = ['A', 'B', ...extraIds] as const
export type SoundId = typeof allIds[number]
export const organModels = ['B3', 'B3 Bass', 'Vox', 'Farf', 'Pipe 1', 'Pipe 2'] as const
export const waves = ['Sine', 'Triangle', 'Saw', 'Square', 'Pulse 33', 'Pulse 10', 'White Noise', 'Sync Saw', 'Sync Square', 'Multi Saw', 'Multi Saw 8ve', 'Super Saw', 'Super Square', 'FM 2-op (algorithm A)'] as const
export const positions = [36, 41, 48, 53, 60, 65, 72, 77, 84, 89, 96]
export const positionNames = ['C2', 'F2', 'C3', 'F3', 'C4', 'F4', 'C5', 'F5', 'C6', 'F6', 'C7']
export interface Envelope { attack: number; decay: number; release: number; velocity: number; amount: number; pitch: boolean }
export interface Common { enabled: boolean; level: number; octave: number; sustped: boolean; pstick: boolean }
export interface OrganLayer extends Common { model: number; drawbars: number[]; percussion: boolean; soft: boolean; fast: boolean; third: boolean; click: boolean; vibrato: boolean; chorus: number; percussionPoly: boolean }
export interface SynthLayer extends Common { wave: number; ctrl: number; coarse: number; fine: number; filter: number; cutoff: number; resonance: number; tracking: number; drive: number; oscEnv: Envelope; filterEnv: Envelope; ampEnv: Envelope; lfoWave: number; lfoDest: number; lfoRate: number; lfoAmount: number; lfoSync: boolean; mode: number; priority: number; glide: number; unison: number; vibrato: number; vibratoRate: number; vibratoAmount: number; arp: boolean; arpMode: number; arpRate: number; arpSync: boolean; subdivision: number; range: number; direction: number; hold: boolean; effects: ChainSettings }
export interface Morph { source: 'Wheel' | 'Control Pedal'; path: string; start: number; end: number }
export interface SystemState { version: 1; organ: Record<'Oa' | 'Ob', OrganLayer>; synth: Record<'Sa' | 'Sb' | 'Sc', SynthLayer>; organEffects: ChainSettings; organFocus: 'Oa' | 'Ob'; synthFocus: 'Sa' | 'Sb' | 'Sc'; fxExtra: ExtraId; organOn: boolean; synthOn: boolean; organRotary: boolean; rotarySpeed: number; rotaryStop: boolean; synthGroup: boolean; split: boolean; points: { enabled: boolean; note: number; width: number }[]; zones: Record<SoundId, [number, number]>; scene: 0 | 1; scenes: [Record<SoundId, boolean>, Record<SoundId, boolean>]; morphs: Morph[]; wheel: number; pedal: number; transpose: number; clockSync: boolean }
const env = (amount = 0): Envelope => ({ attack: .01, decay: 4, release: .25, velocity: 0, amount, pitch: false })
export function systemDefaults(): SystemState {
  const common = { enabled: false, level: .65, octave: 0, sustped: true, pstick: true }
  const organ = (): OrganLayer => ({ ...common, model: 0, drawbars: [8, 0, 8, 5, 0, 3, 0, 0, 0], percussion: false, soft: false, fast: false, third: false, click: true, vibrato: false, chorus: 0, percussionPoly: false })
  const synth = (): SynthLayer => ({ ...common, wave: 2, ctrl: .3, coarse: 0, fine: 0, filter: 0, cutoff: .8, resonance: .1, tracking: 0, drive: 0, oscEnv: env(), filterEnv: env(.3), ampEnv: env(), lfoWave: 0, lfoDest: -1, lfoRate: 4, lfoAmount: 0, lfoSync: false, mode: 0, priority: 0, glide: 0, unison: 0, vibrato: 0, vibratoRate: 5, vibratoAmount: .2, arp: false, arpMode: 0, arpRate: 120, arpSync: false, subdivision: 4, range: 1, direction: 0, hold: false, effects: chainDefaults() })
  const enabled = Object.fromEntries(allIds.map(id => [id, id === 'A'])) as Record<SoundId, boolean>
  return { version: 1, organ: { Oa: organ(), Ob: organ() }, synth: { Sa: synth(), Sb: synth(), Sc: synth() }, organEffects: chainDefaults(), organFocus: 'Oa', synthFocus: 'Sa', fxExtra: 'Sa', organOn: true, synthOn: true, organRotary: false, rotarySpeed: 0, rotaryStop: false, synthGroup: false, split: false, points: [{ enabled: false, note: 48, width: 0 }, { enabled: true, note: 60, width: 0 }, { enabled: false, note: 72, width: 0 }], zones: Object.fromEntries(allIds.map(id => [id, [0, 3]])) as SystemState['zones'], scene: 0, scenes: [enabled, { ...enabled, A: false, Sa: true }], morphs: [], wheel: 0, pedal: 0, transpose: 0, clockSync: false }
}
export function fullState(): InstrumentState { return { ...initialState(), system: systemDefaults() } }
export function sound(state: InstrumentState, id: SoundId) { return id === 'A' || id === 'B' ? state.layers[id] : id === 'Oa' || id === 'Ob' ? state.system!.organ[id] : state.system!.synth[id] }
export function zoneGain(s: SystemState | undefined, id: SoundId, note: number) {
  if (!s?.split) return 1
  const points = s.points.filter(p => p.enabled).sort((a, b) => a.note - b.note), [low, high] = s.zones[id]
  const fade = (p: { note: number; width: number }) => p.width ? Math.max(0, Math.min(1, (note - p.note + p.width) / (2 * p.width))) : Number(note >= p.note)
  return (low ? points[low - 1] ? fade(points[low - 1]) : 0 : 1) * (points[high] ? 1 - fade(points[high]) : 1)
}
export function readPath(state: InstrumentState, path: string): number { return path.split('.').reduce((o, k) => (o as Record<string, unknown>)[k], state as unknown) as number }
export function writePath(state: InstrumentState, path: string, value: number) { const keys = path.split('.'); const last = keys.pop()!; const object = keys.reduce((o, k) => (o as Record<string, unknown>)[k], state as unknown) as Record<string, unknown>; object[last] = value }
export function effectiveState(state: InstrumentState) {
  const result = structuredClone(state), s = result.system
  if (s) for (const m of s.morphs) writePath(result, m.path, m.start + (m.end - m.start) * (m.source === 'Wheel' ? s.wheel : s.pedal))
  return result
}
export type Program = { name: string; state: Omit<InstrumentState, 'master' | 'bend'> }
export function snapshot(state: InstrumentState): Program['state'] { const { master: _master, bend: _bend, ...saved } = structuredClone(state); if (saved.system) { saved.system.wheel = 0; saved.system.pedal = 0 }; return saved }
export function factories(): Program[] {
  const names = ['Concert Grand', 'Tonewheel Club', 'Vox Combo', 'Farfisa Bright', 'Cathedral Pipes', 'Super Saw Pad', 'Bass / Piano Split', 'FM Tine Stack']
  return Array.from({ length: 32 }, (_, i) => {
    const state = fullState(), s = state.system!, n = i % 8
    if (n >= 1 && n <= 4) { state.layers.A.enabled = false; s.organ.Oa.enabled = true; s.organ.Oa.model = [0, 0, 2, 3, 4][n]; s.organRotary = n === 1; state.rotary.on = n === 1 }
    if (n === 5 || n === 7) { s.synth.Sa.enabled = true; s.synth.Sa.wave = n === 5 ? 11 : 13; state.layers.A.enabled = n === 7; s.synth.Sa.ampEnv.attack = n === 5 ? .4 : .01 }
    if (n === 6) { s.organ.Oa.enabled = true; s.organ.Oa.model = 1; s.split = true; s.zones.Oa = [0, 0]; s.zones.A = [1, 3] }
    s.scenes[0] = Object.fromEntries(allIds.map(id => [id, sound(state, id).enabled])) as Record<SoundId, boolean>
    return { name: i < 8 ? names[n] : `User ${i + 1}`, state: snapshot(state) }
  })
}
