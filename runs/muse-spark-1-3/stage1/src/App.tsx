/**
 * Nord Stage 4 (73) — Phase 1: complete decorative surface + one basic piano
 * voice on the keybed. Panel controls are presentation-only; only keybed
 * notes and sustain input are functional.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ControlDeck, Keybed } from './components/sections';
import { StageProvider } from './state/stage';
import { COMPUTER_KEY_MAP, SUSTAIN_KEY } from './hardware/sections';
import { KEYBED_HIGH_MIDI, KEYBED_LOW_MIDI } from './hardware/keys';
import { PianoEngine, type EngineStatus } from './audio/engine';
import { NoteManager, type NoteSource } from './audio/lifecycle';
import { MidiManager, type MidiStatus } from './midi/midi';

export interface AppProps {
  engineFactory?: () => PianoEngine;
  midiProvider?: () => Promise<{ inputs: Map<string, unknown>; onstatechange?: unknown } | null>;
}

function defaultEngine(): PianoEngine {
  return new PianoEngine({
    createContext: () => {
      const AC =
        typeof window !== 'undefined'
          ? (window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
          : undefined;
      if (!AC) return null;
      try {
        return new AC() as unknown as Parameters<typeof PianoEngine.prototype.noteOn> extends never
          ? never
          : import('./audio/types').AudioContextLike;
      } catch {
        return null;
      }
    },
  });
}

export default function App(props: AppProps) {
  const engineRef = useRef<PianoEngine | null>(null);
  if (!engineRef.current) engineRef.current = props.engineFactory ? props.engineFactory() : defaultEngine();
  const managerRef = useRef<NoteManager | null>(null);
  if (!managerRef.current) {
    const engine = engineRef.current;
    managerRef.current = new NoteManager({
      startVoice: (midi, velocity, sustain) => engine.noteOn(midi, velocity, sustain),
      stopVoice: (noteId) => engine.noteOff(noteId),
      holdVoice: (noteId, sustained) => engine.setSustained(noteId, sustained),
    });
  }

  const [engineStatus, setEngineStatus] = useState<EngineStatus>('idle');
  const [engineDetail, setEngineDetail] = useState('Preparing piano voice…');
  const [midiStatus, setMidiStatus] = useState<MidiStatus>('pending');
  const [midiDetail, setMidiDetail] = useState('MIDI: checking for devices…');
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [sustainOn, setSustainOn] = useState(false);
  const heldKeysRef = useRef(new Map<string, number>());
  const sustainKeyRef = useRef(false);

  const refreshActive = useCallback(() => {
    setActiveNotes(new Set(managerRef.current!.activeMidis()));
  }, []);

  const setSustain = useCallback(
    (on: boolean) => {
      managerRef.current!.setSustain(on);
      setSustainOn(on);
      refreshActive();
    },
    [refreshActive],
  );

  const press = useCallback(
    (midi: number, velocity: number, source: NoteSource) => {
      if (midi < KEYBED_LOW_MIDI || midi > KEYBED_HIGH_MIDI) return;
      managerRef.current!.press(midi, velocity, source);
      refreshActive();
    },
    [refreshActive],
  );

  const release = useCallback(
    (midi: number, source: NoteSource) => {
      managerRef.current!.release(midi, source);
      refreshActive();
    },
    [refreshActive],
  );

  const panic = useCallback(() => {
    managerRef.current!.allNotesOff();
    heldKeysRef.current.clear();
    sustainKeyRef.current = false;
    setSustainOn(managerRef.current!.isSustained());
    refreshActive();
  }, [refreshActive]);

  // Engine + MIDI init (injectable for tests).
  useEffect(() => {
    const engine = engineRef.current!;
    let cancelled = false;
    void engine.init().then((status) => {
      if (cancelled) return;
      setEngineStatus(status);
      setEngineDetail(engine.getStatusDetail());
    });
    const provider =
      props.midiProvider ??
      (() => {
        const nav = navigator as Navigator & {
          requestMIDIAccess?: () => Promise<{ inputs: Map<string, never> }>;
        };
        if (!nav.requestMIDIAccess) return Promise.resolve(null as never);
        return nav.requestMIDIAccess();
      });
    const midi = new MidiManager(provider as () => Promise<never>, {
      onNoteOn: (m, v) => press(m, v, 'midi'),
      onNoteOff: (m) => release(m, 'midi'),
      onSustainChange: (on) => setSustain(on),
      onStatusChange: (status, detail) => {
        setMidiStatus(status);
        setMidiDetail(detail);
      },
    });
    void midi.init();
    const onBlur = () => panic();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') panic();
    };
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      midi.dispose();
      managerRef.current!.allNotesOff();
      void engine.dispose();
    };
  }, [panic, press, release, setSustain, props.midiProvider]);

  // Computer-keyboard input with repeat suppression + blur cleanup.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const inField = tag === 'input' || tag === 'textarea' || target?.isContentEditable;
      if (e.key === SUSTAIN_KEY && !inField) {
        e.preventDefault();
        if (!sustainKeyRef.current) {
          sustainKeyRef.current = true;
          setSustain(true);
        }
        return;
      }
      const key = e.key.toLowerCase();
      const midi = COMPUTER_KEY_MAP[key];
      if (midi === undefined || e.repeat || heldKeysRef.current.has(key)) return;
      if (inField) return;
      heldKeysRef.current.set(key, midi);
      press(midi, 96, 'keyboard');
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === SUSTAIN_KEY) {
        if (sustainKeyRef.current) {
          sustainKeyRef.current = false;
          setSustain(false);
        }
        return;
      }
      const key = e.key.toLowerCase();
      const midi = heldKeysRef.current.get(key);
      if (midi === undefined) return;
      heldKeysRef.current.delete(key);
      release(midi, 'keyboard');
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [press, release, setSustain]);

  const statusText = useMemo(() => {
    if (engineStatus === 'ready') return 'Piano ready';
    if (engineStatus === 'fallback') return 'Silent fallback — keys track visually';
    if (engineStatus === 'error') return 'Piano voice error';
    return 'Loading piano…';
  }, [engineStatus]);

  return (
    <StageProvider>
      <div className="page" data-testid="page">
        <main className="instrument" data-testid="instrument" aria-label="Nord Stage 4 73">
          <div className="toprail" aria-hidden="true" />
          <ControlDeck />
          <Keybed
            activeNotes={activeNotes}
            onPress={(midi, velocity, source) => press(midi, velocity, source)}
            onRelease={(midi, source) => release(midi, source)}
          />
          <div className="statusbar" role="status" aria-label="Piano status">
            <span data-testid="engine-status" data-status={engineStatus}>
              {statusText}: {engineDetail}
            </span>
            <span data-testid="midi-status" data-status={midiStatus}>
              {midiDetail}
            </span>
            <button
              type="button"
              data-testid="sustain-pedal"
              aria-label="Sustain pedal"
              aria-pressed={sustainOn}
              className={sustainOn ? 'pedal on' : 'pedal'}
              onPointerDown={(e) => {
                e.preventDefault();
                setSustain(!sustainOn);
              }}
            >
              SUSTAIN
            </button>
            <button type="button" data-testid="panic" aria-label="All notes off" onClick={panic}>
              PANIC
            </button>
          </div>
        </main>
      </div>
    </StageProvider>
  );
}
