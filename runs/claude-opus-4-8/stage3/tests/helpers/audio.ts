/**
 * Rendered-audio test helpers.
 *
 * We use node-web-audio-api's OfflineAudioContext to render REAL Web Audio and
 * assert on the resulting signal (peak / RMS / spectral energy), never on mocks.
 * This is the single BaseAudioContext the AudioEngine graph runs inside during
 * tests, matching the browser's one-context contract.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
// eslint-disable-next-line import/no-unresolved
import { OfflineAudioContext } from 'node-web-audio-api';
import { AudioEngine } from '../../src/audio/audioEngine';
import type { SampleLoaderDeps } from '../../src/audio/sampler';

const SAMPLES_DIR = join(process.cwd(), 'public', 'samples');

export function makeOfflineCtx(seconds = 1.2, sampleRate = 44100, channels = 2): BaseAudioContext {
  return new OfflineAudioContext(channels, Math.floor(seconds * sampleRate), sampleRate) as unknown as BaseAudioContext;
}

/** Loader deps that read the bundled sample files from disk and decode them. */
export function fsLoaderDeps(ctx: BaseAudioContext): SampleLoaderDeps {
  return {
    fetchBytes: async (url: string) => {
      // url looks like "samples/<set>/<file>"; strip leading base.
      const rel = url.replace(/^\/?/, '').replace(/^samples\//, '');
      const buf = await readFile(join(SAMPLES_DIR, rel));
      // Copy into a fresh current-realm ArrayBuffer. Under vitest's jsdom the
      // Node Buffer's pooled ArrayBuffer is a different realm and native
      // decodeAudioData rejects it; a freshly allocated one is accepted.
      const copy = new Uint8Array(buf.byteLength);
      copy.set(buf);
      return copy.buffer;
    },
    decode: (bytes: ArrayBuffer) =>
      (ctx as unknown as { decodeAudioData: (b: ArrayBuffer) => Promise<AudioBuffer> }).decodeAudioData(bytes),
    baseUrl: '',
  };
}

export interface RenderStats {
  peak: number;
  rms: number;
  buffer: AudioBuffer;
}

export async function render(ctx: BaseAudioContext): Promise<RenderStats> {
  const buffer = await (ctx as unknown as { startRendering: () => Promise<AudioBuffer> }).startRendering();
  const ch = buffer.getChannelData(0);
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < ch.length; i++) {
    const v = Math.abs(ch[i]);
    if (v > peak) peak = v;
    sum += ch[i] * ch[i];
  }
  return { peak, rms: Math.sqrt(sum / ch.length), buffer };
}

/** RMS of a channel over a time window [startSec, endSec). */
export function windowRms(buffer: AudioBuffer, startSec: number, endSec: number, channel = 0): number {
  const rate = buffer.sampleRate;
  const a = Math.max(0, Math.floor(startSec * rate));
  const b = Math.min(buffer.length, Math.floor(endSec * rate));
  const data = buffer.getChannelData(channel);
  let sum = 0;
  for (let i = a; i < b; i++) sum += data[i] * data[i];
  const n = Math.max(1, b - a);
  return Math.sqrt(sum / n);
}

/** Stereo difference: RMS of (L-R), a proxy for panning/width. */
export function stereoWidth(buffer: AudioBuffer): number {
  if (buffer.numberOfChannels < 2) return 0;
  const l = buffer.getChannelData(0);
  const r = buffer.getChannelData(1);
  let sum = 0;
  for (let i = 0; i < l.length; i++) {
    const d = l[i] - r[i];
    sum += d * d;
  }
  return Math.sqrt(sum / l.length);
}

/** Crude high-frequency energy estimate via first-difference RMS (brightness). */
export function brightness(buffer: AudioBuffer, channel = 0): number {
  const d = buffer.getChannelData(channel);
  let sum = 0;
  for (let i = 1; i < d.length; i++) {
    const diff = d[i] - d[i - 1];
    sum += diff * diff;
  }
  return Math.sqrt(sum / Math.max(1, d.length - 1));
}

/** Build an engine on a fresh offline context. */
export function makeEngine(seconds = 1.2): { engine: AudioEngine; ctx: BaseAudioContext } {
  const ctx = makeOfflineCtx(seconds);
  const engine = new AudioEngine(ctx);
  return { engine, ctx };
}
