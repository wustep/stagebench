import { describe, expect, it } from 'vitest';
import { KEYBED, KEYS, WHITE_KEYS, BLACK_KEYS, buildKeys, isBlackKey, noteName } from '../src/model/keybed';

// feature: visual.key-count
describe('keybed model (visual.key-count)', () => {
  it('has the exact 73-key count for the stage-4-73 variant', () => {
    expect(KEYS).toHaveLength(73);
    expect(KEYBED.totalKeys).toBe(73);
  });

  it('splits into 43 white and 30 black keys', () => {
    expect(WHITE_KEYS).toHaveLength(43);
    expect(BLACK_KEYS).toHaveLength(30);
    expect(WHITE_KEYS.length + BLACK_KEYS.length).toBe(73);
  });

  it('spans E1 to E7 inclusive', () => {
    expect(KEYS[0].midi).toBe(28);
    expect(KEYS[0].name).toBe('E1');
    expect(KEYS[KEYS.length - 1].midi).toBe(100);
    expect(KEYS[KEYS.length - 1].name).toBe('E7');
  });

  it('classifies accidentals correctly', () => {
    expect(isBlackKey(28)).toBe(false); // E
    expect(isBlackKey(30)).toBe(true); // F#? -> midi30 = F#1
    expect(noteName(60)).toBe('C4');
    expect(noteName(69)).toBe('A4');
  });

  it('assigns unique ids and monotonic MIDI', () => {
    const ids = new Set(KEYS.map((k) => k.id));
    expect(ids.size).toBe(73);
    for (let i = 1; i < KEYS.length; i++) {
      expect(KEYS[i].midi).toBe(KEYS[i - 1].midi + 1);
    }
  });

  it('buildKeys is deterministic', () => {
    expect(buildKeys()).toEqual(KEYS);
  });
});
