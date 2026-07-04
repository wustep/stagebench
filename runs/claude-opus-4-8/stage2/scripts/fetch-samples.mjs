/**
 * Reproducible sample fetcher for the Phase 2 recorded piano sample sets.
 *
 * Source: gleitz/midi-js-soundfonts (pre-rendered FluidR3_GM soundfont).
 *   Repo:    https://github.com/gleitz/midi-js-soundfonts
 *   Files:   https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/<instrument>-mp3/<Note>.mp3
 *   License: Creative Commons Attribution 3.0 (CC-BY 3.0). The underlying
 *            FluidR3_GM SoundFont by Frank Wen is CC-BY 3.0. Attribution is
 *            recorded in IMPLEMENTATION_DETAILS.json and public/samples/LICENSE.txt.
 *
 * These are RECORDED, multi-sampled acoustic/electric instruments (one mono/stereo
 * mp3 per root note), NOT synthesis. We fetch a subset of root notes spaced a minor
 * third apart so that at playback no note is pitch-shifted more than ~1 semitone.
 *
 * Output: public/samples/<setId>/<Note>.mp3 plus a manifest.json per set and a
 * top-level index.json. The committed app runs fully offline from these files;
 * this script only needs to be re-run to regenerate them.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = join(HERE, '..', 'public', 'samples');
const BASE = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM';

/** Recorded sample sets bundled for Grand / Upright / Electric piano types. */
const SETS = [
  {
    id: 'grand',
    label: 'Acoustic Grand',
    instrument: 'acoustic_grand_piano',
    source: 'FluidR3_GM acoustic_grand_piano',
  },
  {
    id: 'upright',
    label: 'Upright (Honky-Tonk)',
    instrument: 'honkytonk_piano',
    source: 'FluidR3_GM honkytonk_piano',
  },
  {
    id: 'electric',
    label: 'Electric (Rhodes-style tine)',
    instrument: 'electric_piano_1',
    source: 'FluidR3_GM electric_piano_1',
  },
];

// midi-js note-name spelling uses sharps as flats (Db not C#). Map midi -> name.
const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
function midiToName(midi) {
  const name = NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

// Root notes: every 3 semitones from A0(21) to C8(108). Covers the full 73-key
// variant range (E1..E7 => midi 28..100) with generous margin, ~1 semitone max shift.
const ROOTS = [];
for (let m = 21; m <= 108; m += 3) ROOTS.push(m);

async function fetchArrayBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  await mkdir(OUT_ROOT, { recursive: true });
  const index = [];

  for (const set of SETS) {
    const dir = join(OUT_ROOT, set.id);
    await mkdir(dir, { recursive: true });
    const notes = [];
    for (const midi of ROOTS) {
      const name = midiToName(midi);
      const url = `${BASE}/${set.instrument}-mp3/${name}.mp3`;
      const dest = join(dir, `${name}.mp3`);
      if (existsSync(dest) && !process.env.FORCE) {
        notes.push({ note: name, midi, file: `${name}.mp3` });
        continue;
      }
      try {
        const buf = await fetchArrayBuffer(url);
        await writeFile(dest, buf);
        notes.push({ note: name, midi, file: `${name}.mp3`, bytes: buf.length });
        process.stdout.write(`  ${set.id} ${name} (${buf.length}b)\n`);
      } catch (err) {
        process.stderr.write(`  FAILED ${set.id} ${name}: ${err.message}\n`);
      }
    }
    const manifest = {
      id: set.id,
      label: set.label,
      source: set.source,
      soundfont: 'FluidR3_GM',
      author: 'Frank Wen (FluidR3_GM SoundFont); packaged by gleitz/midi-js-soundfonts',
      license: 'CC-BY-3.0',
      attribution:
        'FluidR3_GM SoundFont by Frank Wen, CC-BY 3.0; pre-rendered by gleitz/midi-js-soundfonts (MIT project code).',
      format: 'mp3',
      rootNotes: notes,
    };
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    index.push({ id: set.id, label: set.label, manifest: `${set.id}/manifest.json`, count: notes.length });
    process.stdout.write(`${set.id}: ${notes.length} root notes\n`);
  }

  await writeFile(join(OUT_ROOT, 'index.json'), JSON.stringify({ sets: index }, null, 2));

  const license = [
    'Recorded piano sample sets bundled under public/samples/.',
    '',
    'Source project: gleitz/midi-js-soundfonts (https://github.com/gleitz/midi-js-soundfonts)',
    'SoundFont: FluidR3_GM by Frank Wen.',
    'License: Creative Commons Attribution 3.0 (CC-BY 3.0)',
    '  https://creativecommons.org/licenses/by/3.0/',
    '',
    'Bundled instruments:',
    '  grand/    <- FluidR3_GM acoustic_grand_piano (recorded acoustic grand)',
    '  upright/  <- FluidR3_GM honkytonk_piano (recorded upright/tack piano)',
    '  electric/ <- FluidR3_GM electric_piano_1 (recorded Rhodes-style tine EP)',
    '',
    'Each folder holds one mp3 per recorded root note (every 3 semitones) plus a',
    'manifest.json listing every file, its root note, and provenance. Attribution:',
    'FluidR3_GM SoundFont by Frank Wen, CC-BY 3.0; pre-rendered by gleitz/midi-js-soundfonts.',
    '',
  ].join('\n');
  await writeFile(join(OUT_ROOT, 'LICENSE.txt'), license);
  process.stdout.write('Wrote index.json and LICENSE.txt\n');
}

main().catch((err) => {
  process.stderr.write(String(err?.stack ?? err) + '\n');
  process.exit(1);
});
