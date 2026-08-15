export interface KeyDefinition {
  midi: number;
  noteName: string;
  isBlack: boolean;
  whiteIndex: number; // 0..42 for 43 white keys
  blackIndex?: number; // 0..29 for 30 black keys
  keyBinding?: string;
  frequency: number;
}

// Stage 4 73: E1 (MIDI 28) to E7 (MIDI 100)
// Total keys: 73 (43 white, 30 black)
export const KEYBED_CONFIG = {
  totalKeys: 73,
  whiteKeys: 43,
  blackKeys: 30,
  range: 'E to E',
  startMidi: 28, // E1
  endMidi: 100,  // E7
  blackKeyHeightFraction: 0.61,
} as const;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToNoteName(midi: number): string {
  const noteIndex = midi % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Computer keyboard mapping centered around Middle C (C4 = 60)
// Lower row (zxcvbnm...) -> C3 (48) to C4 (60)
// Upper row (qwertyui...) -> C4 (60) to E5 (76)
export const COMPUTER_KEY_MAP: Record<string, number> = {
  // Lower octave: C3 to C4
  'z': 48, // C3
  's': 49, // C#3
  'x': 50, // D3
  'd': 51, // D#3
  'c': 52, // E3
  'v': 53, // F3
  'g': 54, // F#3
  'b': 55, // G3
  'h': 56, // G#3
  'n': 57, // A3
  'j': 58, // A#3
  'm': 59, // B3
  ',': 60, // C4

  // Upper octave: C4 to E5
  'q': 60, // C4
  '2': 61, // C#4
  'w': 62, // D4
  '3': 63, // D#4
  'e': 64, // E4
  'r': 65, // F4
  '5': 66, // F#4
  't': 67, // G4
  '6': 68, // G#4
  'y': 69, // A4
  '7': 70, // A#4
  'u': 71, // B4
  'i': 72, // C5
  '9': 73, // C#5
  'o': 74, // D5
  '0': 75, // D#5
  'p': 76, // E5
  '[': 77, // F5
  '=': 78, // F#5
  ']': 79, // G5
};

export function buildKeybed(): KeyDefinition[] {
  const keys: KeyDefinition[] = [];
  let whiteCount = 0;
  let blackCount = 0;

  // Inverted mapping for quick display lookup
  const midiToKeyChar: Record<number, string> = {};
  for (const [char, midi] of Object.entries(COMPUTER_KEY_MAP)) {
    if (!midiToKeyChar[midi]) {
      midiToKeyChar[midi] = char.toUpperCase();
    }
  }

  for (let midi = KEYBED_CONFIG.startMidi; midi <= KEYBED_CONFIG.endMidi; midi++) {
    const noteInOctave = midi % 12;
    const isBlack = [1, 3, 6, 8, 10].includes(noteInOctave);
    const noteName = midiToNoteName(midi);
    const frequency = midiToFrequency(midi);

    if (isBlack) {
      keys.push({
        midi,
        noteName,
        isBlack: true,
        whiteIndex: whiteCount - 1, // position relative to preceding white key
        blackIndex: blackCount,
        keyBinding: midiToKeyChar[midi],
        frequency,
      });
      blackCount++;
    } else {
      keys.push({
        midi,
        noteName,
        isBlack: false,
        whiteIndex: whiteCount,
        keyBinding: midiToKeyChar[midi],
        frequency,
      });
      whiteCount++;
    }
  }

  return keys;
}

export const STAGE_4_73_KEYS = buildKeybed();
