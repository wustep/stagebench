# Bundled Piano sample sets — sources and licenses

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

## Honesty notes

- The three sets are three genuinely different recordings/programs, not one
  source under three labels.
- The Grand crossfades its three recorded velocity layers. The Upright and
  Electric sets have a single recorded layer; their velocity response is shaped
  by gain and a velocity-keyed filter in the engine and is declared as such.
- Everything else that sounds (synthesized fallback voice, generated reverb
  impulse responses, pedal-noise thump, all effect processing) is generated
  DSP, declared in IMPLEMENTATION_DETAILS.json, and never presented as a
  recording.
