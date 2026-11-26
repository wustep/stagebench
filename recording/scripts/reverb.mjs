/**
 * Reverb and level parity: play the same staccato chord on every filmable model of a show, with its
 * models.json setup, and measure how wet it sounds, not what its knob says.
 *
 *   node scripts/reverb.mjs --show shows/<name>.json [--model <id>] [--steps '<extra setup JSON>'] [--reps 2] [--json out.json]
 *
 * The probe is a C-major chord (C3 G3 C4 E4 G4, velocity 80) held 150 ms, then 3.5 s of silence,
 * recorded from the page's AudioContext tap (as in record.mjs). From 10 ms RMS frames (L+R energy):
 *  - level: the chord's peak frame (dBFS) and its first 150 ms (dBFS), before any level matching;
 *  - tail: the level 0.1, 0.3, 0.6, 1.0, 1.5 and 2.0 s after the keys lift, relative to the peak
 *    (100 ms windows). The early points are mostly the reverb's level, the late ones its length;
 *  - decay: seconds after release until the envelope is 40 and 60 dB under the peak;
 *  - wet 1s / wet all: tail energy from 50 ms after release to 1 s / to the end, over the energy
 *    while the keys are down (the reverb level running music sits in, and its full length);
 *  - vs the reference (Opus 5.5's own default reverb, --ref): RMS dB difference of the tail points
 *    out to 1.5 s, and the wet-1s difference.
 * A piano with no reverb (or one whose reverb does nothing) still has its own release, so compare
 * against the dry pianos too. --steps applies extra setup after the fixture's (to try a value).
 */
import { chromium } from 'playwright';
import { spawnSync } from 'child_process';
import fs from 'fs';
import { LAUNCH_ARGS, initScript, installDriver } from './lib/page.mjs';
import { loadShow, argv } from './lib/show.mjs';
import { runSetup } from './lib/setup.mjs';
import { previewUrl } from './lib/serve.mjs';

const S = loadShow(argv('show'));
const only = argv('model');
const extra = JSON.parse(argv('steps', '[]'));
const REPS = Number(argv('reps', 2));
const FF = process.env.FFMPEG || 'ffmpeg';
const SR = 48000;
const HOLD = 0.15;
const AT = [0.1, 0.3, 0.6, 1.0, 1.5, 2.0];

async function take(m) {
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const page = await browser.newPage({ viewport: { width: m.viewport.width, height: m.viewport.height } });
  page.setDefaultTimeout(15000);
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  const failed = [];
  page.on('requestfailed', (r) => { const e = r.failure()?.errorText || ''; if (!/ERR_ABORTED/.test(e)) failed.push(r.url().split('/').pop()); });
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.url().split('/').pop()} ${r.status()}`); });
  await page.addInitScript(initScript);
  await page.goto(await previewUrl(m), { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(3500);
  const log = await runSetup(page, [...m.setup, ...extra]);
  await page.evaluate(installDriver);
  const runs = [];
  for (let r = 0; r < REPS; r++) {
    const b64 = await page.evaluate(async (HOLD) => {
      const K = window.__etudeKey, mode = { y: 'front-loud', pressure: true };
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      K.down(60, 60, mode); await wait(80); K.up(60, mode); await wait(3000); // engine warm, then silence
      const rec = new MediaRecorder(window.__etude.contexts[0].stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 256000 });
      const ch = []; rec.ondataavailable = (e) => ch.push(e.data); const done = new Promise((res) => { rec.onstop = res; });
      rec.start(100); await wait(400);
      const chord = [48, 55, 60, 64, 67];
      for (const n of chord) K.down(n, 80, mode);
      await wait(HOLD * 1000);
      for (const n of chord) K.up(n, mode);
      await wait(3500); rec.stop(); await done;
      const ab = await new Blob(ch).arrayBuffer();
      return btoa(Array.from(new Uint8Array(ab), (c) => String.fromCharCode(c)).join(''));
    }, HOLD);
    runs.push(analyse(decode(b64)));
  }
  const oled = await page.evaluate(() => [...document.querySelectorAll('[class*=oled],[class*=display],[class*=lcd],[class*=screen]')].map((e) => e.textContent.trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 2).join(' / '));
  await browser.close();
  return { log, failed, oled, runs };
}

function decode(b64) {
  const f = `${process.env.TMPDIR || '/tmp'}/rv-${process.pid}-${Date.now()}.webm`;
  fs.writeFileSync(f, Buffer.from(b64, 'base64'));
  const raw = spawnSync(FF, ['-v', 'error', '-i', f, '-ar', String(SR), '-ac', '2', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 }).stdout;
  fs.rmSync(f);
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

function analyse(pcm) {
  const n = pcm.length / 2, hop = Math.round(0.01 * SR);
  const e = []; // energy per 10 ms frame
  for (let i = 0; i + hop <= n; i += hop) { let s = 0; for (let j = i; j < i + hop; j++) s += pcm[2 * j] ** 2 + pcm[2 * j + 1] ** 2; e.push(s / hop); }
  const db = (x) => 10 * Math.log10(x + 1e-14);
  const peakE = Math.max(...e);
  const onset = e.findIndex((x) => db(x) > db(peakE) - 30); // first frame within 30 dB of the peak
  const rel = onset + Math.round(HOLD * 100);
  const win = (t0, t1) => { const a = rel + Math.round(t0 * 100), b = Math.min(e.length, rel + Math.round(t1 * 100)); let s = 0; for (let i = a; i < b; i++) s += e[i]; return s / Math.max(1, b - a); };
  const tail = Object.fromEntries(AT.map((t) => [t, +(db(win(t, t + 0.1)) - db(peakE)).toFixed(1)]));
  const under = (d) => { for (let i = rel; i < e.length; i++) if (db(e[i]) < db(peakE) - d) return +((i - rel) / 100).toFixed(2); return null; };
  let during = 0; for (let i = onset; i < rel; i++) during += e[i];
  let after = 0; for (let i = rel + 5; i < e.length; i++) after += e[i];
  let first = 0; for (let i = rel + 5; i < Math.min(e.length, rel + 100); i++) first += e[i];
  return { peakDb: +db(peakE).toFixed(1), chordDb: +db(during / Math.max(1, rel - onset)).toFixed(1), tail, t40: under(40), t60: under(60), wetDryDb: +(db(after) - db(during)).toFixed(1), wet1sDb: +(db(first) - db(during)).toFixed(1) };
}

const results = {};
for (const m of S.filmable.filter((x) => !only || x.id === only)) {
  const r = await take(m);
  const avg = (f) => +(r.runs.reduce((s, x) => s + f(x), 0) / r.runs.length).toFixed(1);
  const med = { peakDb: avg((x) => x.peakDb), chordDb: avg((x) => x.chordDb), tail: Object.fromEntries(AT.map((t) => [t, avg((x) => x.tail[t])])),
    t40: avg((x) => x.t40 ?? 9), t60: avg((x) => x.t60 ?? 9), wetDryDb: avg((x) => x.wetDryDb), wet1sDb: avg((x) => x.wet1sDb) };
  results[m.id] = { setup: r.log, failedRequests: r.failed, oled: r.oled, ...med, spread: { wetDryDb: +(Math.max(...r.runs.map((x) => x.wetDryDb)) - Math.min(...r.runs.map((x) => x.wetDryDb))).toFixed(1) } };
  if (r.failed.length) console.error(`${m.id}: ${r.failed.length} failed request(s): ${r.failed.slice(0, 4).join(', ')}`);
}
// Mismatch against the reference reverb (Opus 5.5's own default; --ref to change, --ref-json to
// compare against a saved run): RMS dB difference of the tail points out to 1.5 s.
const REF = argv('ref', 'claude-opus-5-5');
const refJson = argv('ref-json');
const ref = results[REF] || (refJson && fs.existsSync(refJson) ? JSON.parse(fs.readFileSync(refJson, 'utf8'))[REF] : null);
const FIT = AT.filter((t) => t <= 1.5);
for (const x of Object.values(results)) if (ref) x.vsRef = { rmsDb: +Math.sqrt(FIT.reduce((s, t) => s + (x.tail[t] - ref.tail[t]) ** 2, 0) / FIT.length).toFixed(1), wet1sDb: +(x.wet1sDb - ref.wet1sDb).toFixed(1), wetDryDb: +(x.wetDryDb - ref.wetDryDb).toFixed(1) };
console.log(`\nchord C3-G4 vel 80, ${HOLD * 1000} ms; tail = dB under the peak, n s after release (mean of ${REPS}); wet 1s / wet all = tail energy (first 1 s / to the end) over the chord's`);
console.log(`${'model'.padEnd(20)} ${'peak'.padStart(6)} ${'chord'.padStart(6)}  ${AT.map((t) => `+${t}s`.padStart(6)).join('')}  ${'t-40'.padStart(5)} ${'t-60'.padStart(5)}  wet 1s  wet all${ref ? `   vs ${REF}: tail rms / wet 1s` : ''}`);
for (const [id, x] of Object.entries(results)) {
  console.log(`${id.padEnd(20)} ${x.peakDb.toFixed(1).padStart(6)} ${x.chordDb.toFixed(1).padStart(6)}  ${AT.map((t) => x.tail[t].toFixed(1).padStart(6)).join('')}  ${x.t40.toFixed(2).padStart(5)} ${x.t60.toFixed(2).padStart(5)}  ${x.wet1sDb.toFixed(1).padStart(6)}  ${x.wetDryDb.toFixed(1).padStart(6)} (±${x.spread.wetDryDb})${x.vsRef ? `   ${x.vsRef.rmsDb.toFixed(1).padStart(5)} / ${(x.vsRef.wet1sDb > 0 ? '+' : '') + x.vsRef.wet1sDb.toFixed(1)}` : ''}${x.failedRequests.length ? '  FAILED REQUESTS' : ''}`);
  if (x.setup.length) console.log(`${''.padEnd(20)} setup: ${x.setup.join(' | ')}`);
}
const out = argv('json');
if (out) fs.writeFileSync(out, JSON.stringify(results, null, 1));
