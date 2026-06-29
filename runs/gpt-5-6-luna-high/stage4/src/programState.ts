export type LayerId = 'pianoA' | 'pianoB' | 'organA' | 'organB' | 'synthA' | 'synthB' | 'synthC';
export type MorphSource = 'Wheel' | 'Aftertouch' | 'Control Pedal';
export type ListMode = 'Numeric' | 'Alphabetic' | 'Category';
export type SplitPoint = 'Low' | 'Mid' | 'High';
export const SPLIT_POSITIONS = ['C2','F2','C3','F3','C4','F4','C5','F5','C6','F6','C7'] as const;
export type SplitPosition = typeof SPLIT_POSITIONS[number];

export interface LayerState {
  id: LayerId; enabled: boolean; level: number; zone: number[]; sourceBus: string;
  transpose: number; focused: boolean; effectChain: string;
}
export interface EffectState { on: boolean; bypass: boolean; type: string; params: Record<string, number>; global: boolean; group: boolean; toRotary?: boolean; dryWet: number; }
export interface ZoneState { low: SplitPosition; mid: SplitPosition; high: SplitPosition; crossfade: 0|6|12; }
export interface MorphAssignment { source: MorphSource; destination: string; start: number; end: number; interpolation: 'linear'|'exponential'; }
export interface ProgramState {
  version: 1; name: string; category: string; bank: number; page: number; displayMode: number; listMode: ListMode;
  layers: Record<LayerId, LayerState>; piano: Record<string, unknown>; organ: Record<string, unknown>; synth: Record<string, unknown>; effects: Record<string, EffectState>;
  routing: { focusedLayer: LayerId; allEffectsBypass: boolean; masterLevel: number; masterClock: number; transpose: number };
  zones: ZoneState; morphs: MorphAssignment[]; scenes: { I: LayerId[]; II: LayerId[] }; activeScene: 'I'|'II'; metadata: { dirty: boolean };
}

const layer = (id: LayerId, enabled: boolean, bus: string): LayerState => ({ id, enabled, level: 0.8, zone: [0], sourceBus: bus, transpose: 0, focused: id === 'pianoA', effectChain: id.startsWith('piano') ? 'piano' : id.startsWith('organ') ? 'organ' : 'synth' });
export function createDefaultProgramState(): ProgramState {
  return { version: 1, name: '01 Grand Piano', category: 'Piano', bank: 1, page: 1, displayMode: 0, listMode: 'Numeric',
    layers: { pianoA: layer('pianoA', true, 'piano-A'), pianoB: layer('pianoB', false, 'piano-B'), organA: layer('organA', false, 'organ-A'), organB: layer('organB', false, 'organ-B'), synthA: layer('synthA', false, 'synth-A'), synthB: layer('synthB', false, 'synth-B'), synthC: layer('synthC', false, 'synth-C') },
    piano: { layerA: true, layerB: false, pianoType: 'Grand', model: 0, touch: 'Medium', dynamicCompression: 0, timbre: 'Off', unison: 0, softRelease: false, stringResonance: true },
    organ: { layerA: { enabled: false, model: 'B3', drawbars: [0.75,.55,.8,.45,.35,.3,.2,.15,.1], preset: true }, layerB: { enabled: false, model: 'B3 Bass', drawbars: [0.75,.55,.8,.45,.35,.3,.2,.15,.1], preset: true }, focusedLayer: 'A' },
    synth: { layerA: { enabled: false, mode: 'Analog', category: 'Pure', waveform: 'Saw', oscCtrl: .35 }, layerB: { enabled: false, mode: 'Samples', category: 'Pure', waveform: 'Sine', oscCtrl: .2 }, layerC: { enabled: false, mode: 'Extern', category: 'Pure', waveform: 'Sine', oscCtrl: 0 }, focusedLayer: 'A' },
    effects: { mod1: { on: false, bypass: false, type: 'Tremolo', params: { rate: 0.35, amount: 0.25 }, global: false, group: false, dryWet: 1 }, mod2: { on: false, bypass: false, type: 'Chorus', params: { rate: 0.3, amount: 0.25 }, global: false, group: false, dryWet: 1 }, delay: { on: false, bypass: false, type: 'Clean delay', params: { tempo: 0.4, feedback: 0.25 }, global: false, group: false, dryWet: 0.25 }, ampEq: { on: false, bypass: false, type: 'Neutral EQ', params: { drive: 0, midFreq: 0.5 }, global: false, group: false, dryWet: 1 }, compressor: { on: false, bypass: false, type: 'Compressor', params: { amount: 0.2 }, global: true, group: false, dryWet: 1 }, reverb: { on: true, bypass: false, type: 'Hall', params: { amount: 0.18 }, global: true, group: false, dryWet: 0.18 }, rotary: { on: false, bypass: false, type: 'Rotary Speaker', params: { speed: 0.2, drive: 0.2 }, global: false, group: false, toRotary: false, dryWet: 1 } },
    routing: { focusedLayer: 'pianoA', allEffectsBypass: false, masterLevel: 0.8, masterClock: 120, transpose: 0 }, zones: { low: 'C2', mid: 'C4', high: 'C6', crossfade: 0 }, morphs: [], scenes: { I: ['pianoA'], II: ['pianoA','pianoB'] }, activeScene: 'I', metadata: { dirty: false } };
}
export function cloneProgram<T>(state: T): T { return JSON.parse(JSON.stringify(state)) as T; }
export function serializeProgram(state: ProgramState): string { const copy = cloneProgram(state); copy.metadata.dirty = false; return JSON.stringify(copy); }
export function deserializeProgram(serialized: string): ProgramState { const parsed = JSON.parse(serialized) as ProgramState; if (parsed.version !== 1 || !parsed.layers || !parsed.effects) throw new Error('Invalid Program'); parsed.metadata = { dirty: false }; return parsed; }

export class ProgramStore {
  private currentState: ProgramState = createDefaultProgramState(); private savedState: ProgramState = cloneProgram(this.currentState);
  private history: ProgramState[] = []; private clipboard: unknown = null; private listeners = new Set<(state: ProgramState) => void>();
  readonly programs = new Map<string, string>([['01 Grand Piano', serializeProgram(this.currentState)]]); readonly presets = new Map<string, string>(); readonly liveSlots: Array<string|null> = Array(8).fill(null); private presetBackup: ProgramState|null = null;
  get state() { return this.currentState; } get dirty() { return this.currentState.metadata.dirty; }
  subscribe(listener: (state: ProgramState) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit() { this.listeners.forEach(listener => listener(this.currentState)); }
  private mutate(fn: (state: ProgramState) => void) { this.history.push(cloneProgram(this.currentState)); fn(this.currentState); this.currentState.metadata.dirty = true; this.emit(); }
  update(fn: (state: ProgramState) => void) { this.mutate(fn); }
  load(name: string) { const serialized = this.programs.get(name); if (!serialized) return false; this.history.push(cloneProgram(this.currentState)); this.currentState = deserializeProgram(serialized); this.savedState = cloneProgram(this.currentState); this.emit(); return true; }
  browse(delta: number) { const names = [...this.programs.keys()]; if (!names.length) return false; const index = Math.max(0, names.indexOf(this.currentState.name) + Math.sign(delta)); return this.load(names[Math.min(names.length - 1, index)]); }
  browsePreset(name: string) { const serialized = this.presets.get(name); if (!serialized) return false; this.presetBackup = cloneProgram(this.currentState); this.history.push(cloneProgram(this.currentState)); this.currentState = deserializeProgram(serialized); this.currentState.metadata.dirty = true; this.emit(); return true; }
  storePreset(name: string, section: 'Organ'|'Piano'|'Synth' = 'Piano') { const snapshot = cloneProgram(this.currentState); snapshot.category = section; this.presets.set(name, serializeProgram(snapshot)); return name; }
  cancelPreset() { if (!this.presetBackup) return; this.currentState = cloneProgram(this.presetBackup); this.currentState.metadata.dirty = false; this.presetBackup = null; this.emit(); }
  store(name = this.currentState.name) { this.currentState.name = name; this.programs.set(name, serializeProgram(this.currentState)); this.savedState = cloneProgram(this.currentState); this.currentState.metadata.dirty = false; this.emit(); return name; }
  storeAs(name: string, category = this.currentState.category) { this.currentState.name = name; this.currentState.category = category; return this.store(name); }
  cancel() { this.currentState = cloneProgram(this.savedState); this.currentState.metadata.dirty = false; this.emit(); }
  undo() { const previous = this.history.pop(); if (!previous) return false; this.currentState = previous; this.currentState.metadata.dirty = true; this.emit(); return true; }
  setListMode(mode: ListMode) { this.mutate(s => { s.listMode = mode; }); }
  setDisplayMode(mode: number) { this.mutate(s => { s.displayMode = Math.max(0, Math.min(3, mode)); }); }
  setBankPage(bank: number, page: number) { this.mutate(s => { s.bank = Math.max(1, Math.min(8, Math.round(bank))); s.page = Math.max(1, Math.min(8, Math.round(page))); }); }
  setLayer(id: LayerId, patch: Partial<LayerState>) { this.mutate(s => { s.layers[id] = { ...s.layers[id], ...patch }; const enabled = s.layers[id].enabled; const scene = s.scenes[s.activeScene]; if (enabled && !scene.includes(id)) scene.push(id); if (!enabled) s.scenes[s.activeScene] = scene.filter(layerId => layerId !== id); }); }
  setEffect(id: string, patch: Partial<EffectState>) { this.mutate(s => { if (s.effects[id]) s.effects[id] = { ...s.effects[id], ...patch, params: { ...s.effects[id].params, ...(patch.params ?? {}) } }; }); }
  editZone(point: SplitPoint, position: SplitPosition) { this.mutate(s => { s.zones[point.toLowerCase() as 'low'|'mid'|'high'] = position; }); }
  setCrossfade(width: 0|6|12) { this.mutate(s => { s.zones.crossfade = width; }); }
  setTranspose(semitones: number) { this.mutate(s => { s.routing.transpose = Math.max(-6, Math.min(6, Math.round(semitones))); }); }
  setMasterClock(bpm: number) { this.mutate(s => { s.routing.masterClock = Math.max(30, Math.min(300, Math.round(bpm))); }); }
  assignZone(id: LayerId, zones: number[]) { this.mutate(s => { s.layers[id].zone = [...new Set(zones.filter(z => z >= 0 && z < 4))]; }); }
  switchScene(scene: 'I'|'II') { this.mutate(s => { s.activeScene = scene; (Object.keys(s.layers) as LayerId[]).forEach(id => { s.layers[id].enabled = s.scenes[scene].includes(id); }); }); }
  assignMorph(source: MorphSource, destination: string, start: number, end: number, interpolation: 'linear'|'exponential' = 'linear') { this.mutate(s => { s.morphs = [...s.morphs.filter(m => !(m.source === source && m.destination === destination)), { source, destination, start, end, interpolation }]; }); }
  clearMorph(source: MorphSource, destination?: string) { this.mutate(s => { s.morphs = s.morphs.filter(m => m.source !== source || (destination && m.destination !== destination)); }); }
  applyMorph(source: MorphSource, value: number) { const v = Math.max(0, Math.min(1, value)); this.mutate(s => { s.morphs.forEach(m => { if (m.source !== source) return; const t = m.interpolation === 'exponential' ? v*v : v; const next = m.start + (m.end - m.start) * t; const [group, key, parameter] = m.destination.split('.'); if (group === 'layer' && s.layers[key as LayerId]) s.layers[key as LayerId].level = next; else if (group === 'effect' && s.effects[key]) { const param = parameter || 'amount'; s.effects[key].params[param] = next; } }); }); }
  setLive(slot: number, name = this.currentState.name) { if (slot < 1 || slot > 8) throw new Error('Live slot must be 1-8'); this.liveSlots[slot - 1] = name; }
  recallLive(slot: number) { const name = this.liveSlots[slot - 1]; return name ? this.load(name) : false; }
  copy(kind: 'Layer'|'Effect'|'Program'|'Morph') { this.clipboard = kind === 'Program' ? cloneProgram(this.currentState) : kind === 'Morph' ? [...this.currentState.morphs] : kind === 'Layer' ? cloneProgram(this.currentState.layers.pianoA) : cloneProgram(this.currentState.effects); }
  paste(kind: 'Layer'|'Effect'|'Program'|'Morph') { if (!this.clipboard) return false; this.mutate(s => { if (kind === 'Program') this.currentState = cloneProgram(this.clipboard as ProgramState); else if (kind === 'Morph') s.morphs = cloneProgram(this.clipboard as MorphAssignment[]); else if (kind === 'Layer') s.layers.pianoB = cloneProgram(this.clipboard as LayerState); else s.effects = cloneProgram(this.clipboard as Record<string, EffectState>); }); return true; }
}
