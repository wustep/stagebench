#!/usr/bin/env node
/**
 * Copies the bundled recorded Piano sample sets from their npm source
 * packages into public/samples/ with normalized file names, and writes a
 * machine-readable manifest next to them.
 *
 * Sources (npm registry only; see public/samples/SOURCES.md):
 * - Grand:    Salamander Grand Piano V3 (Alexander Holm, CC BY 3.0) via
 *             @audio-samples/piano-mp3-velocity{4,8,13} — 30 roots x 3 layers.
 * - Upright:  GM Honky-tonk (tack-upright character) via
 *             web-music-score-samples/003-honkytonk-piano (MIDI-JS Soundfonts, MIT).
 * - Electric: GM Electric Piano 1 (tine EP) via
 *             web-music-score-samples/004-electric-piano-1 (MIDI-JS Soundfonts, MIT).
 *
 * Run manually: node scripts/sync-samples.mjs
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'samples')

const NOTE_TO_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** "C4" | "D#4" | "Ab4" -> midi */
function nameToMidi(name) {
  const match = /^([A-G])([#b]?)(-?\d)$/.exec(name)
  if (!match) throw new Error(`Bad note name: ${name}`)
  const [, letter, accidental, octave] = match
  let semitone = NOTE_TO_SEMITONE[letter]
  if (accidental === '#') semitone += 1
  if (accidental === 'b') semitone -= 1
  return (Number(octave) + 1) * 12 + semitone
}

/** midi -> flat-safe file stem like "c4", "ds4" */
function midiToStem(midi) {
  const names = ['c', 'cs', 'd', 'ds', 'e', 'f', 'fs', 'g', 'gs', 'a', 'as', 'b']
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`
}

const instruments = []

/* ---------------------------------------------------- Salamander grand -- */
{
  const layers = [
    { pkg: '@audio-samples/piano-mp3-velocity4', tag: 'v4', layer: 1 },
    { pkg: '@audio-samples/piano-mp3-velocity8', tag: 'v8', layer: 2 },
    { pkg: '@audio-samples/piano-mp3-velocity13', tag: 'v13', layer: 3 },
  ]
  const dir = join(out, 'grand')
  mkdirSync(dir, { recursive: true })
  const zones = []
  for (const { pkg, tag, layer } of layers) {
    const audioDir = join(root, 'node_modules', pkg, 'audio')
    for (const file of readdirSync(audioDir).sort()) {
      const match = new RegExp(`^([A-G]#?\\d)${tag}\\.mp3$`).exec(file)
      if (!match) continue
      const midi = nameToMidi(match[1])
      const target = `${midiToStem(midi)}-l${layer}.mp3`
      copyFileSync(join(audioDir, file), join(dir, target))
      zones.push({ file: target, rootMidi: midi, velocityLayer: layer, sourceFile: `${pkg}/audio/${file}` })
    }
  }
  instruments.push({
    id: 'grand-salamander',
    type: 'Grand',
    name: 'Salamander Grand',
    dir: 'grand',
    velocityLayers: 3,
    kind: 'recorded',
    source: 'Salamander Grand Piano V3 (Yamaha C5) recorded by Alexander Holm — archive.org/details/SalamanderGrandPianoV3, bundled from npm @audio-samples/piano-mp3-velocity{4,8,13}',
    license: 'CC BY 3.0 (Alexander Holm)',
    zones: zones.sort((a, b) => a.rootMidi - b.rootMidi || a.velocityLayer - b.velocityLayer),
  })
}

/* ------------------------------------- MIDI-JS soundfont based pianos -- */
for (const spec of [
  {
    folder: '003-honkytonk-piano',
    id: 'upright-tack',
    type: 'Upright',
    name: 'Tack Upright',
    dir: 'upright',
    source:
      'GM Honky-tonk piano (detuned tack-upright character), note-per-note mp3 renders from the MIDI-JS Soundfonts collection (github.com/gleitz/midi-js-soundfonts), bundled from npm web-music-score-samples/003-honkytonk-piano. The collection is rendered from the FluidR3_GM / MusyngKite / FatBoy banks; the packaging does not identify the exact bank.',
    license: 'MIT (MIDI-JS Soundfonts collection, Benjamin Gleitzman; repackaged MIT by web-music-score-samples)',
  },
  {
    folder: '004-electric-piano-1',
    id: 'electric-tine',
    type: 'Electric',
    name: 'Tine EP',
    dir: 'electric',
    source:
      'GM Electric Piano 1 (tine/electromechanical character), note-per-note mp3 renders from the MIDI-JS Soundfonts collection (github.com/gleitz/midi-js-soundfonts), bundled from npm web-music-score-samples/004-electric-piano-1. The collection is rendered from the FluidR3_GM / MusyngKite / FatBoy banks; the packaging does not identify the exact bank.',
    license: 'MIT (MIDI-JS Soundfonts collection, Benjamin Gleitzman; repackaged MIT by web-music-score-samples)',
  },
]) {
  const sourceDir = join(root, 'node_modules', 'web-music-score-samples', 'samples', spec.folder)
  const dir = join(out, spec.dir)
  mkdirSync(dir, { recursive: true })
  const zones = []
  for (const file of readdirSync(sourceDir).sort()) {
    if (!file.endsWith('.mp3')) continue
    const midi = nameToMidi(file.replace('.mp3', ''))
    const target = `${midiToStem(midi)}.mp3`
    copyFileSync(join(sourceDir, file), join(dir, target))
    zones.push({ file: target, rootMidi: midi, velocityLayer: 1, sourceFile: `web-music-score-samples/samples/${spec.folder}/${file}` })
  }
  instruments.push({
    id: spec.id,
    type: spec.type,
    name: spec.name,
    dir: spec.dir,
    velocityLayers: 1,
    kind: 'recorded',
    source: spec.source,
    license: spec.license,
    zones: zones.sort((a, b) => a.rootMidi - b.rootMidi),
  })
}

if (!existsSync(join(out, 'grand', 'c4-l2.mp3'))) throw new Error('grand copy incomplete')
writeFileSync(join(out, 'manifest.json'), JSON.stringify({ version: 1, instruments }, null, 2))
console.log(
  'Wrote',
  instruments.map((i) => `${i.id}: ${i.zones.length} files`).join(', '),
)
