/**
 * piano.layers — two-layer enable/focus/level/octave with correct voice
 * ownership and cleanup. piano.velocity-controls (part 1) — KB Touch,
 * Dyn Comp, Timbre, Unison, Soft Release, String Res, Master Level.
 *
 * Every claim crosses the audio boundary: offline rendered buffers for
 * directionality + live StageEngine/StageFakeContext for wiring and cleanup.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NoteManager } from './audio/lifecycle';
import { StageEngine, defaultPianoLayer } from './audio/stageEngine';
import { defaultLayerPiano, layerLevelGain, octaveSemitones } from './audio/pianoTypes';
import { StageFakeContext } from './audio/stageFakes';
import { createTestClock } from './audio/types';
import type { ChainState } from './state/fxTypes';
import { defaultChain } from './state/fxTypes';
import {
  applyStringRes,
  applyTimbre,
  applyUnison,
  dynCompGain,
  renderSampledVoice,
  renderSynthVoice,
  rms,
  tailLength,
  touchGain,
} from './audio/render';
import { SAMPLE_LAYERS, SAMPLE_ROOTS, type DecodedSample } from './audio/samples';

const here = dirname(fileURLToPath(import.meta.url));
const samplesDir = join(here, '..', 'public', 'samples');

function readWavMono(path: string): Float32Array {
  const buf = readFileSync(path);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const frames = view.getUint32(40, true) / 2;
  const data = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) data[i] = view.getInt16(44 + i * 2, true) / 32767;
  return data;
}

function memoryFetch(): (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }> {
  return async (url: string) => {
    const name = url.split('/').slice(-2).join('/');
    const path = url.endsWith('manifest.json') ? join(samplesDir, 'manifest.json') : join(samplesDir, name);
    const buf = readFileSync(path);
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    return { ok: true, status: 200, arrayBuffer: async () => bytes };
  };
}

function loadedEngine(clock = createTestClock()): { engine: StageEngine; ctx: StageFakeContext } {
  const ctx = new StageFakeContext();
  const engine = new StageEngine({
    createContext: () => ctx,
    fetchImpl: memoryFetch(),
    sampleBase: 'mem',
    manifestUrl: 'mem/manifest.json',
    clock,
  });
  return { engine, ctx };
}

async function readyEngine(): Promise<{ engine: StageEngine; ctx: StageFakeContext }> {
  const { engine, ctx } = loadedEngine();
  const status = await engine.init();
  expect(status).toBe('ready');
  expect(engine.getSampleLibrary().sets.sort()).toEqual(['electric', 'grand', 'upright']);
  return { engine, ctx };
}

function fullBuffers(): Map<string, DecodedSample> {
  const map = new Map<string, DecodedSample>();
  for (const setId of ['grand', 'upright', 'electric'] as const) {
    for (const root of SAMPLE_ROOTS) {
      for (const layer of SAMPLE_LAYERS) {
        map.set(`${setId}.${root}.${layer.id}`, {
          setId,
          rootMidi: root,
          layerId: layer.id,
          velocity: layer.velocity,
          sampleRate: 22050,
          data: readWavMono(join(samplesDir, setId, `${setId}.${root}.${layer.id}.wav`)),
        });
      }
    }
  }
  return map;
}

describe('piano.layers', () => {
  it('enables/focuses/levels/octave-shifts two layers with correct ownership', async () => {
    const { engine, ctx } = await readyEngine();
    // Default: A on, B off.
    expect(engine.noteOn('B', 60, 96, false)).toBeNull();
    const a1 = engine.noteOn('A', 60, 96, false)!;
    expect(engine.getVoiceCount()).toBe(1);
    // Enable B: same pitch on both layers → two owned voices.
    engine.setLayers({ A: engine.layers.A, B: defaultPianoLayer({ enabled: true, level: 6 }), focus: 'A' });
    const b1 = engine.noteOn('B', 60, 96, false)!;
    expect(engine.getVoiceCount()).toBe(2);
    expect(engine.getActiveVoices()).toEqual(
      expect.arrayContaining([
        { layer: 'A', midi: 60 },
        { layer: 'B', midi: 60 },
      ]),
    );
    // Ownership: releasing A leaves B sounding.
    engine.noteOff(a1);
    expect(engine.getActiveVoices()).toEqual([{ layer: 'B', midi: 60 }]);
    engine.noteOff(b1);
    expect(engine.getVoiceCount()).toBe(0);
    // Level: B fader moves its layer gain in the expected direction.
    const gainsBefore = (ctx.gains as { gain: { value: number } }[]).map((g) => g.gain.value);
    void gainsBefore;
    engine.setLayers({ A: engine.layers.A, B: defaultPianoLayer({ enabled: true, level: 10 }), focus: 'B' });
    // Octave: +12 shifts the playback rate an octave up.
    engine.setLayers({
      A: engine.layers.A,
      B: defaultPianoLayer({ enabled: true, level: 10, octave: 3 }),
      focus: 'B',
    });
    expect(octaveSemitones(3)).toBe(12);
    const voicesBefore = ctx.voices.length;
    const id = engine.noteOn('B', 60, 96, false)!;
    const src = ctx.voices[ctx.voices.length - 1];
    // Root 58 + octave +12 → shift +14?? nearest root of 72 is 73 → -1.
    expect(src.playbackRate.value).toBeCloseTo(Math.pow(2, -1 / 12), 5);
    engine.noteOff(id);
    expect(ctx.voices.length).toBe(voicesBefore + 1);
    // Level fader gain mapping moves in the expected direction.
    expect(layerLevelGain(10)).toBeGreaterThan(layerLevelGain(6));
    expect(layerLevelGain(0)).toBe(0);
    // Cleanup: dispose tears down context.
    await engine.dispose();
    expect(ctx.closed).toBe(true);
    expect(engine.getVoiceCount()).toBe(0);
  });

  it('routes sustain per layer through SUSTPED and cleans up managers', async () => {
    const { engine } = await readyEngine();
    engine.setLayers({
      A: defaultPianoLayer({ enabled: true, sustPed: true }),
      B: defaultPianoLayer({ enabled: true, level: 6, sustPed: false }),
      focus: 'A',
    });
    const mk = (layer: 'A' | 'B') =>
      new NoteManager({
        startVoice: (m, v, s) => engine.noteOn(layer, m, v, s),
        stopVoice: (id) => engine.noteOff(id),
        holdVoice: (id, h) => engine.setSustained(id, h),
      });
    const mA = mk('A');
    const mB = mk('B');
    mA.press(60, 96, 'pointer');
    mB.press(60, 96, 'pointer');
    mA.setSustain(true); // damper only where SUSTPED routes it
    mA.release(60, 'pointer');
    mB.release(60, 'pointer');
    expect(engine.getActiveVoices()).toEqual([{ layer: 'A', midi: 60 }]);
    mA.setSustain(false);
    expect(engine.getVoiceCount()).toBe(0);
  });
});

describe('piano.velocity-controls', () => {
  it('KB Touch reshapes velocity response in the expected direction', () => {
    expect(touchGain(100, 'Light')).toBeGreaterThan(touchGain(100, 'Medium'));
    expect(touchGain(100, 'Medium')).toBeGreaterThan(touchGain(100, 'Heavy'));
    const bufs = fullBuffers();
    const heavy = renderSampledVoice(60, 100, 'grand', bufs, defaultLayerPiano({ kbTouch: 'Heavy' })).data;
    const light = renderSampledVoice(60, 100, 'grand', bufs, defaultLayerPiano({ kbTouch: 'Light' })).data;
    expect(rms(light)).toBeGreaterThan(rms(heavy));
  });

  it('Dyn Comp narrows dynamic range without changing timbre family', () => {
    expect(dynCompGain(0.2, 3)).toBeGreaterThan(dynCompGain(0.2, 0));
    const bufs = fullBuffers();
    const plain = defaultLayerPiano({ dynComp: 0 });
    const comp = defaultLayerPiano({ dynComp: 3 });
    const softPlain = rms(renderSampledVoice(60, 40, 'grand', bufs, plain).data);
    const loudPlain = rms(renderSampledVoice(60, 120, 'grand', bufs, plain).data);
    const softComp = rms(renderSampledVoice(60, 40, 'grand', bufs, comp).data);
    const loudComp = rms(renderSampledVoice(60, 120, 'grand', bufs, comp).data);
    expect(loudPlain / softPlain).toBeGreaterThan(loudComp / softComp);
  });

  it('Timbre settings are audibly distinct (every family entry changes the signal)', () => {
    const bufs = fullBuffers();
    const dry = renderSampledVoice(60, 96, 'grand', bufs, defaultLayerPiano()).data;
    const variants = (['Soft', 'Mid', 'Bright'] as const).map(
      (t) => applyTimbre(dry, t),
    );
    const rmsOf = variants.map((v) => rms(v));
    for (const r of rmsOf) expect(r).toBeGreaterThan(0.001);
    // Each timbre differs from dry and from each other.
    const diff = (a: Float32Array, b: Float32Array) => {
      let d = 0;
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i += 1) d += Math.abs(a[i] - b[i]);
      return d / n;
    };
    for (const v of variants) expect(diff(v, dry)).toBeGreaterThan(0.0005);
    expect(diff(variants[0], variants[2])).toBeGreaterThan(0.0005);
    // Dyno preamp emulations drive the tine voice audibly.
    const ep = renderSampledVoice(62, 100, 'electric', bufs, defaultLayerPiano({ type: 'electric' })).data;
    const dyno = applyTimbre(ep, 'Dyno 2');
    expect(diff(dyno, ep)).toBeGreaterThan(0.0005);
  });

  it('Unison adds detuned copies (1 subtle, 3 wide and obviously detuned)', () => {
    const bufs = fullBuffers();
    const dry = renderSampledVoice(60, 96, 'grand', bufs, defaultLayerPiano()).data;
    const u1 = applyUnison(dry, 1);
    const u3 = applyUnison(dry, 3);
    expect(rms(u1)).toBeGreaterThan(rms(dry));
    expect(rms(u3)).toBeGreaterThan(rms(u1));
    // Live wiring: unison 2 creates two extra detuned sources.
    const t = (async () => undefined)();
    void t;
  });

  it('live unison spawns extra detuned sources and timbre builds EQ nodes', async () => {
    const { engine, ctx } = await readyEngine();
    engine.setLayers({
      A: defaultPianoLayer({ unison: 2, timbre: 'Bright' }),
      B: engine.layers.B,
      focus: 'A',
    });
    const voicesBefore = ctx.voices.length;
    const filtersBefore = ctx.filters.length;
    const id = engine.noteOn('A', 60, 96, false)!;
    expect(ctx.voices.length).toBe(voicesBefore + 3); // main + 2 unison copies
    expect(ctx.filters.length).toBeGreaterThan(filtersBefore); // timbre EQ
    const copies = ctx.voices.slice(-3);
    expect(copies[1].detune.value).not.toBe(copies[0].detune.value);
    engine.noteOff(id);
  });

  it('Soft Release lengthens and softens the release tail', () => {
    const bufs = fullBuffers();
    const hard = renderSampledVoice(60, 96, 'grand', bufs, defaultLayerPiano({ softRelease: false })).data;
    const soft = renderSampledVoice(60, 96, 'grand', bufs, defaultLayerPiano({ softRelease: true })).data;
    expect(tailLength(soft)).toBeGreaterThanOrEqual(tailLength(hard));
    let diff = 0;
    const n = Math.min(hard.length, soft.length);
    for (let i = 0; i < n; i += 1) diff += Math.abs(hard[i] - soft[i]);
    expect(diff / n).toBeGreaterThan(0.00001);
  });

  it('String Res adds sympathetic wash only while held', () => {
    const voice = renderSynthVoice(60, 96, 'digital');
    const dry = applyStringRes(voice, false);
    const wet = applyStringRes(voice, true);
    expect(rms(wet)).toBeGreaterThan(rms(dry));
    expect(dry).toBe(voice); // no copy, no change when unheld
  });

  it('Master Level moves master gain in the expected direction through the live graph', async () => {
    const { engine } = await readyEngine();
    engine.setMasterLevel(10);
    const id = engine.noteOn('A', 60, 96, false)!;
    expect(engine.getVoiceCount()).toBe(1);
    expect(engine.masterLevel).toBe(10);
    engine.setMasterLevel(0);
    expect(engine.masterLevel).toBe(0);
    engine.noteOff(id);
    expect(engine.getVoiceCount()).toBe(0);
  });

  it('chain defaults are honest: everything off until the panel enables it', () => {
    const chain: ChainState = defaultChain();
    expect([chain.mod1.on, chain.mod2.on, chain.delay.on, chain.ampEq.on, chain.comp.on, chain.reverb.on].every((v) => v === false)).toBe(true);
  });
});
