# stage1-visual-audit.md — Phase 1 visual audit (Stage 4 73)

Source measurements: `stage1-capture.json` (headless Chrome 151, dist build),
`stage1-desktop.png` (1440×900), `stage1-narrow.png` (390×844). Reference:
`inputs/reference/nord-stage-4-73.jpg`. Spec: `specs/nord-stage-4.visual.json`.

## Measured bounds

| Check | Spec / gate | Measured | Verdict |
| --- | --- | --- | --- |
| Desktop instrument width / viewport | 88–97% | 1382.4 / 1440 = **0.960** | Pass |
| Desktop vertical scroll | none (`bodyScrollHeight ≤ 900`) | **900 = 900** | Pass |
| Desktop horizontal overflow | none | body/doc `scrollWidth` = 1440 | Pass |
| Narrow page overflow | inspectable, no page clip | body/doc `scrollWidth` = 390 (page never overflows; instrument rides a 560px inner rail) | Pass |
| Narrow vertical fit | inspectable without clipping | body height = 844 = viewport | Pass |
| Key count / split | 73 = 43 white + 30 black, E1–E7 | 73 / 43 / 30 at both widths, DOM order E1→E7 | Pass |
| Section order | performance, organ, piano, program, synth, effects | matches | Pass |
| Section widths | 0.14 / 0.20 / 0.085 / 0.125 / 0.25 / 0.20 | 0.1388 / 0.1946 / 0.0878 / 0.1249 / 0.2410 / 0.1946 (max Δ 0.009, flex gaps) | Pass |
| Console errors during capture | none | `consoleErrors: []` | Pass |
| Primary OLEDs | Program + Synth only | exactly 2 `[data-primary-oled="true"]`; performance/effects have none; program page readout is auxiliary (`data-primary-oled="false"`) | Pass |
| Organ drawbars | 9 tall sliders, no uniform grid | 9 `organ-drawbar-N` in one `.drawbank` row + mixed switches | Pass |
| Synth layout | grouped, no uniform matrix | 7 labeled sub-groups, varied knob/fader/OLED sizes | Pass |
| Effects layout | two separated groups | 4 labeled sub-groups under two themes + dividers | Pass |
| Piano bank | selectors, no drawbar bank | 2 faders + selectors; only piano/program/synth/organ layer faders are tall | Pass |

## Deck/keybed split

Instrument height 781px = top rail (~18) + deck (**400**) + keybed (**300**) +
status rail (~45) + chassis padding/gaps. Deck is authoritative at the fixed
400/300 content heights; with rails the visible deck band is ~51% and the
keybed band ~38%. The piano keybed is deliberately given a tall, playable
action (300px) rather than a literal 46% strip, because a 46%-of-box keybed
rendered too short to operate at 1440×900; this deviation favors the
playability hard gate over the proportional guide and is recorded here.

## Corrections applied during the phase

1. First capture: deck content overflowed its band (piano mixed-grid 552px in a
   ~228px deck; `bodyScrollHeight` 912 > 900). Fixed by compacting controls
   (smaller knobs/faders/legends, tighter gaps) and giving the deck a fixed
   400px band.
2. Same pass: keybed `aspect-ratio` collapsed the keys when the deck grew.
   Fixed with a fixed 300px keybed band.
3. Height-capped flex experiment (`height: min(100vh-24px, …)`) letterboxed the
   instrument. Reverted to content-driven height; desktop body is exactly 900.
4. Status messages initially rendered "Loading…" in captures (1.5s resume race
   + short settle). Capture now allows autoplay + 2.2s settle; screenshots show
   "Piano ready (synthesized basic voice)".
5. Branding moved from a top strip into the performance band's lower half, as
   on the reference (marketing-hero rule: no hero above the instrument).

## Known deviations

- Spec conflict: `prompts/stage1.md` lists 13/21/15/9/21/21 section widths, but
  `specs/nord-stage-4.visual.json` (photo-measured 2026-07-04 correction,
  authoritative) lists 14/20/8.5/12.5/25/20. Implemented the visual-spec values.
- Reference micro-detail (screw heads, exact legend typography, wood end
  cheeks, rear jacks) is simplified; silhouette, section order, landmarks,
  colors, and materials match.
- Narrow profile keeps a 560px minimum instrument width inside a page-safe
  horizontal rail (body never overflows): everything stays reachable and no
  key or control clips.
- Status bar sits below the keybed (a thin dark rail with SUSTAIN/PANIC):
  honest loading/ready/error/fallback + MIDI state must be visible, and the
  reference has no such UI surface, so it lives outside the deck/keybed bands.
