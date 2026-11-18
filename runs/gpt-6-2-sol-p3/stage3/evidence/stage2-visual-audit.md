# Stage 4 73 Phase 2 visual audit

Compared the canonical captures with the preserved Phase 1 desktop and narrow captures. The chassis, continuous keybed, six control bands, and two OLED locations match the Phase 1 geometry. The Sustain pedal button adds 8 px to the desktop status row, moving the chassis 4 px upward within the centered layout.

| Quantity | Desktop | Narrow |
| --- | ---: | ---: |
| Viewport and document | 1440 × 900 | 390 × 844 |
| Instrument origin | (47.52, 209.03) | (9.75, 326.48) |
| Instrument width × height | 1344.95 × 434.53 px | 370.50 × 119.70 px |
| Deck height | 234.64 px (54%) | 64.63 px (54%) |
| Keybed height | 199.88 px (46%) | 55.06 px (46%) |
| White key width × height | 29.47 × 188.39 px | 8.11 × 51.91 px |
| Black key width × height | 18.56 × 114.91 px | 5.11 × 31.66 px |

The Program OLED shows the focused Piano layer and model. Piano type and performance indicators follow that layer, while the FX focus strip shows the active edit target and illuminates both Piano lamps in group mode. Global Delay, Compressor, and Reverb have separate amber indicators. The seven added focus, routing, clock sync, and compressor mode targets sit beside the existing legends.

The desktop interaction test found reachable hit points for all 154 panel controls and all 73 keys. The narrow view fits the entire chassis and provides horizontal access in Inspect controls mode. Both canonical captures report zero console messages and zero page errors.

The built instrument passed a separate Chromium interaction test with a virtual MIDI input. Each of the six models produced a signal through one AudioContext and one destination connection after the initial page click. The test also covered wet delay, bypass, sustain, master mute, and cleanup on blur. A test that blocked one recorded asset verified the fallback indicator and playable synthesis.

## Audio implementation choices

- Upright Piano KW is the power-on sound. Grand uses five recorded dynamics across 30 roots. Upright has two recorded dynamics and uses a nearby root if a dynamic is missing at a specific key. Rhodes has one recorded dynamic across 15 roots and uses velocity-sensitive filtering and gain. Clavinet, FM Stage Piano, Rosewood Marimba, and the fallback are synthesized.
- String resonance uses damped sympathetic modes. Cabinet profiles use tone shaping and saturation. Reverb uses six generated stereo impulse responses. The shared Rotary uses common horn and drum modulation with independent signal lanes so the layer faders can follow it.
- The FX clock takes its tempo from Delay Tap and drives the Mod 1 and Delay sync modes.

## Unsupported controls

Organ, Synth, and Program sound and editing controls retain Phase 1 panel behavior. Piano pedal noise, half-pedaling, Triple Pedal hardware and setup, size classes, INFO, Nord Sound Manager downloads, and the preset library are unsupported. FX per-type variations, Chorale, Delay feedback-loop effects and Analog mode, Pump/Wah pedal modes, Rotary close mic and stop angle, and post-Rotary global reverb are unsupported. Optional soft and sostenuto pedal modes, Delay Ping Pong, and Rotary Stop Mode are outside this implementation.
