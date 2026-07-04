import { useEffect } from 'react';
import type { NoteRouter } from '../input/noteRouter';
import { DEFAULT_KEYBOARD_MAP } from '../input/keyboardMap';

/**
 * Computer-keyboard note input. Repeat suppression is handled by tracking which
 * codes are currently down (the OS autorepeat fires keydown repeatedly). On
 * window blur every keyboard-owned note is released so nothing hangs.
 *
 * Owner tags are "kbd:<midi>" so the router can release exactly these notes on
 * blur without touching pointer/MIDI notes.
 */
export function useKeyboardInput(
  router: NoteRouter,
  enabled: boolean,
  onGesture: () => void,
  map: ReadonlyMap<string, number> = DEFAULT_KEYBOARD_MAP,
): void {
  useEffect(() => {
    if (!enabled) return;
    const down = new Set<string>();

    const isTypingTarget = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return; // repeat suppression
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const midi = map.get(e.code);
      if (midi === undefined) return;
      if (down.has(e.code)) return;
      down.add(e.code);
      onGesture();
      router.noteOn(`kbd:${midi}`, midi, 100);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const midi = map.get(e.code);
      if (midi === undefined) return;
      if (!down.has(e.code)) return;
      down.delete(e.code);
      router.noteOff(`kbd:${midi}`, midi);
    };

    const releaseAll = () => {
      for (const code of down) {
        const midi = map.get(code);
        if (midi !== undefined) router.noteOff(`kbd:${midi}`, midi);
      }
      down.clear();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', releaseAll);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', releaseAll);
      releaseAll();
    };
  }, [router, enabled, onGesture, map]);
}
