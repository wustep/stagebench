/**
 * Dynamics pass for Mozart, Rondo Alla Turca (Piano Sonata K. 331, iii), on Stephen's MIDI.
 *
 *   node dynamics.mjs "<original .mid>" ["<copy to write>"]
 *
 * Reads the original (never writes it), changes ONLY note-on velocity bytes, and writes the result
 * to rondo-alla-turca-dynamics.mid next to this file (and to the optional copy path). Every other
 * byte (onsets, pitches, durations, tempo map, sustain pedal, meta events) is identical, which the
 * script verifies before it writes. Deterministic: no randomness. It refuses to write the copy path
 * if that path is the input, or if the file there currently holds the original's bytes.
 *
 * Bars are counted through the performance with the repeats played (223 bars of 2/4). Bar 1
 * starts after the one-beat pickup (tick 256 at 256 ppq); the file's 1/4 time signatures are the
 * half bars where a section's end meets the next pickup, so downbeats stay on 256 + 512k.
 *
 * Second pass (stronger than the first, which only nudged the original's levels by a few steps).
 * Each note is rebuilt as
 *
 *     velocity = section level (a hairpin through the phrase)
 *              + voice offset (melody / doubled inner voice / accompaniment)
 *              + 0.6 x the performer's own deviation from that voice's mean in the bar
 *              + accents
 *
 *  - section level: the melody's target velocity, interpolated beat by beat between keyframes,
 *    so p and f sit far apart (A-minor theme ~52-64, march ~96-114) and phrases swell and relax
 *    (hairpins), not terraces. The C-major episode answers forte then piano; the theme return
 *    crescendos into its cadence; the F-sharp-minor 16ths crescendo through each phrase; the coda
 *    keeps its piano subito (205-211) and only its last chords reach full force;
 *  - voicing: the melody (top of its attack, or a lone note, at G4 or above) sings; a doubled
 *    inner voice under it is 8 lower; the accompaniment (everything else) is 16 lower;
 *  - accents: march downbeats +10, and their rolled grace-note chords -10 (lighter than the beat
 *    they lead into); theme cadences lean on their downbeat (+6 melody); episode downbeats +4;
 *  - limits: a floor of 30 (some keybeds barely sound below that) and a soft knee above 118, so
 *    only the final chords reach 127.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIGINAL_SHA256 = 'f6c05618b57725e6f245ad13c894b12b2ff40b84524df15514d0c004291a4d6f';
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const [inPath, copyPath] = process.argv.slice(2);
if (!inPath) { console.error('usage: node dynamics.mjs "<original .mid>" ["<copy to write>"]'); process.exit(1); }
const src = fs.readFileSync(inPath);
const sha = sha256(src);
if (sha !== ORIGINAL_SHA256) console.warn(`warning: input sha256 ${sha} is not the original this pass was written for`);
if (copyPath) {
  if (path.resolve(copyPath) === path.resolve(inPath)) throw new Error('refusing to overwrite the original');
  if (fs.existsSync(copyPath) && sha256(fs.readFileSync(copyPath)) === ORIGINAL_SHA256) throw new Error(`refusing to write ${copyPath}: it currently holds the original's bytes`);
}

// --- Raw parse: every note-on with its velocity byte offset -----------------------------------------
function parse(buf) {
  if (buf.toString('latin1', 0, 4) !== 'MThd') throw new Error('not a MIDI file');
  const ppq = buf.readUInt16BE(12);
  const ons = [];
  let p = 8 + buf.readUInt32BE(4);
  while (p < buf.length) {
    const id = buf.toString('latin1', p, p + 4), len = buf.readUInt32BE(p + 4);
    let q = p + 8;
    const end = q + len;
    if (id === 'MTrk') {
      let tick = 0, status = 0;
      const vlq = () => { let v = 0, b; do { b = buf[q++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
      while (q < end) {
        tick += vlq();
        let b = buf[q];
        if (b & 0x80) { status = b; q++; } // else running status
        if (status === 0xff) { q++; const l = vlq(); q += l; status = 0; continue; }
        if (status === 0xf0 || status === 0xf7) { const l = vlq(); q += l; status = 0; continue; }
        const type = status & 0xf0;
        if (type === 0xc0 || type === 0xd0) { q += 1; continue; }
        const d1 = buf[q], d2 = buf[q + 1];
        if (type === 0x90 && d2 > 0) ons.push({ tick, pitch: d1, vel: d2, at: q + 1 });
        q += 2;
      }
    }
    p = end;
  }
  return { ppq, ons };
}
const { ppq, ons } = parse(src);
if (ppq !== 256) throw new Error(`expected 256 ppq, got ${ppq}`);
const PICK = 256, BAR = 512, BEAT = 256;
const barOf = (t) => (t < PICK ? 0 : Math.floor((t - PICK) / BAR) + 1);
const LAST_BAR = barOf(Math.max(...ons.map((n) => n.tick)));

// --- Form (performance bars, repeats played) and each section's hairpin -----------------------------
// Keyframes are [fraction of the section, melody velocity]; the level is interpolated per tick.
const FORM = [
  [0, 16, 'theme'], // pickup + A-minor theme, twice
  [17, 20, 'episodeF'], [21, 24, 'episodeP'], [25, 32, 'themeReturn'],
  [33, 36, 'episodeF'], [37, 40, 'episodeP'], [41, 48, 'themeReturn'],
  [49, 64, 'march'],
  [65, 80, 'minorRun'],
  [81, 88, 'majorForte'], [89, 96, 'minorRunCresc'], [97, 104, 'majorForte'], [105, 112, 'minorRunCresc'],
  [113, 128, 'march'],
  [129, 144, 'theme'],
  [145, 148, 'episodeF'], [149, 152, 'episodeP'], [153, 160, 'themeReturn'],
  [161, 164, 'episodeF'], [165, 168, 'episodeP'], [169, 176, 'themeReturn'],
  [177, 192, 'march'],
  [193, 204, 'coda'], [205, 211, 'codaPiano'], [212, LAST_BAR, 'codaFinal'],
];
const SHAPE = {
  // two 8-bar phrases, each swelling and relaxing (< >)
  theme: [[0, 52], [0.28, 64], [0.5, 54], [0.78, 66], [1, 54]],
  episodeF: [[0, 96], [1, 102]],
  episodeP: [[0, 58], [1, 48]], // piano subito, then a diminuendo
  themeReturn: [[0, 52], [0.45, 66], [0.8, 86], [1, 90]], // crescendo into a firm cadence
  march: [[0, 96], [0.3, 106], [0.5, 100], [0.85, 112], [1, 114]],
  minorRun: [[0, 56], [0.38, 90], [0.5, 62], [0.88, 96], [1, 86]],
  majorForte: [[0, 100], [1, 104]],
  minorRunCresc: [[0, 64], [1, 100]],
  coda: [[0, 104], [1, 112]],
  codaPiano: [[0, 54], [1, 62]],
  codaFinal: [[0, 68], [0.75, 112], [0.92, 120], [1, 127]],
};
const sectionAt = (bar) => FORM.find(([a, b]) => bar >= a && bar <= b);
// A section's last bar is a half bar plus the next section's pickup: its second beat belongs to
// what follows (at the very start of that section's hairpin).
function roleAt(tick) {
  const bar = barOf(tick), s = sectionAt(bar);
  const beat2 = tick - PICK - (bar - 1) * BAR >= BEAT;
  if (bar === s[1] && beat2 && bar < LAST_BAR) { const next = sectionAt(bar + 1); return { role: next[2], pickup: true, bar, s: next }; }
  return { role: s[2], pickup: false, bar, s };
}
function level(tick) {
  const { role, pickup, s } = roleAt(tick);
  const start = PICK + (Math.max(1, s[0]) - 1) * BAR, span = (s[1] - Math.max(1, s[0]) + 1) * BAR;
  const f = pickup ? 0 : Math.max(0, Math.min(1, (tick - start) / span));
  const k = SHAPE[role];
  for (let i = 1; i < k.length; i++) if (f <= k[i][0]) return k[i - 1][1] + ((k[i][1] - k[i - 1][1]) * (f - k[i - 1][0])) / (k[i][0] - k[i - 1][0]);
  return k.at(-1)[1];
}

// --- Voices: attacks are notes starting within 12 ticks ------------------------------------------
const MELODY_FLOOR = 67; // G4: the theme's accompaniment chords reach E4, the melody stays above
const sorted = [...ons].sort((a, b) => a.tick - b.tick || b.pitch - a.pitch);
const clusters = [];
for (const n of sorted) {
  const c = clusters.at(-1);
  if (c && n.tick - c[0].tick <= 12) c.push(n); else clusters.push([n]);
}
for (const c of clusters) {
  const top = Math.max(...c.map((n) => n.pitch));
  for (const n of c) n.voice = n.pitch === top && n.pitch >= MELODY_FLOOR ? 'mel' : n.pitch >= MELODY_FLOOR && top - n.pitch <= 12 ? 'double' : 'acc';
}
const VOICE = { mel: 0, double: -8, acc: -16 };
// The performer's micro-shaping: each note's deviation from its voice's mean in the bar.
const barMean = new Map();
for (const n of ons) { const k = `${barOf(n.tick)}:${n.voice}`; const m = barMean.get(k) || [0, 0]; m[0] += n.vel; m[1]++; barMean.set(k, m); }
const MICRO = 0.6;

// --- Apply ----------------------------------------------------------------------------------------
for (const n of ons) {
  const { role, pickup, bar, s } = roleAt(n.tick);
  const inBar = (n.tick - PICK) % BAR;
  const [sum, cnt] = barMean.get(`${bar}:${n.voice}`);
  let v = level(n.tick) + VOICE[n.voice] + MICRO * (n.vel - sum / cnt);
  if (role === 'march') {
    if (inBar < 12) v += 10; // the downbeat
    else if (inBar >= 430) v -= 10; // rolled grace-note chord leading into it
  }
  if ((role === 'theme' || role === 'themeReturn') && !pickup && inBar < 12 && n.voice === 'mel' && (bar - Math.max(1, s[0])) % 8 === 7) v += 6; // cadence
  if (role === 'episodeF' && !pickup && inBar < 12) v += 4;
  const finalChords = bar >= LAST_BAR - 1;
  if (v > 118 && !finalChords) v = 118 + (v - 118) * 0.4; // soft knee: only the last chords reach 127
  n.out = Math.max(30, Math.min(127, Math.round(v)));
}

const out = Buffer.from(src);
for (const n of ons) out[n.at] = n.out;
// Only velocity bytes may differ.
const allowed = new Set(ons.map((n) => n.at));
for (let i = 0; i < src.length; i++) if (src[i] !== out[i] && !allowed.has(i)) throw new Error(`byte ${i} changed outside a velocity`);
if (out.length !== src.length) throw new Error('length changed');

const repoCopy = path.join(HERE, 'rondo-alla-turca-dynamics.mid');
fs.writeFileSync(repoCopy, out);
if (copyPath) fs.writeFileSync(copyPath, out);
if (sha256(fs.readFileSync(inPath)) !== sha) throw new Error('the input changed while this ran');

// --- Before / after ---------------------------------------------------------------------------------
const pct = (s, p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
const stats = (vs) => {
  const s = [...vs].sort((a, b) => a - b);
  return { n: s.length, min: s[0], max: s.at(-1), mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(1), p10: pct(s, 0.1), p50: pct(s, 0.5), p90: pct(s, 0.9), at127: s.filter((v) => v === 127).length };
};
const row = (label, ns) => {
  const b = stats(ns.map((n) => n.vel)), a = stats(ns.map((n) => n.out));
  const f = (x) => `${String(x.min).padStart(3)} ${String(x.max).padStart(3)} ${x.mean.toFixed(1).padStart(5)} ${String(x.p10).padStart(3)} ${String(x.p50).padStart(3)} ${String(x.p90).padStart(3)} ${String(x.at127).padStart(3)}`;
  console.log(`  ${label.padEnd(26)} ${String(b.n).padStart(4)}   ${f(b)}   ->   ${f(a)}`);
};
console.log(`${ons.length} notes. velocity                  n   min max  mean p10 p50 p90 127        min max  mean p10 p50 p90 127`);
console.log('                                        before                                  after');
row('whole piece', ons);
row('film (129-192)', ons.filter((n) => { const b = barOf(n.tick); return b >= 129 && b <= 192; }));
for (const v of ['mel', 'double', 'acc']) row(`  voice ${v}`, ons.filter((n) => n.voice === v));
console.log('  sections:');
for (const [a, b, role] of FORM) row(`${String(a).padStart(3)}-${String(b).padEnd(3)} ${role}`, ons.filter((n) => { const bar = barOf(n.tick); return bar >= a && bar <= b; }));
// The film's stretch, melody only, mean per bar: the hairpins and the p/f terraces at a glance.
const melBar = (key) => Array.from({ length: 64 }, (_, i) => { const ns = ons.filter((n) => n.voice === 'mel' && barOf(n.tick) === 129 + i); return ns.length ? Math.round(ns.reduce((s, n) => s + n[key], 0) / ns.length) : '-'; });
for (const [label, key] of [['before', 'vel'], ['after', 'out']]) {
  const m = melBar(key);
  console.log(`  melody per bar ${label.padEnd(6)} 129-192: ${Array.from({ length: 8 }, (_, k) => m.slice(8 * k, 8 * k + 8).join(' ')).join(' | ')}`);
}
console.log(`wrote ${path.relative(process.cwd(), repoCopy)}${copyPath ? ` and ${copyPath}` : ''}`);
