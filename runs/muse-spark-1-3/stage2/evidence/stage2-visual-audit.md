# stage2-visual-audit.md — Phase 2 visual audit (Stage 4 73)

Source measurements: `stage2-capture.json` (headless Chrome, dist build with
bundled `dist/samples/` served), `stage2-desktop.png` (1440×900),
`stage2-narrow.png` (390×844). Reference: `inputs/reference/nord-stage-4-73.jpg`.
Specs: `specs/nord-stage-4.visual.json`, `specs/nord-stage-4.piano.json`,
`specs/nord-stage-4.effects.json`. Phase 1 evidence preserved alongside
(`stage1-*.png/json/md` untouched).

## Measured bounds

| Check | Spec / gate | Measured | Verdict |
| --- | --- | --- | --- |
| Desktop instrument width / viewport | 88–97% | 1382.4 / 1440 = **0.960** (identical to Phase 1) | Pass |
| Desktop vertical scroll | none (`bodyScrollHeight ≤ 900`) | **900 = 900** | Pass |
| Desktop horizontal overflow | none | body/doc `scrollWidth` = 1440 | Pass |
| Narrow page overflow | inspectable, no page clip | body/doc `scrollWidth` = 390 (instrument rides the 560px inner rail) | Pass |
| Narrow vertical fit | inspectable without clipping | body height = **844 = viewport** (instrument 781, same as desktop) | Pass |
| Key count / split | 73 = 43 white + 30 black, E1–E7 | 73 / 43 / 30 at both widths, DOM order E1→E7 | Pass |
| Section order | performance, organ, piano, program, synth, effects | matches | Pass |
| Section widths | 0.14 / 0.20 / 0.085 / 0.125 / 0.25 / 0.20 | 0.1388 / 0.1946 / 0.0878 / 0.1249 / 0.2410 / 0.1946 — byte-identical to Phase 1 | Pass |
| Console errors during capture | none | `consoleErrors: []` | Pass |
| Primary OLEDs | Program + Synth only | exactly 2 `[data-primary-oled="true"]`; performance/effects contain no `role="status"` (pitch/rotary mirrors are plain divs) | Pass |
| Instrument height | Phase 1 shape preserved | 781px at both widths (Phase 1: 781 desktop / 802 narrow — narrow now 781 after the statusbar single-line compaction) | Pass |

## What Phase 2 adds visually (no Phase 1 node moved)

- **Piano band**: a `p2-piano-panel` strip after the inherited selectors with
  per-layer (A/B) enable/focus, six type buttons, model/level/octave steppers,
  SUSTPED/PSTICK toggles, KB Touch / Dyn Comp / Unison / Timbre / Soft Release /
  String Res controls. Program band gains a `p2-program-model` line
  (`A:11 Studio Concert`) under the untouched Phase 1 OLED.
- **Layer Effects band**: a `p2-fx-panel` strip with focus buttons
  (Organ/Piano/Synth + follow), Piano group + all-bypass toggles, a rotary
  readout mirror, and per-layer chain editors (Mod 1/2 on+type+rate+amount,
  Delay on+time+feedback+wet+filter+global+Tap, Amp on+type+drive+bass+mid+
  freq+treble+To Rotary, Comp on+amount+fast+global, Reverb on+type+wet+
  bright+global).
- **Performance band**: no new knobs — `perf-master-level`,
  `perf-pitch-stick`, `perf-rotary-speed`, `perf-rotary-drive` are bridged to
  audible state in place; a one-line pitch readout mirror
  (`Bend +0 st`) sits above the brand block.
- **Status rail**: a third span reports the sample library
  (`Library ready: Piano library ready (Grand/Upright/Electric + synth).` in
  the capture, loading real bundled WAVs over fetch). Spans truncate with
  ellipsis so the rail stays one line at 390px.
- Capture reports `p2Controls: 121`, `pianoTypes: 6`, `stageStatus: ready`.

## Deck/keybed split

Unchanged from Phase 1: deck 400px + keybed 300px content bands; `p2` strips
scroll internally (`overflow-y: auto`) inside the inherited 400px deck band,
so the instrument silhouette, section fractions, and keybed action are
pixel-identical to the sealed Phase 1 captures.

## Corrections applied during the phase

1. First Phase 2 capture: narrow body height 847 > 844 (third status span
   wrapped the status rail). Fixed by single-line ellipsis truncation; narrow
   is back to exactly 844 with the instrument at 781.
2. Bridge-vs-duplicate review: an early draft added competing `p2-*` Master /
   pitch / rotary controls; removed in favor of bridging the four hardware
   IDs in place (no duplicate named controls, no competing panel feedback).
3. StrictMode init/dispose race stranded null graphs behind a stale `ready`
   status whenever panel state re-ran the App init effect. Fixed by removing
   the identity-unstable context value from the init effect deps (engines now
   init/dispose exactly once per mount) plus memoised init and synchronous
   dispose teardown in `StageEngine`.

## Known deviations

- All Phase 1 deviations carry over (see `stage1-visual-audit.md`):
  superseded stage1 prompt widths, tall playable keybed vs literal 46% strip,
  simplified micro-detail, 560px narrow inner rail, status rail below keybed.
- The Phase 1 decorative `program-display` OLED keeps its sealed text
  (`A:11 Stage Grand`); the focused Phase 2 model is shown on the
  `p2-program-model` line beneath it (`A:11 Studio Concert`). Both are
  truthful; neither claims unbuilt features.
- Effect strips are dense text-button rows rather than classic Nord knob
  graphics: panel space in the 400px deck band goes to type coverage (every
  listed type reachable) over skeuomorphism. All controls are keyboard
  operable with visible focus and `role=slider`/`button` semantics.
