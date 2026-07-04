/**
 * Computer-keyboard -> MIDI note mapping (two rows, piano-tracker style).
 * Uses KeyboardEvent.code so it is layout-independent. The base octave anchors
 * the lower row's "A" (KeyA) to a MIDI note in the middle of the 73-key range.
 */

// Lower row: Z S X D C V G B H N J M  -> chromatic run starting at C.
// Upper row: Q 2 W 3 E R 5 T 6 Y 7 U  -> one octave above.
const LOWER: Array<[string, number]> = [
  ['KeyZ', 0],
  ['KeyS', 1],
  ['KeyX', 2],
  ['KeyD', 3],
  ['KeyC', 4],
  ['KeyV', 5],
  ['KeyG', 6],
  ['KeyB', 7],
  ['KeyH', 8],
  ['KeyN', 9],
  ['KeyJ', 10],
  ['KeyM', 11],
  ['Comma', 12],
  ['KeyL', 13],
  ['Period', 14],
];

const UPPER: Array<[string, number]> = [
  ['KeyQ', 12],
  ['Digit2', 13],
  ['KeyW', 14],
  ['Digit3', 15],
  ['KeyE', 16],
  ['KeyR', 17],
  ['Digit5', 18],
  ['KeyT', 19],
  ['Digit6', 20],
  ['KeyY', 21],
  ['Digit7', 22],
  ['KeyU', 23],
  ['KeyI', 24],
  ['Digit9', 25],
  ['KeyO', 26],
];

/**
 * @param baseMidi MIDI note that the lowest mapped key (KeyZ) should sound.
 * Defaults to C4 (60).
 */
export function buildKeyboardMap(baseMidi = 60): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  for (const [code, offset] of [...LOWER, ...UPPER]) {
    map.set(code, baseMidi + offset);
  }
  return map;
}

export const DEFAULT_KEYBOARD_MAP = buildKeyboardMap();
