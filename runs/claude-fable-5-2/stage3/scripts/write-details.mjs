#!/usr/bin/env node
/**
 * Writes IMPLEMENTATION_DETAILS.json. The sample library section is generated from
 * src/audio/library/manifest.json so that every bundled file is declared exactly once and
 * the declaration cannot drift from what is on disk (tests/piano.instrument-library checks it).
 *
 *   node scripts/write-details.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(ROOT, 'src/audio/library/manifest.json'), 'utf8'))

/** Read a `Record<string, string>` literal out of a TypeScript source file, so this file cannot drift from it. */
function readRecord(file, name) {
  const source = readFileSync(join(ROOT, file), 'utf8')
  const start = source.indexOf(`export const ${name}`)
  if (start < 0) throw new Error(`${name} not found in ${file}`)
  const open = source.indexOf('= {', start) + 2
  const close = source.indexOf('\n}', open)
  const record = {}
  const entry = /^\s*(?:'([^']+)'|([A-Za-z][\w-]*)):\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"),?\s*$/gm
  for (const match of source.slice(open, close).matchAll(entry)) {
    record[match[1] ?? match[2]] = (match[3] ?? match[4]).replace(/\\'/g, "'")
  }
  return record
}
const UNSUPPORTED_CONTROLS = readRecord('src/hardware/functional.ts', 'UNSUPPORTED_CONTROLS')
const UNSUPPORTED_FUNCTIONS = readRecord('src/hardware/functional.ts', 'UNSUPPORTED_FUNCTIONS')
if (Object.keys(UNSUPPORTED_CONTROLS).length !== 11) throw new Error('Expected 11 unsupported controls')
/** Names of the hand-made factory programs, in slot order. */
const FACTORY_NAMES = [...readFileSync(join(ROOT, 'src/programs/factory.ts'), 'utf8').matchAll(/^  \[\s*\n?\s*'([^']+)',/gm)].map((match) => match[1])
if (FACTORY_NAMES.length < 8) throw new Error(`Only ${FACTORY_NAMES.length} factory program names found`)

const PROCESSING =
  'Each upstream recording was downmixed to mono (0.5 L + 0.5 R), resampled to 32 kHz, trimmed of leading silence, ' +
  'cut to a per-register maximum length with a fade-out, peak-normalised, and stored as 16-bit FLAC. ' +
  'Nothing was synthesized, layered, or pitch-corrected. scripts/build-samples.mjs is the exact recipe.'

const SET_NOTES = {
  grand:
    'Three of the sixteen upstream velocity layers (v4, v9, v14) at all thirty upstream roots (A0..C8, every minor third). ' +
    'Recordings are cut to 2-6 s by register, so very long held notes end sooner than on the real instrument. ' +
    'The upstream release samples, pedal-noise samples, and string-resonance samples are not used.',
  upright:
    'Both upstream velocity layers (L up to velocity 80, H above) with the upstream key mapping. ' +
    'Three L-layer regions carry the 2-pole lowpass the upstream SFZ specifies (1500/2200/2500 Hz), baked into the file. ' +
    'The upstream loop points are not used: recordings play once and are cut to 2-6 s by register.',
  electric:
    'All four upstream velocity layers (pp, mp, f, ff) with the upstream key mapping, tuning offsets, and per-region volumes. ' +
    'The instrument itself spans A1..C7. The nine keys of the 73-key bed outside that range (E1..G#1 and C#7..E7) play the nearest recording pitched down by up to five or up by up to eight semitones; inside the range no key is more than five semitones from its recording.',
}

const sampleSources = Object.entries(manifest.sets).map(([id, set]) => {
  const layersByFile = new Map()
  for (const layer of set.layers) {
    for (const zone of layer.zones) {
      const list = layersByFile.get(zone.file) ?? []
      const label = `${layer.name} (velocity <= ${Math.round(layer.maxVelocity * 127)}), keys ${zone.lo}-${zone.hi}`
      if (!list.includes(label)) list.push(label)
      layersByFile.set(zone.file, list)
    }
  }
  return {
    name: set.source.name,
    set: id,
    instrument: set.source.instrument,
    author: set.source.author,
    source: `https://github.com/${set.source.repo} at commit ${set.source.commit} (upstream: ${set.source.upstream})`,
    license: set.source.license,
    licenseUrl: set.source.licenseUrl,
    licenseFile: `public/samples/${id}/LICENSE.txt`,
    isRecording: true,
    kind: 'recorded-samples',
    format: `${manifest.bitDepth}-bit mono FLAC, ${manifest.sampleRate} Hz`,
    velocityLayers: set.layers.map((layer) => ({
      name: layer.name,
      maxMidiVelocity: Math.round(layer.maxVelocity * 127),
      zones: layer.zones.length,
    })),
    rootNotes: [...new Set(set.files.map((file) => file.rootName))],
    totalBytes: set.files.reduce((sum, file) => sum + file.bytes, 0),
    processing: PROCESSING,
    notes: SET_NOTES[id],
    files: set.files.map((file) => `public/samples/${file.file}`),
    fileDetails: set.files.map((file) => ({
      file: `public/samples/${file.file}`,
      upstreamFile: file.source,
      rootNote: file.rootName,
      rootMidi: file.root,
      velocityLayers: layersByFile.get(file.file) ?? [],
      seconds: file.seconds,
      truncated: file.truncated,
      ...(file.bakedLowpassHz ? { bakedLowpassHz: file.bakedLowpassHz } : {}),
      sha256: file.sha256,
    })),
  }
})

const synth = (recipe, name, usedBy, description) => ({
  name,
  recipe,
  kind: 'live-synthesis',
  isRecording: false,
  usesStoredBuffer: false,
  usedBy,
  description,
  files: ['src/audio/dsp/recipes.ts', 'src/audio/dsp/voices.ts'],
  license: 'Original code written for this candidate; no third-party audio or DSP code.',
})

const organ = (name, usedBy, description) => ({
  name,
  kind: 'live-synthesis',
  isRecording: false,
  usesStoredBuffer: false,
  usesGeneratedWavetable: true,
  usedBy,
  description,
  files: ['src/audio/dsp/organ.ts'],
  license: 'Original code written for this candidate; no third-party audio or DSP code.',
})
const ORGAN_SOURCES = [
  {
    name: 'Organ wavetables',
    kind: 'generated-buffer',
    isRecording: false,
    usesStoredBuffer: false,
    generatedAtRuntime: true,
    usedBy: 'Every Organ model.',
    description:
      'Eight single-cycle waves (tonewheel, sine, Vox reed, Vox flute, Farf divider, pipe flute, pipe principal, bright principal), each computed at start-up as a sum of harmonics from a fixed recipe in the source, in eleven octave bands so no harmonic passes 0.45 of the sample rate. 2048 samples each. They exist only in memory; nothing is bundled and nothing was recorded.',
    files: ['src/audio/dsp/organ.ts'],
    license: 'Original code written for this candidate.',
  },
  organ('Organ model B3', 'Organ Model B3.',
    'A bank of near-sine tonewheel oscillators, one per semitone and shared by every key that needs that pitch, with foldback above the 91st wheel. Nine drawbars at the footages 16, 5 1/3, 8, 4, 2 2/3, 2, 1 3/5, 1 1/3, 1 on a 3 dB-per-step law. Key click is a few milliseconds of high-passed noise at a fixed level. Percussion is a second or third harmonic on one shared, single-triggered decaying envelope. Vibrato/chorus is a short delay line swept by a 6.9 Hz triangle (the scanner), mixed with the straight signal for the C settings.'),
  organ('Organ model Vox', 'Organ Model Vox.',
    'Every footage feeds two buses, a bright reed wave and a dark flute wave; drawbars 1-4 are 16, 8, 4, 2, drawbars 5-7 are the mixtures II, III, IV, and drawbars 8 and 9 mix the flute and reed buses. Vibrato uses the delay-line modulator at 6.2 Hz. A model in the manner of a transistor organ, not a circuit model.'),
  organ('Organ model Farf', 'Organ Model Farf.',
    'Nine on/off register tabs (a drawbar pulled past half is on). Each tab is a buzzy divider wave at its footage through its own fixed voicing filter (low-pass flutes, high-pass strings, band-pass oboe, bright trumpet).'),
  organ('Organ model Pipe 1', 'Organ Model Pipe 1.',
    'Nine ranks from 16 to 1 foot, alternating flute and principal waves, that speak slowly (40 ms) with a breath of filtered-noise chiff. The vibrato/chorus selector detunes: chorus settings beat a slowly swept copy against the straight signal, vibrato settings are a tremulant.'),
  organ('Organ model Pipe 2', 'Organ Model Pipe 2.',
    'Reuses the Pipe 1 engine, as the organ spec allows, with nine principal ranks on brighter waves. Labelled as a reuse in the organ catalogue.'),
  organ('Organ model B3 Bass', 'Organ Model B3 Bass.',
    'Reuses the B3 engine, as the organ spec allows, with only its 16 and 8 foot drawbars; the other seven drawbars do nothing on this model and the display says so. No percussion.'),
]
const SYNTH_SOURCES = [
  {
    name: 'Synth oscillators',
    kind: 'live-synthesis',
    isRecording: false,
    usesStoredBuffer: false,
    usedBy: 'Synth layers A, B, and C (Analog mode; there is no Samples mode).',
    description:
      'Fourteen waveforms in five categories, each a different algorithm. Pure: sine, triangle, polyBLEP saw, square, 33 % and 10 % pulse, white noise (Osc Ctrl has no effect). Sync: a saw or square slave hard-synced to the note, with band-limited corrections at the slave wraps and at the reset (Osc Ctrl raises the slave pitch up to three octaves). Multi: three stacked saws, mono (Osc Ctrl detunes them up to 50 cents). Super: seven saws or five squares spread in pitch and across the stereo field (Osc Ctrl is spread and width). FM-H: two sine operators at 1:1 (Osc Ctrl is the modulation index, 0 to 9).',
    files: ['src/audio/dsp/synth.ts', 'src/synth/catalog.ts'],
    license: 'Original code written for this candidate; no third-party audio or DSP code.',
  },
  {
    name: 'Synth filter, envelopes, LFO, voices, arpeggiator',
    kind: 'live-synthesis',
    isRecording: false,
    usesStoredBuffer: false,
    usedBy: 'Synth layers A, B, and C.',
    description:
      'A topology-preserving state-variable filter per voice (LP12, LP24 as two cascaded stages, HP, BP) with keyboard tracking, resonance, and a tanh drive stage in front; attack/decay/release envelopes for oscillator, filter, and amplifier (decay at maximum is sustain); one LFO per layer (triangle, saw down, saw up, square, sample & hold) to pitch, Osc Ctrl, or filter; poly, mono, and legato with last/low/high priority and constant-rate glide; unison as two to four detuned, panned copies inside one voice; vibrato (On, Delay, Wheel, Pedal); and an arpeggiator / gate that counts samples inside the kernel, so its steps are sample-exact and repeatable.',
    files: ['src/audio/dsp/synth.ts'],
    license: 'Original code written for this candidate; no third-party audio or DSP code.',
  },
]

const details = {
  $schema: 'https://stagebench.local/schemas/implementation-details.schema.json',
  version: 1,
  phase: 3,
  variant: 'stage-4-73',
  audio: {
    strategy:
      'One AudioContext and one output node. A TypeScript DSP kernel (src/audio/dsp/stage.ts) runs in an AudioWorklet, or in a ScriptProcessorNode when the worklet is unavailable. ' +
      'Grand, Upright, and Electric play bundled recordings (198 FLAC files, 12 MB, decoded by the app\'s own FLAC decoder). ' +
      'Clav, Digital, and Misc are live additive synthesis and are labelled as synthesis in the model name, on the Program display, and in the status console. ' +
      'If a sample set cannot be loaded, its layer plays a synthesized stand-in voice labelled "Fallback Synth Piano", the type LED flashes, and the audio status reads Fallback, never Ready. ' +
      'The Organ (six models) and the Synth (fourteen waveforms) are live synthesis: nothing in them is a recording, and nothing is described as one. ' +
      'The only stored audio in the whole instrument is the three piano sample sets. The organ reads band-limited single-cycle wavetables that it computes in memory from fixed harmonic recipes when a kernel starts; they are generated buffers, declared below, and are not recordings. ' +
      'All effects are computed live in the kernel; no impulse responses or other audio buffers are bundled.',
    sampleSources,
    generatedSources: [
      synth('basic', 'Fallback Synth Piano', 'Any recorded model whose sample set failed to load (and the Phase 1 regression suite).',
        'The Phase 1 piano recipe, ported to the layer voice engine: up to 32 decaying sine partials per note with inharmonic stretch, a velocity-dependent spectrum, a two-stage decay on the lowest six partials, and a short filtered noise burst for the hammer.'),
      synth('clav-neck', 'Synth Clav Neck PU', 'Piano type Clav, model 1.',
        'Additive plucked-string model: 36 harmonics shaped by pluck position, by a pickup at 27 % of the string, and by a velocity-dependent rolloff; fast damper.'),
      synth('clav-bridge', 'Synth Clav Bridge PU', 'Piano type Clav, model 2.',
        'The same string model seen by a pickup at 8.5 % of the string: thinner and brighter.'),
      synth('fm-piano', 'Synth FM Piano', 'Piano type Digital.',
        'Additive imitation of an FM electric piano: a detuned pair on the fundamental, harmonics 2-4, and a short inharmonic "tine" cluster around the 14th harmonic that grows with velocity. It is not FM synthesis and not a recording.'),
      synth('vibraphone', 'Synth Vibraphone', 'Piano type Misc, model 1.',
        'Metal bar modes at 1 : 4 : 10 with a long ring, plus a short mallet noise burst.'),
      synth('marimba', 'Synth Marimba', 'Piano type Misc, model 2.',
        'Wooden bar modes at 1 : 3.93 : 9.2 with a short ring, plus a short mallet noise burst.'),
      {
        name: 'Sympathetic string resonance',
        kind: 'live-synthesis',
        isRecording: false,
        usesStoredBuffer: false,
        usedBy: 'String Res, on Grand and Upright.',
        description:
          'Simulated, not sampled. When a note is struck, each undamped string (a held key, or with the pedal down the octave/fifth/fourth relatives of the struck note) that shares a partial with it gets one slowly rising, decaying sine at the shared frequency, damped when that string is damped. The upstream pedal-down resonance recordings are not used.',
        files: ['src/audio/dsp/voices.ts'],
        license: 'Original code written for this candidate.',
      },
      {
        name: 'Layer Effects, Rotary, Piano Timbre, Unison',
        kind: 'live-processing',
        isRecording: false,
        usesStoredBuffer: false,
        usedBy: 'All six effect chains: Piano A, Piano B, Organ (shared by its two layers), Synth A, Synth B, Synth C.',
        description:
          'Biquad and state-variable filters, modulated delay lines, a comb/all-pass reverb, an all-pass-chain spring model, waveshapers, an envelope-following compressor, and a two-rotor Doppler/tremolo model. The Twin, JC, and Small amplifier models are tone-shaping approximations (fixed EQ, a drive curve, cabinet band limits), not circuit models.',
        files: ['src/audio/dsp/effects.ts', 'src/audio/dsp/stage.ts'],
        license: 'Original code written for this candidate.',
      },
      ...ORGAN_SOURCES,
      ...SYNTH_SOURCES,
    ],
    notes: [
      'Phase 3 signal graph: six buses — Piano A, Piano B, Organ, Synth A, Synth B, Synth C — each with its own chain (Mod 1, Mod 2, Delay, Amp Sim/EQ or filter, Compressor, Reverb), its own path through the one shared rotor when routed, and its level; they sum into the one master gain and soft limiter and leave through the one output node. The two Organ layers share the Organ bus, so their level faders are applied before the shared chain. There is still exactly one AudioContext and one connection to its destination.',
      'Keys reach a layer only inside its keyboard zones, scaled across a split crossfade (a linear gain that is 0.5 at the split point), and with the program transpose added; all of that happens inside the kernel, in src/audio/dsp/stage.ts.',
      'The Organ is routed to the Rotary by its own button in the Rotary Speaker group, independently of Layer Effects On (it is the speaker, not a layer effect). It reaches the rotary amplifier 12 dB hotter than its bus level so that Drive overdrives it; the level is restored after the rotary.',
      'Master Clock: the tempo is program state. A synced Synth LFO, arpeggiator, Delay, or Mod 1 has its rate derived from the tempo and the subdivision its knob selects (1/2, 1/4, 1/4T, 1/8, 1/8T, 1/16, 1/16T) when the sound state is derived; the kernel receives plain rates in Hz. Keyboard Sync restarts a synced layer when a key is played after all keys were up.',
      'Signal path, per Piano layer: voices -> Piano Timbre EQ -> Mod 1 -> Mod 2 -> Delay -> Amp Sim/EQ (or LP24/HP24 filter) -> Compressor -> Reverb -> Rotary (when routed) -> layer level; then both layers -> sum -> master gain (Master Level) -> soft limiter -> one output node -> AudioContext.destination. There is exactly one connection to the destination and nothing bypasses the master stage.',
      'The Rotary has one shared rotor (speed, acceleration, angles, drive setting). Each routed layer passes through its own crossover and delay lines driven by that rotor, so that the layer level can follow the Rotary as the documented order requires; two routed layers therefore overdrive separately rather than as a sum.',
      'Group and Global are implemented as shared settings: an edit is applied to every chain in the group (or to every chain for a Global unit), and entering the mode copies the focused chain\'s settings to the others. Each layer still runs its own instance of the unit, before its level fader; a Global Reverb is not moved after the Rotary (the effects spec excludes that nuance).',
      'Polyphony is 48 voices per layer (a Unison note uses 2 or 3) with deterministic stealing: released voices first, then pedal-held, then held keys; oldest strike first within a class.',
      'Velocity response: loudness follows velocity^1.7 after the KB Touch curve; Dyn Comp reduces that exponent. Within one velocity layer the softer end is slightly lowpassed so adjacent layers meet smoothly.',
      'The app decodes FLAC itself (src/audio/library/flac.ts) instead of calling decodeAudioData, so the same bytes give the same samples in every browser and in the tests.',
      'Sample files are fetched by relative path from the build output (public/samples -> dist/samples). No network host is contacted. Opening dist/index.html from file:// blocks both the worklet and the sample fetches in most browsers; the app then says so and plays the labelled fallback, or reports that it is silent.',
    ],
  },
  inputs: {
    pointerAndTouch:
      'Pointer Events on the keybed; every pointer is tracked separately (multi-touch chords, glissando). Strike position along the key sets velocity (0.30 at the back to 0.95 at the front edge).',
    computerKeyboard:
      "Physical-position mapping (event.code): A W S E D F T G Y H U J K O L P ; ' = C to F an octave and a fourth up, starting on C4. Z / X shift the octave. Space is sustain unless a control has focus. Shift is the panel's Shift. Auto-repeat is suppressed. Fixed velocity 0.72.",
    midi: 'Web MIDI, enabled by an explicit button. Note on/off with velocity on any channel, sustain CC64, modulation wheel CC1, control pedal CC11, CC120/CC123.',
    sustain:
      'Space, MIDI CC64, and an on-screen latching pedal button below the instrument. The pedal reaches each section only while that section has SUSTPED on.',
    morphSources:
      'Modulation wheel: the panel wheel or MIDI CC1. Control pedal: an on-screen slider below the instrument or MIDI CC11. Aftertouch is excluded.',
    shift:
      'Hold either panel Shift button (touch, or keyboard focus) or the computer Shift key while operating a control. A single click on a panel Shift button latches Shift for the next control. On an editing page of the Program display, or with a Morph Assign latched, a press of Shift is Exit.',
  },
  functionalInThisPhase: {
    program: [
      '32 program slots: Program buttons 1-8, Page buttons (4 pages), Program dial; the display shows page.button and the name',
      'Numeric list view of all 32 programs (Shift + Program dial)',
      'Store (press, choose the destination with dial / Page / Program buttons while it can be auditioned, press again); Store As (Shift + Store) with naming: dial for the character, Page for the cursor, Program 1 inserts, Program 2 deletes',
      'Edited indicator (E): a comparison of the loaded program with what is stored, so it clears when an edit is undone by hand; unsaved edits are discarded when another program is selected',
      '8 Live slots (Live Mode) whose edits are stored as they are made; programs can be stored to Live slots and Live slots to programs',
      'Programs and Live slots persist in the storage boundary (localStorage key stage4.programs.v1) and survive a reload',
      'Split On (Mid at C4) and the Keyboard Split page (Shift + Split): Low / Mid / High at any of the 11 positions C2..C7 or Off, crossfade Off / ±6 / ±12 per point, up to 4 zones',
      'KB Zone (Shift + Octave Shift in each section) assigns the focused layer to any contiguous run of zones; four zone LEDs per section; split-point LEDs above the keys',
      'Layer Scene II: two sets of section and layer on/off switches over one set of sound parameters',
      'Morph Assign Wheel and Ctrl Ped: latch, move destinations to their end values, unlatch; Shift + button clears; moving a destination back to its stored value removes it',
      'Master Clock: the Mst Clk button opens the tempo page (dial, 30-300 BPM, Keyboard Sync) and four or more taps set the tempo',
      'Transpose (-6..+6 semitones) and Panic (Shift + Transpose)',
    ],
    organ: [
      'Organ section On/Off; Layers A and B: on/off, focus, level fader with LED graph, octave shift, KB Zone; SUSTPED and PSTICK',
      'Organ Model per layer: B3, Vox, Farf, Pipe 1, Pipe 2, B3 Bass',
      'Nine drawbars with LED graphs (register tabs on Farf)',
      'B3 Percussion: On, Volume Soft, Decay Fast, Harmonic Third; key click',
      'Vibrato/Chorus selector V1 C1 V2 C2 V3 C3 (shared) with On per layer',
      'Rotary: Organ routing button, Slow/Fast, Stop Mode, Drive, morphable speed',
    ],
    piano: [
      'Piano section On/Off',
      'Layers A and B: on/off, focus, level fader, octave shift (-1..+1), KB Zone',
      'SUSTPED (Shift + Layer A) and PSTICK (Shift + Layer B; pitch stick bends +/-2 semitones)',
      'Type button (six types) and Model dial',
      'KB Touch (Medium / Light / Heavy), Dyn Comp (Off/1/2/3), Timbre (Off/Soft/Mid/Bright, plus Dyno 1/Dyno 2 for electric models), Unison (Off/1/2/3)',
      'Acoustics: Soft Release and String Res',
    ],
    synth: [
      'Synth section On/Off; Layers A, B, C: on/off, focus, level fader, octave shift, KB Zone; SUSTPED and PSTICK',
      'The Synth display and its three dials: oscillator page (whole list / category / waveform), Pitch page (coarse +/-24, fine +/-50 cents), the three envelope pages (attack / decay / release, with a drawn curve), Filter page (type / KB track / drive), LFO page, Arpeggiator menu (direction), Vibrato menu (rate 2-8 Hz, amount)',
      'Osc Ctrl, Osc Env Amt (bipolar), Env To Pitch (Shift + Pitch), envelope Velocity switches (Shift + each Envelope button; Off/1/2/3 for the amplifier)',
      'Filter: Type (LP12, LP24, HP, BP), Freq, Res, Env Amt, KB Track, Drive, Filter On',
      'LFO: five waveforms, destination Off / Osc Pitch / Osc Ctrl / Filter, Rate, Mod Amt, Master Clock sync (Shift + turn Rate)',
      'Voice: Poly / Mono / Legato, priority last / Lo / Hi (Shift + Voice mode), Glide, Unison Off/1/2/3, Vibrato Off / On / Delay / Wheel / Pedal',
      'Arpeggiator / Gate: Arp Run, mode Arp / Gate / Poly, Rate, Master Clock sync (Shift + turn Rate), Range (gate envelope in Gate mode), direction Up / Down / Up-Down / Random, KB Hold, KB Sync (Shift + Arp Run)',
      'Sound Init (Shift + Waveform)',
    ],
    effects: [
      'Layer Effects On (all-effects bypass; also Shift + FX Focus Organ)',
      'FX Focus Organ, Piano (A/B), Synth (A/B/C); Group for Piano and for Synth (Shift + FX Focus)',
      'Mod 1: A-Pan, Tremolo, Ring Mod, A-Wah, Wah, Pump; Rate/Sens, Amount, On; Master Clock sync (Shift + turn Rate)',
      'Mod 2: Phaser, Flanger, Chorus, Vibe, Ensemble, Spin; Rate, Amount, On',
      'Delay: Tempo, Tap, Feedback, Dry/Wet, feedback Filter Off/LP/BP/HP, Ping Pong (Shift + Filter), On, Global (Shift + On); Master Clock sync (Shift + turn Tempo)',
      'Amp Sim/EQ: EQ only, Twin, JC, Small, LP24, HP24, To Rotary; Drive, Bass, Mid/Res, Freq, Treble, On',
      'Compressor: Amount, Fast (Shift + Amount), On, Global, ACTIVE LED',
      'Reverb: Spring, Booth, Room, Stage, Hall, Cathedral; Bright/Dark, Dry/Wet, On, Global',
      'Rotary Speaker: Slow/Fast, Stop Mode, Drive (reached with To Rotary, or the Organ button)',
    ],
    other: ['Master Level', 'Modulation wheel (morph source, and vibrato depth in Wheel mode)', 'Pitch stick', 'All notes off (also clears every effect tail)', 'Sustain input', 'Audio, MIDI, program, and piano-library status'],
  },
  scope: {
    requiredImplemented:
      'Every item under scope.required in the piano, effects, programs, organ, and synth specs.',
    optionalImplemented: [
      'More than one model for Clav (2) and Misc (2); the other piano types have one model each',
      'Delay Ping Pong',
      'Rotary Stop Mode',
      'B3 Bass (reuses the B3 engine, limited to its 16 and 8 foot drawbars)',
      'Pipe 2 (reuses the Pipe 1 engine with brighter principal ranks)',
      'Synth vibrato modes Delay and Pedal',
      'Synth Sound Init',
    ],
    optionalNotImplemented: [
      'Piano model list view',
      'Soft pedal and sostenuto pedal (no input exists for them and nothing claims them)',
      'Pedal-down string resonance samples (resonance is simulated instead)',
      'Alphabetic list sorting, program categories, Solo, and the multi-view Prog View modes',
      'Single-level undo for program change (Shift + Solo): not implemented, and nothing claims it; unsaved edits are simply discarded on program change',
      'Organ percussion poly mode',
      'Synth Samples mode, LP M and LP+HP filters, the Sub / Shape / Shape Sine / Misc / Wave oscillator categories, FM Inharmonic algorithms, aftertouch vibrato',
    ],
  },
  optionalFeatures: {
    implemented: [
      'More than one model for Clav (2) and Misc (2); the other types have one model each',
      'Delay Ping Pong',
      'Rotary Stop Mode',
      'B3 Bass and Pipe 2 (as engine reuses)',
      'Synth vibrato Delay and Pedal modes; Synth Sound Init',
    ],
    notImplemented: [
      'Model list view',
      'Soft pedal and sostenuto pedal (no input exists for them and nothing claims them)',
      'Pedal-down string resonance samples (resonance is simulated instead)',
      'Program list sorting and categories, Solo, Prog View modes, undo',
      'Percussion poly mode; Synth Samples mode and the optional filter types, oscillator categories, and FM algorithms',
    ],
  },
  controlAudit: {
    totalControls: 146,
    functional: 135,
    unsupported: 11,
    functionalList: 'src/hardware/functional.ts (FUNCTIONAL_BUTTON_IDS, FUNCTIONAL_RANGE_IDS)',
    binding: 'src/state/binding.ts maps every functional control to one StageStore action and redraws the whole panel from the canonical state after every change.',
    test: 'tests/hardware.bindings.test.tsx operates every functional control and checks that the canonical state changes, and every unsupported control and checks that nothing does.',
    unsupportedControls: UNSUPPORTED_CONTROLS,
    unsupportedFunctions: UNSUPPORTED_FUNCTIONS,
  },
  decorativeInThisPhase: {
    summary:
      'Eleven controls, each excluded by a spec or optional and not implemented (controlAudit.unsupportedControls), move or press and are stored as presentation state only. They change no audio, no canonical state, and no display text. Every other control is functional.',
    howItIsEnforced:
      'Panel positions live in src/hardware/store.ts, which imports nothing from audio, input, platform, or state. Only the IDs in src/hardware/functional.ts are read by the binder (src/state/binding.ts). tests/interaction.decorative-controls.test.tsx operates the unsupported controls and proves the rendered audio is bit-identical and nothing is sent to the audio host.',
    initialPanelState:
      'The instrument starts on factory program 1.1, a plain grand piano. Knob, fader, drawbar, and selector positions are those on the reference photo. Deliberate differences, so that the panel never shows something that is not happening: the Organ and Synth sections, Organ Layer B, Piano Layer B, and Synth Layers B and C start off; every effect unit starts off; there is no split, so the Split LED is dark and every KB Zone LED is lit; the Morph Wheel LED is dark because nothing is assigned; the Synth FX Focus and Keep Edits LEDs and the LEDs of excluded features (Variation, Chorale, Ped Noise, Delay feedback effects) are dark; the Rotary ON LED is lit only while something plays through the Rotary.',
    oleds:
      'Program OLED: a bar with the loaded program (page.button name, E when edited, LIVE in Live Mode); then the layers of the section touched last, the focused layer\'s sound and whether it is recorded or synthesized, audio/MIDI/sustain/voice status, and the last panel action. On an editing page (Store, naming, list, split, clock, transpose) it shows that page. Synth OLED: the focused layer and waveform, and the page its three dials are on, with a drawn envelope curve on the envelope pages.',
  },
  unsupported: {
    excludedBySpec: [
      'Pedal noise and half-pedaling; Nord Triple Pedal modelling; piano size classes, INFO view, Sound Manager; piano preset library',
      'Per-type Variations and Reverb Chorale; Delay feedback-loop effects (the Delay Effects selector is decorative) and Analog mode; Mod 1 Pump/Wah pedal modes; Rotary close mic and stop angle; Global Reverb after the Rotary',
      'Banks beyond one and the 512-program layout, Organize; the Organ / Piano / Synth preset library (the three Preset Library buttons are decorative); aftertouch as a morph source (the A.T. button is decorative); Num Pad, Monitor/Copy/Paste, Section Edit, Layer Init; Aux KB, Extern, memory protection, and every Shift menu printed under the Program buttons; external MIDI clock and pedal tap',
      'Organ Preset / Drawbar Live modes and drawbar sync (the Organ Preset button is decorative); swell pedal; tonewheel wear modes, keyboard trigger point, rotary tuning',
      'Synth Extern mode and MIDI out; arpeggiator pattern editing, zig-zag, accent, pan, KB Hold exclude; Filter / LFO / Arp Group modes; synth preset library and sample downloads',
    ],
    optionalNotImplemented: [
      'Solo and Undo (the Solo button is decorative), Prog View modes (the Prog View button is decorative), list sorting and categories',
      'Synth Samples mode (the Mode button is decorative; the Synth is always in Analog mode)',
      'Percussion poly; piano model list; soft and sostenuto pedals',
    ],
    controls: UNSUPPORTED_CONTROLS,
    shiftCombinationsThatOnlyReport: UNSUPPORTED_FUNCTIONS,
  },
  platformBoundaries: {
    definition: 'src/platform/types.ts',
    browserBinding: 'src/platform/browser.ts',
    injected: [
      'audio (AudioContext, worklet node, worklet URL, sample-file loader)',
      'midi (requestMIDIAccess)',
      'events (keyboard, blur, visibility, resize, viewport)',
      'timing (now, setTimeout, clearTimeout; tap tempo and Master Clock taps use now)',
      'storage (getItem, setItem; programs and Live slots)',
    ],
    testDoubles:
      'tests/support/fakes.ts and tests/support/rig.ts. The fake worklet node hosts the real DSP kernel and the fake sample loader reads the real bundled files from public/samples; the rig wires the real panel store, binder, canonical store, and kernel without React. Tests measure real rendered audio without network, devices, or audio output.',
  },
  storage: {
    keys: ['stage4.keyboard.baseNote', 'stage4.programs.v1'],
    purpose:
      'The computer-keyboard octave, and the program memory: only slots that have been stored to (and Live slots that have been edited) are written; untouched slots keep their factory content. Everything read back is validated field by field before it is loaded.',
  },
  programs: {
    slots: 32,
    liveSlots: 8,
    factoryPrograms: FACTORY_NAMES,
    note: 'The factory programs are this project\'s own; none is Nord factory content. The first 16 are hand-made; the other 16 are Init programs (the start-up piano) ready to be overwritten. The Live slots start as copies of page 1.',
    stateSchema: 'src/state/model.ts: ProgramData = the PROGRAM_KEYS of StageState (name, organ, piano, synth, fx, rotary, split, scene, morph, clock, transpose). Master Level, the wheel, the pedal, the pitch stick, and the editing pages are not stored.',
  },
  evidence: {
    captures: [
      'evidence/stage3-desktop.png',
      'evidence/stage3-narrow.png',
      'evidence/stage3-organ-synth-on.png',
      'evidence/stage3-capture.json',
      'evidence/stage3-browser-pass.json',
    ],
    inherited: [
      'evidence/stage1-desktop.png',
      'evidence/stage1-narrow.png',
      'evidence/stage1-capture.json',
      'evidence/stage1-visual-audit.md',
      'evidence/stage2-desktop.png',
      'evidence/stage2-narrow.png',
      'evidence/stage2-effects-on.png',
      'evidence/stage2-capture.json',
      'evidence/stage2-visual-audit.md',
    ],
    visualAudit: 'evidence/stage3-visual-audit.md',
    captureScript: 'scripts/capture-stage3.js',
    captureMethod:
      'A real Chromium (Playwright) against `vite preview` of the production build, driven through scripts/capture-stage3.js. The parent capture harness named in prompts/stage3.md is outside the workspace and was not reachable. The snippet has no file-system access: Playwright wrote the screenshots and the report it returned was saved as evidence/stage3-browser-pass.json.',
  },
  knownDeviations: [
    'Layer buttons: a press turns an off layer on (and focuses it), focuses an on layer, or turns the focused layer off. The instrument uses "press both" and "hold" gestures for on/off; those do not work with one mouse pointer or a screen reader.',
    'Hold gestures work (a press of half a second or more on Split, Mst Clk, or Transp opens its page; a Morph Assign button assigns while it is held and another control is moved), and each also has a way in for a single pointer or a screen reader: Shift + Split opens the Keyboard Split page; a plain press of Mst Clk opens the tempo page and also counts as a tap; a plain press of Transp switches it on and opens its page; a plain press of a Morph Assign button latches it (the instrument latches on a double-tap). Shift + Octave Shift is KB Zone as printed.',
    'Morph Assign: while a source is latched, a destination control shows that source\'s end value so it can be adjusted from there; unlatched, it shows the stored (start) value again.',
    'Store: while a destination is being chosen, the keys play the program stored there (auditioning), as on the instrument. Naming uses the dial and the Page buttons; there is no held ABC soft button, and no categories.',
    'The edited indicator is a comparison with the stored program, so turning a control back to its stored position clears it; on the instrument it stays lit until the program is stored or reloaded.',
    'Program Page buttons wrap from page 4 to page 1; the dial stops at 1.1 and 4.8.',
    'Split crossfades are linear in gain (0.5 at the split point). The split points keep their order: the dial skips positions that would cross a neighbouring point.',
    'Organ: the Vibrato/Chorus type is shared by both layers and On is per layer, for every model; percussion settings are per layer. On Vox and Farf the selector is a plain vibrato (the C positions add the dry signal); on the pipe models it detunes. Tonewheel leakage and crosstalk are not modelled.',
    'Organ rotary routing does not depend on Layer Effects On.',
    'Synth: Analog mode only. Envelope times are set in 41 dial steps (attack 0.5 ms to 10 s, decay and release 3 ms to 20 s; the last decay step is sustain). The arpeggiator Range is whole octaves 1-4, not thirds of an octave. Mono mode glides between detached notes; Legato only between overlapping ones. Arpeggiator steps sound for 60 % of their length; a gate is open for half of each step.',
    'Master Clock subdivisions are 1/2, 1/4, 1/4T, 1/8, 1/8T, 1/16, 1/16T for every synced function. A synced Delay is limited to the 1.5 s maximum delay time.',
    'Fast mode: turning the Compressor Amount knob with Shift held switches Fast on (clockwise) or off (anticlockwise). The same gesture locks a Rate or Tempo knob to the Master Clock.',
    'Tap tempo sets the delay time from the last two taps; the Tempo knob moves to the nearest position.',
    'Delay Tempo range is 20 ms to 1.5 s; LFO rates, the Ring Mod pitch range, filter cutoff range, and compressor law are this implementation\'s choices, documented in src/audio/dsp/params.ts and effects.ts.',
    'Soft Release lengthens the damper release for electric models too; the instrument instead dampens their release noise.',
    'Clav has the four acoustic Timbre settings, not the Clavinet rocker-switch EQ set.',
    'Legend typefaces are system condensed/extended sans-serifs chosen to resemble the panel printing; they are not Nord\'s fonts. The photo\'s perspective is flattened to an orthographic top view.',
  ],
}

writeFileSync(join(ROOT, 'IMPLEMENTATION_DETAILS.json'), `${JSON.stringify(details, null, 2)}\n`)
console.log(`IMPLEMENTATION_DETAILS.json: ${sampleSources.reduce((sum, source) => sum + source.files.length, 0)} sample files declared`)
