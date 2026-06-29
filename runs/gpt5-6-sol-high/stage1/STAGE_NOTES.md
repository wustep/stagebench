# Stage 1 implementation notes

## Run

```bash
pnpm install
pnpm dev
```

Production preview: `pnpm build && pnpm preview`.

## What is implemented

- Responsive, proportion-preserving Nord Stage 4 Compact 73 surface built with React and TypeScript.
- Full 73-key E1–E7 keyboard with accurate black-key grouping and pointer/keyboard depression states.
- Industrial red chassis, end cheeks, panel overlays, legends, dividers, front lip, highlights, gradients, and hardware shadows.
- Organ section with two layers, nine physical drawbars, LED graphs, organ models, percussion, vibrato/chorus, drive, and rotary controls.
- Piano section with two layers, library categories, selection encoder, timbre, resonance, compression, pedal, unison, and preset controls.
- Central Program section with illuminated program OLED, encoder, program/page keys, scene, split, morph, store, shift, and live controls.
- Three-layer Synth section with OLED waveform, oscillator selection, LFO, envelopes, filter, unison, glide, vibrato, and arp controls.
- Layer Effects area covering modulation, delay, amp/EQ, compressor, reverb, and layer focus controls.
- Master level, pitch stick, modulation wheel, LEDs, faders, potentiometers, rotary encoders, buttons, and display power.
- Every rendered hardware control is interactive: buttons toggle, LEDs follow state, knobs drag vertically and support arrow/Home/End keys, ranges move, displays switch, and keys depress.
- Focus-visible, hover, pressed, touch, and reduced-motion states.
- Vite is configured with `base: './'` for embedded preview routes.

## Verification

- `pnpm typecheck` — passed.
- `pnpm lint` — passed.
- `pnpm build` — passed with Vite 8.1.0.
- Dev-server and built-asset HTTP smoke checks — passed.
- Parent browser verification at desktop and a 487 px narrow viewport identified and confirmed a keybed overflow caused by browser-default button sizing. White and black keys now explicitly reset `min-width` and `padding`, allowing the 73-key row to shrink within the instrument frame without horizontal overflow.
- The canonical Nord top-down photograph was inspected at full resolution and the Nord Stage 4 manual v1.4x overview/panel-control sections were used for proportions, section naming, and control taxonomy.

## Known limitation

The initial isolated subagent session had no available in-app browser window. Parent browser verification subsequently covered desktop and narrow rendering and supplied the responsive overflow finding documented above. The implementation uses no external runtime assets or network requests.

No audio code is included in Stage 1.

## Reference fidelity revision

- Added the supplied Nord Stage 4 73 top-down image as the primary benchmark reference and removed the incorrect “Compact” model label.
- Rebalanced the six control regions to 12% / 22% / 14% / 10% / 22% / 20% and reduced the rendered control-deck height so the keybed again carries slightly more than half of the instrument silhouette.
- Kept the red top rail, side cheeks, and lower lip connected around the full keybed while increasing the visible red separators between inset control plates.
- Lightened the slate control plates, added mixed red/ivory/dark drawbar caps, metallic layer-fader caps, and clearer active switch materials to better match the supplied hardware photograph.
