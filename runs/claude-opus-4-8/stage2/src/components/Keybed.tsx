import { useCallback } from 'react';
import { KEYS, WHITE_KEYS, KEYBED, type KeyModel } from '../model/keybed';

interface KeybedProps {
  activeNotes: ReadonlySet<number>;
  onNoteDown: (owner: string, midi: number, velocity: number) => void;
  onNoteUp: (owner: string, midi: number) => void;
}

const WHITE_COUNT = WHITE_KEYS.length; // 43
const BLACK_HEIGHT = KEYBED.blackKeyHeightFraction; // 0.61

/**
 * The 73-key keybed. White keys tile the full width; black keys are absolutely
 * positioned over the gaps at 61% height. Each key is a button (accessible name
 * + pressed state) and also handles pointer/touch directly so multi-touch is
 * independent (owner = "pointer:<pointerId>").
 */
export function Keybed({ activeNotes, onNoteDown, onNoteUp }: KeybedProps) {
  const whiteWidthPct = 100 / WHITE_COUNT;

  const handleDown = useCallback(
    (e: React.PointerEvent, key: KeyModel) => {
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      onNoteDown(`pointer:${e.pointerId}`, key.midi, 100);
    },
    [onNoteDown],
  );

  const handleUp = useCallback(
    (e: React.PointerEvent, key: KeyModel) => {
      onNoteUp(`pointer:${e.pointerId}`, key.midi);
    },
    [onNoteUp],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, key: KeyModel) => {
      if (e.repeat) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onNoteDown(`kbd:${key.midi}`, key.midi, 100);
      }
    },
    [onNoteDown],
  );

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent, key: KeyModel) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onNoteUp(`kbd:${key.midi}`, key.midi);
      }
    },
    [onNoteUp],
  );

  return (
    <div
      className="keybed"
      role="group"
      aria-label={`${KEYBED.totalKeys}-key keybed, ${KEYS[0].name} to ${KEYS[KEYS.length - 1].name}`}
      onPointerLeave={() => {
        /* pointer leaving the keybed while dragging: capture keeps ownership,
           but a lost pointer (e.g. blur) is cleaned up at the app level */
      }}
    >
      {/* White keys */}
      <div className="white-keys">
        {WHITE_KEYS.map((key) => {
          const active = activeNotes.has(key.midi);
          return (
            <button
              key={key.id}
              type="button"
              className={`key white ${active ? 'active' : ''}`}
              style={{ width: `${whiteWidthPct}%` }}
              aria-label={`Play ${key.name}`}
              aria-pressed={active}
              data-midi={key.midi}
              data-key-id={key.id}
              onPointerDown={(e) => handleDown(e, key)}
              onPointerUp={(e) => handleUp(e, key)}
              onPointerCancel={(e) => handleUp(e, key)}
              onKeyDown={(e) => handleKeyDown(e, key)}
              onKeyUp={(e) => handleKeyUp(e, key)}
            />
          );
        })}
      </div>

      {/* Black keys, positioned over the white-key grid */}
      <div className="black-keys" aria-hidden="false">
        {KEYS.filter((k) => k.isBlack).map((key) => {
          const active = activeNotes.has(key.midi);
          // Center the black key on the boundary between its left white key and
          // the next: left white index + ~0.68 of a white-key width.
          const leftPct = (key.whiteIndex + 0.68) * whiteWidthPct;
          return (
            <button
              key={key.id}
              type="button"
              className={`key black ${active ? 'active' : ''}`}
              style={{
                left: `${leftPct}%`,
                width: `${whiteWidthPct * 0.62}%`,
                height: `${BLACK_HEIGHT * 100}%`,
              }}
              aria-label={`Play ${key.name}`}
              aria-pressed={active}
              data-midi={key.midi}
              data-key-id={key.id}
              onPointerDown={(e) => handleDown(e, key)}
              onPointerUp={(e) => handleUp(e, key)}
              onPointerCancel={(e) => handleUp(e, key)}
              onKeyDown={(e) => handleKeyDown(e, key)}
              onKeyUp={(e) => handleKeyUp(e, key)}
            />
          );
        })}
      </div>
    </div>
  );
}
