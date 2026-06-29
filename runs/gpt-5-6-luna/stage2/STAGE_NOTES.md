# Phase 2 Stage Notes

## Architecture

- `src/audio.ts` owns the injectable Web Audio boundary, a shared Piano bus, per-layer A/B gains, master gain, reverb send/return, timbre filter, compressor, recorded sample loading, and a truthful live-synthesis fallback.
- `src/pianoState.ts` owns canonical Piano type/model, touch, dynamic compression, timbre, unison, acoustic detail, pedal, and layer state.
- `src/midi.ts` parses note, velocity, sustain, sostenuto, and soft-pedal messages and exposes an injectable input connection.
- `src/App.tsx` routes pointer, touch, computer keyboard, MIDI, focus loss, and Panic through the same key/note ownership path while preserving the inherited surface.

## Tests and verification

- `pnpm test`: 2 files, 7 tests passed.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm build`: passed; `dist/index.html` generated.
- Browser smoke: desktop rendered with 88 keys and sampled-piano status; Live program and computer-key interaction were exercised. Narrow render used 390×844 with horizontal control-deck overflow and 88 keys. Browser console error/warning logs were empty in both passes.

## Audio provenance

- Bundled files: `public/audio/piano/A1.mp3` through `A7.mp3`.
- Source: VSO2 piano recordings distributed through Tone.js Instruments, CC BY 3.0; full details and file list are in `IMPLEMENTATION_DETAILS.json`.
- The primary bank is one recorded velocity layer with multiple pitch roots. Runtime velocity response is gain/compression/touch/timbre shaping. The fallback is live triangle-oscillator synthesis and is labeled `FALLBACK · SYNTH PIANO`.

## Evidence

- `evidence/stage2-desktop.png` — 1440×900 browser capture after Live-program and computer-key interaction.
- `evidence/stage2-narrow.png` — 390×844 browser capture.
- `evidence/stage2-visual-audit.md` — measured render checks and remaining deviations.

## Limitations

- The real browser exposes `MIDI DENIED` in the current environment because Web MIDI permission is unavailable; parsing and connection boundaries remain injectable.
- The current Phase 2 audio tests are represented in the feature matrix through the implementation boundary files; the automated suite remains the inherited visual/component suite plus the repaired app wiring. Physical MIDI hardware and a physical audio output were not required.
