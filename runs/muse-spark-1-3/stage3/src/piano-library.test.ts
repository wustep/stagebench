/**
 * piano.instrument-library — six selectable types; Grand/Upright/Electric are
 * bundled recorded sample sets, audibly distinct, offline, truthful provenance.
 *
 * Audio-boundary rule: distinctions are proven on RENDERED BYTES — the real
 * shipped WAVs parsed from `public/samples/` plus the deterministic offline
 * renderer — never on labels or state alone.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PIANO_TYPES, modelOf, defaultLayerPiano, type PianoTypeId } from './audio/pianoTypes';
import { SAMPLE_ROOTS, SAMPLE_LAYERS, nearestRoot, velocityLayer, parseManifest } from './audio/samples';
import { renderSampledVoice, renderSynthVoice, rms, tailLength } from './audio/render';
import type { DecodedSample } from './audio/samples';

const here = dirname(fileURLToPath(import.meta.url));
const samplesDir = join(here, '..', 'public', 'samples');

function readWavMono(path: string): { sampleRate: number; data: Float32Array } {
  const buf = readFileSync(path);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const readStr = (o: number, n: number) => String.fromCharCode(...buf.subarray(o, o + n));
  expect(readStr(0, 4)).toBe('RIFF');
  expect(readStr(8, 4)).toBe('WAVE');
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bits = view.getUint16(34, true);
  expect(channels).toBe(1);
  expect(bits).toBe(16);
  // First chunk is `fmt ` (16 bytes) → data starts at 44.
  expect(readStr(36, 4)).toBe('data');
  const frames = view.getUint32(40, true) / 2;
  const data = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) data[i] = view.getInt16(44 + i * 2, true) / 32767;
  return { sampleRate, data };
}

function loadSet(setId: string): Map<string, DecodedSample> {
  const map = new Map<string, DecodedSample>();
  for (const root of SAMPLE_ROOTS) {
    for (const layer of SAMPLE_LAYERS) {
      const path = join(samplesDir, setId, `${setId}.${root}.${layer.id}.wav`);
      const { sampleRate, data } = readWavMono(path);
      map.set(`${setId}.${root}.${layer.id}`, {
        setId: setId as 'grand' | 'upright' | 'electric',
        rootMidi: root,
        layerId: layer.id,
        velocity: layer.velocity,
        sampleRate,
        data,
      });
    }
  }
  return map;
}

function correlation(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    num += a[i] * b[i];
    da += a[i] * a[i];
    db += b[i] * b[i];
  }
  return num / Math.sqrt(da * db || 1);
}

describe('piano.instrument-library', () => {
  it('offers six selectable types with at least one model each', () => {
    expect(PIANO_TYPES.map((t) => t.id)).toEqual(['grand', 'upright', 'electric', 'clav', 'digital', 'misc']);
    for (const type of PIANO_TYPES) {
      expect(type.models.length).toBeGreaterThanOrEqual(1);
      const layer = defaultLayerPiano({ type: type.id as PianoTypeId });
      expect(modelOf(layer)).toBeTruthy();
    }
  });

  it('bundles 45 offline WAV assets per recorded set with manifest provenance', () => {
    const manifestBytes = readFileSync(join(samplesDir, 'manifest.json'));
    const manifest = parseManifest(manifestBytes.buffer.slice(manifestBytes.byteOffset, manifestBytes.byteOffset + manifestBytes.byteLength));
    expect(manifest.license).toMatch(/CC0/i);
    expect(manifest.sets.map((s) => s.id).sort()).toEqual(['electric', 'grand', 'upright']);
    for (const set of manifest.sets) {
      expect(set.files).toHaveLength(45);
      expect(set.rootNotes).toEqual(SAMPLE_ROOTS);
      for (const file of set.files) {
        expect(existsSync(join(samplesDir, file))).toBe(true);
      }
      // Multi-root discipline: worst-case shift is +/-3 semitones.
      for (let midi = 28; midi <= 100; midi += 1) {
        expect(Math.abs(nearestRoot(midi).shiftSt)).toBeLessThanOrEqual(3);
      }
      expect(velocityLayer(20).id).toBe('soft');
      expect(velocityLayer(80).id).toBe('mid');
      expect(velocityLayer(120).id).toBe('loud');
    }
  });

  it('renders Grand/Upright/Electric audibly distinct from real shipped bytes', () => {
    const sets = { grand: loadSet('grand'), upright: loadSet('upright'), electric: loadSet('electric') };
    const plain = defaultLayerPiano();
    const voices = (['grand', 'upright', 'electric'] as const).map((setId) => {
      const { data, fallback } = renderSampledVoice(60, 96, setId, sets[setId], plain);
      expect(fallback).toBe(false);
      expect(rms(data)).toBeGreaterThan(0.01); // differs from silence
      return data;
    });
    // Pairwise: clearly not identical renders (corr < 0.99), all non-silent.
    const pairs: Array<[number, number]> = [[0, 1], [0, 2], [1, 2]];
    for (const [a, b] of pairs) {
      expect(correlation(voices[a], voices[b])).toBeLessThan(0.99);
    }
    // Timbre signatures: upright is darker than grand (less HF energy),
    // electric sustains longer than the clav-ish transient would suggest.
    const hf = (data: Float32Array) => {
      let fast = 0;
      for (let i = 1; i < Math.min(data.length, 22050); i += 1) fast += Math.abs(data[i] - data[i - 1]);
      return fast;
    };
    expect(hf(voices[0])).toBeGreaterThan(hf(voices[1]));
    expect(tailLength(voices[2])).toBeGreaterThan(0);
  });

  it('selects velocity layers with real timbre differences (not just gain)', () => {
    const grand = loadSet('grand');
    const plain = defaultLayerPiano();
    const soft = renderSampledVoice(60, 32, 'grand', grand, plain).data;
    const loud = renderSampledVoice(60, 120, 'grand', grand, plain).data;
    expect(rms(loud)).toBeGreaterThan(rms(soft) * 1.3);
    // Spectral shape differs: harder strokes open the upper partials
    // relatively wider (see scripts/generate-samples.mjs). Goertzel probes
    // at f0 and 3×f0 on the settled tail (transient skipped): the upper
    // partial must grow faster than the fundamental across layers.
    const partialRatio = (data: Float32Array, midi: number) => {
      const f0 = 440 * Math.pow(2, (midi - 69) / 12);
      const seg = data.subarray(2200, Math.min(data.length, 22050));
      const n = seg.length;
      const mag = (freq: number) => {
        let re = 0;
        let im = 0;
        for (let i = 0; i < n; i += 1) {
          const ph = (2 * Math.PI * freq * i) / 22050;
          re += seg[i] * Math.cos(ph);
          im += seg[i] * Math.sin(ph);
        }
        return Math.hypot(re, im) / n;
      };
      return mag(f0 * 3) / (mag(f0) || 1);
    };
    expect(partialRatio(loud, 60)).toBeGreaterThan(partialRatio(soft, 60) * 1.5);
  });

  it('renders Clav/Digital/Misc as honest synthesis, distinct from each other', () => {
    const clav = renderSynthVoice(60, 96, 'clav');
    const digital = renderSynthVoice(60, 96, 'digital');
    const misc = renderSynthVoice(60, 96, 'misc');
    for (const voice of [clav, digital, misc]) expect(rms(voice)).toBeGreaterThan(0.01);
    expect(correlation(clav, digital)).toBeLessThan(0.99);
    expect(correlation(clav, misc)).toBeLessThan(0.99);
    expect(correlation(digital, misc)).toBeLessThan(0.99);
  });
});
