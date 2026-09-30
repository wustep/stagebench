# Phase 1 implementation plan

Sources: `inputs/specs/nord-stage-4.visual.json`, `inputs/specs/nord-stage-4.piano.json`, the Stage 4 73 entry in `nord-stage-4.variants.json`, and `inputs/reference/nord-stage-4-73.jpg`.

Use the photo-corrected visual spec section fractions 14/20/8.5/12.5/25/20, rather than the stale 13/21/15/9/21/21 in the phase prompt. Preserve the 54/46 vertical allocation, 3.0951 aspect, and 73 hammer-action E1–E7 keys (43 white, 30 black).

1. Model stable typed key/control IDs and normalized presentation values. Build continuous red chassis and six distinct reference-based sections.
2. Give each decorative input pointer and keyboard behavior, names, values, focus, and visibly changing positions/lights. OLEDs honestly identify Phase 1.
3. Implement injectable audio, MIDI, and input boundaries; deterministic ownership, sustain, voice stealing, release, and cleanup. Use original generated piano-like PCM, explicitly not recorded samples.
4. Test signal output, lifecycle, inputs, inventory, accessibility, geometry; browser-check desktop and narrow layouts; save captures, measurements, provenance, and required feature matrix.
5. Run test, typecheck, lint, build and fix failures. Do not seal.

## Phase 1 Hard gates (verbatim)

- [x] The exact keybed count and range for the assigned variant are modeled and playable.
- [x] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [x] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [x] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [x] Canonical desktop and narrow captures are complete with a written visual audit.

The parent capture harness is not included in this isolated workspace. Do not read outside the workspace to find it; use available browser tooling for equivalent viewport captures and declare this evidence gap.

Completed with candidate-runner captures in place of the unavailable parent harness. See `stage1-visual-audit.md` and `IMPLEMENTATION_DETAILS.json` for declared evidence and visual deviations.
