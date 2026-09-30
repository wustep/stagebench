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
  phase: 3,
  audio: {
    strategy:
      'One AudioContext for the whole instrument. Piano layers A/B, Organ layers A/B and Synth layers A/B/C are sound sources; each has a bus/level and enters the Layer Effects chains: Piano A, Piano B, one shared Organ chain (Organ A and B mix into it after their own level and vibrato/chorus) and Synth A, B, C each have their own chain: source → Mod 1 → Mod 2 → Delay → Amp Sim/EQ → Compressor → Reverb → layer level → master gain → soft clip → limiter → destination; chains routed to the Rotary (Organ button, or "To Rotary" on any chain) pass through the one shared Rotary. Grand, Upright and Electric play bundled RECORDED sample sets (Ogg Vorbis, offline, several root notes and velocity layers). Clav, Digital, Misc, the four organ models and the whole synth are LIVE SYNTHESIS (oscillators, periodic waves, wave shapers, filters); they use no recordings. While a recorded set is loading, or if it fails to load or decode, notes play a labelled fallback: the GENERATED additive-synthesis buffers, and a plain oscillator if buffers cannot be created at all. Every effect is real Web Audio processing of the layer signal; reverb uses GENERATED impulse responses (not recordings). The program system (32 programs, 8 Live slots, splits, scenes, morphs, master clock) is state, not audio: the morph-resolved state drives one graph.',
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
      {
        name: 'Noise and click buffers (generated)',
        kind: 'generated-buffer',
        isRecording: false,
        implementation: 'src/audio/organ/engine.ts noiseBuffer(); src/audio/synth/tables.ts Tables.noise()',
        coverage: 'a 0.4 s xorshift noise buffer (organ key click and pipe chiff: band-passed, 12-60 ms, a different start point per note) and 2 s of seeded white noise (the synth White Noise waveform, looped)',
        license: 'Original code written for this benchmark; no third-party audio',
        notes: 'Deterministic pseudo-random noise. Not recordings of a keybed, a pipe or anything else.',
      },
      {
        name: 'Periodic waves, shaper curves and LFO tables (generated)',
        kind: 'generated-table',
        isRecording: false,
        implementation: 'src/audio/organ/spectra.ts; src/audio/synth/tables.ts',
        coverage: 'organ registrations as Fourier series (sine drawbar partials, Vox odd-harmonic squares, Farfisa registers, pipe ranks), synth pulse waves, hard-sync wave-shaper curves, drive curves, LFO cycles (including a fixed 8-step Sample & Hold sequence)',
        license: 'Original code written for this benchmark; no third-party audio',
        notes: 'Computed from formulas at run time.',
      },
    ],
    liveSynthesis: [
      { name: 'Organ B3', kind: 'live-synthesis', isRecording: false, implementation: 'src/audio/organ/engine.ts + spectra.ts', description: 'One periodic-wave oscillator per note carrying nine sine partials at 16/5⅓/8/4/2⅔/2/1⅗/1⅓/1 feet (3 dB per drawbar step), B3 percussion (decaying 2nd or 3rd harmonic, single-triggered) and a fixed-level random key-click noise burst', license: 'Original code written for this benchmark; no third-party audio' },
      { name: 'Organ B3 Bass', kind: 'live-synthesis', isRecording: false, implementation: 'src/audio/organ/engine.ts', description: 'The B3 engine limited to the 16-foot and 8-foot drawbars (the spec allows reuse)', license: 'Original code' },
      { name: 'Organ Vox', kind: 'live-synthesis', isRecording: false, implementation: 'src/audio/organ/spectra.ts', description: 'Seven register partials of hollow odd-harmonic squares, then two mix drawbars that blend a 900 Hz low-passed path and the bright path', license: 'Original code' },
      { name: 'Organ Farf', kind: 'live-synthesis', isRecording: false, implementation: 'src/audio/organ/spectra.ts', description: 'Nine register switches (on past half): 16-foot bass, 8/4/2-foot flutes, strings, oboe, trumpet, brilliant and bass squares', license: 'Original code' },
      { name: 'Organ Pipe 1 / Pipe 2', kind: 'live-synthesis', isRecording: false, implementation: 'src/audio/organ/spectra.ts', description: 'Nine ranks (16-foot to 1-foot plus a mixture) with a principal spectrum and a breath-noise chiff on the attack; Pipe 2 (the spec allows reuse) has a brighter principal spectrum', license: 'Original code' },
      { name: 'Organ vibrato / chorus', kind: 'live-synthesis', isRecording: false, implementation: 'src/audio/organ/engine.ts', description: 'A 6.8 Hz swept 0.8 ms delay line; V1-V3 use only the swept path (6, 12, 20 cents), C1-C3 mix it with the original', license: 'Original code' },
      { name: 'Synth engine (Analog mode)', kind: 'live-synthesis', isRecording: false, implementation: 'src/audio/synth/*', description: 'Fourteen waveforms in five categories (Pure, Sync via a wave-shaper hard-sync, Multi, Super, FM-H), LP12/LP24/HP/BP filters with tracking, resonance and drive, three envelopes, an LFO, poly/mono/legato voices with glide and unison, vibrato, and a clock-locked arpeggiator/gate', license: 'Original code written for this benchmark; no third-party audio' },
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
      'Effect focus follows layer focus in all three sections; the Piano FX FOCUS button swaps A/B, the Organ button focuses the one shared organ chain, the Synth button steps A, B, C; Shift or a long press toggles group mode (Piano, Synth); Delay, Compressor and Reverb have Global (also Shift + ON) reaching all six chains. "To Rotary" only routes while the Amp/EQ unit is switched on; the Organ ORGAN button routes the shared organ chain regardless.',
      'The Layer Effects ON button bypasses every unit including the Rotary routing. Bypass and parameter changes are ramped over 20 ms.',
      'Layer buttons follow manual p. 23 for Piano, Organ and Synth: tap = focus / switch, hold 0.5 s = turn off (the last layer cannot be turned off), press two together or Shift+press = add. A layer button of a section that is off switches the section on. A key uses one voice per enabled layer, up to 24 note-lifecycle voices; the Organ and Synth engines have their own caps (32 organ voices, 8 per synth layer / 24 total).',
      'Organ: layer level is applied before the shared organ chain (a documented deviation: the two layers must be mixed before they can share effects). Organ keys are not velocity sensitive. Key click is always on for B3 and B3 Bass (the spec gives it a fixed level and no control). Tonewheel foldback, leakage and wear are not modelled.',
      'Synth: only Analog mode exists (Samples is optional and not built, Extern is excluded; the MODE selector stays on Analog). See src/audio/synth/*.test.ts for the measured behaviour; approximations are listed in IMPLEMENTATION_PLAN.md (known gaps).',
      'Programs: 32 program slots and 8 Live slots are plain JSON (the whole canonical state minus Master Level, wheel, pitch stick, control pedal and solo), persisted in localStorage when available; 21 factory programs are built from the same reducers the panel uses. Morphs, splits, scenes, master clock and transpose are part of a program. Live slots store every edit automatically.',
      'Master Clock (30-300 BPM, tap or dial) locks the arpeggiator/gate, the synth LFO, the Delay and Mod 1 (LFO types only; Ring Mod and A-Wah have no LFO) when their rate knob has been set with Shift held. External MIDI clock and pedal tap are excluded.',
      'Unsupported (spec-excluded, listed in the app under "Unsupported controls" and in IMPLEMENTATION_PLAN.md): pedal noise, half-pedaling, per-type Variations, Reverb Chorale, Delay feedback-loop effects and Analog mode, Mod 1 pedal modes, Rotary close mic and stop angle, Organ Preset/Sync, aftertouch morph, pedal tap, the preset library, Section Edit, Copy/Paste, arpeggiator pattern/group, LFO and filter group modes, Keep Edits, Exclude, Shift menus. Their controls exist, move and do nothing.',
      'Ogg Vorbis decoding is required for the recorded sets. A browser that cannot decode it, or a missing file, produces the labelled fallback state ("Piano not found … Fallback voice"), the type LED flashes, and the app stays playable.',
      'Web Audio nodes: one AudioContext; oscillator LFOs are only created for units that have been switched on (including the organ vibrato sweep); retired effect branches are disposed after a 60 ms crossfade; dispose() disconnects and stops everything, including the organ and synth engines, the arpeggiator timer chain and the program system.',
      'Tests render the real engine on node-web-audio-api (OfflineAudioContext, dev dependency): decoded recordings, effects, controls and pedals are asserted through the rendered signal, not through fakes.',
    ],
  },
}

writeFileSync(resolve(root, 'IMPLEMENTATION_DETAILS.json'), JSON.stringify(details, null, 2) + '\n')
console.log(`wrote IMPLEMENTATION_DETAILS.json: ${sampleSources.reduce((n, s) => n + s.files.length, 0)} sample files`)
