# Bundled Piano and Synth sample sets — sources and licenses

All audio in this directory is **recorded sample material** obtained exclusively
through the npm registry, bundled here so the built application plays fully
offline. `manifest.json` lists every file with its root note and velocity layer.
Regenerate with `node scripts/sync-samples.mjs`.

## 1. `grand/` — "Salamander Grand" (type: Grand)

- **What**: Salamander Grand Piano V3 — a Yamaha C5 acoustic grand recorded by
  Alexander Holm; 30 root notes (A, C, D#, F# of each octave, A0–C8) ×
  3 recorded velocity layers (Salamander's layers 4, 8 and 13 of 16),
  90 mp3 files renamed `<note>-l<layer>.mp3`.
- **Source chain**: archive.org/details/SalamanderGrandPianoV3 → npm packages
  `@audio-samples/piano-mp3-velocity4`, `-velocity8`, `-velocity13` (v1.0.5).
- **License**: Creative Commons Attribution 3.0 (CC BY 3.0).
  **Attribution: "Salamander Grand Piano V3" by Alexander Holm, CC BY 3.0.**

## 2. `upright/` — "Tack Upright" (type: Upright)

- **What**: General MIDI "Honky-tonk Piano" program — a detuned tack-upright
  piano character; 19 root notes (C, E, Ab of each octave) × 1 velocity layer.
- **Source chain**: MIDI-JS Soundfonts collection
  (github.com/gleitz/midi-js-soundfonts, Benjamin Gleitzman) → npm package
  `web-music-score-samples` v3.0.0, folder `samples/003-honkytonk-piano`.
- **License**: MIT (both the MIDI-JS Soundfonts collection and the npm
  repackaging). The collection is rendered from the FluidR3_GM / MusyngKite /
  FatBoy soundfont banks; the packaging does not identify which bank produced
  these renders — this uncertainty is declared rather than papered over.

## 3. `electric/` — "Tine EP" (type: Electric)

- **What**: General MIDI "Electric Piano 1" program — tine/electromechanical
  electric piano character; 19 root notes × 1 velocity layer.
- **Source chain / license**: identical to `upright/` above, folder
  `samples/004-electric-piano-1`.

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

- **What**: General MIDI "Harpsichord" program — a plucked-string
  harpsichord character (the spec's Clav source rule allows clavinet or
  harpsichord; this is a SECOND, audibly distinct Clav-type model alongside
  `clav/`, spec.scope.optional "More than one model per type and the model
  list view"); 19 root notes × 1 velocity layer.
- **Source chain**: MIDI-JS Soundfonts collection
  (github.com/gleitz/midi-js-soundfonts, Benjamin Gleitzman) → npm package
  `web-music-score-samples` v3.0.0, folder `samples/006-harpsichord`.
- **License**: MIT (both the MIDI-JS Soundfonts collection and the npm
  repackaging). The collection is rendered from the FluidR3_GM / MusyngKite /
  FatBoy soundfont banks; the packaging does not identify which bank produced
  these renders — this uncertainty is declared rather than papered over.

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
- The Grand crossfades its three recorded velocity layers. The nine other
  GM-derived sets (seven Piano-type models plus Strings/Choir) have a single
  recorded layer each; their velocity response is shaped by gain and a
  velocity-keyed filter in the engine and is declared as such.
- The two Synth sample sets are a SEPARATE library (SYNTH_SAMPLE_SETS) from
  the Piano types (INSTRUMENTS) — they are never selectable as a Piano
  model, and selecting them is only possible through the Synth section's
  Samples mode (spec.scope.optional).
- Everything else that sounds (synthesized fallback voice, generated reverb
  impulse responses, pedal-noise thump, all effect processing, and the Synth
  section's Analog-mode oscillators/filter/LFO — see IMPLEMENTATION_DETAILS.json's
  generatedSources) is generated DSP, declared in IMPLEMENTATION_DETAILS.json,
  and never presented as a recording.
