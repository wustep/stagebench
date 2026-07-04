import React, { useCallback, useMemo } from 'react';
import { NoteLifecycle } from '../audio/note-lifecycle';
import { Variant, KeyboardNote } from '../types';
import '../styles/keyboard.css';

interface KeyboardProps {
  variant: Variant;
  noteLifecycle: NoteLifecycle;
  pressedKeys: Set<number>;
  onKeyStateChange?: (note: number, pressed: boolean) => void;
}

// Calculate keyboard geometry based on variant
function calculateKeyboardGeometry(variant: Variant) {
  const whiteKeyWidth = 1;
  const blackKeyWidth = 0.6;
  const whiteKeyHeight = 3;
  const blackKeyHeight = whiteKeyHeight * 0.61;

  const totalWhiteWidth = variant.whiteKeys * whiteKeyWidth;

  return {
    whiteKeyWidth,
    blackKeyWidth,
    whiteKeyHeight,
    blackKeyHeight,
    totalWhiteWidth,
  };
}

// Generate keyboard notes for the variant
function generateKeyboardNotes(variant: Variant): KeyboardNote[] {
  const notes: KeyboardNote[] = [];
  const noteNames = [
    'C',
    'C#',
    'D',
    'D#',
    'E',
    'F',
    'F#',
    'G',
    'G#',
    'A',
    'A#',
    'B',
  ];

  // Stage 4 73: E to E (28 to 100)
  // Determine starting note from range
  let startNote = 28; // E1 for stage-4-73
  if (variant.range === 'A to C') {
    startNote = 21; // A0 for stage-4-88
  }

  for (let i = 0; i < variant.keyCount; i++) {
    const note = startNote + i;
    const octave = Math.floor(note / 12);
    const noteName = noteNames[note % 12];
    const isBlack =
      noteName.includes('#') || noteName === 'D#' || noteName.includes('b');

    notes.push({
      note,
      octave,
      naturalName: noteName,
      isBlack,
    });
  }

  return notes;
}

// Keyboard key component
interface KeyProps {
  keyNote: KeyboardNote;
  isPressed: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseUp: (e: React.MouseEvent) => void;
  onMouseLeave: (e: React.MouseEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
  geometry: ReturnType<typeof calculateKeyboardGeometry>;
}

function Key({
  keyNote,
  isPressed,
  onMouseDown,
  onMouseUp,
  onMouseLeave,
  onTouchStart,
  onTouchEnd,
}: Omit<KeyProps, 'geometry'>) {
  const baseClass = keyNote.isBlack ? 'key black-key' : 'key white-key';
  const pressedClass = isPressed ? 'pressed' : '';

  if (keyNote.isBlack) {
    return (
      <div
        className={`${baseClass} ${pressedClass}`}
        data-note={keyNote.note}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        role="button"
        tabIndex={0}
        aria-label={`${keyNote.naturalName}${keyNote.octave}`}
      />
    );
  }

  return (
    <div
      className={`${baseClass} ${pressedClass}`}
      data-note={keyNote.note}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      role="button"
      tabIndex={0}
      aria-label={`${keyNote.naturalName}${keyNote.octave}`}
    >
      <span className="key-label">
        {keyNote.naturalName}
        {keyNote.octave}
      </span>
    </div>
  );
}

export const Keyboard: React.FC<KeyboardProps> = ({
  variant,
  noteLifecycle,
  pressedKeys,
  onKeyStateChange,
}) => {
  const keyboardNotes = useMemo(() => generateKeyboardNotes(variant), [variant]);

  const handleKeyDown = useCallback(
    (keyNote: KeyboardNote, e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      if (!pressedKeys.has(keyNote.note)) {
        pressedKeys.add(keyNote.note);
        noteLifecycle.pointerNoteOn(keyNote.note, keyNote.note, 64);
        onKeyStateChange?.(keyNote.note, true);
      }
    },
    [pressedKeys, noteLifecycle, onKeyStateChange]
  );

  const handleKeyUp = useCallback(
    (keyNote: KeyboardNote, e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      if (pressedKeys.has(keyNote.note)) {
        pressedKeys.delete(keyNote.note);
        noteLifecycle.pointerNoteOff(keyNote.note);
        onKeyStateChange?.(keyNote.note, false);
      }
    },
    [pressedKeys, noteLifecycle, onKeyStateChange]
  );

  return (
    <div className="keyboard-container" role="group" aria-label="Piano keyboard">
      <div className="keyboard">
        {keyboardNotes.map((keyNote) => (
          <Key
            key={keyNote.note}
            keyNote={keyNote}
            isPressed={pressedKeys.has(keyNote.note)}
            onMouseDown={(e) => handleKeyDown(keyNote, e)}
            onMouseUp={(e) => handleKeyUp(keyNote, e)}
            onMouseLeave={(e) => handleKeyUp(keyNote, e)}
            onTouchStart={(e) => handleKeyDown(keyNote, e)}
            onTouchEnd={(e) => handleKeyUp(keyNote, e)}
          />
        ))}
      </div>
    </div>
  );
};
