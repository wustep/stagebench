/**
 * A/B a preview's sound with and without extra setup steps, to prove whether a control actually
 * contributes (e.g. "is Kimi's synth layer sounding?", "is Dyn Comp on?").
 *
 *   node scripts/abtest.mjs --show shows/<name>.json --model <id> --steps '[{"pressOffIfOn":"button[aria-label=\"Dyn Comp\"]"}]'
 *
 * Both runs apply the model's models.json setup first; run B then applies --steps. Plays the same
 * phrase (arpeggio, chord, low octave) and prints RMS, 8-band spectrum and L/R correlation deltas.
 * |delta| under ~0.3 dB in every band means the control doesn't affect the sound.
 */
import { chromium } from 'playwright';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { LAUNCH_ARGS, initScript, installDriver } from './lib/page.mjs';
import { loadShow, argv } from './lib/show.mjs';
import { runSetup } from './lib/setup.mjs';

const S = loadShow(argv('show'));
const m = S.model(argv('model'));
const extra = JSON.parse(argv('steps', '[]'));
// --bare: skip the model's models.json setup in both runs (compare against the program default).
const base = process.argv.includes('--bare') ? [] : m.setup;
const FF = process.env.FFMPEG || 'ffmpeg';

async function take(steps) {
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const page = await browser.newPage({ viewport: { width: m.viewport.width, height: m.viewport.height } });
  page.setDefaultTimeout(15000);
  await page.addInitScript(initScript);
  await page.goto(m.url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(3500);
  const log = await runSetup(page, [...base, ...steps]);
  await page.evaluate(installDriver);
  const b64 = await page.evaluate(async () => {
    const K = window.__etudeKey, mode = { y: 'front-loud', pressure: true };
    const hold = (ms) => new Promise((r) => setTimeout(r, ms));
    K.down(60, 60, mode); await hold(80); K.up(60, mode); await hold(2000);
    const rec = new MediaRecorder(window.__etude.contexts[0].stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 256000 });
    const ch = []; rec.ondataavailable = (e) => ch.push(e.data); const done = new Promise((r) => { rec.onstop = r; });
    rec.start(100); await hold(200);
    for (const n of [48, 52, 55, 60, 64, 67, 72, 76]) { K.down(n, 80, mode); await hold(140); K.up(n, mode); }
    for (const n of [53, 57, 60, 65]) K.down(n, 90, mode); await hold(900); for (const n of [53, 57, 60, 65]) K.up(n, mode);
    for (const n of [29, 41]) K.down(n, 100, mode); await hold(700); for (const n of [29, 41]) K.up(n, mode);
    await hold(1500); rec.stop(); await done;
    const ab = await new Blob(ch).arrayBuffer();
    return btoa(Array.from(new Uint8Array(ab), (c) => String.fromCharCode(c)).join(''));
  });
  await browser.close();
  const f = path.join(os.tmpdir(), `ab-${process.pid}-${steps.length}.webm`);
  fs.writeFileSync(f, Buffer.from(b64, 'base64'));
  const raw = spawnSync(FF, ['-v', 'error', '-i', f, '-ar', '48000', '-ac', '2', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 }).stdout;
  fs.rmSync(f);
  return { log, pcm: new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4) };
}

// Magnitude spectrum averaged over 4096-point frames, summed into octave-ish bands.
function analyse(pcm) {
  const N = 4096, bands = [60, 120, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const e = new Array(bands.length - 1).fill(0);
  let rms = 0, lr = 0, ll = 0, rr = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) { const l = pcm[i], r = pcm[i + 1]; rms += (l * l + r * r) / 2; lr += l * r; ll += l * l; rr += r * r; }
  const mono = new Float32Array(pcm.length / 2); for (let i = 0; i < mono.length; i++) mono[i] = (pcm[2 * i] + pcm[2 * i + 1]) / 2;
  for (let off = 0; off + N <= mono.length; off += N) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = mono[off + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= N; len <<= 1) {
      const a = (-2 * Math.PI) / len;
      for (let i = 0; i < N; i += len) for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(a * k), wi = Math.sin(a * k), xr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi, xi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k + len / 2] = re[i + k] - xr; im[i + k + len / 2] = im[i + k] - xi; re[i + k] += xr; im[i + k] += xi;
      }
    }
    for (let k = 1; k < N / 2; k++) { const f = (k * 48000) / N; const b = bands.findIndex((x, bi) => f >= x && f < bands[bi + 1]); if (b >= 0) e[b] += re[k] * re[k] + im[k] * im[k]; }
  }
  const db = (x) => 10 * Math.log10(x + 1e-20);
  return { rms: db(rms / (pcm.length / 2)), bands: e.map(db), corr: lr / Math.sqrt(ll * rr + 1e-20), labels: bands.slice(0, -1) };
}

const A = await take([]), B = await take(extra);
const a = analyse(A.pcm), b = analyse(B.pcm);
console.log(`${m.id}\n  A setup: ${JSON.stringify(A.log)}\n  B setup: ${JSON.stringify(B.log)}`);
console.log(`  RMS  A ${a.rms.toFixed(2)}  B ${b.rms.toFixed(2)}  delta ${(b.rms - a.rms).toFixed(2)} dB   L/R corr A ${a.corr.toFixed(3)} B ${b.corr.toFixed(3)}`);
console.log('  band Hz  ' + a.labels.map((x) => String(x).padStart(6)).join(''));
console.log('  delta dB ' + a.bands.map((x, i) => (b.bands[i] - x).toFixed(2).padStart(6)).join(''));
