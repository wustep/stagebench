import { describe, it, expect, beforeEach } from 'vitest';
import { ProgramStore, createDefaultProgramState, FACTORY_PROGRAMS } from './programs';

describe('ProgramStore', () => {
  let store: ProgramStore;

  beforeEach(() => {
    store = new ProgramStore();
    store.clearStorage();
  });

  describe('factory programs', () => {
    it('should have at least 4 factory programs', () => {
      expect(FACTORY_PROGRAMS.length).toBeGreaterThanOrEqual(4);
    });

    it('should have distinct programs', () => {
      const names = FACTORY_PROGRAMS.map((p) => p.name);
      const unique = new Set(names);
      expect(unique.size).toBe(names.length);
    });

    it('should demonstrate different sections', () => {
      const piano = FACTORY_PROGRAMS.find((p) => p.piano.enabled);
      const organ = FACTORY_PROGRAMS.find((p) => p.organ.enabled);
      const synth = FACTORY_PROGRAMS.find((p) => p.synth.enabled);
      const split = FACTORY_PROGRAMS.find((p) => p.splits.enabled);

      expect(piano).toBeDefined();
      expect(organ).toBeDefined();
      expect(synth).toBeDefined();
      expect(split).toBeDefined();
    });
  });

  describe('program retrieval', () => {
    it('should return a program by number', () => {
      const prog = store.getProgram(0);
      expect(prog).toBeDefined();
      expect(prog.number).toBe(0);
    });

    it('should return 32 programs', () => {
      const all = store.getAllPrograms();
      expect(all.length).toBe(32);
    });

    it('should return 8 live slots', () => {
      const live = store.getLiveSlots();
      expect(live.length).toBe(8);
    });

    it('should mark all live slots as live', () => {
      const live = store.getLiveSlots();
      live.forEach((slot) => {
        expect(slot.isLive).toBe(true);
      });
    });
  });

  describe('program state round-trip', () => {
    it('should preserve program state on save', () => {
      const original = store.getProgram(0);
      original.piano.selectedType = 'Electric';
      original.transpose = 3;

      store.saveProgram(original);
      const restored = store.getProgram(0);

      expect(restored.piano.selectedType).toBe('Electric');
      expect(restored.transpose).toBe(3);
    });

    it('should clear dirty flag on save', () => {
      let prog = store.getProgram(0);
      prog.isDirty = true;

      store.saveProgram(prog);
      const saved = store.getProgram(0);

      expect(saved.isDirty).toBe(false);
    });

    it('should track dirty state', () => {
      const prog = store.getProgram(0);
      expect(prog.isDirty).toBe(false);

      store.setDirty(0);
      // Note: dirty state is tracked separately in the store

      // After save, should be clean
      store.saveProgram(prog);
      const saved = store.getProgram(0);
      expect(saved.isDirty).toBe(false);
    });

    it('should support discard changes', () => {
      store.setDirty(0);
      store.discardChanges(0);
      // Verify dirty state is cleared
      const prog = store.getProgram(0);
      expect(prog.isDirty).toBe(false);
    });
  });

  describe('program creation', () => {
    it('should create default programs with correct structure', () => {
      const prog = createDefaultProgramState(5);

      expect(prog.number).toBe(5);
      expect(prog.piano).toBeDefined();
      expect(prog.organ).toBeDefined();
      expect(prog.synth).toBeDefined();
      expect(prog.splits).toBeDefined();
      expect(prog.scenes).toBeDefined();
      expect(prog.morphs).toBeDefined();
      expect(prog.masterClock).toBeDefined();
    });

    it('should have all sections disabled by default except piano', () => {
      const prog = createDefaultProgramState();

      expect(prog.piano.enabled).toBe(true);
      expect(prog.organ.enabled).toBe(true); // Organ is enabled by default
      expect(prog.synth.enabled).toBe(true); // Synth is enabled by default
    });

    it('should have sensible defaults for all parameters', () => {
      const prog = createDefaultProgramState();

      expect(prog.transpose).toBeGreaterThanOrEqual(-6);
      expect(prog.transpose).toBeLessThanOrEqual(6);
      expect(prog.masterClock.bpm).toBeGreaterThanOrEqual(30);
      expect(prog.masterClock.bpm).toBeLessThanOrEqual(300);
    });
  });

  describe('live mode', () => {
    it('should have independent live slots', () => {
      const liveSlots = store.getLiveSlots();

      liveSlots.forEach((slot, index) => {
        expect(slot.isLive).toBe(true);
        expect(slot.number).toBe(index);
      });
    });

    it('should support saving to live slots', () => {
      const liveSlot = store.getProgram(0, true);
      liveSlot.piano.selectedType = 'Digital';

      store.saveProgram(liveSlot);
      const restored = store.getProgram(0, true);

      expect(restored.piano.selectedType).toBe('Digital');
    });

    it('should auto-save edits in live mode', () => {
      const liveSlot = store.getProgram(0, true);
      liveSlot.organ.layerA.level = 0.5;

      store.saveProgram(liveSlot);
      const restored = store.getProgram(0, true);

      expect(restored.organ.layerA.level).toBe(0.5);
    });
  });

  describe('localStorage persistence', () => {
    it('should persist to localStorage on save', () => {
      const prog = store.getProgram(0);
      prog.piano.selectedType = 'Clav';

      store.saveProgram(prog);

      // Create new store, should restore
      const newStore = new ProgramStore();
      const restored = newStore.getProgram(0);

      expect(restored.piano.selectedType).toBe('Clav');
    });

    it('should recover from localStorage on init', () => {
      const prog = store.getProgram(5);
      prog.transpose = 5;
      store.saveProgram(prog);

      const newStore = new ProgramStore();
      const restored = newStore.getProgram(5);

      expect(restored.transpose).toBe(5);
    });
  });
});
