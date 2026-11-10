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

const details = {
  $schema: 'https://stagebench.local/schemas/implementation-details.schema.json',
  version: 1,
  phase: 2,
  variant: 'stage-4-73',
  audio: {
    strategy:
      'One AudioContext and one output node. A TypeScript DSP kernel (src/audio/dsp/stage.ts) runs in an AudioWorklet, or in a ScriptProcessorNode when the worklet is unavailable. ' +
      'Grand, Upright, and Electric play bundled recordings (198 FLAC files, 12 MB, decoded by the app\'s own FLAC decoder). ' +
      'Clav, Digital, and Misc are live additive synthesis and are labelled as synthesis in the model name, on the Program display, and in the status console. ' +
      'If a sample set cannot be loaded, its layer plays a synthesized stand-in voice labelled "Fallback Synth Piano", the type LED flashes, and the audio status reads Fallback, never Ready. ' +
      'All effects are computed live in the kernel; no impulse responses or other audio buffers are bundled or generated.',
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
        usedBy: 'Both Piano layers.',
        description:
          'Biquad and state-variable filters, modulated delay lines, a comb/all-pass reverb, an all-pass-chain spring model, waveshapers, an envelope-following compressor, and a two-rotor Doppler/tremolo model. The Twin, JC, and Small amplifier models are tone-shaping approximations (fixed EQ, a drive curve, cabinet band limits), not circuit models.',
        files: ['src/audio/dsp/effects.ts', 'src/audio/dsp/stage.ts'],
        license: 'Original code written for this candidate.',
      },
    ],
    notes: [
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
    midi: 'Web MIDI, enabled by an explicit button. Note on/off with velocity on any channel, sustain CC64, CC120/CC123.',
    sustain:
      'Space, MIDI CC64, and an on-screen latching pedal button below the instrument. The pedal reaches the Piano only while SUSTPED is on.',
    shift:
      'Hold either panel Shift button (touch, or keyboard focus) or the computer Shift key while operating a control. A single click on a panel Shift button latches Shift for the next control.',
  },
  functionalInThisPhase: {
    piano: [
      'Piano section On/Off',
      'Layers A and B: on/off, focus, level fader, octave shift (-1..+1)',
      'SUSTPED (Shift + Layer A) and PSTICK (Shift + Layer B; pitch stick bends +/-2 semitones)',
      'Type button (six types) and Model dial',
      'KB Touch (Medium / Light / Heavy), Dyn Comp (Off/1/2/3), Timbre (Off/Soft/Mid/Bright, plus Dyno 1/Dyno 2 for electric models), Unison (Off/1/2/3)',
      'Acoustics: Soft Release and String Res',
    ],
    effects: [
      'Layer Effects On (all-effects bypass)',
      'FX Focus Piano (A/B) and Group (Shift + FX Focus Piano)',
      'Mod 1: A-Pan, Tremolo, Ring Mod, A-Wah, Wah, Pump; Rate/Sens, Amount, On',
      'Mod 2: Phaser, Flanger, Chorus, Vibe, Ensemble, Spin; Rate, Amount, On',
      'Delay: Tempo, Tap, Feedback, Dry/Wet, feedback Filter Off/LP/BP/HP, Ping Pong (Shift + Filter), On, Global (Shift + On)',
      'Amp Sim/EQ: EQ only, Twin, JC, Small, LP24, HP24, To Rotary; Drive, Bass, Mid/Res, Freq, Treble, On',
      'Compressor: Amount, Fast (Shift + Amount), On, Global, ACTIVE LED',
      'Reverb: Spring, Booth, Room, Stage, Hall, Cathedral; Bright/Dark, Dry/Wet, On, Global',
      'Rotary Speaker: Slow/Fast, Stop Mode, Drive (reached with To Rotary)',
    ],
    other: ['Master Level', 'All notes off (also clears every effect tail)', 'Sustain input', 'Audio, MIDI, and piano-library status'],
  },
  optionalFeatures: {
    implemented: [
      'More than one model for Clav (2) and Misc (2); the other types have one model each',
      'Delay Ping Pong',
      'Rotary Stop Mode',
    ],
    notImplemented: [
      'Model list view',
      'Soft pedal and sostenuto pedal (no input exists for them and nothing claims them)',
      'Pedal-down string resonance samples (resonance is simulated instead)',
    ],
  },
  decorativeInThisPhase: {
    summary:
      'Organ, Synth, and Program controls, plus the few controls listed under unsupported, move or press and are stored as presentation state only. They change no audio, no canonical state, and no display text.',
    howItIsEnforced:
      'Panel positions live in src/hardware/store.ts, which imports nothing from audio, input, platform, or state. Only the IDs in src/hardware/functional.ts are read by the binder (src/state/binding.ts). tests/interaction.decorative-controls.test.tsx operates every other control and proves the rendered audio is bit-identical and nothing is sent to the audio host.',
    initialPanelState:
      'Knob, fader, drawbar, and selector positions are those on the reference photo. Deliberate differences, so that the panel never shows something that is not happening: Piano Layer B starts off; every effect unit starts off; the Synth FX Focus LEDs and the Delay feedback-effect LEDs start dark; the Variation, Chorale, and Ped Noise LEDs are never lit; the Rotary ON LED is lit only while a layer is routed to the Rotary.',
    oleds:
      'Program OLED: Piano layer summary, the focused layer\'s model name, whether it is recorded or synthesized (or the fallback), audio/MIDI/sustain/voice status, and the last panel action. It shows no program name or number. Synth OLED: "Not active - Phase 2 - no synth engine - panel is decorative".',
  },
  unsupported: {
    excludedBySpec: [
      'Pedal noise and half-pedaling; Nord Triple Pedal modelling; piano size classes, INFO view, Sound Manager; piano preset library',
      'Per-type Variations and Reverb Chorale; Delay feedback-loop effects (the Delay Effects selector is decorative) and Analog mode; Mod 1 Pump/Wah pedal modes; Rotary close mic and stop angle; Global Reverb after the Rotary',
    ],
    laterPhases: [
      'Organ and Synth engines and their effect chains (FX Focus Organ and FX Focus Synth are decorative)',
      'Rotary Organ routing button (decorative until there is an Organ)',
      'Programs, Live mode, splits and KB zones, layer scenes, morphs, master clock (and MST CLK sync of Mod 1 and Delay), transpose',
      'Modulation wheel and aftertouch as performance inputs',
    ],
    shiftCombinationsThatOnlyReport:
      'Shift + Type (Info), Shift + Acoustics (Ped Noise), Shift + Octave Shift (KB Zone), Shift + effect selector (Variation), Shift + Tap (Analog), Shift + Stop Mode (Angle), Shift + Model dial (List): each writes "not available" on the Program display and changes nothing.',
  },
  platformBoundaries: {
    definition: 'src/platform/types.ts',
    browserBinding: 'src/platform/browser.ts',
    injected: [
      'audio (AudioContext, worklet node, worklet URL, sample-file loader)',
      'midi (requestMIDIAccess)',
      'events (keyboard, blur, visibility, resize, viewport)',
      'timing (now, setTimeout, clearTimeout; tap tempo uses now)',
      'storage (getItem, setItem)',
    ],
    testDoubles:
      'tests/support/fakes.ts. The fake worklet node hosts the real DSP kernel and the fake sample loader reads the real bundled files from public/samples, so tests measure real rendered audio from the real recordings without network, devices, or audio output.',
  },
  storage: {
    keys: ['stage4.keyboard.baseNote'],
    purpose: 'Remembers the computer-keyboard octave. Panel state is not persisted (programs are Phase 3).',
  },
  evidence: {
    captures: [
      'evidence/stage2-desktop.png',
      'evidence/stage2-narrow.png',
      'evidence/stage2-effects-on.png',
      'evidence/stage2-capture.json',
    ],
    inherited: [
      'evidence/stage1-desktop.png',
      'evidence/stage1-narrow.png',
      'evidence/stage1-capture.json',
      'evidence/stage1-visual-audit.md',
    ],
    visualAudit: 'evidence/stage2-visual-audit.md',
    captureScript: 'scripts/capture-stage2.js',
    captureMethod:
      'Playwright (Chromium) against `vite preview` of the production build. The parent capture harness named in prompts/stage2.md is outside the workspace and was not reachable, so the captures were produced with the script above.',
  },
  knownDeviations: [
    'Layer buttons: a press turns an off layer on (and focuses it), focuses an on layer, or turns the focused layer off. The instrument uses "press both" and "hold" gestures for on/off; those do not work with one mouse pointer or a screen reader.',
    'Fast mode: turning the Compressor Amount knob with Shift held switches Fast on (clockwise) or off (anticlockwise).',
    'Tap tempo sets the delay time from the last two taps; the Tempo knob moves to the nearest position.',
    'Delay Tempo range is 20 ms to 1.5 s; LFO rates, the Ring Mod pitch range, filter cutoff range, and compressor law are this implementation\'s choices, documented in src/audio/dsp/params.ts and effects.ts.',
    'Soft Release lengthens the damper release for electric models too; the instrument instead dampens their release noise.',
    'Clav has the four acoustic Timbre settings, not the Clavinet rocker-switch EQ set.',
    'Legend typefaces are system condensed/extended sans-serifs chosen to resemble the panel printing; they are not Nord\'s fonts. The photo\'s perspective is flattened to an orthographic top view.',
  ],
}

writeFileSync(join(ROOT, 'IMPLEMENTATION_DETAILS.json'), `${JSON.stringify(details, null, 2)}\n`)
console.log(`IMPLEMENTATION_DETAILS.json: ${sampleSources.reduce((sum, source) => sum + source.files.length, 0)} sample files declared`)
