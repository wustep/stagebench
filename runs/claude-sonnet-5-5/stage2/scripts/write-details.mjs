// Regenerates IMPLEMENTATION_DETAILS.json from src/audio/library/manifest.json (written by build-samples.py) so the
// declaration of every bundled file, root note, velocity layer, source and license can never drift from the shipped files.
//   node scripts/write-details.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(resolve(root, 'src/audio/library/manifest.json'), 'utf8'))

const sampleSources = manifest.models.map((m) => ({
  id: m.id,
  name: `${m.name} (${m.type})`,
  kind: 'recorded-sample-set',
  isRecording: true,
  source: m.sourceUrl,
  mirrorUrl: m.mirrorUrl ?? undefined,
  author: m.author,
  license: m.license,
  licenseUrl: m.licenseUrl,
  attribution: m.attribution,
  encoding: m.encoding,
  velocityLayers: m.layers.map((l) => l.velocity),
  rootNotesPerLayer: m.layers.map((l) => l.samples.length),
  files: m.layers.flatMap((l) => l.samples.map((s) => `public/samples/${s.file}`)),
  fileDetails: m.layers.flatMap((l) =>
    l.samples.map((s) => ({ file: s.file, rootNote: s.root, tuneCents: s.cents, velocityLayer: l.velocity, sampleRate: s.sampleRate, durationSeconds: s.durationSec, bytes: s.bytes, sourceFile: s.source })),
  ),
  notes: 'Real recordings. The only processing is: stereo → mono mix, trimming of leading offsets and of the tail beyond 7 s (with a fade), gain scaling, Ogg Vorbis encoding (scripts/build-samples.py). No looping, no synthesis, no pitch shifting inside the files; the engine plays them with a playback-rate shift of at most half the spacing between recorded roots.',
}))

const synth = (name, description) => ({ name, kind: 'live-synthesis', isRecording: false, implementation: 'src/audio/voices.ts startSynthVoice()', description, license: 'Original code written for this benchmark; no third-party audio' })

const details = {
  $schema: 'https://stagebench.local/schemas/implementation-details.schema.json',
  version: 1,
  phase: 2,
  audio: {
    strategy:
      'One AudioContext. Layer voices → layer bus → timbre EQ → Mod 1 → Mod 2 → Delay → Amp Sim/EQ → Compressor → Reverb → layer level → master gain → soft clip → limiter → destination; layers routed "To Rotary" pass through one shared Rotary between the layer level and the master gain. Grand, Upright and Electric play bundled RECORDED sample sets (Ogg Vorbis, offline, several root notes and velocity layers, levelled to one velocity curve). Clav, Digital and Misc are LIVE SYNTHESIS (oscillators + filters). While a recorded set is loading, or if it fails to load or decode, notes play a labelled fallback: the Phase 1 GENERATED additive-synthesis buffers (status "loading" / "fallback", never "ready"), and a plain oscillator if buffers cannot be created at all. Every effect is real Web Audio processing of the layer signal; reverb uses GENERATED impulse responses (not recordings).',
    sampleSources,
    generatedSources: [
      {
        name: 'Additive piano fallback voice (generated buffers)',
        kind: 'generated-buffer',
        isRecording: false,
        implementation: 'src/audio/pianoDsp.ts renderPianoNote()',
        sampleRate: 32000,
        coverage: 'MIDI 21-108, buffers created lazily per note and velocity layer (24/56/88/116), LRU cache of 48',
        license: 'Original code written for this benchmark; no third-party audio',
        notes: 'Only used as the stand-in while recorded samples load and as the fallback when they cannot be loaded. Not a recording of any instrument.',
      },
      {
        name: 'Reverb impulse responses (generated buffers)',
        kind: 'generated-buffer',
        isRecording: false,
        implementation: 'src/audio/effects/reverb.ts makeImpulseResponse()',
        coverage: 'Room, Booth, Spring, Stage, Hall, Cathedral: decaying low-passed noise with early reflections; Spring is a train of dispersed downward chirps',
        license: 'Original code written for this benchmark; no third-party audio',
        notes: 'Deterministic (seeded PRNG). Not measurements of real spaces or springs.',
      },
    ],
    liveSynthesis: [
      synth('Clav A (neck pickup)', 'Two detuned sawtooth oscillators, plucked envelope, sweeping low-pass, neck-pickup low-pass colouring'),
      synth('Clav B (bridge pickup)', 'As Clav A with bridge-pickup high-pass and 3.4 kHz peak'),
      synth('Clav C (both pickups in phase)', 'Neck and bridge colouring summed'),
      synth('Clav D (pickups out of phase)', 'Bridge colouring with a 900 Hz high-pass: the fundamental is almost cancelled'),
      synth('Digital FM E.P.', 'Two-operator FM (1:1) with a decaying index plus a short 14:1 tine transient'),
      synth('Layered Piano + Pad', 'Additive sine partials layered with a slow-attack detuned triangle pad'),
      synth('Marimba', 'Sine partials at 1 : 3.93 : 9.9 with short decays that shorten up the keyboard'),
      synth('Vibraphone', 'Sine partials at 1 : 4 : 10.1, long decays, 5.2 Hz motor tremolo'),
      { name: 'Oscillator fallback voice', kind: 'live-synthesis', isRecording: false, implementation: 'src/audio/voices.ts startOscillatorVoice()', license: 'Original code' },
      { name: 'Effect LFOs and processors', kind: 'live-synthesis', isRecording: false, implementation: 'src/audio/effects/*', description: 'Oscillator LFOs, delay lines, biquad filters, wave shapers, convolution and dynamics nodes process the layer signal; none of them is an audio source', license: 'Original code' },
    ],
    notes: [
      'Nothing generated or synthesised is described as a recording: only the four "recorded-sample-set" entries in sampleSources are recordings.',
      'Grand: Salamander Grand Piano V3 (CC BY 3.0, Alexander Holm) — 30 roots (every minor third) × 3 of its 16 velocity layers. Upright: Upright Piano KW (CC0) — its two velocity layers. Electric: Wurlitzer EP200 and Hohner Pianet T (CC BY 3.0, Greg Sullivan). Attribution text for each set is in its sampleSources entry and reproduced in the app source (src/audio/library/manifest.json).',
      'The Wurlitzer EP200 map is the author’s: its softest layer has roots up to 11 semitones apart, so some notes are shifted by up to ±6 semitones (audible as a changed timbre). Other layers and models are denser.',
      'Recorded release samples (hammer noise, pedal-down resonance samples) are not used. String Res is SIMULATED sympathetic resonance: quiet, slow-attack copies of harmonically related strings are added. Pedal noise and half-pedaling are excluded features.',
      'Soft pedal and sostenuto are NOT implemented (optional in the spec); the sustain pedal is full on/off. SUSTPED and PSTICK are per layer. The pitch stick bends layers with PSTICK on by ±2 semitones (source detune).',
      'KB Touch (Heavy/Medium/Light) reshapes the key velocity before it selects the recorded layer and level. Dyn Comp raises the level of soft strokes without changing which layer (timbre) is chosen. Timbre, Unison, Soft Release, String Res and Master Level are all rendered by the audio engine; Soft Release is unavailable for Clav, String Res only for Grand/Upright, Dyno 1/2 only for Electric (the panel snaps back).',
      'Amp models (Small, JC, Twin) are documented approximations: distinct voicing filters + clipping curves + speaker roll-off, not circuit models. Phaser "feedback colour" is approximated by a higher all-pass Q (a feedback loop without a delay node is not allowed in Web Audio). Mod 1 Wah/A-Wah/Pump/RM/Trem/A-Pan and Mod 2 Chorus/Flanger/Phaser/Vibe/Ensemble/Spin are real signal processors of the layer signal.',
      'Signal-order deviation: the layer level sits before the shared Rotary (the rotary is one instance, so layer levels have to be applied per layer before their signals are summed into it). Reverb still precedes the Rotary and everything reaches the destination through the master gain, soft clip and limiter.',
      'Effect focus follows layer focus; the Piano FX FOCUS button swaps A/B, Shift or a long press toggles group mode; Delay, Compressor and Reverb have Global (also Shift + ON). Organ/Synth effect focus buttons do not change anything in this phase (their LEDs never light). "To Rotary" only routes while the Amp/EQ unit is switched on.',
      'The Layer Effects ON button bypasses every unit including the Rotary routing. Bypass and parameter changes are ramped over 20 ms.',
      'Layer buttons follow manual p. 23: tap = focus / switch, hold 0.5 s = turn off (the last layer cannot be turned off), press both together or Shift+press = add. Both layers together use up to 24 voices in total (a key uses one voice per enabled layer).',
      'Decorative in this phase (move and light, do nothing, annotated in the accessibility tree): all Organ, Synth and Program controls, the modulation wheel, KB ZONE, AUX KB, SOLO, INFO/MODEL LIST, the rotary ORGAN / STOP MODE / CLOSE MIC buttons.',
      'Unsupported (spec-excluded): pedal noise, half-pedaling, Triple Pedal, size classes/INFO, preset library, per-type Variations, Reverb Chorale, Delay feedback-loop effects (Chor/Vibe/Ens/Flam/Space) and Analog mode, Mod 1 Pump/Wah pedal modes, Rotary close mic and stop angle. Their controls exist, move and do nothing.',
      'Master Clock sync of LFO/Delay is Phase 3 and not implemented; Delay tap tempo and the tempo knob agree (tap sets the knob).',
      'Ogg Vorbis decoding is required for the recorded sets. A browser that cannot decode it, or a missing file, produces the labelled fallback state ("Piano not found … Fallback voice"), the type LED flashes, and the app stays playable.',
      'Web Audio nodes: one AudioContext; oscillator LFOs are only created for units that have been switched on; retired effect branches are disposed after a 60 ms crossfade; dispose() disconnects and stops everything.',
      'Tests render the real engine on node-web-audio-api (OfflineAudioContext, dev dependency): decoded recordings, effects, controls and pedals are asserted through the rendered signal, not through fakes.',
    ],
  },
}

writeFileSync(resolve(root, 'IMPLEMENTATION_DETAILS.json'), JSON.stringify(details, null, 2) + '\n')
console.log(`wrote IMPLEMENTATION_DETAILS.json: ${sampleSources.reduce((n, s) => n + s.files.length, 0)} sample files`)
