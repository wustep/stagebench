import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioEngine, type EngineStatus } from '../audio/audioEngine';
import { NoteRouter, type NoteSink } from '../input/noteRouter';
import { applyAll, applyControl } from '../audio/controlBindings';
import type { ControlStore } from '../state/controlStore';
import type { PerformanceStore } from '../state/performanceStore';
import type { SampleLoaderDeps } from '../audio/sampler';

export type PianoStatus = EngineStatus;

export interface AudioEngineApi {
  router: NoteRouter;
  status: PianoStatus;
  activeNotes: ReadonlySet<number>;
  ensureRunning: () => void;
  /** Adjust the focused piano layer's octave by ±1 (functional octave buttons). */
  shiftOctave: (dir: 1 | -1) => void;
}

/** A retargetable sink so the NoteRouter can exist before the engine is built. */
class ProxySink implements NoteSink {
  target: NoteSink | null = null;
  noteOn(midi: number, velocity?: number): void {
    this.target?.noteOn(midi, velocity);
  }
  noteOff(midi: number): void {
    this.target?.noteOff(midi);
  }
  setSustain(down: boolean): void {
    this.target?.setSustain(down);
  }
  allNotesOff(): void {
    this.target?.allNotesOff();
  }
}

/**
 * Owns the single-context AudioEngine, loads the recorded sample library, and
 * keeps the engine in sync with the presentation ControlStore so every
 * functional Piano / Layer-Effects / Master control changes real audio.
 *
 * The AudioContext + engine are created lazily inside the mount effect (never
 * during render), so exactly ONE AudioContext exists per live mount and no
 * discarded StrictMode render leaks a context. The context is closed on
 * teardown. An engine can be injected (tests pass an OfflineAudioContext-backed
 * one); if no AudioContext exists we enter a labeled silent fallback.
 */
export function useAudioEngine(
  store: ControlStore,
  opts: {
    injectedEngine?: AudioEngine;
    contextFactory?: () => BaseAudioContext;
    loaderDeps?: SampleLoaderDeps;
    autoLoad?: boolean;
    performance?: PerformanceStore;
  } = {},
): AudioEngineApi {
  const [status, setStatus] = useState<PianoStatus>('loading');
  const [activeNotes, setActiveNotes] = useState<ReadonlySet<number>>(new Set());
  const ctxRef = useRef<BaseAudioContext | null>(null);

  // Stable router bound to a proxy sink; the real engine is attached in the effect.
  const { router, proxy } = useMemo(() => {
    const p = new ProxySink();
    if (opts.injectedEngine) p.target = opts.injectedEngine;
    return { router: new NoteRouter(p), proxy: p };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.injectedEngine]);

  useEffect(() => {
    // Build (or reuse injected) engine + context here — never during render.
    let engine: AudioEngine | null = opts.injectedEngine ?? null;
    let ownsContext = false;
    if (!engine) {
      let ctx: BaseAudioContext | null = null;
      try {
        if (opts.contextFactory) ctx = opts.contextFactory();
        else if (typeof AudioContext !== 'undefined') ctx = new AudioContext();
      } catch {
        ctx = null;
      }
      if (ctx) {
        ctxRef.current = ctx;
        ownsContext = !opts.contextFactory;
        engine = new AudioEngine(ctx);
      }
    } else {
      ctxRef.current = engine.ctx;
    }

    if (!engine) {
      // No audio device: labeled silent fallback. Router still tracks notes.
      proxy.target = null;
      setStatus('fallback');
      const unsub = router.subscribe((n) => setActiveNotes(n));
      return () => {
        unsub();
        router.panic();
      };
    }

    proxy.target = engine;
    const perfStore = opts.performance;
    applyAll(engine, store.getState(), perfStore?.getState());

    const loaderDeps: SampleLoaderDeps | null =
      opts.loaderDeps ??
      (typeof fetch !== 'undefined'
        ? {
            fetchBytes: async (url: string) => {
              const res = await fetch(url);
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              return res.arrayBuffer();
            },
            decode: (bytes: ArrayBuffer) => (engine!.ctx as AudioContext).decodeAudioData(bytes.slice(0)),
            baseUrl: (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/',
          }
        : null);

    let cancelled = false;
    if (!opts.injectedEngine && opts.autoLoad !== false && loaderDeps) {
      setStatus('loading');
      engine
        .loadLibrary(loaderDeps)
        .then(() => {
          if (!cancelled && engine) {
            setStatus(engine.getStatus());
            applyAll(engine, store.getState(), perfStore?.getState());
          }
        })
        .catch(() => {
          if (!cancelled) setStatus('fallback');
        });
    } else {
      engine.setStatus('ready');
      setStatus('ready');
    }

    const unsubStore = store.subscribe((state) => {
      if (engine) applyAll(engine, state, perfStore?.getState());
    });
    const unsubPerf = perfStore
      ? perfStore.subscribe(() => {
          if (engine) applyAll(engine, store.getState(), perfStore.getState());
        })
      : () => {};
    const unsubRouter = router.subscribe((n) => setActiveNotes(n));

    return () => {
      cancelled = true;
      unsubStore();
      unsubPerf();
      unsubRouter();
      router.panic();
      proxy.target = null;
      engine?.dispose();
      const owned = ctxRef.current as (AudioContext & { close?: () => Promise<void> }) | null;
      if (ownsContext && owned && typeof owned.close === 'function' && owned.state !== 'closed') {
        owned.close().catch(() => {});
      }
      ctxRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, proxy, store]);

  const ensureRunning = useCallback(() => {
    const ctx = ctxRef.current as AudioContext | null;
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }, []);

  const shiftOctave = useCallback((dir: 1 | -1) => {
    const engine = proxy.target as AudioEngine | null;
    if (!engine || typeof engine.focusedLayer === 'undefined') return;
    const layer = engine.focusedLayer;
    const cur = engine.getLayer(layer).octave;
    const next = Math.max(-2, Math.min(2, cur + dir));
    engine.setLayer(layer, { octave: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proxy]);

  return { router, status, activeNotes, ensureRunning, shiftOctave };
}

/** Expose applyControl for tests / fine-grained bindings. */
export { applyControl };
