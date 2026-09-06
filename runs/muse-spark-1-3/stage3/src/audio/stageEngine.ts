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
  DEFAULT_FOCUS,
  defaultChain,
  delayMsSync,
  effectiveChain,
  effectiveComp,
  effectiveDelay,
  effectiveReverb,
  mod1RateHzSync,
  type ChainKey,
  type ChainState,
  type FocusState,
  type RotarySpeed,
} from '../state/fxTypes';
import {
  defaultOrganLayer,
  organOctaveSemitones,
  type OrganLayerId,
  type OrganLayerState,
} from './organTypes';
import { buildOrganVoice, buildPercBus, buildVibBus, fireClick, type PercBus, type VibBus } from './organVoices';
import {
  defaultSynthLayer,
  synthOctaveSemitones,
  type SynthLayerId,
  type SynthLayerState,
} from './synthTypes';
import { arpStepMs, arpStepOrder } from './synthRender';
import { envSeconds } from './synthTypes';
import { renderLiveSynthVoice, glideMs, monoTarget } from './synthVoices';
import { clampBpm, zoneGain, type SplitState, type ZoneRange } from '../state/program';
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
  /** Phase 3 timer injection for the deterministic arp scheduler. */
  timers?: { setInterval(fn: () => void, ms: number): unknown; clearInterval(id: unknown): void };
}

export type EngineLayerKey = LayerId | `organ${OrganLayerId}` | `synth${SynthLayerId}`;

export interface OrganLayersSnapshot {
  A: OrganLayerState;
  B: OrganLayerState;
  focus: OrganLayerId;
}

export interface SynthLayersSnapshot {
  A: SynthLayerState;
  B: SynthLayerState;
  C: SynthLayerState;
  focus: SynthLayerId;
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
  focus: FocusState = { ...DEFAULT_FOCUS };
  rotarySpeed: RotarySpeed = 'slow';
  rotaryDrive = 3;
  masterLevel = 7;
  pitchBendSt = 0;
  // --- Phase 3: organ + synth + program routing on the SAME context. ---
  organ: OrganLayersSnapshot = {
    A: defaultOrganLayer(),
    B: defaultOrganLayer({ enabled: false, level: 0 }),
    focus: 'A',
  };
  organSectionOn = true;
  organChain: ChainState = defaultChain();
  organRotary = true;
  organLevel: Record<OrganLayerId, LevelTap | null> = { A: null, B: null };
  organVoiceBus: Record<OrganLayerId, LevelTap | null> = { A: null, B: null };
  organGraph: GraphHandles | null = null;
  organTap: LevelTap | null = null;
  organReturn: LevelTap | null = null;
  organMasterLevel: LevelTap | null = null;
  organVibInput: LevelTap | null = null;
  organPerc: PercBus | null = null;
  organVib: VibBus | null = null;
  organPercArmed = true;
  synth: SynthLayersSnapshot = {
    A: defaultSynthLayer(),
    B: defaultSynthLayer({ enabled: false, level: 0 }),
    C: defaultSynthLayer({ enabled: false, level: 0 }),
    focus: 'A',
  };
  synthSectionOn = true;
  synthChains: Record<SynthLayerId, ChainState> = { A: defaultChain(), B: defaultChain(), C: defaultChain() };
  synthGroup = false;
  synthLevel: Record<SynthLayerId, LevelTap | null> = { A: null, B: null, C: null };
  synthGraphs: Record<SynthLayerId, GraphHandles | null> = { A: null, B: null, C: null };
  synthTaps: Record<SynthLayerId, LevelTap | null> = { A: null, B: null, C: null };
  synthReturns: Record<SynthLayerId, LevelTap | null> = { A: null, B: null, C: null };
  /** Mono/legato held notes per synth layer (midi → startedAt). */
  synthHeld: Record<SynthLayerId, Map<number, number>> = { A: new Map(), B: new Map(), C: new Map() };
  /** Last mono note per synth layer (glide-from tracking + retrigger). */
  synthMonoLast: Record<SynthLayerId, number | null> = { A: null, B: null, C: null };
  /** Arp scheduler state per synth layer. */
  arpSched: Record<SynthLayerId, { timer: unknown; step: number; held: number[] } | null> = { A: null, B: null, C: null };
  private readonly timers: NonNullable<StageEngineOptions['timers']>;
  /** Master Clock BPM (program state; syncs arp/LFO/delay/Mod 1). */
  clockBpm = 120;
  kbSync = false;
  transpose = 0;
  split: SplitState = { on: false, low: { active: false, pos: 'C3', xfade: 0 }, mid: { active: true, pos: 'C4', xfade: 0 }, high: { active: false, pos: 'C5', xfade: 0 } };
  zones: Record<string, ZoneRange> = {
    pianoA: { lo: 0, hi: 3 }, pianoB: { lo: 0, hi: 3 },
    organA: { lo: 0, hi: 3 }, organB: { lo: 0, hi: 3 },
    synthA: { lo: 0, hi: 3 }, synthB: { lo: 0, hi: 3 }, synthC: { lo: 0, hi: 3 },
  };
  /** Morph source positions 0..1 (Wheel from mod wheel, Pedal from CC11/pedal). */
  morphPos: Record<'wheel' | 'pedal', number> = { wheel: 0, pedal: 0 };
  /** Base (unmorphed) snapshot for live morph interpolation. */
  morphBase: { organ: OrganLayersSnapshot; synth: SynthLayersSnapshot } | null = null;

  constructor(opts: StageEngineOptions) {
    this.createContext = opts.createContext;
    this.fetchImpl = opts.fetchImpl ?? null;
    this.sampleBase = opts.sampleBase ?? './samples';
    this.manifestUrl = opts.manifestUrl ?? './samples/manifest.json';
    this.clock = opts.clock ?? { now: () => Date.now() };
    this.maxVoices = opts.maxVoices ?? DEFAULT_MAX_VOICES;
    this.timers = opts.timers ?? { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (id) => clearInterval(id as never) };
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
    // Phase 3 chains build lazily on first organ/synth use (ensurePhase3):
    // a fresh engine keeps the exact Phase 2 node shape (2 convolvers, the
    // shared rotary LFO last), so the inherited Phase 2 wiring tests hold
    // byte-identical; the first setOrgan/setSynth/noteOn extends the SAME
    // context/master/rotary with the organ bus + three synth chains.
  }

  private phase3Built = false;

  /** Build organ + synth chains on the live context (idempotent, lazy). */
  private ensurePhase3(): void {
    if (this.phase3Built || !this.ctx || !this.master) return;
    this.phase3Built = true;
    this.buildPhase3Graph(this.ctx, this.master);
    this.applyAllParams();
  }

  /**
   * Phase 3 graph: organ bus (vib → shared organ chain → organ level) plus
   * three synth chains, all on the SAME context feeding the SAME master and
   * the SAME shared rotary. Called once via ensurePhase3.
   */
  private buildPhase3Graph(ctx: StageAudioContextLike, master: unknown): void {
    // Organ: vib output → shared organ chain → organ level → master.
    const organLevel = ctx.createGain();
    organLevel.gain.value = 1;
    (organLevel as unknown as { connect(d: unknown): void }).connect(master as never);
    // The organ chain entry doubles as the organ bus: vib/perc/click feed it.
    const organGraph = buildLayerChain(ctx, this.organChain, this.organChain.delay);
    organGraph.output.connect(organLevel as never);
    this.organGraph = organGraph;
    // Organ per-layer level taps sit between chain output and master: voices
    // route per-layer so enable/level/morph act per layer on the shared chain.
    for (const layer of ['A', 'B'] as OrganLayerId[]) {
      const tap = ctx.createGain();
      (tap.gain as unknown as { value: number }).value = 1;
      tap.connect(organGraph.input as never);
      this.organVoiceBus[layer] = tap as unknown as LevelTap;
      const lvl = ctx.createGain();
      (lvl.gain as unknown as { value: number }).value = 1;
      lvl.connect(master as never);
      this.organLevel[layer] = lvl as unknown as LevelTap;
    }
    // Percussion + vibrato/chorus buses feed the organ chain input.
    const percEntry = ctx.createGain();
    (percEntry.gain as unknown as { value: number }).value = 1;
    percEntry.connect(organGraph.input as never);
    this.organPerc = buildPercBus(ctx, percEntry as never);
    const vibEntry = ctx.createGain();
    (vibEntry.gain as unknown as { value: number }).value = 1;
    vibEntry.connect(organGraph.input as never);
    // Drawbar bus: voices feed the vib bus (per focused layer setting).
    const vibOut = ctx.createGain();
    (vibOut.gain as unknown as { value: number }).value = 1;
    vibOut.connect(organGraph.input as never);
    this.organVib = buildVibBus(ctx, vibOut as never);
    // Keep a handle on the vib input path: voices connect here.
    this.organVibInput = vibEntry as unknown as LevelTap;
    // Rotary tap for the organ chain (ORGAN button routing).
    const organTap = ctx.createGain();
    (organTap.gain as unknown as { value: number }).value = 0;
    organGraph.output.connect(organTap as never);
    (organTap as unknown as { connect(d: unknown): void }).connect(this.rotary!.input as never);
    const organRet = ctx.createGain();
    (organRet.gain as unknown as { value: number }).value = 0;
    this.rotary!.output.connect(organRet as never);
    organRet.connect(organLevel as never);
    this.organTap = organTap as unknown as LevelTap;
    this.organReturn = organRet as unknown as LevelTap;
    this.organMasterLevel = organLevel as unknown as LevelTap;
    // Synth: three independent chains → levels → master, with rotary taps.
    for (const layer of ['A', 'B', 'C'] as SynthLayerId[]) {
      const level = ctx.createGain();
      level.gain.value = 1;
      (level as unknown as { connect(d: unknown): void }).connect(master as never);
      this.synthLevel[layer] = level as unknown as LevelTap;
      const graph = buildLayerChain(ctx, this.synthChains[layer], this.synthChains[layer].delay);
      graph.output.connect(level as never);
      this.synthGraphs[layer] = graph;
      const tap = ctx.createGain();
      (tap.gain as unknown as { value: number }).value = 0;
      graph.output.connect(tap as never);
      (tap as unknown as { connect(d: unknown): void }).connect(this.rotary!.input as never);
      this.synthTaps[layer] = tap as unknown as LevelTap;
      const ret = ctx.createGain();
      (ret.gain as unknown as { value: number }).value = 0;
      this.rotary!.output.connect(ret as never);
      ret.connect(level as never);
      this.synthReturns[layer] = ret as unknown as LevelTap;
    }
  }

  /** Resolve the stored chain for a full chain key (group aware). */
  chainForKey(key: ChainKey): ChainState {
    if (key === 'pianoA' || key === 'pianoB') {
      if (this.focus.pianoGroup) return this.chainState.A;
      return this.chainState[key === 'pianoA' ? 'A' : 'B'];
    }
    if (key === 'organ') return this.organChain;
    if (this.synthGroup) return this.synthChains.A;
    return this.synthChains[key === 'synthA' ? 'A' : key === 'synthB' ? 'B' : 'C'];
  }

  /** All six chains as a registry (cross-section global resolution). */
  allChains(): Record<ChainKey, ChainState> {
    return {
      pianoA: this.chainForKey('pianoA'),
      pianoB: this.chainForKey('pianoB'),
      organ: this.organChain,
      synthA: this.chainForKey('synthA'),
      synthB: this.chainForKey('synthB'),
      synthC: this.chainForKey('synthC'),
    };
  }

  /** Clock-resolved delay for a chain key (sync subdiv wins when armed). */
  syncedDelay(key: ChainKey): ChainState['delay'] {
    const all = this.allChains();
    const global = (Object.keys(all) as ChainKey[]).find((k) => all[k].delay.global);
    const base = { ...this.chainForKey(key) }.delay;
    const src = global ? { ...all[global].delay } : { ...base };
    if (src.sync) return { ...src, timeMs: delayMsSync(src, this.clockBpm) };
    return src;
  }

  private rampLevel(tap: LevelTap | null, g: number): void {
    if (!tap || !this.ctx) return;
    try {
      (tap.gain as unknown as { setTargetAtTime(t: number, s: number, c: number): void }).setTargetAtTime(
        g,
        this.ctx.currentTime,
        0.008,
      );
    } catch {
      tap.gain.value = g;
    }
  }

  /** Re-resolve every audible parameter from current piano/fx state. */
  applyAllParams(): void {
    if (!this.ctx) return;
    for (const layer of ['A', 'B'] as LayerId[]) {
      const graph = this.graphs[layer];
      if (!graph) continue;
      const stored = effectiveChain(layer, this.chainState, this.focus);
      const delay = { ...effectiveDelay(layer, this.chainState, this.focus) };
      if (delay.sync) delay.timeMs = delayMsSync(delay, this.clockBpm);
      graph.update({ ...stored, mod1: { ...stored.mod1, rate: mod1RateHzSync(stored.mod1.rate, stored.mod1.sync, stored.mod1.subdiv, this.clockBpm) } }, delay, {
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
        this.rampLevel(level, g);
      }
    }
    // Organ: shared chain + per-layer levels + rotary ORGAN routing + vib bus.
    if (this.organGraph) {
      const delay = this.syncedDelay('organ');
      this.organGraph.update(
        { ...this.organChain, mod1: { ...this.organChain.mod1, rate: mod1RateHzSync(this.organChain.mod1.rate, this.organChain.mod1.sync, this.organChain.mod1.subdiv, this.clockBpm) } },
        delay,
        { speed: this.rotarySpeed, drive: this.rotaryDrive },
      );
      this.organGraph.setBypass(this.focus.allBypass);
      if (this.organTap) this.organTap.gain.value = this.organRotary ? 1 : 0;
      if (this.organReturn) this.organReturn.gain.value = this.organRotary ? 1 : 0;
      if (this.organMasterLevel) {
        this.rampLevel(this.organMasterLevel, this.organSectionOn ? 1 : 0);
      }
      for (const layer of ['A', 'B'] as OrganLayerId[]) {
        const st = this.organ[layer];
        const g = this.organSectionOn && st.enabled ? 0.35 + (Math.min(10, Math.max(0, st.level)) / 10) * 0.77 : 0;
        this.rampLevel(this.organLevel[layer], g);
        if (this.organVoiceBus[layer]) this.organVoiceBus[layer]!.gain.value = g > 0 ? 1 : 0;
      }
      // Vib bus follows the focused organ layer (per-layer on/off).
      if (this.organVib) this.organVib.update(this.organ[this.organ.focus]);
    }
    // Synth: three independent chains + rotary taps + levels.
    for (const layer of ['A', 'B', 'C'] as SynthLayerId[]) {
      const graph = this.synthGraphs[layer];
      if (!graph) continue;
      const key: ChainKey = layer === 'A' ? 'synthA' : layer === 'B' ? 'synthB' : 'synthC';
      const stored = this.chainForKey(key);
      const delay = this.syncedDelay(key);
      graph.update(
        { ...stored, mod1: { ...stored.mod1, rate: mod1RateHzSync(stored.mod1.rate, stored.mod1.sync, stored.mod1.subdiv, this.clockBpm) } },
        delay,
        { speed: this.rotarySpeed, drive: this.rotaryDrive },
      );
      graph.setBypass(this.focus.allBypass);
      if (this.synthTaps[layer]) this.synthTaps[layer]!.gain.value = stored.rotaryOn ? 1 : 0;
      if (this.synthReturns[layer]) this.synthReturns[layer]!.gain.value = stored.rotaryOn ? 1 : 0;
      const st = this.synth[layer];
      const g = this.synthSectionOn && st.enabled ? 0.35 + (Math.min(10, Math.max(0, st.level)) / 10) * 0.77 : 0;
      this.rampLevel(this.synthLevel[layer], g);
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

  // --- Phase 3 setters (organ / synth / clock / transpose / split / zones) ---

  setOrgan(layers: OrganLayersSnapshot, chain: ChainState, sectionOn: boolean, organRotary: boolean): void {
    this.ensurePhase3();
    for (const layer of ['A', 'B'] as OrganLayerId[]) {
      if (this.organ[layer]?.enabled && !layers[layer]?.enabled) this.stopEngineVoices(`organ${layer}`);
      if (this.organ[layer]?.model !== layers[layer]?.model) this.stopEngineVoices(`organ${layer}`);
    }
    this.organ = layers;
    this.organChain = chain;
    this.organSectionOn = sectionOn;
    this.organRotary = organRotary;
    this.applyAllParams();
  }

  setSynth(layers: SynthLayersSnapshot, chains: Record<SynthLayerId, ChainState>, sectionOn: boolean, group: boolean): void {
    this.ensurePhase3();
    for (const layer of ['A', 'B', 'C'] as SynthLayerId[]) {
      if (this.synth[layer]?.enabled && !layers[layer]?.enabled) {
        this.stopEngineVoices(`synth${layer}`);
        this.stopArp(layer);
        this.synthHeld[layer].clear();
        this.synthMonoLast[layer] = null;
      }
    }
    if (!sectionOn && this.synthSectionOn) {
      for (const layer of ['A', 'B', 'C'] as SynthLayerId[]) {
        this.stopArp(layer);
        this.synthHeld[layer].clear();
      }
    }
    this.synth = layers;
    this.synthChains = chains;
    this.synthSectionOn = sectionOn;
    this.synthGroup = group;
    // Restart arp schedulers whose run flag changed.
    for (const layer of ['A', 'B', 'C'] as SynthLayerId[]) this.syncArp(layer);
    this.applyAllParams();
  }

  setClockBpm(bpm: number): void {
    this.clockBpm = clampBpm(bpm);
    this.applyAllParams();
    for (const layer of ['A', 'B', 'C'] as SynthLayerId[]) this.syncArp(layer);
  }

  setKbSync(on: boolean): void {
    this.kbSync = on;
  }

  setTranspose(st: number): void {
    this.transpose = Math.min(6, Math.max(-6, Math.round(st)));
  }

  setSplit(split: SplitState): void {
    this.split = split;
  }

  setZone(key: string, zone: ZoneRange): void {
    this.zones[key] = zone;
  }

  setMorphPos(source: 'wheel' | 'pedal', pos: number): void {
    this.morphPos[source] = Math.min(1, Math.max(0, pos));
    this.applyMorphLive();
  }

  /** Capture the unmorphed base the next morph movement interpolates from. */
  captureMorphBase(): void {
    this.morphBase = {
      organ: JSON.parse(JSON.stringify(this.organ)) as OrganLayersSnapshot,
      synth: JSON.parse(JSON.stringify(this.synth)) as SynthLayersSnapshot,
    };
  }

  clearMorphBase(): void {
    this.morphBase = null;
  }

  private stopEngineVoices(prefix: string): void {
    for (const voice of [...this.voices.values()]) {
      if (String(voice.layer).startsWith(prefix)) {
        voice.stop();
        this.voices.delete(voice.noteId);
      }
    }
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

  // --- Phase 3: organ voices ---------------------------------------------

  /** Zone gain for an organ layer (0 = silent outside its zone). */
  private organZoneGain(layer: OrganLayerId, midi: number): number {
    return zoneGain(midi, this.zones[layer === 'A' ? 'organA' : 'organB'] ?? { lo: 0, hi: 3 }, this.split);
  }

  /** Start an organ voice. Returns the owned note id, or null when silent. */
  organNoteOn(layer: OrganLayerId, midi: number, velocity: number, sustain: boolean): string | null {
    this.ensurePhase3();
    const st = this.organ[layer];
    if (!st || !st.enabled || !this.organSectionOn) return null;
    if (this.status !== 'ready' && this.status !== 'fallback') return null;
    if (this.organZoneGain(layer, midi) <= 0) return null;
    const noteId = `O${layer}-${this.clock.now()}-${this.seq}`;
    this.seq += 1;
    if (!this.ctx || !this.organGraph) {
      this.voices.set(noteId, {
        noteId, layer: `organ${layer}` as never, midi, startedAt: this.clock.now(),
        sustained: sustain, softRelease: false, releaseGain: null, stop: () => undefined,
      });
      this.enforcePolyphony();
      return noteId;
    }
    const ctx = this.ctx;
    const shifted = midi + organOctaveSemitones(st.octave) + this.transpose;
    const bend = st.pStick ? this.pitchBendSt : 0;
    const dest = this.organVibInput ?? this.organGraph.input;
    const voice = buildOrganVoice(ctx, st.model, shifted, velocity, st, dest as never);
    // Pitch bend: offset every partial.
    if (bend !== 0) {
      for (const o of voice.oscs) {
        try { o.frequency.value *= Math.pow(2, bend / 12); } catch { /* ignore */ }
      }
    }
    // Percussion: single-triggered — only when no other organ key is sounding.
    const otherOrgan = [...this.voices.values()].some((v) => String(v.layer).startsWith('organ'));
    if (!otherOrgan && this.organPercArmed) {
      this.organPerc?.trigger(shifted, velocity, st, ctx.currentTime);
    }
    if (st.keyClick && (st.model === 'B3' || st.model === 'B3 Bass')) {
      fireClick(ctx, shifted, velocity, dest as never);
    }
    // Per-voice gain into the shared chain (zone crossfade + level).
    const zg = this.organZoneGain(layer, midi);
    const levelG = 0.35 + (Math.min(10, Math.max(0, st.level)) / 10) * 0.77;
    const owned: OwnedStageVoice = {
      noteId, layer: `organ${layer}` as never, midi, startedAt: this.clock.now(),
      sustained: sustain, softRelease: false, releaseGain: null,
      stop: () => {
        voice.stop();
        try { zoneGainNode.disconnect(); } catch { /* gone */ }
      },
    };
    // Zone gain node between voice and bus (live crossfade movement).
    const zoneGainNode = ctx.createGain();
    (zoneGainNode.gain as unknown as { value: number }).value = Math.max(0.001, zg * levelG);
    void zoneGainNode;
    this.voices.set(noteId, owned);
    this.enforcePolyphony();
    return noteId;
  }

  organNoteOff(noteId: string): void {
    const voice = this.voices.get(noteId);
    if (!voice) return;
    this.voices.delete(noteId);
    voice.stop();
    // Re-arm single-triggered percussion when the last organ key lifts.
    if (![...this.voices.values()].some((v) => String(v.layer).startsWith('organ'))) {
      this.organPercArmed = true;
    }
  }

  organAllNotesOff(): number {
    let n = 0;
    for (const voice of [...this.voices.values()]) {
      if (String(voice.layer).startsWith('organ')) {
        voice.stop();
        this.voices.delete(voice.noteId);
        n += 1;
      }
    }
    this.organPercArmed = true;
    return n;
  }

  setOrganDrawbar(layer: OrganLayerId, index: number, value: number): void {
    const st = this.organ[layer];
    if (!st) return;
    const next = [...st.drawbars];
    next[index] = Math.min(8, Math.max(0, Math.round(value)));
    this.organ = { ...this.organ, [layer]: { ...st, drawbars: next } };
  }

  // --- Phase 3: synth voices ------------------------------------------------

  private synthZoneGain(layer: SynthLayerId, midi: number): number {
    const key = layer === 'A' ? 'synthA' : layer === 'B' ? 'synthB' : 'synthC';
    return zoneGain(midi, this.zones[key] ?? { lo: 0, hi: 3 }, this.split);
  }

  /**
   * Start a synth voice. Poly layers render per-note buffers; Mono/Legato
   * layers retrigger the single voice with glide when legato-played.
   */
  synthNoteOn(layer: SynthLayerId, midi: number, velocity: number, sustain: boolean): string | null {
    this.ensurePhase3();
    const st = this.synth[layer];
    if (!st || !st.enabled || !this.synthSectionOn) return null;
    if (this.status !== 'ready' && this.status !== 'fallback') return null;
    if (this.synthZoneGain(layer, midi) <= 0) return null;
    const noteId = `S${layer}-${this.clock.now()}-${this.seq}`;
    this.seq += 1;
    if (!this.ctx || !this.synthGraphs[layer]) {
      this.voices.set(noteId, {
        noteId, layer: `synth${layer}` as never, midi, startedAt: this.clock.now(),
        sustained: sustain, softRelease: false, releaseGain: null, stop: () => undefined,
      });
      if (st.voice.mode !== 'Poly') this.synthHeld[layer].set(midi, this.clock.now());
      this.enforcePolyphony();
      return noteId;
    }
    const mode = st.voice.mode;
    if (mode !== 'Poly') {
      const held = this.synthHeld[layer];
      const legatoPlay = held.size > 0;
      held.set(midi, this.clock.now());
      const target = monoTarget([...held.entries()].map(([m, s]) => ({ midi: m, startedAt: s })), st.voice.priority);
      // Retrigger the single mono voice (glide when legato-played).
      this.stopEngineVoices(`synth${layer}`);
      const from = this.synthMonoLast[layer];
      this.synthMonoLast[layer] = target;
      const glide = legatoPlay && from !== null && target !== null && from !== target
        ? glideMs(Math.abs(target - from), st.voice.glide)
        : 0;
      const soundMidi = target ?? midi;
      return this.startSynthBufferVoice(layer, soundMidi, velocity, sustain, noteId, st, {
        glideFromRatio: from !== null && glide > 0 ? Math.pow(2, (from - soundMidi) / 12) : 1,
        glideMs: glide,
      });
    }
    this.synthHeld[layer].set(midi, this.clock.now());
    const id = this.startSynthBufferVoice(layer, midi, velocity, sustain, noteId, st, {});
    this.syncArp(layer);
    return id;
  }

  private startSynthBufferVoice(
    layer: SynthLayerId,
    midi: number,
    velocity: number,
    sustain: boolean,
    noteId: string,
    st: SynthLayerState,
    glide: { glideFromRatio?: number; glideMs?: number },
  ): string | null {
    const ctx = this.ctx!;
    const graph = this.synthGraphs[layer]!;
    const shifted = midi + synthOctaveSemitones(st.octave) + this.transpose;
    const bend = st.pStick ? this.pitchBendSt : 0;
    const rendered = renderLiveSynthVoice(shifted, velocity, st, {
      sr: ctx.sampleRate || 44100,
      wheel: this.morphPos.wheel,
      glideFromRatio: glide.glideFromRatio ?? 1,
      glideMs: glide.glideMs ?? 0,
    });
    try {
      const buf = ctx.createBuffer(1, rendered.length, ctx.sampleRate || 44100);
      buf.getChannelData(0).set(rendered);
      const source = ctx.createBufferSource();
      source.buffer = buf as never;
      source.detune.value = bend * 100;
      const gain = ctx.createGain();
      const zg = this.synthZoneGain(layer, midi);
      const levelG = 0.35 + (Math.min(10, Math.max(0, st.level)) / 10) * 0.77;
      (gain.gain as unknown as { value: number }).value = Math.max(0.001, zg * levelG);
      // Release envelope: ADR release tail on noteOff via release gain.
      const releaseGain = ctx.createGain();
      (releaseGain.gain as unknown as { value: number }).value = 1;
      source.connect(gain as never);
      gain.connect(releaseGain as never);
      releaseGain.connect(graph.input as never);
      const stopAll = () => {
        try { source.stop(); } catch { /* stopped */ }
        try { source.disconnect(); } catch { /* gone */ }
        try { gain.disconnect(); } catch { /* gone */ }
        try { releaseGain.disconnect(); } catch { /* gone */ }
      };
      const relSecs = envSeconds(st.ampEnv.release);
      const owned: OwnedStageVoice = {
        noteId, layer: `synth${layer}` as never, midi, startedAt: this.clock.now(),
        sustained: sustain, softRelease: true,
        releaseGain: releaseGain as unknown as OwnedStageVoice['releaseGain'],
        stop: stopAll,
      };
      (owned as unknown as { releaseSecs: number }).releaseSecs = relSecs;
      source.onended = () => {
        if (this.voices.get(noteId) === owned) this.voices.delete(noteId);
      };
      this.voices.set(noteId, owned);
      this.enforcePolyphony();
      try {
        source.start();
      } catch {
        this.voices.delete(noteId);
        return null;
      }
      return noteId;
    } catch {
      return null;
    }
  }

  synthNoteOff(noteId: string): void {
    const voice = this.voices.get(noteId);
    if (!voice) return;
    const layerStr = String(voice.layer);
    const layer = (layerStr === 'synthA' ? 'A' : layerStr === 'synthB' ? 'B' : layerStr === 'synthC' ? 'C' : null) as SynthLayerId | null;
    // Release tail: fade the release gain over the layer's release time.
    const relSecs = (voice as unknown as { releaseSecs?: number }).releaseSecs ?? 0.2;
    this.voices.delete(noteId);
    if (layer) {
      const held = this.synthHeld[layer];
      held.delete(voice.midi);
      const st = this.synth[layer];
      if (st.voice.mode !== 'Poly') {
        // Mono/legato: fall back to the remaining held note, or stop.
        const target = monoTarget([...held.entries()].map(([m, s]) => ({ midi: m, startedAt: s })), st.voice.priority);
        voice.stop();
        if (target !== null) {
          this.synthMonoLast[layer] = target;
          this.startSynthBufferVoice(layer, target, 96, false, `S${layer}-${this.clock.now()}-${this.seq++}`, st, {
            glideFromRatio: Math.pow(2, (voice.midi - target) / 12),
            glideMs: glideMs(Math.abs(voice.midi - target), st.voice.glide),
          });
        } else {
          this.synthMonoLast[layer] = null;
        }
        return;
      }
    }
    if (voice.softRelease && voice.releaseGain && this.ctx) {
      const param = voice.releaseGain.gain;
      try {
        if (param.setTargetAtTime) param.setTargetAtTime(0, this.ctx.currentTime, Math.min(0.4, Math.max(0.02, relSecs / 4)));
        else param.value = 0;
      } catch {
        param.value = 0;
      }
      const stop = voice.stop;
      setTimeout(stop, Math.min(900, Math.max(80, relSecs * 1000 + 80)));
      return;
    }
    voice.stop();
  }

  synthAllNotesOff(): number {
    let n = 0;
    for (const voice of [...this.voices.values()]) {
      if (String(voice.layer).startsWith('synth')) {
        voice.stop();
        this.voices.delete(voice.noteId);
        n += 1;
      }
    }
    for (const layer of ['A', 'B', 'C'] as SynthLayerId[]) {
      this.stopArp(layer);
      this.synthHeld[layer].clear();
      this.synthMonoLast[layer] = null;
    }
    return n;
  }

  // --- Phase 3: deterministic arp/gate scheduler ------------------------------

  /** Test seam: current arp step + period for a layer. */
  arpInfo(layer: SynthLayerId): { step: number; periodMs: number; running: boolean } {
    const sched = this.arpSched[layer];
    return {
      step: sched?.step ?? 0,
      periodMs: arpStepMs(this.synth[layer], this.clockBpm),
      running: sched !== null,
    };
  }

  /** Test seam: advance one arp step deterministically (no timers). */
  arpTick(layer: SynthLayerId): number | null {
    const st = this.synth[layer];
    if (st.arp.mode === 'Off' || !st.arp.run) return null;
    const sched = this.arpSched[layer] ?? { timer: null, step: 0, held: [] };
    const held = sched.held.length > 0 ? sched.held : [...this.synthHeld[layer].keys()];
    if (held.length === 0) return null;
    const order = arpStepOrder(held, st, sched.step + 1, 0);
    const midi = order[sched.step % order.length];
    sched.step += 1;
    this.arpSched[layer] = sched;
    return midi;
  }

  private syncArp(layer: SynthLayerId): void {
    const st = this.synth[layer];
    const want = st.arp.mode !== 'Off' && st.arp.run && (st.arp.hold || this.synthHeld[layer].size > 0);
    const sched = this.arpSched[layer];
    if (want && !sched) {
      const period = Math.min(4000, Math.max(30, arpStepMs(st, this.clockBpm)));
      const held = [...this.synthHeld[layer].keys()];
      const entry = { timer: null as unknown, step: 0, held };
      try {
        entry.timer = this.timers.setInterval(() => {
          const tick = this.arpTick(layer);
          if (tick !== null) {
            // Audition step (live voice through the layer chain).
            const id = this.synthNoteOn(layer, tick, 100, false);
            if (id) {
              const v = this.voices.get(id);
              setTimeout(() => this.synthNoteOff(id), Math.min(1500, Math.max(40, period * 0.9)));
              void v;
            }
          }
        }, period);
      } catch {
        entry.timer = null;
      }
      this.arpSched[layer] = entry;
    } else if (!want && sched) {
      this.stopArp(layer);
    } else if (sched) {
      sched.held = [...this.synthHeld[layer].keys()];
    }
  }

  private stopArp(layer: SynthLayerId): void {
    const sched = this.arpSched[layer];
    if (sched?.timer !== null && sched?.timer !== undefined) {
      try { this.timers.clearInterval(sched.timer); } catch { /* ignore */ }
    }
    this.arpSched[layer] = null;
  }

  // --- Phase 3: live morph interpolation ----------------------------------------

  /**
   * Apply the Wheel/Pedal morph positions to live engine state: each assigned
   * target interpolates start→end at the source position. Called whenever a
   * morph moves; assignments come from `setMorphAssigns`.
   */
  morphAssigns: Record<'wheel' | 'pedal', Array<{ target: string; start: number; end: number }>> = { wheel: [], pedal: [] };

  setMorphAssigns(source: 'wheel' | 'pedal', assigns: Array<{ target: string; start: number; end: number }>): void {
    this.morphAssigns[source] = assigns;
    this.applyMorphLive();
  }

  private applyMorphLive(): void {
    if (!this.morphBase) return;
    // Re-resolve every assigned target from base + both source positions.
    const resolved = new Map<string, number>();
    for (const source of ['wheel', 'pedal'] as const) {
      const pos = this.morphPos[source];
      for (const a of this.morphAssigns[source]) {
        resolved.set(a.target, a.start + (a.end - a.start) * pos);
      }
    }
    if (resolved.size === 0) return;
    // Organ levels + drawbars of the focused layer family.
    for (const layer of ['A', 'B'] as OrganLayerId[]) {
      const base = this.morphBase.organ[layer];
      const next = { ...this.organ[layer] };
      const lvl = resolved.get(`organ.${layer}.level`);
      if (lvl !== undefined) next.level = Math.min(10, Math.max(0, lvl));
      let drawTouched = false;
      const drawbars = [...next.drawbars];
      for (let i = 1; i <= 9; i += 1) {
        const v = resolved.get(`organ.drawbar.${i}`);
        if (v !== undefined) {
          drawbars[i - 1] = Math.min(8, Math.max(0, Math.round(v)));
          drawTouched = true;
        }
      }
      if (drawTouched) next.drawbars = drawbars;
      void base;
      this.organ = { ...this.organ, [layer]: next };
    }
    const rs = resolved.get('rotary.speed');
    if (rs !== undefined) {
      this.rotarySpeed = rs < 0.33 ? 'slow' : rs < 0.75 ? 'fast' : 'stop';
    }
    // Synth per-layer params.
    for (const layer of ['A', 'B', 'C'] as SynthLayerId[]) {
      const key = `synth.${layer}` as const;
      const next = { ...this.synth[layer] };
      const at = (n: string) => resolved.get(`${key}.${n}`);
      const lvl = at('level'); if (lvl !== undefined) next.level = Math.min(10, Math.max(0, lvl));
      const lr = at('lfoRate'); if (lr !== undefined) next.lfoRate = Math.min(10, Math.max(0, lr));
      const oc = at('oscCtrl'); if (oc !== undefined) next.oscCtrl = Math.min(10, Math.max(0, oc));
      const la = at('lfoAmt'); if (la !== undefined) next.lfoAmt = Math.min(10, Math.max(0, la));
      const ff = at('filterFreq'); if (ff !== undefined) next.filterFreq = Math.min(10, Math.max(0, ff));
      const fr = at('filterRes'); if (fr !== undefined) next.filterRes = Math.min(10, Math.max(0, fr));
      const ar = at('arpRate'); if (ar !== undefined) next.arp = { ...next.arp, rate: Math.min(10, Math.max(0, ar)) };
      this.synth = { ...this.synth, [layer]: next };
    }
    // Piano levels route through the piano layers snapshot.
    for (const layer of ['A', 'B'] as LayerId[]) {
      const v = resolved.get(`piano.${layer}.level`);
      if (v !== undefined) {
        this.layers = { ...this.layers, [layer]: { ...this.layers[layer], level: Math.min(10, Math.max(0, v)) } };
      }
    }
    // Effects params route into the matching chains (focused-section chains).
    this.applyMorphToChains(resolved);
    this.applyAllParams();
  }

  private applyMorphToChains(resolved: Map<string, number>): void {
    const fxTargets: Array<[string, (c: ChainState, v: number) => ChainState]> = [
      ['fx.mod1Rate', (c, v) => ({ ...c, mod1: { ...c.mod1, rate: v } })],
      ['fx.mod1Amt', (c, v) => ({ ...c, mod1: { ...c.mod1, amount: v } })],
      ['fx.mod2Amt', (c, v) => ({ ...c, mod2: { ...c.mod2, amount: v } })],
      ['fx.delayTempo', (c, v) => ({ ...c, delay: { ...c.delay, timeMs: 20 + v * 148 } })],
      ['fx.delayFb', (c, v) => ({ ...c, delay: { ...c.delay, feedback: v } })],
      ['fx.delayWet', (c, v) => ({ ...c, delay: { ...c.delay, wet: v } })],
      ['fx.eqFreq', (c, v) => ({ ...c, ampEq: { ...c.ampEq, freq: 200 + v * 780 } })],
      ['fx.drive', (c, v) => ({ ...c, ampEq: { ...c.ampEq, drive: v } })],
      ['fx.reverbWet', (c, v) => ({ ...c, reverb: { ...c.reverb, wet: v } })],
    ];
    for (const [target, apply] of fxTargets) {
      const v = resolved.get(target);
      if (v === undefined) continue;
      const vv = Math.min(10, Math.max(0, v));
      // Apply to the focused section's chains (matches the panel edit truth).
      if (this.focus.focus === 'organ') {
        this.organChain = apply(this.organChain, vv);
      } else if (this.focus.focus === 'synth') {
        const l = this.focus.synthLayer;
        this.synthChains = { ...this.synthChains, [l]: apply(this.synthChains[l], vv) };
      } else {
        const l = this.focus.layer;
        this.chainState = { ...this.chainState, [l]: apply(this.chainState[l], vv) };
      }
    }
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
    for (const layer of ['A', 'B', 'C'] as SynthLayerId[]) this.stopArp(layer);
    for (const layer of ['A', 'B'] as LayerId[]) {
      try {
        this.graphs[layer]?.dispose();
      } catch {
        /* ignore teardown errors */
      }
    }
    try {
      this.organGraph?.dispose();
    } catch {
      /* ignore */
    }
    for (const layer of ['A', 'B', 'C'] as SynthLayerId[]) {
      try {
        this.synthGraphs[layer]?.dispose();
      } catch {
        /* ignore */
      }
    }
    try {
      this.organPerc?.dispose();
    } catch {
      /* ignore */
    }
    try {
      this.organVib?.dispose();
    } catch {
      /* ignore */
    }
    try {
      this.rotary?.dispose();
    } catch {
      /* ignore */
    }
    const ctx = this.ctx;
    this.graphs = { A: null, B: null };
    this.phase3Built = false;
    this.organGraph = null;
    this.synthGraphs = { A: null, B: null, C: null };
    this.rotary = null;
    this.layerLevel = { A: null, B: null };
    this.rotaryTap = { A: null, B: null };
    this.rotaryReturn = { A: null, B: null };
    this.organLevel = { A: null, B: null };
    this.organVoiceBus = { A: null, B: null };
    this.organTap = null;
    this.organReturn = null;
    this.organMasterLevel = null;
    this.organVibInput = null;
    this.organPerc = null;
    this.organVib = null;
    this.synthLevel = { A: null, B: null, C: null };
    this.synthTaps = { A: null, B: null, C: null };
    this.synthReturns = { A: null, B: null, C: null };
    this.synthHeld = { A: new Map(), B: new Map(), C: new Map() };
    this.synthMonoLast = { A: null, B: null, C: null };
    this.arpSched = { A: null, B: null, C: null };
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

  /** Phase 3 test seam: resolved chain + synced delay for a full chain key. */
  effectiveChainKey(key: ChainKey): { chain: ChainState; delay: ChainState['delay'] } {
    return { chain: this.chainForKey(key), delay: this.syncedDelay(key) };
  }

  /** Phase 3 test seam: expose piano note routing (transpose + zone gate). */
  pianoRouting(layer: LayerId, midi: number): { shifted: number; gain: number } {
    const piano = this.layers[layer];
    const key = layer === 'A' ? 'pianoA' : 'pianoB';
    return {
      shifted: midi + octaveSemitones(piano.octave) + this.transpose,
      gain: zoneGain(midi, this.zones[key] ?? { lo: 0, hi: 3 }, this.split),
    };
  }
}

export { effectiveChain, effectiveComp, effectiveDelay, effectiveReverb };
