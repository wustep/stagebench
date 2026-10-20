# Phase 3 visual audit: Nord Stage 4 73 (stage-4-73)

Captures: `stage3-desktop.png` (1440x900, css scale), `stage3-narrow.png` (390x844, css scale). Measurements and console records: `stage3-capture.json`.
Reference: `inputs/reference/nord-stage-4-73.jpg`. Baselines: `stage1-*` and `stage2-*` (`stage2-visual-audit.md`).
Provenance: self-captures in this workspace (Playwright Chromium, production build served by `vite preview`). The parent capture harness was not present, so these are not parent-harness outputs.

## Verdict

Declared deviation. The visual regression gate ("All inherited visual, piano, effects, and input behavior remains regression-free") is **not met** at desktop density. Every control renders, sits in a row, and is reachable, and the chassis geometry is unchanged. But the new Phase 3 controls make the Organ, Piano, Program, and Synth sections denser than the Phase 2 surface. Legends collide with each other and with two headings, and the dense sections print legends below the Phase 2 size class. This is declared here, with measurements, rather than hidden. The trade-off that would close it is described under "Decision needed", and I have not taken it on without the operator.

## Chassis: measured against Phase 2

| Item | Phase 2 | Phase 3 | Spec |
| --- | --- | --- | --- |
| Instrument width / viewport (1440) | 94.0% | 94.0% | 88–97% |
| Instrument aspect | 3.095 | 3.095 | 3.0951 |
| Deck share of instrument height | 54% | 54% | 54% ±2.5% |
| Keybed element share of instrument height | not recorded | 41.7% (the bottom rail sits outside the measured element) | 46% incl. rail, not re-measured with the rail |
| Document scroll at 1440x900 | none | none (scrollHeight 900) | none |
| Keys, white / black | 73, 43 / 30 | 73, 43 / 30 (unchanged, keybed not touched) | 73, 43 / 30 |
| Section widths | 184 / 259 / 118 / 167 / 321 / 259 px | not re-measured this pass | documented fractions |
| OLEDs | Program, Synth (decorative) | Program, Synth (live text, see below) | Program and Synth only |

## Legend collisions (measured in the browser)

Measured by intersecting the bounding boxes of all 180 printed legends at 1440x900:

- **15 overlapping pairs** in total, by the section of the first legend in each pair: Organ 8, Program 1, Synth 2, Layer effects 4. Performance and Piano have none in this count.
- **Legends touching a section heading:** Organ 2 (the "ORGAN" heading), Piano 4 (the "PIANO" heading). The Piano legends are the layer legends that sit at the top of the section.

The Phase 2 audit recorded that the Piano legends already overlapped slightly at their Phase 1 positions. Phase 3 adds more collisions in Organ and Program, and the Piano collisions are now closer to the heading.

## Effective legend size (measured)

Median printed legend size, after section zoom:

| Section | Median legend px | Phase 2 reference |
| --- | --- | --- |
| Performance | 7.6 | Phase 1 small legends about 6–7 px |
| Organ | 5.8 | — |
| Piano | 5.3 | — |
| Program | 5.3 | — |
| Synth | 4.9 | — |
| Layer effects | 5.9 | about 6 px (Phase 2 audit, "Legibility") |

The Synth, Piano, and Program legends are below the Phase 2 size class, and they are the least legible text on the surface at 1x.

## Deliberate surface changes (declared)

1. **Program section: split points and clock.** Six split controls (three points, three crossfades) sit in a three-column grid, and the master clock (Tap, Tempo, Sync, Transp, Panic) in another. Both are in their own rows.
2. **Organ: two layer groups** (On, Focus, Level, Oct, Zone each) above the drawbars. The layer groups' printed headings are hidden from sight; the group keeps its accessible name.
3. **Synth: three layer groups, three envelope groups, a filter and oscillator group, LFO and voice groups, and the arpeggiator.** The envelope groups are new (amplitude, filter, oscillator). The synth OLED now shows the selected layer, waveform, and arpeggiator state, not "not active" text.
4. **Piano: layer groups gained a Zone switch.** The Piano layer faders went from `lg` to `md` to save height. The layer groups wrap their controls at the narrow piano width.
5. **Short printed legends for dense controls** (`src/model/legends.ts`). Accessible names keep the full label, so, for example, "Synth A octave" is still announced as such. The printed text is "Oct".
6. **Rotary speed is a continuous control** (Slow at the bottom, Fast at the top) instead of a button, so it can be morphed. The rotary group gained an "Organ to rotary" switch.
7. **Section zoom:** Organ 0.76, Piano 0.70, Program 0.70, Synth 0.64, Layer effects 0.78. Phase 2 had Piano 0.78, Synth 0.86, Program 0.84, Layer effects 0.78, and no Organ zoom. The lower zooms are the source of the small legends above.
8. **Row weights:** rows with tall content (drawbars, the program dial, the piano and synth layers) get more height than rows of small controls.
9. **Status and OLED text.** Program and Synth displays print live program and synth state. The earlier "not active" text is gone, and `src/model/displays.test.ts` checks that no display claims a feature is unimplemented.

## Remaining deviation (declared)

- **Collisions:** 15 overlapping legend pairs, two headings hit (Organ, Piano). Locations: the Organ layer groups above the drawbars, the Piano layer row over its heading, the Synth oscillator heading under its knobs, and the Program row of buttons.
- **Legibility:** Synth, Piano, and Program legends are about 4.9–5.3 px. Phase 2 used about 6 px for its most cramped legends.
- **Density:** the deck is about 225 px tall at 1440x900. Five to six rows of controls per section are the physical limit of this geometry.

The Phase 2 Piano legend overlaps from Phase 1 are still present.

## Decision needed (not taken)

Closing the gate means one of these, which changes something the spec or the operator controls:

1. A taller deck, or a larger desktop viewport. This changes the instrument's fixed 54% geometry, or the viewport the spec names.
2. A larger minimum legend size (about 7 px). This means fewer controls per row, so some groups need a second page or a reduced spec control set.
3. Accepting the current density and this declared deviation as the Phase 3 surface.

I have not made this choice. The current build is option 3 with this audit as the declaration.

## Narrow (390x844)

The instrument keeps its designed width (1000 px) inside a horizontal scroll region named `stage`. The document does not scroll horizontally (scrollWidth 390). This is the Phase 1 and Phase 2 behaviour, and it is inherited. The status text wraps.

## Console and errors

- Desktop and narrow: 0 page errors, 0 console errors on load.
- Interaction pass: organ model Vox (radio), Live Mode on, program button 3, morph wheel assign, STORE armed, arpeggiator run, Panic. 0 page errors and 0 console errors.
- One environment warning, repeated: the browser blocked MIDI SysEx permission. It is not an application error. The Phase 2 audit recorded the same warning.

## Evidence files

- `stage3-desktop.png`, `stage3-narrow.png`: captures (this audit).
- `stage3-capture.json`: capture manifest, measurements, console records, and the interaction pass.
- `stage1-*`, `stage2-*`: retained baselines.
