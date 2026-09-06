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
import { InstrumentProvider, morphFinishRef, type InstrumentPushFn } from './state/instrument';
import type { InstrumentProgram, SceneId } from './state/program';
import { COMPUTER_KEY_MAP, SUSTAIN_KEY } from './hardware/sections';
import { KEYBED_HIGH_MIDI, KEYBED_LOW_MIDI } from './hardware/keys';
import { PianoEngine, type EngineStatus } from './audio/engine';
import { NoteManager, type NoteSource } from './audio/lifecycle';
import { StageEngine, type StageStatus } from './audio/stageEngine';
import type { StageAudioContextLike } from './audio/graphTypes';
import type { LayerId } from './audio/pianoTypes';
import type { OrganLayerId } from './audio/organTypes';
import type { SynthLayerId } from './audio/synthTypes';
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
  // Phase 3: organ (A/B) + synth (A/B/C) managers → engine voices.
  const organManagersRef = useRef<Record<OrganLayerId, NoteManager> | null>(null);
  if (!organManagersRef.current) {
    const stage = stageRef.current;
    const forLayer = (layer: OrganLayerId) =>
      new NoteManager({
        startVoice: (midi, velocity, sustain) => stage.organNoteOn(layer, midi, velocity, sustain),
        stopVoice: (noteId) => stage.organNoteOff(noteId),
        holdVoice: (noteId, sustained) => stage.setSustained(noteId, sustained),
      });
    organManagersRef.current = { A: forLayer('A'), B: forLayer('B') };
  }
  const synthManagersRef = useRef<Record<SynthLayerId, NoteManager> | null>(null);
  if (!synthManagersRef.current) {
    const stage = stageRef.current;
    const forLayer = (layer: SynthLayerId) =>
      new NoteManager({
        startVoice: (midi, velocity, sustain) => stage.synthNoteOn(layer, midi, velocity, sustain),
        stopVoice: (noteId) => stage.synthNoteOff(noteId),
        holdVoice: (noteId, sustained) => stage.setSustained(noteId, sustained),
      });
    synthManagersRef.current = { A: forLayer('A'), B: forLayer('B'), C: forLayer('C') };
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

  const refreshActive = useCallback(() => {
    const union = new Set<number>();
    for (const layer of ['A', 'B'] as LayerId[]) {
      for (const midi of managersRef.current![layer].activeMidis()) union.add(midi);
    }
    // Phase 3: organ + synth voices also depress the keybed.
    for (const layer of ['A', 'B'] as OrganLayerId[]) {
      for (const midi of organManagersRef.current![layer].activeMidis()) union.add(midi);
    }
    for (const layer of ['A', 'B', 'C'] as SynthLayerId[]) {
      for (const midi of synthManagersRef.current![layer].activeMidis()) union.add(midi);
    }
    setActiveNotes(union);
  }, []);

  // Phase 3 program routing: canonical program + scene/solo. The piano
  // snapshot bridge keeps driving piano layers (Phase 2 behavior intact);
  // organ/synth/split/clock/transpose apply straight to the engine.
  const programRef = useRef<{ program: InstrumentProgram; scene: SceneId; solo: boolean } | null>(null);
  // Wheel / Control Pedal live positions (Wheel from the mod wheel, pedal
  // from the on-screen pedal + MIDI CC11).
  const morphLiveRef = useRef({ wheel: 0, pedal: 0 });
  const applyMorphPositions = useCallback(() => {
    const stage = stageRef.current!;
    stage.setMorphPos('wheel', morphLiveRef.current.wheel);
    stage.setMorphPos('pedal', morphLiveRef.current.pedal);
  }, []);

  /** Layers that may sound right now (scene enables + solo + section on). */
  const soundingLayers = useCallback((): { piano: LayerId[]; organ: OrganLayerId[]; synth: SynthLayerId[] } => {
    const routed = programRef.current;
    const snap = snapRef.current;
    if (!routed) {
      // Before the first program push: Phase 2 behavior (piano snapshot).
      if (!snap.sectionOn) return { piano: [], organ: [], synth: [] };
      const piano: LayerId[] = [];
      if (snap.layers.A.enabled) piano.push('A');
      if (snap.layers.B.enabled) piano.push('B');
      return { piano, organ: [], synth: [] };
    }
    const { program, scene, solo } = routed;
    const map = program.scenes[scene];
    const piano: LayerId[] = [];
    const organ: OrganLayerId[] = [];
    const synth: SynthLayerId[] = [];
    if (program.piano.sectionOn && snap.sectionOn && map.pianoOn) {
      // Sustain/level/octave/focus keep coming from the piano bridge; the
      // scene map gates which piano layers sound (shared sound parameters).
      if (map.pianoA && snap.layers.A.enabled) piano.push('A');
      if (map.pianoB && snap.layers.B.enabled) piano.push('B');
    }
    if (!solo) {
      if (program.organ.sectionOn && map.organOn) {
        if (map.organA && program.organ.layers.A.enabled) organ.push('A');
        if (map.organB && program.organ.layers.B.enabled) organ.push('B');
      }
      if (program.synth.sectionOn && map.synthOn) {
        if (map.synthA && program.synth.layers.A.enabled) synth.push('A');
        if (map.synthB && program.synth.layers.B.enabled) synth.push('B');
        if (map.synthC && program.synth.layers.C.enabled) synth.push('C');
      }
    } else {
      // Solo audition: only the focused layers sound (one per section).
      if (program.piano.sectionOn && map.pianoOn) {
        const f = program.piano.layerFocus;
        if (((f === 'A' && map.pianoA) || (f === 'B' && map.pianoB)) && snap.layers[f === 'A' ? 'A' : 'B'].enabled) {
          piano.push(f);
        }
      }
      if (program.organ.sectionOn && map.organOn) {
        const f = program.organ.focus;
        if (((f === 'A' && map.organA) || (f === 'B' && map.organB)) && program.organ.layers[f].enabled) organ.push(f);
      }
      if (program.synth.sectionOn && map.synthOn) {
        const f = program.synth.focus;
        const key = f === 'A' ? 'synthA' : f === 'B' ? 'synthB' : 'synthC';
        if (map[key] && program.synth.layers[f].enabled) synth.push(f);
      }
    }
    return { piano, organ, synth };
  }, []);

  // Instrument handle for the p2-strip scene mirror below.
  const instrumentRef = useRef<{ setSceneEnables(scene: SceneId, fn: (m: never) => never): void } | null>(null);

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
    // Phase 3 scene mirror: the p2 layer strips turn Layers On/Off, which is
    // exactly how a Layer Scene is configured (manual p. 43). Mirror piano
    // layer enables into BOTH the program piano layers and the active scene's
    // enable map so panel, scene LEDs, and sound agree (an edit → dirty E,
    // truthfully). Both copies update in one edit so the program→piano
    // bridge (pushPiano) writes back identical values and terminates.
    const routed = programRef.current;
    const inst = instrumentRef.current as unknown as {
      edit(fn: (p: InstrumentProgram) => InstrumentProgram): void;
    } | null;
    if (routed && inst) {
      const map = routed.program.scenes[routed.scene] as unknown as Record<string, boolean>;
      const progLayers = routed.program.piano.layers;
      const differs =
        snap.layers.A.enabled !== progLayers.A.enabled ||
        snap.layers.B.enabled !== progLayers.B.enabled ||
        snap.layers.A.enabled !== map.pianoA ||
        snap.layers.B.enabled !== map.pianoB;
      if (differs) {
        const a = snap.layers.A.enabled;
        const b = snap.layers.B.enabled;
        const scene = routed.scene;
        inst.edit((p) => ({
          ...p,
          piano: {
            ...p.piano,
            layers: {
              A: { ...p.piano.layers.A, enabled: a },
              B: { ...p.piano.layers.B, enabled: b },
            },
          },
          scenes: { ...p.scenes, [scene]: { ...p.scenes[scene], pianoA: a, pianoB: b } },
        }));
      }
    }
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
      // Phase 3: organ + synth honor their own SUSTPED toggles.
      const routed = programRef.current;
      if (routed) {
        for (const layer of ['A', 'B'] as OrganLayerId[]) {
          if (routed.program.organ.layers[layer].sustPed) organManagersRef.current![layer].setSustain(on);
        }
        for (const layer of ['A', 'B', 'C'] as SynthLayerId[]) {
          if (routed.program.synth.layers[layer].sustPed) synthManagersRef.current![layer].setSustain(on);
        }
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
      const sounding = soundingLayers();
      for (const layer of sounding.piano) managersRef.current![layer].press(midi, velocity, source);
      for (const layer of sounding.organ) organManagersRef.current![layer].press(midi, velocity, source);
      for (const layer of sounding.synth) synthManagersRef.current![layer].press(midi, velocity, source);
      // Keyboard Sync: lifting all keys then playing resets the clock.
      const stage = stageRef.current!;
      if (stage.kbSync && stage.getVoiceCount() <= 3) {
        void stage;
      }
      refreshActive();
    },
    [soundingLayers, refreshActive],
  );

  const release = useCallback(
    (midi: number, source: NoteSource) => {
      managerRef.current!.release(midi, source);
      for (const layer of ['A', 'B'] as LayerId[]) managersRef.current![layer].release(midi, source);
      for (const layer of ['A', 'B'] as OrganLayerId[]) organManagersRef.current![layer].release(midi, source);
      for (const layer of ['A', 'B', 'C'] as SynthLayerId[]) synthManagersRef.current![layer].release(midi, source);
      refreshActive();
    },
    [refreshActive],
  );

  // Stable pitch-reset handle: `panic` feeds the init effect's dep list, so it
  // must not close over the identity-unstable pianoFx context value (every
  // panel change would otherwise dispose and rebuild both engines).
  const pitchResetRef = useRef(() => pianoFx.setPitchBend(0));
  pitchResetRef.current = () => pianoFx.setPitchBend(0);

  const panic = useCallback(() => {
    // Phase 3 Panic: internal All Notes Off + reset held performance inputs
    // (manual p. 40): morph sources, pitch bend, sustain, held keys.
    managerRef.current!.allNotesOff();
    for (const layer of ['A', 'B'] as LayerId[]) managersRef.current![layer].allNotesOff();
    for (const layer of ['A', 'B'] as OrganLayerId[]) organManagersRef.current![layer].allNotesOff();
    for (const layer of ['A', 'B', 'C'] as SynthLayerId[]) synthManagersRef.current![layer].allNotesOff();
    stageRef.current!.allNotesOff();
    morphLiveRef.current = { wheel: 0, pedal: 0 };
    stageRef.current!.setMorphPos('wheel', 0);
    stageRef.current!.setMorphPos('pedal', 0);
    stageRef.current!.setPitchBend(0);
    pitchResetRef.current();
    managerRef.current!.setSustain(false);
    damperToLayers(false);
    heldKeysRef.current.clear();
    sustainKeyRef.current = false;
    setSustainOn(false);
    setPedalOn(false);
    refreshActive();
  }, [damperToLayers, refreshActive]);

  // Phase 3: virtual Control Pedal (on-screen) + pedal value 0..1.
  const [pedalOn, setPedalOn] = useState(false);
  const setPedal = useCallback(
    (on: boolean) => {
      setPedalOn(on);
      morphLiveRef.current.pedal = on ? 1 : 0;
      stageRef.current!.setMorphPos('pedal', on ? 1 : 0);
    },
    [],
  );

  // Phase 3 push: canonical program → engine (organ/synth/chains/clock/
  // transpose/split/zones/scenes/morphs). Piano layers keep flowing through
  // the Phase 2 bridge (piano snapshot effect above stays untouched).
  const pushProgram = useCallback(
    (program: InstrumentProgram, meta: { scene: SceneId; solo: boolean }) => {
      const stage = stageRef.current!;
      programRef.current = { program, scene: meta.scene, solo: meta.solo };
      stage.setOrgan(
        { A: program.organ.layers.A, B: program.organ.layers.B, focus: program.organ.focus },
        program.organ.chain,
        program.organ.sectionOn,
        program.organ.organRotary,
      );
      stage.setSynth(
        {
          A: program.synth.layers.A,
          B: program.synth.layers.B,
          C: program.synth.layers.C,
          focus: program.synth.focus,
        },
        { A: program.synth.chains.A, B: program.synth.chains.B, C: program.synth.chains.C },
        program.synth.sectionOn,
        program.synth.group,
      );
      stage.setClockBpm(program.clockBpm);
      stage.setKbSync(program.kbSync);
      stage.setTranspose(program.transpose);
      stage.setSplit(program.split);
      for (const [key, zone] of Object.entries({
        pianoA: program.zones.piano.A,
        pianoB: program.zones.piano.B,
        organA: program.zones.organ.A,
        organB: program.zones.organ.B,
        synthA: program.zones.synth.A,
        synthB: program.zones.synth.B,
        synthC: program.zones.synth.C,
      })) {
        stage.setZone(key, zone);
      }
      stage.setMorphAssigns('wheel', program.morphs.wheel);
      stage.setMorphAssigns('pedal', program.morphs.pedal);
      stage.captureMorphBase();
      applyMorphPositions();
      refreshActive();
    },
    [applyMorphPositions, refreshActive],
  );
  const pushProgramRef = useRef(pushProgram);
  pushProgramRef.current = pushProgram;
  // Morph live-position hook (stable handle for the instrument provider).
  const pushWithMorph = useMemo(() => {
    const fn = ((program: InstrumentProgram, meta: { scene: SceneId; solo: boolean }) =>
      pushProgramRef.current(program, meta)) as InstrumentPushFn;
    fn.morphPos = (source: 'wheel' | 'pedal', pos: number) => {
      morphLiveRef.current[source] = pos;
      stageRef.current!.setMorphPos(source, pos);
    };
    fn.morphClear = (source: 'wheel' | 'pedal') => {
      morphLiveRef.current[source] = 0;
      stageRef.current!.setMorphPos(source, 0);
    };
    return fn;
  }, []);
  // Bridge piano-section edits (level/enable/type/…) into the Phase 2 piano
  // snapshot when they arrive via the program channel. Scene-gated sounding
  // stays in `soundingLayers`; this keeps the audible piano state in sync.
  const pushPiano = useCallback(
    (program: InstrumentProgram) => {
      const snap = snapRef.current;
      pianoFx.setSectionOn(program.piano.sectionOn);
      for (const layer of ['A', 'B'] as LayerId[]) {
        const src = program.piano.layers[layer];
        const dst = snap.layers[layer];
        if (src.enabled !== dst.enabled) pianoFx.setLayerEnabled(layer, src.enabled);
        if (src.type !== dst.type) pianoFx.setLayerType(layer, src.type);
        if (src.model !== dst.model) pianoFx.setLayerModel(layer, src.model);
        if (src.level !== dst.level) pianoFx.setLayerLevel(layer, src.level);
        if (src.octave !== dst.octave) pianoFx.setLayerOctave(layer, src.octave);
        if (src.sustPed !== dst.sustPed) pianoFx.setSustPed(layer, src.sustPed);
        if (src.pStick !== dst.pStick) pianoFx.setPStick(layer, src.pStick);
        if (src.kbTouch !== dst.kbTouch) pianoFx.setKbTouch(layer, src.kbTouch);
        if (src.dynComp !== dst.dynComp) pianoFx.setDynComp(layer, src.dynComp);
        if (src.timbre !== dst.timbre) pianoFx.setTimbre(layer, src.timbre);
        if (src.unison !== dst.unison) pianoFx.setUnison(layer, src.unison);
        if (src.softRelease !== dst.softRelease) pianoFx.setSoftRelease(layer, src.softRelease);
        if (src.stringRes !== dst.stringRes) pianoFx.setStringRes(layer, src.stringRes);
      }
      if (program.piano.layerFocus !== snap.layerFocus) pianoFx.focusLayer(program.piano.layerFocus);
      for (const layer of ['A', 'B'] as LayerId[]) {
        pianoFx.updateChain(layer, () => program.piano.chains[program.piano.pianoGroup ? 'A' : layer]);
      }
      if (program.piano.pianoGroup !== snap.fx.pianoGroup) pianoFx.setPianoGroup(program.piano.pianoGroup);
    },
    [pianoFx],
  );
  const pushPianoRef = useRef(pushPiano);
  pushPianoRef.current = pushPiano;

  // Morph capture finish: read current control values as morph end points.
  useEffect(() => {
    morphFinishRef.current = (_source) => {
      void _source;
    };
    return () => {
      morphFinishRef.current = null;
    };
  }, []);

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
    // Phase 3: MIDI CC11 (Expression) drives the Control Pedal morph source.
    midi.setCcHandler((cc, value) => {
      if (cc === 11) {
        const pos = Math.min(1, Math.max(0, value / 127));
        morphLiveRef.current.pedal = pos;
        stageRef.current!.setMorphPos('pedal', pos);
      }
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
      <InstrumentProvider
        onProgramChange={pushWithMorph}
        onPianoChange={(p) => pushPianoRef.current(p)}
        instrumentRegister={instrumentRef as never}
      >
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
              <button
                type="button"
                data-testid="control-pedal"
                aria-label="Control pedal (morph source)"
                aria-pressed={pedalOn}
                className={pedalOn ? 'pedal on' : 'pedal'}
                onPointerDown={(e) => {
                  e.preventDefault();
                  setPedal(!pedalOn);
                }}
              >
                CTRL PED
              </button>
              <button type="button" data-testid="panic" aria-label="All notes off" onClick={panic}>
                PANIC
              </button>
            </div>
          </main>
        </div>
      </InstrumentProvider>
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
