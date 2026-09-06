/**
 * visual.key-count — exact Stage 4 73 keybed: 73 keys E1–E7 (MIDI 28–100),
 * 43 white / 30 black, correct black-key pattern and overlay geometry.
 */
import { describe, expect, it } from 'vitest';
import {
  BLACK_KEYS,
  KEYBED,
  KEYBED_BLACK_COUNT,
  KEYBED_HIGH_MIDI,
  KEYBED_LOW_MIDI,
  KEYBED_TOTAL,
  KEYBED_WHITE_COUNT,
  WHITE_KEYS,
  blackKeyLeftPct,
} from './hardware/keys';

describe('visual.key-count', () => {
  it('models exactly 73 keys from E1 to E7', () => {
    expect(KEYBED).toHaveLength(KEYBED_TOTAL);
    expect(KEYBED[0].midi).toBe(KEYBED_LOW_MIDI);
    expect(KEYBED[0].name).toBe('E1');
    expect(KEYBED[KEYBED.length - 1].midi).toBe(KEYBED_HIGH_MIDI);
    expect(KEYBED[KEYBED.length - 1].name).toBe('E7');
  });

  it('splits 43 white / 30 black', () => {
    expect(WHITE_KEYS).toHaveLength(KEYBED_WHITE_COUNT);
    expect(BLACK_KEYS).toHaveLength(KEYBED_BLACK_COUNT);
  });

  it('derives sequential MIDI with stable unique ids and names', () => {
    const ids = new Set(KEYBED.map((k) => k.id));
    expect(ids.size).toBe(KEYBED_TOTAL);
    KEYBED.forEach((key, i) => {
      expect(key.midi).toBe(KEYBED_LOW_MIDI + i);
      expect(key.id).toBeTruthy();
      expect(key.name).toBeTruthy();
      expect(key.ariaName).toBeTruthy();
    });
    expect(KEYBED.find((k) => k.midi === 60)?.name).toBe('C4');
    expect(KEYBED.find((k) => k.midi === 69)?.name).toBe('A4');
  });

  it('matches the piano black-key pattern (no sharps on E/B, groups of 2+3)', () => {
    // Every black key sits between two white keys a semitone apart sequence-wise.
    for (const key of BLACK_KEYS) {
      const idx = KEYBED.indexOf(key);
      expect(KEYBED[idx - 1].white).toBe(true);
      expect(KEYBED[idx + 1].white).toBe(true);
      expect([1, 3, 6, 8, 10]).toContain(key.midi % 12);
    }
    // Octave C4..B4 has exactly 5 black keys.
    expect(BLACK_KEYS.filter((k) => k.midi >= 60 && k.midi <= 71)).toHaveLength(5);
  });

  it('places black keys on white seams in ascending order', () => {
    let prev = -1;
    for (const key of BLACK_KEYS) {
      expect(key.boundaryIndex).toBeGreaterThan(prev);
      prev = key.boundaryIndex;
      const left = blackKeyLeftPct(key);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left).toBeLessThan(100);
    }
    expect(prev).toBeLessThanOrEqual(KEYBED_WHITE_COUNT);
  });
});
