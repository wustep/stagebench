# Phase 2 implementation plan (inherited Phase 1 surface)

Assigned specifications:

- `specs/nord-stage-4.visual.json` (variant-aware control-deck visual contract and section landmarks; selected variant is `stage-4-73`)
- `specs/nord-stage-4.variants.json` (selected variant keybed and reference mapping)
- `specs/nord-stage-4.piano.json` (Piano layers, selection, performance, acoustics, timbre)

## Phase 2 hard gates (verbatim)

- [ ] The primary piano path is not a placeholder oscillator or generated additive buffer bank presented as recorded samples.
- [ ] Pointer, touch, computer keyboard, and MIDI share one deterministic note lifecycle.
- [ ] Volume, reverb, velocity, release, sustain, and selected Piano controls alter audible output.
- [ ] Fallback mode remains playable and is labeled accurately.

## Implementation map

| Requirement | Owning module | Rendered control/status | Audio-path effect | Test |
| --- | --- | --- | --- | --- |
| Shared note lifecycle, repeated notes, cleanup, stealing | `src/pianoEngine.ts` | Piano status / active voice count | Voice envelopes and deterministic allocator | `tests/piano-engine.test.ts` |
| Pointer, touch, computer keyboard, MIDI | `src/main.tsx`, `src/pianoEngine.ts` | 73 key controls | One `noteOn`/`noteOff` path | `tests/piano-engine.test.ts`, `tests/phase2.test.tsx` |
| Velocity, touch curves, dynamic compression | `src/pianoEngine.ts` | Touch + Dyn Comp selectors | Gain and brightness response | `tests/piano-engine.test.ts` |
| Sustain/half-pedal, sostenuto, soft pedal | `src/pianoEngine.ts` | Pedal controls/status | Release scheduling and gain/timbre | `tests/piano-engine.test.ts`, `tests/phase2.test.tsx` |
| Layer A/B, type/model, timbre, unison, release/resonance | `src/main.tsx` | Piano panel controls + OLED | Oscillator/filter/delay parameters | `tests/phase2.test.tsx`, `tests/piano-engine.test.ts` |
| Master volume and reverb | `src/pianoEngine.ts` | Master Level + Reverb control | Master gain + wet path | `tests/piano-engine.test.ts` |
| Web MIDI boundary and failure state | `src/pianoEngine.ts` | MIDI status | Parsed note lifecycle | `tests/piano-engine.test.ts` |

Inherited visual contract: `specs/nord-stage-4.visual.json` with selected variant `stage-4-73` from `specs/nord-stage-4.variants.json`.

## Hard gates (verbatim)

- The selected variant's exact keybed is modeled: count, range, and action per `specs/nord-stage-4.variants.json` (default Stage 4 73 = 73 keys, 43 white and 30 black, E-to-E hammer action).
- Program and Synth are the only primary OLED locations.
- The red chassis is continuous around the deck and keybed.
- Two measured desktop comparison-and-repair passes are complete.

## Measured geometry

- Source chassis bounds: 9013 × 2912 at x=1292, y=410 on 11600 × 3866; aspect ratio 3.0951.
- Control deck including top rail: 54%; keybed including bottom rail: 46% (±2.5%).
- Horizontal sections: Performance 13%, Organ 21%, Piano 15%, Program/Morph 9%, Synth 21%, Layer Effects 21%.
- Keyboard model: E-to-E, 43 white keys and 30 black keys; black key height 61% of white key height.

## Landmarks and model

Performance is exposed red metal with master level, pitch stick, modulation wheel, and Nord branding; it has no OLED. Organ has a dark inset plate, nine drawbars, LEDs, model/percussion/rotary controls, and no OLED. Piano has layer controls, type/model/timbre/detail controls and no OLED. Program/Morph has the sole program OLED, encoder, navigation, five live buttons, and morph controls. Synth has the sole synth OLED plus oscillator/filter/envelope/LFO/arp clusters. Effects has two effect groups, amp/EQ, delay, compressor, reverb and focus controls with no OLED.

Controls are data-driven with stable IDs (`section.control`) and shared normalized state. Large encoders/faders outrank secondary knobs, then switches/LEDs.

## Repair loop

Two desktop passes compare 1440×900 captures cropped to the instrument bounds in this order: forbidden landmarks/section boundaries, density/placement, chassis/key geometry, materials, typography. Largest five discrepancies and corrections are recorded in `evidence/stage1-visual-audit.md`; a 390×844 capture follows the second pass.
