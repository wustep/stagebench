/**
 * Record one model's take for a show: piano-only DOM at ~2400 device px, MIDI driven through the
 * preview's own on-screen keybed.
 *
 * Usage: node scripts/record.mjs --show shows/<name>.json --model <run-id>
 * Output: .takes/<show>/<model>/{frames/, audio.webm, calib.webm, still.png, meta.json}
 *
 * The span is the model's segment from the plan, plus a 2-bar musical lead-in so notes still
 * ringing at its first downbeat exist in the take. Passes, all on one prepared page:
 *  0. warm-up: one note, or every (pitch, velocity) the take uses for engines that build notes on
 *     first use (models.json prewarm; they would otherwise stall the real-time scheduler);
 *  1. reference: plays the song's levelReferenceBars once -> calib.webm, used only for level matching;
 *  2. audio: real-time playback of song.audioMidi (pedal baked into note lengths), AudioContext tap;
 *  3. visual: for each 1/30 s frame, apply the key state of song.visualMidi (written lengths, same
 *     onsets/velocities) and screenshot the instrument. CDP screencast tops out near 10 fps at this
 *     size, too slow for fast passages; this is frame-exact.
 * Frame i shows MIDI time videoStartMidi + i/30; prep.mjs aligns the audio to the same clock.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { LAUNCH_ARGS, initScript, findInstrument, pianoOnly, hardwareBox, controlReport, installDriver } from './lib/page.mjs';
import { loadShow, loadMidi, events, assertSamePerformance, argv, FPS } from './lib/show.mjs';
import { runSetup } from './lib/setup.mjs';

const S = loadShow(argv('show'));
const key = argv('model');
const model = S.model(key);
if (!model) { console.error(`${key} is not in ${S.name}`); process.exit(1); }
const seg = S.plan.segments.find((s) => s.model === key);
const PREROLL = 1.0; // silent idle captured before the first played note
const TAIL = 2.5;

const playStart = seg.playStart;
const playEnd = seg.to; // last video frame needed; for the final model this includes the hold
const videoStartMidi = playStart - PREROLL;
const audioMidi = loadMidi(S.files.audio);
const visualMidi = loadMidi(S.files.visual);
assertSamePerformance(audioMidi, visualMidi);
// Optional per-model velocity quantization (models.json quantizeVelocity): N evenly spaced levels.
const q = model.quantizeVelocity;
const quant = (ev) => (q ? ev.map((e) => (e.on ? { ...e, vel: 1 + Math.round(((e.vel - 1) / 126) * (q - 1)) * (126 / (q - 1)) } : e)) : ev);
const audioEv = quant(events(audioMidi, playStart, seg.playBefore));
const visualEv = quant(events(visualMidi, playStart, seg.playBefore));
const refEv = quant(events(audioMidi, S.plan.ref.from, S.plan.ref.to).map((e) => ({ ...e, t: e.t - S.plan.ref.from })));
const firstNoteMidi = audioEv.find((e) => e.on).t;
console.log(`${key}: bars ${seg.bars.join('–')} MIDI ${playStart.toFixed(2)}–${playEnd.toFixed(2)}s`);

const outDir = S.takeDir(key);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, 'frames'), { recursive: true });

const vp = model.viewport;
const browser = await chromium.launch({ headless: !process.env.HEADFUL, args: LAUNCH_ARGS });
const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr });
const page = await context.newPage();
page.setDefaultTimeout(30000);
page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)));
page.on('crash', () => { console.error(`Error: ${key} page crashed`); process.exit(2); });
page.on('dialog', (d) => { console.log('dialog dismissed:', d.message().slice(0, 80)); d.dismiss().catch(() => {}); });
await page.addInitScript(initScript);
// 'load', not 'networkidle': some previews never go network-idle.
await page.goto(model.url, { waitUntil: 'load', timeout: 180000 }).catch((e) => console.log('goto warn', e.message.slice(0, 100)));
await page.waitForTimeout(4000);
for (const sel of ['[data-testid=screen-notice-dismiss]', 'button:has-text("Continue anyway")']) {
  const b = page.locator(sel).first();
  if (await b.count()) await b.click({ timeout: 800 }).catch(() => {});
}

// Setup steps (models.json): only controls the preview already ships.
const setupLog = await runSetup(page, model.setup);
await page.waitForTimeout(600);
const controlsAfter = await page.evaluate(controlReport);
console.log('setup', setupLog);

// Piano-only DOM surgery + centering.
const instSel = await page.evaluate(findInstrument);
if (!instSel) { console.error(`Error: ${key}: no instrument element with keys found`); process.exit(1); }
const surg = await page.evaluate(pianoOnly, { sel: instSel, bg: '#000' });
await page.mouse.move(2, 2);
await page.waitForTimeout(500);
const boxCss = await page.evaluate(hardwareBox, instSel);
console.log('instrument', instSel, 'box(device px)', boxCss.map((v) => Math.round(v * vp.dpr)));
await page.screenshot({ path: path.join(outDir, 'still.png') });
await page.evaluate(installDriver);

const mode = { y: 'front-loud', pressure: true };
// 0. Warm up: one note (starts the engine), or, for engines that build each note on first use
// (models.json prewarm), every (pitch, velocity) the take and reference will use. Notes are held
// 30 ms: zero-length notes crash some renderers, and a fast mass pre-warm crashed Fable 5, so
// it's only done where needed.
const warmPairs = model.prewarm
  ? [...new Map([...audioEv, ...refEv].filter((e) => e.on).map((e) => [`${e.note}:${e.vel}`, [e.note, e.vel]])).values()]
  : [[60, 30]];
const warm = await page.evaluate(async ({ pairs, mode }) => {
  const t = performance.now();
  for (const [n, v] of pairs) {
    window.__etudeKey.down(n, v, mode);
    await new Promise((r) => setTimeout(r, 30)); // never a zero-length note
    window.__etudeKey.up(n, mode);
    await new Promise((r) => setTimeout(r, 30));
  }
  return performance.now() - t;
}, { pairs: warmPairs, mode });
console.log(`warmed ${warmPairs.length} pitch/velocity pair(s) in ${(warm / 1000).toFixed(1)}s`);
await page.waitForTimeout(5000);
const ctxInfo = await page.evaluate(() => window.__etude.contexts.map((c) => ({ state: c.ctx.state, sr: c.ctx.sampleRate, outputLatency: c.ctx.outputLatency })));

// Real-time player: records the tap while playing `events` (times relative to the run's t=0).
const perform = ({ events, preroll, tail, mode }) => (async () => {
  const now = () => performance.timeOrigin + performance.now();
  const streams = window.__etude.contexts.map((c) => c.stream);
  if (!streams.length) return { error: 'no audio context' };
  let stream = streams[0];
  if (streams.length > 1) {
    const Base = Object.getPrototypeOf(window.AudioContext);
    const mix = new Base();
    const dest = mix.createMediaStreamDestination();
    for (const s of streams) mix.createMediaStreamSource(s).connect(dest);
    stream = dest.stream;
  }
  const chunks = [];
  const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 256000 });
  rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  const started = new Promise((r) => { rec.onstart = r; });
  const stopped = new Promise((r) => { rec.onstop = r; });
  rec.start(250);
  await started;
  const recStart = now();
  await new Promise((r) => setTimeout(r, preroll * 1000));
  const t0 = now();
  const p0 = performance.now();
  let hit = 0, miss = 0;
  const missed = new Set();
  const lates = [];
  for (const ev of events) {
    const target = ev.t * 1000;
    const wait = target - (performance.now() - p0);
    if (wait > 1) await new Promise((r) => setTimeout(r, wait));
    if (ev.on) lates.push(performance.now() - p0 - target);
    const ok = ev.on ? window.__etudeKey.down(ev.note, ev.vel, mode) : window.__etudeKey.up(ev.note, mode);
    if (ok) hit++; else { miss++; missed.add(`${ev.note}@${ev.t.toFixed(2)}`); }
  }
  for (let n = 21; n <= 108; n++) window.__etudeKey.up(n, mode);
  const last = events.length ? events[events.length - 1].t : 0;
  await new Promise((r) => setTimeout(r, Math.max(0, last * 1000 + tail * 1000 - (performance.now() - p0))));
  rec.stop();
  await stopped;
  const ab = await new Blob(chunks, { type: 'audio/webm' }).arrayBuffer();
  lates.sort((a, b) => a - b);
  return {
    recStart, t0, hit, miss, missed: [...missed].slice(0, 20),
    maxLate: lates.at(-1) ?? 0, p95Late: lates[Math.floor(lates.length * 0.95)] ?? 0,
    audioB64: btoa(Array.from(new Uint8Array(ab), (c) => String.fromCharCode(c)).join('')),
  };
})();

// 1. Reference pass for level matching.
const refRes = await page.evaluate(perform, { events: refEv, preroll: 0.5, tail: 2.5, mode });
if (refRes.error) { console.error(refRes.error); process.exit(1); }
fs.writeFileSync(path.join(outDir, 'calib.webm'), Buffer.from(refRes.audioB64, 'base64'));
await page.waitForTimeout(4000);

// 2. Audio pass: the segment span, times relative to playStart.
const rel = audioEv.map((e) => ({ ...e, t: e.t - playStart }));
const result = await page.evaluate(perform, { events: rel, preroll: PREROLL, tail: TAIL, mode });
if (result.error) { console.error(result.error); process.exit(1); }
fs.writeFileSync(path.join(outDir, 'audio.webm'), Buffer.from(result.audioB64, 'base64'));
if (result.p95Late > 50) console.error(`Error: ${key} scheduler ran late (p95 ${result.p95Late.toFixed(0)} ms): the page can't keep up; see README "Slow engines"`);

// 3. Visual pass: frame-exact written-length key state.
await page.waitForTimeout(3000);
const pad = 14;
const clip = { x: boxCss[0] - pad, y: boxCss[1] - pad, width: boxCss[2] + pad * 2, height: boxCss[3] + pad * 2, scale: vp.dpr }; // device px
const cdp = await context.newCDPSession(page);
const nFrames = Math.ceil((playEnd - videoStartMidi) * FPS) + 1;
const tv0 = Date.now();
await page.evaluate(({ events, mode }) => { window.__etudeVis = { events, mode, i: 0, down: new Set() }; }, { events: visualEv, mode });
for (let i = 0; i < nFrames; i++) {
  const t = videoStartMidi + i / FPS;
  await page.evaluate((t) => new Promise((resolve) => {
    const V = window.__etudeVis;
    while (V.i < V.events.length && V.events[V.i].t <= t) {
      const ev = V.events[V.i++];
      if (ev.on) {
        if (V.down.has(ev.note)) window.__etudeKey.up(ev.note, V.mode); // re-strike
        window.__etudeKey.down(ev.note, ev.vel, V.mode);
        V.down.add(ev.note);
      } else if (V.down.has(ev.note)) {
        window.__etudeKey.up(ev.note, V.mode);
        V.down.delete(ev.note);
      }
    }
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }), t);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 94, clip, optimizeForSpeed: true });
  fs.writeFileSync(path.join(outDir, 'frames', `f${String(i).padStart(6, '0')}.jpg`), Buffer.from(shot.data, 'base64'));
}
await page.evaluate(() => { for (let n = 21; n <= 108; n++) window.__etudeKey.up(n, window.__etudeVis.mode); });
console.log(`visual pass ${nFrames} frames in ${((Date.now() - tv0) / 1000).toFixed(1)}s`);

await context.close();
await browser.close();

const meta = {
  model: key, label: model.label, rank: model.rank, url: model.url, show: S.name, segment: seg,
  midiAudio: path.basename(S.files.audio), midiVisual: path.basename(S.files.visual),
  playStart, playEnd, videoStartMidi, firstNoteMidi, preroll: PREROLL, ref: S.plan.ref,
  viewport: vp, instrumentSelector: instSel, boxDevicePx: boxCss.map((v) => v * vp.dpr), surgery: { hidden: surg.hidden },
  setup: setupLog, controlsAfter, audioContexts: ctxInfo, velocityMode: mode, quantizeVelocity: q,
  prewarmPairs: warmPairs.length,
  recStartMs: result.recStart, t0Ms: result.t0, hit: result.hit, miss: result.miss, missed: result.missed,
  schedLateMs: { max: +result.maxLate.toFixed(1), p95: +result.p95Late.toFixed(1) },
  fps: FPS, frames: nFrames, clipCss: clip, capturedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 1));
console.log(`done ${key}: frames=${nFrames} hit=${result.hit} miss=${result.miss} ${result.missed.join(' ')} late p95=${meta.schedLateMs.p95}ms max=${meta.schedLateMs.max}ms`);
if (result.p95Late > 50) process.exit(3);
