import {
  HardwareModel,
  Variant,
  Section,
  PianoState,
  ControlState,
} from '../types';

// Variant definitions from specs/nord-stage-4.variants.json
export const VARIANTS: Record<string, Variant> = {
  'stage-4-73': {
    id: 'stage-4-73',
    label: 'Stage 4 73',
    fullName: 'Nord Stage 4 73',
    keyCount: 73,
    whiteKeys: 43,
    blackKeys: 30,
    range: 'E to E',
    keyAction: 'hammer action',
    aspectRatio: 3.0951,
  },
};

// Section definitions from specs/nord-stage-4.visual.json
export const SECTION_CONFIG = [
  { id: 'performance', label: 'Performance controls', fraction: 0.13 },
  { id: 'organ', label: 'Organ', fraction: 0.21 },
  { id: 'piano', label: 'Piano', fraction: 0.15 },
  { id: 'program', label: 'Program and morph', fraction: 0.09 },
  { id: 'synth', label: 'Synth', fraction: 0.21 },
  { id: 'effects', label: 'Layer effects', fraction: 0.21 },
];

// Initialize piano state
export function createPianoState(): PianoState {
  return {
    enabled: true,
    activeLayers: ['A'],
    focusedLayer: 'A',
    selectedType: 'Grand',
    octaveShiftA: 0,
    octaveShiftB: 0,
    levelA: 0.8,
    levelB: 0.8,
    kbTouch: 'Medium',
    dynComp: 'Off',
    timbre: 'Off',
    unison: 'Off',
    softRelease: false,
    stringRes: false,
    sustainActive: false,
    sustainPedal: false,
    currentVoices: [],
    maxPolyphony: 32,
    loadingState: 'idle',
  };
}

// Control creation helpers
function createControl(
  section: string,
  id: string,
  label: string,
  type: ControlState['type'],
  initialValue: number = 0
): ControlState {
  return {
    id,
    type,
    section,
    label,
    value: initialValue,
  };
}

// Initialize sections with their controls
function initializeSections(): Section[] {
  const sections: Section[] = SECTION_CONFIG.map((config) => ({
    id: config.id,
    label: config.label,
    fraction: config.fraction,
    controls: [],
  }));

  // Performance section: master level, pitch stick, mod wheel
  const perfSection = sections.find((s) => s.id === 'performance')!;
  perfSection.controls = [
    createControl('performance', 'master-level', 'Master Level', 'knob', 0.8),
    createControl('performance', 'pitch-stick', 'Pitch Stick', 'wheel', 0),
    createControl(
      'performance',
      'mod-wheel',
      'Modulation Wheel',
      'wheel',
      0
    ),
  ];

  // Organ section: drawbars, controls
  const organSection = sections.find((s) => s.id === 'organ')!;
  organSection.controls = [
    // 9 drawbars
    createControl('organ', 'drawbar-1', 'Drawbar 1', 'drawbar', 0.5),
    createControl('organ', 'drawbar-2', 'Drawbar 2', 'drawbar', 0.5),
    createControl('organ', 'drawbar-3', 'Drawbar 3', 'drawbar', 0.5),
    createControl('organ', 'drawbar-4', 'Drawbar 4', 'drawbar', 0.5),
    createControl('organ', 'drawbar-5', 'Drawbar 5', 'drawbar', 0.5),
    createControl('organ', 'drawbar-6', 'Drawbar 6', 'drawbar', 0.5),
    createControl('organ', 'drawbar-7', 'Drawbar 7', 'drawbar', 0.5),
    createControl('organ', 'drawbar-8', 'Drawbar 8', 'drawbar', 0.5),
    createControl('organ', 'drawbar-9', 'Drawbar 9', 'drawbar', 0.5),
    // Model switches
    createControl('organ', 'organ-model', 'Organ Model', 'button'),
    createControl('organ', 'percussion', 'Percussion', 'button'),
    createControl('organ', 'vibrato', 'Vibrato/Chorus', 'knob', 0.5),
  ];

  // Piano section: type selector, layer controls
  const pianoSection = sections.find((s) => s.id === 'piano')!;
  pianoSection.controls = [
    createControl('piano', 'piano-type', 'Piano Type', 'button'),
    createControl('piano', 'layer-a-enable', 'Layer A Enable', 'button', 1),
    createControl('piano', 'layer-b-enable', 'Layer B Enable', 'button'),
    createControl('piano', 'layer-focus', 'Layer Focus', 'button'),
    createControl('piano', 'layer-a-level', 'Layer A Level', 'fader', 0.8),
    createControl('piano', 'layer-b-level', 'Layer B Level', 'fader', 0.8),
    createControl(
      'piano',
      'layer-a-octave',
      'Layer A Octave',
      'knob',
      0.5
    ),
    createControl(
      'piano',
      'layer-b-octave',
      'Layer B Octave',
      'knob',
      0.5
    ),
    createControl('piano', 'kb-touch', 'KB Touch', 'knob', 0.5),
    createControl('piano', 'dyn-comp', 'Dyn Comp', 'knob'),
    createControl('piano', 'timbre', 'Timbre', 'knob', 0.5),
    createControl('piano', 'unison', 'Unison', 'knob'),
    createControl('piano', 'soft-release', 'Soft Release', 'button'),
    createControl('piano', 'string-res', 'String Res', 'button'),
  ];

  // Program section: display, dial, buttons
  const programSection = sections.find((s) => s.id === 'program')!;
  programSection.controls = [
    createControl('program', 'program-display', 'Program OLED', 'button'),
    createControl('program', 'program-dial', 'Program Dial', 'encoder'),
    createControl('program', 'program-1', 'Program 1', 'button'),
    createControl('program', 'program-2', 'Program 2', 'button'),
    createControl('program', 'program-3', 'Program 3', 'button'),
    createControl('program', 'program-4', 'Program 4', 'button'),
    createControl('program', 'program-5', 'Program 5', 'button'),
    createControl('program', 'program-6', 'Program 6', 'button'),
    createControl('program', 'program-7', 'Program 7', 'button'),
    createControl('program', 'program-8', 'Program 8', 'button'),
    createControl('program', 'page-up', 'Page Up', 'button'),
    createControl('program', 'page-down', 'Page Down', 'button'),
    createControl('program', 'live-mode', 'Live Mode', 'button'),
    createControl('program', 'layer-scene', 'Layer Scene', 'button'),
    createControl('program', 'store', 'Store', 'button'),
    createControl('program', 'split', 'Split', 'button'),
  ];

  // Synth section: oscillators, filters, envelopes
  const synthSection = sections.find((s) => s.id === 'synth')!;
  synthSection.controls = [
    createControl('synth', 'synth-display', 'Synth OLED', 'button'),
    createControl('synth', 'layer-a-enable', 'Layer A Enable', 'button', 1),
    createControl('synth', 'layer-b-enable', 'Layer B Enable', 'button'),
    createControl('synth', 'layer-c-enable', 'Layer C Enable', 'button'),
    createControl('synth', 'osc-1-waveform', 'Osc 1 Waveform', 'knob'),
    createControl('synth', 'osc-1-octave', 'Osc 1 Octave', 'knob', 0.5),
    createControl('synth', 'osc-1-pitch', 'Osc 1 Pitch', 'knob', 0.5),
    createControl('synth', 'filter-type', 'Filter Type', 'knob'),
    createControl('synth', 'filter-freq', 'Filter Frequency', 'fader', 1),
    createControl('synth', 'filter-res', 'Filter Resonance', 'knob'),
    createControl('synth', 'filter-drive', 'Filter Drive', 'knob'),
    createControl('synth', 'env-attack', 'Envelope Attack', 'knob'),
    createControl('synth', 'env-decay', 'Envelope Decay', 'knob', 0.5),
    createControl('synth', 'env-sustain', 'Envelope Sustain', 'fader', 1),
    createControl('synth', 'env-release', 'Envelope Release', 'knob', 0.5),
    createControl('synth', 'lfo-rate', 'LFO Rate', 'knob', 0.5),
    createControl('synth', 'lfo-amount', 'LFO Amount', 'knob'),
    createControl('synth', 'voice-mode', 'Voice Mode', 'knob'),
  ];

  // Effects section: unit selectors, controls
  const effectsSection = sections.find((s) => s.id === 'effects')!;
  effectsSection.controls = [
    createControl('effects', 'layer-focus', 'Layer Focus', 'button'),
    createControl('effects', 'group-toggle', 'Group Toggle', 'button'),
    createControl('effects', 'global-mode', 'Global Mode', 'button'),
    createControl('effects', 'effect-1-type', 'Effect 1', 'knob'),
    createControl('effects', 'effect-1-bypass', 'Effect 1 Bypass', 'button'),
    createControl('effects', 'effect-1-param-1', 'Effect 1 Param 1', 'fader', 0.5),
    createControl('effects', 'effect-2-type', 'Effect 2', 'knob'),
    createControl('effects', 'effect-2-bypass', 'Effect 2 Bypass', 'button'),
    createControl('effects', 'effect-2-param-1', 'Effect 2 Param 1', 'fader', 0.5),
    createControl('effects', 'delay-time', 'Delay Time', 'knob', 0.5),
    createControl('effects', 'delay-feedback', 'Delay Feedback', 'knob', 0.3),
    createControl('effects', 'all-effects-bypass', 'All Bypass', 'button'),
  ];

  return sections;
}

// Create the complete hardware model
export function createHardwareModel(variantId: string = 'stage-4-73'): HardwareModel {
  const variant = VARIANTS[variantId];
  if (!variant) {
    throw new Error(`Unknown variant: ${variantId}`);
  }

  return {
    variant,
    sections: initializeSections(),
    piano: createPianoState(),
    sustainPedalDown: false,
    pitchStickBend: 0,
    modWheelValue: 0,
    masterLevel: 0.8,
  };
}
