/**
 * Turn a raw take into an aligned, level-matched intermediate.
 * Usage: node scripts/prep.mjs --show shows/<name>.json --model <run-id>
 *
 * frames/*.jpg -> take-video.mp4 (30 fps; frame i = MIDI time videoStartMidi + i/30)
 * audio.webm   -> take-audio.wav (48 kHz stereo float on the same clock: the first played note's
 *                 detected onset lands at firstNoteMidi - videoStartMidi)
 * Level: one linear gain per model so the shared reference passage (calib.webm, the same bars on
 * every model) measures REF_LUFS. Pianos match each other without flattening the song's own
 * dynamic arc; compose.mjs sets the film's final loudness. No limiting here.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { loadShow, argv } from './lib/show.mjs';

const FF = process.env.FFMPEG || 'ffmpeg';
const REF_LUFS = -18;
const SR = 48000;
const S = loadShow(argv('show'));
const key = argv('model');
const dir = S.takeDir(key);
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));

const run = (args) => {
  const r = spawnSync(FF, ['-hide_banner', '-nostdin', ...args], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + String(r.stderr).slice(-800));
  return r;
};
const loudness = (file) => {
  const r = spawnSync(FF, ['-hide_banner', '-nostdin', '-i', file, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' });
  return {
    I: Number(/I:\s+(-?[\d.]+) LUFS/.exec(r.stderr)?.[1]),
    TP: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(r.stderr.split('True peak:')[1] || '')?.[1]),
  };
};

// 1. Video from frames.
run(['-y', '-framerate', String(meta.fps), '-i', path.join(dir, 'frames/f%06d.jpg'),
  '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'slow', '-crf', '12', '-pix_fmt', 'yuv420p',
  path.join(dir, 'take-video.mp4')]);

// 2. Onset of the first played note, near where the scheduler put it (output latency ~70-90 ms).
const pcm = run(['-i', path.join(dir, 'audio.webm'), '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-']).stdout;
const a = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4);
const expected = (meta.t0Ms - meta.recStartMs) / 1000 + (meta.firstNoteMidi - meta.playStart);
const rms = (i0, i1) => { let s = 0; for (let i = i0; i < i1; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, i1 - i0)); };
const noise = rms(Math.max(0, Math.round((expected - 0.6) * SR)), Math.round((expected - 0.15) * SR));
const thr = Math.max(0.0015, noise * 8);
let onset = null;
for (let i = Math.round((expected - 0.15) * SR); i < Math.min(a.length, Math.round((expected + 0.5) * SR)); i++) {
  if (Math.abs(a[i]) > thr) { onset = i / SR; break; }
}
if (onset == null) throw new Error(`${key}: no onset near ${expected}s (noise ${noise}, thr ${thr})`);
let back = Math.round(onset * SR);
for (let i = back; i > back - 0.015 * SR; i--) if (Math.abs(a[i]) > thr / 4) back = i;
onset = back / SR;
const shift = onset - (meta.firstNoteMidi - meta.videoStartMidi);

// 3. Level from the reference passage, then aligned + gained stereo float.
const ref = loudness(path.join(dir, 'calib.webm'));
const gain = REF_LUFS - ref.I;
const alignFilter = shift >= 0 ? `atrim=start=${shift.toFixed(5)},asetpts=PTS-STARTPTS` : `adelay=${Math.round(-shift * 1000)}:all=1`;
run(['-y', '-i', path.join(dir, 'audio.webm'), '-af',
  `aresample=${SR}:filter_size=64:phase_shift=10,${alignFilter},aformat=channel_layouts=stereo,volume=${gain.toFixed(2)}dB`,
  '-c:a', 'pcm_f32le', path.join(dir, 'take-audio.wav')]);

const prep = { onsetSec: +onset.toFixed(4), expectedSec: +expected.toFixed(4), onsetLagMs: +((onset - expected) * 1000).toFixed(1),
  noise: +noise.toFixed(5), refRaw: ref, gainDb: +gain.toFixed(2) };
fs.writeFileSync(path.join(dir, 'prep.json'), JSON.stringify(prep, null, 1));
console.log(key, JSON.stringify(prep));
