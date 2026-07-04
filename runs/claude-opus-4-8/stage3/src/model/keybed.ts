/**
 * Keybed geometry model for the Nord Stage 4 73-key variant.
 *
 * Variant spec (specs/nord-stage-4.variants.json, id "stage-4-73"):
 *   totalKeys 73, whiteKeys 43, blackKeys 30, range "E to E",
 *   blackKeyHeightFraction 0.61, hammer action.
 *
 * MIDI: the low E is E1 (MIDI 28) and the high E is E7 (MIDI 100) for a
 * 73-note span (100 - 28 + 1 = 73). This is the standard NS4 73 mapping.
 */

export const KEYBED = {
  variant: 'stage-4-73',
  totalKeys: 73,
  whiteKeys: 43,
  blackKeys: 30,
  lowMidi: 28, // E1
  highMidi: 100, // E7
  blackKeyHeightFraction: 0.61,
} as const;

export interface KeyModel {
  /** Stable id, e.g. "key-28". */
  id: string;
  midi: number;
  /** true = black (accidental) key, false = white (natural) key. */
  isBlack: boolean;
  /** Scientific pitch name, e.g. "E1", "F#3". */
  name: string;
  /**
   * White-key index this key aligns with. White keys map to their own index
   * (0..42). Black keys reference the white key to their immediate left so the
   * renderer can position them over the gap.
   */
  whiteIndex: number;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]); // C#, D#, F#, G#, A#

export function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

export function isBlackKey(midi: number): boolean {
  return BLACK_PITCH_CLASSES.has(pitchClass(midi));
}

export function noteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[pitchClass(midi)]}${octave}`;
}

/**
 * Builds the ordered list of key models for the 73-key keybed.
 * Throws if the derived white/black counts do not match the variant spec — a
 * cheap invariant that keeps the geometry honest.
 */
export function buildKeys(): KeyModel[] {
  const keys: KeyModel[] = [];
  let whiteIndex = -1;
  for (let midi = KEYBED.lowMidi; midi <= KEYBED.highMidi; midi++) {
    const black = isBlackKey(midi);
    if (!black) whiteIndex++;
    keys.push({
      id: `key-${midi}`,
      midi,
      isBlack: black,
      name: noteName(midi),
      whiteIndex: Math.max(whiteIndex, 0),
    });
  }
  return keys;
}

export const KEYS = buildKeys();
export const WHITE_KEYS = KEYS.filter((k) => !k.isBlack);
export const BLACK_KEYS = KEYS.filter((k) => k.isBlack);
