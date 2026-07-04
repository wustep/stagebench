import { ProgramState, PianoState, OrganState, SynthState } from '../types';

// Create a default Organ state
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
      keyClickEnabled: false,
    },
    layerB: {
      enabled: false,
      model: 'Vox',
      level: 0.7,
      octaveShift: 0,
      drawbars: [4, 3, 4, 3, 2, 1, 0, 0, 0],
      vibratoChorus: 'Off',
      percussionEnabled: false,
      keyClickEnabled: false,
    },
  };
}

// Create a default Synth state
function createDefaultSynthState(): SynthState {
  return {
    enabled: true,
    activeLayers: ['A'],
    focusedLayer: 'A',
    layerA: {
      enabled: true,
      level: 0.7,
      octaveShift: 0,
      waveform: 'Sine',
      filterFreq: 1,
      filterRes: 0,
      voiceMode: 'Poly',
    },
    layerB: {
      enabled: false,
      level: 0.7,
      octaveShift: 0,
      waveform: 'Saw',
      filterFreq: 0.6,
      filterRes: 0.5,
      voiceMode: 'Poly',
    },
    layerC: {
      enabled: false,
      level: 0.5,
      octaveShift: 12,
      waveform: 'Square',
      filterFreq: 0.8,
      filterRes: 0.3,
      voiceMode: 'Mono',
    },
  };
}

// Create a default program
export function createDefaultProgram(number: number, isLive: boolean = false): ProgramState {
  return {
    name: `Program ${number + 1}`,
    number,
    isLive,
    isDirty: false,
    piano: {
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
    },
    organ: createDefaultOrganState(),
    synth: createDefaultSynthState(),
    transpose: 0,
    masterClock: { bpm: 120 },
  };
}

// Factory programs
export const FACTORY_PROGRAMS: ProgramState[] = [
  {
    ...createDefaultProgram(0),
    name: 'Grand Piano',
    organ: { ...createDefaultOrganState(), enabled: false },
    synth: { ...createDefaultSynthState(), enabled: false },
  },
  {
    ...createDefaultProgram(1),
    name: 'B3 Organ',
    piano: { ...createDefaultProgram(1).piano, enabled: false },
    synth: { ...createDefaultSynthState(), enabled: false },
  },
  {
    ...createDefaultProgram(2),
    name: 'Synth Lead',
    piano: { ...createDefaultProgram(2).piano, enabled: false },
    organ: { ...createDefaultOrganState(), enabled: false },
  },
];

// Program Store
export class ProgramStore {
  private programs: ProgramState[] = [];
  private liveSlots: ProgramState[] = [];

  constructor() {
    // Initialize with factory programs + empty slots
    this.programs = [
      ...FACTORY_PROGRAMS,
      ...Array.from({ length: 32 - FACTORY_PROGRAMS.length }, (_, i) =>
        createDefaultProgram(FACTORY_PROGRAMS.length + i)
      ),
    ];

    // Initialize live slots
    this.liveSlots = Array.from({ length: 8 }, (_, i) => ({
      ...createDefaultProgram(i, true),
      isLive: true,
    }));

    // Try to load from localStorage
    this.loadFromStorage();
  }

  getProgram(number: number, isLive: boolean = false): ProgramState {
    const slots = isLive ? this.liveSlots : this.programs;
    if (number < 0 || number >= slots.length) {
      return createDefaultProgram(number, isLive);
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

  private saveToStorage(): void {
    try {
      const data = {
        programs: this.programs,
        liveSlots: this.liveSlots,
      };
      localStorage.setItem('stagebench-programs', JSON.stringify(data));
    } catch (_error) {
      // Failed to save
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
    } catch (_error) {
      // Failed to load
    }
  }

  clearStorage(): void {
    localStorage.removeItem('stagebench-programs');
  }
}
