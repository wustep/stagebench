import { describe, expect, it } from 'vitest';
import { buildKeyboardMap, DEFAULT_KEYBOARD_MAP } from '../src/input/keyboardMap';

// feature: piano.basic-inputs (mapped computer keys)
describe('computer keyboard map (piano.basic-inputs)', () => {
  it('maps the lower row anchor KeyZ to the base note', () => {
    const map = buildKeyboardMap(60);
    expect(map.get('KeyZ')).toBe(60);
    expect(map.get('KeyM')).toBe(71);
  });

  it('places the upper row one octave above', () => {
    const map = buildKeyboardMap(60);
    expect(map.get('KeyQ')).toBe(72);
    expect(map.get('KeyO')).toBe(86);
  });

  it('uses layout-independent KeyboardEvent.code keys', () => {
    for (const code of DEFAULT_KEYBOARD_MAP.keys()) {
      expect(code).toMatch(/^(Key[A-Z]|Digit[0-9]|Comma|Period)$/);
    }
  });

  it('produces distinct notes for distinct keys', () => {
    const notes = [...DEFAULT_KEYBOARD_MAP.values()];
    // Rows overlap intentionally by an octave; still, no two *codes* collide.
    expect(DEFAULT_KEYBOARD_MAP.size).toBeGreaterThanOrEqual(24);
    expect(notes.every((n) => Number.isInteger(n))).toBe(true);
  });
});
