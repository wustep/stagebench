// Regenerates IMPLEMENTATION_DETAILS.json from the bundled sample packs (their embedded headers:
// provenance, every zone's source file, root note and velocity layer) and scripts/samples manifests.
// Usage: node scripts/write-implementation-details.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(resolve(root, 'scripts/samples/manifest.json'), 'utf8'))
const extra = JSON.parse(readFileSync(resolve(root, 'scripts/samples/manifest-extra.json'), 'utf8'))
const meta = { grand: manifest.grand, upright: manifest.upright, electric: manifest.electric, 'electric-rhodes': extra.electric_rhodes }
const models = {
  grand: 'Salamander Grand',
  upright: 'Upright KW',
  electric: 'Wurlitzer EP200',
  'electric-rhodes': 'Rhodes (jRhodes3)',
}

function header(file) {
  const b = readFileSync(resolve(root, file))
  const n = b.readUInt32LE(8)
  return JSON.parse(b.subarray(12, 12 + n).toString('utf8'))
}

const sampleSources = Object.keys(meta).map((key) => {
  const file = `public/samples/${key}.nspk`
  const h = header(file)
  const m = meta[key]
  const roots = [...new Set(h.zones.map((z) => z.root))].sort((a, b) => a - b)
  const layers = {}
  for (const z of h.zones) layers[z.layer] = `${z.velLo}-${z.velHi}`
  return {
    name: `${models[key]} — ${h.name}`,
    pianoModel: models[key],
    kind: 'recorded-samples',
    recordedInstrument: h.recordedInstrument,
    author: h.author,
    source: m.source,
    download: m.download,
    license: h.license,
    licenseUrl: m.licenseUrl,
    attribution: m.attribution,
    licenseFile: `public/samples/licenses/${key}-LICENSE.txt`,
    files: [file, `public/samples/licenses/${key}-LICENSE.txt`],
    format: `NSPK v1 container: JSON header + block IMA-ADPCM mono, ${h.sampleRate} Hz, ${h.blockSamples}-sample blocks (built by scripts/build-sample-packs.mjs; decoded in src/audio/samplePack.ts)`,
    processing: m.processing ?? m.notes ?? 'Converted to mono, resampled, trimmed and faded (see scripts/samples/build.py).',
    rootNotes: roots,
    velocityLayers: layers,
    zones: h.zones.map((z) => ({ root: z.root, layer: z.layer, velocity: `${z.velLo}-${z.velHi}`, samples: z.length, file: z.source })),
    notes:
      key === 'electric'
        ? 'Only 20 pitches (MIDI 33-92) were recorded in the source set, so the lowest keys (E1-G#1) shift up to 5 semitones down and the top keys above G6 shift up to 8 semitones up; inside 33-92 no key is more than 4 semitones from a root.'
        : key === 'electric-rhodes'
          ? 'Second Electric model (model dial). One velocity layer only (the CC0 GM subset); the CC BY-NC jRhodes sets were not used.'
          : `Roots every ~3 semitones across the keybed; ${Object.keys(layers).length} velocity layers.`,
  }
})

const gen = (name, generator, method) => ({
  name,
  kind: 'generated-buffer',
  generator,
  method,
  rendering: 'Rendered in the browser at load time; not stored as files and not derived from any recording.',
  license: 'Original code in this repository; no third-party audio.',
})

const details = {
  $schema: 'https://stagebench.local/schemas/implementation-details.schema.json',
  version: 1,
  phase: 2,
  variant: 'stage-4-73',
  audio: {
    strategy:
      'One AudioContext. Each note is routed by LayeredEngine to the enabled piano layers (A/B); each layer owns its voices (own NoteEngine). A voice is AudioBufferSourceNode(s) playing the nearest recorded zone for the touch-mapped velocity layer (or a generated buffer for Clav/Digital/Misc), unison copies through StereoPanners, a velocity low-pass and an envelope gain into the layer bus. Layer bus -> Timbre EQ (+ String Res comb bank) -> Mod 1 -> Mod 2 -> Delay -> Amp Sim/EQ -> Compressor -> Reverb -> layer level -> (direct | To Rotary -> shared Rotary) -> master gain (Master Level) -> limiter (DynamicsCompressor) -> destination.',
    sampleSources,
    generatedSources: [
      gen('Digital Piano (synth)', 'src/audio/pianoTone.ts renderPianoTone()', 'Additive synthesis of inharmonic string partials with two-stage decay and a noise hammer transient (the Phase 1 tone), roots every 3 semitones. Also the labelled fallback for a recorded model whose pack fails to load.'),
      gen('FM E.Piano (synth)', "src/audio/synthModels.ts fmEpiano()", 'Two-operator FM (sine carrier, decaying modulation index) plus a short 14th-harmonic tine transient.'),
      gen('Clavinet (synth)', 'src/audio/synthModels.ts clavinet()', 'Additive plucked-string harmonics shaped by pluck- and pickup-position combs, with a short deterministic tangent click.'),
      gen('Harpsichord (synth)', 'src/audio/synthModels.ts harpsichord()', "Additive 8' + 4' plucked choirs with slow decay."),
      gen('Marimba (synth)', 'src/audio/synthModels.ts marimba()', 'Damped tuned-bar modes at 1 : 3.93 : 9.24.'),
      gen('Vibraphone (synth)', 'src/audio/synthModels.ts vibraphone()', 'Damped metal-bar modes at 1 : 4 : 10.1 with long ring.'),
      gen('Reverb impulse responses (generated)', 'src/audio/fx/reverb.ts renderImpulse()', 'Deterministic filtered-noise exponential tails per type (Booth 0.25 s … Cathedral 4.2 s RT) with falling damping; Spring adds a repeating dispersive chirp train. Used by ConvolverNodes.'),
      {
        name: 'Last-resort fallback tone (live synthesis)',
        kind: 'live-oscillator',
        generator: 'src/audio/stageAudio.ts startVoice() fallback branch',
        method: 'Triangle OscillatorNode with decaying gain, used only if both a recorded pack and the generated Digital fallback are unavailable. Status and Program OLED label the fallback.',
        license: 'Original code in this repository; no third-party audio.',
      },
    ],
    liveProcessing: [
      'Effects are live Web Audio processing (no recordings): Mod 1/Mod 2 LFO/delay/all-pass networks, delay line with in-loop feedback filter, WaveShaper amp models with cabinet biquads, 24 dB biquad LP/HP, DynamicsCompressor, generated-IR convolution reverb, and a two-rotor Rotary (crossover, doppler delay, AM, auto-pan).',
    ],
    notes: [
      'Grand, Upright and Electric (two Electric models) are bundled recorded samples served from public/samples and loaded offline from the app bundle; Clav, Digital and Misc models are synthesized in the browser and labelled "(synth)" in the model names.',
      'If a sample pack fails to load, the status reports "fallback" (never "ready"), names the failed pack, flashes the type LED, shows LOAD FAILED on the Program OLED, and the model plays the generated Digital piano as a labelled fallback.',
      'Soft/sostenuto pedals are not implemented (optional in the spec) and are not claimed. String Res is a simulated sympathetic resonance (comb bank), as the spec allows.',
      'Tests render the real sample packs, generated buffers and effect graphs with the in-repo Web Audio simulator (src/testing/simAudio.ts).',
    ],
  },
  boundaries: {
    injectable: ['AudioContext factory', 'asset fetch (sample packs)', 'requestMIDIAccess', 'keyboard/blur event target', 'document visibility', 'event-loop yield', 'monotonic clock (tap tempo)'],
    definedIn: 'src/runtime.ts',
  },
}

writeFileSync(resolve(root, 'IMPLEMENTATION_DETAILS.json'), `${JSON.stringify(details, null, 2)}\n`)
console.log(`IMPLEMENTATION_DETAILS.json: ${sampleSources.length} sample sources, ${sampleSources.reduce((n, s) => n + s.zones.length, 0)} zones`)
