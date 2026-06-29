export type PianoType = 'Grand' | 'Upright' | 'Electric' | 'Clav' | 'Digital' | 'Misc';
export type TouchCurve = 'Heavy' | 'Medium' | 'Light';
export type Timbre = 'Off' | 'Soft' | 'Mid' | 'Bright' | 'Dyno 1' | 'Dyno 2';

export interface PianoLayerState {
  enabled: boolean;
  focused: boolean;
  level: number;
  octave: number;
  zone: 'full' | 'low' | 'mid' | 'high';
}

export interface PianoState {
  on: boolean;
  type: PianoType;
  model: string;
  touch: TouchCurve;
  dynamicCompression: 0 | 1 | 2 | 3;
  timbre: Timbre;
  unison: 0 | 1 | 2 | 3;
  softRelease: boolean;
  stringResonance: boolean;
  sustain: boolean;
  halfPedal: number;
  sostenuto: boolean;
  softPedal: boolean;
  listMode: 'Num' | 'Abc' | 'Cat';
  modelAvailable: boolean;
  layerA: PianoLayerState;
  layerB: PianoLayerState;
}

export const initialPianoState: PianoState = {
  on: true,
  type: 'Grand',
  model: 'A4 Concert Grand',
  touch: 'Medium',
  dynamicCompression: 0,
  timbre: 'Off',
  unison: 0,
  softRelease: false,
  stringResonance: true,
  sustain: false,
  halfPedal: 0,
  sostenuto: false,
  softPedal: false,
  listMode: 'Num',
  modelAvailable: true,
  layerA: { enabled: true, focused: true, level: 0.78, octave: 0, zone: 'full' },
  layerB: { enabled: false, focused: false, level: 0.62, octave: 0, zone: 'full' },
};

export type PianoAction =
  | { type: 'toggle-on' }
  | { type: 'focus-layer'; layer: 'A' | 'B' }
  | { type: 'toggle-layer'; layer: 'A' | 'B' }
  | { type: 'set-layer-level'; layer: 'A' | 'B'; value: number }
  | { type: 'set-type'; value: PianoType }
  | { type: 'set-model'; value: string; available?: boolean }
  | { type: 'set-touch'; value: TouchCurve }
  | { type: 'set-dynamic-compression'; value: 0 | 1 | 2 | 3 }
  | { type: 'set-timbre'; value: Timbre }
  | { type: 'set-unison'; value: 0 | 1 | 2 | 3 }
  | { type: 'toggle'; key: 'softRelease' | 'stringResonance' | 'sustain' | 'sostenuto' | 'softPedal' }
  | { type: 'set-half-pedal'; value: number }
  | { type: 'set-list-mode'; value: 'Num' | 'Abc' | 'Cat' };

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

function withFocusedLayer(state: PianoState, layer: 'A' | 'B'): PianoState {
  return {
    ...state,
    layerA: { ...state.layerA, focused: layer === 'A' },
    layerB: { ...state.layerB, focused: layer === 'B' },
  };
}

export function reducePianoState(state: PianoState, action: PianoAction): PianoState {
  switch (action.type) {
    case 'toggle-on':
      return { ...state, on: !state.on };
    case 'focus-layer':
      return withFocusedLayer(state, action.layer);
    case 'toggle-layer': {
      const key = action.layer === 'A' ? 'layerA' : 'layerB';
      const next = { ...state, [key]: { ...state[key], enabled: !state[key].enabled } } as PianoState;
      return next[key].enabled ? withFocusedLayer(next, action.layer) : next;
    }
    case 'set-layer-level': {
      const key = action.layer === 'A' ? 'layerA' : 'layerB';
      return { ...state, [key]: { ...state[key], level: clamp(action.value) } } as PianoState;
    }
    case 'set-type':
      return { ...state, type: action.value, model: `${action.value} ${action.value === 'Grand' ? 'A4 Concert Grand' : 'Studio Model'}`, modelAvailable: true };
    case 'set-model':
      return { ...state, model: action.value, modelAvailable: action.available ?? true };
    case 'set-touch':
      return { ...state, touch: action.value };
    case 'set-dynamic-compression':
      return { ...state, dynamicCompression: action.value };
    case 'set-timbre':
      return { ...state, timbre: action.value };
    case 'set-unison':
      return { ...state, unison: action.value };
    case 'toggle':
      return { ...state, [action.key]: !state[action.key] } as PianoState;
    case 'set-half-pedal':
      return { ...state, halfPedal: clamp(action.value) };
    case 'set-list-mode':
      return { ...state, listMode: action.value };
    default:
      return state;
  }
}

export function touchVelocity(touch: TouchCurve, rawVelocity: number): number {
  const input = clamp(rawVelocity, 0.05, 1);
  if (touch === 'Heavy') return clamp(Math.pow(input, 1.35));
  if (touch === 'Light') return clamp(Math.pow(input, 0.75));
  return input;
}

export function compressionGain(level: 0 | 1 | 2 | 3, velocity: number): number {
  const floor = level / 12;
  return floor + (1 - floor) * clamp(velocity);
}

export function timbreProfile(type: PianoType, timbre: Timbre): { low: number; mid: number; high: number } {
  if (type === 'Electric' && timbre === 'Dyno 2') return { low: 1.12, mid: 0.72, high: 1.26 };
  if (timbre === 'Soft') return { low: 1.12, mid: 1, high: 0.68 };
  if (timbre === 'Mid') return { low: 0.84, mid: 1.18, high: 0.86 };
  if (timbre === 'Bright' || timbre === 'Dyno 1') return { low: 0.86, mid: 1, high: 1.22 };
  return { low: 1, mid: 1, high: 1 };
}

