export const pianoTypes = ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'] as const
export type PianoType = typeof pianoTypes[number]
export type LayerId = 'A' | 'B'
export const unitIds = ['mod1', 'mod2', 'delay', 'ampEq', 'compressor', 'reverb'] as const
export type UnitId = typeof unitIds[number]
export const effectTypes: Record<UnitId, readonly string[]> = {
  mod1: ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump'],
  mod2: ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin'],
  delay: ['Off', 'LP', 'HP', 'BP'], ampEq: ['EQ only', 'Twin', 'JC', 'Small', 'LP24 Filter', 'HP24 Filter', 'To Rotary'],
  compressor: ['Normal', 'Fast'], reverb: ['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral'],
}
export interface EffectSettings { on: boolean; type: number; rate: number; amount: number; wet: number; feedback: number; bass: number; mid: number; treble: number; tone: number; sync: boolean }
export type ChainSettings = Record<UnitId, EffectSettings>
export interface PianoLayer { enabled: boolean; level: number; octave: number; type: PianoType; model: number; touch: number; dynComp: number; timbre: number; unison: number; softRelease: boolean; stringRes: boolean; sustped: boolean; pstick: boolean; effects: ChainSettings }
export interface InstrumentState { layers: Record<LayerId, PianoLayer>; focus: LayerId; fxFocus: LayerId; fxSection: 'Piano' | 'Organ' | 'Synth'; sectionOn: boolean; effectsOn: boolean; group: boolean; globals: Record<'delay' | 'compressor' | 'reverb', boolean>; master: number; bend: number; bpm: number; rotary: { on: boolean; fast: boolean; drive: number } }
export function chainDefaults(): ChainSettings {
  return Object.fromEntries(unitIds.map(id => [id, { on: false, type: 0, rate: .3, amount: .4, wet: .3, feedback: .35, bass: 0, mid: 0, treble: 0, tone: .5, sync: false }])) as ChainSettings
}
export function initialState(): InstrumentState {
  const layer = (enabled: boolean): PianoLayer => ({ enabled, level: .75, octave: 0, type: 'Grand', model: 0, touch: 1, dynComp: 0, timbre: 0, unison: 0, softRelease: false, stringRes: false, sustped: true, pstick: true, effects: chainDefaults() })
  return { layers: { A: layer(true), B: layer(false) }, focus: 'A', fxFocus: 'A', fxSection: 'Piano', sectionOn: true, effectsOn: true, group: false, globals: { delay: false, compressor: false, reverb: false }, master: .7, bend: 0, bpm: 120, rotary: { on: false, fast: false, drive: .15 } }
}
export function timbres(type: PianoType) { return type === 'Electric' ? ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'] : ['Off', 'Soft', 'Mid', 'Bright'] }
export const modelNames: Record<PianoType, string> = { Grand: 'Grand synthesis fallback', Upright: 'Upright synthesis fallback', Electric: 'Tine synthesis fallback', Clav: 'Plucked clav synthesis', Digital: 'FM piano synthesis', Misc: 'Mallet synthesis' }
