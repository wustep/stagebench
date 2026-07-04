# Phase 1 Implementation Plan

Target: Stage 4 73 (`stage-4-73`) inside the Phase 1 `candidate/` directory.

Assigned specs cited for this implementation:

- `nord-stage-4.visual.json`
- `nord-stage-4.piano.json`

## Scope

- Build one continuous red Nord Stage 4 73 surface with the variant keybed: 73 hammer-action keys, 43 white keys, 30 black keys, E1 to E7.
- Preserve the visual deck proportions from `nord-stage-4.visual.json`: 54% control deck, 46% keybed, and six horizontal sections at 13%, 21%, 15%, 9%, 21%, and 21%.
- Make every visible physical control accessible and movable/pressable as normalized presentation state only.
- Implement one dependable generated piano voice from the keybed, computer keyboard, and Web MIDI note/sustain input. Do not claim recorded samples or working panel functions in this phase.

## Hard Gates Checklist

- [x] Hard gate: The exact keybed count and range for the assigned variant are modeled and playable.
- [x] Hard gate: The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [x] Hard gate: The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [x] Hard gate: Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [x] Hard gate: Canonical desktop and narrow captures are complete with a written visual audit.

## Implementation Order

1. Define typed hardware data for the selected variant, section fractions, keybed geometry, and stable decorative control IDs.
2. Render the continuous chassis, section panels, OLED landmarks, drawbars, faders, knobs, buttons, wheels, and hammer-action keybed.
3. Add normalized presentation-only control state and keyboard/pointer accessibility affordances.
4. Add an injectable generated-piano lifecycle with optional Web Audio output, sustain, voice stealing, repeated-note handling, MIDI status, and cleanup.
5. Add tests, feature matrix, provenance, and Phase 1 evidence files.

