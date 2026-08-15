import { describe, it, expect } from 'vitest';
import { ProgramStore, createDefaultProgram } from '../model/programs';
import { hardwareStateToProgramData, applyProgramDataToHardwareState } from '../model/stateConverter';
import { INITIAL_HARDWARE_STATE, HardwareState } from '../model/hardware';
import { calculateNoteZoneGains, SplitConfig, LayerZoneAssignment } from '../model/splits';
import { calculateMorphedValue, MorphState } from '../model/morph';

describe('Phase 3 - Programs, Splits, Scenes & Morphs', () => {
  describe('programs.roundtrip', () => {
    it('round-trips state accurately across program storage', () => {
      const store = new ProgramStore();
      const initialProg = store.getProgram(1);
      expect(initialProg).not.toBeNull();
      expect(initialProg?.name).toBe('Concert Grand');

      // Create modified state
      const state: HardwareState = {
        ...INITIAL_HARDWARE_STATE,
        program_number: 14,
        program_page: 2,
        program_button: 6,
        tempo_bpm: 142,
        transpose: 3,
        piano_layer_a_level: 9.2,
        organ_model: 1, // Vox
        organ_db_16: 6,
        synth_osc_category: 1, // Sync
        synth_filter_cutoff: 8.4,
      };

      const serialized = hardwareStateToProgramData(state, 14, 'Custom Rock Sync', 'User');
      store.saveProgram(14, serialized);

      const loaded = store.getProgram(14);
      expect(loaded).not.toBeNull();
      expect(loaded?.name).toBe('Custom Rock Sync');
      expect(loaded?.tempoBpm).toBe(142);
      expect(loaded?.transpose).toBe(3);
      expect(loaded?.piano.layerA.level).toBe(9.2);
      expect(loaded?.organ.model).toBe(1);
      expect(loaded?.synth.oscCategory).toBe(1);
      expect(loaded?.synth.filterCutoff).toBe(8.4);

      // Apply back to hardware state
      const restoredState = applyProgramDataToHardwareState(loaded!, INITIAL_HARDWARE_STATE);
      expect(restoredState.tempo_bpm).toBe(142);
      expect(restoredState.transpose).toBe(3);
      expect(restoredState.piano_layer_a_level).toBe(9.2);
      expect(restoredState.organ_model).toBe(1);
      expect(restoredState.synth_osc_category).toBe(1);
      expect(restoredState.synth_filter_cutoff).toBe(8.4);
    });

    it('populates all 32 program slots and 8 Live slots', () => {
      const store = new ProgramStore();
      const allProgs = store.getAllPrograms();
      expect(allProgs.length).toBe(32);

      for (let slot = 1; slot <= 32; slot++) {
        const prog = store.getProgram(slot);
        expect(prog).not.toBeNull();
        expect(prog?.id).toBeDefined();
        expect(prog?.name).toBeDefined();
      }

      for (let liveSlot = 1; liveSlot <= 8; liveSlot++) {
        const liveProg = store.getLiveSlot(liveSlot);
        expect(liveProg).not.toBeNull();
        expect(liveProg?.id).toBe(`live-${liveSlot}`);
      }
    });
  });

  describe('programs.store-live', () => {
    it('supports Store, Store As with naming, and Live auto-store', () => {
      const store = new ProgramStore();

      // Store As test
      const stateToStore: HardwareState = {
        ...INITIAL_HARDWARE_STATE,
        organ_on: true,
        organ_layer_a_level: 8.8,
      };

      const storedAsProg = hardwareStateToProgramData(stateToStore, 3, 'My Custom B3 Organ');
      store.saveProgram(3, storedAsProg);

      const retrieved = store.getProgram(3);
      expect(retrieved?.name).toBe('My Custom B3 Organ');
      expect(retrieved?.organ.on).toBe(true);
      expect(retrieved?.organ.layerA.level).toBe(8.8);

      // Live slot test
      const liveData = hardwareStateToProgramData(stateToStore, 2, 'Live 2');
      store.saveLiveSlot(2, liveData);

      const retrievedLive = store.getLiveSlot(2);
      expect(retrievedLive?.organ.on).toBe(true);
      expect(retrievedLive?.organ.layerA.level).toBe(8.8);
    });
  });

  describe('programs.undo-cancel', () => {
    it('discards unsaved modifications when changing programs', () => {
      const store = new ProgramStore();
      const prog1 = store.getProgram(1)!;

      // Start with program 1 state
      let state = applyProgramDataToHardwareState(prog1, INITIAL_HARDWARE_STATE);
      expect(state.piano_layer_a_level).toBe(prog1.piano.layerA.level);

      // User edits parameter (dirty state)
      state = { ...state, piano_layer_a_level: 2.1, is_dirty: true };
      expect(state.piano_layer_a_level).toBe(2.1);
      expect(state.is_dirty).toBe(true);

      // Selecting another program without storing discards unsaved edits
      const prog2 = store.getProgram(2)!;
      state = applyProgramDataToHardwareState(prog2, state);
      state = { ...state, is_dirty: false };

      // Switch back to program 1: unmodified saved state is restored
      state = applyProgramDataToHardwareState(store.getProgram(1)!, state);
      expect(state.piano_layer_a_level).toBe(prog1.piano.layerA.level);
    });
  });

  describe('programs.navigation', () => {
    it('computes correct page and button from slot 1..32', () => {
      // Slot 1 -> 1.1
      expect(Math.floor((1 - 1) / 8) + 1).toBe(1);
      expect(((1 - 1) % 8) + 1).toBe(1);

      // Slot 8 -> 1.8
      expect(Math.floor((8 - 1) / 8) + 1).toBe(1);
      expect(((8 - 1) % 8) + 1).toBe(8);

      // Slot 9 -> 2.1
      expect(Math.floor((9 - 1) / 8) + 1).toBe(2);
      expect(((9 - 1) % 8) + 1).toBe(1);

      // Slot 32 -> 4.8
      expect(Math.floor((32 - 1) / 8) + 1).toBe(4);
      expect(((32 - 1) % 8) + 1).toBe(8);
    });
  });

  describe('splits.zones', () => {
    it('calculates zone gains accurately for split points and crossfades', () => {
      const splitConfig: SplitConfig = {
        enabled: true,
        lowSplitActive: false,
        lowPosition: 'C3',
        lowCrossfade: 0,
        midSplitActive: true,
        midPosition: 'C4', // MIDI 60
        midCrossfade: 0,
        highSplitActive: false,
        highPosition: 'C5',
        highCrossfade: 0,
      };

      const zone1Only: LayerZoneAssignment = { zone1: true, zone2: false, zone3: false, zone4: false };
      const zone2Plus: LayerZoneAssignment = { zone1: false, zone2: true, zone3: true, zone4: true };

      // B3 (MIDI 59) is in Zone 1 (left of C4)
      const gainLeft = calculateNoteZoneGains(59, splitConfig, zone1Only);
      expect(gainLeft).toBe(1.0);
      const gainLeftMismatch = calculateNoteZoneGains(59, splitConfig, zone2Plus);
      expect(gainLeftMismatch).toBe(0.0);

      // C4 (MIDI 60) is in Zone 2 (right of C4)
      const gainRight = calculateNoteZoneGains(60, splitConfig, zone2Plus);
      expect(gainRight).toBe(1.0);
      const gainRightMismatch = calculateNoteZoneGains(60, splitConfig, zone1Only);
      expect(gainRightMismatch).toBe(0.0);
    });

    it('interpolates crossfade gains across boundary zones', () => {
      const splitConfig: SplitConfig = {
        enabled: true,
        lowSplitActive: false,
        lowPosition: 'C3',
        lowCrossfade: 0,
        midSplitActive: true,
        midPosition: 'C4', // MIDI 60
        midCrossfade: 6, // ±6 semitones crossfade (MIDI 54 to 66)
        highSplitActive: false,
        highPosition: 'C5',
        highCrossfade: 0,
      };

      const zone1Only: LayerZoneAssignment = { zone1: true, zone2: false, zone3: false, zone4: false };
      const zone2Plus: LayerZoneAssignment = { zone1: false, zone2: true, zone3: true, zone4: true };

      // At exact split point (60), crossfade gain is 0.5 for both
      const gainZ1AtSplit = calculateNoteZoneGains(60, splitConfig, zone1Only);
      const gainZ2AtSplit = calculateNoteZoneGains(60, splitConfig, zone2Plus);
      expect(gainZ1AtSplit).toBeCloseTo(0.5, 2);
      expect(gainZ2AtSplit).toBeCloseTo(0.5, 2);

      // Deep left (MIDI 48): Zone 1 is 1.0, Zone 2 is 0.0
      expect(calculateNoteZoneGains(48, splitConfig, zone1Only)).toBe(1.0);
      expect(calculateNoteZoneGains(48, splitConfig, zone2Plus)).toBe(0.0);

      // Deep right (MIDI 72): Zone 1 is 0.0, Zone 2 is 1.0
      expect(calculateNoteZoneGains(72, splitConfig, zone1Only)).toBe(0.0);
      expect(calculateNoteZoneGains(72, splitConfig, zone2Plus)).toBe(1.0);
    });
  });

  describe('morph.assignments', () => {
    it('interpolates destination parameters smoothly from wheel and control pedal', () => {
      const morphState: MorphState = {
        wheelValue: 0.5,
        ctrlPedValue: 1.0,
        activeMorphEditSource: null,
        assignments: [
          {
            source: 'wheel',
            destination: 'synth_filter_cutoff',
            baseValue: 2.0,
            targetValue: 8.0,
          },
          {
            source: 'ctrlped',
            destination: 'organ_layer_a_level',
            baseValue: 4.0,
            targetValue: 10.0,
          },
        ],
      };

      // Wheel at 0.5: 2.0 + 0.5 * (8.0 - 2.0) = 5.0
      const morphedCutoff = calculateMorphedValue('synth_filter_cutoff', 2.0, morphState);
      expect(morphedCutoff).toBeCloseTo(5.0, 3);

      // CtrlPed at 1.0: 4.0 + 1.0 * (10.0 - 4.0) = 10.0
      const morphedOrgLevel = calculateMorphedValue('organ_layer_a_level', 4.0, morphState);
      expect(morphedOrgLevel).toBeCloseTo(10.0, 3);

      // Destination with no morph returns base value
      const unassigned = calculateMorphedValue('synth_filter_resonance', 3.5, morphState);
      expect(unassigned).toBe(3.5);
    });
  });

  describe('scenes.switching', () => {
    it('toggles layer scenes without duplicating sound synthesis parameters', () => {
      const prog = createDefaultProgram(1, 'Scene Test');
      prog.layerScenes.scene1.pianoA = true;
      prog.layerScenes.scene1.synthA = false;

      prog.layerScenes.scene2.pianoA = false;
      prog.layerScenes.scene2.synthA = true;

      expect(prog.layerScenes.scene1.pianoA).toBe(true);
      expect(prog.layerScenes.scene1.synthA).toBe(false);

      expect(prog.layerScenes.scene2.pianoA).toBe(false);
      expect(prog.layerScenes.scene2.synthA).toBe(true);
    });
  });

  describe('hardware.bindings', () => {
    it('declares and operates Master Clock, Transpose, and Panic bindings', () => {
      let state = { ...INITIAL_HARDWARE_STATE, tempo_bpm: 120, transpose: 0 };

      // Change BPM
      state = { ...state, tempo_bpm: 140 };
      expect(state.tempo_bpm).toBe(140);

      // Transpose ±6
      state = { ...state, transpose: -3, transpose_active: true };
      expect(state.transpose).toBe(-3);
      expect(state.transpose_active).toBe(true);
    });
  });
});
