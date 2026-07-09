# Stage 1 visual audit

## Sources and method

Audited against `nord-stage-4.visual.json`, `nord-stage-4.variants.json` (variant `stage-4-73`), and the normalized DOM/CSS geometry. The optional copyrighted reference image was not present in this isolated workspace, so no claim of pixel-level photo comparison is made. Canonical PNGs and `stage1-capture.json` are intentionally left to the parent-owned capture harness described by the benchmark protocol.

## Measured geometry

| Property | Desktop 1440×900 | Narrow 390×844 | Target |
| --- | ---: | ---: | --- |
| Instrument width | 1353.6 px (94.0vw) | 374.4 px (96.0vw) | Desktop 88–97%; narrow unclipped |
| Instrument height | 437.3 px | 121.0 px | 3.0951:1 variant aspect |
| Instrument aspect ratio | 3.0951:1 | 3.0951:1 | 3.0951:1 |
| Deck including top rail | 54% | 54% | 54% ±2.5% |
| Keybed including front lip | 46% | 46% | 46% ±2.5% |

The instrument and utility UI fit inside both required viewports with no horizontal or vertical document overflow. The narrow layout scales the complete chassis to the viewport instead of clipping or hiding sections.

## Section audit

The six sections render in required order on one continuous red chassis. Corrected photo-measured fractions from visual spec v1.2 are used: Performance 14%, Organ 20%, Piano 8.5%, Program/Morph 12.5%, Synth 25%, Layer Effects 20%. These sum to 100%.

- Performance: exposed red deck, Nord Stage 4 branding, master/monitor knobs, pitch stick, and modulation wheel; no OLED.
- Organ: dark inset, nine physical drawbars with red LED ladders, two layer faders, model/percussion/vibrato/rotary groups; no OLED.
- Piano: dark inset, two layer faders, six type selectors, model encoder, timbre and piano-detail controls; no OLED.
- Program/Morph: one blue-green primary OLED, large value dial, eight program buttons, page/live/scene/store/split/morph controls.
- Synth: one blue-green primary OLED and non-uniform oscillator, filter/LFO, envelope, arp/voice groups with three layer faders.
- Layer Effects: focus row and distinct Mod 1, Mod 2, Amp/EQ, Delay, Compressor, and Reverb blocks; no OLED.

Exactly two elements carry `data-primary-oled`: Program and Synth.

## Keybed and interaction audit

- 73 keys, MIDI 28–100, E1–E7 inclusive.
- 43 white keys and 30 black keys; black keys are 61% of white-key height.
- All 73 key buttons expose note-specific accessible names and pressed state.
- 129 normalized panel inputs expose stable IDs, accessible names, native button/range keyboard behavior, visible focus, and visual state changes.
- Panel inputs are marked `data-functional="false"` and remain isolated from the piano engine.

## Corrections made during audit

- Used the visual spec's corrected 14/20/8.5/12.5/25/20 section geometry instead of the obsolete coarse fractions repeated in the phase outcome prose.
- Kept primary OLEDs out of Performance, Organ, Piano, and Effects.
- Used the exact HA73 silhouette and key range rather than reusing an 88-key or waterfall model.
- Added explicit status copy for modeled synthesis, audio startup/failure fallback, and MIDI unsupported/denied/disconnected states.

## Known deviations

- The source reference photograph was not supplied in `inputs/reference/`, so typography and sub-control positions are reconstructed from the machine-readable landmarks rather than traced from the photo.
- The Phase 1 voice is honest live synthesis, not a recorded Nord piano sample. Recorded multi-model sets are Phase 2 scope.
- At 390 px the complete instrument remains visible and focusable, but legends are necessarily very small; browser zoom or focus navigation is the practical inspection path.
