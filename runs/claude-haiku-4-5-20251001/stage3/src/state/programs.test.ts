import { describe, it, expect, beforeEach } from 'vitest';
import { ProgramStore, createDefaultProgram, FACTORY_PROGRAMS } from './programs';

describe('ProgramStore', () => {
  let store: ProgramStore;

  beforeEach(() => {
    store = new ProgramStore();
    store.clearStorage();
  });

  describe('factory programs', () => {
    it('should have at least 3 factory programs', () => {
      expect(FACTORY_PROGRAMS.length).toBeGreaterThanOrEqual(3);
    });

    it('should have distinct programs', () => {
      const names = FACTORY_PROGRAMS.map((p) => p.name);
      const unique = new Set(names);
      expect(unique.size).toBe(names.length);
    });
  });

  describe('program retrieval', () => {
    it('should return 32 programs', () => {
      const all = store.getAllPrograms();
      expect(all.length).toBe(32);
    });

    it('should return 8 live slots', () => {
      const live = store.getLiveSlots();
      expect(live.length).toBe(8);
    });

    it('should mark live slots as live', () => {
      const live = store.getLiveSlots();
      live.forEach((slot) => {
        expect(slot.isLive).toBe(true);
      });
    });
  });

  describe('program state round-trip', () => {
    it('should preserve program state on save', () => {
      let prog = store.getProgram(0);
      prog.piano.selectedType = 'Electric';
      prog.transpose = 3;

      store.saveProgram(prog);
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
  });

  describe('program creation', () => {
    it('should create default programs with correct structure', () => {
      const prog = createDefaultProgram(5);

      expect(prog.number).toBe(5);
      expect(prog.piano).toBeDefined();
      expect(prog.organ).toBeDefined();
      expect(prog.synth).toBeDefined();
      expect(prog.masterClock).toBeDefined();
    });

    it('should have sensible defaults', () => {
      const prog = createDefaultProgram(0);

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
      let liveSlot = store.getProgram(0, true);
      liveSlot.piano.selectedType = 'Digital';

      store.saveProgram(liveSlot);
      const restored = store.getProgram(0, true);

      expect(restored.piano.selectedType).toBe('Digital');
    });
  });

  describe('localStorage persistence', () => {
    it('should persist to localStorage on save', () => {
      let prog = store.getProgram(0);
      prog.piano.selectedType = 'Clav';

      store.saveProgram(prog);

      // Create new store, should restore
      const newStore = new ProgramStore();
      const restored = newStore.getProgram(0);

      expect(restored.piano.selectedType).toBe('Clav');
    });
  });
});
