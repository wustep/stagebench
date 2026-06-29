import { createInitialEffectRack, patchEffectRack, type EffectId, type EffectRackState, type EffectSection } from './effects';
import { initialPianoState, type PianoState } from './pianoState';

export type ProgramViewMode = 'performance' | 'edit' | 'split' | 'morph';
export type ProgramListMode = 'Numeric' | 'Alphabetic' | 'Category';
export type SplitName = 'Low' | 'Mid' | 'High';
export type SplitPosition = 'Off' | 'C2' | 'F2' | 'C3' | 'F3' | 'C4' | 'F4' | 'C5' | 'F5' | 'C6' | 'F6' | 'C7';
export type CrossfadeWidth = 0 | 6 | 12;
export type LayerId = 'organA' | 'pianoA' | 'pianoB' | 'synthA' | 'synthB' | 'synthC';
export type MorphSource = 'Wheel' | 'Aftertouch' | 'Control Pedal';

export const SPLIT_POSITIONS: SplitPosition[] = ['Off', 'C2', 'F2', 'C3', 'F3', 'C4', 'F4', 'C5', 'F5', 'C6', 'F6', 'C7'];
export const ZONE_NAMES = ['Zone 1', 'Zone 2', 'Zone 3', 'Zone 4'];
export const MORPH_SOURCES: MorphSource[] = ['Wheel', 'Aftertouch', 'Control Pedal'];

export interface ProgramMeta {
  number: string;
  name: string;
  category: string;
  bank: 'A' | 'B' | 'C' | 'D';
  page: number;
  dirty: boolean;
  viewMode: ProgramViewMode;
  listMode: ProgramListMode;
}

export interface LayerState {
  enabled: boolean;
  focused: boolean;
  level: number;
  zones: number[];
  source: 'Organ' | 'Piano' | 'Synth';
}

export interface SplitState {
  enabled: boolean;
  points: Record<SplitName, SplitPosition>;
  crossfades: Record<SplitName, CrossfadeWidth>;
  selected: SplitName;
}

export interface MorphAssignment {
  source: MorphSource;
  destination: string;
  start: number;
  end: number;
}

export interface ProgramState {
  version: 1;
  meta: ProgramMeta;
  piano: PianoState;
  layers: Record<LayerId, LayerState>;
  splits: SplitState;
  scenes: { active: 'I' | 'II'; I: LayerId[]; II: LayerId[] };
  morphs: Record<MorphSource, MorphAssignment[]>;
  effects: EffectRackState;
  routing: { focus: EffectSection; groupMode: boolean; allBypass: boolean; masterClock: number; transpose: number };
  liveSlots: Array<{ name: string; program: string }>;
  storedPrograms: Array<{ number: string; name: string; category: string }>;
  history: ProgramState[];
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function createInitialProgramState(piano: PianoState = initialPianoState): ProgramState {
  return {
    version: 1,
    meta: { number: 'A:11', name: 'Stage 4', category: 'Piano', bank: 'A', page: 1, dirty: false, viewMode: 'performance', listMode: 'Numeric' },
    piano: clone(piano),
    layers: {
      organA: { enabled: false, focused: false, level: 0.55, zones: [0, 1, 2, 3], source: 'Organ' },
      pianoA: { enabled: piano.layerA.enabled, focused: piano.layerA.focused, level: piano.layerA.level, zones: [0, 1, 2, 3], source: 'Piano' },
      pianoB: { enabled: piano.layerB.enabled, focused: piano.layerB.focused, level: piano.layerB.level, zones: [0, 1, 2, 3], source: 'Piano' },
      synthA: { enabled: false, focused: false, level: 0.55, zones: [0, 1, 2, 3], source: 'Synth' },
      synthB: { enabled: false, focused: false, level: 0.55, zones: [0, 1, 2, 3], source: 'Synth' },
      synthC: { enabled: false, focused: false, level: 0.55, zones: [0, 1, 2, 3], source: 'Synth' },
    },
    splits: { enabled: false, points: { Low: 'C3', Mid: 'C4', High: 'C5' }, crossfades: { Low: 0, Mid: 0, High: 0 }, selected: 'Low' },
    scenes: { active: 'I', I: ['pianoA'], II: ['pianoA', 'pianoB'] },
    morphs: { Wheel: [], Aftertouch: [], 'Control Pedal': [] },
    effects: createInitialEffectRack(),
    routing: { focus: 'Piano', groupMode: false, allBypass: false, masterClock: 120, transpose: 0 },
    liveSlots: Array.from({ length: 8 }, (_, index) => ({ name: `Live ${index + 1}`, program: 'A:11' })),
    storedPrograms: [{ number: 'A:11', name: 'Stage 4', category: 'Piano' }],
    history: [],
  };
}

export function serializableProgram(state: ProgramState): Omit<ProgramState, 'history'> {
  const serializable = clone(state) as Partial<ProgramState>;
  delete serializable.history;
  return serializable as Omit<ProgramState, 'history'>;
}

export function serializeProgram(state: ProgramState): string {
  return JSON.stringify(serializableProgram(state));
}

export function deserializeProgram(serialized: string): ProgramState {
  const parsed = JSON.parse(serialized) as Omit<ProgramState, 'history'>;
  if (parsed.version !== 1 || !parsed.meta || !parsed.piano || !parsed.effects || !parsed.splits || !parsed.morphs) throw new Error('Invalid Stage 4 Program');
  return { ...parsed, history: [] };
}

export type ProgramAction =
  | { type: 'edit'; patch: Partial<ProgramState> }
  | { type: 'rename'; name: string; category?: string }
  | { type: 'store' | 'store-as'; number?: string }
  | { type: 'load'; program: ProgramState }
  | { type: 'cancel' | 'undo' }
  | { type: 'live'; slot: number }
  | { type: 'set-view'; value: ProgramViewMode }
  | { type: 'set-list'; value: ProgramListMode }
  | { type: 'split-enabled'; value: boolean }
  | { type: 'split-point'; point: SplitName; value: SplitPosition }
  | { type: 'crossfade'; point: SplitName; value: CrossfadeWidth }
  | { type: 'zone'; layer: LayerId; zone: number; enabled: boolean }
  | { type: 'scene'; scene: 'I' | 'II' }
  | { type: 'morph-assign'; source: MorphSource; destination: string; start: number; end: number }
  | { type: 'morph-clear'; source: MorphSource; destination?: string }
  | { type: 'morph-copy'; source: MorphSource; destination: MorphSource }
  | { type: 'morph-source'; source: MorphSource; value: number }
  | { type: 'focus'; value: EffectSection }
  | { type: 'effect'; id: EffectId; patch: Partial<EffectRackState[EffectId]> }
  | { type: 'all-effects'; enabled: boolean };

function commit(state: ProgramState, next: ProgramState): ProgramState {
  return { ...next, meta: { ...next.meta, dirty: true }, history: [...state.history, serializableProgram(state) as ProgramState].slice(-20) };
}

export function reduceProgramState(state: ProgramState, action: ProgramAction): ProgramState {
  switch (action.type) {
    case 'edit': return commit(state, { ...state, ...action.patch });
    case 'rename': return commit(state, { ...state, meta: { ...state.meta, name: action.name || 'Untitled', category: action.category ?? state.meta.category } });
    case 'store':
      return { ...state, meta: { ...state.meta, dirty: false }, storedPrograms: state.storedPrograms.some((item) => item.number === state.meta.number) ? state.storedPrograms.map((item) => item.number === state.meta.number ? { number: state.meta.number, name: state.meta.name, category: state.meta.category } : item) : [...state.storedPrograms, { number: state.meta.number, name: state.meta.name, category: state.meta.category }], history: [] };
    case 'store-as': {
      const number = action.number ?? state.meta.number;
      return reduceProgramState({ ...state, meta: { ...state.meta, number } }, { type: 'store' });
    }
    case 'load': return { ...clone(action.program), meta: { ...action.program.meta, dirty: false }, history: [] };
    case 'cancel': return state.history[0] ? { ...clone(state.history[0]), meta: { ...state.history[0].meta, dirty: false }, history: [] } : state;
    case 'undo': { const previous = state.history[state.history.length - 1]; return previous ? { ...clone(previous), history: state.history.slice(0, -1), meta: { ...previous.meta, dirty: true } } : state; }
    case 'live': {
      const slot = Math.max(0, Math.min(7, action.slot));
      return { ...state, meta: { ...state.meta, name: state.liveSlots[slot].name, number: `LIVE ${slot + 1}`, dirty: false }, history: [] };
    }
    case 'set-view': return commit(state, { ...state, meta: { ...state.meta, viewMode: action.value } });
    case 'set-list': return commit(state, { ...state, meta: { ...state.meta, listMode: action.value } });
    case 'split-enabled': return commit(state, { ...state, splits: { ...state.splits, enabled: action.value } });
    case 'split-point': return commit(state, { ...state, splits: { ...state.splits, points: { ...state.splits.points, [action.point]: action.value }, selected: action.point } });
    case 'crossfade': return commit(state, { ...state, splits: { ...state.splits, crossfades: { ...state.splits.crossfades, [action.point]: action.value }, selected: action.point } });
    case 'zone': {
      const current = state.layers[action.layer].zones;
      const zones = action.enabled ? [...new Set([...current, action.zone])].sort() : current.filter((zone) => zone !== action.zone);
      return commit(state, { ...state, layers: { ...state.layers, [action.layer]: { ...state.layers[action.layer], zones } } });
    }
    case 'scene': return commit(state, { ...state, scenes: { ...state.scenes, active: action.scene } });
    case 'morph-assign': {
      const assignments = state.morphs[action.source].filter((item) => item.destination !== action.destination);
      return commit(state, { ...state, morphs: { ...state.morphs, [action.source]: [...assignments, { source: action.source, destination: action.destination, start: action.start, end: action.end }] } });
    }
    case 'morph-clear': return commit(state, { ...state, morphs: { ...state.morphs, [action.source]: action.destination ? state.morphs[action.source].filter((item) => item.destination !== action.destination) : [] } });
    case 'morph-copy': return commit(state, { ...state, morphs: { ...state.morphs, [action.destination]: clone(state.morphs[action.source]).map((item) => ({ ...item, source: action.destination })) } });
    case 'morph-source': return state;
    case 'focus': return commit(state, { ...state, routing: { ...state.routing, focus: action.value } });
    case 'effect': return commit(state, { ...state, effects: patchEffectRack(state.effects, action.id, action.patch) });
    case 'all-effects': return commit(state, { ...state, routing: { ...state.routing, allBypass: !action.enabled }, effects: Object.fromEntries(Object.entries(state.effects).map(([id, unit]) => [id, { ...unit, enabled: action.enabled }])) as EffectRackState });
    default: return state;
  }
}

export function morphValue(state: ProgramState, source: MorphSource, destination: string, input: number): number | undefined {
  const assignment = state.morphs[source].find((item) => item.destination === destination);
  if (!assignment) return undefined;
  return assignment.start + (assignment.end - assignment.start) * Math.max(0, Math.min(1, input));
}
