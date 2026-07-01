# Phase 1 — Complete surface and basic Piano

Work only inside the assigned Phase 1 candidate directory. Read the allowlisted inputs completely: `BENCHMARK.md`, `TESTING.md`, Phase 1 of `specs/benchmark-phases.json`, the visual and Piano specs, the selected variant entry, the selected product image, and the relevant manual pages.

Assigned specs: `specs/nord-stage-4.visual.json` and `specs/nord-stage-4.piano.json`.

## Exact outcome

Build the entire visible Nord Stage 4 hardware surface for the assigned 88, 73, or Compact 73 variant. The exact keybed and one basic Piano voice are functional. All visible knobs, encoders, faders, drawbars, wheels, and buttons move or press and expose accessible state, but every panel control is intentionally presentation-only in this phase.

This boundary must be honest: do not connect visible panel knobs, buttons, wheels, faders, drawbars, or encoders to fake audio/state behavior, and do not claim that they work. Only keybed note input and the note lifecycle (including sustain events from the input boundary) affect audio.

## Required visual surface

Implement before polishing micro-detail:

1. The assigned variant’s measured overall aspect ratio and exact key count/range/action.
2. One continuous red chassis with connected top/bottom rails and end cheeks.
3. The 54/46 control-deck/keybed vertical allocation.
4. Six ordered sections with approximate horizontal allocations: Performance 13%, Organ 21%, Piano 15%, Program/Morph 9%, Synth 21%, Layer Effects 21%.
5. Reference-specific control density and landmarks: Performance wheels/master controls, nine Organ drawbars, compact Piano selectors, Program display/keypad, dense Synth groups, and Layer Effects matrix.
6. Only Program and Synth receive primary OLED displays. Do not invent OLEDs in Organ, Piano, Performance, or Layer Effects.
7. Reference materials, colors, typography, legends, LEDs, spacing, shadows, hierarchy, and neutral product-study presentation.

At 1440x900 the full instrument must occupy 88–97% of viewport width and remain visible without vertical scrolling. At 390x844 it must remain inspectable without clipping away keys, chassis, or control sections.

## Required basic Piano behavior

Implement one dependable Piano-like voice. It may use one properly declared bundled sample set or honestly described generated/modelled synthesis. It does not need multiple selectable instruments; that begins in Phase 2.

All inputs feed one deterministic note lifecycle:

- pointer down/up/cancel/lost-capture;
- multi-touch with independent pointer ownership;
- mapped computer-key input with repeat suppression and blur cleanup;
- Web MIDI note/velocity and sustain CC, including disconnected/denied states;
- velocity-to-level response;
- repeated and overlapping notes;
- note release and cleanup;
- sustain pedal down/up behavior;
- useful polyphony with deterministic voice stealing;
- internal all-notes-off cleanup on blur/disconnect/unmount (not a functional panel Panic button);
- truthful loading, ready, error, and fallback status.

No physical MIDI device, network, or real audio output may be required by the tests.

## Decorative interaction contract

Every visible physical input must have a stable ID and accessible name. Keys visibly depress. Buttons press/toggle their light where visually appropriate. Knobs/encoders/faders/drawbars/wheels respond to pointer and keyboard interaction. These presentation states live in the normalized hardware model.

All visible panel controls are decorative in Phase 1 and must not:

- change the audible graph;
- write fake Program/Organ/Synth/effect state;
- update displays as though an unimplemented feature succeeded;
- be described as functional in evidence or implementation details.

## Required implementation order

1. Write `IMPLEMENTATION_PLAN.md` with the assigned variant, both assigned spec filenames, an exact `Hard gates` checklist, measured bounds/ratios, section inventory, key model, audio source plan, and test mapping.
2. Create normalized typed hardware/key data with stable IDs.
3. Build chassis, sections, and exact keybed.
4. Add section-specific controls and accessible decorative interaction.
5. Add injectable audio/MIDI/timing boundaries and the unified note lifecycle.
6. Add the basic Piano source, sustain/polyphony/cleanup, and status handling without activating panel controls.
7. Complete tests, browser interactions, two visual repair passes, and provenance.

## Required evidence and tests

Maintain every Phase 1 feature ID in `TESTING.md`. Tests must cover exact key geometry, section/landmark inventory, accessible control movement, decorative-state honesty, note lifecycle, every input path, sustain, polyphony/stealing, failure cleanup, and the real audio boundary.

Use the parent capture harness for canonical `stage1-desktop.png`, `stage1-narrow.png`, and `stage1-capture.json`. Write `stage1-visual-audit.md` with measured bounds, ratios, key counts, forbidden landmarks, corrections from two desktop passes, console state, and remaining deviations.

Update `IMPLEMENTATION_DETAILS.json` with the truthful basic Piano source and all samples/licenses. Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build` before verification.

## Explicitly deferred to later phases

Do not implement or claim multiple Piano instruments, detailed Piano model controls, audible effects, Programs/presets, Live Mode, splits, scenes, morphs, Organ audio, or Synth audio.
