# Bundled Piano and Synth sample sets — sources and licenses

All audio in this directory is **recorded sample material**, bundled here so
the built application plays fully offline. Sets are obtained either through
the npm registry (`scripts/sync-samples.mjs`) or fetched from pinned GitHub
commits and re-encoded to MP3 (`scripts/fetch-samples.mjs`, which writes
`fetched.json`). `manifest.json` lists every file with its root note and
velocity layer; regenerate it with `node scripts/sync-samples.mjs`.

## 1. `grand/` — "Salamander Grand" (type: Grand)

- **What**: Salamander Grand Piano V3 — a Yamaha C5 acoustic grand recorded by
  Alexander Holm; 30 root notes (A, C, D#, F# of each octave, A0–C8) ×
  4 recorded velocity layers (Salamander's layers 4, 8, 13 and 16 of 16),
  120 mp3 files renamed `<note>-l<layer>.mp3`.
- **Source chain**: archive.org/details/SalamanderGrandPianoV3 → npm packages
  `@audio-samples/piano-mp3-velocity4`, `-velocity8`, `-velocity13`,
  `-velocity16` (v1.0.5).
- **License**: Creative Commons Attribution 3.0 (CC BY 3.0).
  **Attribution: "Salamander Grand Piano V3" by Alexander Holm, CC BY 3.0.**

## 2. `upright/` — "VS Upright" (type: Upright)

- **What**: "Upright Piano, Yamaha" (a.k.a. "VS Upright No. 1") from the
  Versilian Community Sample Library (VCSL), recorded by Versilian Studios;
  13 root notes (C and G of each octave, sounding C1–C7) × 3 recorded
  velocity layers (rr1 takes), 39 mp3 files renamed `<note>-l<layer>.mp3`.
  The sounding C6 root has no vl1 recording in VCSL; its l1 slot reuses the
  vl2 take (declared).
- **Source chain**: github.com/sgossner/VCSL @ `c1ea7bc`
  (`Chordophones/Zithers/Upright Piano, Yamaha/Sustains/`) → trimmed to 8 s
  and re-encoded to MP3 by `scripts/fetch-samples.mjs`. VCSL file names are
  written one octave below sounding pitch (verified by autocorrelation);
  root notes in `manifest.json` use the sounding pitch.
- **License**: Creative Commons Zero 1.0 (CC0) — Versilian Studios LLC.

## 3. `electric/` — "Rhodes Mk I" (type: Electric)

- **What**: jRhodes3d — Jeff Learman's 1977 Rhodes Mark I Stage 73 electric
  piano, recorded directly from the harp connector (mono); 15 root notes
  (every 4th white key, F1–C7) × 3 recorded velocity layers (chosen from the
  set's 5, favoring soft/mid/hard takes present at each root), 45 mp3 files
  renamed `<note>-l<layer>.mp3`.
- **Source chain**: github.com/sfzinstruments/jlearman.jRhodes3d @ `6b9fbd0`
  (`jRhodes3d-mono/*.flac`) → trimmed to 10 s and re-encoded to MP3 by
  `scripts/fetch-samples.mjs`.
- **License**: CC-BY-NC-4.0 — **non-commercial use only, attribution
  required: "jRhodes3d" sampled by Jeff Learman.**

## 4. `clav/` — "Clavinet" (type: Clav)

- **What**: General MIDI "Clavinet" program — plucked electro-mechanical
  clavinet character (the spec's Clav source rule allows clavinet or
  harpsichord); 19 root notes × 1 velocity layer.
- **Source chain / license**: identical to `upright/` above, folder
  `samples/007-clavinet`.

## 5. `digital/` — "FM Piano" (type: Digital)

- **What**: General MIDI "Electric Piano 2" program — FM/DX digital piano
  character; 19 root notes × 1 velocity layer.
- **Source chain / license**: identical to `upright/` above, folder
  `samples/005-electric-piano-2`.

## 6. `misc/` — "Vibraphone" (type: Misc)

- **What**: General MIDI "Vibraphone" program — mallet character (the spec's
  Misc source rule names marimba/vibraphone); 19 root notes × 1 velocity layer.
- **Source chain / license**: identical to `upright/` above, folder
  `samples/011-vibraphone`.

## 7. `synth-strings/` — "Strings" (Synth Samples mode, optional scope)

- **What**: General MIDI "String Ensemble 1" program — a bowed string-section
  character; 19 root notes (major-third spacing) × 1 velocity layer. Selected
  via the Synth section's Samples mode WAVE list (spec.scope.optional).
- **Source chain**: MIDI-JS Soundfonts collection
  (github.com/gleitz/midi-js-soundfonts, Benjamin Gleitzman) → npm package
  `web-music-score-samples`, folder `samples/048-string-ensemble-1`.
- **License**: MIT (both the MIDI-JS Soundfonts collection and the npm
  repackaging). The collection is rendered from the FluidR3_GM / MusyngKite /
  FatBoy soundfont banks; the packaging does not identify which bank produced
  these renders — this uncertainty is declared rather than papered over.

## 8. `synth-choir/` — "Choir" (Synth Samples mode, optional scope)

- **What**: General MIDI "Choir Aahs" program — a sustained vocal-pad
  character; 19 root notes × 1 velocity layer.
- **Source chain / license**: identical to `synth-strings/` above, folder
  `samples/052-choir-aahs`.

## 9. `harpsichord/` — "Harpsichord" (type: Clav, second model)

- **What**: "Harpsichord, French" from the Versilian Community Sample Library
  (VCSL), recorded by Versilian Studios — a plucked-string harpsichord (the
  spec's Clav source rule allows clavinet or harpsichord; this is a SECOND,
  audibly distinct Clav-type model alongside `clav/`, spec.scope.optional
  "More than one model per type and the model list view"); 28 root notes
  (sounding D1–C6) × 1 velocity layer (real harpsichords are not velocity
  sensitive), renamed `<note>.mp3`.
- **Source chain**: github.com/sgossner/VCSL @ `c1ea7bc`
  (`Chordophones/Zithers/Harpsichord, French/Sustains/`, rr1 takes) →
  trimmed to 8 s and re-encoded to MP3 by `scripts/fetch-samples.mjs`.
  VCSL file names are written one octave below sounding pitch (verified by
  autocorrelation); root notes in `manifest.json` use the sounding pitch.
- **License**: Creative Commons Zero 1.0 (CC0) — Versilian Studios LLC.

## 10. `marimba/` — "Marimba" (type: Misc, second model)

- **What**: General MIDI "Marimba" program — a mallet character (the spec's
  Misc source rule names marimba/vibraphone; this is a SECOND, audibly
  distinct Misc-type model alongside `misc/`, spec.scope.optional "More than
  one model per type and the model list view"); 19 root notes × 1 velocity
  layer.
- **Source chain**: MIDI-JS Soundfonts collection
  (github.com/gleitz/midi-js-soundfonts, Benjamin Gleitzman) → npm package
  `web-music-score-samples` v3.0.0, folder `samples/012-marimba`.
- **License**: MIT (both the MIDI-JS Soundfonts collection and the npm
  repackaging). The collection is rendered from the FluidR3_GM / MusyngKite /
  FatBoy soundfont banks; the packaging does not identify which bank produced
  these renders — this uncertainty is declared rather than papered over.

## Honesty notes

- The ten sets (eight Piano-type models — six types, with Clav and Misc each
  carrying a second model — plus the two Synth Samples-mode sets) are
  genuinely different recordings/programs, not one source under different
  labels.
- The Grand crossfades its four recorded velocity layers; the VS Upright and
  Rhodes Mk I crossfade their three. The remaining single-layer sets
  (Clavinet, FM Piano, Vibraphone, Marimba, Harpsichord, Strings, Choir)
  have one recorded layer each; their velocity response is shaped by gain
  and a velocity-keyed filter in the engine and is declared as such.
- The fetched sets (`upright/`, `electric/`, `harpsichord/`) are trimmed and
  re-encoded recordings of real instruments — declared processing of
  recorded material, not synthesis.
- The two Synth sample sets are a SEPARATE library (SYNTH_SAMPLE_SETS) from
  the Piano types (INSTRUMENTS) — they are never selectable as a Piano
  model, and selecting them is only possible through the Synth section's
  Samples mode (spec.scope.optional).
- Everything else that sounds (synthesized fallback voice, generated reverb
  impulse responses, pedal-noise thump, all effect processing, and the Synth
  section's Analog-mode oscillators/filter/LFO — see IMPLEMENTATION_DETAILS.json's
  generatedSources) is generated DSP, declared in IMPLEMENTATION_DETAILS.json,
  and never presented as a recording.
