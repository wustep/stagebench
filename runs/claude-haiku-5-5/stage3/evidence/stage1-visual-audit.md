# Phase 1 visual audit — Nord Stage 4 73 (stage-4-73)

Captures: `stage1-desktop.png` (1440x900), `stage1-narrow.png` (390x844), measurements in `stage1-capture.json`.
Reference: `inputs/reference/nord-stage-4-73.jpg` (11600x3866 source, instrument bounds 1292,410 9013x2912, aspect 3.0951).
Capture provenance: self-run in this workspace (Playwright browser tool against `vite preview` of `pnpm build`). The parent capture harness was not in the workspace, so these are not parent-harness outputs.

## Measured bounds and ratios (1440x900)

| Item | Measured | Spec | Result |
| --- | --- | --- | --- |
| Instrument width / viewport width | 1354 / 1440 = 94.0% | 88–97% | pass |
| Instrument aspect ratio | 1354 / 437 = 3.098 | 3.0951 | within 0.1% |
| Vertical scroll at 1440x900 | none (document height 900) | none | pass |
| Deck height / instrument height | 236 / 437 = 54.0% | 54% ±2.5% | pass |
| Keybed band (46%) | keys area 182px; band including rails ≈ 201px | 46% | pass (rails included) |
| Keys | 73 total, 43 white, 30 black, E1 (MIDI 28) to E7 (MIDI 100) | 73 / 43 / 30, E to E | pass |
| Black key height | 61% of keybed key area | 0.61 | pass |
| Controls below keybed top | 0 | 0 | pass |
| Controls or groups outside their section | 0 | 0 | pass |

## Section widths (1440x900)

| Section | Measured width | Measured share | Spec share | Error |
| --- | --- | --- | --- | --- |
| Performance | 184px | 13.6% | 14% | −0.4 pp |
| Organ | 259px | 19.1% | 20% | −0.9 pp |
| Piano | 118px | 8.7% | 8.5% | +0.2 pp |
| Program and morph | 167px | 12.3% | 12.5% | −0.2 pp |
| Synth | 321px | 23.7% | 25% | −1.3 pp |
| Layer effects | 259px | 19.1% | 20% | −0.9 pp |

The sections are flex-grown from the spec fractions. Section padding and inset-plate margins take a little from the larger sections, which accounts for the error.

## Landmarks and placement

- **Performance (exposed chassis):** master level knob, rotary speaker block (speed, brake, level) on the red chassis below master, pitch stick, modulation wheel, "nord stage 4" branding. No dark inset plate, no OLED. Placement follows the photo's band; the rotary block sits in this band as the spec notes.
- **Organ (dark inset):** nine drawbars with LED ladders, B3 / Pipe 1 / Pipe 2 model switches, vibrato/chorus knob, cycle and on switch, 2nd/3rd percussion switches and volume. No OLED.
- **Piano (dark inset):** layer A and B on, focus, level fader with LED graph, octave knob; six-LED piano type cycle with model dial; timbre knob with KB touch, dyn comp and unison cycles; detail switches (soft release, string res, sustain pedal routing, pitch stick routing, section on). No OLED, no drawbar-like controls.
- **Program and morph (exposed chassis):** single primary program OLED, large program dial, eight program buttons, page up/down, live mode, layer scene, store, split, three morph assign buttons. One primary OLED only.
- **Synth (dark inset):** one narrow synth OLED (36% of section width), synth layer fader, oscillator knobs and type cycle, filter knobs, envelope knobs, LFO knobs and wave cycle, arpeggiator on/mode/rate.
- **Layer effects (dark inset):** two visibly separated groups (mod; amp sim and EQ; delay; compressor and reverb) plus effect focus A/B. No OLED.

OLED placement: program and synth only, as the spec requires. The OLED text is honest ("NOT ACTIVE IN PHASE 1").

## Forbidden hardware check

Applied the spec's `forbiddenDetection` rules to the rendered DOM, counting once per section. All descriptors resolved to 0 at 1440x900. Details in `stage1-capture.json`. Two caveats:

- The "single undifferentiated control grid" and "uniform repeated knob matrix" rules were checked by measuring same-size knob counts (max 3 in synth, 2 in effects, against a threshold of 8). They were not checked against a full grid-pitch fit; the counts make a regular 8+ grid impossible.
- The program OLED is 81% of its section width. The "wide OLED display" rule applies only to organ and piano, so this does not count, but the photo's program display is narrower. Recorded as a deviation below.

## Corrections made during the audit

1. Controls in the first pass overflowed the deck into the keybed (about 160px in some sections). Fixed by moving from wrapping flow to a row layout where rows share the deck height, and by reducing control sizes.
2. Section bodies were scaled down (`zoom` 0.78–0.88) in piano, synth, effects, and program so that their rows fit the 236px deck.
3. Pitch stick and mod wheel heights reduced so they stay above the keybed.
4. Knob class duplication removed; dial vs knob distinguished.

## Known deviations (declared)

1. **Density and legibility.** At 1440x900 the deck is 236px tall, so the piano, program, synth, and effects sections use small legends (about 6–8px). Some legends collide horizontally in the piano, program, and synth sections. Legend text is `pointer-events: none`, so it does not block controls. The collisions are a visual defect, not a functional one.
2. **Placement is approximate.** Groups are placed in row order read from the photo, not pixel-matched. Relative positions roughly follow the photo's sections and bands. The organ and piano layouts are less faithful than the performance band.
3. **Program OLED is wider than the photo's display** (81% of section width, against a narrower photo display). It is still the only primary OLED in the section.
4. **Narrow viewport (390x844).** The instrument keeps a 1000px design width inside a horizontal scroll region within the page, so it is inspectable without clipping, but the user must scroll sideways within it. The page itself does not scroll sideways. The spec's narrow requirement is met by scrolling, not by fitting; this is a deliberate choice, as squeezing to 390px would make the instrument about 116px tall and uninspectable.
5. **Virtual sustain pedal.** There is a pedal control below the instrument, outside the chassis, labelled as virtual. The real instrument has no such control on the panel. It is the spec's sustain UI control. It is not part of the photo.
6. **Manual.** The manual (`reference/manual.pdf`) was not extracted. Piano behaviour was taken from the piano spec summaries, which cite manual pages 23–26.
7. **Browser MIDI notice.** The browser logged a MidiSysEx permission notice after the page requested MIDI access. This is browser-level noise, not a page error. The page reports denied or unsupported MIDI truthfully.
8. **Parent capture harness.** Not present in the workspace. Captures and measurements are self-run; the operator should re-capture with the harness before sealing if the harness is required.

## Functional state at this capture

Verified in the browser pass: a click on key 60 moved the engine status to "Piano voice ready" with no error, and the page logged no console errors.

Covered by unit and component tests (jsdom, not browser-measured): multi-touch independence, glissando on drag, computer-keyboard repeat suppression, blur cleanup, sustain from pedal, Shift and CC64, panel controls changing presentation state only, and the engine status staying idle after panel interaction. Test files are listed in `tests/feature-matrix.json`.
