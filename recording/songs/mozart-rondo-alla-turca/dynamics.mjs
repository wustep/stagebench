/**
 * Dynamics pass for Mozart, Rondo Alla Turca (Piano Sonata K. 331, iii), on Stephen's MIDI.
 *
 *   node dynamics.mjs "<original .mid>" ["<copy to write>"]
 *
 * Reads the original (never writes it), changes ONLY note-on velocity bytes, and writes the result
 * to rondo-alla-turca-dynamics.mid next to this file (and to the optional copy path). Every other
 * byte (onsets, pitches, durations, tempo map, sustain pedal, meta events) is identical, which the
 * script verifies before it writes. Deterministic: no randomness.
 *
 * Bars are counted through the performance with the repeats played (223 bars of 2/4). Bar 1
 * starts after the one-beat pickup (tick 256 at 256 ppq); the file's 1/4 time signatures are the
 * half bars where a section's end meets the next pickup, so downbeats stay on 256 + 512k.
 *
 * The original velocities are the starting point: each note keeps its own value and the
 * performer's micro-shaping, plus a structural offset:
 *  - form: the A-minor theme stays piano; the C-major episode answers forte then piano; the
 *    janissary march and the A-major forte sections sit forte; the F-sharp-minor 16ths swell
 *    through each 8-bar phrase; the coda gets headroom and a deeper piano subito (bars 205-211),
 *    so only its last chords reach full force;
 *  - voicing: in each attack (notes starting within 12 ticks), the top note is the melody and
 *    sings over the rest;
 *  - accents: march downbeats are marked and their rolled grace-note chords are lighter than the
 *    beat they lead into; theme cadences lean on the downbeat;
 *  - limits: a soft knee above 112 (the original pins long stretches of the coda at 127) and a
 *    gentle lift for the very softest notes (below 42, halfway toward 42), which some keybeds
 *    barely sound.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIGINAL_SHA256 = 'f6c05618b57725e6f245ad13c894b12b2ff40b84524df15514d0c004291a4d6f';
const [inPath, copyPath] = process.argv.slice(2);
if (!inPath) { console.error('usage: node dynamics.mjs "<original .mid>" ["<copy to write>"]'); process.exit(1); }
const src = fs.readFileSync(inPath);
const sha = crypto.createHash('sha256').update(src).digest('hex');
if (sha !== ORIGINAL_SHA256) console.warn(`warning: input sha256 ${sha} is not the original this pass was written for`);
if (copyPath && path.resolve(copyPath) === path.resolve(inPath)) throw new Error('refusing to overwrite the original');

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

// --- Form (performance bars, repeats played) ------------------------------------------------------
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
const sectionAt = (bar) => FORM.find(([a, b]) => bar >= a && bar <= b);
// A section's last bar is a half bar plus the next section's pickup: its second beat belongs to
// what follows.
function roleAt(tick) {
  const bar = barOf(tick), s = sectionAt(bar);
  const beat2 = tick - PICK - (bar - 1) * BAR >= BEAT;
  if (bar === s[1] && beat2 && bar < LAST_BAR) { const next = sectionAt(bar + 1); return { role: next[2], pickup: true, bar, s: next }; }
  return { role: s[2], pickup: false, bar, s };
}

const hairpin = [0, 2, 4, 6, 6, 4, 2, 0]; // across an 8-bar phrase
function formOffset(tick) {
  const { role, pickup, bar, s } = roleAt(tick);
  const inPhrase = pickup ? 0 : (bar - s[0]) % 8; // 0..7
  switch (role) {
    case 'theme': return -3;
    case 'episodeF': return 4;
    case 'episodeP': return -5;
    case 'themeReturn': return inPhrase < 4 ? -3 : 2; // piano start, firm cadence
    case 'march': return 1 + hairpin[inPhrase] / 2;
    case 'minorRun': return -3 + hairpin[inPhrase];
    case 'majorForte': return 2;
    case 'minorRunCresc': return 0; // the original already crescendos through these
    case 'coda': return -4;
    case 'codaPiano': return -8;
    case 'codaFinal': { const left = LAST_BAR - bar; return left <= 1 ? 0 : left <= 3 ? -2 : -4; }
    default: return 0;
  }
}

// --- Apply ----------------------------------------------------------------------------------------
const sorted = [...ons].sort((a, b) => a.tick - b.tick || b.pitch - a.pitch);
const clusters = [];
for (const n of sorted) {
  const c = clusters.at(-1);
  if (c && n.tick - c[0].tick <= 12) c.push(n); else clusters.push([n]);
}
for (const c of clusters) {
  const top = Math.max(...c.map((n) => n.pitch));
  for (const n of c) {
    const { role } = roleAt(n.tick);
    const inBar = (n.tick - PICK) % BAR;
    let v = n.vel + formOffset(n.tick);
    if (c.length > 1) v += n.pitch === top ? 3 : -3; // melody over accompaniment
    if (role === 'march') {
      if (inBar < 12) v += 5; // the downbeat
      else if (inBar >= 430) v -= 4; // rolled grace-note chord leading into it
    }
    if ((role === 'theme' || role === 'themeReturn') && inBar < 12 && n.pitch === top) v += 2;
    const finalChords = barOf(n.tick) >= LAST_BAR - 1;
    if (v > 112 && !finalChords) v = 112 + (v - 112) * 0.6; // soft knee: no saturated stretches
    if (v < 42) v = 42 - (42 - v) * 0.5; // lift the faintest notes a little
    n.out = Math.max(1, Math.min(127, Math.round(v)));
  }
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

// --- Before / after ---------------------------------------------------------------------------------
const stats = (vs) => ({ min: Math.min(...vs), max: Math.max(...vs), mean: +(vs.reduce((a, b) => a + b, 0) / vs.length).toFixed(1), at127: vs.filter((v) => v === 127).length });
const before = stats(ons.map((n) => n.vel)), after = stats(ons.map((n) => n.out));
console.log(`${ons.length} notes. velocity before: min ${before.min} max ${before.max} mean ${before.mean} (${before.at127} at 127)`);
console.log(`${' '.repeat(String(ons.length).length + 7)}after:  min ${after.min} max ${after.max} mean ${after.mean} (${after.at127} at 127)`);
const bins = [[1, 39], [40, 49], [50, 59], [60, 69], [70, 79], [80, 89], [90, 99], [100, 109], [110, 119], [120, 127]];
console.log('histogram     ' + bins.map(([a, b]) => `${a}-${b}`.padStart(8)).join(''));
for (const [label, key] of [['before', 'vel'], ['after', 'out']]) console.log(`${label.padEnd(14)}${bins.map(([a, b]) => String(ons.filter((n) => n[key] >= a && n[key] <= b).length).padStart(8)).join('')}`);
console.log('section means (bars: before -> after)');
for (const [a, b, role] of FORM) {
  const ns = ons.filter((n) => { const bar = barOf(n.tick); return bar >= a && bar <= b; });
  const m = (k) => (ns.reduce((s, n) => s + n[k], 0) / ns.length).toFixed(0);
  console.log(`  ${String(a).padStart(3)}-${String(b).padEnd(3)} ${role.padEnd(14)} ${m('vel').padStart(3)} -> ${m('out')}`);
}
console.log(`wrote ${path.relative(process.cwd(), repoCopy)}${copyPath ? ` and ${copyPath}` : ''}`);
