# Stage 1 Visual Audit — Nord Stage 4 73

Variant: `stage-4-73`  
Reference aspect ratio: 3.0951 (from `nord-stage-4.variants.json`)

## Measured layout (CSS implementation)

| Property | Spec | Implemented | Deviation |
| --- | --- | --- | --- |
| Deck/keybed split | 54% / 46% | 54% / 46% via flex-basis | None |
| Performance section width | 13% | 13% flex-basis | None |
| Organ section width | 21% | 21% | None |
| Piano section width | 15% | 15% | None |
| Program section width | 9% | 9% | None |
| Synth section width | 21% | 21% | None |
| Effects section width | 21% | 21% | None |
| Key count | 73 (43W + 30B) | 73 keys rendered | None |
| Key range | E to E | E1 (MIDI 28) – E7 (MIDI 100) | None |
| Black key height | 61% of white | 61% CSS height | None |
| Desktop width fill | 88–97% viewport | `min(97vw, calc(97vh * 3.095))` | Within spec |
| Primary OLED locations | Program + Synth only | Two `display` controls in those sections | None |

## Control inventory

- Total panel controls: 163 (stable `data-control-id` on each)
- Organ: 9 drawbars + LED indicators, model/percussion/rotary groups
- Program: primary OLED, dial, 8 program buttons, morph/store/scene buttons
- Synth: primary OLED, oscillator/filter/envelope/LFO/arp groups

## Known deviations

1. **Micro-detail fidelity**: Knob/fader industrial design is simplified CSS; reference photo micro-typography not traced pixel-perfect.
2. **Section internal placement**: Controls use responsive flex-wrap grids rather than photo-exact absolute coordinates.
3. **Audio**: Phase 1 uses honest additive synthesis, not recorded piano samples (Phase 2 scope per piano spec).
4. **Compact layout at 390×844**: Section headers and control captions hidden below 480px to prevent clipping; instrument remains inspectable.

## Responsive checks

- **1440×900**: Instrument fills ~97% width, no vertical scroll expected.
- **390×844**: Width 98vw, slightly taller aspect (3.095/1.15) to preserve keybed legibility without clipping.
