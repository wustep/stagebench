# Phase 1 implementation plan — Nord Stage 4 73

Assigned specs (both read in full before writing code):

- `specs/nord-stage-4.visual.json` — deck/keybed split, six section fractions, section landmarks,
  forbidden hardware, reference colours, presentation constraints.
- `specs/nord-stage-4.piano.json` — piano architecture and the Phase 1 subset
  ("one dependable basic piano voice played from the keybed"; everything else is Phase 2 scope).

Variant: `stage-4-73` from `specs/nord-stage-4.variants.json` — 73 keys, E–E, 43 white / 30 black,
hammer action, instrument aspect ratio 3.0951, black key height fraction 0.61.

Reference: `reference/nord-stage-4-73.jpg` (authoritative for layout and materials) and
`reference/manual.pdf` pages 23–26 (authoritative for piano behaviour).

## Phase 1 hard gates (checklist, copied from `specs/benchmark-phases.json`)

- [x] The exact keybed count and range for the assigned variant are modeled and playable.
- [x] The complete visible control surface is present with the documented section geometry, and
      Program and Synth are the only primary OLED locations.
- [x] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release,
      sustain, polyphony, and cleanup.
- [x] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [x] Canonical desktop and narrow captures are complete with a written visual audit.

## Shared completion gates

- [x] All benchmark-owned and candidate-authored tests pass.
- [x] No browser console errors during the interaction pass.
- [x] Every claimed audio feature is connected to the audible signal graph.
- [x] `IMPLEMENTATION_DETAILS.json` distinguishes recorded samples, generated buffers and live synthesis.

## Order of work

1. Plan (this file).
2. Normalised typed hardware data: variant, keybed geometry, section layout, control inventory
   with stable IDs (`src/model/`).
3. Chassis, top rail, six sections, keybed rendering (`src/components/`).
4. Accessible decorative controls — knob / fader / drawbar / button / encoder / wheel / stick —
   all storing presentation state only (`src/state/hardware.ts`).
5. Injectable audio, MIDI and timing boundaries; one shared note lifecycle; then the piano voice
   (`src/audio/`, `src/input/`).
6. Tests (including a deterministic offline Web Audio renderer so audio is asserted on real
   signals without a browser), browser pass, captures, provenance.

## Honesty contract commitments

- Only the keybed, the sustain input and the audio status readout do anything audible in Phase 1.
- Every panel control is presentation state only: it moves, lights and reports its value, and is
  marked `functional: false` in the control inventory. `data-functional="false"` is rendered on
  each decorative control so the claim is inspectable in the DOM.
- The Program OLED shows the model identity and a static idle page. It never reports a feature as
  working. The Synth OLED shows a static idle page.
- The piano voice is **generated synthesis**, not a recorded sample set, and
  `IMPLEMENTATION_DETAILS.json` says exactly that.
