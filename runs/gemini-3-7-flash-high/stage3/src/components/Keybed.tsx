import React, { useState, useRef } from 'react';
import { STAGE_4_73_KEYS, KeyDefinition } from '../model/keyboard';
import { NoteLifecycle } from '../input/NoteLifecycle';

interface KeybedProps {
  lifecycle: NoteLifecycle;
  activeKeys: Set<number>;
}

export const Keybed: React.FC<KeybedProps> = ({ lifecycle, activeKeys }) => {
  const [isPointerActive, setIsPointerActive] = useState(false);
  const activeTouchPointers = useRef<Map<number, number>>(new Map()); // pointerId -> midi

  const whiteKeys = STAGE_4_73_KEYS.filter((k) => !k.isBlack);
  const blackKeys = STAGE_4_73_KEYS.filter((k) => k.isBlack);

  const handlePointerDown = (key: KeyDefinition, e: React.PointerEvent) => {
    if (typeof (e.currentTarget as HTMLElement).setPointerCapture === 'function') {
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // Safe
      }
    }
    setIsPointerActive(true);
    activeTouchPointers.current.set(e.pointerId, key.midi);
    // Calculate vertical position velocity (lower down on key = harder hit)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect?.() || { top: 0, height: 100 };
    const relY = rect.height > 0 ? Math.max(0.2, Math.min(1.0, (e.clientY - rect.top) / rect.height)) : 0.8;
    const velocity = 0.5 + relY * 0.5;
    lifecycle.noteOn(key.midi, 'pointer', velocity);
  };

  const handlePointerEnter = (key: KeyDefinition, e: React.PointerEvent) => {
    // If dragging across keys with pointer down (glissando)
    if (isPointerActive && e.buttons > 0) {
      activeTouchPointers.current.set(e.pointerId, key.midi);
      lifecycle.noteOn(key.midi, 'pointer', 0.8);
    }
  };

  const handlePointerLeave = (key: KeyDefinition, e: React.PointerEvent) => {
    if (activeTouchPointers.current.get(e.pointerId) === key.midi) {
      activeTouchPointers.current.delete(e.pointerId);
      lifecycle.noteOff(key.midi, 'pointer');
    }
  };

  const handlePointerUp = (key: KeyDefinition, e: React.PointerEvent) => {
    if (typeof (e.currentTarget as HTMLElement).releasePointerCapture === 'function') {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // Safe
      }
    }
    activeTouchPointers.current.delete(e.pointerId);
    lifecycle.noteOff(key.midi, 'pointer');
    if (activeTouchPointers.current.size === 0) {
      setIsPointerActive(false);
    }
  };

  const handlePointerCancel = (key: KeyDefinition, e: React.PointerEvent) => {
    if (typeof (e.currentTarget as HTMLElement).releasePointerCapture === 'function') {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // Safe
      }
    }
    activeTouchPointers.current.delete(e.pointerId);
    lifecycle.noteOff(key.midi, 'pointer');
    if (activeTouchPointers.current.size === 0) {
      setIsPointerActive(false);
    }
  };

  return (
    <div
      className="keybed-container"
      role="region"
      aria-label="Nord Stage 4 73-Key Hammer Action Keybed (E1 to E7)"
    >
      <div className="keybed-surface">
        {/* White keys layer */}
        <div className="white-keys-layer">
          {whiteKeys.map((key) => {
            const isActive = activeKeys.has(key.midi);
            return (
              <button
                key={key.midi}
                type="button"
                id={`key-${key.midi}`}
                role="button"
                tabIndex={0}
                aria-label={`Key ${key.noteName} (MIDI ${key.midi})`}
                aria-pressed={isActive}
                className={`key key-white ${isActive ? 'key-pressed' : ''}`}
                onPointerDown={(e) => handlePointerDown(key, e)}
                onPointerEnter={(e) => handlePointerEnter(key, e)}
                onPointerLeave={(e) => handlePointerLeave(key, e)}
                onPointerUp={(e) => handlePointerUp(key, e)}
                onPointerCancel={(e) => handlePointerCancel(key, e)}
              >
                <div className="key-bottom-lip" />
                {key.keyBinding && (
                  <span className="key-shortcut" aria-hidden="true">
                    {key.keyBinding}
                  </span>
                )}
                <span className="key-label" aria-hidden="true">
                  {key.noteName}
                </span>
              </button>
            );
          })}
        </div>

        {/* Black keys layer positioned over white keys */}
        <div className="black-keys-layer" aria-hidden="true">
          {blackKeys.map((key) => {
            const isActive = activeKeys.has(key.midi);
            // Position black key at the boundary of its preceding white key
            // 43 white keys -> each white key is 100% / 43 = ~2.32558% wide
            const whiteKeyWidthPercent = 100 / 43;
            // Center the black key over the border between whiteKey[whiteIndex] and whiteKey[whiteIndex+1]
            const leftPercent = (key.whiteIndex + 1) * whiteKeyWidthPercent;

            return (
              <button
                key={key.midi}
                type="button"
                id={`key-${key.midi}`}
                role="button"
                tabIndex={-1}
                aria-label={`Key ${key.noteName} (MIDI ${key.midi})`}
                aria-pressed={isActive}
                style={{
                  left: `${leftPercent}%`,
                  height: `61%`, // 0.61 blackKeyHeightFraction
                }}
                className={`key key-black ${isActive ? 'key-pressed' : ''}`}
                onPointerDown={(e) => handlePointerDown(key, e)}
                onPointerEnter={(e) => handlePointerEnter(key, e)}
                onPointerLeave={(e) => handlePointerLeave(key, e)}
                onPointerUp={(e) => handlePointerUp(key, e)}
                onPointerCancel={(e) => handlePointerCancel(key, e)}
              >
                <div className="black-key-ridge" />
                {key.keyBinding && (
                  <span className="key-shortcut shortcut-black" aria-hidden="true">
                    {key.keyBinding}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
