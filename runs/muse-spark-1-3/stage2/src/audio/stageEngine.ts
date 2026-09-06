/**
 * Phase 2 StageEngine: two piano layers with the full sample/synth library,
 * performance controls, per-layer effect chains, shared Rotary, master gain
 * + limiter on ONE AudioContext.
 *
 * The Phase 1 `PianoEngine` (engine.ts) is untouched for the regression; this
 * engine owns Phase 2 playback. `NoteManager`s in App drive it per layer.
 * Asset failure (fetch/decode) enters a labeled, playable synth fallback.
 */

import { nearestRoot, velocityLayer, loadSampleLibrary, type FetchLike, type SampleLibrary } from './samples';
import { modelOf, octaveSemitones, type LayerId, type LayerPianoState } from './pianoTypes';
import { dynCompGain, renderSynthVoice, touchGain } from './render';
import { buildLayerChain, buildRotary, type GraphHandles, type RotaryHandles } from './graph';
import {
  defaultChain,
  effectiveChain,
  effectiveComp,
  effectiveDelay,
  effectiveReverb,
  type ChainState,
  type FocusState,
  type RotarySpeed,
} from '../state/fxTypes';
import type { StageAudioContextFactory, StageAudioContextLike, VoiceSourceNodeLike } from './graphTypes';
import type { ClockLike } from './types';

export type StageStatus = 'idle' | 'loading' | 'ready' | 'fallback' | 'error';

export interface PianoLayersSnapshot {
  A: LayerPianoState;
  B: LayerPianoState;
  focus: LayerId;
}

export interface StageEngineOptions {
  createContext: StageAudioContextFactory;
  fetchImpl?: FetchLike | null;
  sampleBase?: string;
  manifestUrl?: string;
  clock?: ClockLike;
  maxVoices?: number;
  chains?: Record<LayerId, ChainState>;
  focus?: FocusState;
  rotarySpeed?: RotarySpeed;
  rotaryDrive?: number;
  masterLevel?: number;
  pitchBendSt?: number;
}

interface OwnedStageVoice {
  noteId: string;
  layer: LayerId;
  midi: number;
  startedAt: number;
  sustained: boolean;
  /** Soft-release voices fade their release gain before stopping. */
  softRelease: boolean;
  releaseGain: { gain: { value: number; setTargetAtTime?: (t: number, s: number, c: number) => void } } | null;
  stop: () => void;
}

function trackingVoice(noteId: string, layer: LayerId, midi: number, now: number, sustain: boolean): OwnedStageVoice {
  return { noteId, layer, midi, startedAt: now, sustained: sustain, softRelease: false, releaseGain: null, stop: () => undefined };
}

interface LevelTap {
  gain: { value: number };
  connect(d: unknown): void;
  disconnect(): void;
}

const DEFAULT_MAX_VOICES = 24;

function masterGainFor(level: number): number {
  const clamped = Math.min(10, Math.max(0, level));
  return (clamped / 10) * 1.1;
}

export function defaultPianoLayer(overrides: Partial<LayerPianoState> = {}): LayerPianoState {
  return {
    enabled: true,
    type: 'grand',
    model: 0,
    level: 8,
    octave: 2,
    sustPed: true,
    pStick: true,
    kbTouch: 'Medium',
    dynComp: 0,
    timbre: 'Off',
    unison: 0,
    softRelease: false,
    stringRes: false,
    ...overrides,
  };
}

export class StageEngine {
  private readonly createContext: StageAudioContextFactory;
  private readonly fetchImpl: FetchLike | null;
  private readonly sampleBase: string;
  private readonly manifestUrl: string;
  private readonly clock: ClockLike;
  private readonly maxVoices: number;
  private ctx: StageAudioContextLike | null = null;
  private master: LevelTap | null = null;
  private limiter: { connect(d: unknown): void; disconnect(): void } | null = null;
  private layerLevel: Record<LayerId, LevelTap | null> = { A: null, B: null };
  private graphs: Record<LayerId, GraphHandles | null> = { A: null, B: null };
  private rotary: RotaryHandles | null = null;
  private rotaryTap: Record<LayerId, LevelTap | null> = { A: null, B: null };
  private rotaryReturn: Record<LayerId, LevelTap | null> = { A: null, B: null };
  private voices = new Map<string, OwnedStageVoice>();
  private library: SampleLibrary = { sets: [], manifest: null, buffers: new Map(), failed: [] };
  private status: StageStatus = 'idle';
  private detail = '';
  private fallback = false;
  private fallbackReason = '';
  private seq = 0;
  /** Stored (panel) chain state per layer — routing resolves group/global. */
  chainState: Record<LayerId, ChainState> = { A: defaultChain(), B: defaultChain() };
  layers: PianoLayersSnapshot = { A: defaultPianoLayer(), B: defaultPianoLayer({ enabled: false, level: 0 }), focus: 'A' };
  focus: FocusState = { focus: 'piano', manual: false, pianoGroup: false, layer: 'A', allBypass: false };
  rotarySpeed: RotarySpeed = 'slow';
  rotaryDrive = 3;
  masterLevel = 7;
  pitchBendSt = 0;

  constructor(opts: StageEngineOptions) {
    this.createContext = opts.createContext;
    this.fetchImpl = opts.fetchImpl ?? null;
    this.sampleBase = opts.sampleBase ?? './samples';
    this.manifestUrl = opts.manifestUrl ?? './samples/manifest.json';
    this.clock = opts.clock ?? { now: () => Date.now() };
    this.maxVoices = opts.maxVoices ?? DEFAULT_MAX_VOICES;
    if (opts.chains) this.chainState = opts.chains;
    if (opts.focus) this.focus = opts.focus;
    if (opts.rotarySpeed) this.rotarySpeed = opts.rotarySpeed;
    if (opts.rotaryDrive !== undefined) this.rotaryDrive = opts.rotaryDrive;
    if (opts.masterLevel !== undefined) this.masterLevel = opts.masterLevel;
    if (opts.pitchBendSt !== undefined) this.pitchBendSt = opts.pitchBendSt;
  }

  getStatus(): StageStatus {
    return this.status;
  }

  getStatusDetail(): string {
    return this.detail;
  }

  isFallback(): boolean {
    return this.fallback;
  }

  getFallbackReason(): string {
    return this.fallbackReason;
  }

  getSampleLibrary(): SampleLibrary {
    return this.library;
  }

  getVoiceCount(): number {
    return this.voices.size;
  }

  getActiveVoices(): Array<{ layer: LayerId; midi: number }> {
    return [...this.voices.values()].map((v) => ({ layer: v.layer, midi: v.midi }));
  }

  getContext(): StageAudioContextLike | null {
    return this.ctx;
  }

  private initPromise: Promise<StageStatus> | null = null;

  /** Build context, buses, chains, rotary, master. Loads samples (labeled fallback on failure). */
  async init(): Promise<StageStatus> {
    if (this.status === 'ready' || this.status === 'fallback') return this.status;
    // Concurrent callers (StrictMode double-effects, tests driving init
    // directly) share one in-flight init instead of building twice.
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit();
    try {
      return await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async doInit(): Promise<StageStatus> {
    if (this.status === 'ready' || this.status === 'fallback') return this.status;
    this.status = 'loading';
    this.detail = 'Loading piano library…';
    let ctx: StageAudioContextLike | null = null;
    try {
      ctx = this.createContext();
    } catch (err) {
      this.status = 'error';
      this.detail = `Piano library failed to start: ${err instanceof Error ? err.message : String(err)}`;
      return this.status;
    }
    if (!ctx) {
      this.status = 'fallback';
      this.fallback = true;
      this.fallbackReason = 'Audio unavailable in this browser — labeled synth fallback: keys still play.';
      this.detail = this.fallbackReason;
      return this.status;
    }
    this.ctx = ctx;
    try {
      this.buildGraph();
    } catch (err) {
      this.ctx = null;
      this.status = 'error';
      this.detail = `Piano library failed to start: ${err instanceof Error ? err.message : String(err)}`;
      return this.status;
    }
    // Load bundled samples (offline-capable); failure → labeled synth fallback.
    if (this.fetchImpl) {
      try {
        const decode = (bytes: ArrayBuffer) => ctx.decodeAudioData(bytes);
        this.library = await loadSampleLibrary(this.fetchImpl, decode, this.sampleBase, this.manifestUrl);
        if (this.library.failed.length > 0 || this.library.sets.length < 3) {
          this.fallback = true;
          const missing = this.library.failed.slice(0, 3).join(', ');
          this.fallbackReason = `Sample assets missing (${missing || 'no sets loaded'}) — labeled synth fallback stays playable.`;
        }
      } catch (err) {
        this.fallback = true;
        this.fallbackReason = `Sample load failed (${err instanceof Error ? err.message : String(err)}) — labeled synth fallback stays playable.`;
      }
    } else {
      this.fallback = true;
      this.fallbackReason = 'Sample fetch unavailable — labeled synth fallback stays playable.';
    }
    try {
      await Promise.race([ctx.resume(), new Promise((resolve) => setTimeout(resolve, 1500))]);
    } catch {
      /* suspended until first gesture */
    }
    if (this.fallback) {
      this.status = 'fallback';
      this.detail = this.fallbackReason;
    } else {
      this.status = 'ready';
      this.detail = 'Piano library ready (Grand/Upright/Electric + synth).';
    }
    this.applyAllParams();
    return this.status;
  }

  private buildGraph(): void {
    const ctx = this.ctx!;
    const master = ctx.createGain();
    master.gain.value = masterGainFor(this.masterLevel);
    const limiter = ctx.createDynamicsCompressor();
    try {
      limiter.threshold.value = -6;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.12;
    } catch {
      /* best-effort on fakes */
    }
    master.connect(limiter as never);
    limiter.connect(ctx.destination as never);
    this.master = master as unknown as LevelTap;
    this.limiter = limiter as unknown as NonNullable<StageEngine['limiter']>;

    for (const layer of ['A', 'B'] as LayerId[]) {
      const level = ctx.createGain();
      level.gain.value = 1;
      level.connect(master as never);
      this.layerLevel[layer] = level as unknown as LevelTap;
      const graph = buildLayerChain(ctx, this.chainState[layer], this.chainState[layer].delay);
      graph.output.connect(level as never);
      this.graphs[layer] = graph;
      // Rotary tap: chain output (post-reverb) → tap → shared rotary input.
      const tap = ctx.createGain();
      (tap.gain as unknown as { value: number }).value = 0;
      graph.output.connect(tap as never);
      this.rotaryTap[layer] = tap as unknown as LevelTap;
    }
    this.rotary = buildRotary(ctx);
    for (const layer of ['A', 'B'] as LayerId[]) {
      (this.rotaryTap[layer] as unknown as { connect(d: unknown): void }).connect(this.rotary.input as never);
      // Per-layer rotary return: rotary output → return → layer level,
      // gated per layer so routing never cross-feeds the other layer.
      const ret = ctx.createGain();
      (ret.gain as unknown as { value: number }).value = 0;
      this.rotary.output.connect(ret as never);
      ret.connect(this.layerLevel[layer] as never);
      this.rotaryReturn[layer] = ret as unknown as LevelTap;
    }
  }

  /** Re-resolve every audible parameter from current piano/fx state. */
  applyAllParams(): void {
    if (!this.ctx) return;
    for (const layer of ['A', 'B'] as LayerId[]) {
      const graph = this.graphs[layer];
      if (!graph) continue;
      const stored = effectiveChain(layer, this.chainState, this.focus);
      graph.update(stored, effectiveDelay(layer, this.chainState, this.focus), {
        speed: this.rotarySpeed,
        drive: this.rotaryDrive,
      });
      graph.setBypass(this.focus.allBypass);
      if (this.rotaryTap[layer]) this.rotaryTap[layer]!.gain.value = stored.rotaryOn ? 1 : 0;
      if (this.rotaryReturn[layer]) this.rotaryReturn[layer]!.gain.value = stored.rotaryOn ? 1 : 0;
      const level = this.layerLevel[layer];
      if (level) {
        const piano = this.layers[layer];
        const g = piano.enabled ? 0.35 + (Math.min(10, Math.max(0, piano.level)) / 10) * 0.77 : 0;
        try {
          (level.gain as unknown as { setTargetAtTime(t: number, s: number, c: number): void }).setTargetAtTime(
            g,
            this.ctx.currentTime,
            0.008,
          );
        } catch {
          level.gain.value = g;
        }
      }
    }
    if (this.rotary) this.rotary.update(this.rotarySpeed, this.rotaryDrive);
    if (this.master) {
      const g = masterGainFor(this.masterLevel);
      try {
        (this.master.gain as unknown as { setTargetAtTime(t: number, s: number, c: number): void }).setTargetAtTime(
          g,
          this.ctx.currentTime,
          0.008,
        );
      } catch {
        this.master.gain.value = g;
      }
    }
  }

  setChains(chains: Record<LayerId, ChainState>, focus: FocusState): void {
    this.chainState = chains;
    this.focus = focus;
    this.applyAllParams();
  }

  setLayers(layers: PianoLayersSnapshot): void {
    // Layers that were just disabled must not drone: stop their voices now.
    for (const layer of ['A', 'B'] as LayerId[]) {
      if (this.layers[layer]?.enabled && !layers[layer]?.enabled) {
        for (const voice of this.voices.values()) {
          if (voice.layer === layer) {
            voice.stop();
            this.voices.delete(voice.noteId);
          }
        }
      }
    }
    this.layers = layers;
    this.applyAllParams();
  }

  /** Tap tempo: two taps set the focused layer's delay time (20..1500 ms). */
  tapTempo(layer: LayerId): number {
    const now = this.clock.now();
    const last = this.lastTap[layer];
    this.lastTap[layer] = now;
    if (last === undefined) return this.chainState[layer].delay.timeMs;
    const interval = Math.min(2000, Math.max(150, now - last));
    const ms = Math.min(1500, Math.max(20, Math.round(interval)));
    this.chainState[layer] = {
      ...this.chainState[layer],
      delay: { ...this.chainState[layer].delay, timeMs: ms },
    };
    this.applyAllParams();
    return ms;
  }

  private lastTap: Record<LayerId, number | undefined> = { A: undefined, B: undefined };

  setFocus(focus: FocusState): void {
    this.focus = focus;
    this.applyAllParams();
  }

  setMasterLevel(level: number): void {
    this.masterLevel = level;
    this.applyAllParams();
  }

  setPitchBend(st: number): void {
    this.pitchBendSt = Math.min(2, Math.max(-2, st));
  }

  setRotary(speed: RotarySpeed, drive: number): void {
    this.rotarySpeed = speed;
    this.rotaryDrive = drive;
    this.applyAllParams();
  }

  /** Start a voice on a layer. Returns the owned note id, or null when silent. */
  noteOn(layer: LayerId, midi: number, velocity: number, sustain: boolean): string | null {
    const piano = this.layers[layer];
    if (!piano || !piano.enabled) return null;
    if (this.status !== 'ready' && this.status !== 'fallback') return null;
    const noteId = `L${layer}-${this.clock.now()}-${this.seq}`;
    this.seq += 1;
    if (!this.ctx) {
      this.voices.set(noteId, trackingVoice(noteId, layer, midi, this.clock.now(), sustain));
      this.enforcePolyphony();
      return noteId;
    }
    const ctx = this.ctx;
    const graph = this.graphs[layer];
    if (!graph) {
      // No live graph (never initialized or torn down): track ownership without audio.
      this.voices.set(noteId, trackingVoice(noteId, layer, midi, this.clock.now(), sustain));
      this.enforcePolyphony();
      return noteId;
    }
    const model = modelOf(piano);
    const shiftedMidi = midi + octaveSemitones(piano.octave);
    const raw = touchGain(velocity, piano.kbTouch);
    const shaped = dynCompGain(raw, piano.dynComp);
    const bend = piano.pStick ? this.pitchBendSt : 0;
    if (model.source !== 'samples') {
      const kind = model.id.startsWith('clav') ? 'clav' : model.id.startsWith('digital') ? 'digital' : 'misc';
      return this.startSynthVoice(layer, midi, velocity, sustain, noteId, kind, piano, bend, shiftedMidi);
    }
    const setId = model.setId!;
    const { root, shiftSt } = nearestRoot(shiftedMidi);
    const layerDef = velocityLayer(velocity);
    const entry = this.library.buffers.get(`${setId}.${root}.${layerDef.id}`);
    if (!entry) {
      // Labeled fallback: synth voice for the missing asset.
      return this.startSynthVoice(layer, midi, velocity, sustain, noteId, setId === 'electric' ? 'clav' : 'digital', piano, bend, shiftedMidi);
    }
    let source: VoiceSourceNodeLike;
    const extraSources: VoiceSourceNodeLike[] = [];
    const extraGains: { gain: { value: number }; connect(d: unknown): void; disconnect(): void }[] = [];
    try {
      source = ctx.createBufferSource();
      const buf = ctx.createBuffer(1, entry.data.length, entry.sampleRate);
      buf.getChannelData(0).set(entry.data);
      source.buffer = buf as never;
      source.playbackRate.value = Math.pow(2, shiftSt / 12);
      source.detune.value = bend * 100;
      const gain = ctx.createGain();
      (gain.gain as unknown as { value: number }).value = Math.max(0.001, shaped);
      // Release stage: soft-release voices fade gently on noteOff (longer,
      // less pronounced release); normal voices stop promptly. Disabled for
      // Clav-type sounds per the manual.
      const isClav = model.id.startsWith('clav');
      const useSoft = piano.softRelease && !isClav;
      const releaseGain = ctx.createGain();
      (releaseGain.gain as unknown as { value: number }).value = 1;
      // Timbre shaping (audible EQ approximations on the voice path).
      const timbre = this.buildTimbre(ctx, piano.timbre);
      source.connect(timbre.entry as never);
      timbre.exit.connect(gain as never);
      gain.connect(releaseGain as never);
      releaseGain.connect(graph.input as never);
      // Unison: extra detuned copies through the same voice gain.
      const cents = [5, 10, 16];
      const copies = Math.min(3, Math.max(0, piano.unison));
      for (let c = 0; c < copies; c += 1) {
        const extra = ctx.createBufferSource();
        extra.buffer = source.buffer;
        extra.playbackRate.value = source.playbackRate.value;
        extra.detune.value = bend * 100 + cents[c];
        const eg = ctx.createGain();
        (eg.gain as unknown as { value: number }).value = 0.4 - c * 0.08;
        extra.connect(eg as never);
        eg.connect(timbre.entry as never);
        extraSources.push(extra);
        extraGains.push(eg as unknown as { gain: { value: number }; connect(d: unknown): void; disconnect(): void });
      }
      const stopAll = () => {
        for (const s of [source, ...extraSources]) {
          try { s.stop(); } catch { /* already stopped */ }
          try { s.disconnect(); } catch { /* already gone */ }
        }
        try { gain.disconnect(); } catch { /* already gone */ }
        try { releaseGain.disconnect(); } catch { /* already gone */ }
        for (const n of [...timbre.all, ...extraGains]) {
          try { n.disconnect(); } catch { /* already gone */ }
        }
      };
      const owned: OwnedStageVoice = {
        noteId,
        layer,
        midi,
        startedAt: this.clock.now(),
        sustained: sustain,
        softRelease: useSoft,
        releaseGain: releaseGain as unknown as OwnedStageVoice['releaseGain'],
        stop: stopAll,
      };
      source.onended = () => {
        if (this.voices.get(noteId) === owned) this.voices.delete(noteId);
      };
      this.voices.set(noteId, owned);
      this.enforcePolyphony();
      // String resonance wash while other notes or the pedal are held.
      if (piano.stringRes && (sustain || this.voices.size > 1)) this.addStringRes(layer, source);
      try {
        source.start();
        for (const s of extraSources) s.start();
      } catch {
        this.voices.delete(noteId);
        return null;
      }
      return noteId;
    } catch {
      return this.startSynthVoice(layer, midi, velocity, sustain, noteId, 'digital', piano, bend, shiftedMidi);
    }
  }

  private startSynthVoice(
    layer: LayerId,
    midi: number,
    velocity: number,
    sustain: boolean,
    noteId: string,
    kind: 'clav' | 'digital' | 'misc',
    piano: LayerPianoState,
    bend: number,
    shiftedMidi?: number,
  ): string | null {
    const graph = this.graphs[layer];
    if (!this.ctx || !graph) {
      this.voices.set(noteId, trackingVoice(noteId, layer, midi, this.clock.now(), sustain));
      this.enforcePolyphony();
      return noteId;
    }
    const ctx = this.ctx;
    const raw = touchGain(velocity, piano.kbTouch);
    const shaped = dynCompGain(raw, piano.dynComp);
    const rendered = renderSynthVoice(shiftedMidi ?? midi, velocity, kind, ctx.sampleRate || 44100);
    const buf = ctx.createBuffer(1, rendered.length, ctx.sampleRate || 44100);
    buf.getChannelData(0).set(rendered);
    const source = ctx.createBufferSource();
    source.buffer = buf as never;
    source.detune.value = bend * 100;
    const gain = ctx.createGain();
    (gain.gain as unknown as { value: number }).value = Math.max(0.001, shaped * 0.8);
    const useSoft = piano.softRelease && kind !== 'clav';
    const releaseGain = ctx.createGain();
    (releaseGain.gain as unknown as { value: number }).value = 1;
    const timbre = this.buildTimbre(ctx, piano.timbre);
    source.connect(timbre.entry as never);
    timbre.exit.connect(gain as never);
    gain.connect(releaseGain as never);
    releaseGain.connect(graph.input as never);
    const copies = Math.min(3, Math.max(0, piano.unison));
    const extraSources: VoiceSourceNodeLike[] = [];
    for (let c = 0; c < copies; c += 1) {
      const extra = ctx.createBufferSource();
      extra.buffer = source.buffer;
      extra.detune.value = bend * 100 + [5, 10, 16][c];
      extra.connect(timbre.entry as never);
      extraSources.push(extra);
    }
    const stopAll = () => {
      for (const s of [source, ...extraSources]) {
        try { s.stop(); } catch { /* already stopped */ }
        try { s.disconnect(); } catch { /* already gone */ }
      }
      try { gain.disconnect(); } catch { /* already gone */ }
      try { releaseGain.disconnect(); } catch { /* already gone */ }
      for (const n of timbre.all) {
        try { n.disconnect(); } catch { /* already gone */ }
      }
    };
    const owned: OwnedStageVoice = {
      noteId,
      layer,
      midi,
      startedAt: this.clock.now(),
      sustained: sustain,
      softRelease: useSoft,
      releaseGain: releaseGain as unknown as OwnedStageVoice['releaseGain'],
      stop: stopAll,
    };
    source.onended = () => {
      if (this.voices.get(noteId) === owned) this.voices.delete(noteId);
    };
    this.voices.set(noteId, owned);
    this.enforcePolyphony();
    if (piano.stringRes && (sustain || this.voices.size > 1)) this.addStringRes(layer, source);
    try {
      source.start();
      for (const s of extraSources) s.start();
    } catch {
      this.voices.delete(noteId);
      return null;
    }
    return noteId;
  }

  private buildTimbre(
    ctx: StageAudioContextLike,
    timbre: LayerPianoState['timbre'],
  ): { entry: unknown; exit: { connect(d: unknown): void }; all: { disconnect(): void }[] } {
    const entry = ctx.createGain();
    let tail: { connect(d: unknown): void } = entry as unknown as { connect(d: unknown): void };
    const all: { disconnect(): void }[] = [entry as unknown as { disconnect(): void }];
    const add = (type: 'lowshelf' | 'highshelf' | 'peaking', freq: number, gainDb: number, q = 1) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.gain.value = gainDb;
      if (type === 'peaking') f.Q.value = q;
      tail.connect(f as never);
      tail = f as unknown as { connect(d: unknown): void };
      all.push(f as unknown as { disconnect(): void });
    };
    if (timbre === 'Soft') add('highshelf', 4000, -9);
    else if (timbre === 'Mid') add('peaking', 1400, 6);
    else if (timbre === 'Bright') add('highshelf', 5000, 7);
    else if (timbre === 'Dyno 1') {
      add('highshelf', 2500, 5);
      add('peaking', 800, 3);
    } else if (timbre === 'Dyno 2') {
      add('highshelf', 1800, 7);
      add('peaking', 500, 4);
    }
    return { entry, exit: tail, all };
  }

  private addStringRes(layer: LayerId, from: VoiceSourceNodeLike): void {
    if (!this.ctx || !this.graphs[layer]) return;
    try {
      const ctx = this.ctx;
      const send = ctx.createGain();
      (send.gain as unknown as { value: number }).value = 0.12;
      const comb = ctx.createDelay(0.1);
      comb.delayTime.value = 0.037;
      const fb = ctx.createGain();
      (fb.gain as unknown as { value: number }).value = 0.35;
      comb.connect(fb as never);
      fb.connect(comb as never);
      comb.connect(this.graphs[layer]!.input as never);
      (from as unknown as { connect(d: unknown): void }).connect(send as never);
      send.connect(comb as never);
    } catch {
      /* resonance is best-effort */
    }
  }

  noteOff(noteId: string): void {
    const voice = this.voices.get(noteId);
    if (!voice) return;
    this.voices.delete(noteId);
    if (voice.softRelease && voice.releaseGain && this.ctx) {
      // Soft release: gentle ~180 ms fade (less pronounced cutoff), then stop.
      const param = voice.releaseGain.gain;
      try {
        if (param.setTargetAtTime) {
          param.setTargetAtTime(0, this.ctx.currentTime, 0.06);
        } else {
          param.value = 0;
        }
      } catch {
        param.value = 0;
      }
      const stop = voice.stop;
      const ctx = this.ctx;
      void ctx;
      // Deferred stop lets the fade sound; ownership already released.
      setTimeout(stop, 220);
      return;
    }
    voice.stop();
  }

  setSustained(noteId: string, sustained: boolean): void {
    const voice = this.voices.get(noteId);
    if (voice) voice.sustained = sustained;
  }

  allNotesOff(): number {
    const count = this.voices.size;
    for (const voice of this.voices.values()) voice.stop();
    this.voices.clear();
    return count;
  }

  async dispose(): Promise<void> {
    // Synchronous state teardown first: a re-init racing this dispose (StrictMode
    // setup→cleanup→setup) must see 'idle' and rebuild, never strand null graphs
    // behind a stale 'ready'/'fallback' status.
    this.allNotesOff();
    for (const layer of ['A', 'B'] as LayerId[]) {
      try {
        this.graphs[layer]?.dispose();
      } catch {
        /* ignore teardown errors */
      }
    }
    try {
      this.rotary?.dispose();
    } catch {
      /* ignore */
    }
    const ctx = this.ctx;
    this.graphs = { A: null, B: null };
    this.rotary = null;
    this.layerLevel = { A: null, B: null };
    this.rotaryTap = { A: null, B: null };
    this.rotaryReturn = { A: null, B: null };
    this.ctx = null;
    this.status = 'idle';
    this.detail = '';
    if (ctx) {
      try {
        await ctx.close();
      } catch {
        /* ignore teardown errors */
      }
    }
  }

  private enforcePolyphony(): void {
    while (this.voices.size > this.maxVoices) {
      let victim: OwnedStageVoice | null = null;
      for (const voice of this.voices.values()) {
        if (voice.sustained && (!victim || voice.startedAt < victim.startedAt)) victim = voice;
      }
      if (!victim) {
        for (const voice of this.voices.values()) {
          if (!victim || voice.startedAt < victim.startedAt) victim = voice;
        }
      }
      if (!victim) return;
      victim.stop();
      this.voices.delete(victim.noteId);
    }
  }

  /** Test seam: current per-layer effective delay/comp/reverb resolution. */
  effectiveUnits(layer: LayerId): { delay: ChainState['delay']; comp: ChainState['comp']; reverb: ChainState['reverb']; chain: ChainState } {
    return {
      chain: effectiveChain(layer, this.chainState, this.focus),
      delay: effectiveDelay(layer, this.chainState, this.focus),
      comp: effectiveComp(layer, this.chainState, this.focus),
      reverb: effectiveReverb(layer, this.chainState, this.focus),
    };
  }
}

export { effectiveChain, effectiveComp, effectiveDelay, effectiveReverb };
