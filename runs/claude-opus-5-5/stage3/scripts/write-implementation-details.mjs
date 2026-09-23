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

/** The unsupported-control audit, read from src/model/bindings/audit.ts (single source of truth). */
function controlAudit() {
  const text = readFileSync(resolve(root, 'src/model/bindings/audit.ts'), 'utf8')
  const block = (name) => {
    const start = text.indexOf(`export const ${name}`)
    const body = text.slice(start, text.indexOf('\n}', start))
    return Object.fromEntries([...body.matchAll(/'([a-z0-9-]+)': '([^']+)'/g)].map((m) => [m[1], m[2]]))
  }
  return {
    audit: 'src/model/bindings/audit.ts (every panel control is functional or listed here; tested in src/__tests__/system.test.tsx)',
    unsupported: block('UNSUPPORTED'),
    unsupportedShiftFunctions: block('UNSUPPORTED_SHIFT'),
  }
}

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
  phase: 3,
  variant: 'stage-4-73',
  audio: {
    strategy:
      'One AudioContext for every engine. LayeredEngine routes each physical key to the seven layers (Organ A/B, Piano A/B, Synth A/B/C) by section on/layer enable, split zone and crossfade gain, then octave shift and Transpose; each layer owns its voices. Piano voices are AudioBufferSourceNode(s) playing the nearest recorded zone (or a generated buffer for Clav/Digital/Misc) -> layer bus -> Timbre EQ (+ String Res) -> its own chain. Organ voices are live OscillatorNodes (sine / square / custom PeriodicWaves per model) -> per-layer Vox tone mix -> vibrato/chorus scanner -> layer level -> ONE shared organ chain. Synth voices are live OscillatorNodes (native and PeriodicWave waveforms), a looped generated noise buffer, ConstantSource envelopes, drive and two biquads -> layer bus -> arp gate -> its own chain -> layer level. Every chain is Mod 1 -> Mod 2 -> Delay -> Amp Sim/EQ -> Compressor -> Reverb, then (direct | shared Rotary: Organ via the Rotary ORGAN button, piano/synth via To Rotary) -> master gain (Master Level) -> limiter -> ceiling -> the single destination.',
    sampleSources,
    generatedSources: [
      gen('Digital Piano (synth)', 'src/audio/pianoTone.ts renderPianoTone()', 'Additive synthesis of inharmonic string partials with two-stage decay and a noise hammer transient (the Phase 1 tone), roots every 3 semitones. Also the labelled fallback for a recorded model whose pack fails to load.'),
      gen('FM E.Piano (synth)', "src/audio/synthModels.ts fmEpiano()", 'Two-operator FM (sine carrier, decaying modulation index) plus a short 14th-harmonic tine transient.'),
      gen('Clavinet (synth)', 'src/audio/synthModels.ts clavinet()', 'Additive plucked-string harmonics shaped by pluck- and pickup-position combs, with a short deterministic tangent click.'),
      gen('Harpsichord (synth)', 'src/audio/synthModels.ts harpsichord()', "Additive 8' + 4' plucked choirs with slow decay."),
      gen('Marimba (synth)', 'src/audio/synthModels.ts marimba()', 'Damped tuned-bar modes at 1 : 3.93 : 9.24.'),
      gen('Vibraphone (synth)', 'src/audio/synthModels.ts vibraphone()', 'Damped metal-bar modes at 1 : 4 : 10.1 with long ring.'),
      gen('Reverb impulse responses (generated)', 'src/audio/fx/reverb.ts renderImpulse()', 'Deterministic filtered-noise exponential tails per type (Booth 0.25 s … Cathedral 4.2 s RT) with falling damping; Spring adds a repeating dispersive chirp train. Used by ConvolverNodes.'),
      gen('Organ key click / pipe chiff noise (generated)', 'src/audio/organ.ts organShared()', '25 ms of deterministic xorshift noise with an exponential decay, played through a band-pass per key (B3/B3 Bass click, Pipe chiff).'),
      gen('Synth white noise (generated)', 'src/audio/synth.ts synthShared()', '1.5 s of deterministic PRNG noise, looped by an AudioBufferSourceNode for the White Noise waveform.'),
      {
        name: 'Organ engines (live synthesis)',
        kind: 'live-oscillator',
        generator: 'src/audio/organ.ts startOrganVoice(), OrganLayerGraph',
        method:
          "Per key: nine drawbar oscillators. B3: pure sines at 16', 5 1/3', 8', 4', 2 2/3', 2', 1 3/5', 1 1/3', 1' with top-octave foldback, key click, single-triggered 2nd/3rd-harmonic percussion. Vox: square-wave dividers with mixture drawbars II/III/IV and a filtered/unfiltered tone mix on drawbar 9. Farf: nine on/off tab registers with flute/strings/oboe/trumpet PeriodicWaves. Pipe 1/Pipe 2: flue/principal PeriodicWaves with slow speech, chiff and release; chorus = detuned celeste rank. B3 Bass reuses B3 (16'/8' only); Pipe 2 reuses Pipe with a brighter principal. Vibrato/chorus V1-V3/C1-C3 is a modulated-delay scanner per layer.",
        license: 'Original code in this repository; no third-party audio.',
      },
      {
        name: 'Synth engine (live synthesis)',
        kind: 'live-oscillator',
        generator: 'src/audio/synth.ts startSynthVoice(), SynthLayerGraph; src/audio/synthEngine.ts; src/audio/arp.ts',
        method:
          'Analog mode only. Pure: sine/triangle/saw/square OscillatorNodes and 33 %/10 % pulse PeriodicWaves, white noise; Sync: master saw/square with a resonant formant swept 0-3 octaves by Osc Ctrl (a documented approximation of hard sync); Multi: three detuned saws (+ octave saw); Super: seven detuned, stereo-spread saws/squares; FM-H: 2-operator FM (modulator 2 x f0) with Osc Ctrl as index. Unison 1-3, drive, LP12/LP24/HP/BP biquads with key tracking/resonance/envelope, ADR oscillator/filter/amp envelopes (ConstantSource), LFO (5 waveforms incl. a generated S&H PeriodicWave, 3 destinations, master-clock sync), vibrato, poly/mono/legato with priority and constant-rate glide, deterministic arpeggiator/gate.',
        license: 'Original code in this repository; no third-party audio.',
      },
      {
        name: 'Last-resort fallback tone (live synthesis)',
        kind: 'live-oscillator',
        generator: 'src/audio/stageAudio.ts startVoice() fallback branch',
        method: 'Triangle OscillatorNode with decaying gain, used only if both a recorded pack and the generated Digital fallback are unavailable. Status and Program OLED label the fallback.',
        license: 'Original code in this repository; no third-party audio.',
      },
    ],
    liveProcessing: [
      'Effects are live Web Audio processing (no recordings): six chains (Piano A/B, one shared Organ chain, Synth A/B/C) of Mod 1/Mod 2 LFO/delay/all-pass networks, delay line with in-loop feedback filter (Master Clock sync), WaveShaper amp models with cabinet biquads, 24 dB biquad LP/HP, DynamicsCompressor, generated-IR convolution reverb, and one two-rotor Rotary (crossover, doppler delay, AM, auto-pan; slow/fast/Stop with acceleration, drive, morphable speed).',
    ],
    notes: [
      'Grand, Upright and Electric (two Electric models) are bundled recorded samples served from public/samples and loaded offline from the app bundle; Clav, Digital and Misc models are synthesized in the browser and labelled "(synth)" in the model names.',
      'If a sample pack fails to load, the status reports "fallback" (never "ready"), names the failed pack, flashes the type LED, shows LOAD FAILED on the Program OLED, and the model plays the generated Digital piano as a labelled fallback.',
      'Soft/sostenuto pedals are not implemented (optional in the spec) and are not claimed. String Res is a simulated sympathetic resonance (comb bank), as the spec allows.',
      'Organ and Synth are live synthesis (OscillatorNode, PeriodicWave, ConstantSource and biquad graphs) in the same AudioContext; the only buffers they use are the generated click/chiff and white-noise buffers listed above. No organ or synth sound is a recording.',
      'Programs (32 + 8 Live) store canonical state only (no audio) in localStorage; Master Level and the pitch stick are not stored.',
      'Tests render the real sample packs, generated buffers, organ/synth voices and effect graphs with the in-repo Web Audio simulator (src/testing/simAudio.ts).',
    ],
  },
  controls: controlAudit(),
  boundaries: {
    injectable: ['AudioContext factory', 'asset fetch (sample packs)', 'requestMIDIAccess', 'keyboard/blur event target', 'document visibility', 'event-loop yield', 'monotonic clock (tap tempo, Master Clock tap)', 'program storage (localStorage)', 'repeating timer (arpeggiator clock)', 'diagnostics inspect hook'],
    definedIn: 'src/runtime.ts',
  },
}

writeFileSync(resolve(root, 'IMPLEMENTATION_DETAILS.json'), `${JSON.stringify(details, null, 2)}\n`)
console.log(`IMPLEMENTATION_DETAILS.json: ${sampleSources.length} sample sources, ${sampleSources.reduce((n, s) => n + s.zones.length, 0)} zones`)
