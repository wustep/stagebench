/** Keybed model for the Stage 4 73 variant (specs/nord-stage-4.variants.json).
 *
 * 73 keys, 43 white / 30 black, range E1 (MIDI 28) to E7 (MIDI 100).
 * Black-key overlay positions are derived from the white-key boundary index so
 * the rendered pattern always matches the model the tests assert.
 */

export const KEYBED_LOW_MIDI = 28; // E1
export const KEYBED_HIGH_MIDI = 100; // E7
export const KEYBED_TOTAL = 73;
export const KEYBED_WHITE_COUNT = 43;
export const KEYBED_BLACK_COUNT = 30;
/** Black-key sounding length as a fraction of the keybed height. */
export const BLACK_KEY_HEIGHT_FRACTION = 0.61;
/** Black-key width as a fraction of one white-key width. */
export const BLACK_KEY_WIDTH_FRACTION = 0.62;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const WHITE_PITCH_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11]);

export interface KeyModel {
  /** Stable DOM/test id, e.g. `key-e1-28`. */
  id: string;
  midi: number;
  /** Display name, e.g. `E1`, `F#3`. */
  name: string;
  /** Screen-reader name, e.g. `E1`, `F sharp 3`. */
  ariaName: string;
  white: boolean;
  /** Index among white keys (white keys only). */
  whiteIndex: number;
  /**
   * For black keys: boundary position expressed in white-key units
   * (0..43), i.e. the seam between the neighbouring white keys.
   */
  boundaryIndex: number;
}

function pitchName(midi: number): { display: string; aria: string } {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const raw = NOTE_NAMES[pc];
  const pretty = raw.replace('#', '♯');
  return {
    display: `${pretty}${octave}`,
    aria: `${raw.replace('#', ' sharp ')}${octave}`,
  };
}

export function buildKeybed(low = KEYBED_LOW_MIDI, high = KEYBED_HIGH_MIDI): KeyModel[] {
  const keys: KeyModel[] = [];
  let whiteIndex = 0;
  for (let midi = low; midi <= high; midi += 1) {
    const pc = ((midi % 12) + 12) % 12;
    const white = WHITE_PITCH_CLASSES.has(pc);
    const { display, aria } = pitchName(midi);
    const slug = display.toLowerCase().replace('♯', 's');
    if (white) {
      keys.push({
        id: `key-${slug}-${midi}`,
        midi,
        name: display,
        ariaName: aria,
        white: true,
        whiteIndex,
        boundaryIndex: whiteIndex,
      });
      whiteIndex += 1;
    } else {
      keys.push({
        id: `key-${slug}-${midi}`,
        midi,
        name: display,
        ariaName: aria,
        white: false,
        whiteIndex: -1,
        // Sits on the seam after the `whiteIndex`-th white key.
        boundaryIndex: whiteIndex,
      });
    }
  }
  return keys;
}

export const KEYBED: KeyModel[] = buildKeybed();
export const WHITE_KEYS: KeyModel[] = KEYBED.filter((k) => k.white);
export const BLACK_KEYS: KeyModel[] = KEYBED.filter((k) => !k.white);

/** Left offset of a black key in percent of keybed width. */
export function blackKeyLeftPct(key: KeyModel): number {
  return (key.boundaryIndex / KEYBED_WHITE_COUNT) * 100;
}
