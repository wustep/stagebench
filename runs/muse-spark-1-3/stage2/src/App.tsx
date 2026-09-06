/**
 * Nord Stage 4 (73) — Phase 2: piano library + layer effects + master level.
 *
 * Phase 1 contract preserved: every inherited control ID, role, and behavior
 * is untouched (sections.tsx renders the Phase 1 grids first; the `p2-*`
 * functional strips are separate nodes after them). The keybed, computer-key
 * map, MIDI handling, sustain pedal, and panic paths keep their exact Phase 1
 * semantics; they now fan out into per-layer NoteManagers driving the
 * StageEngine (two piano layers with voice ownership).
 *
 * Organ / Synth / Program controls stay decorative (no audio coupling).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ControlDeck, Keybed } from './components/sections';
import { StageProvider } from './state/stage';
import { PianoFxProvider, defaultSnapshot, usePianoFx, type PianoFxSnapshot } from './state/pianoFx';
import { COMPUTER_KEY_MAP, SUSTAIN_KEY } from './hardware/sections';
import { KEYBED_HIGH_MIDI, KEYBED_LOW_MIDI } from './hardware/keys';
import { PianoEngine, type EngineStatus } from './audio/engine';
import { NoteManager, type NoteSource } from './audio/lifecycle';
import { StageEngine, type StageStatus } from './audio/stageEngine';
import type { StageAudioContextLike } from './audio/graphTypes';
import type { LayerId } from './audio/pianoTypes';
import { MidiManager, type MidiStatus } from './midi/midi';

export interface AppProps {
  /** Phase 1 engine (kept for the regression harness). */
  engineFactory?: () => PianoEngine;
  /** Phase 2 stage engine factory (tests inject fakes + memory fetch). */
  stageFactory?: () => StageEngine;
  snapshotFactory?: () => PianoFxSnapshot;
  midiProvider?: () => Promise<{ inputs: Map<string, unknown>; onstatechange?: unknown } | null>;
}

function defaultStageEngine(): StageEngine {
  const fetchImpl =
    typeof fetch !== 'undefined'
      ? async (url: string) => {
          const res = await fetch(url);
          return { ok: res.ok, status: res.status, arrayBuffer: () => res.arrayBuffer() };
        }
      : null;
  return new StageEngine({
    createContext: () => {
      if (typeof window === 'undefined') return null;
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      try {
        return new AC() as unknown as StageAudioContextLike;
      } catch {
        return null;
      }
    },
    fetchImpl,
    sampleBase: './samples',
    manifestUrl: './samples/manifest.json',
  });
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

function InnerApp(props: AppProps & { tapRegister?: React.MutableRefObject<StageEngine | null> }) {
  const pianoFx = usePianoFx();
  // Phase 1 engine (regression path — status shown, keybed input preserved).
  const engineRef = useRef<PianoEngine | null>(null);
  if (!engineRef.current) engineRef.current = props.engineFactory ? props.engineFactory() : defaultEngine();
  // Phase 2 stage engine (audible path).
  const stageRef = useRef<StageEngine | null>(null);
  if (!stageRef.current) stageRef.current = props.stageFactory ? props.stageFactory() : defaultStageEngine();
  useEffect(() => {
    if (props.tapRegister) props.tapRegister.current = stageRef.current;
  }, [props.tapRegister]);

  // Phase 1 lifecycle for the Phase 1 engine — byte-identical semantics
  // (per-source refcount, retrigger, sustain-aware release, all-notes-off).
  const managerRef = useRef<NoteManager | null>(null);
  if (!managerRef.current) {
    const engine = engineRef.current;
    managerRef.current = new NoteManager({
      startVoice: (midi, velocity, sustain) => engine.noteOn(midi, velocity, sustain),
      stopVoice: (noteId) => engine.noteOff(noteId),
      holdVoice: (noteId, sustained) => engine.setSustained(noteId, sustained),
    });
  }
  // Per-layer managers → stage engine voices (ownership per layer).
  const managersRef = useRef<Record<LayerId, NoteManager> | null>(null);
  if (!managersRef.current) {
    const stage = stageRef.current;
    const forLayer = (layer: LayerId) =>
      new NoteManager({
        startVoice: (midi, velocity, sustain) => stage.noteOn(layer, midi, velocity, sustain),
        stopVoice: (noteId) => stage.noteOff(noteId),
        holdVoice: (noteId, sustained) => stage.setSustained(noteId, sustained),
      });
    managersRef.current = { A: forLayer('A'), B: forLayer('B') };
  }

  const [engineStatus, setEngineStatus] = useState<EngineStatus>('idle');
  const [engineDetail, setEngineDetail] = useState('Preparing piano voice…');
  const [stageStatus, setStageStatus] = useState<StageStatus>('idle');
  const [stageDetail, setStageDetail] = useState('Loading piano library…');
  const [midiStatus, setMidiStatus] = useState<MidiStatus>('pending');
  const [midiDetail, setMidiDetail] = useState('MIDI: checking for devices…');
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [sustainOn, setSustainOn] = useState(false);
  const heldKeysRef = useRef(new Map<string, number>());
  const sustainKeyRef = useRef(false);
  const snapRef = useRef(pianoFx.snapshot);
  snapRef.current = pianoFx.snapshot;

  const activeLayers = useCallback((): LayerId[] => {
    const snap = snapRef.current;
    if (!snap.sectionOn) return [];
    const out: LayerId[] = [];
    if (snap.layers.A.enabled) out.push('A');
    if (snap.layers.B.enabled) out.push('B');
    return out;
  }, []);

  const refreshActive = useCallback(() => {
    const union = new Set<number>();
    for (const layer of ['A', 'B'] as LayerId[]) {
      for (const midi of managersRef.current![layer].activeMidis()) union.add(midi);
    }
    setActiveNotes(union);
  }, []);

  // Push audible state into the stage engine whenever panels change.
  // Section-off mutes the piano section: stop stage voices immediately so
  // held notes never drone under a dark panel.
  useEffect(() => {
    const stage = stageRef.current!;
    const snap = pianoFx.snapshot;
    if (!snap.sectionOn) stage.allNotesOff();
    stage.setLayers({ A: snap.layers.A, B: snap.layers.B, focus: snap.layerFocus });
    stage.setChains(snap.chains, snap.fx);
    stage.setMasterLevel(snap.masterLevel);
    stage.setRotary(snap.rotarySpeed, snap.rotaryDrive);
    stage.setPitchBend(snap.pitchBendSt);
    refreshActive();
  }, [pianoFx.snapshot, refreshActive]);

  // Stable reporter handle: the init effect below must NOT depend on the
  // (identity-unstable) context value, or every panel change would dispose
  // and rebuild both engines.
  const reportFailedRef = useRef((failed: string[]) => pianoFx.setLoadFailed(failed));
  reportFailedRef.current = (failed: string[]) => pianoFx.setLoadFailed(failed);

  // Report sample-asset failures to the labeled fallback UI.
  useEffect(() => {
    const stage = stageRef.current!;
    const t = setInterval(() => {
      const failed = stage.getSampleLibrary().failed;
      if (failed.length > 0 && snapRef.current.loadFailed.length === 0) {
        reportFailedRef.current(failed);
      }
    }, 500);
    return () => clearInterval(t);
  }, []);

  const damperToLayers = useCallback(
    (on: boolean) => {
      // Phase 1 engine keeps ungated sustain (regression); piano layers honor SUSTPED.
      managerRef.current!.setSustain(on);
      const snap = snapRef.current;
      for (const layer of ['A', 'B'] as LayerId[]) {
        if (snap.layers[layer].sustPed) managersRef.current![layer].setSustain(on);
      }
    },
    [],
  );

  const setSustain = useCallback(
    (on: boolean) => {
      damperToLayers(on);
      setSustainOn(on);
      refreshActive();
    },
    [damperToLayers, refreshActive],
  );

  const press = useCallback(
    (midi: number, velocity: number, source: NoteSource) => {
      if (midi < KEYBED_LOW_MIDI || midi > KEYBED_HIGH_MIDI) return;
      managerRef.current!.press(midi, velocity, source);
      for (const layer of activeLayers()) managersRef.current![layer].press(midi, velocity, source);
      refreshActive();
    },
    [activeLayers, refreshActive],
  );

  const release = useCallback(
    (midi: number, source: NoteSource) => {
      managerRef.current!.release(midi, source);
      for (const layer of ['A', 'B'] as LayerId[]) managersRef.current![layer].release(midi, source);
      refreshActive();
    },
    [refreshActive],
  );

  const panic = useCallback(() => {
    managerRef.current!.allNotesOff();
    for (const layer of ['A', 'B'] as LayerId[]) managersRef.current![layer].allNotesOff();
    stageRef.current!.allNotesOff();
    heldKeysRef.current.clear();
    sustainKeyRef.current = false;
    setSustainOn(managerRef.current!.isSustained());
    refreshActive();
  }, [refreshActive]);

  // Engine + MIDI init (injectable for tests).
  useEffect(() => {
    const engine = engineRef.current!;
    const stage = stageRef.current!;
    let cancelled = false;
    void engine.init().then((status) => {
      if (cancelled) return;
      setEngineStatus(status);
      setEngineDetail(engine.getStatusDetail());
    });
    void stage.init().then((status) => {
      if (cancelled) return;
      setStageStatus(status);
      setStageDetail(stage.getStatusDetail());
      const failed = stage.getSampleLibrary().failed;
      if (failed.length > 0) reportFailedRef.current(failed);
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
      for (const layer of ['A', 'B'] as LayerId[]) managersRef.current![layer].allNotesOff();
      void engine.dispose();
      void stage.dispose();
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

  // Pitch stick: held arrows bend PSTICK-gated layers ±2 st while held.
  const bendRef = useRef((st: number) => pianoFx.setPitchBend(st));
  bendRef.current = (st: number) => pianoFx.setPitchBend(st);
  useEffect(() => {
    const bendDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.closest?.('[role="slider"]') || target.closest?.('input,textarea'))) return;
      e.preventDefault();
      bendRef.current(e.key === 'ArrowUp' ? 2 : -2);
    };
    const bendUp = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      bendRef.current(0);
    };
    window.addEventListener('keydown', bendDown);
    window.addEventListener('keyup', bendUp);
    return () => {
      window.removeEventListener('keydown', bendDown);
      window.removeEventListener('keyup', bendUp);
    };
  }, []);

  const statusText = useMemo(() => {
    if (engineStatus === 'ready') return 'Piano ready';
    if (engineStatus === 'fallback') return 'Silent fallback — keys track visually';
    if (engineStatus === 'error') return 'Piano voice error';
    return 'Loading piano…';
  }, [engineStatus]);

  const stageText = useMemo(() => {
    if (stageStatus === 'ready') return 'Library ready';
    if (stageStatus === 'fallback') return 'Sample fallback — synth voices in use';
    if (stageStatus === 'error') return 'Library error';
    return 'Loading piano library…';
  }, [stageStatus]);

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
            <span data-testid="stage-status" data-status={stageStatus}>
              {stageText}: {stageDetail}
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

export default function App(props: AppProps) {
  const [initial] = useState<PianoFxSnapshot>(() => (props.snapshotFactory ? props.snapshotFactory() : defaultSnapshot()));
  const stageForTap = useRef<StageEngine | null>(null);
  const handleTap = useCallback((layer: LayerId) => {
    // Resolved lazily: the InnerApp engine registers itself on mount.
    const stage = stageForTap.current;
    if (!stage) return 320;
    return stage.tapTempo(layer);
  }, []);
  return (
    <PianoFxProvider initial={initial} onTap={handleTap}>
      <InnerApp {...props} tapRegister={stageForTap} />
    </PianoFxProvider>
  );
}
