import { ProgramState, PianoState, OrganState, SynthState, SplitState, SceneState, MorphState, MasterClockState } from '../types';

// Factory programs demonstrating different capabilities
export const FACTORY_PROGRAMS: ProgramState[] = [
  {
    name: 'Grand Piano',
    number: 0,
    isLive: false,
    isDirty: false,
    piano: createDefaultPianoState(),
    organ: createDefaultOrganState(),
    synth: createDefaultSynthState(),
    effects: createDefaultEffectsState(),
    splits: createDefaultSplitState(),
    scenes: createDefaultSceneState(),
    morphs: createDefaultMorphState(),
    masterClock: createDefaultMasterClockState(),
    transpose: 0,
  },
  {
    name: 'B3 Organ',
    number: 1,
    isLive: false,
    isDirty: false,
    piano: { ...createDefaultPianoState(), enabled: false },
    organ: {
      ...createDefaultOrganState(),
      enabled: true,
      activeLayers: ['A'],
      focusedLayer: 'A',
      layerA: {
        ...createDefaultOrganState().layerA,
        enabled: true,
        model: 'B3',
        drawbars: [7, 6, 7, 6, 5, 4, 3, 2, 1], // Classic B3 registration
        vibratoChorus: 'V2',
        keyClickEnabled: true,
      },
    },
    synth: { ...createDefaultSynthState(), enabled: false },
    effects: createDefaultEffectsState(),
    splits: createDefaultSplitState(),
    scenes: createDefaultSceneState(),
    morphs: createDefaultMorphState(),
    masterClock: createDefaultMasterClockState(),
    transpose: 0,
  },
  {
    name: 'Synth Lead',
    number: 2,
    isLive: false,
    isDirty: false,
    piano: { ...createDefaultPianoState(), enabled: false },
    organ: { ...createDefaultOrganState(), enabled: false },
    synth: {
      ...createDefaultSynthState(),
      enabled: true,
      activeLayers: ['A'],
      focusedLayer: 'A',
      layerA: {
        ...createDefaultSynthState().layerA,
        enabled: true,
        waveform: 'Saw',
        filterType: 'LP24',
        filterFreq: 0.6,
        filterRes: 0.7,
      },
    },
    effects: createDefaultEffectsState(),
    splits: createDefaultSplitState(),
    scenes: createDefaultSceneState(),
    morphs: createDefaultMorphState(),
    masterClock: createDefaultMasterClockState(),
    transpose: 0,
  },
  {
    name: 'Split Piano/Organ',
    number: 3,
    isLive: false,
    isDirty: false,
    piano: createDefaultPianoState(),
    organ: createDefaultOrganState(),
    synth: { ...createDefaultSynthState(), enabled: false },
    effects: createDefaultEffectsState(),
    splits: {
      enabled: true,
      zones: [
        {
          id: 'zone-lower',
          name: 'Lower',
          noteRange: [21, 59],
          pianoLayers: [],
          organLayers: ['A', 'B'],
          synthLayers: [],
          crossfadeAmountStart: 0,
          crossfadeAmountEnd: 0,
        },
        {
          id: 'zone-upper',
          name: 'Upper',
          noteRange: [60, 108],
          pianoLayers: ['A', 'B'],
          organLayers: [],
          synthLayers: [],
          crossfadeAmountStart: 0,
          crossfadeAmountEnd: 0,
        },
      ],
      splitPoints: { low: 60 },
      crossfade: { lowMid: 0 },
    },
    scenes: createDefaultSceneState(),
    morphs: createDefaultMorphState(),
    masterClock: createDefaultMasterClockState(),
    transpose: 0,
  },
];

// Default factory program (all sections enabled)
export function createDefaultProgramState(number: number = 0, isLive: boolean = false): ProgramState {
  return {
    name: `Program ${number + 1}`,
    number,
    isLive,
    isDirty: false,
    piano: createDefaultPianoState(),
    organ: createDefaultOrganState(),
    synth: createDefaultSynthState(),
    effects: createDefaultEffectsState(),
    splits: createDefaultSplitState(),
    scenes: createDefaultSceneState(),
    morphs: createDefaultMorphState(),
    masterClock: createDefaultMasterClockState(),
    transpose: 0,
  };
}

function createDefaultPianoState(): PianoState {
  return {
    enabled: true,
    activeLayers: ['A'],
    focusedLayer: 'A',
    selectedType: 'Grand',
    octaveShiftA: 0,
    octaveShiftB: 0,
    levelA: 0.7,
    levelB: 0.7,
    kbTouch: 'Medium',
    dynComp: 'Off',
    timbre: 'Mid',
    unison: 'Off',
    softRelease: false,
    stringRes: false,
    sustainActive: false,
    sustainPedal: false,
    currentVoices: [],
    maxPolyphony: 12,
    loadingState: 'idle',
  };
}

function createDefaultOrganState(): OrganState {
  return {
    enabled: true,
    activeLayers: ['A'],
    focusedLayer: 'A',
    layerA: {
      enabled: true,
      model: 'B3',
      level: 0.7,
      octaveShift: 0,
      drawbars: [5, 4, 5, 4, 3, 2, 1, 0, 0],
      vibratoChorus: 'Off',
      percussionEnabled: false,
      percussionSoft: false,
      percussionDecayFast: false,
      percussionHarmonicThird: false,
      keyClickEnabled: false,
      rotaryEnabled: false,
      rotarySpeed: 'Stop',
    },
    layerB: {
      enabled: false,
      model: 'Vox',
      level: 0.7,
      octaveShift: 0,
      drawbars: [4, 3, 4, 3, 2, 1, 0, 0, 0],
      vibratoChorus: 'Off',
      percussionEnabled: false,
      percussionSoft: false,
      percussionDecayFast: false,
      percussionHarmonicThird: false,
      keyClickEnabled: false,
      rotaryEnabled: false,
      rotarySpeed: 'Stop',
    },
  };
}

function createDefaultSynthState(): SynthState {
  return {
    enabled: true,
    activeLayers: ['A'],
    focusedLayer: 'A',
    layerA: createDefaultSynthLayerState(),
    layerB: {
      ...createDefaultSynthLayerState(),
      enabled: false,
    },
    layerC: {
      ...createDefaultSynthLayerState(),
      enabled: false,
    },
  };
}

function createDefaultSynthLayerState() {
  return {
    enabled: true,
    level: 0.7,
    octaveShift: 0,
    waveform: 'Sine' as const,
    oscCtrl: 0,
    oscPitchCoarse: 0,
    oscPitchFine: 0,
    filterType: 'LP24' as const,
    filterFreq: 1,
    filterRes: 0,
    filterTracking: 'Off' as const,
    filterDrive: 'Off' as const,
    filterEnvAmount: 0,
    oscEnvelope: { attack: 0.01, decay: 0.2, release: 0.1, velocityEnabled: false },
    filterEnvelope: { attack: 0.01, decay: 0.3, release: 0.2, velocityEnabled: false },
    ampEnvelope: { attack: 0.01, decay: 0.1, release: 0.05, velocityEnabled: true },
    lfoWaveform: 'Triangle' as const,
    lfoRate: 0.2,
    lfoModAmount: 0,
    lfoDestinations: [],
    voiceMode: 'Poly' as const,
    priority: 'Off' as const,
    glideRate: 0,
    unison: 'Off' as const,
    vibrato: { mode: 'On' as const, rate: 5, amount: 0 },
    arpMode: 'Poly' as const,
    arpRate: 0.5,
    arpRange: 1,
    arpDirection: 'Up' as const,
    arpKbHold: false,
    arpRun: false,
  };
}

function createDefaultEffectsState() {
  return {
    mod1: { enabled: false, type: 'Flanger', dryWet: 0.5 },
    mod2: { enabled: false, type: 'Phaser', dryWet: 0.5 },
    delay: { enabled: false, type: 'Delay', dryWet: 0.3, tempo: 0.5, feedback: 0.4 },
    ampSim: { enabled: false, type: 'Amp Sim', dryWet: 1 },
    compressor: { enabled: false, type: 'Compressor', dryWet: 1 },
    reverb: { enabled: true, type: 'Reverb', dryWet: 0.3, size: 0.5 },
    rotary: {
      enabled: false,
      speed: 'Stop' as const,
      routedToOrgan: false,
      routedToPiano: false,
      routedToSynth: false,
    },
  };
}

function createDefaultSplitState(): SplitState {
  return {
    enabled: false,
    zones: [],
    splitPoints: {},
    crossfade: {},
  };
}

function createDefaultSceneState(): SceneState {
  return {
    sceneI: {
      pianoEnabled: true,
      organLayerAEnabled: true,
      organLayerBEnabled: false,
      synthLayerAEnabled: true,
      synthLayerBEnabled: false,
      synthLayerCEnabled: false,
    },
    sceneII: {
      pianoEnabled: false,
      organLayerAEnabled: true,
      organLayerBEnabled: true,
      synthLayerAEnabled: false,
      synthLayerBEnabled: false,
      synthLayerCEnabled: false,
    },
    currentScene: 'I',
  };
}

function createDefaultMorphState(): MorphState {
  return {
    wheel: {
      isRecording: false,
      destinations: [],
    },
    controlPedal: {
      isRecording: false,
      destinations: [],
    },
    wheelValue: 0,
    controlPedalValue: 0,
  };
}

function createDefaultMasterClockState(): MasterClockState {
  return {
    bpm: 120,
    synced: true,
    running: false,
  };
}

// Program storage manager
export class ProgramStore {
  private programs: ProgramState[] = [];
  private liveSlots: ProgramState[] = [];

  constructor() {
    // Initialize with factory programs + empty slots
    this.programs = [
      ...FACTORY_PROGRAMS,
      ...Array.from({ length: 32 - FACTORY_PROGRAMS.length }, (_, i) =>
        createDefaultProgramState(FACTORY_PROGRAMS.length + i)
      ),
    ];

    // Initialize live slots
    this.liveSlots = Array.from({ length: 8 }, (_, i) => ({
      ...createDefaultProgramState(i, true),
      isLive: true,
    }));

    // Try to load from localStorage
    this.loadFromStorage();
  }

  getProgram(number: number, isLive: boolean = false): ProgramState {
    const slots = isLive ? this.liveSlots : this.programs;
    if (number < 0 || number >= slots.length) {
      return createDefaultProgramState(number, isLive);
    }
    return slots[number];
  }

  getAllPrograms(): ProgramState[] {
    return [...this.programs];
  }

  getLiveSlots(): ProgramState[] {
    return [...this.liveSlots];
  }

  saveProgram(program: ProgramState): void {
    const slots = program.isLive ? this.liveSlots : this.programs;
    if (program.number >= 0 && program.number < slots.length) {
      slots[program.number] = { ...program, isDirty: false };
      this.saveToStorage();
    }
  }

  setDirty(number: number, isLive: boolean = false): void {
    const slots = isLive ? this.liveSlots : this.programs;
    if (number >= 0 && number < slots.length) {
      slots[number].isDirty = true;
    }
  }

  discardChanges(number: number, isLive: boolean = false): void {
    const slots = isLive ? this.liveSlots : this.programs;
    if (number >= 0 && number < slots.length) {
      slots[number].isDirty = false;
    }
  }

  private saveToStorage(): void {
    try {
      const data = {
        programs: this.programs,
        liveSlots: this.liveSlots,
      };
      localStorage.setItem('stagebench-programs', JSON.stringify(data));
    } catch (error) {
      console.warn('Failed to save programs to localStorage:', error);
    }
  }

  private loadFromStorage(): void {
    try {
      const data = localStorage.getItem('stagebench-programs');
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed.programs) {
          this.programs = parsed.programs;
        }
        if (parsed.liveSlots) {
          this.liveSlots = parsed.liveSlots;
        }
      }
    } catch (error) {
      console.warn('Failed to load programs from localStorage:', error);
    }
  }

  clearStorage(): void {
    localStorage.removeItem('stagebench-programs');
  }
}
