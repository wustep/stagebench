import { SplitConfig, DEFAULT_SPLIT_CONFIG, LayerZoneAssignment, ALL_ZONES_ASSIGNMENT } from './splits';
import { MorphAssignment } from './morph';

export interface LayerSceneConfig {
  activeScene: 1 | 2;
  scene1: {
    pianoA: boolean;
    pianoB: boolean;
    organA: boolean;
    organB: boolean;
    synthA: boolean;
    synthB: boolean;
    synthC: boolean;
  };
  scene2: {
    pianoA: boolean;
    pianoB: boolean;
    organA: boolean;
    organB: boolean;
    synthA: boolean;
    synthB: boolean;
    synthC: boolean;
  };
}

export const DEFAULT_LAYER_SCENE_CONFIG: LayerSceneConfig = {
  activeScene: 1,
  scene1: {
    pianoA: true,
    pianoB: false,
    organA: false,
    organB: false,
    synthA: false,
    synthB: false,
    synthC: false,
  },
  scene2: {
    pianoA: true,
    pianoB: true,
    organA: true,
    organB: false,
    synthA: true,
    synthB: false,
    synthC: false,
  },
};

export interface ProgramData {
  id: string; // e.g. "1.1" or "live-1"
  name: string;
  category: string;

  // Master performance state (excludes master_level)
  tempoBpm: number; // 30..300
  transpose: number; // -6..+6

  // Splits & Scenes & Morphs
  splits: SplitConfig;
  layerZones: {
    pianoA: LayerZoneAssignment;
    pianoB: LayerZoneAssignment;
    organA: LayerZoneAssignment;
    organB: LayerZoneAssignment;
    synthA: LayerZoneAssignment;
    synthB: LayerZoneAssignment;
    synthC: LayerZoneAssignment;
  };
  layerScenes: LayerSceneConfig;
  morphAssignments: MorphAssignment[];

  // Piano Section
  piano: {
    on: boolean;
    type: number; // 0..5: Grand, Upright, Electric, Clav, Digital, Misc
    model: number; // 1..9
    kbTouch: number; // 0..3: Off, Light, Med, Heavy
    timbre: number; // 0..5
    dynComp: number; // 0..3
    unison: number; // 0..3
    softRelease: boolean;
    stringRes: boolean;
    sustain: boolean;
    pstick: boolean;
    layerA: {
      on: boolean;
      level: number;
      octave: number;
    };
    layerB: {
      on: boolean;
      level: number;
      octave: number;
    };
  };

  // Organ Section
  organ: {
    on: boolean;
    model: number; // 0..5: B3, Vox, Farf, Pipe 1, Pipe 2, B3 Bass
    drawbars: [number, number, number, number, number, number, number, number, number];
    percussionOn: boolean;
    percussionSoft: boolean;
    percussionFast: boolean;
    percussionThird: boolean;
    vibratoOn: boolean;
    vibratoMode: number; // 0..5: C1, C2, C3, V1, V2, V3
    rotaryStop: boolean;
    rotarySpeed: boolean; // false=slow, true=fast
    sustain: boolean;
    pstick: boolean;
    layerA: {
      on: boolean;
      level: number;
      octave: number;
      vibratoOn: boolean;
    };
    layerB: {
      on: boolean;
      level: number;
      octave: number;
      vibratoOn: boolean;
    };
  };

  // Synth Section
  synth: {
    on: boolean;
    oscCategory: number; // 0: Pure, 1: Sync, 2: Multi, 3: Super, 4: FM-H
    waveform: number;
    oscMod: number; // Osc Ctrl (0..10)
    filterType: number; // 0: LP12, 1: LP24, 2: HP, 3: BP
    filterCutoff: number; // 0..10
    filterResonance: number; // 0..10
    filterDrive: number; // 0..3
    filterEnvAmt: number; // -10..+10
    filterKbTracking: number; // 0: Off, 1: 1/3, 2: 2/3, 3: 1
    ampAttack: number;
    ampDecay: number;
    ampSustain: number;
    ampRelease: number;
    ampVelocity: number; // 0..3
    modAttack: number;
    modDecay: number;
    modRelease: number;
    modVelocity: boolean;
    modToPitch: boolean;
    modEnvAmt: number; // -10..+10
    lfoWaveform: number; // 0: Triangle, 1: Saw down, 2: Saw up, 3: Square, 4: S&H
    lfoDestination: number; // 0: Off, 1: Osc Pitch, 2: Osc Ctrl, 3: Filter Freq
    lfoRate: number; // 0..10
    lfoAmount: number; // 0..10
    lfoClockSync: boolean;
    voiceMode: number; // 0: Poly, 1: Mono, 2: Legato
    voicePriority: number; // 0: Off, 1: Low, 2: High
    glide: number; // 0..10
    unison: number; // 0..3
    vibratoMode: number; // 0: Off, 1: On, 2: Wheel
    vibratoRate: number; // 2..8 Hz
    vibratoAmount: number; // 0..10
    arpMode: number; // 0: Arp, 1: Poly, 2: Gate
    arpDirection: number; // 0: Up, 1: Down, 2: Up/Down, 3: Random
    arpRange: number; // 1..4 octaves
    arpRate: number; // 0..10
    arpClockSync: boolean;
    arpKbHold: boolean;
    arpRun: boolean;
    sustain: boolean;
    pstick: boolean;
    pitchCoarse: number; // -24..+24
    pitchFine: number; // -50..+50
    layerA: {
      on: boolean;
      level: number;
      octave: number;
    };
    layerB: {
      on: boolean;
      level: number;
      octave: number;
    };
    layerC: {
      on: boolean;
      level: number;
      octave: number;
    };
  };

  // Effects Section
  effects: {
    allEffectsOn: boolean;
    effect1: {
      on: boolean;
      type: number;
      rate: number;
      amount: number;
      clockSync: boolean;
    };
    effect2: {
      on: boolean;
      type: number;
      rate: number;
      amount: number;
    };
    delay: {
      on: boolean;
      tempo: number;
      feedback: number;
      amount: number;
      pingpong: boolean;
      filter: number;
      global: boolean;
      clockSync: boolean;
    };
    ampEq: {
      on: boolean;
      type: number;
      drive: number;
      bass: number;
      mid: number;
      midFreq: number;
      treble: number;
    };
    compressor: {
      on: boolean;
      amount: number;
      fast: boolean;
      global: boolean;
    };
    reverb: {
      on: boolean;
      type: number;
      decay: number;
      amount: number;
      bright: boolean;
      global: boolean;
    };
    rotary: {
      on: boolean;
      speed: boolean;
      stop: boolean;
      drive: number;
      organRouted: boolean;
    };
    groupPiano: boolean;
    groupSynth: boolean;
  };
}

export function createDefaultProgram(slotNumber: number, name: string): ProgramData {
  const page = Math.floor((slotNumber - 1) / 8) + 1;
  const btn = ((slotNumber - 1) % 8) + 1;
  const id = `${page}.${btn}`;

  return {
    id,
    name,
    category: 'General',
    tempoBpm: 120,
    transpose: 0,
    splits: { ...DEFAULT_SPLIT_CONFIG },
    layerZones: {
      pianoA: { ...ALL_ZONES_ASSIGNMENT },
      pianoB: { ...ALL_ZONES_ASSIGNMENT },
      organA: { ...ALL_ZONES_ASSIGNMENT },
      organB: { ...ALL_ZONES_ASSIGNMENT },
      synthA: { ...ALL_ZONES_ASSIGNMENT },
      synthB: { ...ALL_ZONES_ASSIGNMENT },
      synthC: { ...ALL_ZONES_ASSIGNMENT },
    },
    layerScenes: { ...DEFAULT_LAYER_SCENE_CONFIG },
    morphAssignments: [],

    piano: {
      on: true,
      type: 0, // Grand
      model: 1, // Concert Grand
      kbTouch: 0,
      timbre: 0,
      dynComp: 0,
      unison: 0,
      softRelease: false,
      stringRes: true,
      sustain: true,
      pstick: false,
      layerA: { on: true, level: 8.5, octave: 0 },
      layerB: { on: false, level: 6.0, octave: 0 },
    },

    organ: {
      on: false,
      model: 0, // B3
      drawbars: [8, 8, 8, 0, 0, 0, 0, 0, 0],
      percussionOn: false,
      percussionSoft: false,
      percussionFast: false,
      percussionThird: false,
      vibratoOn: false,
      vibratoMode: 0,
      rotaryStop: false,
      rotarySpeed: false,
      sustain: true,
      pstick: false,
      layerA: { on: true, level: 8.0, octave: 0, vibratoOn: true },
      layerB: { on: false, level: 7.0, octave: 0, vibratoOn: false },
    },

    synth: {
      on: false,
      oscCategory: 0, // Pure
      waveform: 2, // Saw
      oscMod: 0,
      filterType: 1, // LP24
      filterCutoff: 7.0,
      filterResonance: 2.0,
      filterDrive: 0,
      filterEnvAmt: 3.0,
      filterKbTracking: 3, // 1:1
      ampAttack: 0.05,
      ampDecay: 2.0,
      ampSustain: 8.0,
      ampRelease: 1.0,
      ampVelocity: 1,
      modAttack: 0.1,
      modDecay: 1.5,
      modRelease: 1.0,
      modVelocity: false,
      modToPitch: false,
      modEnvAmt: 0,
      lfoWaveform: 0, // Triangle
      lfoDestination: 0, // Off
      lfoRate: 4.0,
      lfoAmount: 0,
      lfoClockSync: false,
      voiceMode: 0, // Poly
      voicePriority: 0,
      glide: 0,
      unison: 0,
      vibratoMode: 0,
      vibratoRate: 5.0,
      vibratoAmount: 2.0,
      arpMode: 0,
      arpDirection: 0,
      arpRange: 1,
      arpRate: 5.0,
      arpClockSync: false,
      arpKbHold: false,
      arpRun: false,
      sustain: true,
      pstick: false,
      pitchCoarse: 0,
      pitchFine: 0,
      layerA: { on: true, level: 7.5, octave: 0 },
      layerB: { on: false, level: 5.0, octave: 0 },
      layerC: { on: false, level: 5.0, octave: 0 },
    },

    effects: {
      allEffectsOn: true,
      effect1: { on: false, type: 0, rate: 5.0, amount: 5.0, clockSync: false },
      effect2: { on: false, type: 0, rate: 5.0, amount: 5.0 },
      delay: {
        on: false,
        tempo: 5.0,
        feedback: 4.0,
        amount: 3.0,
        pingpong: false,
        filter: 0,
        global: false,
        clockSync: false,
      },
      ampEq: { on: false, type: 0, drive: 2.0, bass: 0, mid: 0, midFreq: 5.0, treble: 0 },
      compressor: { on: false, amount: 4.0, fast: false, global: false },
      reverb: { on: false, type: 2, decay: 5.0, amount: 4.0, bright: false, global: false },
      rotary: { on: false, speed: false, stop: false, drive: 2.0, organRouted: true },
      groupPiano: false,
      groupSynth: false,
    },
  };
}

// 8 Curated Factory Programs demonstrating different combinations
export const FACTORY_PROGRAMS: ProgramData[] = [
  // 1.1: Concert Grand
  {
    ...createDefaultProgram(1, 'Concert Grand'),
    category: 'Piano',
    piano: {
      ...createDefaultProgram(1, 'Concert Grand').piano,
      on: true,
      type: 0, // Grand
      model: 1,
      layerA: { on: true, level: 9.0, octave: 0 },
      layerB: { on: false, level: 0, octave: 0 },
      stringRes: true,
      timbre: 0,
    },
    effects: {
      ...createDefaultProgram(1, 'Concert Grand').effects,
      reverb: { on: true, type: 2, decay: 4.0, amount: 3.0, bright: true, global: false },
    },
  },

  // 1.2: B3 Rock Organ
  {
    ...createDefaultProgram(2, 'B3 Rock Organ'),
    category: 'Organ',
    piano: { ...createDefaultProgram(2, 'B3 Rock Organ').piano, on: false, layerA: { on: false, level: 0, octave: 0 } },
    organ: {
      ...createDefaultProgram(2, 'B3 Rock Organ').organ,
      on: true,
      model: 0, // B3
      drawbars: [8, 8, 8, 8, 0, 0, 0, 6, 8],
      percussionOn: true,
      percussionSoft: false,
      percussionFast: true,
      percussionThird: true,
      layerA: { on: true, level: 8.5, octave: 0, vibratoOn: true },
      vibratoOn: true,
      vibratoMode: 2, // C3
      rotarySpeed: false,
    },
    effects: {
      ...createDefaultProgram(2, 'B3 Rock Organ').effects,
      rotary: { on: true, speed: false, stop: false, drive: 4.0, organRouted: true },
    },
  },

  // 1.3: Super Saw Lead
  {
    ...createDefaultProgram(3, 'Super Saw Lead'),
    category: 'Synth',
    piano: { ...createDefaultProgram(3, 'Super Saw Lead').piano, on: false, layerA: { on: false, level: 0, octave: 0 } },
    synth: {
      ...createDefaultProgram(3, 'Super Saw Lead').synth,
      on: true,
      oscCategory: 3, // Super
      waveform: 0, // Super Saw
      oscMod: 6.5,
      filterType: 1, // LP24
      filterCutoff: 8.0,
      filterResonance: 3.5,
      filterDrive: 1,
      filterEnvAmt: 4.0,
      ampAttack: 0.01,
      ampDecay: 2.5,
      ampSustain: 7.0,
      ampRelease: 1.2,
      voiceMode: 1, // Mono
      glide: 3.0,
      unison: 2,
      layerA: { on: true, level: 8.0, octave: 0 },
    },
    effects: {
      ...createDefaultProgram(3, 'Super Saw Lead').effects,
      delay: { on: true, tempo: 4.5, feedback: 5.0, amount: 4.0, pingpong: true, filter: 1, global: false, clockSync: true },
      reverb: { on: true, type: 3, decay: 5.5, amount: 3.5, bright: false, global: false },
    },
  },

  // 1.4: Velvet Warm Pad
  {
    ...createDefaultProgram(4, 'Velvet Warm Pad'),
    category: 'Synth',
    piano: { ...createDefaultProgram(4, 'Velvet Warm Pad').piano, on: false, layerA: { on: false, level: 0, octave: 0 } },
    synth: {
      ...createDefaultProgram(4, 'Velvet Warm Pad').synth,
      on: true,
      oscCategory: 2, // Multi
      waveform: 0, // Multi Saw
      oscMod: 5.0,
      filterType: 0, // LP12
      filterCutoff: 5.0,
      filterResonance: 1.5,
      filterDrive: 0,
      filterEnvAmt: 2.0,
      ampAttack: 1.2,
      ampDecay: 4.0,
      ampSustain: 9.0,
      ampRelease: 3.0,
      lfoWaveform: 0,
      lfoDestination: 3, // Filter Freq
      lfoRate: 1.5,
      lfoAmount: 2.5,
      voiceMode: 0, // Poly
      layerA: { on: true, level: 8.0, octave: 0 },
    },
    effects: {
      ...createDefaultProgram(4, 'Velvet Warm Pad').effects,
      effect2: { on: true, type: 0, rate: 2.0, amount: 6.0 }, // Chorus
      reverb: { on: true, type: 4, decay: 7.0, amount: 5.0, bright: false, global: false }, // Hall
    },
  },

  // 1.5: Split Bass & Piano
  {
    ...createDefaultProgram(5, 'Split Bass & Piano'),
    category: 'Split',
    tempoBpm: 125,
    splits: {
      enabled: true,
      lowSplitActive: false,
      lowPosition: 'C3',
      lowCrossfade: 0,
      midSplitActive: true,
      midPosition: 'C4', // Mid split at C4
      midCrossfade: 0,
      highSplitActive: false,
      highPosition: 'C5',
      highCrossfade: 0,
    },
    layerZones: {
      pianoA: { zone1: false, zone2: true, zone3: true, zone4: true }, // Right of split (Zone 2+)
      pianoB: { ...ALL_ZONES_ASSIGNMENT },
      organA: { ...ALL_ZONES_ASSIGNMENT },
      organB: { ...ALL_ZONES_ASSIGNMENT },
      synthA: { zone1: true, zone2: false, zone3: false, zone4: false }, // Left of split (Zone 1)
      synthB: { ...ALL_ZONES_ASSIGNMENT },
      synthC: { ...ALL_ZONES_ASSIGNMENT },
    },
    piano: {
      ...createDefaultProgram(5, 'Split Bass & Piano').piano,
      on: true,
      type: 0,
      model: 1,
      layerA: { on: true, level: 8.5, octave: 0 },
    },
    synth: {
      ...createDefaultProgram(5, 'Split Bass & Piano').synth,
      on: true,
      oscCategory: 0, // Pure
      waveform: 3, // Square
      filterType: 1, // LP24
      filterCutoff: 4.0,
      filterResonance: 3.0,
      ampAttack: 0.01,
      ampDecay: 1.5,
      ampSustain: 5.0,
      ampRelease: 0.5,
      voiceMode: 1, // Mono
      layerA: { on: true, level: 8.5, octave: -1 },
    },
    effects: {
      ...createDefaultProgram(5, 'Split Bass & Piano').effects,
      reverb: { on: true, type: 2, decay: 3.5, amount: 3.0, bright: false, global: false },
    },
  },

  // 1.6: Layered Worship Tines
  {
    ...createDefaultProgram(6, 'Layered Worship Tines'),
    category: 'Layer',
    piano: {
      ...createDefaultProgram(6, 'Layered Worship Tines').piano,
      on: true,
      type: 2, // Electric
      model: 1,
      timbre: 4, // Dyno 1
      layerA: { on: true, level: 8.0, octave: 0 },
    },
    synth: {
      ...createDefaultProgram(6, 'Layered Worship Tines').synth,
      on: true,
      oscCategory: 2,
      waveform: 0,
      filterCutoff: 4.5,
      ampAttack: 0.8,
      ampRelease: 2.5,
      layerA: { on: true, level: 6.5, octave: 0 },
    },
    effects: {
      ...createDefaultProgram(6, 'Layered Worship Tines').effects,
      effect1: { on: true, type: 1, rate: 4.5, amount: 4.0, clockSync: false }, // Tremolo
      reverb: { on: true, type: 5, decay: 8.0, amount: 5.5, bright: true, global: false }, // Cathedral
    },
  },

  // 1.7: DX7 Tine FM Digital
  {
    ...createDefaultProgram(7, 'DX7 Tine FM Digital'),
    category: 'Digital',
    piano: {
      ...createDefaultProgram(7, 'DX7 Tine FM Digital').piano,
      on: true,
      type: 4, // Digital
      model: 1,
      layerA: { on: true, level: 8.5, octave: 0 },
    },
    synth: {
      ...createDefaultProgram(7, 'DX7 Tine FM Digital').synth,
      on: true,
      oscCategory: 4, // FM-H
      waveform: 0,
      oscMod: 7.0,
      filterCutoff: 9.0,
      layerA: { on: true, level: 6.0, octave: 0 },
    },
    effects: {
      ...createDefaultProgram(7, 'DX7 Tine FM Digital').effects,
      effect2: { on: true, type: 0, rate: 1.5, amount: 5.5 }, // Chorus
      delay: { on: true, tempo: 5.0, feedback: 3.5, amount: 3.0, pingpong: true, filter: 0, global: false, clockSync: false },
      reverb: { on: true, type: 3, decay: 4.0, amount: 3.5, bright: false, global: false },
    },
  },

  // 1.8: Arp Groove Sync
  {
    ...createDefaultProgram(8, 'Arp Groove Sync'),
    category: 'Arp',
    tempoBpm: 130,
    synth: {
      ...createDefaultProgram(8, 'Arp Groove Sync').synth,
      on: true,
      oscCategory: 1, // Sync
      waveform: 0, // Sync Saw
      oscMod: 4.0,
      filterCutoff: 6.0,
      filterResonance: 4.0,
      filterEnvAmt: 5.0,
      ampAttack: 0.01,
      ampDecay: 0.6,
      ampSustain: 0,
      ampRelease: 0.3,
      arpMode: 0, // Arp
      arpDirection: 2, // Up/Down
      arpRange: 2,
      arpRate: 6.0,
      arpClockSync: true,
      arpKbHold: false,
      arpRun: true,
      layerA: { on: true, level: 8.5, octave: 0 },
    },
    effects: {
      ...createDefaultProgram(8, 'Arp Groove Sync').effects,
      delay: { on: true, tempo: 6.0, feedback: 5.0, amount: 4.5, pingpong: true, filter: 1, global: false, clockSync: true },
      reverb: { on: true, type: 1, decay: 3.0, amount: 3.0, bright: true, global: false },
    },
  },
];

export class ProgramStore {
  private programs: Map<number, ProgramData> = new Map(); // 1..32
  private liveSlots: Map<number, ProgramData> = new Map(); // 1..8

  constructor() {
    this.initFactoryPrograms();
  }

  private initFactoryPrograms(): void {
    // Populate slots 1..8 with rich factory programs
    FACTORY_PROGRAMS.forEach((prog, idx) => {
      this.programs.set(idx + 1, JSON.parse(JSON.stringify(prog)));
    });

    // Populate slots 9..32 with default named programs
    for (let slot = 9; slot <= 32; slot++) {
      const page = Math.floor((slot - 1) / 8) + 1;
      const btn = ((slot - 1) % 8) + 1;
      const defaultProg = createDefaultProgram(slot, `Program ${page}.${btn}`);
      this.programs.set(slot, defaultProg);
    }

    // Populate 8 Live slots
    for (let liveSlot = 1; liveSlot <= 8; liveSlot++) {
      const liveProg = createDefaultProgram(liveSlot, `Live ${liveSlot}`);
      liveProg.id = `live-${liveSlot}`;
      this.liveSlots.set(liveSlot, liveProg);
    }
  }

  public getProgram(slot: number): ProgramData | null {
    const prog = this.programs.get(slot);
    return prog ? JSON.parse(JSON.stringify(prog)) : null;
  }

  public saveProgram(slot: number, data: ProgramData): void {
    const page = Math.floor((slot - 1) / 8) + 1;
    const btn = ((slot - 1) % 8) + 1;
    const copy: ProgramData = JSON.parse(JSON.stringify(data));
    copy.id = `${page}.${btn}`;
    this.programs.set(slot, copy);
  }

  public getLiveSlot(slot: number): ProgramData | null {
    const prog = this.liveSlots.get(slot);
    return prog ? JSON.parse(JSON.stringify(prog)) : null;
  }

  public saveLiveSlot(slot: number, data: ProgramData): void {
    const copy: ProgramData = JSON.parse(JSON.stringify(data));
    copy.id = `live-${slot}`;
    this.liveSlots.set(slot, copy);
  }

  public getAllPrograms(): ProgramData[] {
    const list: ProgramData[] = [];
    for (let slot = 1; slot <= 32; slot++) {
      const prog = this.programs.get(slot);
      if (prog) list.push(JSON.parse(JSON.stringify(prog)));
    }
    return list;
  }
}
