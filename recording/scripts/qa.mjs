/**
 * Check a rendered show before sharing it.
 * Usage: node scripts/qa.mjs --show shows/<name>.json
 *
 * Writes .takes/<show>/_work/contact.png (a frame from the middle of every model's segment) and
 * prints: first-note timing vs plan, level just before / at each cut (a gap or double hit shows as
 * a dip or spike), the final tail level (should have decayed below about -50 dB), loudness, and the
 * takes' misses/lateness. Look at the contact sheet: no chrome, one keyboard, the right name and rank.
 * Placeholder slots (see lib/show.mjs) are shown on the contact sheet and named, but have no take to check.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { loadShow, argv, loadMidi } from './lib/show.mjs';

const FF = process.env.FFMPEG || 'ffmpeg';
const S = loadShow(argv('show'));
const report = JSON.parse(fs.readFileSync(S.output.replace(/\.mp4$/, '.report.json'), 'utf8'));
const work = S.workDir;
fs.mkdirSync(work, { recursive: true });
const ff = (args, opts = {}) => spawnSync(FF, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args], { maxBuffer: 1 << 30, ...opts });

// Contact sheet: 3 columns of 640x360 thumbnails.
const at = report.timeline.map((t) => (t.filmFrom + t.filmTo) / 2);
if (report.intro) at.unshift(report.intro.secs * 0.7); // the intro, faded in
if (report.endCard) at.push(report.endCard.from + report.endCard.secs * 0.7); // the end card, faded in
const shots = at.map((t, i) => {
  const f = path.join(work, `qa-${i}.png`);
  ff(['-ss', t.toFixed(2), '-i', S.output, '-frames:v', '1', '-vf', 'scale=640:-2', f]);
  return f;
});
const cols = 3, rows = Math.ceil(shots.length / cols);
const layout = shots.map((_, i) => `${(i % cols) * 640}_${Math.floor(i / cols) * 360}`).join('|');
const contact = path.join(work, 'contact.png');
ff([...shots.flatMap((f) => ['-i', f]), '-filter_complex', `xstack=inputs=${shots.length}:layout=${layout}:fill=black,scale=${cols * 640}:${rows * 360}`, contact]);

// Audio checks.
const pcmBuf = ff(['-i', S.output, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-']).stdout;
const a = new Float32Array(pcmBuf.buffer, pcmBuf.byteOffset, pcmBuf.byteLength / 4);
const SR = 48000;
const db = (t0, t1) => { let s = 0, n = 0; for (let i = Math.max(0, Math.round(t0 * SR)); i < Math.min(a.length, Math.round(t1 * SR)); i++) { s += a[i] * a[i]; n++; } return n ? 10 * Math.log10(s / n + 1e-15) : -150; };
let onset = 0; while (onset < a.length && Math.abs(a[onset]) < 0.003) onset++;
const firstPlanned = report.timeline[0].filmFrom + (S.show.idle ?? 0.4); // filmFrom already includes any title card
console.log(`contact sheet: ${contact}`);
// --grabs <dir>: full-size frames of the cards (first frame, mid fade, faded in, last frame) and of
// the cut from the intro into the first model, named by what they show.
const grabsDir = argv('grabs');
if (grabsDir) {
  // Frames are picked by number (input -ss seeking can land on a neighbouring frame).
  fs.mkdirSync(grabsDir, { recursive: true });
  const fr = (t) => Math.round(t * 30);
  const total = Math.round(report.duration * 30);
  const shots = [];
  const card = (c, name) => {
    if (!c) return;
    const f0 = fr(c.from), f1 = Math.min(total, fr(c.from + c.secs)) - 1;
    const fadeEnds = Object.values(c.fades || {}).map(([st, d]) => st + d);
    const typeFade = Object.entries(c.fades || {}).filter(([k]) => k !== 'image').map(([, f]) => f);
    shots.push([`${name}-first-frame`, f0]);
    if (c.fades?.image) shots.push([`${name}-image-mid-fade`, f0 + fr(c.fades.image[0] + c.fades.image[1] / 2)]);
    if (typeFade.length) shots.push([`${name}-type-mid-fade`, f0 + fr((Math.min(...typeFade.map((f) => f[0])) + Math.max(...typeFade.map((f) => f[0] + f[1]))) / 2)]);
    shots.push([`${name}-faded-in`, Math.min(f1, f0 + fr(Math.max(...fadeEnds, 0) + 0.2))]);
    shots.push([`${name}-last-frame`, f1]);
  };
  card(report.intro, 'intro');
  if (report.intro) shots.push(['intro-cut-to-first-model', fr(report.intro.secs)], ['first-model-caption', fr(report.intro.secs + 1.5)]);
  card(report.endCard, 'end-card');
  if (report.endCard) shots.push(['before-end-card-last-music-frame', fr(report.endCard.from) - 1]);
  shots.sort((x, y) => x[1] - y[1]);
  const tmp = path.join(work, 'grabs');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  ff(['-i', S.output, '-vf', `select='${shots.map(([, n]) => `eq(n\\,${n})`).join('+')}'`, '-fps_mode', 'passthrough', path.join(tmp, 'g%02d.png')]);
  shots.forEach(([name, n], i) => {
    const f = path.join(grabsDir, `${name}.png`);
    fs.renameSync(path.join(tmp, `g${String(i + 1).padStart(2, '0')}.png`), f);
    console.log(`grab ${name.padEnd(34)} frame ${String(n).padStart(4)} (t=${(n / 30).toFixed(3)} s)  ${f}`);
  });
}

console.log(`duration ${report.duration.toFixed(2)} s, ${JSON.stringify(report.loudness)}, makeup ${report.makeupDb} dB`);
console.log(`first note at ${(onset / SR).toFixed(3)} s (planned ${firstPlanned.toFixed(3)} s)`);
for (const t of report.timeline.slice(1)) {
  const c = t.filmFrom;
  console.log(`cut @${c.toFixed(2).padStart(6)} to ${t.label.padEnd(24)} before ${db(c - 0.25, c - 0.05).toFixed(1)} dB | downbeat ${db(c + 0.01, c + 0.15).toFixed(1)} dB${t.placeholder ? '  (placeholder: silent)' : ''}`);
}
const end = report.musicEnd ?? a.length / SR; // the music's end (an end card follows in silence)
if (report.intro) console.log(`intro 0-${report.intro.secs.toFixed(2)} s: ${db(0, report.intro.secs).toFixed(1)} dB (silent by design)`);
console.log(`tail: last 0.5 s ${db(end - 0.5, end).toFixed(1)} dB, final 50 ms ${db(end - 0.05, end).toFixed(1)} dB${report.endCard ? `; end card ${report.endCard.from.toFixed(2)}-${(report.endCard.from + report.endCard.secs).toFixed(2)} s: ${db(report.endCard.from, report.endCard.from + report.endCard.secs).toFixed(1)} dB` : ''}`);
for (const t of report.timeline) {
  if (t.placeholder) { console.log(`  NEW  ${t.label.padEnd(24)} placeholder: ${t.placeholder}`); continue; }
  const lim = report.limiter.find((l) => l.model === t.model);
  console.log(`  ${(t.rank ? `#${t.rank}` : 'NEW').padEnd(4)} ${t.label.padEnd(24)} miss ${t.take.miss} late p95 ${t.take.schedLateMs.p95} ms, gain ${t.prep.gainDb} dB, limited ${lim.pctLimited}% (max ${lim.maxDb} dB)${t.take.quantizeVelocity ? `, velocity quantized to ${t.take.quantizeVelocity}` : ''}`);
}

// Note accounting: every MIDI note whose onset falls in a model's audible window must have been
// played by that model's take (its played span covers the window) or be a known out-of-range skip.
const midi = loadMidi(S.files.audio);
const onsets = midi.tracks.flatMap((t) => t.notes).map((n) => ({ t: n.time, note: n.midi, vel: n.velocity }));
const XF = 0.03;
let totalExpected = 0, totalSkipped = 0, problems = 0;
console.log('\nnotes per turn (audible window = from the switch before its downbeat to the next switch):');
S.plan.segments.forEach((s, k) => {
  if (S.model(s.model).placeholder) { console.log(`  ${S.model(s.model).label.padEnd(24)} placeholder (not recorded)`); return; }
  const meta = JSON.parse(fs.readFileSync(path.join(S.takeDir(s.model), 'meta.json'), 'utf8'));
  // The first turn starts cold on its downbeat; the last ends where the plan stops playing (a
  // cadence with lastBarBeats), not at the end of the closing breath.
  const from = k === 0 ? meta.playStart : s.audioFrom - XF, to = Math.min(s.audioTo, s.playBefore ?? Infinity);
  const inWin = onsets.filter((n) => n.t >= from - 1e-6 && n.t < to);
  const covered = inWin.filter((n) => n.t >= meta.playStart - 1e-6 && n.t < (meta.segment.playBefore ?? Infinity));
  const skipped = new Set(meta.missed.map((x) => x.split('@')).filter(([, t]) => { const mt = meta.playStart + Number(t); return mt >= from - 1e-3 && mt < to; }).map(([n, t]) => `${n}@${(meta.playStart + Number(t)).toFixed(2)}`));
  const missedMore = meta.miss > meta.missed.length ? ' (+ more misses not listed)' : '';
  totalExpected += inWin.length; totalSkipped += skipped.size;
  if (covered.length !== inWin.length) problems++;
  console.log(`  ${S.model(s.model).label.padEnd(24)} expected ${String(inWin.length).padStart(4)}  played-span covers ${String(covered.length).padStart(4)}  skipped (out of keybed range) ${skipped.size}${skipped.size ? ' ' + [...skipped].join(' ') : ''}${missedMore}`);
});
console.log(`  total ${totalExpected} notes, ${totalSkipped} skipped out of range, ${problems ? problems + ' turns with UNCOVERED notes' : 'every note covered'}`);

// Sync: prep.mjs aligns each take on its first note, so sync holds if the model's output latency is
// steady through a take. Check that with scripts/latency.mjs (spread should be <~20 ms). Onset
// cross-correlation on the mix is not reliable here: pedal, reverb and ~150 ms eighth notes alias.
console.log('\nsync: run scripts/latency.mjs --show ... to confirm each model\'s latency is steady (spread < ~20 ms).');
