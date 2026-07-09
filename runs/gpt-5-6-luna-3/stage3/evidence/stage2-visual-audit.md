# Phase 2 visual audit — Stage 4 73

## Measurement basis

- Variant: `stage-4-73`, hammer action, E-to-E; inherited geometry remains 73 total keys, 43 white, 30 black.
- The desktop shell continues to use the Phase 1 measured deck/keybed split of 54% / 46% and the six-column fractions from `inputs/specs/nord-stage-4.visual.json`.
- The 1440px shell remains `min(92vw, 1450px)`, inside the visual spec's 88–97% desktop width range. The 390px media query keeps the 3×2 inspection grid, all controls, both OLED locations, and all 73 key buttons.

## Phase 2 landmarks checked

- Performance keeps the exposed red chassis, Nord Stage 4 branding, master level, pitch stick, modulation wheel, and sustain input. Master Level now drives the master gain/limiter path.
- Piano keeps the dark inset plate and adds visible layer A/B on/focus/level/octave/SUSTPED controls, six exclusive type selectors, model/status feedback, KB Touch, Dyn Comp, Timbre, Unison, Soft Release, String Res, and PSTICK.
- Layer Effects keeps two focus buttons and now exposes separate Mod 1, Mod 2, Delay, Amp/EQ, Compressor, Reverb, Rotary, bypass, and global controls. The six effect columns remain inside the existing dense hardware panel rather than creating a new primary display.
- Organ, Program, and Synth retain their Phase 1 decorative behavior. Program and Synth remain the only primary OLED locations.
- No marketing hero, reference-image background, detached rail, missing key, or new primary hardware display was introduced.

## Browser interaction pass

- Local Vite browser pass at `http://127.0.0.1:5173/` confirmed 73 `[data-key-id]` elements, six ordered `.instrument-section` landmarks, and unique functional IDs for Piano type, layer B, Rotary, bypass, and Master Level.
- Exercised Grand → Upright selection, layer B enable, and To Rotary state; visible feedback changed to `Upright · model A · A focused · fallback-ready`, layer B became pressed, and Rotary became pressed.
- The desktop screenshot showed the complete continuous chassis and keybed with no console-visible application error during the pass.
- The in-app browser refused the temporary narrow-viewport reload under its local-target security policy, so canonical narrow PNG regeneration remains parent-harness work. Existing Phase 1 narrow evidence is preserved unchanged for regression comparison.

## Audio/evidence notes

- The top rail and Piano status use fallback-ready wording until a user gesture creates the single AudioContext; a missing Web Audio constructor is reported as fallback active rather than library ready.
- Audio state is connected to two layer buses, ordered Mod 1 → Mod 2 → Delay → Amp/EQ → Compressor → Reverb, optional Rotary return, layer/master gain, limiter, and one destination.
- `IMPLEMENTATION_DETAILS.json` lists all six model profiles and explicitly records that no recorded sample files were present in the assigned inputs; generated profiles are not claimed as recordings.

## Known deviations

- The Phase 2 input directory contains no redistributable recorded Grand/Upright/Electric assets. The candidate therefore provides six offline, audibly distinct deterministic model profiles and a labeled playable fallback, but leaves `sampleSources` empty rather than fabricating sample provenance.
- The canonical Phase 2 desktop/narrow capture files are parent-controlled outputs; the inherited `stage1-desktop.png`, `stage1-narrow.png`, and capture manifest remain untouched.
