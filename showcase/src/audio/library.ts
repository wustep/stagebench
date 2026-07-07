/**
 * Bundled recorded Piano sample library.
 *
 * Eight audibly distinct recorded sample sets across the six selectable
 * piano types — Clav and Misc each carry a second model (spec:
 * nord-stage-4.piano.json scope.optional "More than one model per type and
 * the model list view") — bundled under public/samples/ for offline
 * playback (see public/samples/SOURCES.md and IMPLEMENTATION_DETAILS.json
 * for the complete source/license provenance):
 *
 * - Grand    "Salamander Grand" — Salamander Grand Piano V3 (Alexander Holm,
 *            CC BY 3.0), 30 roots x 4 recorded velocity layers.
 * - Upright  "VS Upright" — VCSL Upright Piano, Yamaha (Versilian Studios,
 *            CC0), 13 roots x 3 recorded velocity layers.
 * - Electric "Rhodes Mk I" — jRhodes3d, Jeff Learman's 1977 Rhodes Mark I
 *            Stage 73 (CC-BY-NC-4.0), 15 roots x 3 recorded velocity layers.
 * - Clav     "Clavinet" — GM Clavinet from the MIDI-JS Soundfonts collection
 *            (MIT), 19 roots x 1 layer (spec: clavinet/harpsichord character).
 *            "Harpsichord" — a second Clav model, VCSL Harpsichord, French
 *            (CC0), 28 roots x 1 layer.
 * - Digital  "FM Piano" — GM Electric Piano 2 (FM/DX digital piano character)
 *            from the same collection (MIT), 19 roots x 1 layer.
 * - Misc     "Vibraphone" — GM Vibraphone (mallet character) from the same
 *            collection (MIT), 19 roots x 1 layer.
 *            "Marimba" — a second Misc model, GM Marimba (MIT),
 *            19 roots x 1 layer.
 *
 * The "Piano not found" state (spec: nord-stage-4.piano.json
 * selection.missingModelState) remains for any type whose model list is
 * empty or whose samples fail to load; with all six types populated it is
 * reachable only through load failure (see piano.fallback tests).
 */

export const PIANO_TYPES = ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'] as const
export type PianoType = (typeof PIANO_TYPES)[number]

export interface SampleZone {
  /** Path below public/, e.g. "samples/grand/c4-l2.mp3". */
  file: string
  rootMidi: number
  /** 1-based recorded velocity layer (1 = softest). */
  velocityLayer: number
}

export interface InstrumentSpec {
  id: string
  type: PianoType
  name: string
  velocityLayers: number
  /** Recorded provenance summary (full detail in IMPLEMENTATION_DETAILS.json). */
  source: string
  license: string
  gain: number
  zones: SampleZone[]
}

const SALAMANDER_ROOT_STEMS: Array<[string, number]> = []
{
  // A, C, D#, F# of each octave: A0 (21) .. C8 (108).
  const names = ['c', 'cs', 'd', 'ds', 'e', 'f', 'fs', 'g', 'gs', 'a', 'as', 'b']
  for (let midi = 21; midi <= 108; midi++) {
    const pitchClass = midi % 12
    if (pitchClass === 9 || pitchClass === 0 || pitchClass === 3 || pitchClass === 6) {
      SALAMANDER_ROOT_STEMS.push([`${names[pitchClass]}${Math.floor(midi / 12) - 1}`, midi])
    }
  }
}

const GM_ROOT_STEMS: Array<[string, number]> = []
{
  // C, E, Ab of each octave: C1 (24) .. C7 (96).
  const names = ['c', 'cs', 'd', 'ds', 'e', 'f', 'fs', 'g', 'gs', 'a', 'as', 'b']
  for (let midi = 24; midi <= 96; midi++) {
    const pitchClass = midi % 12
    if (pitchClass === 0 || pitchClass === 4 || pitchClass === 8) {
      if (midi > 92) continue // GM renders stop at Ab6 in this set except final C7
      GM_ROOT_STEMS.push([`${names[pitchClass]}${Math.floor(midi / 12) - 1}`, midi])
    }
  }
  GM_ROOT_STEMS.push(['c7', 96])
}

function salamanderZones(): SampleZone[] {
  const zones: SampleZone[] = []
  for (const [stem, rootMidi] of SALAMANDER_ROOT_STEMS) {
    for (const layer of [1, 2, 3, 4]) {
      zones.push({ file: `samples/grand/${stem}-l${layer}.mp3`, rootMidi, velocityLayer: layer })
    }
  }
  return zones
}

function gmZones(dir: string): SampleZone[] {
  return GM_ROOT_STEMS.map(([stem, rootMidi]) => ({ file: `samples/${dir}/${stem}.mp3`, rootMidi, velocityLayer: 1 }))
}

const STEM_NAMES = ['c', 'cs', 'd', 'ds', 'e', 'f', 'fs', 'g', 'gs', 'a', 'as', 'b']

function midiToStem(midi: number): string {
  return `${STEM_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`
}

/** Multi-layer zones for the fetched sets (scripts/fetch-samples.mjs). */
function layeredZones(dir: string, roots: readonly number[], layers: number): SampleZone[] {
  const zones: SampleZone[] = []
  for (const rootMidi of roots) {
    for (let layer = 1; layer <= layers; layer++) {
      zones.push({ file: `samples/${dir}/${midiToStem(rootMidi)}-l${layer}.mp3`, rootMidi, velocityLayer: layer })
    }
  }
  return zones
}

/** VCSL Upright Piano, Yamaha: C/G per octave, sounding C1..C7. */
const UPRIGHT_ROOTS: readonly number[] = [24, 31, 36, 43, 48, 55, 60, 67, 72, 79, 84, 91, 96]

/** jRhodes3d recorded roots (filenames encode the sounding MIDI note). */
const RHODES_ROOTS: readonly number[] = [29, 35, 40, 45, 50, 55, 59, 62, 65, 71, 76, 81, 86, 91, 96]

/** VCSL Harpsichord, French recorded roots (sounding pitch; single layer). */
const HARPSICHORD_ROOTS: readonly number[] = [
  26, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60, 62, 64, 66, 68, 70, 72, 74, 76, 78, 80, 82, 84,
]

function harpsichordZones(): SampleZone[] {
  return HARPSICHORD_ROOTS.map((rootMidi) => ({
    file: `samples/harpsichord/${midiToStem(rootMidi)}.mp3`,
    rootMidi,
    velocityLayer: 1,
  }))
}

export const INSTRUMENTS: readonly InstrumentSpec[] = [
  {
    id: 'grand-salamander',
    type: 'Grand',
    name: 'Salamander Grand',
    velocityLayers: 4,
    source: 'Salamander Grand Piano V3 (Yamaha C5, rec. Alexander Holm) via npm @audio-samples/piano-mp3-velocity{4,8,13,16}',
    license: 'CC BY 3.0 — Alexander Holm',
    gain: 1.0,
    zones: salamanderZones(),
  },
  {
    id: 'upright-vcsl',
    type: 'Upright',
    name: 'VS Upright',
    velocityLayers: 3,
    source: 'VCSL Upright Piano, Yamaha ("VS Upright No. 1", Versilian Studios) fetched from github.com/sgossner/VCSL by scripts/fetch-samples.mjs',
    license: 'CC0 1.0 — Versilian Studios LLC',
    // The fetched VCSL recordings are much hotter than the GM renders this
    // set replaced (forte layer mean -25.8 dB vs the old set's -36 dB):
    // gain mean-level-matches the previous Upright so program balances hold.
    gain: 0.5,
    zones: layeredZones('upright', UPRIGHT_ROOTS, 3),
  },
  {
    id: 'electric-rhodes',
    type: 'Electric',
    name: 'Rhodes Mk I',
    velocityLayers: 3,
    source: 'jRhodes3d — 1977 Rhodes Mark I Stage 73 (rec. Jeff Learman) fetched from github.com/sfzinstruments/jlearman.jRhodes3d by scripts/fetch-samples.mjs',
    license: 'CC-BY-NC-4.0 — Jeff Learman (non-commercial, attribution)',
    // The jRhodes recordings are much hotter than the GM renders this set
    // replaced (mean -16 dB / peaks near -3 dB vs the old set's -36 dB
    // mean): gain mean-level-matches the previous Electric so program
    // balances and master-limiter headroom (24-note clipping test) hold.
    gain: 0.16,
    zones: layeredZones('electric', RHODES_ROOTS, 3),
  },
  {
    id: 'clav-gm',
    type: 'Clav',
    name: 'Clavinet',
    velocityLayers: 1,
    source: 'GM Clavinet (plucked clavinet character), MIDI-JS Soundfonts collection via npm web-music-score-samples',
    license: 'MIT — MIDI-JS Soundfonts (B. Gleitzman)',
    gain: 1.5,
    zones: gmZones('clav'),
  },
  {
    id: 'digital-fm',
    type: 'Digital',
    name: 'FM Piano',
    velocityLayers: 1,
    source: 'GM Electric Piano 2 (FM/DX digital piano character), MIDI-JS Soundfonts collection via npm web-music-score-samples',
    license: 'MIT — MIDI-JS Soundfonts (B. Gleitzman)',
    gain: 1.5,
    zones: gmZones('digital'),
  },
  {
    id: 'misc-vibraphone',
    type: 'Misc',
    name: 'Vibraphone',
    velocityLayers: 1,
    source: 'GM Vibraphone (mallet character), MIDI-JS Soundfonts collection via npm web-music-score-samples',
    license: 'MIT — MIDI-JS Soundfonts (B. Gleitzman)',
    gain: 1.4,
    zones: gmZones('misc'),
  },
  {
    id: 'clav-harpsichord',
    type: 'Clav',
    name: 'Harpsichord',
    velocityLayers: 1,
    source: 'VCSL Harpsichord, French (Versilian Studios) fetched from github.com/sgossner/VCSL by scripts/fetch-samples.mjs',
    license: 'CC0 1.0 — Versilian Studios LLC',
    gain: 1.5,
    zones: harpsichordZones(),
  },
  {
    id: 'misc-marimba',
    type: 'Misc',
    name: 'Marimba',
    velocityLayers: 1,
    source: 'GM Marimba (mallet character), MIDI-JS Soundfonts collection via npm web-music-score-samples',
    license: 'MIT — MIDI-JS Soundfonts (B. Gleitzman)',
    gain: 1.4,
    zones: gmZones('marimba'),
  },
]

export function instrumentsOfType(type: PianoType): InstrumentSpec[] {
  return INSTRUMENTS.filter((i) => i.type === type)
}

/**
 * Synth section's optional Samples mode (spec.scope.optional: "Samples mode
 * with a small bundled sample set"): two recorded sets, bundled under
 * public/samples/ alongside the Piano library (see SOURCES.md and
 * IMPLEMENTATION_DETAILS.json for full provenance). Kept as a SEPARATE
 * export from INSTRUMENTS/instrumentsOfType/PIANO_TYPES so the existing
 * piano-type filtering and tests are untouched — these are not piano models.
 *
 * - Strings "Strings" — GM String Ensemble 1 (bowed string-section
 *   character) from the MIDI-JS Soundfonts collection (MIT), 19 roots x 1 layer.
 * - Choir   "Choir" — GM Choir Aahs (sustained vocal-pad character) from the
 *   same collection (MIT), 19 roots x 1 layer.
 */
export interface SynthSampleSet {
  id: string
  name: string
  source: string
  license: string
  gain: number
  zones: SampleZone[]
}

export const SYNTH_SAMPLE_SETS: readonly SynthSampleSet[] = [
  {
    id: 'synth-strings',
    name: 'Strings',
    source: 'GM String Ensemble 1 (bowed string-section character), MIDI-JS Soundfonts collection via npm web-music-score-samples',
    license: 'MIT — MIDI-JS Soundfonts (B. Gleitzman)',
    gain: 1.3,
    zones: gmZones('synth-strings'),
  },
  {
    id: 'synth-choir',
    name: 'Choir',
    source: 'GM Choir Aahs (sustained vocal-pad character), MIDI-JS Soundfonts collection via npm web-music-score-samples',
    license: 'MIT — MIDI-JS Soundfonts (B. Gleitzman)',
    gain: 1.3,
    zones: gmZones('synth-choir'),
  },
]

export function getSynthSampleSet(id: string): SynthSampleSet {
  const found = SYNTH_SAMPLE_SETS.find((s) => s.id === id)
  if (!found) throw new Error(`Unknown synth sample set: ${id}`)
  return found
}

/** Per-set memo for nearestSynthZone: the zone list is immutable, so the
 *  nearest root for a given (possibly fractional, via global fine tune)
 *  target note never changes — computing it per key press was a linear scan
 *  on the note-on hot path. */
const synthZoneCache = new WeakMap<SynthSampleSet, Map<number, SampleZone>>()

/** Picks the closest recorded root for a target note (fewest semitones of
 *  shift) from a synth sample set — mirrors nearestZones for InstrumentSpec. */
export function nearestSynthZone(set: SynthSampleSet, midi: number): SampleZone {
  let cache = synthZoneCache.get(set)
  if (!cache) {
    cache = new Map()
    synthZoneCache.set(set, cache)
  }
  const cached = cache.get(midi)
  if (cached) return cached
  let best = set.zones[0]!
  let bestDistance = Math.abs(midi - best.rootMidi)
  for (const zone of set.zones) {
    const distance = Math.abs(midi - zone.rootMidi)
    if (distance < bestDistance) {
      bestDistance = distance
      best = zone
    }
  }
  cache.set(midi, best)
  return best
}

export function getInstrument(id: string): InstrumentSpec {
  const found = INSTRUMENTS.find((i) => i.id === id)
  if (!found) throw new Error(`Unknown instrument: ${id}`)
  return found
}

/** Per-instrument memo for nearestZones: scanning + filtering 90 zones (the
 *  Grand) allocated a fresh array on every key press. Callers only read the
 *  returned list, so one shared array per (instrument, note) is safe. */
const instrumentZoneCache = new WeakMap<InstrumentSpec, Map<number, SampleZone[]>>()

/** Picks the closest recorded root for a target note (fewest semitones of shift). */
export function nearestZones(spec: InstrumentSpec, midi: number): SampleZone[] {
  let cache = instrumentZoneCache.get(spec)
  if (!cache) {
    cache = new Map()
    instrumentZoneCache.set(spec, cache)
  }
  const cached = cache.get(midi)
  if (cached) return cached
  let bestRoot = spec.zones[0]!.rootMidi
  let bestDistance = Math.abs(midi - bestRoot)
  for (const zone of spec.zones) {
    const distance = Math.abs(midi - zone.rootMidi)
    if (distance < bestDistance) {
      bestDistance = distance
      bestRoot = zone.rootMidi
    }
  }
  const zones = spec.zones.filter((z) => z.rootMidi === bestRoot)
  cache.set(midi, zones)
  return zones
}

/** Shared single-layer result (callers only index into the array). */
const SINGLE_LAYER_GAINS = [1]

/**
 * Recorded-layer crossfade for a velocity in [0,1]: returns per-layer gains.
 * Single-layer instruments return [1]; the engine shapes their velocity with
 * gain and a velocity-keyed filter instead (declared, truthful).
 */
export function velocityLayerGains(layerCount: number, velocity: number): number[] {
  if (layerCount <= 1) return SINGLE_LAYER_GAINS
  const position = velocity * (layerCount - 1)
  const gains = new Array<number>(layerCount)
  for (let i = 0; i < layerCount; i++) gains[i] = Math.max(0, 1 - Math.abs(position - i))
  return gains
}
