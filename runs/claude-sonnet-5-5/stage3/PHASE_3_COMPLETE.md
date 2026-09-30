# PHASE_3_COMPLETE — Nord Stage 4 73, complete system

Status: implementation finished inside `candidate/`; **not sealed** (the operator seals with `pnpm bench seal claude-sonnet-5-5`).

## Gates (last run, this tree)

| Gate | Result |
| --- | --- |
| `pnpm test` | 24 files, 392 tests passed (run twice in a row, no unhandled errors) |
| `pnpm typecheck` | clean |
| `pnpm lint` | clean |
| `pnpm build` | ok, `dist/index.html` produced |

## What was built

- **Programs:** 32 slots in 4 pages of 8 with dial browsing and a Shift+dial numeric list; Store / Store As with naming; a truthful E indicator; edit-discard on program change with a single-level undo (Shift+SOLO); 8 Live slots that store every edit; JSON persistence through an injectable storage; 21 factory programs (piano, organ, synth, split, layered, scene and morph setups).
- **Splits / scenes / morphs / performance:** up to 4 zones from 3 split points on the 11 documented keys, Off/±6/±12 equal-power crossfades, per-layer zone ranges (KB ZONE), split LEDs on the rail; Layer Scenes I/II (enable flags only); Wheel and Control Pedal morphs with every destination in the spec, hold/double-tap assignment, Shift-clear, LED and LED-graph feedback, MIDI CC1/CC11; Master Clock (tap or dial, 30–300 BPM) locking the arpeggiator/gate, synth LFO, Delay and Mod 1; Transpose ±6; Panic.
- **Organ:** B3, Vox, Farf, Pipe 1 engines (Pipe 2 and B3 Bass reuse them as allowed), nine drawbars with per-model LED graphs, B3 percussion, key click, vibrato/chorus V1–C3, shared effect chain, rotary routing with slow/fast/stop and acceleration.
- **Synth:** three layers, the 14 required waveforms in 5 categories with per-category Osc Ctrl, LP12/LP24/HP/BP with tracking, resonance and drive, three envelopes, LFO (5 waveforms, 3 destinations, clock sync), poly/mono/legato, priority, glide, unison, vibrato, clock-locked arpeggiator/gate with rate, range, direction, hold and run.
- **Integration:** one AudioContext; organ and synth enter the Phase 2 graph and effect chains; every non-excluded control is bound (`CONTROL_AUDIT`, tested; the 21 unsupported controls are listed in the page and in `IMPLEMENTATION_PLAN.md`).

## Fixed in this last pass

1. `evidence/stage3-visual-audit.md` written (and the captures, crops and regression report regenerated).
2. `IMPLEMENTATION_DETAILS.json` now declares `phase: 3` (organ models and synth listed as live synthesis, generated noise/tables declared, no new recordings); `library.test.ts` updated to expect 3.
3. The `OfflineAudioContext.suspend` `InvalidStateError`: `suspend()` points are now unique per 128-frame quantum and a rejected suspension counts as a skipped event that `renderNotes` retries. No unhandled errors in repeated runs.

## Seal-readiness and honest caveats

- Hard-gate checklist with the verbatim Phase 3 strings is in `IMPLEMENTATION_PLAN.md`; `src/evidence.test.ts` checks them, the feature matrix (all Phase 1–3 ids), the captures and the details file.
- Ten inherited assertions were adapted, none deleted (listed under "Regression notes" in the plan).
- Browser evidence was made with Chrome for Testing over `file://` because headless Chrome could not reach `localhost` here. Console clean, one context, real audio measured at the destination.
- At 390×844, five of the 182 controls (1.2 px-high tags/LED labels) are covered at their centre by a neighbour; this is inherited geometry (the Phase 2 capture, made with another browser, measured 0). Not fixed.
- The pixel diff against Phase 2 (40 % on desktop) compares two different browsers' text rendering; treat it as an upper bound, not as evidence of layout change (geometry is re-measured identical).
- Audio is verified on node-web-audio-api and in Chrome, not by ear; organ and synth voicing are approximations (see "Known gaps" in the plan). Not built: Samples mode and other optional items listed there.
- Cleanup: `evidence/.capture-profile` removed; the preview server and Chrome processes were stopped. `scripts/` contains the capture tooling (`cdp-lib.mjs`, `capture3.mjs`, `visual-regression3.py`); the Python script needs pillow and numpy.
