/**
 * Phase 2 functional state: two piano layers + per-layer effect chains +
 * focus/group/global routing. The Phase 1 presentation store (stage.tsx)
 * stays byte-identical; this provider owns audible state only.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
  defaultLayerPiano,
  octaveSemitones,
  typeById,
  type KbTouchName,
  type LayerId,
  type LayerPianoState,
  type PianoModel,
  type PianoTypeId,
  type TimbreName,
} from '../audio/pianoTypes';
import {
  DEFAULT_FOCUS,
  defaultChain,
  focusForLayer,
  type AmpType,
  type ChainState,
  type FocusState,
  type FxFocus,
  type Mod1Type,
  type Mod2Type,
  type ReverbType,
  type RotarySpeed,
} from './fxTypes';

export interface PianoFxSnapshot {
  layers: Record<LayerId, LayerPianoState>;
  layerFocus: LayerId;
  chains: Record<LayerId, ChainState>;
  fx: FocusState;
  sectionOn: boolean;
  masterLevel: number;
  rotarySpeed: RotarySpeed;
  rotaryDrive: number;
  pitchBendSt: number;
  /** Failed sample asset keys (`set.root.layer`); drives labeled fallback UI. */
  loadFailed: string[];
}

export function defaultSnapshot(): PianoFxSnapshot {
  return {
    layers: {
      A: defaultLayerPiano(),
      B: defaultLayerPiano({ enabled: false, level: 0 }),
    },
    layerFocus: 'A',
    chains: { A: defaultChain(), B: defaultChain() },
    fx: { ...DEFAULT_FOCUS },
    sectionOn: true,
    masterLevel: 7,
    rotarySpeed: 'slow',
    rotaryDrive: 3,
    pitchBendSt: 0,
    loadFailed: [],
  };
}

interface PianoFxContextValue {
  snapshot: PianoFxSnapshot;
  setLayerEnabled(layer: LayerId, enabled: boolean): void;
  focusLayer(layer: LayerId): void;
  setLayerLevel(layer: LayerId, level: number): void;
  setLayerOctave(layer: LayerId, octave: number): void;
  setLayerType(layer: LayerId, type: PianoTypeId): void;
  setLayerModel(layer: LayerId, model: number): void;
  setKbTouch(layer: LayerId, touch: KbTouchName): void;
  setDynComp(layer: LayerId, amount: number): void;
  setTimbre(layer: LayerId, timbre: TimbreName): void;
  setUnison(layer: LayerId, level: number): void;
  setSoftRelease(layer: LayerId, on: boolean): void;
  setStringRes(layer: LayerId, on: boolean): void;
  setSustPed(layer: LayerId, on: boolean): void;
  setPStick(layer: LayerId, on: boolean): void;
  setSectionOn(on: boolean): void;
  setMasterLevel(level: number): void;
  setRotarySpeed(speed: RotarySpeed): void;
  setRotaryDrive(drive: number): void;
  setPitchBend(st: number): void;
  // Effects.
  setFxFocus(focus: FxFocus, manual: boolean): void;
  setPianoGroup(on: boolean): void;
  setAllBypass(on: boolean): void;
  updateChain(layer: LayerId, patch: (c: ChainState) => ChainState): void;
  /** Tap tempo for a layer's delay (two taps set the time). */
  tapDelay(layer: LayerId): void;
  setLoadFailed(failed: string[]): void;
  /** Last tap-tempo results (ms per layer) for panel feedback. */
  tapMs: Record<LayerId, number | null>;
}

const PianoFxContext = createContext<PianoFxContextValue | null>(null);

function patchLayer(snap: PianoFxSnapshot, layer: LayerId, patch: Partial<LayerPianoState>): PianoFxSnapshot {
  return { ...snap, layers: { ...snap.layers, [layer]: { ...snap.layers[layer], ...patch } } };
}

function patchChain(snap: PianoFxSnapshot, layer: LayerId, fn: (c: ChainState) => ChainState): PianoFxSnapshot {
  const target: LayerId = snap.fx.pianoGroup ? 'A' : layer;
  const next = fn(snap.chains[target]);
  if (snap.fx.pianoGroup) return { ...snap, chains: { A: next, B: snap.chains.B } };
  return { ...snap, chains: { ...snap.chains, [layer]: next } };
}

export function PianoFxProvider({
  children,
  initial,
  onChange,
  onTap,
}: {
  children: React.ReactNode;
  initial?: PianoFxSnapshot;
  onChange?: (snap: PianoFxSnapshot) => void;
  /** Engine tap-tempo hook: returns the resolved delay ms for the layer. */
  onTap?: (layer: LayerId) => number;
}) {
  const [snapshot, setSnapshot] = useState<PianoFxSnapshot>(initial ?? defaultSnapshot());
  const [tapMs, setTapMs] = useState<Record<LayerId, number | null>>({ A: null, B: null });
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;

  const commit = useCallback(
    (fn: (s: PianoFxSnapshot) => PianoFxSnapshot) => {
      setSnapshot((prev) => {
        const next = fn(prev);
        onChange?.(next);
        return next;
      });
    },
    [onChange],
  );

  const value = useMemo<PianoFxContextValue>(
    () => ({
      snapshot,
      setLayerEnabled: (layer, enabled) => commit((s) => patchLayer(s, layer, { enabled })),
      focusLayer: (layer) =>
        commit((s) => ({ ...s, layerFocus: layer, fx: focusForLayer(layer, s.fx) })),
      setLayerLevel: (layer, level) => commit((s) => patchLayer(s, layer, { level: Math.min(10, Math.max(0, level)) })),
      setLayerOctave: (layer, octave) => commit((s) => patchLayer(s, layer, { octave: Math.min(4, Math.max(0, octave)) })),
      setLayerType: (layer, type) => commit((s) => patchLayer(s, layer, { type, model: 0 })),
      setLayerModel: (layer, model) => commit((s) => patchLayer(s, layer, { model: Math.min(7, Math.max(0, model)) })),
      setKbTouch: (layer, touch) => commit((s) => patchLayer(s, layer, { kbTouch: touch })),
      setDynComp: (layer, amount) => commit((s) => patchLayer(s, layer, { dynComp: Math.min(3, Math.max(0, amount)) })),
      setTimbre: (layer, timbre) => commit((s) => patchLayer(s, layer, { timbre })),
      setUnison: (layer, level) => commit((s) => patchLayer(s, layer, { unison: Math.min(3, Math.max(0, level)) })),
      setSoftRelease: (layer, on) => commit((s) => patchLayer(s, layer, { softRelease: on })),
      setStringRes: (layer, on) => commit((s) => patchLayer(s, layer, { stringRes: on })),
      setSustPed: (layer, on) => commit((s) => patchLayer(s, layer, { sustPed: on })),
      setPStick: (layer, on) => commit((s) => patchLayer(s, layer, { pStick: on })),
      setSectionOn: (on) => commit((s) => ({ ...s, sectionOn: on })),
      setMasterLevel: (level) => commit((s) => ({ ...s, masterLevel: Math.min(10, Math.max(0, level)) })),
      setRotarySpeed: (speed) => commit((s) => ({ ...s, rotarySpeed: speed })),
      setRotaryDrive: (drive) => commit((s) => ({ ...s, rotaryDrive: Math.min(10, Math.max(0, drive)) })),
      setPitchBend: (st) => commit((s) => ({ ...s, pitchBendSt: Math.min(2, Math.max(-2, st)) })),
      setFxFocus: (focus, manual) => commit((s) => ({ ...s, fx: { ...s.fx, focus, manual } })),
      setPianoGroup: (on) =>
        commit((s) => ({
          ...s,
          fx: { ...s.fx, pianoGroup: on },
          chains: on ? { A: s.chains.A, B: s.chains.A } : s.chains,
        })),
      setAllBypass: (on) => commit((s) => ({ ...s, fx: { ...s.fx, allBypass: on } })),
      updateChain: (layer, fn) => commit((s) => patchChain(s, layer, fn)),
      tapDelay: (layer) => {
        const ms = onTapRef.current?.(layer);
        if (ms !== undefined) {
          setTapMs((prev) => ({ ...prev, [layer]: ms }));
          // Mirror the resolved time into stored state so panel and engine agree.
          commit((s) => patchChain(s, layer, (c) => ({ ...c, delay: { ...c.delay, timeMs: ms } })));
        }
      },
      setLoadFailed: (failed) => commit((s) => ({ ...s, loadFailed: failed })),
      tapMs,
    }),
    [snapshot, commit, tapMs],
  );
  return <PianoFxContext.Provider value={value}>{children}</PianoFxContext.Provider>;
}

export function usePianoFx(): PianoFxContextValue {
  const ctx = useContext(PianoFxContext);
  if (!ctx) throw new Error('usePianoFx must be used inside <PianoFxProvider>');
  return ctx;
}

export interface PianoFxBridge {
  /** Audible value for a bridged Phase 1 control ID (undefined = unbridged). */
  valueOf(id: string): number | undefined;
  interact(id: string, direction: 1 | -1): void;
}

/**
 * Null outside the provider — DecorativeControl stays usable in isolated
 * Phase 1 tests. Inside the provider, the bridged performance controls
 * read/write audible state: Master Level (0..10), pitch stick (0..10 around
 * a center detent of 5 → ±2 st), rotary speed (button toggles slow/fast),
 * rotary stop (Phase 3: toggles stop/slow on the shared rotary),
 * rotary drive (0..10).
 */
export function usePianoFxBridge(): PianoFxBridge | null {
  const ctx = useContext(PianoFxContext);
  // Null outside the provider: DecorativeControl keeps its exact Phase 1
  // presentation behavior in isolated tests.
  if (!ctx) return null;
  const snap = ctx.snapshot;
  return {
    valueOf: (id: string): number | undefined => {
      if (id === 'perf-master-level') return snap.masterLevel;
      // Stick position 0..10 maps onto bend -2..+2 st (center detent 5).
      if (id === 'perf-pitch-stick') return Math.round(((snap.pitchBendSt + 2) / 4) * 10);
      if (id === 'perf-rotary-speed') return snap.rotarySpeed === 'fast' ? 1 : 0;
      if (id === 'perf-rotary-stop') return snap.rotarySpeed === 'stop' ? 1 : 0;
      if (id === 'perf-rotary-drive') return snap.rotaryDrive;
      return undefined;
    },
    interact: (id: string, direction: 1 | -1): void => {
      if (id === 'perf-master-level') {
        ctx.setMasterLevel(snap.masterLevel + direction);
      } else if (id === 'perf-pitch-stick') {
        const pos = Math.min(10, Math.max(0, Math.round(((snap.pitchBendSt + 2) / 4) * 10) + direction));
        ctx.setPitchBend((pos / 10) * 4 - 2);
      } else if (id === 'perf-rotary-speed') {
        ctx.setRotarySpeed(snap.rotarySpeed === 'fast' ? 'slow' : 'fast');
      } else if (id === 'perf-rotary-stop') {
        ctx.setRotarySpeed(snap.rotarySpeed === 'stop' ? 'slow' : 'stop');
      } else if (id === 'perf-rotary-drive') {
        ctx.setRotaryDrive(snap.rotaryDrive + direction);
      }
    },
  };
}

/** Null outside the provider — lets inherited sections render standalone. */
export function usePianoFxSnapshot(): PianoFxSnapshot | null {
  const ctx = useContext(PianoFxContext);
  return ctx ? ctx.snapshot : null;
}

/** Program display text: focused layer model (never claims unbuilt features). */
export function programDisplayText(snap: PianoFxSnapshot): string {
  const layer = snap.layers[snap.layerFocus];
  const type = typeById(layer.type);
  const model: PianoModel = type.models[Math.min(type.models.length - 1, Math.max(0, layer.model))];
  const failed = model.setId ? snap.loadFailed.some((f) => f.startsWith(`${model.setId}.`)) : false;
  const slot = `${snap.layerFocus}:${String(11 + layer.model).padStart(2, '0')}`;
  if (failed) return `! ${model.label} unavailable`;
  return `${slot} ${model.label}`;
}

export type { AmpType, ChainState, FocusState, FxFocus, LayerId, Mod1Type, Mod2Type, ReverbType, RotarySpeed };
export { octaveSemitones };
