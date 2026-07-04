import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PianoEngine, type PianoStatus } from '../audio/pianoEngine';
import { createWebAudioBackend } from '../audio/webAudioBackend';
import type { AudioBackend } from '../audio/types';
import { NoteRouter } from '../input/noteRouter';

export interface PianoApi {
  router: NoteRouter;
  status: PianoStatus;
  activeNotes: ReadonlySet<number>;
  /** Resume the audio context on first user gesture. */
  ensureRunning: () => void;
}

/**
 * Wires a PianoEngine + NoteRouter to React. The audio backend is created
 * lazily and only in a browser with AudioContext; if construction fails we
 * enter a truthful "error"/"fallback" status instead of pretending to work.
 * A backend can be injected for tests.
 */
export function usePiano(injected?: AudioBackend): PianoApi {
  const [status, setStatus] = useState<PianoStatus>('loading');
  const [activeNotes, setActiveNotes] = useState<ReadonlySet<number>>(new Set());
  const backendRef = useRef<AudioBackend | null>(null);

  const { engine, router } = useMemo(() => {
    let backend = injected ?? null;
    if (!backend) {
      try {
        if (typeof AudioContext !== 'undefined') {
          backend = createWebAudioBackend();
        }
      } catch {
        backend = null;
      }
    }
    if (!backend) {
      // No audio available: honest fallback state, silent but still tracks notes.
      const eng = new PianoEngine({
        now: 0,
        state: 'suspended',
        resume: async () => {},
        createTone: () => ({
          start() {},
          rampGain() {},
          holdGain() {},
          stop() {},
          stopped: false,
        }),
        activeToneCount: 0,
        close: async () => {},
      });
      eng.setStatus('fallback');
      return { engine: eng, router: new NoteRouter(eng) };
    }
    backendRef.current = backend;
    const eng = new PianoEngine(backend);
    return { engine: eng, router: new NoteRouter(eng) };
  }, [injected]);

  useEffect(() => {
    if (engine.getStatus() !== 'fallback') {
      engine.markReady();
      setStatus('ready');
    } else {
      setStatus('fallback');
    }
    const unsub = router.subscribe((notes) => setActiveNotes(notes));
    return () => {
      unsub();
      router.panic();
      engine.dispose();
    };
  }, [engine, router]);

  const ensureRunning = useCallback(() => {
    backendRef.current?.resume().catch(() => {});
  }, []);

  return { router, status, activeNotes, ensureRunning };
}
