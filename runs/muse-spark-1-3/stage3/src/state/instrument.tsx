/**
 * Phase 3 instrument state: programs (32 slots + 8 Live), Store/Store As
 * with naming, dirty E lifecycle, edit-discard on program change (with
 * single-level undo), splits/zones/crossfades, scenes I/II, Wheel + Control
 * Pedal morphs (arm/capture/interpolate/clear), Master Clock, Transpose,
 * Solo audition, and the unsupported-controls list.
 *
 * The provider owns the canonical `InstrumentProgram` being edited plus the
 * slot/live stores; an `onProgramChange` hook pushes piano/organ/synth/fx
 * state into the `StageEngine`, and `onPianoChange` pushes piano edits back
 * into the existing PianoFx state (bridging, no duplicate controls).
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
  LIVE_SLOTS,
  PROGRAM_SLOTS,
  UNSUPPORTED_CONTROLS,
  clampBpm,
  clampTranspose,
  cloneProgram,
  defaultProgram,
  factoryPrograms,
  readMorphTarget,
  slotLabel,
  type ChainKey,
  type InstrumentProgram,
  type MorphSource,
  type SceneId,
  type SplitPosId,
  type CrossfadeWidth,
  type ZoneRange,
} from './program';
import type { ChainState, FocusState } from './fxTypes';
import type { LayerPianoState } from '../audio/pianoTypes';
import type { OrganLayerId } from '../audio/organTypes';
import type { SynthLayerId } from '../audio/synthTypes';

export interface StoreDraft {
  /** Pending destination slot (auditioning while browsing). */
  dest: number;
  /** Pending destination Live slot (null = regular bank). */
  liveDest: number | null;
  naming: boolean;
  name: string;
}

export interface InstrumentSnapshot {
  program: InstrumentProgram;
  slot: number;
  page: number;
  liveMode: boolean;
  liveSlot: number;
  dirty: boolean;
  storeDraft: StoreDraft | null;
  /** Undo available after a program change discarded edits. */
  undoLabel: string | null;
  scene: SceneId;
  solo: boolean;
  listView: boolean;
  storeFlash: string | null;
}

export interface InstrumentPushFn {
  (program: InstrumentProgram, snap: { scene: SceneId; solo: boolean }): void;
  morphPos?: (source: MorphSource, pos: number) => void;
  morphClear?: (source: MorphSource) => void;
}

export function defaultInstrumentSnapshot(): InstrumentSnapshot {
  const factories = factoryPrograms();
  void factories;
  return {
    program: defaultProgram('Init'),
    slot: 0,
    page: 1,
    liveMode: false,
    liveSlot: 0,
    dirty: false,
    storeDraft: null,
    undoLabel: null,
    scene: 'I',
    solo: false,
    listView: false,
    storeFlash: null,
  };
}

export interface SlotStores {
  programs: InstrumentProgram[];
  live: InstrumentProgram[];
}

export function defaultStores(): SlotStores {
  const factories = factoryPrograms();
  const programs: InstrumentProgram[] = [];
  for (let i = 0; i < PROGRAM_SLOTS; i += 1) {
    programs.push(cloneProgram(factories[i % factories.length]));
  }
  // Give the first slots the factory names in order; remaining slots init.
  for (let i = 0; i < factories.length && i < PROGRAM_SLOTS; i += 1) {
    programs[i] = cloneProgram(factories[i]);
  }
  for (let i = factories.length; i < PROGRAM_SLOTS; i += 1) {
    programs[i] = defaultProgram(`Init ${slotLabel(i)}`);
  }
  const live: InstrumentProgram[] = [];
  for (let i = 0; i < LIVE_SLOTS; i += 1) live.push(defaultProgram(`Live ${i + 1}`));
  return { programs, live };
}

/** Live-only morph source positions (performance state: never stored, never dirty). */
const morphLivePos: Record<MorphSource, number> = { wheel: 0, pedal: 0 };

export function getMorphLivePos(source: MorphSource): number {
  return morphLivePos[source];
}

interface InstrumentContextValue {
  snapshot: InstrumentSnapshot;
  stores: SlotStores;
  unsupported: typeof UNSUPPORTED_CONTROLS;
  getMorphPos(source: MorphSource): number;
  // Selection / pages / list.
  selectSlot(slot: number): void;
  setPage(page: number): void;
  dialProgram(delta: number): void;
  setLiveMode(on: boolean): void;
  selectLive(slot: number): void;
  setListView(on: boolean): void;
  // Store lifecycle.
  beginStore(asNaming: boolean): void;
  setStoreDest(dest: number, liveDest: number | null): void;
  setStoreName(name: string): void;
  confirmStore(): void;
  cancelStore(): void;
  undo(): void;
  // Scenes / solo.
  setScene(scene: SceneId): void;
  setSolo(on: boolean): void;
  // Program edits (each marks dirty; Live auto-stores).
  edit(fn: (p: InstrumentProgram) => InstrumentProgram): void;
  editPianoLayer(layer: 'A' | 'B', patch: Partial<LayerPianoState>): void;
  editPianoChain(layer: 'A' | 'B', patch: (c: ChainState) => ChainState): void;
  editFocus(focus: FocusState): void;
  setSplitOn(on: boolean): void;
  setSplitPoint(which: 'low' | 'mid' | 'high', patch: { active?: boolean; pos?: SplitPosId; xfade?: CrossfadeWidth }): void;
  setZone(key: string, zone: ZoneRange): void;
  setSceneEnables(scene: SceneId, fn: (m: InstrumentProgram['scenes']['I']) => InstrumentProgram['scenes']['I']): void;
  // Morphs.
  setMorphSourcePos(source: MorphSource, pos: number): void;
  beginMorphCapture(source: MorphSource): void;
  captureMorphControl(source: MorphSource, target: string, value: number): void;
  endMorphCapture(source: MorphSource): void;
  clearMorph(source: MorphSource): void;
  morphArmed: MorphSource | null;
  morphCapture: { source: MorphSource; startValues: Map<string, number> } | null;
  // Clock / transpose.
  setClockBpm(bpm: number): void;
  tapClock(nowMs: number): void;
  setKbSync(on: boolean): void;
  setTranspose(st: number): void;
  // Program display text.
  displayText(): string;
}

const InstrumentContext = createContext<InstrumentContextValue | null>(null);

export function InstrumentProvider({
  children,
  initial,
  initialStores,
  onProgramChange,
  onPianoChange,
  instrumentRegister,
}: {
  children: React.ReactNode;
  initial?: InstrumentSnapshot;
  initialStores?: SlotStores;
  /** Push canonical state into the StageEngine. */
  onProgramChange?: InstrumentPushFn;
  /** Push piano-section edits into the PianoFx snapshot (bridge). */
  onPianoChange?: (program: InstrumentProgram) => void;
  /** Exposes the context value to the App shell (scene-mirror for p2 strips). */
  instrumentRegister?: React.MutableRefObject<InstrumentContextValue | null>;
}) {
  const [snapshot, setSnapshot] = useState<InstrumentSnapshot>(() => {
    if (initial) return initial;
    const stores = defaultStores();
    return { ...defaultInstrumentSnapshot(), program: cloneProgram(stores.programs[0]) };
  });
  const [stores, setStores] = useState<SlotStores>(() => initialStores ?? defaultStores());
  const [morphArmed, setMorphArmed] = useState<MorphSource | null>(null);
  const [morphCapture, setMorphCapture] = useState<{ source: MorphSource; startValues: Map<string, number> } | null>(null);
  const tapTimes = useRef<number[]>([]);
  const undoState = useRef<{ program: InstrumentProgram; slot: number; liveMode: boolean; liveSlot: number } | null>(null);
  const stash = useRef<{ program: InstrumentProgram; dirty: boolean } | null>(null);
  const onProgramChangeRef = useRef(onProgramChange);
  onProgramChangeRef.current = onProgramChange;
  const onPianoChangeRef = useRef(onPianoChange);
  onPianoChangeRef.current = onPianoChange;
  const snapRef = useRef(snapshot);
  snapRef.current = snapshot;
  const storesRef = useRef(stores);
  storesRef.current = stores;

  const push = useCallback((program: InstrumentProgram, snap: InstrumentSnapshot) => {
    onProgramChangeRef.current?.(program, { scene: snap.scene, solo: snap.solo });
    onPianoChangeRef.current?.(program);
  }, []);

  const markDirtyEdit = useCallback(
    (fn: (p: InstrumentProgram) => InstrumentProgram, autoStoreLive: boolean) => {
      const snap = snapRef.current;
      const next = fn(cloneProgram(snap.program));
      if (snap.liveMode && autoStoreLive) {
        // Live slots auto-store every edit (manual p. 13).
        setStores((prev) => {
          const live = [...prev.live];
          live[snap.liveSlot] = cloneProgram(next);
          return { ...prev, live };
        });
        setSnapshot((s) => ({ ...s, program: next, dirty: false }));
        push(next, { ...snap, program: next });
        return;
      }
      setSnapshot((s) => ({ ...s, program: next, dirty: true }));
      push(next, { ...snap, program: next });
    },
    [push],
  );

  const selectSlot = useCallback((slot: number) => {
    const cur = snapRef.current;
    const st = storesRef.current;
    const clamped = Math.min(PROGRAM_SLOTS - 1, Math.max(0, slot));
    if (cur.dirty && !cur.storeDraft) {
      undoState.current = { program: cloneProgram(cur.program), slot: cur.slot, liveMode: cur.liveMode, liveSlot: cur.liveSlot };
    }
    const program = cloneProgram(st.programs[clamped]);
    const next: InstrumentSnapshot = {
      ...cur,
      program,
      slot: clamped,
      page: Math.floor(clamped / 8) + 1,
      liveMode: false,
      dirty: false,
      storeDraft: null,
      undoLabel: undoState.current ? `Program change from edited ${slotLabel(cur.slot)}` : null,
      scene: 'I',
    };
    stash.current = null;
    setSnapshot(next);
    onProgramChangeRef.current?.(program, { scene: 'I', solo: next.solo });
    onPianoChangeRef.current?.(program);
  }, []);

  const selectLive = useCallback((slot: number) => {
    const cur = snapRef.current;
    const st = storesRef.current;
    const clamped = Math.min(LIVE_SLOTS - 1, Math.max(0, slot));
    const program = cloneProgram(st.live[clamped]);
    const next = { ...cur, liveMode: true, liveSlot: clamped, program, dirty: false, storeDraft: null, scene: 'I' as SceneId };
    setSnapshot(next);
    onProgramChangeRef.current?.(program, { scene: 'I', solo: next.solo });
    onPianoChangeRef.current?.(program);
  }, []);

  const value = useMemo<InstrumentContextValue>(() => {
    const snap = snapshot;
    return {
      snapshot: snap,
      stores,
      unsupported: UNSUPPORTED_CONTROLS,
      morphArmed,
      morphCapture,
      selectSlot,
      setPage: (page) => {
        setSnapshot((s) => ({ ...s, page: Math.min(4, Math.max(1, page)) }));
      },
      dialProgram: (delta) => {
        const cur = snapRef.current;
        if (cur.liveMode) {
          const next = (cur.liveSlot + delta + LIVE_SLOTS) % LIVE_SLOTS;
          selectLive(next);
          return;
        }
        // Wrap within the bank (dial browsing).
        const next = (cur.slot + delta + PROGRAM_SLOTS) % PROGRAM_SLOTS;
        selectSlot(next);
      },
      setLiveMode: (on) => {
        const cur = snapRef.current;
        const st = storesRef.current;
        if (on) {
          if (cur.dirty && !cur.storeDraft) {
            undoState.current = { program: cloneProgram(cur.program), slot: cur.slot, liveMode: cur.liveMode, liveSlot: cur.liveSlot };
          }
          const program = cloneProgram(st.live[cur.liveSlot]);
          const next = { ...cur, liveMode: true, program, dirty: false, storeDraft: null, scene: 'I' as SceneId, undoLabel: undoState.current ? 'Program change from edited state' : null };
          setSnapshot(next);
          onProgramChangeRef.current?.(program, { scene: 'I', solo: next.solo });
          onPianoChangeRef.current?.(program);
        } else {
          selectSlot(cur.slot);
        }
      },
      selectLive,
      setListView: (on) => setSnapshot((s) => ({ ...s, listView: on })),
      beginStore: (asNaming) => {
        const cur = snapRef.current;
        stash.current = { program: cloneProgram(cur.program), dirty: cur.dirty };
        setSnapshot((s) => ({
          ...s,
          storeDraft: { dest: s.liveMode ? s.liveSlot : s.slot, liveDest: s.liveMode ? s.liveSlot : null, naming: asNaming, name: s.program.name },
          storeFlash: `Store: select destination for “${s.program.name}”`,
        }));
      },
      setStoreDest: (dest, liveDest) => {
        // Destination becomes audible for auditioning (manual p. 13, p. 40).
        const st = storesRef.current;
        const audition = liveDest !== null ? st.live[dest] : st.programs[dest];
        setSnapshot((s) => ({ ...s, storeDraft: s.storeDraft ? { ...s.storeDraft, dest, liveDest } : s.storeDraft }));
        onProgramChangeRef.current?.(cloneProgram(audition), { scene: snapRef.current.scene, solo: snapRef.current.solo });
        onPianoChangeRef.current?.(cloneProgram(audition));
      },
      setStoreName: (name) => {
        setSnapshot((s) => (s.storeDraft ? { ...s, storeDraft: { ...s.storeDraft, name: name.slice(0, 16) } } : s));
      },
      confirmStore: () => {
        const cur = snapRef.current;
        const draft = cur.storeDraft;
        if (!draft) return;
        const stored = cloneProgram(cur.program);
        // The stash holds the edited program; the store writes it (with the
        // new name in naming mode) to the destination.
        const src = stash.current?.program ?? cur.program;
        const named = { ...cloneProgram(src), name: draft.naming ? draft.name || src.name : src.name };
        void stored;
        setStores((prev) => {
          if (draft.liveDest !== null) {
            const live = [...prev.live];
            live[draft.liveDest] = cloneProgram(named);
            return { ...prev, live };
          }
          const programs = [...prev.programs];
          programs[draft.dest] = cloneProgram(named);
          return { ...prev, programs };
        });
        undoState.current = null;
        stash.current = null;
        const next = {
          ...cur,
          program: cloneProgram(named),
          slot: draft.liveDest !== null ? cur.slot : draft.dest,
          page: draft.liveDest !== null ? cur.page : Math.floor(draft.dest / 8) + 1,
          liveMode: draft.liveDest !== null,
          liveSlot: draft.liveDest !== null ? draft.liveDest : cur.liveSlot,
          dirty: false,
          storeDraft: null,
          undoLabel: null,
          storeFlash: `Stored “${named.name}” to ${draft.liveDest !== null ? `Live ${draft.liveDest + 1}` : slotLabel(draft.dest)}`,
        };
        setSnapshot(next);
        onProgramChangeRef.current?.(cloneProgram(named), { scene: next.scene, solo: next.solo });
        onPianoChangeRef.current?.(cloneProgram(named));
      },
      cancelStore: () => {
        // Restore the stashed edits (auditioning never destroyed them).
        const saved = stash.current;
        stash.current = null;
        if (saved) {
          setSnapshot((s) => ({ ...s, program: saved.program, dirty: saved.dirty, storeDraft: null, storeFlash: 'Store cancelled' }));
          onProgramChangeRef.current?.(cloneProgram(saved.program), { scene: snapRef.current.scene, solo: snapRef.current.solo });
          onPianoChangeRef.current?.(cloneProgram(saved.program));
        } else {
          setSnapshot((s) => ({ ...s, storeDraft: null, storeFlash: 'Store cancelled' }));
        }
      },
      undo: () => {
        const u = undoState.current;
        if (!u) return;
        undoState.current = null;
        const next = { ...snapRef.current, program: cloneProgram(u.program), slot: u.slot, liveMode: u.liveMode, liveSlot: u.liveSlot, dirty: true, storeDraft: null, undoLabel: null, storeFlash: 'Undo: edits restored' };
        setSnapshot(next);
        onProgramChangeRef.current?.(cloneProgram(u.program), { scene: next.scene, solo: next.solo });
        onPianoChangeRef.current?.(cloneProgram(u.program));
      },
      setScene: (scene) => {
        const cur = snapRef.current;
        const next = { ...cur, scene };
        setSnapshot(next);
        onProgramChangeRef.current?.(cloneProgram(cur.program), { scene, solo: cur.solo });
      },
      setSolo: (on) => {
        const cur = snapRef.current;
        const next = { ...cur, solo: on };
        setSnapshot(next);
        onProgramChangeRef.current?.(cloneProgram(cur.program), { scene: cur.scene, solo: on });
      },
      edit: (fn) => markDirtyEdit(fn, true),
      editPianoLayer: (layer, patch) => {
        markDirtyEdit((p) => ({ ...p, piano: { ...p.piano, layers: { ...p.piano.layers, [layer]: { ...p.piano.layers[layer], ...patch } } } }), true);
      },
      editPianoChain: (layer, patch) => {
        markDirtyEdit(
          (p) => {
            const target = p.piano.pianoGroup ? 'A' : layer;
            return { ...p, piano: { ...p.piano, chains: { ...p.piano.chains, [target]: patch(p.piano.chains[target]) } } };
          },
          true,
        );
      },
      editFocus: (focus) => {
        markDirtyEdit(
          (p) => ({
            ...p,
            piano: {
              ...p.piano,
              layerFocus: (focus.layer === 'A' || focus.layer === 'B' ? focus.layer : p.piano.layerFocus),
              pianoGroup: focus.pianoGroup,
            },
          }),
          false,
        );
      },
      setSplitOn: (on) => {
        markDirtyEdit((p) => ({ ...p, split: { ...p.split, on } }), true);
      },
      setSplitPoint: (which, patch) => {
        markDirtyEdit(
          (p) => ({ ...p, split: { ...p.split, [which]: { ...p.split[which], ...patch } } }),
          true,
        );
      },
      setZone: (key, zone) => {
        const [section, layer] = key.includes('piano') ? ['piano', key.slice(5)] : key.includes('organ') ? ['organ', key.slice(5)] : ['synth', key.slice(5)];
        markDirtyEdit(
          (p) => ({
            ...p,
            zones: {
              ...p.zones,
              [section]: { ...(p.zones[section as 'piano'] as object), [layer]: { ...zone } },
            },
          }),
          true,
        );
      },
      setSceneEnables: (scene, fn) => {
        markDirtyEdit((p) => ({ ...p, scenes: { ...p.scenes, [scene]: fn(p.scenes[scene]) } }), true);
      },
      setMorphSourcePos: (source, pos) => {
        morphLivePos[source] = Math.min(1, Math.max(0, pos));
        onProgramChangeRef.current?.morphPos?.(source, morphLivePos[source]);
      },
      getMorphPos: (source) => morphLivePos[source],
      beginMorphCapture: (source) => {
        setMorphArmed(source);
        setMorphCapture({ source, startValues: new Map() });
      },
      captureMorphControl: (source, target, value) => {
        setMorphCapture((prev) => {
          if (!prev || prev.source !== source) return prev;
          if (!prev.startValues.has(target)) {
            const next = new Map(prev.startValues);
            next.set(target, value);
            return { ...prev, startValues: next };
          }
          return prev;
        });
      },
      endMorphCapture: (source) => {
        const cap = morphCapture;
        setMorphArmed(null);
        setMorphCapture(null);
        if (!cap || cap.source !== source) return;
        // Finalize: end = current canonical value per captured target.
        // Zero-travel captures (start === end) are dropped — re-holding and
        // zeroing a control removes a single assignment (manual p. 39).
        const cur = snapRef.current.program;
        const assigns: Array<{ target: string; start: number; end: number }> = [];
        for (const [target, start] of cap.startValues) {
          const end = readMorphTarget(cur, target);
          if (end === null || Math.abs(end - start) < 1e-9) continue;
          assigns.push({ target, start, end });
        }
        if (assigns.length > 0) {
          markDirtyEdit(
            (p) => ({ ...p, morphs: { ...p.morphs, [source]: [...p.morphs[source].filter((a) => !cap.startValues.has(a.target)), ...assigns] } }),
            true,
          );
        }
        morphFinishRef.current?.(source);
      },
      clearMorph: (source) => {
        markDirtyEdit(
          (p) => ({ ...p, morphs: { ...p.morphs, [source]: [] } }),
          true,
        );
        onProgramChangeRef.current?.morphClear?.(source);
      },
      setClockBpm: (bpm) => {
        markDirtyEdit((p) => ({ ...p, clockBpm: clampBpm(bpm) }), true);
      },
      tapClock: (nowMs) => {
        const times = [...tapTimes.current, nowMs].slice(-6);
        tapTimes.current = times;
        if (times.length >= 4) {
          const intervals: number[] = [];
          for (let i = 1; i < times.length; i += 1) intervals.push(times[i] - times[i - 1]);
          const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
          const bpm = clampBpm(Math.round(60000 / Math.min(2000, Math.max(200, avg))));
          markDirtyEdit((p) => ({ ...p, clockBpm: bpm }), true);
        }
      },
      setKbSync: (on) => {
        markDirtyEdit((p) => ({ ...p, kbSync: on }), true);
      },
      setTranspose: (st) => {
        markDirtyEdit((p) => ({ ...p, transpose: clampTranspose(st) }), true);
      },
      displayText: () => {
        const s = snapRef.current;
        const dest = s.storeDraft
          ? s.storeDraft.liveDest !== null
            ? `Live ${s.storeDraft.liveDest + 1}`
            : slotLabel(s.storeDraft.dest)
          : s.liveMode
            ? `L${s.liveSlot + 1}`
            : slotLabel(s.slot);
        const dirty = s.dirty ? ' E' : '';
        const naming = s.storeDraft?.naming ? ` As “${s.storeDraft.name}”` : '';
        return `${dest}${dirty} ${s.program.name}${naming}`;
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, stores, morphArmed, morphCapture, markDirtyEdit, selectSlot, selectLive]);

  if (instrumentRegister) instrumentRegister.current = value;

  return <InstrumentContext.Provider value={value}>{children}</InstrumentContext.Provider>;
}

/** Test seam: finish a morph capture with explicit end values. */
export const morphFinishRef: { current: ((source: MorphSource) => void) | null } = { current: null };

export function useInstrument(): InstrumentContextValue {
  const ctx = useContext(InstrumentContext);
  if (!ctx) throw new Error('useInstrument must be used inside <InstrumentProvider>');
  return ctx;
}

/** Null outside the provider — lets inherited sections render standalone. */
export function useInstrumentSnapshot(): InstrumentSnapshot | null {
  const ctx = useContext(InstrumentContext);
  return ctx ? ctx.snapshot : null;
}

/** Null outside the provider — the Phase 3 hardware bridge. */
export function useInstrumentOptional(): InstrumentContextValue | null {
  const ctx = useContext(InstrumentContext);
  return ctx;
}

export type { ChainKey, FocusState, LayerPianoState, OrganLayerId, SynthLayerId };
export { slotLabel };
