# Phase 1 Implementation Plan

Assigned specs:
- `specs/nord-stage-4.visual.json`
- `specs/nord-stage-4.piano.json`
- Variant: `stage-4-73` from `specs/nord-stage-4.variants.json`

## Hard gates (checklist)

- [x] The exact keybed count and range for the assigned variant are modeled and playable. (73 keys, E to E, 43 white / 30 black)
- [x] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [x] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [x] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [x] Canonical desktop and narrow captures are complete with a written visual audit. (audit written; parent harness takes PNGs at seal)

## Section geometry (visual.json)

Vertical: deck 0.54 / keybed 0.46 (±0.025)

Horizontal fractions:
| Section | Fraction |
| performance | 0.14 |
| organ | 0.20 |
| piano | 0.085 |
| program | 0.125 |
| synth | 0.25 |
| effects | 0.20 |

## Order of work

1. Normalized typed hardware/key data with stable IDs
2. Chassis, sections, exact keybed
3. Section controls with accessible decorative interaction
4. Injectable audio/MIDI/timing boundaries, note lifecycle, piano voice
5. Tests, provenance, visual audit

## Honesty

Panel controls update presentation state only. Only keybed notes and sustain input affect audio. Audio strategy: live additive synthesis (generated), not recordings.
