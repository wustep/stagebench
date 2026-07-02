# Stage 1 visual audit — Nord Stage 4 73 (candidate-authored)

Candidate screenshots in this directory (`candidate-stage1-desktop.png` at 1440×900, `candidate-stage1-narrow.png` at 390×844, both device scale 1, headless Chrome) are working evidence only; the canonical `stage1-desktop.png`, `stage1-narrow.png`, and `stage1-capture.json` are produced by the parent capture harness against the sealed build.

## Measured bounds and ratios (from the running build, real Chromium)

Desktop 1440×900:

- Instrument box: x=43.2, y=219.8, w=1353.6, h=437.3 px.
- Instrument width fraction of viewport: **0.9400** (required 0.88–0.97) — pass.
- Chassis aspect ratio: **3.0951** (variant registry: 3.0951) — pass.
- Control deck (incl. top rail): **0.5400** of chassis height; keybed (incl. bottom rail): **0.4600** (spec 0.54/0.46 ± 0.025) — pass.
- Section widths (inline styles, verified in DOM): performance 13%, organ 21%, piano 15%, program 9%, synth 21%, effects 21%; measured x-order matches; sum = 100%.
- No document scroll in either axis at 1440×900; instrument fully visible without vertical scrolling.
- Key count rendered: 73 (43 white, 30 black, E1–E7, black key height 61% of white).
- Automated audit: every one of the 150 modeled panel controls (26 knobs, 5 encoders, 7 faders, 9 drawbars, 1 wheel, 1 pitch stick, 101 buttons) and 73 keys has a positive-size bounding box fully inside its owning section/keybed (tolerance 1.5px), and no two deck controls overlap.

Narrow 390×844:

- Instrument width fraction: 0.97; aspect 3.0952; deck/keys 0.5399/0.46.
- No document scroll; whole chassis, all six sections, and all 73 keys visible; the same per-control visibility audit passes at this viewport.

## Section landmarks and forbidden hardware

- Performance (exposed red): Master Level knob, wooden pitch stick, mod wheel, `nord stage 4` / HAMMER ACTION 73 branding, Rotary Speaker strip (Drive, Organ/Close Mic, Stop Mode/Angle, Slow–Fast, Morph). No inset plate, no OLED.
- Organ (dark plate): nine physical drawbars with red LED ladders and footage legends, two level faders with green LED ladders, organ model / vib-chorus / B3 percussion groups, preset/sync, octave shift, KB zone LEDs. No OLED, non-uniform control grid.
- Piano (dark plate): two layer faders, layer on/off, Acoustics (Soft Rel/String Res/Ped Noise), Unison, KB Touch, Dyn Comp, Timbre rocker, Piano Select box (six type LEDs, Info, Model dial). No OLED, no drawbars.
- Program (red): morph assign (Wheel/A.T./Ctrl Ped), split, master clock, transpose, Panic (decorative), Store/Store As, Preset Library, **primary OLED #1**, large Program encoder, Page/Cat navigation, Live Mode, Layer Scene II, eight numbered Program buttons with secondary legends, Prog View/Solo Undo/Section Edit/Layer Init/Mon|Copy, Shift/Exit.
- Synth (dark plate): **primary OLED #2**, three display encoders, Mode (Samples/Analog/Extern), Arpeggiator/Gate, Voice, Vibrato, Waveform/Sound Init, LFO, Oscillators, Filter, Amp, Unison, three layer faders, KB Hold, Arp Run, octave shift.
- Layer Effects (dark plate): FX Focus column (Organ A/B, Piano A/B, Synth A/B/C, All FX Off, Group), Mod 1, Mod 2, Amp Sim/EQ (5 knobs), Delay (tempo/feedback/dry-wet, Tap/Set, Analog), Comp, Reverb. No OLED.
- Forbidden checks: exactly 2 OLED elements in the DOM, both in Program/Synth; no `<img>`; no marketing hero/heading; keybed inside the single chassis element; no detached rails.

## Corrections from the two desktop comparison-and-repair passes

Pass 1 (structure/density):

1. Added the missing `<meta viewport>`/title to `index.html` (narrow viewport rendered at desktop layout width and clipped the chassis).
2. Drawbars were all pushed in (empty-looking organ) — added a reference-like initial registration pose and top-down red LED ladder fill, matching the photo.
3. Synth OLED name truncated ("Supe…") — resized display block and OLED typography.
4. Program strip (9% width) overflowed vertically — compacted paddings/typography, shrank the program encoder, moved SHIFT/EXIT legends beside the rocker.

Pass 2 (measured clipping/overlap repairs):

5. Group-box titles were clipped by `overflow: hidden` — removed the clip.
6. Program buttons 5–8 and the utility row were flex-shrunk under neighbours — restructured the Program middle to place the encoder column beside the OLED (as on the reference), compacted the OLED, forbade shrink so regressions clip measurably instead of overlapping.
7. Synth bottom groups (LFO/Oscillators/Filter) overlapped — measured widths, capped long legend widths with ellipsis, slimmed knobs/buttons, redistributed flex.
8. Converted fixed 1px plate/group borders to cqw-scaled hairlines and added narrow-only whitespace trims so the Program strip fits at 390px.
9. Drawbar pointer drag inverted so pulling downward (out) increases the value like the physical bar.

Final audit state: zero out-of-bounds controls, zero overlapping deck controls at both required viewports.

## Exercised flows (real headless Chrome, trusted input)

- Click/press-and-hold on C4: engine went `idle → ready` ("Basic piano voice ready (generated synthesis — no samples)"), key depressed (`data-pressed`/`aria-pressed` true), released on mouse-up.
- Computer key `A` pressed/released C4; space bar sustain down/up exercised.
- Three simultaneous pointer notes (C4/E4/G4) pressed and released independently.
- Master Level knob: ArrowUp 64→68, mouse drag →110 (presentation-only).
- Mod 1 On toggled aria-pressed true→false; drawbar 2 pulled 0→4 by dragging down.
- Web MIDI in headless Chrome reported the truthful `denied` state without affecting other inputs (device/hot-plug/disconnect paths covered by injected-boundary tests).

## Console state

Zero console messages, warnings, errors, or page errors during load and the full interaction pass at both 1440×900 and 390×844 (favicon 404 was found and fixed with an inline icon link).

## Known remaining deviations

- Micro-detail (screw heads, brushed-metal texture, exact Nord logotype glyphs, per-knob printed scale numerals) is simplified; legends use a condensed sans approximation rather than Nord's typeface.
- The visual spec lists "five live-program buttons"; the reference photo and manual show eight numbered Program/Live buttons plus a Live Mode button, and BENCHMARK.md phase 3 specifies eight Live slots — the reference/manual reading was followed (eight buttons present).
- At 390×844 the full instrument is scaled to fit the width, so legends are sub-pixel and illegible (everything remains rendered and unclipped); a ~1px sub-pixel rounding sliver can remain inside the Program strip at that scale.
- The keybed is rendered straight-on (product-study top view); the reference photo has slight perspective, so key-front shading is approximated.
- Drawbar cap colors follow the classic Hammond brown/white/black convention, which differs subtly from the photo's mixed cap tones.
