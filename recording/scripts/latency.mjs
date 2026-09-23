/**
 * Check each model's output latency stays constant through a take-length run, so aligning its first
 * note (prep.mjs) keeps the whole turn in sync. Plays 10 isolated notes 1.2 s apart (the model's
 * setup applied) and reports each onset's delay relative to the first.
 *   node scripts/latency.mjs --show shows/<name>.json [--model <id>]
 */
import { chromium } from 'playwright';
import { spawnSync } from 'child_process';
import { LAUNCH_ARGS, initScript, installDriver } from './lib/page.mjs';
import { loadShow, argv } from './lib/show.mjs';
import { runSetup } from './lib/setup.mjs';

const S = loadShow(argv('show'));
const FF = process.env.FFMPEG || 'ffmpeg';
for (const m of S.models.filter((x) => !argv('model') || x.id === argv('model'))) {
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const page = await browser.newPage({ viewport: { width: m.viewport.width, height: m.viewport.height } });
  page.setDefaultTimeout(15000);
  await page.addInitScript(initScript);
  await page.goto(m.url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(3500);
  await runSetup(page, m.setup);
  await page.evaluate(installDriver);
  const notes = [60, 64, 67, 72, 62, 65, 69, 71, 60, 67];
  const b64 = await page.evaluate(async (notes) => {
    const K = window.__etudeKey, mode = { y: 'front-loud', pressure: true }, hold = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const n of notes) { K.down(n, 70, mode); await hold(60); K.up(n, mode); await hold(100); } // warm
    await hold(3000);
    const rec = new MediaRecorder(window.__etude.contexts[0].stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 256000 });
    const ch = []; rec.ondataavailable = (e) => ch.push(e.data); const done = new Promise((r) => { rec.onstop = r; });
    rec.start(100); await hold(500);
    const p0 = performance.now();
    for (let i = 0; i < notes.length; i++) {
      const w = i * 1200 - (performance.now() - p0); if (w > 1) await hold(w);
      K.down(notes[i], 90, mode); await hold(80); K.up(notes[i], mode);
    }
    await hold(1500); rec.stop(); await done;
    const ab = await new Blob(ch).arrayBuffer();
    return btoa(Array.from(new Uint8Array(ab), (c) => String.fromCharCode(c)).join(''));
  }, notes);
  await browser.close();
  const r = spawnSync(FF, ['-v', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { input: Buffer.from(b64, 'base64'), maxBuffer: 1 << 28 });
  const a = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength / 4);
  // Onset of each note: first sample above 25% of that note's window peak, searched per 1.2 s window.
  let first = 0; while (first < a.length && Math.abs(a[first]) < 0.002) first++;
  const on = [];
  for (let i = 0; i < notes.length; i++) {
    const w0 = first + Math.round((i * 1.2 - 0.3) * 48000), w1 = w0 + Math.round(0.9 * 48000);
    let pk = 0; for (let j = Math.max(0, w0); j < w1 && j < a.length; j++) pk = Math.max(pk, Math.abs(a[j]));
    // noise floor from the 100 ms before the window, so reverb tails don't read as onsets
    let j = Math.max(0, w0); while (j < w1 && Math.abs(a[j]) < pk * 0.25) j++;
    on.push(((j - first) / 48000 - i * 1.2) * 1000);
  }
  console.log(`${m.id.padEnd(18)} onset drift vs first note (ms): ${on.map((x) => x.toFixed(0).padStart(4)).join('')}   spread ${(Math.max(...on) - Math.min(...on)).toFixed(0)} ms`);
}
