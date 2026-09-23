# Stage 2 visual audit — Nord Stage 4 73 (`stage-4-73`)

Run `claude-opus-5-5`, Phase 2 (piano library + layer effects). Specs: `nord-stage-4.visual.json`,
`nord-stage-4.piano.json`, `nord-stage-4.effects.json`, `nord-stage-4.variants.json` (`stage-4-73`).
Reference: `reference/nord-stage-4-73.jpg` (authoritative for layout and materials).

The canonical captures come from the parent capture harness at seal. The numbers below are from my own pass
over the production build (`pnpm build`, `vite preview`) in headless Google Chrome via the DevTools protocol,
device-metrics emulation at scale factor 1, reduced motion, `getBoundingClientRect()` before any scrolling.
My screenshots from that pass are `evidence/stage2-desktop.png` and `evidence/stage2-narrow.png`.

## Measured bounds (Phase 1 → Phase 2)

| Metric | 1440 × 900 Phase 1 | 1440 × 900 Phase 2 | 390 × 844 Phase 1 | 390 × 844 Phase 2 | Target |
| --- | --- | --- | --- | --- | --- |
| Instrument box (x, y, w, h) | 50.4, 167.8, 1339.2, 432.7 | 50.4, 140, 1339.2, 432.7 | 8, 89, 374, 120.8 | 8, 89, 374, 120.8 | — |
| Width / viewport | 0.930 | **0.930** | 0.959 | **0.959** | 0.88–0.97 desktop |
| Aspect (w / h) | 3.0948 | **3.0948** | 3.0948 | **3.0948** | 3.0951 |
| Deck / instrument height | 0.5397 | **0.5397** | 0.5397 | **0.5397** | 0.54 ± 0.025 |
| Document scroll size | 1440 × 900 | **1440 × 900** | 390 × 844 | **390 × 844** | no vertical scroll (desktop), no horizontal overflow |
| Rendered keys | 73 | **73** | 73 | **73** | 73 (E1–E7) |
| Console errors / page errors | 0 / 0 | **0 / 0** | 0 / 0 | **0 / 0** | 0 |

The instrument moved up 28 px on desktop only because the status panel under it is a little taller (the
library summary line). An earlier Phase 2 build listed all ten library sources inline and made the 1440 × 900 page
scroll (956 px). I caught that in this pass and folded the list into a collapsed `<details>`, which brought the page
back to exactly 1440 × 900.

## Visual regression against Phase 1

I compared pixels between `stage1-desktop.png` and `stage2-desktop.png` over the instrument box (1339 × 432,
aligned on the box origin), counting a pixel as changed when its channel difference is > 32:

| Section | Changed pixels |
| --- | --- |
| Performance | 0.02 % |
| Organ | 0.02 % |
| Piano | 0.72 % — lit LEDs now show real state (GRAND type, MED touch, layer A on, SUSTPED/PSTICK, FX focus) |
| Program | 0.54 % — the OLED now shows `PIANO A / Salamander Grand / Samples` |
| Synth | 0.04 % |
| Layer Effects | 0.05 % — Layer Effects ON and Piano focus A LEDs |
| **Whole instrument** | **0.16 %**; narrow profile 0.14 % |

No geometry, chassis, key or control position changed. The chassis, cheeks, rails, six sections and 73 keys are
identical to Phase 1.

## Interaction pass (production build, 1440 × 900, autoplay allowed)

- Load: status reached **Ready** with "Piano library ready: Grand, Upright and Electric are recorded samples; Clav,
  Digital and Misc are synthesized in the browser."; the Library summary read 10/10 sources ready. All four `.nspk`
  packs came from the bundle (`dist/samples`), with no third-party network access.
- Clicked **Piano type** (→ Upright), **Reverb on**, **Layer B** (on + focus), **Mod 2 on**, then pressed C4 with the
  pointer: "2 / 24 voices per layer (A 1 · B 1) · held: C4", audio "Audio output running", Program OLED
  `PIANO B · Wurlitzer EP200 (1/2) · Samples`, effects focus B.
- After releasing, both voices were freed within 1.5 s ("0 / 24 voices"). The console stayed clean throughout.
- With the default autoplay policy, synthetic DevTools events leave the context truthfully "suspended" until a real
  gesture. That matches Phase 1 behavior.

## Panel feedback now driven by sound state

- Piano: type LEDs (and a flashing type LED on load failure), KB Touch/Dyn Comp/Unison/Acoustics/Timbre LEDs for the
  focused layer, layer on LEDs (the focused layer blinks when both are on; blinking is replaced by an outline under
  reduced motion), SUSTPED/PSTICK LEDs, level-fader ladders, FX FOCUS LED.
- Effects: unit ON LEDs, type matrices, GLOBAL LEDs, comp FAST/ACTIVE, focus A/B LEDs (both lit in Group mode), and knobs
  that jump to the focused chain's values when focus changes.
- Performance: Master Level knob, Rotary SLOW/FAST, and the Rotary ON LED lit while a layer routes To Rotary.

## Known deviations

- **Layer level vs shared Rotary order:** the layer level sits just before the direct/To-Rotary split because the
  Rotary is shared (see `IMPLEMENTATION_PLAN.md`). Reverb still precedes Rotary.
- **Wurlitzer range:** the source recorded only 20 pitches (MIDI 33–92), so E1–G#1 and keys above G6 shift further
  (up to 5 and 8 semitones). This is declared in `IMPLEMENTATION_DETAILS.json`.
- **Layer on/off gesture:** a click on the focused layer turns it off. The hardware uses a long press, and turns on a
  second layer by pressing both buttons at once.
- **Still decorative, on purpose:** Organ, Synth and Program controls; spec-excluded effect variations, delay feedback
  effects and Analog, ping pong, Mod 1 pedal modes, rotary stop mode and close mic, pedal noise, KB zones; and master
  clock sync, which is Phase 3.
