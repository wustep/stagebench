/**
 * Pure deterministic DSP for the Phase 1 piano voice.
 *
 * Everything in this module is sample math with no browser dependencies, so
 * audio tests run deterministically under node/vitest. The voice is an
 * additive piano-like tone (fundamental + decaying partials with an
 * exponential envelope); velocity scales the peak, sustain/release scale the
 * tail. These directional relationships — not exact waveforms — are what the
 * audio test rules require.
 */

export const SAMPLE_RATE = 44100;

/** Equal-tempered frequency for a MIDI note number. */
export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Peak linear gain for a MIDI velocity 1..127 (Medium touch curve). */
export function velocityToGain(velocity: number): number {
  const v = Math.min(127, Math.max(1, Math.round(velocity)));
  return 0.12 + 0.88 * Math.pow(v / 127, 1.5);
}

/** Partial recipe: [ratio, amplitude, decay-rate multiplier]. */
const PARTIALS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 1.0, 1.0],
  [2, 0.42, 1.6],
  [3, 0.24, 2.3],
  [4.01, 0.14, 3.1],
  [5.02, 0.07, 4.2],
  [6.03, 0.04, 5.3],
];

export interface NoteRenderOptions {
  sampleRate?: number;
  /** Seconds of audio to render (tail included). */
  durationSec?: number;
  /** Sustain-pedal-held stretch of the body before release decay. */
  sustain?: boolean;
  /** Extra release length multiplier (soft-release path reserves this hook). */
  releaseScale?: number;
}

/**
 * Render one mono piano-like note. Deterministic for fixed inputs.
 * The first sample is ~0 (attack ramp) and peak amplitude tracks velocity.
 */
export function renderPianoNote(
  midi: number,
  velocity: number,
  opts: NoteRenderOptions = {},
): Float32Array {
  const sampleRate = opts.sampleRate ?? SAMPLE_RATE;
  const durationSec = opts.durationSec ?? (opts.sustain ? 3.2 : 1.6);
  const releaseScale = opts.releaseScale ?? 1;
  const total = Math.max(1, Math.floor(sampleRate * durationSec));
  const out = new Float32Array(total);
  const freq = midiToFrequency(midi);
  const gain = velocityToGain(velocity);
  const baseDecay = 2.6 / releaseScale;
  const attack = Math.floor(sampleRate * 0.004);

  for (const [ratio, amp, mult] of PARTIALS) {
    const f = freq * ratio;
    const decay = baseDecay * mult;
    for (let i = 0; i < total; i += 1) {
      const t = i / sampleRate;
      const env = Math.exp(-t * decay);
      const ramp = i < attack ? i / attack : 1;
      out[i] += gain * amp * env * ramp * Math.sin(2 * Math.PI * f * t);
    }
  }
  // Deterministic inharmonic "hammer" shimmer so overlapping voices differ
  // from a single voice and repeated notes are not bit-identical sustains.
  const seed = midi * 131 + Math.round(velocity);
  let s = seed;
  for (let i = 0; i < Math.min(total, sampleRate * 0.02); i += 1) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i] += gain * 0.05 * (s / 0x7fffffff - 0.5) * Math.exp(-i / (sampleRate * 0.004));
  }
  return out;
}

/** RMS level of a mono buffer. */
export function rms(buffer: Float32Array): number {
  if (buffer.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / buffer.length);
}

/** Index of the last sample whose |value| exceeds the threshold. */
export function tailLength(buffer: Float32Array, threshold = 0.001): number {
  for (let i = buffer.length - 1; i >= 0; i -= 1) {
    if (Math.abs(buffer[i]) > threshold) return i;
  }
  return 0;
}

export interface VoiceCandidate {
  noteId: string;
  midi: number;
  startedAt: number;
  sustained: boolean;
}

/**
 * Deterministic steal victim: oldest sustained voice first, else the oldest
 * voice overall. Pure function so tests assert the policy without audio.
 */
export function pickStealVictim(voices: VoiceCandidate[], now: number): VoiceCandidate | null {
  if (voices.length === 0) return null;
  const sustained = voices.filter((v) => v.sustained);
  const pool = sustained.length > 0 ? sustained : voices;
  let victim = pool[0];
  for (const v of pool) {
    const a = v.startedAt - now;
    const b = victim.startedAt - now;
    if (a < b || (a === b && v.noteId < victim.noteId)) victim = v;
  }
  return victim;
}
