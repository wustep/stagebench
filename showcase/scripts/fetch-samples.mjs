#!/usr/bin/env node
/**
 * Downloads the three fetched (non-npm) recorded Piano sample sets from
 * pinned GitHub commits, trims/encodes them to MP3 with the ffmpeg-static
 * binary, and writes public/samples/fetched.json describing them.
 * sync-samples.mjs merges that file into public/samples/manifest.json.
 *
 * Sources (see public/samples/SOURCES.md and IMPLEMENTATION_DETAILS.json):
 * - Upright:  VCSL "Upright Piano, Yamaha" sustains (VS Upright No. 1 —
 *             Versilian Studios Community Sample Library, CC0), 13 roots
 *             (C/G per octave) x 3 recorded velocity layers.
 * - Electric: jRhodes3d (Jeff Learman's 1977 Rhodes Mark I Stage 73,
 *             CC-BY-NC-4.0), 15 roots x 3 of the 5 recorded velocity layers.
 * - Clav #2:  VCSL "Harpsichord, French" sustains (CC0), 28 roots x 1 layer
 *             (real harpsichords are not velocity sensitive).
 *
 * Pitch conventions verified by autocorrelation against the recordings:
 * - jRhodes filenames encode the sounding MIDI note directly (A_062__D4
 *   sounds at D4 = MIDI 62).
 * - VCSL filenames are written one octave LOW (their "C4" sounds at C5), so
 *   rootMidi = standard(name) + 12.
 *
 * Run manually: node scripts/fetch-samples.mjs
 * The encoded MP3s and fetched.json are committed; this script only needs to
 * be re-run to change the selection or encoding.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpegPath from 'ffmpeg-static'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'samples')

const VCSL_SHA = 'c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e'
const JRHODES_SHA = '6b9fbd0dbbdafbf4e46e891ba22154d11131ee9d'
const VCSL_BASE = `https://raw.githubusercontent.com/sgossner/VCSL/${VCSL_SHA}`
const JRHODES_BASE = `https://raw.githubusercontent.com/sfzinstruments/jlearman.jRhodes3d/${JRHODES_SHA}`

const NOTE_TO_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** "C4" | "D#4" -> standard midi (C4 = 60). */
function nameToMidi(name) {
  const match = /^([A-G])([#b]?)(-?\d)$/.exec(name)
  if (!match) throw new Error(`Bad note name: ${name}`)
  const [, letter, accidental, octave] = match
  let semitone = NOTE_TO_SEMITONE[letter]
  if (accidental === '#') semitone += 1
  if (accidental === 'b') semitone -= 1
  return (Number(octave) + 1) * 12 + semitone
}

/** midi -> flat-safe file stem like "c4", "ds4" (matches sync-samples.mjs). */
function midiToStem(midi) {
  const names = ['c', 'cs', 'd', 'ds', 'e', 'f', 'fs', 'g', 'gs', 'a', 'as', 'b']
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`
}

/* ------------------------------------------------------ file selections -- */

/** VCSL Upright Piano, Yamaha — C/G roots, 3 velocity layers, rr1.
 *  C6 has no vl1 recording; its slot reuses the vl2 take (declared). */
const UPRIGHT_NOTES = ['C0', 'G0', 'C1', 'G1', 'C2', 'G2', 'C3', 'G3', 'C4', 'G4', 'C5', 'G5', 'C6']
const uprightFiles = []
for (const note of UPRIGHT_NOTES) {
  for (const layer of [1, 2, 3]) {
    const sourceLayer = note === 'C6' && layer === 1 ? 2 : layer
    const sourceFile = `Chordophones/Zithers/Upright Piano, Yamaha/Sustains/Upright1_Sus_${note}_vl${sourceLayer}_rr1.wav`
    uprightFiles.push({
      url: `${VCSL_BASE}/${sourceFile.split('/').map(encodeURIComponent).join('/')}`,
      sourceFile: `VCSL@${VCSL_SHA.slice(0, 7)}/${sourceFile}`,
      rootMidi: nameToMidi(note) + 12, // VCSL names sound one octave above the label
      velocityLayer: layer,
      seconds: 8,
      mono: false,
    })
  }
}

/** jRhodes3d mono — every recorded root; 3 layers spread over the available
 *  recorded layers (some roots have 4 or 5 takes, high roots only 3). */
const RHODES_ROOTS = [
  [29, 'F1', [1, 3, 5]],
  [35, 'B1', [1, 3, 5]],
  [40, 'E2', [1, 3, 5]],
  [45, 'A2', [1, 3, 5]],
  [50, 'D3', [1, 3, 5]],
  [55, 'G3', [1, 3, 5]],
  [59, 'B3', [1, 3, 5]],
  [62, 'D4', [1, 3, 5]],
  [65, 'F4', [1, 3, 5]],
  [71, 'B4', [1, 2, 5]],
  [76, 'E5', [1, 2, 5]],
  [81, 'A5', [2, 4, 5]],
  [86, 'D6', [2, 4, 5]],
  [91, 'G6', [2, 4, 5]],
  [96, 'C7', [2, 4, 5]],
]
const rhodesFiles = []
for (const [midi, note, takes] of RHODES_ROOTS) {
  takes.forEach((take, index) => {
    const sourceFile = `jRhodes3d-mono/A_${String(midi).padStart(3, '0')}__${note}_${take}.flac`
    rhodesFiles.push({
      url: `${JRHODES_BASE}/${sourceFile}`,
      sourceFile: `jlearman.jRhodes3d@${JRHODES_SHA.slice(0, 7)}/${sourceFile}`,
      rootMidi: midi,
      velocityLayer: index + 1,
      seconds: 10,
      mono: true,
    })
  })
}

/** VCSL Harpsichord, French — every recorded root, single layer, rr1. */
const HARPSI_NOTES = [
  'D0', 'G#0', 'A#0',
  'C1', 'D1', 'E1', 'F#1', 'G#1', 'A#1',
  'C2', 'D2', 'E2', 'F#2', 'G#2', 'A#2',
  'C3', 'D3', 'E3', 'F#3', 'G#3', 'A#3',
  'C4', 'D4', 'E4', 'F#4', 'G#4', 'A#4',
  'C5',
]
const harpsiFiles = HARPSI_NOTES.map((note) => {
  const sourceFile = `Chordophones/Zithers/Harpsichord, French/Sustains/Harpsi2_Normal_${note}_rr1_Main.wav`
  return {
    url: `${VCSL_BASE}/${sourceFile.split('/').map(encodeURIComponent).join('/')}`,
    sourceFile: `VCSL@${VCSL_SHA.slice(0, 7)}/${sourceFile}`,
    rootMidi: nameToMidi(note) + 12, // same VCSL octave-low naming
    velocityLayer: 1,
    seconds: 8,
    mono: false,
  }
})

const SETS = [
  {
    id: 'upright-vcsl',
    type: 'Upright',
    name: 'VS Upright',
    dir: 'upright',
    velocityLayers: 3,
    kind: 'recorded',
    source:
      'Upright Piano, Yamaha (a.k.a. "VS Upright No. 1") from the Versilian Community Sample Library (VCSL), recorded by Versilian Studios LLC — fetched from the pinned GitHub commit sgossner/VCSL@' +
      VCSL_SHA.slice(0, 7) +
      ' and re-encoded to MP3 by scripts/fetch-samples.mjs. 13 roots (C/G per octave) x 3 recorded velocity layers (rr1 takes).',
    license: 'CC0 1.0 (Versilian Studios LLC)',
    files: uprightFiles,
  },
  {
    id: 'electric-rhodes',
    type: 'Electric',
    name: 'Rhodes Mk I',
    dir: 'electric',
    velocityLayers: 3,
    kind: 'recorded',
    source:
      'jRhodes3d — Jeff Learman\'s 1977 Rhodes Mark I Stage 73, recorded directly from the harp connector (mono) — fetched from the pinned GitHub commit sfzinstruments/jlearman.jRhodes3d@' +
      JRHODES_SHA.slice(0, 7) +
      ' and re-encoded to MP3 by scripts/fetch-samples.mjs. 15 roots x 3 of the 5 recorded velocity layers.',
    license: 'CC-BY-NC-4.0 (Jeff Learman) — non-commercial use, attribution required',
    files: rhodesFiles,
  },
  {
    id: 'clav-harpsichord',
    type: 'Clav',
    name: 'Harpsichord',
    dir: 'harpsichord',
    velocityLayers: 1,
    kind: 'recorded',
    source:
      'Harpsichord, French from the Versilian Community Sample Library (VCSL), recorded by Versilian Studios LLC — fetched from the pinned GitHub commit sgossner/VCSL@' +
      VCSL_SHA.slice(0, 7) +
      ' and re-encoded to MP3 by scripts/fetch-samples.mjs. 28 roots x 1 layer (real harpsichords are not velocity sensitive).',
    license: 'CC0 1.0 (Versilian Studios LLC)',
    files: harpsiFiles,
  },
]

/* ------------------------------------------------------------- pipeline -- */

async function download(url, target) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`)
  writeFileSync(target, Buffer.from(await response.arrayBuffer()))
}

function encode(input, output, { seconds, mono }) {
  const fadeStart = seconds - 1
  const args = [
    '-v', 'error', '-y',
    '-i', input,
    '-t', String(seconds),
    '-af', `afade=t=out:st=${fadeStart}:d=1`,
    ...(mono ? ['-ac', '1'] : []),
    '-ar', '44100',
    '-codec:a', 'libmp3lame',
    '-q:a', mono ? '5' : '6',
    output,
  ]
  execFileSync(ffmpegPath, args)
}

const tmp = mkdtempSync(join(tmpdir(), 'stagebench-samples-'))
const instruments = []

for (const set of SETS) {
  const dir = join(out, set.dir)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const zones = []
  let index = 0
  for (const file of set.files) {
    const raw = join(tmp, `${set.dir}-${index++}${file.url.endsWith('.flac') ? '.flac' : '.wav'}`)
    await download(file.url, raw)
    const target = set.velocityLayers > 1 ? `${midiToStem(file.rootMidi)}-l${file.velocityLayer}.mp3` : `${midiToStem(file.rootMidi)}.mp3`
    encode(raw, join(dir, target), file)
    zones.push({ file: target, rootMidi: file.rootMidi, velocityLayer: file.velocityLayer, sourceFile: file.sourceFile })
    process.stdout.write(`${set.dir}/${target}\n`)
  }
  instruments.push({
    id: set.id,
    type: set.type,
    name: set.name,
    dir: set.dir,
    velocityLayers: set.velocityLayers,
    kind: set.kind,
    source: set.source,
    license: set.license,
    zones: zones.sort((a, b) => a.rootMidi - b.rootMidi || a.velocityLayer - b.velocityLayer),
  })
  console.log(`== ${set.id}: ${zones.length} files (${readdirSync(dir).length} on disk)`)
}

rmSync(tmp, { recursive: true, force: true })
writeFileSync(join(out, 'fetched.json'), JSON.stringify({ version: 1, instruments }, null, 2))
console.log('Wrote', instruments.map((i) => `${i.id}: ${i.zones.length} files`).join(', '))
