# Nord Stage 4 73 — Phase 2

React/TypeScript browser instrument with the inherited 73-key surface, two Piano layers, six synthesized models, per-layer effects and shared rotary, and a working master level.

**The recorded-library hard gate remains unmet.** The supplied `inputs/` contain no recorded piano assets or licenses. Grand, Upright and Electric therefore use explicitly labeled synthesis fallbacks. No recordings or external sources were fetched or misrepresented.

Use Node 22 and pnpm 11.7.0:

```sh
pnpm dev
```

Play by pointer, independent touch, mapped computer keys or MIDI. Space, Sustain and MIDI CC64 sustain layers with SUSTPED enabled. Stop notes and blur clear all voices. Use the physical Piano/effects controls or expand **Piano & effects controls** for separate enable/focus, all-effects bypass, group/global and detailed parameters. Shift+layer focuses without toggling enable; Shift+On sets global on Delay, Compressor and Reverb. Organ, Synth, Program and excluded controls remain decorative. Inspect surface enlarges the complete chassis on small screens.

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:browser
```

The Phase 2 browser harness checks the production build, preserves inherited geometry and input assertions, renders both the inherited voice and the new AudioWorklet offline, and uses the unchanged parent capture harness. The original Phase 1 tests, capture harness and evidence remain present. `tests/browser.mjs` is the historical Phase 1 browser script; its phase-specific decorative assertions are superseded by `tests/browser-phase2.mjs`.

See `IMPLEMENTATION_DETAILS.json` for exact sources and limitations and `tests/feature-matrix.json` for coverage. Four passing software gates do not imply the missing recorded-library hard gate passed. These scripts do not seal the candidate.
