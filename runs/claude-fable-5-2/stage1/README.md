# Nord Stage 4 73 — Stagebench Phase 1

An interactive Nord Stage 4 73 in the browser. In this phase the 73-key keybed plays one
synthesized piano voice; every panel control moves or presses but is decorative.

```sh
pnpm install
pnpm dev        # develop
pnpm test       # 12 test files, deterministic, no devices or network
pnpm typecheck
pnpm lint
pnpm build      # writes dist/index.html
pnpm preview    # serve the build (audio needs http://, not file://)
```

## Playing

- Mouse or touch on the keys. Striking nearer the front edge is harder. Slide for a glissando.
- Computer keys `A W S E D F T G Y H U J K O L P ; '` (C4 upward). `Z` / `X` shift the octave.
- `Space` is the sustain pedal unless a control has focus; there is also an on-screen pedal.
- MIDI keyboard: press **Enable MIDI**. Notes, velocity, and sustain (CC64) are supported.

## Where things are

| Path | What |
| --- | --- |
| `IMPLEMENTATION_PLAN.md` | Plan, hard-gate checklist, decisions, hand-off notes |
| `IMPLEMENTATION_DETAILS.json` | Truthful audio source and scope declaration |
| `src/hardware/` | Typed panel data: sections, keys, 146 controls, LEDs, legends, presentation store |
| `src/audio/` | DSP kernel, worklet shell, engine |
| `src/input/` | Shared note lifecycle, computer keyboard, Web MIDI |
| `src/platform/` | Injectable browser / audio / MIDI / timing / storage boundaries |
| `src/ui/` | Instrument, controls, keybed, OLEDs, status console |
| `tests/` | One suite per required feature ID; `tests/feature-matrix.json` maps them |
| `evidence/` | Captures, measurements, visual audit |
| `scripts/capture-stage1.js` | Playwright snippet that produced the captures |
