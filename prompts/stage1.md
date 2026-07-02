# Phase 1 — Complete surface and basic piano

Work only inside the assigned Phase 1 candidate directory. Read `BENCHMARK.md`, Phase 1 of `specs/benchmark-phases.json`, both assigned specs, the selected variant entry, and the selected product image. The manual is the authority where a spec is ambiguous.

Assigned specs: `specs/nord-stage-4.visual.json` and `specs/nord-stage-4.piano.json`.

## Outcome

Build the entire visible Nord Stage 4 for the assigned variant. Two things are functional: the keybed plays one dependable piano voice, and every visible control moves or presses accessibly. Nothing else works yet — and it must not pretend to.

## Feature set

**Surface (visual spec):**

1. The variant's silhouette, aspect ratio, and exact key count/range/action, on one continuous red chassis.
2. The 54/46 deck/keybed split and the six sections at their documented widths: Performance 13%, Organ 21%, Piano 15%, Program/Morph 9%, Synth 21%, Layer Effects 21%.
3. Reference-specific landmarks per section: wheels and master level, nine drawbars with LED graphs, piano selectors, program display/dial/buttons, dense synth groups, effects matrix. Program and Synth get the only primary OLEDs.
4. Reference materials and colors: red metal, dark inset panels, black indexed knobs, fader caps, LEDs, blue-green OLEDs, white legends.
5. At 1440x900 the instrument fills 88–97% of viewport width with no vertical scroll; at 390x844 it remains inspectable without clipping.

**Basic piano (piano spec, Phase 1 subset):**

One piano-like voice — a declared bundled sample set or honestly-described synthesis — fed by one deterministic note lifecycle:

- pointer down/up/cancel and independent multi-touch;
- mapped computer keys with repeat suppression and blur cleanup;
- Web MIDI note/velocity and sustain CC64, including denied/disconnected states;
- velocity response, note release, repeated/overlapping notes;
- sustain, polyphony with deterministic voice stealing, and all-notes-off cleanup on blur/disconnect/unmount;
- truthful loading/ready/error/fallback status.

Tests must not require a physical MIDI device, network, or real audio output.

**Decorative controls:**

Every visible physical input has a stable ID and accessible name, responds to pointer and keyboard, and shows its state (keys depress, buttons light, knobs turn, faders and drawbars slide). That presentation state lives in a normalized hardware model and changes nothing else: no audio, no fake program/effect state, no displays reporting unimplemented features as working.

## Order of work

1. Write `IMPLEMENTATION_PLAN.md` citing both assigned spec filenames and copying the Phase 1 `Hard gates` as a checklist.
2. Normalized typed hardware/key data with stable IDs; chassis, sections, exact keybed.
3. Section controls with accessible decorative interaction.
4. Injectable audio/MIDI/timing boundaries, the note lifecycle, then the piano voice.
5. Tests, browser pass, canonical captures, and provenance.

## Evidence

Maintain every Phase 1 feature ID from `BENCHMARK.md` in `tests/feature-matrix.json`. Use the parent capture harness for `stage1-desktop.png`, `stage1-narrow.png`, and `stage1-capture.json`; write `stage1-visual-audit.md` with measured bounds, ratios, key counts, corrections, and known deviations. Record the true audio source in `IMPLEMENTATION_DETAILS.json`. Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build` before verification.
