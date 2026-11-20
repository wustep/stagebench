/**
 * Builds the pipeline's two MIDI files from rondo-alla-turca-dynamics.mid (see dynamics.mjs):
 *
 *   alla-turca-keybed.mid   audio: the sustain pedal (CC64) baked into note lengths, CC removed,
 *                           because the previews' keybeds have no pedal input
 *   alla-turca.mid          picture: written note lengths, CC removed
 *
 *   node make-song.mjs      (paths are relative to this file)
 *
 * Both keep every onset, pitch and velocity, plus the tempo map; record.mjs checks that they agree.
 * A key can't sound twice at once, so a note ends just before the same key is struck again.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import midiPkg from '@tonejs/midi';

const { Midi } = midiPkg;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, 'rondo-alla-turca-dynamics.mid');
const BAR = 512; // 2/4 at 256 ppq

function build(file, { bakePedal, gap }) {
  const midi = new Midi(fs.readFileSync(SRC));
  if (midi.header.ppq !== 256) throw new Error(`expected 256 ppq, got ${midi.header.ppq}`);
  for (const track of midi.tracks) {
    if (bakePedal) {
      // Pedal state changes in time order: down at value >= 64.
      const ped = (track.controlChanges[64] || []).map((c) => ({ t: c.ticks, down: c.value >= 0.5 })).sort((a, b) => a.t - b.t);
      const downAt = (t) => { let d = false; for (const p of ped) { if (p.t > t) break; d = p.down; } return d; };
      const upAfter = (t) => ped.find((p) => p.t > t && !p.down)?.t;
      for (const n of track.notes) {
        const end = n.ticks + n.durationTicks;
        if (!downAt(end)) continue;
        const up = upAfter(end) ?? end;
        n.durationTicks = Math.max(n.durationTicks, Math.min(up, end + 2 * BAR) - n.ticks);
      }
    }
    // Release before the same key is struck again.
    const byKey = new Map();
    for (const n of track.notes) { if (!byKey.has(n.midi)) byKey.set(n.midi, []); byKey.get(n.midi).push(n); }
    for (const list of byKey.values()) {
      list.sort((a, b) => a.ticks - b.ticks);
      for (let i = 0; i + 1 < list.length; i++) {
        const limit = list[i + 1].ticks - gap;
        if (list[i].ticks + list[i].durationTicks > limit) list[i].durationTicks = Math.max(4, limit - list[i].ticks);
      }
    }
    for (const n of track.notes) n.velocity = (Math.round(n.velocity * 127) + 0.5) / 127; // encodes back to the same integer
    track.controlChanges = {};
  }
  fs.writeFileSync(path.join(HERE, file), Buffer.from(midi.toArray()));
  return midi;
}

build('alla-turca-keybed.mid', { bakePedal: true, gap: 6 });
build('alla-turca.mid', { bakePedal: false, gap: 16 });

// Check: same onsets, pitches and velocities as the dynamics file, no same-key overlaps.
const sig = (m) => m.tracks.flatMap((t) => t.notes.map((n) => `${n.ticks}:${n.midi}:${Math.round(n.velocity * 127)}`)).sort().join(',');
const src = new Midi(fs.readFileSync(SRC));
for (const f of ['alla-turca-keybed.mid', 'alla-turca.mid']) {
  const m = new Midi(fs.readFileSync(path.join(HERE, f)));
  if (sig(m) !== sig(src)) throw new Error(`${f}: onsets/pitches/velocities differ from the dynamics file`);
  const notes = m.tracks.flatMap((t) => t.notes);
  let overlaps = 0;
  for (const a of notes) for (const b of notes) if (a !== b && a.midi === b.midi && b.ticks > a.ticks && b.ticks < a.ticks + a.durationTicks) overlaps++;
  if (overlaps) throw new Error(`${f}: ${overlaps} same-key overlaps`);
  const held = notes.reduce((s, n) => s + n.duration, 0) / notes.length;
  console.log(`wrote ${f}: ${notes.length} notes, ${m.duration.toFixed(2)} s, mean sounding length ${(held * 1000).toFixed(0)} ms`);
}
